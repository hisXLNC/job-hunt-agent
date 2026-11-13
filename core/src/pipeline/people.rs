//! People at a company: contacts, the notes written to them, and the assistant you can ask anything.

use super::*;

impl Agent {
    // --- contacts -----------------------------------------------------------------------------------

    /// People at the company: [{name, role, email, link, note, message}].
    pub fn contacts(&self, job_id: &str) -> Vec<Value> {
        serde_json::from_str(&self.secret(&format!("contacts:{job_id}"))).unwrap_or_default()
    }

    pub fn save_contacts(&self, job_id: &str, list: &[Value]) -> R<()> {
        let clean: Vec<Value> = list.iter().filter(|c| c["name"].as_str().is_some_and(|n| !n.trim().is_empty())).map(|c| {
            let f = |k: &str| c[k].as_str().unwrap_or("").trim().to_string();
            // sent_at: when you sent the first message; followed_at: the one follow-up (see playbook).
            // replied_at: they wrote back (you said so, for a reply on LinkedIn, which Job Hunt can't see).
            // message_kind: whether the message kept here is the first or the follow-up.
            json!({ "name": f("name"), "role": f("role"), "email": f("email"), "link": f("link"), "note": f("note"), "message": f("message"),
                "message_kind": f("message_kind"), "sent_at": f("sent_at"), "followed_at": f("followed_at"), "replied_at": f("replied_at") })
        }).collect();
        self.db().set(&format!("contacts:{job_id}"), &json!(clean).to_string())
    }

