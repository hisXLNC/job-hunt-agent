//! The browser extension's line to Job Hunt: a tiny web server on this computer only
//! (127.0.0.1, so nothing else on the network can reach it), behind a key you paste into the
//! extension once. It answers the extension's Fill this form: which application the page is, what
//! to put in its fields, and the CV and letter to attach; and it hears when you've submitted.

use crate::pipeline::Agent;
use crate::web::{read_request, write};
use crate::api::Resp;
use serde_json::{json, Value};
use regex::Regex;
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

/// The extension's files, as the download and the folder carry them: (name, bytes). The manifest and
/// background.js carry this Job Hunt's version, so the extension can tell when it's out of date.
pub fn extension_files(host: &dyn crate::api::Host, version: &str) -> crate::R<Vec<(String, Vec<u8>)>> {
    let mut out = vec![];
    for (name, from) in [("manifest.json", "extension/manifest.json"), ("popup.html", "extension/popup.html"), ("popup.js", "extension/popup.js"),
        ("background.js", "extension/background.js"), ("icon-48.png", "extension/icon-48.png"), ("icon-128.png", "extension/icon-128.png"), ("clip.js", "clip.js")] {
        let mut bytes = host.asset(from).ok_or_else(|| crate::Error(format!("The extension's {name} is missing from this copy of Job Hunt.")))?;
        // A browser takes up to four numbers as an extension's version: "2.34.0", not "2.34.0-dev".
        let v: String = version.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if name == "manifest.json" && !v.is_empty() {
            let text = String::from_utf8_lossy(&bytes).to_string();
            static VERSION: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| Regex::new(r#""version":\s*"[^"]*""#).unwrap());
            let text = VERSION.replace(&text, format!("\"version\": \"{v}\"").as_str()).to_string();
            bytes = text.into_bytes();
        }
        if name == "background.js" {
            bytes = String::from_utf8_lossy(&bytes).replacen("__JH_VERSION__", version, 1).into_bytes();
        }
        out.push((name.to_string(), bytes));
    }
    // Fill this form: the Apply window's script, set up for the extension.
    out.push(("fill.js".into(), crate::fill::extension_script().into_bytes()));
    Ok(out)
}

/// The folder Job Hunt keeps the extension in, for Load unpacked: rewritten when Job Hunt updates,
/// and the extension reloads itself from it.
pub fn extension_dir(agent: &Agent) -> std::path::PathBuf {
    agent.data.join("Send to Job Hunt")
}

/// Write the extension's files to its folder (only those that changed). Returns the folder.
pub fn write_extension(agent: &Agent, host: &dyn crate::api::Host) -> crate::R<std::path::PathBuf> {
    let dir = extension_dir(agent);
    std::fs::create_dir_all(&dir)?;
    for (name, bytes) in extension_files(host, &host.version())? {
        let path = dir.join(&name);
        if std::fs::read(&path).ok().as_deref() != Some(&bytes[..]) {
            std::fs::write(&path, &bytes)?;
        }
    }
    Ok(dir)
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
                let sent = req.headers.get("x-job-hunt-key").cloned().or_else(|| req.query.get("k").cloned()).unwrap_or_default();
                let mut reply = if req.method == "OPTIONS" {
                    Resp { status: 204, ctype: "text/plain".into(), body: vec![], headers: vec![] }
                } else if req.method == "GET" && req.path == "/m/fill.js" {
                    phone_script(&agent, &sent)
                } else if req.path == "/m/add" {
                    // A job shared from your phone (the LinkedIn app's Share → Send to Job Hunt): the
                    // link as ?u=, or the shared text as the body.
                    let shared = req.query.get("u").cloned().unwrap_or_else(|| String::from_utf8_lossy(&req.body).to_string());
                    phone_add(&agent, &sent, &shared)
                } else {
                    handle(&agent, &req.method, &req.path, &sent, &req.body)
                };
                // Your phone's browser calls from the application page's own site (through Tailscale):
                // allowed from any page, as the key is what keeps others out.
                reply.headers.extend([
                    ("Access-Control-Allow-Origin".to_string(), "*".to_string()),
                    ("Access-Control-Allow-Headers".to_string(), "Content-Type, X-Job-Hunt-Key".to_string()),
                    ("Access-Control-Allow-Methods".to_string(), "GET, POST, OPTIONS".to_string()),
                    ("Access-Control-Allow-Private-Network".to_string(), "true".to_string()),
                ]);
                let _ = write(stream, reply);
            });
        }
    });
}

