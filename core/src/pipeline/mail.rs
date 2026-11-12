//! Your job email and your calendar: sorting, replies, interviews.

use super::*;

impl Agent {
    // --- inbox --------------------------------------------------------------------------------------

    pub fn process_inbox(&self, limit: usize) -> R<BTreeMap<String, usize>> {
        let Some(mail) = self.mail.read().unwrap().clone() else {
            return err("Gmail isn't connected. Connect Google in Settings → Accounts.");
        };
        let _guard = self.claim("inbox")?;
        let _ = crate::recruiters::backfill(self);
        let profile = self.profile();
        let me = profile.email.to_lowercase();
        let mut stats = BTreeMap::new();
        match if profile.sources.is_off("alerts") { Ok(0) } else { self.process_alerts(&mail, 30) } {
            Ok(0) => {}
            Ok(n) => {
                stats.insert("job_alert_postings".to_string(), n);
            }
            Err(e) => self.db().log(None, "inbox:error", &format!("job alerts: {e}"))?,
        }
        let recruiters: HashSet<String> = crate::recruiters::list(self).into_iter().map(|r| r.email).collect();
        let mut ids = mail.recent(INBOX_QUERY, limit)?;
        for id in mail.recent(CONFIRM_QUERY, limit).unwrap_or_default() {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        for id in ids {
            if self.db().email_seen(&id)? {
                continue;
            }
            // While the usage limit lasts, the rest waits for the next check (it isn't marked read).
            if self.limited().is_some() {
                break;
            }
            let msg = mail.get(&id)?;
            if google::address(&msg.from) == me {
                continue;
            }
            let apps = self.db().active_applications()?;
            // Mail with nothing about jobs in it (a bill, a smart-home alert) isn't sent to Claude.
            let known = self.db().thread_linked(&msg.thread_id)? || recruiters.contains(&crate::recruiters::sender(&msg.from).1);
            if !known && !about_jobs(&msg, &apps) {
                self.db().record_email(&msg.id, &msg.thread_id, None, &msg.from, &msg.subject, "not_job", "", None, &msg.received_at)?;
                *stats.entry("skipped".to_string()).or_insert(0) += 1;
                continue;
            }
            let input = EmailIn { from: &msg.from, to: &msg.to, date: &msg.date, subject: &msg.subject, body: &msg.body };
            let t = match self.llm().triage(&profile.name, &profile.timezone, &input, &apps) {
                Ok(t) => t,
                // Shown once as the usage-limit notice, not as a problem with this email.
                Err(e) if e.0.contains("usage limit") => break,
                Err(e) => {
                    self.db().log(None, "inbox:error", &format!("{}: {e}", msg.subject))?;
                    continue;
                }
            };
            // "We received your application" for a job Job Hunt never found: you applied yourself,
            // so it joins your applications.
            let mut t = t;
            if t.category == "application_received" && t.job_id.is_none() {
                t.job_id = self.job_from_confirmation(&t)?;
            }
            let draft = self.handle_email(&mail, &msg, &t, &profile)?;
            // A recruiter who wrote to you personally: kept in your recruiters list.
            crate::recruiters::note_email(self, &msg, &t);
            if ["interview_request", "interview_confirmed", "assessment", "rejection", "offer", "recruiter_outreach"].contains(&t.category.as_str())
                && crate::recruiters::list(self).iter().any(|r| r.email == crate::recruiters::sender(&msg.from).1) {
                let _ = mail.label(&msg.id, crate::recruiters::LABEL);
            }
            self.db().record_email(&msg.id, &msg.thread_id, t.job_id.as_deref(), &msg.from, &msg.subject, &t.category, &t.summary, draft.as_deref(), &msg.received_at)?;
            *stats.entry(t.category.clone()).or_insert(0) += 1;
        }
        // A no that named no application: matched by the company it names, so the application
        // doesn't sit as "applied" (and get a follow-up).
        let matched = self.link_rejections();
        if matched > 0 {
            stats.insert("rejections_matched".to_string(), matched);
        }
        let drafted = self.draft_follow_ups();
        if drafted > 0 {
            stats.insert("follow_ups_drafted".to_string(), drafted);
        }
        let db = self.db();
        db.set("last.inbox", &crate::util::now())?;
        if !stats.is_empty() {
            db.log(None, "inbox", &stats.iter().map(|(k, v)| format!("{v} {}", k.replace('_', " "))).collect::<Vec<_>>().join(", "))?;
        }
        Ok(stats)
    }

    /// The job an application confirmation is about: one already known by company and role, or a
    /// new one (from the email) when you applied somewhere Job Hunt didn't find. None without both.
    pub(super) fn job_from_confirmation(&self, t: &Triage) -> R<Option<String>> {
        let (Some(company), Some(role)) = (t.company.as_deref().map(str::trim).filter(|c| !c.is_empty()), t.role.as_deref().map(str::trim).filter(|r| !r.is_empty())) else {
            return Ok(None);
        };
        let existing = self.db().existing_job("", company, role);
        if existing.is_some() {
            return Ok(existing);
        }
        let p = Posting {
            source: "email".into(),
            external_id: short_hash(&format!("{company}|{role}")),
            company: company.into(),
            title: role.into(),
            description: format!("Added from the confirmation email: {}", t.summary),
            ..Posting::default()
        };
        let mut job = p.to_job();
        job.status = "queued".into();
        let db = self.db();
        db.insert_job(&job)?;
        db.log(Some(&job.id), "added", "you applied yourself; added from the confirmation email")?;
        Ok(Some(job.id))
    }

    pub(super) fn handle_email(&self, mail: &Arc<dyn Mail>, msg: &Email, t: &Triage, profile: &Profile) -> R<Option<String>> {
        if let Some(l) = label(&t.category) {
            mail.label(&msg.id, l)?;
        }
        let job = match &t.job_id {
            Some(id) => self.db().job(id)?,
            None => None,
        };
        let mut now_applied = false;
        if let Some(job) = &job {
            let db = self.db();
            db.log(Some(&job.id), &format!("email:{}", t.category), &t.summary)?;
            let mut target = email_status(&t.category);
            // "We received your application": you applied, even if you didn't tell Job Hunt.
            if t.category == "application_received" && ["approved", "ready", "saved", "queued", "skipped", "dismissed"].contains(&job.status.as_str()) {
                target = Some("applied");
                now_applied = true;
            }
            if let Some(target) = target {
                if target != job.status {
                    db.set_status(&job.id, target, &format!("from email: {}", msg.subject))?;
                    // A no is said out loud, not just filed.
                    if target == "rejected" {
                        drop(db);
                        self.note(&format!("Turned down: {}", job.company), &format!("{}. It's in your Queue under Waiting, where you can read what they wrote and draft a short reply.", job.title));
                    }
                }
            }
        }
        // Just applied: write to the recruiter, as you chose (Settings on the Recruiters page).
        if let (true, Some(job)) = (now_applied, &job) {
            if let Err(e) = crate::recruiters::on_applied(self, &job.id) {
                self.db().log(Some(&job.id), "recruiter:error", &e.0)?;
            }
        }
        // An interview invitation: write the prep sheet now, so it's ready when you look.
        if let Some(job) = &job {
            if email_status(&t.category) == Some("interviewing") && self.prep(&job.id).is_none() {
                if let Err(e) = self.make_prep(&job.id) {
                    self.db().log(Some(&job.id), "prep:error", &e.0)?;
                }
            }
        }
        match t.category.as_str() {
            "interview_confirmed" if t.confirmed_time.is_some() && self.cal.read().unwrap().is_some() => {
                self.book_interview(job.as_ref(), t, msg, profile)?;
                Ok(None)
            }
            "interview_request" => match self.scheduling_reply(msg, t, profile)? {
                Some(body) => Ok(Some(mail.draft_reply(msg, &body)?)),
                None => Ok(None),
            },
            _ if t.needs_reply && t.reply_draft.as_deref().is_some_and(|d| !d.trim().is_empty()) => {
                let id = mail.draft_reply(msg, t.reply_draft.as_deref().unwrap())?;
                let from = t.company.clone().filter(|c| !c.is_empty()).or_else(|| job.as_ref().map(|j| j.company.clone())).unwrap_or_else(|| google::address(&msg.from));
                self.note(&format!("Reply from {from}"), &format!("An answer is waiting in your Gmail drafts: {}", msg.subject));
                Ok(Some(id))
            }
            "offer" => {
                self.note("You have an offer", &format!("{}: {}", t.company.clone().unwrap_or_default(), t.summary));
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    // --- calendar -----------------------------------------------------------------------------------

    pub(super) fn scheduling_reply(&self, msg: &Email, t: &Triage, profile: &Profile) -> R<Option<String>> {
        let Some(cal) = self.cal.read().unwrap().clone() else { return Ok(None) };
        let tz = profile.tz();
        let now = Utc::now();
        let busy = cal.busy(now, now + Duration::days(21))?;
        let accept = t.offered_times.iter().find(|s| {
            match (parse_time(&s.start, tz), parse_time(&s.end, tz)) {
                (Some(a), Some(b)) => a > now && is_free(&busy, a, b),
                _ => false,
            }
        });
        let c = &profile.calendar;
        let free: Vec<TimeSlot> = if accept.is_some() {
            vec![]
        } else {
            free_slots(&busy, now, tz, (c.work_start, c.work_end), c.slot_minutes, c.propose_slots)
                .into_iter()
                .map(|(a, b)| TimeSlot { start: a.with_timezone(&tz).to_rfc3339(), end: b.with_timezone(&tz).to_rfc3339() })
                .collect()
        };
        let input = EmailIn { from: &msg.from, to: &msg.to, date: &msg.date, subject: &msg.subject, body: &msg.body };
        let body = self.llm().scheduling_reply(&profile.name, &profile.timezone, &input, accept, &free)?;
        self.note("Interview request", &format!("A reply proposing times is waiting in your Gmail drafts: {}", msg.subject));
        Ok(Some(body))
    }

    /// The interview event, a prep block before it, and follow-up reminders after it.
    pub fn book_interview(&self, job: Option<&Job>, t: &Triage, msg: &Email, profile: &Profile) -> R<Vec<String>> {
        // Interviews confirmed by email are booked only with Google connected (that's where the email came from).
        if self.cal.read().unwrap().is_none() {
            return Ok(vec![]);
        }
        let Some(slot) = &t.confirmed_time else { return Ok(vec![]) };
        let tz = profile.tz();
        let (Some(start), Some(end)) = (parse_time(&slot.start, tz), parse_time(&slot.end, tz)) else {
            return err(format!("Couldn't read the interview time “{}”.", slot.start));
        };
        let company = job.map(|j| j.company.clone()).or(t.company.clone()).unwrap_or_else(|| "Interview".into());
        let role = job.map(|j| j.title.clone()).or(t.role.clone()).unwrap_or_default();
        let mut details = vec![];
        if !role.is_empty() {
            details.push(format!("Role: {role}"));
        }
        if !t.interviewers.is_empty() {
            details.push(format!("Interviewers: {}", t.interviewers.join(", ")));
        }
        if let Some(l) = &t.meeting_link {
            details.push(format!("Join: {l}"));
        }
        if let Some(j) = job {
            if !j.url.is_empty() {
                details.push(format!("Posting: {}", j.url));
            }
        }
        details.push(format!("\nFrom: {} — {}", msg.from, msg.subject));
        details.push(t.summary.clone());
        let details = details.join("\n");

        self.schedule_interview(job, &company, &role, start, end, &details, t.meeting_link.clone(), profile)
    }

    /// Put an interview in your calendar, with prep time before it and thank-you and follow-up
    /// reminders after (Settings → Calendar). With Google connected they go into Google Calendar;
    /// either way Job Hunt keeps them for its Calendar page. Returns the new entries' ids.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn schedule_interview(&self, job: Option<&Job>, company: &str, role: &str, start: chrono::DateTime<Utc>, end: chrono::DateTime<Utc>, details: &str, link: Option<String>, profile: &Profile) -> R<Vec<String>> {
        let cal = self.cal.read().unwrap().clone();
        let tz = profile.tz();
        let job_id = job.map(|j| j.id.as_str());
        let mut made = vec![];
        let mut add = |kind: &str, e: NewEvent| -> R<()> {
            let key = e.start.to_rfc3339();
            if self.db().calendar_event_exists(job_id, kind, &key)? {
                return Ok(());
            }
            let id = match &cal {
                Some(c) => c.create(&e)?,
                None => format!("local:{kind}:{}:{key}", job_id.unwrap_or("")),
            };
            self.db().record_calendar_event(&id, job_id, kind, &key, &e.summary)?;
            made.push(id);
            Ok(())
        };
        add("interview", NewEvent {
            summary: format!("Interview: {company}{}", if role.is_empty() { String::new() } else { format!(" – {role}") }),
            start, end, description: details.to_string(), location: link, color: Some("11".into()), reminders: Some(vec![60, 15]),
        })?;
        let c = &profile.calendar;
        if c.prep_minutes > 0 {
            add("prep", NewEvent {
                summary: format!("Prep: {company} interview"),
                start: start - Duration::minutes(c.prep_minutes), end: start,
                description: format!("Review the posting, your tailored CV and your questions.\n\n{details}"),
                color: Some("5".into()), reminders: Some(vec![10]), ..NewEvent::default()
            })?;
        }
        for &n in &c.followup_days {
            let s = weekday_after(start, tz, n, 9);
            let what = if n <= 1 { "Send thank-you note" } else { "Follow up if no reply" };
            add(&format!("followup-{n}"), NewEvent {
                summary: format!("{what}: {company}"), start: s, end: s + Duration::minutes(15),
                description: details.to_string(), reminders: Some(vec![0]), ..NewEvent::default()
            })?;
        }
        if !made.is_empty() {
            let when = start.with_timezone(&tz).format("%a %-d %b, %H:%M").to_string();
            if let Some(id) = job_id {
                self.db().log(Some(id), "calendar", &format!("interview booked for {when}"))?;
            }
            let where_ = if cal.is_some() { "your calendar" } else { "Job Hunt's calendar" };
            self.note("Interview booked", &format!("{company}, {when}. Prep time and follow-up reminders are in {where_}."));
        }
        Ok(made)
    }

    /// An interview you arranged yourself (by phone, or an email Job Hunt didn't read): booked like
    /// one from email, and the application moves to Interviewing.
    pub fn add_interview(&self, job_id: &str, start: &str, minutes: i64, link: &str, note: &str) -> R<Vec<String>> {
        let profile = self.profile();
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let at = parse_time(start, profile.tz()).ok_or_else(|| Error("Choose a date and time for the interview.".into()))?;
        let mut details = vec![format!("Role: {}", job.title)];
        if !link.trim().is_empty() {
            details.push(format!("Join: {}", link.trim()));
        }
        if !job.url.is_empty() {
            details.push(format!("Posting: {}", job.url));
        }
        if !note.trim().is_empty() {
            details.push(note.trim().to_string());
        }
        let made = self.schedule_interview(Some(&job), &job.company, &job.title, at, at + Duration::minutes(minutes.clamp(15, 480)), &details.join("\n"),
            Some(link.trim().to_string()).filter(|l| !l.is_empty()), &profile)?;
        if made.is_empty() {
            return err("That interview is in the calendar already.");
        }
        if ["ready", "approved", "applied", "saved", "queued"].contains(&job.status.as_str()) {
            self.db().set_status(job_id, "interviewing", "interview added to the calendar")?;
        }
        Ok(made)
    }

    /// What's coming up, and what just happened, as one list: interviews, prep time and reminders
    /// from the calendar; application deadlines; and follow-ups that are due.
    pub fn calendar(&self, back_days: i64, ahead_days: i64) -> R<Vec<Value>> {
        let profile = self.profile();
        let tz = profile.tz();
        let now = Utc::now();
        let (from, to) = (now - Duration::days(back_days), now + Duration::days(ahead_days));
        let mut out = vec![];
        let entries = self.db().calendar_between(&from.to_rfc3339(), &to.to_rfc3339())?;
        for e in entries {
            let kind = if e.kind.starts_with("followup") { "reminder" } else { e.kind.as_str() };
            out.push(json!({ "id": e.event_id, "kind": kind, "at": e.start, "all_day": false, "title": e.title,
                "job_id": e.job_id, "company": e.company, "job_title": e.job_title, "local": e.event_id.starts_with("local:") }));
        }
        let day = |d: chrono::NaiveDate| d.and_hms_opt(9, 0, 0).and_then(|t| t.and_local_timezone(tz).single()).map(|t| t.with_timezone(&Utc));
        for st in ["queued", "ready", "approved", "saved"] {
            let jobs = self.db().jobs(Some(st), 5000)?; // bound first: the database lock is released
            for j in jobs {
                let Some(d) = j.deadline.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).and_then(day) else { continue };
                if d >= from && d < to && j.closed_at.is_none() {
                    out.push(json!({ "id": format!("deadline:{}", j.id), "kind": "deadline", "at": d.to_rfc3339(), "all_day": true, "apply_email": j.apply_email,
                        "title": format!("Last day to apply: {}", j.company), "job_id": j.id, "company": j.company, "job_title": j.title, "status": j.status }));
                }
            }
        }
        // Applications waiting on a reply: the day a follow-up is due (today, if it's overdue).
        let due: HashSet<String> = self.follow_ups_due()?.into_iter().map(|j| j.id).collect();
        if profile.follow_up_after > 0 {
            let applied_jobs = self.db().jobs(Some("applied"), 5000)?; // bound first: follow_up needs the database
            for j in applied_jobs {
                let Some(applied) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()) else { continue };
                if self.follow_up(&j.id).is_some() {
                    continue;
                }
                let when = applied.with_timezone(&Utc) + Duration::days(profile.follow_up_after as i64);
                let when = if due.contains(&j.id) { now } else { when };
                if when < to && (due.contains(&j.id) || when >= now) {
                    out.push(json!({ "id": format!("followup:{}", j.id), "kind": "follow-up", "at": when.to_rfc3339(), "all_day": true,
                        "title": format!("Follow up: {}", j.company), "job_id": j.id, "company": j.company, "job_title": j.title, "overdue": due.contains(&j.id) }));
                }
            }
        }
        // Your other Google Calendar events, from the last sync.
        if self.secret("cal.show_google") != "0" {
            let cache: Value = serde_json::from_str(&self.secret("gcal.cache")).unwrap_or(Value::Null);
            let known: HashSet<String> = self.db().calendar_ids()?.into_iter().map(|e| e.event_id).collect();
            for e in cache["events"].as_array().into_iter().flatten() {
                let Some(at) = e["start"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)) else { continue };
                // An all-day event is a date, not a moment: noon of that day where you are.
                let at = if e["all_day"] == true { day(at.date_naive()).map(|d| d + Duration::hours(3)).unwrap_or(at) } else { at };
                if at < from || at >= to || known.contains(e["id"].as_str().unwrap_or("")) {
                    continue;
                }
                out.push(json!({ "id": e["id"], "kind": "google", "at": at.to_rfc3339(), "all_day": e["all_day"], "title": e["title"],
                    "job_id": Value::Null, "suggest": e["suggest"] }));
            }
        }
        out.sort_by(|a, b| a["at"].as_str().cmp(&b["at"].as_str()));
        Ok(out)
    }