    /// Write a short message to one of the contacts (a LinkedIn note, or an email when there's an
    /// address), the way the playbook says: the first one, or once you've sent that and had no reply
    /// for a week, the one follow-up. Never a third.
    /// Find the recruiter (and likely hiring manager) on LinkedIn, add them to the job's people, and
    /// write the note to the best one. Ok(how many were found).
    pub fn find_recruiter(&self, job_id: &str) -> R<usize> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let found = self.llm().find_recruiters(&job)?;
        if found.is_empty() {
            return err(format!("Couldn't find a recruiter at {} on LinkedIn. Look on LinkedIn yourself, add their name here, and Job Hunt writes the note.", job.company));
        }
        let mut list = self.contacts(job_id);
        let mut first_new = None;
        for p in &found {
            let link = p.linkedin.trim().trim_end_matches('/').to_string();
            let same = |c: &Value| c["link"].as_str().is_some_and(|l| l.trim_end_matches('/') == link) || c["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(p.name.trim()));
            if let Some(i) = list.iter().position(same) {
                first_new.get_or_insert(i);
                continue;
            }
            list.push(json!({ "name": p.name.trim(), "role": p.title.trim(), "link": link, "email": "",
                "note": format!("Found on LinkedIn by Job Hunt ({}). The candidate doesn't know them: a first, cold message.", p.why.trim()) }));
            first_new.get_or_insert(list.len() - 1);
        }
        // A placeholder "Recruiter" with no message yet gives way to the real person.
        list.retain(|c| !(c["name"] == "Recruiter" && c["link"].as_str().unwrap_or("").is_empty() && c["message"].as_str().unwrap_or("").is_empty() && c["sent_at"].as_str().unwrap_or("").is_empty()));
        self.save_contacts(job_id, &list)?;
        let list = self.contacts(job_id);
        let best = found.first().and_then(|p| list.iter().position(|c| c["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(p.name.trim())))).or(first_new).unwrap_or(0);
        self.db().log(Some(job_id), "contact", &format!("found {} on LinkedIn", found.iter().map(|p| p.name.trim()).collect::<Vec<_>>().join(", ")))?;
        // Already messaged them: no new note.
        if list.get(best).is_some_and(|c| c["sent_at"].as_str().unwrap_or("").is_empty()) {
            self.write_outreach(job_id, best)?;
        }
        Ok(found.len())
    }

    pub fn write_outreach(&self, job_id: &str, index: usize) -> R<String> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let mut list = self.contacts(job_id);
        let c = list.get(index).cloned().ok_or_else(|| Error("That contact is gone.".into()))?;
        let name = c["name"].as_str().unwrap_or("").to_string();
        let (sent, followed) = (contact_time(&c, "sent_at"), contact_time(&c, "followed_at"));
        if followed.is_some() {
            return err(format!("You've sent {name} a message and a follow-up already. That's enough: more would read as chasing."));
        }
        if let Some(t) = sent.filter(|t| (Utc::now() - *t).num_days() < crate::playbook::FOLLOW_UP_AFTER) {
            let by = (t + chrono::Duration::days(crate::playbook::FOLLOW_UP_AFTER)).with_timezone(&self.profile().tz()).format("%B %-d");
            return err(format!("You messaged {name} on {}. Give them a week: if there's no reply by {by}, Job Hunt helps you follow up once.", t.with_timezone(&self.profile().tz()).format("%B %-d")));
        }
        let follow_up = sent.is_some();
        let profile = self.profile();
        let cv = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
            .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()))
            .map(|d| d.plain_text())
            .unwrap_or_default();
        let who = ["name", "role", "email", "note"].iter().map(|k| format!("{k}: {}", c[*k].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n");
        let kind = crate::playbook::kind(&job);
        let day = |t: chrono::DateTime<Utc>| t.with_timezone(&profile.tz()).format("%B %-d").to_string();
        let applied = job.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()).map(|t| day(t.with_timezone(&Utc)));
        let mut brief = vec![
            format!("Employer: {}", kind.describe()),
            match sent {
                Some(t) => format!("Message: the one follow-up, to the first message sent {} with no reply", day(t)),
                None => "Message: the first one".into(),
            },
            match &applied {
                Some(d) => format!("Applied: {d}"),
                None => "Applied: not yet (applying now)".into(),
            },
        ];
        if c["email"].as_str().unwrap_or("").trim().is_empty() {
            brief.push(format!("LinkedIn note limit: {} characters", if profile.linkedin_note == 200 { 200 } else { 300 }));
        }
        let facts = profile.application_facts.trim();
        if !facts.is_empty() {
            brief.push(format!("Availability and other facts the candidate gave (use only what's about availability, notice or relocation):\n{facts}"));
        }
        let msg = cv::humanize(&self.llm().outreach(&profile.name, &cv, &job, &who, &brief.join("\n"))?, &self.own_words(&job, &profile));
        list[index]["message"] = json!(msg);
        list[index]["message_kind"] = json!(if follow_up { "follow-up" } else { "first" });
        self.save_contacts(job_id, &list)?;
        self.db().log(Some(job_id), "contact", &format!("{} written to {name}", if follow_up { "follow-up" } else { "message" }))?;
        Ok(msg)
    }

    /// You sent the message written to a contact: the first one, or the follow-up (see write_outreach).
    pub fn contact_sent(&self, job_id: &str, index: usize) -> R<()> {
        let mut list = self.contacts(job_id);
        let c = list.get_mut(index).ok_or_else(|| Error("That contact is gone.".into()))?;
        let key = if contact_time(c, "sent_at").is_some() { "followed_at" } else { "sent_at" };
        c[key] = json!(now());
        let name = c["name"].as_str().unwrap_or("").to_string();
        self.save_contacts(job_id, &list)?;
        self.db().log(Some(job_id), "contact", &format!("{} sent to {name}", if key == "sent_at" { "message" } else { "follow-up" }))
    }

    /// They wrote back (on LinkedIn, say, where Job Hunt can't see it): no follow-up is asked for,
    /// and it counts in how often your messages get a reply. Again: not replied after all.
    pub fn contact_replied(&self, job_id: &str, index: usize) -> R<()> {
        let mut list = self.contacts(job_id);
        let c = list.get_mut(index).ok_or_else(|| Error("That contact is gone.".into()))?;
        let was = contact_time(c, "replied_at").is_some();
        c["replied_at"] = json!(if was { String::new() } else { now() });
        let name = c["name"].as_str().unwrap_or("").to_string();
        self.save_contacts(job_id, &list)?;
        self.db().log(Some(job_id), "contact", &if was { format!("{name}: not a reply after all") } else { format!("{name} replied") })
    }

    /// How your messages to people have done, by who they went to: {recruiter, manager, other},
    /// each {sent, replied}. A reply is one you marked, or (for the job) a real email back.
    pub fn outreach_stats(&self) -> R<Value> {
        let emails = self.db().job_emails()?;
        let jobs = self.db().jobs(None, 5000)?;
        let mut by: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
        for j in jobs {
            let wrote_back = emails.iter().any(|(id, cat, _, _)| *id == j.id && ["recruiter_outreach", "interview_request", "interview_confirmed", "assessment", "offer"].contains(&cat.as_str()));
            for c in self.contacts(&j.id) {
                if contact_time(&c, "sent_at").is_none() {
                    continue;
                }
                let role = c["role"].as_str().unwrap_or("").to_lowercase();
                let kind = if ["recruit", "talent", "sourc", "people partner", "human resources", " hr"].iter().any(|w| role.contains(w) || format!(" {role}").contains(w)) { "recruiter" }
                    else if ["manager", "director", "head", "lead", "vp", "vice president", "chief", "principal"].iter().any(|w| role.contains(w)) { "manager" } else { "other" };
                let e = by.entry(kind).or_default();
                e.0 += 1;
                if contact_time(&c, "replied_at").is_some() || wrote_back {
                    e.1 += 1;
                }
            }
        }
        Ok(json!(by.into_iter().map(|(k, (sent, replied))| (k.to_string(), json!({ "sent": sent, "replied": replied }))).collect::<serde_json::Map<String, Value>>()))
    }

    /// Who you've messaged at a company, across its jobs: [(name, job id, when)]. The playbook says one
    /// recruiter at a company at a time.
    pub fn messaged_at(&self, company: &str) -> Vec<(String, String, String)> {
        let key = crate::db::dupe_key(company, "");
        let jobs: Vec<Job> = self.db().jobs(None, 5000).unwrap_or_default().into_iter().filter(|j| crate::db::dupe_key(&j.company, "") == key).collect();
        let mut out = vec![];
        for j in jobs {
            for c in self.contacts(&j.id) {
                if let Some(at) = c["sent_at"].as_str().filter(|x| !x.is_empty()) {
                    out.push((c["name"].as_str().unwrap_or("").to_string(), j.id.clone(), at.to_string()));
                }
            }
        }
        out
    }

    /// What the playbook says for a job, for its page: {kind, advice, reach_out (worth messaging the
    /// recruiter), messaged: [{name, job, at}] (anyone you've messaged at the company)}.
    pub fn playbook(&self, job: &Job) -> Value {
        let kind = crate::playbook::kind(job);
        let messaged: Vec<Value> = self.messaged_at(&job.company).into_iter().map(|(n, j, at)| json!({ "name": n, "job": j, "at": at })).collect();
        json!({ "kind": kind.id(), "advice": kind.advice(), "reach_out": kind.reach_out(), "messaged": messaged,
            "follow_up_after": crate::playbook::FOLLOW_UP_AFTER, "follow_up_by": crate::playbook::FOLLOW_UP_BY })
    }

    /// Applications where the playbook says to message the recruiter now: private employers and
    /// agencies, applied to in the last few days, with nobody messaged yet.
    pub fn reach_out_due(&self) -> R<Vec<Job>> {
        let now = Utc::now();
        let applied = self.db().jobs(Some("applied"), 2000)?;
        let mut due: Vec<Job> = applied.into_iter().filter(|j| {
            let age = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()).map(|t| (now - t.with_timezone(&Utc)).num_days());
            age.is_some_and(|d| d <= crate::playbook::REACH_OUT_WITHIN) && j.closed_at.is_none() && crate::playbook::kind(j).reach_out()
                && self.messaged_at(&j.company).is_empty()
        }).collect();
        // Approved and not sent yet, with someone to write to (the posting's hiring team, say): a
        // note the day you apply lands better than one days after.
        let approved = self.db().jobs(Some("approved"), 500)?;
        due.extend(approved.into_iter().filter(|j| j.closed_at.is_none() && crate::playbook::kind(j).reach_out()
            && self.contacts(&j.id).iter().any(|c| contact_time(c, "sent_at").is_none() && !(c["link"].as_str().unwrap_or("").is_empty() && c["email"].as_str().unwrap_or("").is_empty()))
            && self.messaged_at(&j.company).is_empty()));
        Ok(due)
    }

