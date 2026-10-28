//! Filling in a company's application form for you: the desktop app opens the form in its own
//! window with `script` in it, the script sends the form's fields here, and `answers` gives back
//! what to put in each one, with your CV and cover letter to attach. You press Submit yourself.

use crate::cv;
use crate::pipeline::Agent;
use crate::util::now;
use crate::{Error, R};
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The address the script "opens" to reach the app; the app cancels it and handles the message.
pub const MESSAGE_HOST: &str = "jobhunt.invalid";

/// The script for the Apply window: `token` proves a message came from it, not from the page.
pub fn script(token: &str, title: &str, company: &str) -> String {
    include_str!("fill.js")
        .replacen("__TOKEN__", token, 1)
        .replacen("__JOB__", &json!({ "title": title, "company": company }).to_string(), 1)
}

/// A random token for one Apply window.
pub fn new_token() -> String {
    use rand::Rng;
    let mut b = [0u8; 18];
    rand::thread_rng().fill(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// A message from the script, if `url` is one and carries the right token: (kind, data).
pub fn message(url: &url::Url, token: &str) -> Option<(String, Value)> {
    if url.host_str() != Some(MESSAGE_HOST) {
        return None;
    }
    // /kind/data: in the path, since a navigation's address may come without its #fragment.
    let (kind, data) = url.path().trim_matches('/').split_once('/')?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    (v["t"].as_str() == Some(token)).then(|| (kind.to_string(), v))
}

/// Which of your files a file field wants, from its label: the CV, the cover letter, or neither.
fn file_for(label: &str, only_one: bool) -> Option<&'static str> {
    let l = label.to_lowercase();
    if l.contains("cover") || l.contains("letter") || l.contains("motivation") {
        Some("letter")
    } else if l.contains("resume") || l.contains("résumé") || l.contains("cv") || l.contains("curriculum") || only_one {
        Some("cv")
    } else {
        None
    }
}

/// The PDF of a Word file, made now if there isn't one or it's older than the Word file; the Word
/// file if a PDF can't be made.
fn as_pdf(docx: &Path) -> PathBuf {
    crate::util::pdf_of(docx).unwrap_or_else(|_| docx.to_path_buf())
}

fn attachment(path: &Path, name: &str) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    let pdf = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    let mime = if pdf { "application/pdf" } else { "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    Some(json!({ "name": format!("{name}.{}", if pdf { "pdf" } else { "docx" }), "mime": mime, "b64": base64::engine::general_purpose::STANDARD.encode(bytes) }))
}

/// What to put in the form's fields, as {values: {key: text}, files: {key: {name, mime, b64}}}.
pub fn answers(agent: &Agent, job_id: &str, fields: &[Value]) -> R<Value> {
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    let profile = agent.profile();
    let cv_text = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
        .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&agent.cv_path(&t.name)).ok()))
        .map(|d| d.plain_text())
        .ok_or_else(|| Error("No CV uploaded yet. Add one in CV & Career.".into()))?;
    // Your files, for the upload fields.
    let who = profile.name.trim();
    let stem = |what: &str| if who.is_empty() { what.to_string() } else { format!("{who} - {what}") };
    let files_wanted: Vec<&Value> = fields.iter().filter(|f| f["type"] == "file").collect();
    let mut files = serde_json::Map::new();
    for f in &files_wanted {
        let which = file_for(f["label"].as_str().unwrap_or(""), files_wanted.len() == 1);
        let path = match which {
            Some("cv") => job.cv_path.as_deref().map(|p| as_pdf(Path::new(p))),
            Some("letter") => job.letter_path.as_deref().map(|p| as_pdf(Path::new(p))),
            _ => None,
        };
        if let Some(a) = path.and_then(|p| attachment(&p, &stem(if which == Some("cv") { "CV" } else { "Cover letter" }))) {
            files.insert(f["key"].as_str().unwrap_or("").to_string(), a);
        }
    }
    // Everything else, from Claude: one line per field, without the file fields.
    let lines: Vec<String> = fields.iter().filter(|f| f["type"] != "file").map(|f| {
        let mut o = json!({ "key": f["key"], "type": f["type"], "label": f["label"] });
        for k in ["options", "context", "value", "required"] {
            if f.get(k).is_some_and(|v| !v.is_null() && v != "" && v != false) {
                o[k] = f[k].clone();
            }
        }
        o.to_string()
    }).collect();
    let mut facts = profile.application_facts.trim().to_string();
    if !profile.email.trim().is_empty() {
        facts.push_str(&format!("\nEmail: {}", profile.email.trim()));
    }
    if let Some(min) = profile.min_salary {
        facts.push_str(&format!("\nMinimum yearly salary they'd accept: {min:.0}"));
    }
    if let Some(prev) = agent.answers(job_id) {
        facts.push_str(&format!("\nAnswers already written for this application (use the same ones): {prev}"));
    }
    let mut values = serde_json::Map::new();
    if !lines.is_empty() {
        let own = agent.own_words(&job, &profile);
        let known: std::collections::HashSet<&str> = fields.iter().filter_map(|f| f["key"].as_str()).collect();
        for v in agent.llm().fill_form(&profile.name, &cv_text, &job, &lines.join("\n"), &facts, &profile.stories)? {
            if known.contains(v.key.as_str()) && !v.value.trim().is_empty() {
                let long = v.value.chars().count() > 120;
                values.insert(v.key, json!(if long { cv::humanize(&v.value, &own) } else { v.value }));
            }
        }
    }
    let n = values.len() + files.len();
    agent.db().log(Some(job_id), "fill", &format!("{n} of {} fields filled in on the application form", fields.len()))?;
    Ok(json!({ "values": values, "files": files }))
}

