//! Emails Job Hunt writes for you (follow-ups, replies, thank-you notes, notes to recruiters) wait
//! here until you approve them: nothing reaches Gmail, and nothing is sent, before that. You can
//! edit one, ask Claude to change it, and see what it's about beside it.

use super::*;
use crate::db::Held;

/// What a held email is, as the page names it.
pub fn held_kind(kind: &str) -> &'static str {
    match kind {
        "follow-up" => "Follow-up",
        "thank-you" => "Thank-you",
        "decline" => "Reply to a no",
        "recruiter" => "To a recruiter",
        _ => "Reply",
    }
}

/// The record a job keeps of its follow-up, thank-you or reply to a rejection (shown on its page).
fn job_record(h: &Held) -> Option<String> {
    let job = h.job_id.as_deref()?;
    let name = match h.kind.as_str() {
        "follow-up" => "followup",
        "thank-you" => "thanks",
        "decline" => "decline",
        _ => return None,
    };
    Some(format!("{name}:{job}"))
}

impl Agent {
    /// Keep an email Job Hunt wrote until you approve it. One written again for the same thing
    /// (the same kind, job and email answered) replaces the one waiting, which is kept as an
    /// earlier version. Returns the held email's id.
    pub fn hold_draft(&self, kind: &str, job_id: Option<&str>, to: &str, subject: &str, body: &str, reply_to: Option<&str>, attach: &[std::path::PathBuf]) -> R<String> {
        let db = self.db();
        let before = db.held_with("waiting")?.into_iter().find(|h| h.kind == kind && h.job_id.as_deref() == job_id && h.reply_to.as_deref() == reply_to);
        let mut h = before.unwrap_or_else(|| Held {
            id: format!("jh:{}", crate::util::short_hash(&format!("{kind}{job_id:?}{}{}", now(), rand::random::<u64>()))),
            kind: kind.into(), job_id: job_id.map(String::from), reply_to: reply_to.map(String::from), status: "waiting".into(), created_at: now(), ..Default::default()
        });
        if !h.body.is_empty() {
            h.versions.push(json!({ "at": h.updated_at, "subject": h.subject, "body": h.body, "note": "Written again" }));
        }
        (h.to, h.subject, h.body) = (to.trim().into(), subject.trim().into(), body.trim().into());
        h.attach = attach.iter().map(|p| p.to_string_lossy().to_string()).collect();
        h.updated_at = now();
        db.held_put(&h)?;
        Ok(h.id)
    }

    /// The emails waiting for your approval, newest first, each with the job it's about.
    pub fn drafts_held(&self) -> Vec<Value> {
        let list = self.db().held_with("waiting").unwrap_or_default();
        list.into_iter().map(|h| {
            let job = h.job_id.as_deref().and_then(|id| self.db().job(id).ok().flatten());
            json!({ "id": h.id, "kind": h.kind, "kind_name": held_kind(&h.kind), "to": h.to, "subject": h.subject, "start": h.body.chars().take(140).collect::<String>(),
                "at": h.updated_at, "job_id": h.job_id, "job_title": job.as_ref().map(|j| j.title.clone()), "company": job.as_ref().map(|j| j.company.clone()) })
        }).collect()
    }

    /// How many are waiting (for the tab and the Queue).
    pub fn drafts_held_count(&self) -> usize {
        self.db().held_with("waiting").map(|l| l.len()).unwrap_or(0)
    }

    /// Where a held email stands, for the pages that show what it was written for: {id, status}.
    pub fn held_state(&self, id: Option<&str>) -> Value {
        match id.filter(|i| i.starts_with("jh:")).and_then(|i| self.db().held(i).ok().flatten()) {
            Some(h) => json!({ "id": h.id, "status": h.status }),
            None => Value::Null,
        }
    }

    /// A job's written email (follow-up, thank-you, reply to a no) with where its held draft stands:
    /// `held` is "waiting", "gmail", "sent" or "discarded"; absent for ones from before emails were held.
    pub(super) fn with_held(&self, mut v: Value) -> Value {
        if let Some(st) = self.held_state(v["draft"].as_str())["status"].as_str() {
            v["held"] = json!(st);
        }
        v
    }

    /// Where every held email stands, by id (for the email list's "Open the draft").
    pub fn held_states(&self) -> Value {
        let mut m = serde_json::Map::new();
        for st in ["waiting", "gmail", "sent", "discarded"] {
            for h in self.db().held_with(st).unwrap_or_default() {
                m.insert(h.id, json!(st));
            }
        }
        Value::Object(m)
    }