/// The form filler for your phone's bookmark (`/m/fill.js?k=…`): the extension's script, talking to
/// Job Hunt at the address it was loaded from (your PC's Tailscale name), with the key.
fn phone_script(agent: &Agent, sent: &str) -> Resp {
    let want = key(agent);
    if sent.len() != want.len() || !sent.bytes().zip(want.bytes()).fold(true, |ok, (a, b)| ok & (a == b)) {
        let body = "alert('Job Hunt: this bookmark has an old key. Copy the bookmark again from Job Hunt on your PC: Settings, Browser extension, Fill forms on your phone.');";
        return Resp { status: 200, ctype: "application/javascript; charset=utf-8".into(), body: body.as_bytes().to_vec(), headers: vec![("Cache-Control".into(), "no-store".into())] };
    }
    let _ = agent.db().set("phone.last", &crate::util::now());
    let script = format!(
        "if (!window.__jobhunt) {{\nwindow.__jobhuntRemote = {{ base: new URL(document.currentScript.src).origin, key: {} }};\n{}\n}} else window.__jobhunt.start();\n",
        json!(want),
        crate::fill::extension_script()
    );
    Resp { status: 200, ctype: "application/javascript; charset=utf-8".into(), body: script.into_bytes(), headers: vec![("Cache-Control".into(), "no-store".into())] }
}

/// Add the job a shared link points to (LinkedIn's share text is "…: https://www.linkedin.com/jobs/view/…"):
/// read now, so the reply names it; added and scored in the background, with a notice when it's in.
fn phone_add(agent: &Arc<Agent>, sent: &str, shared: &str) -> Resp {
    let text = |status: u16, t: &str| Resp { status, ctype: "text/plain; charset=utf-8".into(), body: t.as_bytes().to_vec(), headers: vec![("Cache-Control".into(), "no-store".into())] };
    let want = key(agent);
    if sent.len() != want.len() || !sent.bytes().zip(want.bytes()).fold(true, |ok, (a, b)| ok & (a == b)) {
        return text(401, "Job Hunt: the key in this shortcut is old. Copy the link again from Job Hunt on your PC (Fill forms on your phone).");
    }
    let Some(link) = Regex::new(r"https?://\S+").unwrap().find(shared).map(|m| m.as_str().trim_end_matches(|c: char| ").,;'\"".contains(c)).to_string()) else {
        return text(400, "Job Hunt: there was no link in what was shared. Share the job itself (the Share button on the posting).");
    };
    // A short link (LinkedIn's app shares lnkd.in/…): where it leads.
    let link = if link.contains("lnkd.in/") || link.contains("linkedin.com/comm/") {
        crate::sources::http().get(&link).send().map(|r| r.url().to_string()).unwrap_or(link)
    } else { link };
    let posting = match agent.read_link(&link) {
        Ok(p) => p,
        Err(e) => return text(422, &format!("Job Hunt couldn't read that posting: {}", e.0)),
    };
    let _ = agent.db().set("phone.last", &crate::util::now());
    let (title, company) = (posting.title.clone(), posting.company.clone());
    let a = agent.clone();
    std::thread::spawn(move || {
        let use_claude = a.claude_ready() && posting.description.trim().len() >= 40;
        // A LinkedIn job the way the browser button adds it (with its company-site apply link and pay).
        let added = if crate::sources::linkedin_job_id(&link).is_some() {
            a.add_clip(&json!({ "url": link, "claude": use_claude })).map(|j| j.id)
        } else {
            a.add_manual(&posting.company, &posting.title, &posting.url, &posting.location, &posting.description, use_claude)
        };
        match added {
            Ok(id) => {
                let (head, body) = a.added_notice(&id);
                a.note(&head, &body);
            }
            Err(e) => a.note("Couldn't add that job", &e.0),
        }
    });
    text(200, &format!("Sent to Job Hunt: {title} at {company}. It's being scored now."))
}