/// You submitted the application in the Apply window: the site confirmed it (`auto`), or you pressed
/// "I submitted it".
pub fn submitted(agent: &Agent, job_id: &str, url: &str, auto: bool) -> R<()> {
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    if ["applied", "interviewing", "offer", "rejected"].contains(&job.status.as_str()) {
        return Ok(());
    }
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    agent.db().set_status(job_id, "applied", &format!("submitted on {} (filled in by Job Hunt{}) {}", if host.is_empty() { "the company's site" } else { &host }, if auto { ", confirmed by the site" } else { "" }, now()))?;
    if auto {
        agent.note(&format!("Applied: {} at {}", job.title, job.company), "The site confirmed your application, so Job Hunt marked it as applied. It reminds you to follow up if there's no reply.");
    }
    // And the email to the recruiter there, as you chose.
    if agent.claude_ready() {
        if let Err(e) = crate::recruiters::on_applied(agent, job_id) {
            agent.db().log(Some(job_id), "recruiter:error", &e.0)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_need_the_token_and_files_go_by_label() {
        let tok = new_token();
        let b64 = |v: &Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string());
        let good = url::Url::parse(&format!("https://jobhunt.invalid/fields/{}", b64(&json!({ "t": tok, "fields": [] })))).unwrap();
        let (kind, v) = message(&good, &tok).unwrap();
        assert_eq!((kind.as_str(), v["fields"].is_array()), ("fields", true));
        let forged = url::Url::parse(&format!("https://jobhunt.invalid/applied/{}", b64(&json!({ "t": "guess" })))).unwrap();
        assert!(message(&forged, &tok).is_none());
        assert!(message(&url::Url::parse("https://boards.greenhouse.io/acme/jobs/1").unwrap(), &tok).is_none());
        assert_eq!(file_for("Resume/CV", false), Some("cv"));
        assert_eq!(file_for("Cover Letter", false), Some("letter"));
        assert_eq!(file_for("Transcript", false), None);
        assert_eq!(file_for("Attach", true), Some("cv"));
        let s = script(&tok, "Tax Manager", "Acme <b>");
        assert!(s.contains(&tok) && s.contains(r#""company":"Acme <b>""#) && !s.contains("__TOKEN__"));
    }
}