    /// One held email with what it's about: the posting, the CV tailored for that job, and what has
    /// happened with the application so far (its events, the emails about it, this email's earlier
    /// versions).
    pub fn draft_view(&self, id: &str) -> R<Value> {
        let h = self.db().held(id)?.ok_or_else(|| Error("That draft no longer exists.".into()))?;
        let job = match h.job_id.as_deref() {
            Some(j) => self.db().job(j)?,
            None => None,
        };
        let mut history: Vec<Value> = vec![];
        let mut cv_text = String::new();
        if let Some(j) = &job {
            // The CV as it was tailored for this job (the file on disk, as you'd send it).
            if let Some(p) = j.cv_path.as_deref().map(std::path::PathBuf::from).filter(|p| p.is_file()) {
                cv_text = cv::open(&p).map(|d| d.plain_text()).unwrap_or_default();
            }
            // What was done with the application, not the scoring and checking behind it.
            let quiet = ["viewed", "score", "search", "scored", "rescored", "unscored", "reviewed", "revised", "check", "salary", "held", "company-site", "chosen"];
            for e in self.db().events_of_job(&j.id)? {
                if e.kind.ends_with(":error") || quiet.contains(&e.kind.as_str()) {
                    continue;
                }
                let text = if e.kind == "tailored" { "CV tailored for this job".to_string() } else { e.detail.clone() };
                history.push(json!({ "at": e.created_at, "what": "event", "text": text, "kind": e.kind }));
            }
            for m in self.db().emails_of_job(&j.id)? {
                history.push(json!({ "at": m.received_at, "what": "in", "from": m.sender.as_deref().map(google::address), "subject": m.subject, "text": m.summary,
                    "thread": m.thread_id, "category": m.category, "answered": h.reply_to.as_deref() == Some(m.gmail_id.as_str()) }));
            }
            // What you wrote to people there (see People on the application).
            for c in self.contacts(&j.id) {
                if let (Some(msg), Some(at)) = (c["message"].as_str().filter(|m| !m.trim().is_empty()), c["sent_at"].as_str()) {
                    history.push(json!({ "at": at, "what": "out", "to": c["name"], "text": msg }));
                }
            }
            for other in self.db().held_of_job(&j.id)?.into_iter().filter(|o| o.id != h.id && ["gmail", "sent"].contains(&o.status.as_str())) {
                history.push(json!({ "at": other.updated_at, "what": "out", "to": other.to, "subject": other.subject, "text": other.body,
                    "state": if other.status == "sent" { "sent from Job Hunt" } else { "approved: in your Gmail drafts" } }));
            }
        } else if let Some(g) = h.reply_to.as_deref() {
            // No application matched: at least the email it answers.
            if let Some(m) = self.db().emails(5000)?.into_iter().find(|m| m.gmail_id == g) {
                history.push(json!({ "at": m.received_at, "what": "in", "from": m.sender.as_deref().map(google::address), "subject": m.subject, "text": m.summary, "thread": m.thread_id, "answered": true }));
            }
        }
        for (i, v) in h.versions.iter().enumerate() {
            history.push(json!({ "at": v["at"], "what": "version", "n": i + 1, "note": v["note"], "subject": v["subject"], "text": v["body"] }));
        }
        history.sort_by(|a, b| a["at"].as_str().unwrap_or("").cmp(b["at"].as_str().unwrap_or("")));
        let job_v = job.as_ref().map(|j| json!({ "id": j.id, "title": j.title, "company": j.company, "location": j.location, "salary": j.salary, "posted_at": j.posted_at,
            "url": j.url, "description": j.description, "status": j.status, "applied_at": j.applied_at, "has_cv": j.cv_path.is_some(), "has_letter": j.letter_path.is_some() }));
        Ok(json!({ "draft": h, "kind_name": held_kind(&h.kind), "job": job_v, "cv_text": cv_text, "history": history,
            "gmail": self.mail.read().unwrap().is_some(), "revising": self.is_running(&format!("draft:{id}")) }))
    }

    fn held_waiting(&self, id: &str) -> R<Held> {
        let h = self.db().held(id)?.ok_or_else(|| Error("That draft no longer exists.".into()))?;
        if h.status != "waiting" {
            return err(match h.status.as_str() {
                "sent" => "That email was already sent.",
                "gmail" => "That email was already approved: it's in your Gmail drafts now. Change it there.",
                _ => "That draft was discarded.",
            });
        }
        Ok(h)
    }

    /// What the job's own page shows of it follows your edits.
    fn follow_in_job(&self, h: &Held) {
        let Some(key) = job_record(h) else { return };
        let Ok(mut v) = serde_json::from_str::<Value>(&self.secret(&key)) else { return };
        if v["draft"].as_str() == Some(h.id.as_str()) {
            (v["to"], v["subject"], v["body"]) = (json!(h.to), json!(h.subject), json!(h.body));
            let _ = self.db().set(&key, &v.to_string());
        }
    }

    /// Your own edits to one waiting (kept as you type; no earlier version is made of each keystroke).
    pub fn save_draft(&self, id: &str, to: &str, subject: &str, body: &str) -> R<()> {
        let mut h = self.held_waiting(id)?;
        (h.to, h.subject, h.body) = (to.trim().into(), subject.trim().into(), body.to_string());
        h.updated_at = now();
        self.db().held_put(&h)?;
        self.follow_in_job(&h);
        Ok(())
    }

