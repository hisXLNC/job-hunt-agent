//! A job's lifecycle, in one place: its stages, the moves between them that make sense, what is
//! next at each stage, and the state of the background work on it.
//!
//! Every stage write goes through `Db::update_job`, which calls `watch`. For now a move the table
//! doesn't expect is only noted (see `unexpected`), never refused: the table has to match a few
//! weeks of real use before anything is turned away.

use crate::db::{Job, STATUSES};
use crate::pipeline::Agent;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

/// From each stage, the stages a job is expected to move to.
pub const MOVES: [(&str, &[&str]); 11] = [
    ("queued", &["ready", "approved", "applied", "saved", "skipped", "dismissed"]),
    // From email, a reply can arrive for one you never marked applied; removing a CV re-scores it.
    ("ready", &["approved", "applied", "interviewing", "rejected", "queued", "saved", "skipped", "dismissed"]),
    ("approved", &["applied", "ready", "interviewing", "rejected", "saved", "dismissed"]),
    ("applied", &["interviewing", "offer", "rejected", "no_response", "approved"]),
    ("interviewing", &["offer", "rejected", "no_response", "applied"]),
    ("offer", &["interviewing", "rejected", "applied"]),
    ("rejected", &["applied", "interviewing", "offer"]),
    ("skipped", &["queued", "ready", "applied", "saved", "dismissed"]),
    ("dismissed", &["queued", "ready", "applied", "saved"]),
    ("saved", &["queued", "ready", "approved", "applied", "skipped", "dismissed"]),
    ("no_response", &["applied", "interviewing", "offer", "rejected"]),
];

/// The stages a job at `from` is expected to move to.
pub fn allowed(from: &str) -> &'static [&'static str] {
    MOVES.iter().find(|m| m.0 == from).map(|m| m.1).unwrap_or(&[])
}

/// Is this move in the table? Staying where it is always is.
pub fn expected(from: &str, to: &str) -> bool {
    from == to || allowed(from).contains(&to)
}

/// A stage's name as the screens say it.
pub fn label(stage: &str) -> &'static str {
    match stage {
        "queued" => "To pick",
        "ready" => "Ready to approve",
        "approved" => "To submit",
        "applied" => "Applied",
        "interviewing" => "Interviewing",
        "offer" => "Offer",
        "rejected" => "Rejected",
        "skipped" => "Set aside",
        "dismissed" => "Not interested",
        "saved" => "Saved",
        "no_response" => "No response",
        _ => "",
    }
}

// --- watching ---------------------------------------------------------------------------------

static UNEXPECTED: Mutex<Vec<Value>> = Mutex::new(Vec::new());

/// A stage write, as it happens. A move the table doesn't expect is kept (the last 50) and
/// written to the log; nothing is refused.
pub fn watch(job_id: &str, from: &str, to: &str) {
    if expected(from, to) && STATUSES.contains(&to) {
        return;
    }
    crate::debug::always("lifecycle", &format!("unexpected move {from} -> {to} ({job_id})"));
    let mut u = UNEXPECTED.lock().unwrap_or_else(|e| e.into_inner());
    u.push(json!({ "job": job_id, "from": from, "to": to, "at": crate::util::now() }));
    let extra = u.len().saturating_sub(50);
    u.drain(..extra);
}

/// The moves seen since the app started that the table doesn't expect, oldest first.
pub fn unexpected() -> Vec<Value> {
    UNEXPECTED.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

// --- background work --------------------------------------------------------------------------

/// The kinds of background work on one job, with the name each goes by on the job's page.
pub const WORK: [(&str, &str); 11] = [
    ("tailor", "tailoring"), ("revise", "revising"), ("prep", "preparing"), ("contact", "writing_to"),
    ("answers", "answering"), ("followup", "following_up"), ("thanks", "thanking"), ("review", "reviewing"),
    ("decline", "declining"), ("offer", "advising"), ("apply-link", "finding"),
];

static FAILED: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);

/// The work an error event belongs to: "prep:error" is prep, "recruiter:error" is contact.
fn work_of(kind: &str) -> Option<&'static str> {
    let k = kind.strip_suffix(":error")?;
    let k = if k == "recruiter" { "contact" } else { k };
    WORK.iter().find(|w| w.0 == k).map(|w| w.0)
}

/// An error event on a job: that piece of work failed, and why. Kept until it is started again
/// (or the app closes).
pub fn failed(job_id: &str, kind: &str, why: &str) {
    if let Some(w) = work_of(kind) {
        FAILED.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(format!("{w}:{job_id}"), (why.to_string(), crate::util::now()));
    }
}

/// Work starting ("tailor:<job id>"): its last failure no longer stands.
pub fn started(name: &str) {
    if let Some(m) = FAILED.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        m.remove(name);
    }
}

