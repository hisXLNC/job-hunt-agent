//! People at a company: contacts, the notes written to them, and the chat about one job.

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

    // --- chat about one job ---------------------------------------------------------------------------

    /// The job's chat: [{who: "you"|"claude", text, at}], oldest first.
    pub fn chat(&self, job_id: &str) -> Vec<Value> {
        serde_json::from_str(&self.secret(&format!("chat:{job_id}"))).unwrap_or_default()
    }

    /// Send a message in the job's chat and keep Claude's reply. Returns the reply.
    pub fn chat_send(&self, job_id: &str, message: &str) -> R<String> {
        let message = message.trim();
        if message.is_empty() {
            return err("Write a message first.");
        }
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let cv = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
            .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()))
            .map(|d| d.plain_text())
            .unwrap_or_default();
        let mut list = self.chat(job_id);
        // The last 20 turns are plenty of context.
        let history: Vec<(String, String)> = list.iter().rev().take(20).rev()
            .map(|m| (m["who"].as_str().unwrap_or("you").to_string(), m["text"].as_str().unwrap_or("").to_string())).collect();
        let reply = self.llm().chat(&profile.name, &cv, &job, &job.notes, &history, message)?;
        let at = now();
        list.push(json!({ "who": "you", "text": message, "at": at }));
        list.push(json!({ "who": "claude", "text": reply, "at": at }));
        self.db().set(&format!("chat:{job_id}"), &json!(list).to_string())?;
        Ok(reply)
    }

    pub fn chat_clear(&self, job_id: &str) -> R<()> {
        self.db().set(&format!("chat:{job_id}"), "")
    }
}