    /// Two-way sync with Google Calendar:
    /// - entries Job Hunt kept itself (added while Google wasn't connected) are copied there;
    /// - interviews, prep and reminders moved or deleted in Google Calendar are moved or removed here;
    /// - your other events are kept for the Calendar page, and ones that look like an interview for
    ///   one of your applications are suggested to link.
    pub fn sync_calendar(&self) -> R<Value> {
        let Some(cal) = self.cal.read().unwrap().clone() else {
            return err("Connect Google in Settings → Accounts to sync with Google Calendar.");
        };
        let profile = self.profile();
        let now = Utc::now();
        let mine = self.db().calendar_ids()?;
        // 1. Ours, not in Google yet: copy them.
        let mut pushed = 0;
        for e in mine.iter().filter(|e| e.event_id.starts_with("local:")) {
            let Ok(start) = chrono::DateTime::parse_from_rfc3339(&e.start).map(|t| t.with_timezone(&Utc)) else { continue };
            if start < now {
                continue;
            }
            let minutes = match e.kind.as_str() { "interview" => 60, "prep" => profile.calendar.prep_minutes.max(15), _ => 15 };
            let id = cal.create(&NewEvent { summary: e.title.clone(), start, end: start + Duration::minutes(minutes), description: "Added by Job Hunt.".into(), ..NewEvent::default() })?;
            self.db().update_calendar_event(&e.event_id, Some(&id), None)?;
            pushed += 1;
        }
        // 2. What Google has now.
        let items = cal.events(now - Duration::days(14), now + Duration::days(90))?;
        let mine = self.db().calendar_ids()?;
        let (mut moved, mut removed) = (0, 0);
        for it in &items {
            let Some(e) = mine.iter().find(|e| e.event_id == it.id) else { continue };
            if it.cancelled {
                self.db().delete_calendar_event(&e.event_id)?;
                if let (Some(job), "interview") = (&e.job_id, e.kind.as_str()) {
                    self.db().log(Some(job), "calendar", "interview removed from your Google Calendar")?;
                }
                removed += 1;
            } else if !it.start.is_empty() && chrono::DateTime::parse_from_rfc3339(&it.start).ok() != chrono::DateTime::parse_from_rfc3339(&e.start).ok() {
                self.db().update_calendar_event(&e.event_id, None, Some(&it.start))?;
                if let (Some(job), "interview") = (&e.job_id, e.kind.as_str()) {
                    let when = chrono::DateTime::parse_from_rfc3339(&it.start).map(|t| t.with_timezone(&profile.tz()).format("%a %-d %b, %H:%M").to_string()).unwrap_or_default();
                    self.db().log(Some(job), "calendar", &format!("interview moved to {when} in your Google Calendar"))?;
                }
                moved += 1;
            }
        }
        // 3. Everything else, for the Calendar page; an interview-looking one names its application.
        let mut active: Vec<Job> = vec![];
        for st in ["ready", "approved", "applied", "interviewing"] {
            active.extend(self.db().jobs(Some(st), 2000)?);
        }
        let interviewish = ["interview", "call", "chat", "meeting", "screen", "conversation", "panel"];
        let others: Vec<Value> = items.iter().filter(|it| !it.cancelled && !mine.iter().any(|e| e.event_id == it.id)).map(|it| {
            let text = format!("{} {}", it.summary, it.description).to_lowercase();
            let suggest = interviewish.iter().any(|w| text.contains(w)).then(|| active.iter().find(|j| {
                let c = crate::db::dupe_key(&j.company, "").trim_end_matches('|').to_string();
                c.len() >= 3 && (text.contains(&j.company.to_lowercase()) || text.replace(|ch: char| !ch.is_alphanumeric(), "").contains(&c))
            })).flatten();
            json!({ "id": it.id, "title": it.summary, "start": it.start, "end": it.end, "all_day": it.all_day,
                "suggest": suggest.map(|j| json!({ "job_id": j.id, "company": j.company, "title": j.title })) })
        }).collect();
        let db = self.db();
        db.set("gcal.cache", &json!({ "at": now.to_rfc3339(), "events": others }).to_string())?;
        db.set("last.calsync", &now.to_rfc3339())?;
        Ok(json!({ "pushed": pushed, "moved": moved, "removed": removed, "others": others.len() }))
    }