/// The state of each piece of background work on a job that is running or failed:
/// `{ "tailor": { "state": "running" }, "prep": { "state": "failed", "why": "…", "at": "…" } }`.
pub fn work(agent: &Agent, job_id: &str) -> Value {
    let failed = FAILED.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = serde_json::Map::new();
    for (w, _) in WORK {
        let name = format!("{w}:{job_id}");
        if agent.is_running(&name) {
            out.insert(w.to_string(), json!({ "state": "running" }));
        } else if let Some((why, at)) = failed.as_ref().and_then(|m| m.get(&name)) {
            out.insert(w.to_string(), json!({ "state": "failed", "why": why, "at": at }));
        }
    }
    Value::Object(out)
}

// --- what's next ------------------------------------------------------------------------------

fn action(act: &str, label: &str, short: &str, primary: bool) -> Value {
    json!({ "act": act, "label": label, "short": short, "primary": primary })
}

fn stage_action(to: &str, label: &str, primary: bool) -> Value {
    json!({ "act": "stage", "to": to, "label": label, "short": label, "primary": primary })
}

/// What happens next for a job: a sentence (`text` for its own page, `short` for a row in a list),
/// whose move it is ("you", "them", "later", "done" or "job_hunt"), and the actions that take it
/// there, the main one first; `quiet` ones are the ways out (save it, not interested). `tracked` is
/// the job's row from `Agent::tracker` (applied and after), `tailoring` whether its CV is being
/// tailored now, `can_fill` whether Job Hunt can fill the form in a browser on this computer.
pub fn next(job: &Job, tracked: Option<&Value>, tailoring: bool, can_fill: bool) -> Value {
    let t = |k: &str| tracked.and_then(|r| r[k].as_str()).unwrap_or("").to_string();
    let company = job.apply_url.as_deref().is_some_and(|u| !u.is_empty());
    let by_email = job.apply_email.as_deref().is_some_and(|e| !e.is_empty());
    let fills = can_fill && !job.url.is_empty();
    let s = |a: &str, b: &str| (a.to_string(), b.to_string());
    let ((text, short), who, mut actions): ((String, String), &str, Vec<Value>) = if tailoring {
        (s("Job Hunt is tailoring your CV and cover letter.", "Tailoring now"), "job_hunt", vec![])
    } else {
        match job.status.as_str() {
            "queued" => (s("Read the posting and why it fits. Worth applying to? Job Hunt tailors your CV and writes a cover letter.", "Pick it to tailor"), "you",
                vec![action("tailor", "Tailor my CV for this role", "Tailor", true)]),
            "ready" => (s("Read your tailored CV and cover letter, change what you like, then approve.", "Check and approve the tailored CV and letter"), "you",
                vec![action("approve", if by_email { "Approve and send" } else { "Approve and apply" }, "Approve", true)]),
            "approved" => {
                let mut a = vec![];
                if fills {
                    a.push(action("fill", "Fill it in my browser", "Apply", true));
                } else if company || !job.url.is_empty() {
                    let mut o = action("open", "Open the application", "Open", true);
                    o["what"] = json!(if company { "company" } else { "posting" });
                    a.push(o);
                }
                a.push(stage_action("applied", "Mark applied", false));
                (s(if fills { "Submit it on the company's site. Job Hunt fills in the form in your browser; you check it and press Submit." }
                    else { "Submit it on the company's site. Your files are under CV & letter, and every detail a form asks for, ready to copy, is under Questions & contacts." },
                    "Submit it on the company's site, then mark it applied"), "you", a)
            }
            "saved" => {
                let mut a = vec![stage_action(if job.cv_path.is_some() { "ready" } else { "queued" }, "Bring it back", true)];
                if job.cv_path.is_none() {
                    a.push(action("tailor_anyway", "Tailor anyway", "Tailor anyway", false));
                }
                (s("Saved for later.", "Saved for later"), "later", a)
            }
            "skipped" => (s("Set aside: its fit was below your minimum, or a filter caught it. You can still tailor it.", "Set aside"), "done", vec![action("tailor_anyway", "Tailor anyway", "Tailor anyway", true)]),
            "dismissed" => (s("You marked it Not interested. You can still tailor it.", "Not interested"), "done", vec![action("tailor_anyway", "Tailor anyway", "Tailor anyway", true)]),
            "applied" | "interviewing" | "offer" | "rejected" | "no_response" => {
                let who = match t("who").as_str() { "you" => "you", "them" => "them", "later" => "later", _ => "done" };
                let mut a = vec![];
                if tracked.is_some_and(|r| r["follow_up_due"] == true) {
                    a.push(action("follow_up", "Write follow-up", "Write follow-up", true));
                }
                ((t("next"), t("next")), who, a)
            }
            _ => (s("", ""), "done", vec![]),
        }
    };
    if ["queued", "ready", "approved"].contains(&job.status.as_str()) {
        for (to, label) in [("saved", "Save for later"), ("dismissed", "Not interested")] {
            let mut a = stage_action(to, label, false);
            a["quiet"] = json!(true);
            actions.push(a);
        }
    }
    json!({ "text": text, "short": short, "who": who, "actions": actions, "interview": tracked.map(|r| r["next_interview"].clone()).unwrap_or(Value::Null) })
}