/// Make Job Hunt reachable from your phone through Tailscale: `tailscale serve` gives this computer an
/// https address only your own devices can open (Job Hunt itself still listens on this computer only).
/// Returns that address.
pub fn tailscale_serve() -> crate::R<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let exe = ["C:\\Program Files\\Tailscale\\tailscale.exe", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"].iter().find(|p| std::path::Path::new(p).exists()).map(|p| p.to_string()).unwrap_or_else(|| "tailscale".into());
    let cmd = |args: &[&str]| {
        let mut c = Command::new(&exe);
        c.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // no console window
        }
        c
    };
    let out = cmd(&["status", "--json"]).output().map_err(|e| crate::Error(format!("Couldn't run Tailscale on this computer ({e}). Is it installed?")))?;
    let st: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    let dns = st["Self"]["DNSName"].as_str().unwrap_or("").trim_end_matches('.').to_string();
    if dns.is_empty() {
        return Err(crate::Error("Tailscale isn't signed in on this computer. Open Tailscale, sign in, then try again.".into()));
    }
    // Serve may wait for you to allow it in your tailnet's settings: give it twenty seconds, then say so.
    let mut child = cmd(&["serve", "--bg", &PORT.to_string()]).spawn().map_err(|e| crate::Error(format!("Couldn't run Tailscale: {e}")))?;
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        if started.elapsed().as_secs() > 20 {
            let _ = child.kill();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    };
    let mut said = String::new();
    if let Some(mut o) = child.stdout.take() { let _ = o.read_to_string(&mut said); }
    if let Some(mut e) = child.stderr.take() { let _ = e.read_to_string(&mut said); }
    let link = Regex::new(r"https://login\.tailscale\.com/\S+").unwrap().find(&said).map(|m| m.as_str().to_string());
    match (status, link) {
        (Some(s), _) if s.success() => Ok(format!("https://{dns}")),
        (_, Some(l)) => Err(crate::Error(format!("Tailscale needs you to allow this once: open {l} , press Enable, then press Set up with Tailscale again."))),
        _ => Err(crate::Error(format!("Tailscale couldn't share Job Hunt: {}", said.trim().chars().take(300).collect::<String>()))),
    }
}

/// An answer being written for a form (see /ext/fill/start): when it started, and the result once there.
struct Fill {
    started: std::time::Instant,
    done: Option<Result<Value, String>>,
}
fn fills() -> &'static std::sync::Mutex<std::collections::HashMap<String, Fill>> {
    static FILLS: once_cell::sync::Lazy<std::sync::Mutex<std::collections::HashMap<String, Fill>>> = once_cell::sync::Lazy::new(Default::default);
    &FILLS
}
/// Which application the page is, if answers can be written at all.
fn fill_job(agent: &Agent, url: &str, title: &str) -> crate::R<crate::db::Job> {
    let j = crate::fill::job_for_page(agent, url, title)?;
    if !agent.claude_ready() && crate::fill::bank(agent).is_empty() {
        return Err(crate::Error("Set up Claude in Job Hunt first (Settings \u{2192} Accounts): it writes the answers.".into()));
    }
    Ok(j)
}
fn fill_answers(agent: &Agent, j: &crate::db::Job, url: &str, fields: &[Value]) -> crate::R<Value> {
    let mut a = crate::fill::answers(agent, &j.id, fields)?;
    a["job"] = page_job(j, url)["job"].clone();
    Ok(a)
}

fn json_resp(status: u16, v: Value) -> Resp {
    Resp { status, ctype: "application/json".into(), body: v.to_string().into_bytes(), headers: vec![("Cache-Control".into(), "no-store".into())] }
}

