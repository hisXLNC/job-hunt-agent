//! How much of your Claude plan Job Hunt uses: every request counted by what it was for, with
//! tokens, time and (through Claude Code) its API-equivalent cost, and when a usage limit was hit
//! and resets.

use crate::claude::{Answer, BoardIdea, FieldValue, RecruiterIdea, CvProfile, CvSource, EmailIn, FollowUp, FoundJob, JobScore, Llm, ParagraphEdit, StructuredCv, Tailored, TimeSlot, Triage};
use crate::db::Job;
use crate::R;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Requests of one kind.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Usage {
    pub calls: u64,
    pub errors: u64,
    pub input: u64,
    pub output: u64,
    /// What it would cost through the API, in US dollars, as Claude Code reports it.
    pub cost: f64,
    pub secs: f64,
}

impl Usage {
    fn add(&mut self, o: &Usage) {
        self.calls += o.calls;
        self.errors += o.errors;
        self.input += o.input;
        self.output += o.output;
        self.cost += o.cost;
        self.secs += o.secs;
    }
}

thread_local! {
    /// Tokens and cost reported by the engine for the request this thread is making.
    static LAST: RefCell<Usage> = RefCell::default();
    /// When a usage limit this thread hit resets (Unix seconds), as Claude Code reports it.
    static LIMIT: RefCell<Option<i64>> = const { RefCell::new(None) };
}

/// Called by the engines with what a request used.
pub fn report(input: u64, output: u64, cost: f64) {
    LAST.with(|l| {
        let mut l = l.borrow_mut();
        l.input += input;
        l.output += output;
        l.cost += cost;
    });
}

/// Called by Claude Code's output parser when a usage limit was hit, with its reset time if given.
pub fn report_limit(resets: Option<i64>) {
    LIMIT.with(|l| *l.borrow_mut() = Some(resets.unwrap_or(0)));
}

fn take() -> (Usage, Option<i64>) {
    (LAST.with(|l| std::mem::take(&mut *l.borrow_mut())), LIMIT.with(|l| l.borrow_mut().take()))
}

/// The usage kept between runs: per day (YYYY-MM-DD, UTC) and kind; each request's time for the
/// last day; and the usage limit, while it lasts.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Log {
    pub days: BTreeMap<String, BTreeMap<String, Usage>>,
    /// (Unix seconds, kind) of each request in the last 24 hours.
    pub recent: Vec<(i64, String)>,
    /// Unix seconds when the usage limit that was hit resets.
    pub limited_until: Option<i64>,
    #[serde(skip)]
    pub dirty: bool,
}

impl Log {
    pub fn record(&mut self, kind: &str, u: &Usage, now: DateTime<Utc>) {
        // Days as this computer counts them, so "today" starts at your midnight.
        let day = now.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string();
        self.days.entry(day).or_default().entry(kind.to_string()).or_default().add(u);
        while self.days.len() > 35 {
            let first = self.days.keys().next().cloned().unwrap_or_default();
            self.days.remove(&first);
        }
        let ts = now.timestamp();
        self.recent.retain(|(t, _)| *t > ts - 86_400);
        self.recent.push((ts, kind.to_string()));
        self.dirty = true;
    }

    /// When the usage limit resets, if it's in force now.
    pub fn limited(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.limited_until.filter(|t| *t > now.timestamp()).and_then(|t| DateTime::from_timestamp(t, 0))
    }

    /// The summary for Settings: the last 5 hours, today, the last 7 and 30 days, by kind.
    pub fn summary(&self, now: DateTime<Utc>) -> serde_json::Value {
        let ts = now.timestamp();
        let five = self.recent.iter().filter(|(t, _)| *t > ts - 5 * 3600).count();
        let since = |days: i64| {
            let from = (now - Duration::days(days - 1)).with_timezone(&chrono::Local).format("%Y-%m-%d").to_string();
            let mut all = Usage::default();
            let mut by: BTreeMap<String, Usage> = BTreeMap::new();
            for (_, kinds) in self.days.range(from..) {
                for (k, u) in kinds {
                    all.add(u);
                    by.entry(k.clone()).or_default().add(u);
                }
            }
            let mut kinds: Vec<serde_json::Value> = by.into_iter().map(|(k, u)| serde_json::json!({ "kind": k, "usage": u })).collect();
            kinds.sort_by_key(|k| std::cmp::Reverse(k["usage"]["calls"].as_u64().unwrap_or(0)));
            serde_json::json!({ "total": all, "kinds": kinds })
        };
        let per_day: Vec<serde_json::Value> = (0..14).rev().map(|d| {
            let day = (now - Duration::days(d)).with_timezone(&chrono::Local).format("%Y-%m-%d").to_string();
            let calls: u64 = self.days.get(&day).map(|k| k.values().map(|u| u.calls).sum()).unwrap_or(0);
            serde_json::json!({ "day": day, "calls": calls })
        }).collect();
        serde_json::json!({
            "last_5h": five,
            "today": since(1),
            "week": since(7),
            "month": since(30),
            "per_day": per_day,
            "limited_until": self.limited(now).map(|t| t.to_rfc3339()),
        })
    }
}