    /// Have Claude change one waiting as you ask ("shorter", "say I'm free from January"). What it
    /// said before is kept, to go back to.
    pub fn revise_draft(&self, id: &str, change: &str) -> R<()> {
        let change = change.trim();
        if change.is_empty() {
            return err("Say what should change first.");
        }
        let h = self.held_waiting(id)?;
        let profile = self.profile();
        let job = match h.job_id.as_deref() {
            Some(j) => self.db().job(j)?,
            None => None,
        };
        let about = job.as_ref().map(|j| format!("{} at {}", j.title, j.company)).unwrap_or_default();
        let mut f = self.llm().revise_email(&profile.name, &h.subject, &h.body, change, &about)?;
        if let Some(j) = &job {
            let own = self.own_words(j, &profile);
            (f.subject, f.body) = (cv::humanize(&f.subject, &own), cv::humanize(&f.body, &own));
        }
        // Read again: you may have typed in it while Claude wrote.
        let mut h = self.held_waiting(id)?;
        h.versions.push(json!({ "at": now(), "subject": h.subject, "body": h.body, "note": format!("Before you asked: {change}") }));
        if h.versions.len() > 20 {
            h.versions.remove(0);
        }
        // A reply keeps its subject (the thread's).
        if h.reply_to.is_none() && !f.subject.trim().is_empty() {
            h.subject = f.subject.trim().into();
        }
        h.body = f.body.trim().into();
        h.updated_at = now();
        self.db().held_put(&h)?;
        self.follow_in_job(&h);
        Ok(())
    }

    /// Put back what it said before the last change.
    pub fn undo_draft(&self, id: &str) -> R<()> {
        let mut h = self.held_waiting(id)?;
        let Some(v) = h.versions.pop() else { return err("There's no earlier version to go back to.") };
        (h.subject, h.body) = (v["subject"].as_str().unwrap_or(&h.subject).to_string(), v["body"].as_str().unwrap_or("").to_string());
        h.updated_at = now();
        self.db().held_put(&h)?;
        self.follow_in_job(&h);
        Ok(())
    }

    /// You approve it: it's saved in your Gmail drafts as it stands here (in the thread it answers,
    /// with its files), or with `send`, sent at once. Only now does anything reach Gmail.
    pub fn approve_draft(&self, id: &str, send: bool) -> R<Value> {
        let mut h = self.held_waiting(id)?;
        if h.body.trim().is_empty() {
            return err("The message is empty.");
        }
        let to = h.to.trim().to_string();
        let bad_to = to.is_empty() || to.split(',').any(|a| { let a = a.trim(); !a.contains('@') || a.contains(' ') && !a.contains('<') });
        if send && bad_to {
            return err("Add the address it goes to first (To).");
        }
        if send && super::robot_address(&to.to_lowercase()) {
            return err("That address doesn't take replies, so nobody would read it. Put a person's address in To.");
        }
        let Some(mail) = self.mail.read().unwrap().clone() else {
            return err("Gmail isn't connected, so it can't be saved or sent from here. Connect it in Settings, or copy the text into an email yourself.");
        };
        let original = match h.reply_to.as_deref() {
            Some(g) => Some(mail.get(g)?),
            None => None,
        };
        let subject = match (&original, h.subject.trim().is_empty()) {
            (Some(o), true) => if o.subject.to_lowercase().starts_with("re:") { o.subject.clone() } else { format!("Re: {}", o.subject) },
            _ => h.subject.clone(),
        };
        let files: Vec<std::path::PathBuf> = h.attach.iter().map(std::path::PathBuf::from).filter(|p| p.is_file()).collect();
        let gid = mail.draft_full(&to, &subject, &h.body, original.as_ref(), &files)?;
        h.gmail_id = Some(gid.clone());
        h.status = "gmail".into();
        h.updated_at = now();
        self.db().held_put(&h)?;
        let mut sent_error = None;
        if send {
            match mail.send_draft(&gid) {
                Ok(m) => {
                    h.gmail_id = Some(m);
                    h.status = "sent".into();
                    self.db().held_put(&h)?;
                }
                // Not sent, but it is in Gmail now: say so, so it isn't lost or written twice.
                Err(e) => sent_error = Some(e.0),
            }
        }
        let what = held_kind(&h.kind).to_lowercase();
        let db = self.db();
        db.log(h.job_id.as_deref(), "email", &if h.status == "sent" { format!("{what} sent to {to}: \u{201c}{subject}\u{201d}") } else { format!("{what} approved and saved in your Gmail drafts: \u{201c}{subject}\u{201d}") })?;
        // The Queue's reminder about it is done with.
        if let (Some(j), "follow-up") = (h.job_id.as_deref(), h.kind.as_str()) {
            db.set(&format!("seen:draft:{j}"), &now())?;
        }
        Ok(json!({ "status": h.status, "error": sent_error }))
    }

    /// Not wanted: it's dropped (and was never in Gmail).
    pub fn discard_draft(&self, id: &str) -> R<()> {
        let mut h = self.held_waiting(id)?;
        h.status = "discarded".into();
        h.updated_at = now();
        let db = self.db();
        db.held_put(&h)?;
        if let Some(j) = h.job_id.as_deref() {
            db.set(&format!("seen:draft:{j}"), &now())?;
            db.log(Some(j), "email", &format!("{} discarded", held_kind(&h.kind).to_lowercase()))?;
        }
        Ok(())
    }
}