/// One request from the extension: (method, path, the key it sent, its JSON body).
pub fn handle(agent: &Arc<Agent>, method: &str, path: &str, sent_key: &str, body: &[u8]) -> Resp {
    // Only with the right key: a web page you visit can't reach in and read your answers.
    let want = key(agent);
    if sent_key.len() != want.len() || !sent_key.bytes().zip(want.bytes()).fold(true, |ok, (a, b)| ok & (a == b)) {
        return json_resp(401, json!({ "error": "The key doesn't match. Copy it again from Job Hunt: Settings \u{2192} Applying \u{2192} Filling in forms." }));
    }
    let _ = agent.db().set("ext.last", &crate::util::now());
    let b: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let (url, title) = (b["url"].as_str().unwrap_or(""), b["title"].as_str().unwrap_or(""));
    let fields: Vec<Value> = b["fields"].as_array().cloned().unwrap_or_default();
    let r: crate::R<Value> = match (method, path) {
        // With this Job Hunt's version and the extension's folder: an extension older than the app
        // reloads itself from the folder (background.js).
        ("GET", "/ext/ping") => Ok(json!({ "app": "Job Hunt", "version": agent.secret("app.version"), "folder": extension_dir(agent).to_string_lossy() })),
        // Which application a page is, and its company's own posting if this is a job board's copy.
        ("POST", "/ext/which") => crate::fill::job_for_page(agent, url, title).map(|j| page_job(&j, url)),
        // The answers in one request, held open until Claude has written them (the phone's bookmark,
        // and extensions from before 2.58.2).
        ("POST", "/ext/fill") => fill_job(agent, url, title).and_then(|j| fill_answers(agent, &j, url, &fields)),
        // The same in two steps, which is what the extension uses: a browser drops a request its
        // extension has waited on for half a minute, and Claude often takes longer. Start hands back
        // a ticket at once (or says why it can't start); the page then asks every second or two.
        ("POST", "/ext/fill/start") => fill_job(agent, url, title).map(|j| {
            let ticket = crate::fill::new_token();
            let mut all = fills().lock().unwrap();
            // Finished ones stay ten minutes (a second ask for the same ticket gets the same answer).
            all.retain(|_, f| f.started.elapsed().as_secs() < 900);
            all.insert(ticket.clone(), Fill { started: std::time::Instant::now(), done: None });
            drop(all);
            let (agent, url, t) = (agent.clone(), url.to_string(), ticket.clone());
            std::thread::spawn(move || {
                // Whatever happens in there, the page hears of it: a panic is an answer too.
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fill_answers(&agent, &j, &url, &fields)))
                    .unwrap_or_else(|_| Err(crate::Error("Job Hunt hit a problem writing the answers. Try again.".into())));
                if let Some(f) = fills().lock().unwrap().get_mut(&t) {
                    f.done = Some(r.map_err(|e| e.0));
                }
            });
            json!({ "ticket": ticket })
        }),
        ("POST", "/ext/fill/poll") => {
            let all = fills().lock().unwrap();
            return match all.get(b["ticket"].as_str().unwrap_or("")) {
                // Job Hunt was restarted since (an update, say): the page sends the form again.
                None => json_resp(400, json!({ "error": "Job Hunt was restarted while it was writing the answers.", "gone": true })),
                Some(Fill { started, done: None }) => json_resp(200, json!({ "waiting": true, "secs": started.elapsed().as_secs() })),
                Some(Fill { done: Some(Ok(v)), .. }) => json_resp(200, v.clone()),
                Some(Fill { done: Some(Err(e)), .. }) => json_resp(400, json!({ "error": e })),
            };
        }
        // What the extension did and what went wrong, kept beside your data (extension-log.json) so
        // a problem can be traced afterwards: no answers in it, only what happened and when.
        ("POST", "/ext/log") => {
            let events = b["events"].as_array().cloned().unwrap_or_default();
            let n = events.len();
            std::fs::write(agent.data.join("extension-log.json"), serde_json::to_vec_pretty(&json!({ "at": crate::util::now(), "why": b["why"], "health": b["health"], "events": events })).unwrap_or_default())
                .map(|_| json!({ "kept": n })).map_err(crate::Error::from)
        }
        // You chose which application this page is (when Job Hunt couldn't tell): it stays chosen for
        // the next two hours, through the form's other pages (see fill::job_for_page).
        ("GET", "/ext/jobs") => Ok(json!({ "jobs": pick_list(agent) })),
        ("POST", "/ext/pick") => {
            let site = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default();
            // Not an application: a profile on this site, filled in from your CV.
            if b["job_id"] == crate::fill::PROFILE {
                return match agent.db().set("apply.browser", &format!("{}|{}|{site}", crate::fill::PROFILE, crate::util::now())) {
                    Ok(()) => json_resp(200, json!({ "ok": true })),
                    Err(e) => json_resp(400, json!({ "error": e.0 })),
                };
            }
            let job = agent.db().job(b["job_id"].as_str().unwrap_or(""));
            match job {
                Ok(Some(j)) => agent.db().set("apply.browser", &format!("{}|{}|{}", j.id, crate::util::now(), url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default())).map(|_| page_job(&j, url)),
                Ok(None) => Err(crate::Error("That job is no longer in Job Hunt.".into())),
                Err(e) => Err(e),
            }
        }
        // A profile isn't a job: nothing to note, set aside or mark applied.
        ("POST", "/ext/salary" | "/ext/dismiss" | "/ext/applied") if crate::fill::job_for_page(agent, url, title).is_ok_and(|j| j.id == crate::fill::PROFILE) => Ok(json!({ "ok": true, "profile": true })),
        ("POST", "/ext/salary") => crate::fill::job_for_page(agent, url, title).and_then(|j| agent.found_salary(&j.id, b["text"].as_str().unwrap_or(""), "on the company's page")).map(|n| json!({ "new": n })),
        ("POST", "/ext/dismiss") => crate::fill::job_for_page(agent, url, title).and_then(|j| agent.db().set_status(&j.id, "dismissed", "not interested (from your browser)").map(|_| json!({ "ok": true }))),
        // Hiring posts read from the page you're on (LinkedIn's post search, or one page you chose).
        ("POST", "/ext/leads") => crate::leads::add_posts(agent, b["posts"].as_array().map(|a| a.as_slice()).unwrap_or(&[]), b["chosen"].as_bool().unwrap_or(false)),
        ("GET", "/ext/leads/searches") => Ok(json!({ "searches": crate::leads::linkedin_searches(agent).into_iter().map(|(t, u)| json!({ "title": t, "url": u })).collect::<Vec<_>>() })),
        ("POST", "/ext/learn") => crate::fill::learn(agent, &fields).map(|n| json!({ "kept": n })),
        ("POST", "/ext/applied") => crate::fill::job_for_page(agent, url, title)
            .and_then(|j| crate::fill::submitted_with(agent, &j.id, url, b["auto"].as_bool().unwrap_or(false), &fields).map(|_| json!({ "ok": true }))),
        _ => return json_resp(404, json!({ "error": "Not here." })),
    };
    match r {
        Ok(v) => json_resp(200, v),
        // Not sure which application this is: the jobs to choose from come with the answer.
        Err(e) if e.0.contains("can't tell which application") => {
            // The last choice is no job at all: a profile on this site, filled in from your CV.
            let mut jobs = pick_list(agent);
            let none = jobs.is_empty();
            jobs.push(json!({ "id": crate::fill::PROFILE, "title": "Not an application", "company": "a profile here, from my CV", "status": crate::fill::PROFILE }));
            json_resp(400, json!({ "error": if none { "No approved application matches this page. A profile? Fill it from your CV." } else { "Which application is this? Choose it below." }, "choose": jobs }))
        }
        Err(e) => json_resp(400, json!({ "error": e.0 })),
    }
}