    /// Contacts you messaged a week or more ago with no reply and no follow-up yet: [{job, name, index, sent_at}].
    pub fn contact_follow_ups_due(&self) -> R<Vec<Value>> {
        let now = Utc::now();
        let emails = self.db().job_emails()?;
        let mut out = vec![];
        let applied = self.db().jobs(Some("applied"), 2000)?; // read first: contacts() takes the database too
        for j in applied {
            // They wrote back (anything but an automatic acknowledgement): no chasing.
            if emails.iter().any(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str())) {
                continue;
            }
            for (i, c) in self.contacts(&j.id).iter().enumerate() {
                let Some(sent) = contact_time(c, "sent_at") else { continue };
                let days = (now - sent).num_days();
                if contact_time(c, "followed_at").is_none() && contact_time(c, "replied_at").is_none() && (crate::playbook::FOLLOW_UP_AFTER..=30).contains(&days) {
                    out.push(json!({ "job": j.brief(), "name": c["name"], "index": i, "sent_at": c["sent_at"], "late": days > crate::playbook::FOLLOW_UP_BY }));
                }
            }
        }
        Ok(out)
    }

    // --- the assistant: one conversation, wherever you are in Job Hunt -----------------------------

    /// The conversation with the assistant: [{who: "you"|"claude", text, at, about}], oldest first.
    pub fn ask_log(&self) -> Vec<Value> {
        serde_json::from_str(&self.secret("ask:chat")).unwrap_or_default()
    }

    /// The assistant as the page shows it: the conversation, whether an answer is being written,
    /// and, when the last message got no answer, why and the message itself (to send again).
    pub fn ask_state(&self) -> Value {
        json!({ "chat": self.ask_log(), "busy": self.is_running("ask"), "error": self.secret("ask:error"), "draft": self.secret("ask:draft") })
    }

    /// Take a message for the assistant and answer it in the background. `page` is what you were
    /// looking at: {where, hash, job, seen, quote}.
    pub fn ask_start(self: &Arc<Self>, message: &str, page: &Value) -> R<()> {
        let message = message.trim().to_string();
        if message.is_empty() {
            return err("Write a message first.");
        }
        let Some(guard) = self.claim_owned("ask") else { return err("Claude is still answering the last message.") };
        let mut list = self.ask_log();
        list.push(json!({ "who": "you", "text": message, "at": now(), "about": page["where"].as_str().unwrap_or("") }));
        self.db().set("ask:chat", &json!(list).to_string())?;
        self.db().set("ask:error", "")?;
        self.db().set("ask:draft", "")?;
        let (a, page) = (self.clone(), page.clone());
        std::thread::spawn(move || {
            let _g = guard;
            if let Err(e) = a.ask_answer(&message, &page) {
                // The message comes back to the box, so nothing typed is lost.
                let mut list = a.ask_log();
                if list.last().is_some_and(|m| m["who"] == "you") {
                    list.pop();
                }
                let _ = a.db().set("ask:chat", &json!(list).to_string());
                let _ = a.db().set("ask:error", &e.0);
                let _ = a.db().set("ask:draft", &message);
                let _ = a.db().log(None, "ask:error", &e.0);
            }
        });
        Ok(())
    }

    /// Answer the last message of the conversation (already kept by ask_start) and keep the reply.
    pub fn ask_answer(&self, message: &str, page: &Value) -> R<String> {
        let text = |k: &str, max: usize| page[k].as_str().unwrap_or("").trim().chars().take(max).collect::<String>();
        let profile = self.profile();
        let job = match page["job"].as_str().filter(|j| !j.is_empty()) {
            Some(id) => self.db().job(id)?,
            None => None,
        };
        // The CV in play: the one tailored for the job on screen, else that job's CV, else the first.
        let cv = job.as_ref().and_then(|j| j.cv_path.as_deref()).and_then(|p| cv::open(Path::new(p)).ok())
            .or_else(|| {
                let t = job.as_ref().and_then(|j| profile.track(j.track.as_deref())).or(profile.tracks.first())?;
                cv::open(&self.cv_path(&t.name)).ok()
            })
            .map(|d| d.plain_text())
            .unwrap_or_default();
        let list = self.ask_log();
        // The turns before this message; the last 20 are plenty.
        let before = list.len().saturating_sub(1);
        let history: Vec<(String, String)> = list[..before].iter().rev().take(20).rev()
            .map(|m| (m["who"].as_str().unwrap_or("you").to_string(), m["text"].as_str().unwrap_or("").to_string())).collect();
        let asked = crate::claude::Asked {
            candidate: &profile.name,
            cv: &cv,
            job: job.as_ref(),
            facts: &self.ask_facts(&profile, job.as_ref()),
            place: &text("where", 200),
            screen: &text("seen", 9000),
            quote: &text("quote", 2000),
            history: &history,
            message,
        };
        let reply = self.llm().assist(&asked)?;
        let mut list = self.ask_log();
        list.push(json!({ "who": "claude", "text": reply, "at": now() }));
        self.db().set("ask:chat", &json!(list).to_string())?;
        Ok(reply)
    }

    /// What Job Hunt knows that an answer may need: how it's set up, and where the job on screen stands.
    fn ask_facts(&self, p: &crate::profile::Profile, job: Option<&Job>) -> String {
        let mut l = vec![];
        l.push(format!("The bar: postings scoring {} or more get a tailored CV and cover letter.", p.score_threshold));
        for t in &p.tracks {
            let name = if t.label.trim().is_empty() { &t.name } else { &t.label };
            l.push(format!("CV \"{name}\" searches for: {}.", t.titles.join(", ")));
        }
        if !p.locations.is_empty() {
            l.push(format!("Where they look: {}{}.", p.locations.join("; "), if p.remote_ok { "; remote is fine" } else { "" }));
        }
        if let Some(m) = p.min_salary {
            l.push(format!("Lowest salary they'd take: {m:.0}."));
        }
        let wants = p.wants.for_scoring();
        if !wants.trim().is_empty() {
            l.push(format!("What they want from a role, as the scorer is told:\n{wants}"));
        }
        let certs = p.cert_lines();
        if !certs.is_empty() {
            l.push(certs.trim().to_string());
        }
        if !p.guidance.trim().is_empty() {
            l.push(format!("Their own guidance for scoring: {}", p.guidance.trim()));
        }
        if let Some(j) = job {
            l.push(format!("\nThe job on screen: {} at {}. Stage: {}.", j.title, j.company, j.status));
            if let Some(s) = j.score {
                l.push(format!("Fit score of their CV as it is: {s} of 100."));
            }
            if let Some(s) = j.score_after {
                l.push(format!("Fit score of the CV tailored for it: {s}."));
            } else if let Some(s) = j.score_potential {
                l.push(format!("What the fit could reach once the CV is tailored: {s}."));
            }
            if let Some(r) = j.reasoning.as_deref().filter(|r| !r.trim().is_empty()) {
                l.push(format!("Why it scored that: {r}"));
            }
            if !j.red_flags.is_empty() {
                l.push(format!("Concerns the scorer raised: {}", j.red_flags.join(" | ")));
            }
            if let Some(c) = &j.career {
                l.push(format!("Against their career path: {}. {}", if c.toward { "leads toward it" } else { "could set them back" }, c.why));
            }
            if !j.keywords.is_empty() {
                l.push(format!("Keywords the posting asks for: {}.", j.keywords.join(", ")));
            }
            if let (Some(b), Some(a)) = (j.coverage_before, j.coverage_after) {
                l.push(format!("Share of those keywords in the CV: {:.0}% before tailoring, {:.0}% after.", b * 100.0, a * 100.0));
            }
            if !j.keyword_gaps.is_empty() {
                l.push(format!("Keywords left out of the tailored CV because nothing in the CV backs them: {}.", j.keyword_gaps.join(", ")));
            }
            if !j.cv_changes.is_empty() {
                l.push(format!("Paragraphs of the CV reworded for this job: {}.", j.cv_changes.len()));
            }
            if let Some(d) = &j.deadline {
                l.push(format!("Last day to apply: {d}."));
            }
            if j.closed_at.is_some() {
                l.push("The posting has closed.".into());
            }
            if !j.notes.trim().is_empty() {
                l.push(format!("Their notes on this job: {}", j.notes.trim()));
            }
        }
        l.join("\n")
    }

    pub fn ask_clear(&self) -> R<()> {
        self.db().set("ask:chat", "")?;
        self.db().set("ask:error", "")?;
        self.db().set("ask:draft", "")
    }
}
