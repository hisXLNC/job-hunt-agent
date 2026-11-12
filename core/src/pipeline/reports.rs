//! How it is going: health, the week, the spreadsheet copy, and what works.

use super::*;

impl Agent {
    // --- health ---------------------------------------------------------------------------------------

    /// Anything that needs fixing for Job Hunt to keep working: [{level, text, link}].
    pub fn health(&self) -> Vec<Value> {
        let mut out = vec![];
        let add = |out: &mut Vec<Value>, level: &str, text: String, link: &str| out.push(json!({ "level": level, "text": text, "link": link }));
        let act = |out: &mut Vec<Value>, level: &str, text: String, action: &str, data: Value| out.push(json!({ "level": level, "text": text, "action": action, "data": data }));
        // A problem with a button that fixes it right there: (label, action, task for "run").
        let fix = |out: &mut Vec<Value>, level: &str, text: String, label: &str, action: &str, task: &str| out.push(json!({ "level": level, "text": text, "fix": { "label": label, "act": action, "task": task } }));
        let age_days = |k: &str| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).ok().map(|t| (Utc::now() - t.with_timezone(&Utc)).num_days());
        if !self.claude_ready() {
            add(&mut out, "problem", if self.engine_name() == "api" { "No Claude API key, so nothing can be scored or tailored.".into() } else { "Claude Code isn't ready on this computer, so nothing can be scored or tailored.".into() }, "#settings/connections");
        }
        if self.engine_name() == "api" && self.claude_ready() && (self.profile().sources.indeed || self.ratings_auto()) {
            add(&mut out, "warn", "You're using a Claude API key. Indeed search, company ratings and finding jobs on companies' own sites need your Claude subscription: choose it in Settings \u{2192} Accounts \u{2192} Claude.".into(), "#settings/connections");
        }
        if let Some(t) = self.limited() {
            add(&mut out, "warn", format!("Your Claude usage limit is reached. It resets {}; searching, scoring and tailoring wait until then, and pick up by themselves.", crate::util::reset_time(t, chrono::Utc::now())), "#settings/connections");
        }
        // Google connected, but your data is only on this computer: one click keeps it in your Drive.
        if self.files.read().unwrap().is_some() && !crate::sync::enabled(self) && self.secret("sync.declined").is_empty() {
            fix(&mut out, "warn", "Your Job Hunt data is only on this computer. Keep it backed up and synced in your own Google Drive, to pick up where you left off on any PC.".into(), "Turn on", "syncOn", "");
        }
        if !self.secret("google.token").is_empty() && !self.google_client().is_empty() && self.mail.read().unwrap().is_none() {
            add(&mut out, "problem", "Google is disconnected: job email isn't being read and follow-ups aren't drafted. Reconnect it.".into(), "#settings/connections");
        }
        if let Ok(r) = serde_json::from_str::<Value>(&self.secret("last.report")) {
            let broken: Vec<Value> = r["broken_boards"].as_array().cloned().unwrap_or_default();
            if !broken.is_empty() {
                let names: Vec<String> = broken.iter().map(|b| format!("{} ({})", b["name"].as_str().unwrap_or(""), b["source"].as_str().unwrap_or(""))).collect();
                act(&mut out, "warn", format!("{} company board{} no longer exist{}: {}. Remove {} and add others?", broken.len(), if broken.len() == 1 { "" } else { "s" }, if broken.len() == 1 { "s" } else { "" }, names.join(", "), if broken.len() == 1 { "it" } else { "them" }), "removeBroken", json!(broken));
            }
            // The same status as Connections shows: a later test that worked clears a failed search.
            let broken: Vec<String> = self.connections().unwrap_or_default().iter()
                .filter(|c| c["group"] == "Job listings" && c["status"] == "problem" && c["id"] != "boards")
                .filter_map(|c| c["name"].as_str().map(String::from)).collect();
            if !broken.is_empty() {
                add(&mut out, "warn", format!("{} isn't working. See why and fix it in Search \u{2192} Set up sources.", broken.join(", ")), "#settings/sources");
            }
            if r["errors"].as_array().is_some_and(|e| e.iter().any(|x| x.as_str().is_some_and(|t| t.contains("usage limit")))) {
                add(&mut out, "warn", "The last search hit your Claude usage limit, so some postings wait for the next search.".into(), "#overview");
            }
        }
        match age_days("last.search") {
            Some(d) if d >= 2 && self.claude_ready() => fix(&mut out, "warn", format!("No job search for {d} days. Is Job Hunt starting with Windows (Settings \u{2192} App)?"), "Search now", "run", "search"),
            _ => {}
        }
        if crate::sync::enabled(self) && age_days("last.sync").is_none_or(|d| d >= 2) {
            fix(&mut out, "warn", "Sync between computers hasn't saved in two days. Check it in Settings \u{2192} Sync & backup.".into(), "Sync now", "syncNow", "");
        }
        if age_days("last.backup").is_some_and(|d| d >= 3) {
            fix(&mut out, "warn", "No backup in three days. Check it in Settings \u{2192} Sync & backup.".into(), "Back up now", "backupNow", "");
        }
        // Problems logged in the last two days, one line per kind.
        let since = (Utc::now() - Duration::days(2)).to_rfc3339();
        let errors = self.db().errors_since(&since).unwrap_or_default();
        let mut seen = HashSet::new();
        for e in errors {
            let kind = e.kind.trim_end_matches(":error").to_string();
            // The usage limit has its own notice above.
            if crate::claude_code::is_limit(&e.detail) {
                continue;
            }
            // Fixed since: the same task worked afterwards, or (for Google's) Google was connected again.
            let at = |k: &str| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).ok();
            let when = chrono::DateTime::parse_from_rfc3339(&e.created_at).ok();
            let ok_key = match kind.as_str() { "search" => "last.search", "inbox" => "last.inbox", "sync" => "last.sync", "backup" => "last.backup", _ => "last.check" };
            let signed_out = e.detail.contains("Google signed Job Hunt out");
            let google = kind == "inbox" || kind == "sync" && self.secret("sync.where") == "drive" || signed_out;
            let fixed = |k: &str| matches!((when, at(k)), (Some(w), Some(t)) if t > w);
            if fixed(ok_key) || google && fixed("google.at") {
                continue;
            }
            if ["search", "inbox", "sync", "backup", "check"].contains(&kind.as_str()) && seen.insert(kind.clone()) {
                let what = match kind.as_str() { "search" => "Job search", "inbox" => "Email check", "sync" => "Sync", "backup" => "Backup", _ => "Posting check" };
                let detail = short_problem(&e.detail);
                match kind.as_str() {
                    // One notice with the way out, whichever task found it (the advice is in Settings).
                    _ if signed_out => {
                        if seen.insert("google-signed-out".into()) {
                            fix(&mut out, "warn", format!("Google signed Job Hunt out, so the {} stopped. Reconnect it; if it happens again a week later, \
publish your Google project (Settings \u{2192} Accounts explains how).", what.to_lowercase()), "Reconnect Google", "google", "");
                        }
                    }
                    // Trying again doesn't help without a CV: the link goes where you add one.
                    _ if detail.contains("No CV") => add(&mut out, "warn", format!("{what} is waiting for your CV. Add one in CV & Career."), "#cvs"),
                    "search" | "inbox" => fix(&mut out, "warn", format!("{what} had a problem: {detail}"), "Try again", "run", &kind),
                    _ => add(&mut out, "warn", format!("{what} had a problem: {detail}"), "#overview"),
                }
            }
        }
        out
    }

    // --- the week -------------------------------------------------------------------------------------

    /// The weekly review (Sunday evening, or Monday morning): a short notice, and the whole review
    /// emailed to you when Gmail is connected: what you sent against your goal, who replied, what's
    /// going quiet, what to do this week, and the best new roles to pick.
    pub fn weekly_summary(&self) -> R<String> {
        let profile = self.profile();
        let tz = profile.tz();
        let today = Utc::now().with_timezone(&tz).date_naive();
        let weeks = self.db().applied_per_week(2, today, tz)?;
        // On Sunday, this week so far is the week to review. Any other day (Monday's review, or a
        // Sunday one caught up later), the week before.
        use chrono::Datelike;
        let sunday = self.secret("weekly.day") != "mon" && today.weekday() == chrono::Weekday::Sun;
        let last = if sunday { weeks.last() } else { weeks.first() }.map(|w| w.1).unwrap_or(0);
        let from = (Utc::now() - Duration::days(7)).to_rfc3339();
        let replies: Vec<(String, String)> = {
            let emails = self.db().job_emails()?;
            emails.into_iter()
                .filter(|(_, c, _, at)| at.as_str() >= from.as_str() && !["application_received", "job_alert", "not_job"].contains(&c.as_str()))
                .map(|(id, c, _, _)| (id, c)).collect()
        };
        let upcoming = self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 20)?;
        let ready = self.db().jobs(Some("ready"), 500)?.len();
        let follow = self.follow_ups_due()?.len();
        let soon = self.closing_soon(7)?;
        let quiet = self.quiet_applications()?;
        let goal = if profile.weekly_goal > 0 { format!(" (your goal is {})", profile.weekly_goal) } else { String::new() };
        let span = if sunday { "This week" } else { "Last week" };
        let mut parts = vec![format!("{span} you sent {last} application{}{goal}.", if last == 1 { "" } else { "s" })];
        if !replies.is_empty() {
            parts.push(format!("{} repl{} came in.", replies.len(), if replies.len() == 1 { "y" } else { "ies" }));
        }
        if !upcoming.is_empty() {
            parts.push(format!("{} interview{} coming up.", upcoming.len(), if upcoming.len() == 1 { "" } else { "s" }));
        }
        let mut todo = vec![];
        if ready > 0 {
            todo.push(format!("{ready} ready to approve"));
        }
        if follow > 0 {
            todo.push(format!("{follow} to follow up"));
        }
        if !quiet.is_empty() {
            todo.push(format!("{} quiet for 4+ weeks to close", quiet.len()));
        }
        if !soon.is_empty() {
            todo.push(format!("{} closing this week", soon.len()));
        }
        if !todo.is_empty() {
            parts.push(format!("{}: {}.", if sunday { "Next week" } else { "This week" }, todo.join(", ")));
        }
        let text = parts.join(" ");
        // The best new roles of the week: waiting to be picked, still open, nothing to doubt.
        let reposts = self.db().reposts()?;
        let now = Utc::now();
        let mut picks: Vec<Job> = self.db().jobs(Some("queued"), 2000)?.into_iter()
            .filter(|j| j.found_at.as_str() >= from.as_str() && j.closed_at.is_none())
            .filter(|j| posting_warnings(j, reposts.get(&j.id).copied().unwrap_or(0), now).is_empty())
            .collect();
        picks.sort_by_key(|j| std::cmp::Reverse(j.score.unwrap_or(0)));
        picks.truncate(5);
        // The whole review, for email.
        let job_line = |j: &Job| format!("- {} at {}{}{}", j.title, j.company, j.score.map(|s| format!(" (fit {s})")).unwrap_or_default(),
            if j.url.is_empty() { String::new() } else { format!("\n  {}", j.url) });
        let mut body = vec![format!("Hi {},", profile.name.split_whitespace().next().unwrap_or("there")), String::new(), text.clone()];
        if !picks.is_empty() {
            body.push(format!("\nThe best new roles this week, to pick in Job Hunt:\n{}", picks.iter().map(job_line).collect::<Vec<_>>().join("\n")));
        }
        if !upcoming.is_empty() {
            body.push(format!("\nInterviews coming up:\n{}", upcoming.iter().take(8).map(|i| format!("- {} {}", i.company.clone().unwrap_or_else(|| i.title.clone()),
                chrono::DateTime::parse_from_rfc3339(&i.start).map(|t| t.with_timezone(&tz).format("%a %b %-d, %-I:%M %p").to_string()).unwrap_or_default())).collect::<Vec<_>>().join("\n")));
        }
        if !replies.is_empty() {
            let mut names = vec![];
            for (id, cat) in &replies {
                let job = self.db().job(id)?;
                if let Some(j) = job {
                    let line = format!("- {}: {}", j.company, cat.replace('_', " "));
                    if !names.contains(&line) {
                        names.push(line);
                    }
                }
            }
            body.push(format!("\nWho replied:\n{}", names.join("\n")));
        }
        if !quiet.is_empty() {
            body.push(format!("\nGone quiet (applied 4+ weeks ago, no reply; close them as No response or follow up):\n{}", quiet.iter().take(8).map(|j| format!("- {} at {}", j.title, j.company)).collect::<Vec<_>>().join("\n")));
        }
        if !soon.is_empty() {
            body.push(format!("\nClosing within a week:\n{}", soon.iter().take(8).map(job_line).collect::<Vec<_>>().join("\n")));
        }
        if let Ok(r) = self.results() {
            let best = r["by_title"].as_array().into_iter().flatten()
                .filter(|g| g["sent"].as_u64().unwrap_or(0) >= 3 && g["interviews"].as_u64().unwrap_or(0) > 0)
                .max_by(|a, b| {
                    let rate = |g: &Value| g["interviews"].as_f64().unwrap_or(0.0) / g["sent"].as_f64().unwrap_or(1.0);
                    rate(a).total_cmp(&rate(b))
                });
            if let Some(g) = best {
                body.push(format!("\nWhat's working: {} roles turn into interviews most often ({} of {} sent).", g["name"].as_str().unwrap_or(""), g["interviews"], g["sent"]));
            }
        }
        body.push("\nJob Hunt".into());
        let db = self.db();
        db.set("last.weekly", &now.to_rfc3339())?;
        db.log(None, "weekly", &text)?;
        drop(db);
        self.note("Your week in Job Hunt", &text);
        let to = self.weekly_to();
        let mail = self.mail.read().unwrap().clone();
        if let (Some(m), false) = (mail, to.is_empty()) {
            let subject = format!("Your week in Job Hunt: {last} sent, {} repl{}", replies.len(), if replies.len() == 1 { "y" } else { "ies" });
            if let Err(e) = m.send(&to, &subject, &body.join("\n"), &[]) {
                self.db().log(None, "weekly:error", &format!("couldn't email the review: {}", e.0))?;
            }
        }
        Ok(text)
    }

    /// The last seven days in a few plain sentences, against the seven before: what you sent, what
    /// came back, what Job Hunt found, and the one thing most worth doing next.
    pub fn week_in_words(&self) -> R<Vec<String>> {
        let profile = self.profile();
        let now = Utc::now();
        let (week, before) = ((now - Duration::days(7)).to_rfc3339(), (now - Duration::days(14)).to_rfc3339());
        let (jobs, emails) = {
            let db = self.db();
            (db.jobs(None, 1_000_000)?, db.job_emails()?)
        };
        let plural = |n: usize, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
        let sent = |from: &str, to: &str| jobs.iter().filter(|j| j.applied_at.as_deref().is_some_and(|a| a >= from && a < to)).count();
        let (now_s, this, last) = (now.to_rfc3339(), sent(&week, "~"), sent(&before, &week));
        let mut out = vec![];
        let change = match this.cmp(&last) {
            _ if last == 0 && this == 0 => String::new(),
            std::cmp::Ordering::Greater => format!(", {} more than the week before", this - last),
            std::cmp::Ordering::Less => format!(", {} fewer than the week before", last - this),
            std::cmp::Ordering::Equal => ", the same as the week before".into(),
        };
        let goal = profile.weekly_goal as usize;
        out.push(match (this, goal) {
            (0, 0) => "You didn't send any applications this week.".into(),
            (0, g) => format!("You didn't send any applications this week; your goal is {g}."),
            (n, g) if g > 0 && n >= g => format!("You sent {}{change}: your goal of {g} is met.", plural(n, "application", "applications")),
            (n, g) if g > 0 => format!("You sent {}{change}, {} short of your goal of {g}.", plural(n, "application", "applications"), g - n),
            (n, _) => format!("You sent {}{change}.", plural(n, "application", "applications")),
        });
        // Who wrote back, by what they said.
        let company = |id: &str| jobs.iter().find(|j| j.id == id).map(|j| j.company.clone()).unwrap_or_default();
        let said = |c: &str| match c {
            "interview_request" | "interview_confirmed" => "an interview",
            "rejection" => "a no",
            "offer" => "an offer",
            _ => "a reply",
        };
        let mut back: Vec<(String, &str)> = vec![];
        for (id, c, _, at) in &emails {
            if at.as_str() >= week.as_str() && at.as_str() <= now_s.as_str() && !["application_received", "job_alert", "not_job"].contains(&c.as_str()) {
                let co = company(id);
                if !co.is_empty() && !back.iter().any(|(b, _)| *b == co) {
                    back.push((co, said(c)));
                }
            }
        }
        if back.is_empty() {
            out.push(if this + last > 0 { "No company wrote back this week. That's normal: most replies come one to three weeks after you apply.".into() } else { "No replies this week.".into() });
        } else {
            let list: Vec<String> = back.iter().take(4).map(|(co, what)| format!("{what} from {co}")).collect();
            let more = if back.len() > 4 { format!(" and {} more", back.len() - 4) } else { String::new() };
            out.push(format!("{} wrote back: {}{more}.", plural(back.len(), "company", "companies"), list.join(", ")));
        }
        let found: Vec<&Job> = jobs.iter().filter(|j| j.found_at.as_str() >= week.as_str()).collect();
        let good = found.iter().filter(|j| j.status != "skipped").count();
        if !found.is_empty() {
            out.push(format!("Job Hunt found {}; {} cleared your fit bar.", plural(found.len(), "new posting", "new postings"), if good == 0 { "none".to_string() } else { good.to_string() }));
        }
        // How it's going overall, once there's enough to say.
        let ever = jobs.iter().filter(|j| j.applied_at.is_some()).count();
        let replied: HashSet<&str> = emails.iter().filter(|(_, c, _, _)| !["application_received", "job_alert", "not_job"].contains(&c.as_str())).map(|(id, _, _, _)| id.as_str()).collect();
        let answered = jobs.iter().filter(|j| j.applied_at.is_some() && replied.contains(j.id.as_str())).count();
        if ever >= 5 {
            let pct = answered * 100 / ever;
            let read = if pct >= 20 { "a good rate" } else if pct >= 8 { "about usual" } else { "on the low side: tailoring each CV and applying within a few days of the posting helps most" };
            out.push(format!("So far {answered} of your {ever} applications got a reply ({pct}%), {read}."));
        }
        // The one thing most worth doing next.
        let count = |s: &str| jobs.iter().filter(|j| j.status == s).count();
        let (ready, queued, approved) = (count("ready"), count("queued"), count("approved"));
        let next = if ready > 0 {
            format!("Next: {} ready to approve. That's the quickest step.", plural(ready, "application is", "applications are"))
        } else if approved > 0 {
            format!("Next: {} approved and waiting to be submitted on the company's site.", plural(approved, "application is", "applications are"))
        } else if queued > 0 {
            format!("Next: pick a few of the {} waiting to be tailored.", plural(queued, "match", "matches"))
        } else {
            String::new()
        };
        if !next.is_empty() {
            out.push(next);
        }
        Ok(out)
    }

    /// Where the weekly review is emailed: your address in your profile, else your Gmail address.
    /// Empty when it isn't emailed (turned off, or Gmail isn't connected).
    pub fn weekly_to(&self) -> String {
        if self.secret("weekly.email") == "0" || self.mail.read().unwrap().is_none() {
            return String::new();
        }
        let to = Some(self.profile().email.trim().to_string()).filter(|e| e.contains('@')).unwrap_or_else(|| self.secret("google.email"));
        if to.contains('@') { to } else { String::new() }
    }

    // --- a spreadsheet copy -------------------------------------------------------------------

    /// Your applications as a CSV spreadsheet (everything except postings skipped or turned down).
    pub fn export_csv(&self) -> R<String> {
        let profile = self.profile();
        let tz = profile.tz();
        let jobs = self.db().jobs(None, 1_000_000)?;
        let day = |iso: &Option<String>| iso.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&tz).format("%Y-%m-%d").to_string()).unwrap_or_default();
        let mut out = String::from("\u{feff}");
        out.push_str("Company,Job title,Stage,Fit,Salary,Location,Source,Found,Applied,Closed,Posting,CV,Notes\r\n");
        for j in jobs.iter().filter(|j| !["skipped", "dismissed"].contains(&j.status.as_str())) {
            let stage = match j.status.as_str() {
                "queued" => "Waiting to tailor",
                "ready" => "Ready to approve",
                "approved" => "Approved",
                "applied" => "Applied",
                "interviewing" => "Interviewing",
                "offer" => "Offer",
                "rejected" => "Rejected",
                "no_response" => "No response",
                "saved" => "Saved for later",
                other => other,
            };
            let cv = profile.tracks.iter().find(|t| Some(&t.name) == j.track.as_ref()).map(|t| t.label.clone()).unwrap_or_default();
            let row = [
                j.company.clone(), j.title.clone(), stage.to_string(), j.score.map(|s| s.to_string()).unwrap_or_default(),
                j.salary.clone().unwrap_or_default(), j.location.clone(), j.source.clone(), day(&Some(j.found_at.clone())), day(&j.applied_at),
                day(&j.closed_at), j.url.clone(), cv, j.notes.clone(),
            ];
            out.push_str(&row.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(","));
            out.push_str("\r\n");
        }
        Ok(out)
    }

    // --- what works -----------------------------------------------------------------------------

    /// How applications turn out, overall and by CV, source and fit score.
    pub fn results(&self) -> R<Value> {
        self.results_for(None)
    }

    /// Results over the last `days` (jobs found or applied to since then), or over everything.
    pub fn results_for(&self, days: Option<i64>) -> R<Value> {
        let profile = self.profile();
        let (mut jobs, emails, stages) = {
            let db = self.db();
            (db.jobs(None, 1_000_000)?, db.job_emails()?, db.stages_reached()?)
        };
        // Applications a day over the period (the last 90 days for everything).
        let span = days.unwrap_or(90).clamp(1, 365);
        let tz = profile.tz();
        let today = Utc::now().with_timezone(&tz).date_naive();
        let mut per_day: Vec<(String, u64)> = (0..span).rev().map(|d| ((today - Duration::days(d)).to_string(), 0)).collect();
        for j in &jobs {
            if let Some(d) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()).map(|t| t.with_timezone(&tz).date_naive().to_string()) {
                if let Some(x) = per_day.iter_mut().find(|x| x.0 == d) {
                    x.1 += 1;
                }
            }
        }
        if let Some(d) = days {
            let since = (Utc::now() - Duration::days(d)).to_rfc3339();
            jobs.retain(|j| j.found_at.as_str() >= since.as_str() || j.applied_at.as_deref().is_some_and(|a| a >= since.as_str()));
        }
        let mut reached: std::collections::HashMap<&str, HashSet<&str>> = std::collections::HashMap::new();
        for (id, st) in &stages {
            reached.entry(id.as_str()).or_default().insert(st.as_str());
        }
        let mut mail: std::collections::HashMap<&str, Vec<(&str, &str)>> = std::collections::HashMap::new();
        for (id, cat, _, at) in &emails {
            mail.entry(id.as_str()).or_default().push((cat.as_str(), at.as_str()));
        }
        #[derive(Default, Clone)]
        struct Row {
            sent: u64,
            replied: u64,
            interviews: u64,
            offers: u64,
        }
        let mut groups: Vec<BTreeMap<String, Row>> = vec![BTreeMap::new(); 5];
        let mut total = Row::default();
        let (mut scored, mut tailored) = (0, 0);
        let mut waits: Vec<i64> = vec![];
        for j in &jobs {
            scored += j.score.is_some() as u64;
            tailored += j.cv_path.is_some() as u64;
            let been = |s: &str| j.status == s || reached.get(j.id.as_str()).is_some_and(|r| r.contains(s));
            let sent = j.applied_at.is_some() || ["applied", "interviewing", "offer", "rejected"].iter().any(|s| been(s));
            if !sent {
                continue;
            }
            let their: Vec<&(&str, &str)> = mail.get(j.id.as_str()).map(|m| m.iter().filter(|(c, _)| !["application_received", "job_alert", "not_job"].contains(c)).collect()).unwrap_or_default();
            let interview = been("interviewing") || been("offer") || their.iter().any(|(c, _)| c.starts_with("interview") || *c == "assessment");
            let row = Row {
                sent: 1,
                replied: (interview || been("rejected") || been("offer") || !their.is_empty()) as u64,
                interviews: interview as u64,
                offers: been("offer") as u64,
            };
            if let (Some(a), Some((_, first))) = (j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()), their.first()) {
                if let Ok(f) = chrono::DateTime::parse_from_rfc3339(first) {
                    waits.push((f - a).num_days().max(0));
                }
            }
            let cv = profile.tracks.iter().find(|t| Some(&t.name) == j.track.as_ref()).map(|t| t.label.clone()).or(j.track.clone()).unwrap_or_else(|| "Unknown".into());
            let fit = match j.score {
                Some(s) if s >= 90 => "90–100",
                Some(s) if s >= 80 => "80–89",
                Some(s) if s >= 70 => "70–79",
                Some(s) if s >= 60 => "60–69",
                Some(_) => "Below 60",
                None => "Not scored",
            };
            for (g, key) in groups.iter_mut().zip([cv, j.source.clone(), fit.to_string(), title_family(&j.title, &profile), pay_band(j).to_string()]) {
                let r = g.entry(key).or_default();
                r.sent += row.sent;
                r.replied += row.replied;
                r.interviews += row.interviews;
                r.offers += row.offers;
            }
            total.sent += row.sent;
            total.replied += row.replied;
            total.interviews += row.interviews;
            total.offers += row.offers;
        }
        let rows = |g: &BTreeMap<String, Row>| {
            let mut v: Vec<Value> = g.iter().map(|(k, r)| json!({ "name": k, "sent": r.sent, "replied": r.replied, "interviews": r.interviews, "offers": r.offers })).collect();
            v.sort_by_key(|x| std::cmp::Reverse(x["sent"].as_u64().unwrap_or(0)));
            v
        };
        waits.sort();
        let mut by_fit = rows(&groups[2]);
        let order = ["90–100", "80–89", "70–79", "60–69", "Below 60", "Not scored"];
        by_fit.sort_by_key(|x| order.iter().position(|o| x["name"] == *o).unwrap_or(9));
        let mut by_pay = rows(&groups[4]);
        by_pay.sort_by_key(|x| PAY_BANDS.iter().position(|o| x["name"] == *o).unwrap_or(9));
        // What the roles you're finding pay, by kind of role: every posting that states it.
        let mut stated: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        for j in jobs.iter().filter(|j| j.score.is_some()) {
            if let Some(mid) = pay_mid(j) {
                stated.entry(title_family(&j.title, &profile)).or_default().push(mid);
            }
        }
        let market: Vec<Value> = stated.into_iter().filter(|(_, v)| v.len() >= 2).map(|(k, mut v)| {
            v.sort_by(|a, b| a.total_cmp(b));
            json!({ "name": k, "postings": v.len(), "median": v[v.len() / 2], "low": v[0], "high": v[v.len() - 1] })
        }).collect();
        // Pay across the roles you tailored: the stated yearly ranges, against your minimum.
        let mut pay: Vec<(f64, f64, &Job)> = jobs.iter()
            .filter(|j| j.cv_path.is_some() && j.status != "dismissed")
            .filter_map(|j| {
                let text = j.salary.clone().or_else(|| crate::sources::salary_from_text(&j.description).map(|s| s.0))?;
                crate::sources::salary_range(&text).map(|(lo, hi)| (lo, hi, j))
            })
            .collect();
        pay.sort_by(|a, b| (a.0 + a.1).total_cmp(&(b.0 + b.1)));
        let tailored_n = jobs.iter().filter(|j| j.cv_path.is_some() && j.status != "dismissed").count();
        let mid = |x: &(f64, f64, &Job)| (x.0 + x.1) / 2.0;
        let pay_json = if pay.is_empty() {
            json!({ "tailored": tailored_n, "stated": 0, "minimum": profile.min_salary })
        } else {
            json!({
                "tailored": tailored_n,
                "stated": pay.len(),
                "low": pay.iter().map(|x| x.0).fold(f64::MAX, f64::min),
                "high": pay.iter().map(|x| x.1).fold(0.0, f64::max),
                "median": mid(&pay[pay.len() / 2]),
                "minimum": profile.min_salary,
                "below_minimum": profile.min_salary.map(|m| pay.iter().filter(|x| x.1 < m).count()),
                "roles": pay.iter().rev().take(8).map(|(lo, hi, j)| json!({ "id": j.id, "title": j.title, "company": j.company, "low": lo, "high": hi, "status": j.status })).collect::<Vec<_>>(),
            })
        };
        Ok(json!({
            "pay": pay_json,
            "days": days,
            "per_day": per_day.iter().map(|(d, n)| json!({ "day": d, "sent": n })).collect::<Vec<_>>(),
            "funnel": { "found": jobs.len(), "scored": scored, "tailored": tailored, "sent": total.sent, "replied": total.replied, "interviews": total.interviews, "offers": total.offers },
            "days_to_reply": waits.get(waits.len() / 2),
            "by_cv": rows(&groups[0]),
            "by_source": rows(&groups[1]),
            "by_fit": by_fit,
            "by_title": rows(&groups[3]),
            "by_pay": by_pay,
            "market_pay": market,
            "insights": serde_json::from_str::<Value>(&self.secret("insights")).ok(),
            "career": serde_json::from_str::<Value>(&self.secret("career")).ok(),
        }))
    }
}