/// The jobs a page could be the application for, as the panel lists them: the Submit tab's
/// (approved), then Approve's (ready).
fn pick_list(agent: &Agent) -> Vec<Value> {
    ["approved", "ready"].iter().flat_map(|s| agent.db().jobs(Some(s), 60).unwrap_or_default())
        // With where to apply (the company's own page when Job Hunt found it): the extension opens it.
        .map(|j| json!({ "id": j.id, "title": j.title, "company": j.company, "status": j.status, "url": j.apply_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| j.url.clone()) })).collect()
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
        // The phone's script: only with the key, and set up to call back where it came from.
        let js = String::from_utf8(phone_script(&s.agent, &k).body).unwrap();
        assert!(js.contains("__jobhuntRemote") && js.contains(&k) && js.contains("window.__jobhunt"));
        let bad = String::from_utf8(phone_script(&s.agent, "nope").body).unwrap();
        assert!(bad.starts_with("alert(") && !bad.contains(&k));
        // A job shared from the phone: only with the key, and only with a link in it.
        assert_eq!(phone_add(&s.agent, "nope", "https://www.linkedin.com/jobs/view/123456789").status, 401);
        assert_eq!(phone_add(&s.agent, &k, "Look at this job!").status, 400);
        assert_eq!(handle(&s.agent, "GET", "/nope", &k, b"").status, 404);
    }

    /// The extension's way to the answers: a ticket at once, then asked after until they're there.
    #[test]
    fn answers_come_for_a_ticket() {
        let s = crate::testkit::setup();
        let k = key(&s.agent);
        let body = |r: &Resp| serde_json::from_slice::<Value>(&r.body).unwrap();
        // A ticket Job Hunt doesn't know (it was restarted since): said so, and the page sends the form again.
        let r = handle(&s.agent, "POST", "/ext/fill/poll", &k, br#"{"ticket":"nope"}"#);
        assert_eq!(r.status, 400);
        assert_eq!(body(&r)["gone"], true);
        // No application matches the page: the choice comes at once, with no ticket.
        let r = handle(&s.agent, "POST", "/ext/fill/start", &k, br#"{"url":"https://nowhere.example/apply","title":"Apply","fields":[]}"#);
        assert_eq!(r.status, 400);
        assert!(body(&r)["choose"].is_array());
        // An application the page is: a ticket, and whatever writing the answers comes to (here an
        // error, with no CV) is what asking after it gets, as often as it's asked.
        let j = crate::db::Job { id: "t1".into(), title: "Analyst".into(), company: "Maple".into(), url: "https://maple.example/jobs/1".into(), status: "approved".into(), found_at: crate::util::now(), updated_at: crate::util::now(), ..Default::default() };
        s.agent.db().insert_job(&j).unwrap();
        handle(&s.agent, "POST", "/ext/pick", &k, br#"{"job_id":"t1","url":"https://maple.example/apply"}"#);
        s.agent.db().set("claude.key", "test").unwrap();
        let r = handle(&s.agent, "POST", "/ext/fill/start", &k, br#"{"url":"https://maple.example/apply","title":"Apply","fields":[{"key":"f0","type":"text","label":"Email"}]}"#);
        let started = body(&r);
        if r.status == 200 {
            let ask = json!({ "ticket": started["ticket"] }).to_string();
            let mut last = Value::Null;
            for _ in 0..200 {
                let p = handle(&s.agent, "POST", "/ext/fill/poll", &k, ask.as_bytes());
                last = body(&p);
                if last["waiting"] != true { break; }
                assert!(last["secs"].is_number());
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            assert!(last["waiting"] != true, "an answer or an error, in the end");
            assert!(last["gone"] != true);
            let again = body(&handle(&s.agent, "POST", "/ext/fill/poll", &k, ask.as_bytes()));
            assert_eq!(again, last, "asked twice, answered the same");
        } else {
            assert!(started["error"].is_string(), "said plainly why it can't start");
        }
        // The extension's log is kept beside the data.
        let r = handle(&s.agent, "POST", "/ext/log", &k, br#"{"why":"test","events":[{"t":1,"k":"fill","m":"form sent"}]}"#);
        assert_eq!(body(&r)["kept"], 1);
        assert!(std::fs::read_to_string(s.agent.data.join("extension-log.json")).unwrap().contains("form sent"));
    }

    #[test]
    fn you_choose_the_job_when_job_hunt_cant_tell() {
        let s = crate::testkit::setup();
        let k = key(&s.agent);
        for (id, co) in [("a1", "Thomson Reuters"), ("a2", "Thomson Reuters")] {
            let j = crate::db::Job { id: id.into(), title: format!("Role {id}"), company: co.into(), url: format!("https://x.example/{id}"), status: "approved".into(), found_at: crate::util::now(), updated_at: crate::util::now(), ..Default::default() };
            s.agent.db().insert_job(&j).unwrap();
        }
        let page = br#"{"url":"https://trcareers.wd5.myworkdayjobs.com/apply","title":"Careers at Thomson Reuters","fields":[]}"#;
        let r = handle(&s.agent, "POST", "/ext/which", &k, page);
        let v: Value = serde_json::from_slice(&r.body).unwrap();
        assert_eq!(r.status, 400);
        let choose = v["choose"].as_array().unwrap();
        assert_eq!(choose.len(), 3, "two at that company, and last, no application at all: a profile");
        assert_eq!(choose[2]["id"], crate::fill::PROFILE);
        let r = handle(&s.agent, "POST", "/ext/pick", &k, br#"{"job_id":"a2"}"#);
        assert_eq!(r.status, 200);
        let v: Value = serde_json::from_slice(&handle(&s.agent, "POST", "/ext/which", &k, page).body).unwrap();
        assert_eq!(v["job"]["id"], "a2", "the one you chose, for the rest of the form");
        // The profile, chosen on a job site: that site's pages are the profile, and there's nothing
        // to mark applied or set aside.
        let bank = br#"{"url":"https://www.jobbank.gc.ca/match/profile/experience","title":"Job Match","fields":[]}"#;
        let r = handle(&s.agent, "POST", "/ext/pick", &k, br#"{"job_id":"profile","url":"https://www.jobbank.gc.ca/match/profile/experience"}"#);
        assert_eq!(r.status, 200);
        let v: Value = serde_json::from_slice(&handle(&s.agent, "POST", "/ext/which", &k, bank).body).unwrap();
        assert_eq!(v["job"]["id"], crate::fill::PROFILE);
        let v: Value = serde_json::from_slice(&handle(&s.agent, "POST", "/ext/applied", &k, bank).body).unwrap();
        assert_eq!(v["profile"], true);
        assert_eq!(s.agent.db().jobs(Some("applied"), 10).unwrap().len(), 0, "nothing was marked applied");
    }
}