/// A job's place in its lifecycle, for the screens, the assistant and the Claude Desktop tools:
/// its stage, what's next, where it can move, and the work running or failed on it.
pub fn state(agent: &Agent, job: &Job, can_fill: bool) -> Value {
    let tracked = agent.tracker(Some(&job.id)).ok().and_then(|mut v| v.pop());
    let tailoring = agent.is_running(&format!("tailor:{}", job.id));
    json!({
        "stage": job.status, "label": label(&job.status),
        "next": next(job, tracked.as_ref(), tailoring, can_fill),
        "allowed": allowed(&job.status).iter().map(|s| json!({ "stage": s, "label": label(s) })).collect::<Vec<_>>(),
        "work": work(agent, &job.id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(s: &crate::testkit::Setup, id: &str) {
        s.agent.db().insert_job(&Job { id: id.into(), source: "t".into(), company: "Acme".into(), title: "TPM".into(), url: "https://acme.example/jobs/1".into(), status: "queued".into(), ..Job::default() }).unwrap();
    }

    #[test]
    fn every_stage_has_its_moves_and_they_are_real_stages() {
        for s in STATUSES {
            assert!(MOVES.iter().filter(|m| m.0 == s).count() == 1, "{s} is in the table once");
            assert!(!label(s).is_empty(), "{s} has a name");
            for to in allowed(s) {
                assert!(STATUSES.contains(to), "{s} -> {to}: not a stage");
                assert!(*to != s, "{s} -> itself needs no entry");
            }
        }
        assert_eq!(MOVES.len(), STATUSES.len());
        // Every stage can be reached from somewhere, and none is a trap except by choice.
        for s in STATUSES {
            assert!(MOVES.iter().any(|m| m.1.contains(&s)), "nothing leads to {s}");
            assert!(!allowed(s).is_empty(), "nothing leads out of {s}");
        }
    }

    #[test]
    fn the_usual_path_is_expected_and_a_leap_is_noted_not_refused() {
        for (a, b) in [("queued", "ready"), ("ready", "approved"), ("approved", "applied"), ("applied", "interviewing"), ("interviewing", "offer"), ("applied", "no_response"), ("applied", "applied")] {
            assert!(expected(a, b), "{a} -> {b}");
        }
        assert!(!expected("queued", "offer"));
        let s = crate::testkit::setup();
        let id = "lifecycle:leap";
        seed(&s, id);
        s.agent.db().set_status(id, "offer", "").unwrap();
        assert_eq!(s.agent.db().job(id).unwrap().unwrap().status, "offer", "the move still happens");
        assert!(unexpected().iter().any(|u| u["job"] == id && u["from"] == "queued" && u["to"] == "offer"));
    }

    #[test]
    fn next_says_the_same_thing_the_job_page_does() {
        let s = crate::testkit::setup();
        let id = "lifecycle:next";
        seed(&s, id);
        let job = s.agent.db().job(id).unwrap().unwrap();
        let st = state(&s.agent, &job, false);
        assert_eq!(st["stage"], "queued");
        assert_eq!(st["next"]["who"], "you");
        assert_eq!(st["next"]["actions"][0]["act"], "tailor");
        assert!(st["allowed"].as_array().unwrap().iter().any(|a| a["stage"] == "ready"));
        s.agent.db().set_status(id, "ready", "").unwrap();
        s.agent.db().set_status(id, "approved", "").unwrap();
        let job = s.agent.db().job(id).unwrap().unwrap();
        let st = state(&s.agent, &job, true);
        assert_eq!(st["next"]["actions"][0]["act"], "fill");
        assert_eq!(st["next"]["actions"][1]["to"], "applied");
        s.agent.db().set_status(id, "applied", "").unwrap();
        let job = s.agent.db().job(id).unwrap().unwrap();
        let st = state(&s.agent, &job, true);
        assert_eq!(st["next"]["who"], "them");
        assert!(st["next"]["text"].as_str().unwrap().starts_with("Waiting for a reply"));
    }

    #[test]
    fn failed_work_says_so_until_it_starts_again() {
        let s = crate::testkit::setup();
        let id = "lifecycle:work";
        seed(&s, id);
        assert_eq!(work(&s.agent, id), json!({}));
        s.agent.db().log(Some(id), "prep:error", "Claude's limit was reached").unwrap();
        s.agent.db().log(Some(id), "recruiter:error", "no address").unwrap();
        let w = work(&s.agent, id);
        assert_eq!(w["prep"]["state"], "failed");
        assert_eq!(w["prep"]["why"], "Claude's limit was reached");
        assert_eq!(w["contact"]["state"], "failed");
        {
            let _g = s.agent.claim(&format!("prep:{id}")).unwrap();
            assert_eq!(work(&s.agent, id)["prep"]["state"], "running");
        }
        assert!(work(&s.agent, id).get("prep").is_none(), "started again: the old failure is gone");
    }
}
