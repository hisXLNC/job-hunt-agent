//! The browser extension's line to Job Hunt: a tiny web server on this computer only
//! (127.0.0.1, so nothing else on the network can reach it), behind a key you paste into the
//! extension once. It answers the extension's Fill this form: which application the page is, what
//! to put in its fields, and the CV and letter to attach; and it hears when you've submitted.

use crate::pipeline::Agent;
use crate::web::{read_request, write};
use crate::api::Resp;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::sync::Arc;

/// The port the extension looks for Job Hunt on.
pub const PORT: u16 = 47613;

/// The key the extension sends with every request (made the first time it's asked for).
pub fn key(agent: &Agent) -> String {
    let k = agent.secret("ext.key");
    if !k.is_empty() {
        return k;
    }
    let k = format!("jh-{}", crate::fill::new_token());
    let _ = agent.db().set("ext.key", &k);
    k
}

/// Start listening, once, in the background. Quietly does nothing when the port is taken (another
/// copy of Job Hunt has it).
pub fn start(agent: Arc<Agent>) {
    let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else { return };
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let agent = agent.clone();
            std::thread::spawn(move || {
                let Ok(Some(req)) = read_request(&stream) else { return };
                let reply = handle(&agent, &req.method, &req.path, req.headers.get("x-job-hunt-key").map(String::as_str).unwrap_or(""), &req.body);
                let _ = write(stream, reply);
            });
        }
    });
}

fn json_resp(status: u16, v: Value) -> Resp {
    Resp { status, ctype: "application/json".into(), body: v.to_string().into_bytes(), headers: vec![("Cache-Control".into(), "no-store".into())] }
}

/// One request from the extension: (method, path, the key it sent, its JSON body).
pub fn handle(agent: &Agent, method: &str, path: &str, sent_key: &str, body: &[u8]) -> Resp {
    // Only with the right key: a web page you visit can't reach in and read your answers.
    let want = key(agent);
    if sent_key.len() != want.len() || !sent_key.bytes().zip(want.bytes()).fold(true, |ok, (a, b)| ok & (a == b)) {
        return json_resp(401, json!({ "error": "The key doesn't match. Copy it again from Job Hunt: Search \u{2192} Set up sources \u{2192} Jobs you find yourself." }));
    }
    let b: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let (url, title) = (b["url"].as_str().unwrap_or(""), b["title"].as_str().unwrap_or(""));
    let fields: Vec<Value> = b["fields"].as_array().cloned().unwrap_or_default();
    let r: crate::R<Value> = match (method, path) {
        ("GET", "/ext/ping") => Ok(json!({ "app": "Job Hunt" })),
        // Which application a page is, and its company's own posting if this is a job board's copy.
        ("POST", "/ext/which") => crate::fill::job_for_page(agent, url, title).map(|j| page_job(&j, url)),
        ("POST", "/ext/fill") => crate::fill::job_for_page(agent, url, title).and_then(|j| {
            if !agent.claude_ready() && crate::fill::bank(agent).is_empty() {
                return Err(crate::Error("Set up Claude in Job Hunt first (Settings \u{2192} Accounts): it writes the answers.".into()));
            }
            let mut a = crate::fill::answers(agent, &j.id, &fields)?;
            a["job"] = page_job(&j, url)["job"].clone();
            Ok(a)
        }),
        ("POST", "/ext/learn") => crate::fill::learn(agent, &fields).map(|n| json!({ "kept": n })),
        ("POST", "/ext/applied") => crate::fill::job_for_page(agent, url, title)
            .and_then(|j| crate::fill::submitted_with(agent, &j.id, url, b["auto"].as_bool().unwrap_or(false), &fields).map(|_| json!({ "ok": true }))),
        _ => return json_resp(404, json!({ "error": "Not here." })),
    };
    match r {
        Ok(v) => json_resp(200, v),
        Err(e) => json_resp(400, json!({ "error": e.0 })),
    }
}

/// The job, as the extension shows it, with the company's own link when the page isn't it.
fn page_job(j: &crate::db::Job, url: &str) -> Value {
    let own = j.apply_url.clone().filter(|u| !u.is_empty() && crate::db::url_key(u) != crate::db::url_key(url) && crate::sources::is_job_board(url));
    json!({ "job": { "id": j.id, "title": j.title, "company": j.company }, "company_link": own })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_the_key() {
        let s = crate::testkit::setup();
        let k = key(&s.agent);
        assert!(k.starts_with("jh-") && key(&s.agent) == k, "made once, then kept");
        assert_eq!(handle(&s.agent, "GET", "/ext/ping", "wrong", b"").status, 401);
        assert_eq!(handle(&s.agent, "GET", "/ext/ping", &k, b"").status, 200);
        assert_eq!(handle(&s.agent, "GET", "/nope", &k, b"").status, 404);
    }
}