/// An engine that counts what it uses into a `Log`.
pub struct Metered {
    pub inner: Arc<dyn Llm>,
    pub log: Arc<Mutex<Log>>,
}

impl Metered {
    fn run<T>(&self, kind: &str, f: impl FnOnce(&dyn Llm) -> R<T>) -> R<T> {
        take(); // nothing left over from before
        let start = Instant::now();
        let out = f(self.inner.as_ref());
        let (mut u, limit) = take();
        u.calls = 1;
        u.errors = out.is_err() as u64;
        u.secs = start.elapsed().as_secs_f64();
        let now = Utc::now();
        let mut log = self.log.lock().unwrap();
        log.record(kind, &u, now);
        let limited = limit.is_some() || out.as_ref().err().is_some_and(|e| e.0.contains("usage limit"));
        if limited {
            // Claude Code says when it resets; otherwise try again in an hour.
            let resets = limit.filter(|t| *t > now.timestamp()).unwrap_or(now.timestamp() + 3600);
            log.limited_until = Some(resets);
        }
        out
    }
}

impl Llm for Metered {
    fn score(&self, cvs: &[(String, String)], guidance: &str, job: &Job) -> R<JobScore> {
        self.run("score", |l| l.score(cvs, guidance, job))
    }
    fn cv_profile(&self, cv_text: &str) -> R<CvProfile> {
        self.run("cv", |l| l.cv_profile(cv_text))
    }
    fn convert_cv(&self, cv: &CvSource) -> R<StructuredCv> {
        self.run("cv", |l| l.convert_cv(cv))
    }
    fn tailor(&self, candidate: &str, numbered_cv: &str, job: &Job, keywords: &[String], stories: &str, style: &str) -> R<Tailored> {
        self.run("tailor", |l| l.tailor(candidate, numbered_cv, job, keywords, stories, style))
    }
    fn triage(&self, candidate: &str, tz: &str, email: &EmailIn, applications: &[(String, String, String, String)]) -> R<Triage> {
        self.run("email", |l| l.triage(candidate, tz, email, applications))
    }
    fn scheduling_reply(&self, candidate: &str, tz: &str, email: &EmailIn, accept: Option<&TimeSlot>, free: &[TimeSlot]) -> R<String> {
        self.run("email", |l| l.scheduling_reply(candidate, tz, email, accept, free))
    }
    fn indeed(&self, searches: &[(String, String)], country: &str, details: usize) -> R<Vec<FoundJob>> {
        self.run("indeed", |l| l.indeed(searches, country, details))
    }
    fn pick_titles(&self, targets: &str, titles: &[String]) -> R<Vec<usize>> {
        self.run("titles", |l| l.pick_titles(targets, titles))
    }
    fn alert_jobs(&self, email: &EmailIn) -> R<Vec<FoundJob>> {
        self.run("alerts", |l| l.alert_jobs(email))
    }
    fn suggest_boards(&self, targets: &str, places: &str) -> R<Vec<BoardIdea>> {
        self.run("employers", |l| l.suggest_boards(targets, places))
    }
    fn interview_prep(&self, candidate: &str, cv: &str, job: &Job) -> R<String> {
        self.run("prep", |l| l.interview_prep(candidate, cv, job))
    }
    fn revise_cv(&self, candidate: &str, numbered_cv: &str, job: &Job, note: &str) -> R<Vec<ParagraphEdit>> {
        self.run("revise", |l| l.revise_cv(candidate, numbered_cv, job, note))
    }
    fn revise_letter(&self, candidate: &str, cv: &str, letter: &str, job: &Job, note: &str, stories: &str) -> R<String> {
        self.run("revise", |l| l.revise_letter(candidate, cv, letter, job, note, stories))
    }
    fn answer_questions(&self, candidate: &str, cv: &str, job: &Job, questions: &str, facts: &str, stories: &str) -> R<Vec<Answer>> {
        self.run("answers", |l| l.answer_questions(candidate, cv, job, questions, facts, stories))
    }
    fn recruiters(&self, candidate: &str, senders: &str) -> R<Vec<RecruiterIdea>> {
        self.run("recruiters", |l| l.recruiters(candidate, senders))
    }
    fn fill_form(&self, candidate: &str, cv: &str, job: &Job, fields: &str, facts: &str, stories: &str) -> R<Vec<FieldValue>> {
        self.run("fill", |l| l.fill_form(candidate, cv, job, fields, facts, stories))
    }
    fn offer_advice(&self, candidate: &str, job: &Job, offer: &str, context: &str) -> R<String> {
        self.run("offer", |l| l.offer_advice(candidate, job, offer, context))
    }
    fn outreach(&self, candidate: &str, cv: &str, job: &Job, contact: &str) -> R<String> {
        self.run("outreach", |l| l.outreach(candidate, cv, job, contact))
    }
    fn chat(&self, candidate: &str, cv: &str, job: &Job, notes: &str, history: &[(String, String)], message: &str) -> R<String> {
        self.run("chat", |l| l.chat(candidate, cv, job, notes, history, message))
    }
    fn insights(&self, candidate: &str, results: &str, applications: &str) -> R<String> {
        self.run("insights", |l| l.insights(candidate, results, applications))
    }
    fn thank_you(&self, candidate: &str, job: &Job, interview: &str) -> R<FollowUp> {
        self.run("thanks", |l| l.thank_you(candidate, job, interview))
    }
    fn coach(&self, candidate: &str, cvs: &str, evidence: &str) -> R<crate::claude::CoachPlan> {
        self.run("coach", |l| l.coach(candidate, cvs, evidence))
    }
    fn career_paths(&self, candidate: &str, cvs: &str, evidence: &str) -> R<crate::claude::CareerPlan> {
        self.run("career", |l| l.career_paths(candidate, cvs, evidence))
    }
    fn read_posting(&self, url: &str, page: &str) -> R<FoundJob> {
        self.run("postings", |l| l.read_posting(url, page))
    }
    fn follow_up(&self, candidate: &str, job: &Job, applied_on: &str) -> R<FollowUp> {
        self.run("followup", |l| l.follow_up(candidate, job, applied_on))
    }
    fn company_rating(&self, company: &str, location: &str) -> R<crate::claude::CompanyRating> {
        self.run("ratings", |l| l.company_rating(company, location))
    }
    fn company_apply(&self, job: &Job) -> R<Option<String>> {
        self.run("apply-link", |l| l.company_apply(job))
    }
    fn shorten_reasons(&self, reasons: &[String]) -> R<Vec<String>> {
        self.run("reasons", |l| l.shorten_reasons(reasons))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Error;

    struct Fake;
    impl Llm for Fake {
        fn score(&self, _c: &[(String, String)], _g: &str, _j: &Job) -> R<JobScore> {
            report(1200, 300, 0.02);
            Ok(JobScore { score: 80, track: "t".into(), reasoning: String::new(), red_flags: vec![], keywords: vec![], deadline: String::new(), potential: None })
        }
        fn cv_profile(&self, _t: &str) -> R<CvProfile> {
            report_limit(Some(Utc::now().timestamp() + 7200));
            Err(Error("Your Claude usage limit is reached for now.".into()))
        }
        fn convert_cv(&self, _c: &CvSource) -> R<StructuredCv> {
            unimplemented!()
        }
        fn tailor(&self, _a: &str, _b: &str, _j: &Job, _k: &[String], _s: &str, _t: &str) -> R<Tailored> {
            unimplemented!()
        }
        fn triage(&self, _a: &str, _b: &str, _e: &EmailIn, _x: &[(String, String, String, String)]) -> R<Triage> {
            unimplemented!()
        }
        fn scheduling_reply(&self, _a: &str, _b: &str, _e: &EmailIn, _t: Option<&TimeSlot>, _f: &[TimeSlot]) -> R<String> {
            unimplemented!()
        }
    }

    #[test]
    fn counts_requests_and_limits() {
        let log = Arc::new(Mutex::new(Log::default()));
        let m = Metered { inner: Arc::new(Fake), log: log.clone() };
        m.score(&[], "", &Job::default()).unwrap();
        m.score(&[], "", &Job::default()).unwrap();
        let s = log.lock().unwrap().summary(Utc::now());
        assert_eq!(s["last_5h"], 2);
        assert_eq!(s["today"]["kinds"][0]["kind"], "score");
        assert_eq!(s["today"]["total"]["input"], 2400);
        assert!(s["limited_until"].is_null());
        assert!(m.cv_profile("").is_err());
        let l = log.lock().unwrap();
        let until = l.limited(Utc::now()).unwrap();
        assert!(until > Utc::now() + Duration::minutes(100), "the reset Claude Code gave");
        assert_eq!(l.summary(Utc::now())["today"]["total"]["errors"], 1);
        // Old days are dropped.
        let mut old = Log::default();
        for d in (0..40).rev() {
            old.record("score", &Usage { calls: 1, ..Usage::default() }, Utc::now() - Duration::days(d));
        }
        assert_eq!(old.days.len(), 35);
        assert_eq!(old.recent.len(), 1);
        assert_eq!(old.summary(Utc::now())["week"]["total"]["calls"], 7);
    }
}