    /// Mark one of your Google Calendar events as the interview for an application: it then shows
    /// with that application (and it moves to Interviewing).
    pub fn link_calendar_event(&self, event_id: &str, job_id: &str) -> R<()> {
        let cache: Value = serde_json::from_str(&self.secret("gcal.cache")).unwrap_or(Value::Null);
        let ev = cache["events"].as_array().and_then(|a| a.iter().find(|e| e["id"] == event_id)).cloned()
            .ok_or_else(|| Error("That event isn't in the last sync. Sync again and retry.".into()))?;
        if ev["all_day"] == true {
            return err("That's an all-day event, so it has no time. Give it a time in Google Calendar and sync again, or use Add interview.");
        }
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let db = self.db();
        db.record_calendar_event(event_id, Some(job_id), "interview", ev["start"].as_str().unwrap_or(""), ev["title"].as_str().unwrap_or("Interview"))?;
        if ["queued", "ready", "approved", "applied", "saved"].contains(&job.status.as_str()) {
            db.set_status(job_id, "interviewing", "interview found in your Google Calendar")?;
        }
        db.log(Some(job_id), "calendar", "interview linked from your Google Calendar")
    }

    /// The coming 90 days of your calendar as an iCalendar file, for Outlook or Apple Calendar.
    pub fn calendar_ics(&self) -> R<String> {
        let esc = |t: &str| t.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n");
        let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Job Hunt//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Job Hunt\r\n");
        for e in self.calendar(0, 90)? {
            let Some(at) = e["at"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)) else { continue };
            let title = e["title"].as_str().unwrap_or("");
            let what = e["job_title"].as_str().map(|t| format!("{t} at {}", e["company"].as_str().unwrap_or(""))).unwrap_or_default();
            out.push_str("BEGIN:VEVENT\r\n");
            out.push_str(&format!("UID:{}@jobhunt\r\nDTSTAMP:{stamp}\r\n", esc(e["id"].as_str().unwrap_or(""))));
            if e["all_day"] == true {
                let d = at.with_timezone(&self.profile().tz()).date_naive();
                out.push_str(&format!("DTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\n", d.format("%Y%m%d"), (d + Duration::days(1)).format("%Y%m%d")));
            } else {
                let len = match e["kind"].as_str() { Some("interview") => 60, Some("prep") => self.profile().calendar.prep_minutes.max(15), _ => 15 };
                out.push_str(&format!("DTSTART:{}\r\nDTEND:{}\r\n", at.format("%Y%m%dT%H%M%SZ"), (at + Duration::minutes(len)).format("%Y%m%dT%H%M%SZ")));
            }
            out.push_str(&format!("SUMMARY:{}\r\nDESCRIPTION:{}\r\nEND:VEVENT\r\n", esc(title), esc(&what)));
        }
        out.push_str("END:VCALENDAR\r\n");
        Ok(out)
    }
}
