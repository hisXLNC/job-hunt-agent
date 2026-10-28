//! Job Hunt in a web browser, for your phone or another computer: the same screens and API as the app
//! window, behind a password. Used by the Windows app's Remote access setting and by the Synology /
//! Docker server. Meant for a private network such as Tailscale, not the open internet.

use crate::api::{handle, Host, Req, Resp};
use crate::pipeline::Agent;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Largest request accepted (a CV or a backup to restore).
const MAX_BODY: usize = 200 * 1024 * 1024;
const COOKIE: &str = "jh_session";

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn sha(s: &str) -> String {
    hex(&Sha256::digest(s.as_bytes()))
}

/// Store a new password (salted hash) and sign every device out.
pub fn set_password(agent: &Agent, password: &str) -> crate::R<()> {
    if password.chars().count() < 8 {
        return Err(crate::Error("Use a password of at least 8 characters.".into()));
    }
    let salt = hex(&rand::random::<[u8; 16]>());
    let db = agent.db();
    db.set("remote.password", &format!("{salt}${}", sha(&format!("{salt}{password}"))))?;
    db.delete("remote.sessions")
}

pub fn has_password(agent: &Agent) -> bool {
    agent.secret("remote.password").contains('$')
}

fn password_ok(agent: &Agent, password: &str) -> bool {
    let stored = agent.secret("remote.password");
    let Some((salt, want)) = stored.split_once('$') else { return false };
    let got = sha(&format!("{salt}{password}"));
    // Compare in constant time.
    got.len() == want.len() && got.bytes().zip(want.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// Signed-in devices are kept as hashes of their session tokens, so they survive restarts.
fn sessions(agent: &Agent) -> Vec<String> {
    serde_json::from_str(&agent.secret("remote.sessions")).unwrap_or_default()
}

fn new_session(agent: &Agent) -> crate::R<String> {
    let token = hex(&rand::random::<[u8; 32]>());
    let mut list = sessions(agent);
    list.push(sha(&token));
    let keep = list.len().saturating_sub(20);
    agent.db().set("remote.sessions", &serde_json::to_string(&list[keep..]).unwrap_or_default())?;
    Ok(token)
}

fn signed_in(agent: &Agent, cookie: Option<&str>) -> bool {
    let Some(token) = cookie else { return false };
    let h = sha(token);
    sessions(agent).iter().any(|s| *s == h)
}

fn sign_out(agent: &Agent, cookie: Option<&str>) {
    if let Some(token) = cookie {
        let h = sha(token);
        let list: Vec<String> = sessions(agent).into_iter().filter(|s| *s != h).collect();
        let _ = agent.db().set("remote.sessions", &serde_json::to_string(&list).unwrap_or_default());
    }
}

/// Wrong passwords per client address, to slow down guessing.
fn failures() -> &'static Mutex<HashMap<String, (u32, Instant)>> {
    static F: OnceLock<Mutex<HashMap<String, (u32, Instant)>>> = OnceLock::new();
    F.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Serve on `addr` until the process ends. `enabled` is checked on every request, so the Windows
/// app's Remote access switch takes effect at once.
pub fn serve(agent: Arc<Agent>, host: Arc<dyn Host>, addr: &str, enabled: Arc<dyn Fn() -> bool + Send + Sync>) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    for stream in listener.incoming().flatten() {
        let (agent, host, enabled) = (agent.clone(), host.clone(), enabled.clone());
        std::thread::spawn(move || {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
            let _ = connection(stream, &agent, &host, enabled.as_ref());
        });
    }
    Ok(())
}

/// Start serving in the background once per process (the Windows app's Remote access).
pub fn ensure_started(agent: Arc<Agent>, host: Arc<dyn Host>, port: u16) -> Result<(), String> {
    static STARTED: OnceLock<Mutex<Option<u16>>> = OnceLock::new();
    let started = STARTED.get_or_init(|| Mutex::new(None));
    let mut s = started.lock().unwrap();
    if s.is_some() {
        return Ok(());
    }
    let addr = format!("0.0.0.0:{port}");
    let listener_check = TcpListener::bind(&addr).map_err(|e| format!("Couldn't use port {port}: {e}"))?;
    drop(listener_check);
    let a2 = agent.clone();
    let enabled: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || a2.secret("remote.on") == "1" && has_password(&a2));
    std::thread::spawn(move || {
        let _ = serve(agent, host, &addr, enabled);
    });
    *s = Some(port);
    Ok(())
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> std::io::Result<Option<Request>> {
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    if r.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else { return Ok(None) };
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return Ok(None);
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    let (path, q) = target.split_once('?').unwrap_or((target, ""));
    let path = percent_decode(path);
    let query = url::form_urlencoded::parse(q.as_bytes()).into_owned().collect();
    Ok(Some(Request { method: method.to_string(), path, query, headers, body }))
}

fn percent_decode(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default()
}

fn cookie<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers.get("cookie")?.split(';').filter_map(|c| c.trim().split_once('=')).find(|(k, _)| *k == name).map(|(_, v)| v)
}

fn write(mut stream: TcpStream, r: Resp) -> std::io::Result<()> {
    let reason = match r.status { 200 => "OK", 302 => "Found", 303 => "See Other", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", 429 => "Too Many Requests", _ => "Error" };
    let mut head = format!("HTTP/1.1 {} {reason}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n", r.status, r.ctype, r.body.len());
    for (k, v) in &r.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(&r.body)?;
    stream.flush()
}

fn redirect(to: &str, extra: Vec<(String, String)>) -> Resp {
    let mut headers = vec![("Location".to_string(), to.to_string())];
    headers.extend(extra);
    Resp { status: 303, ctype: "text/plain".into(), body: vec![], headers }
}

fn html(status: u16, body: String) -> Resp {
    Resp { status, ctype: "text/html; charset=utf-8".into(), body: body.into_bytes(), headers: vec![("Cache-Control".into(), "no-store".into())] }
}

fn login_page(message: &str) -> String {
    let msg = if message.is_empty() { String::new() } else { format!("<p class=\"err\">{}</p>", crate::util::escape(message)) };
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Hunt</title><style>
:root{{color-scheme:light dark;--bg:#EEF0F5;--card:#fff;--ink:#141824;--muted:#5d6478;--accent:#2F4FC4;--accent-ink:#fff;--line:#d9dde8}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0D111B;--card:#151A27;--ink:#E6E9F2;--muted:#9aa2b8;--accent:#8EA4FF;--accent-ink:#0B1233;--line:#2A3144}}}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}}
form{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;width:100%;max-width:360px;box-sizing:border-box}}
h1{{margin:0 0 4px;font-size:22px}}p{{margin:0 0 18px;color:var(--muted);font-size:14px}}
input{{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit;margin-bottom:14px}}
button{{width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;cursor:pointer}}
.err{{color:#d14343}}</style></head><body>
<form method="post" action="/login"><h1>Job Hunt</h1><p>Enter your Job Hunt password.</p>{msg}
<input type="password" name="password" autocomplete="current-password" autofocus required aria-label="Password">
<button type="submit">Sign in</button></form></body></html>"#
    )
}

/// A connection from this machine (or its Docker network): a tunnel or proxy on the same computer.
fn is_local(ip: &str) -> bool {
    ip.parse::<std::net::IpAddr>().is_ok_and(|a| match a {
        std::net::IpAddr::V4(v) => v.is_loopback() || v.is_private(),
        std::net::IpAddr::V6(v) => v.is_loopback(),
    })
}

fn connection(stream: TcpStream, agent: &Arc<Agent>, host: &Arc<dyn Host>, enabled: &(dyn Fn() -> bool + Send + Sync)) -> std::io::Result<()> {
    let peer = stream.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let Some(req) = read_request(&stream)? else { return Ok(()) };
    if !enabled() {
        return write(stream, html(403, "<p>Remote access to Job Hunt is turned off on this computer.</p>".into()));
    }
    let token = cookie(&req, COOKIE).map(|s| s.to_string());
    // Behind Cloudflare Tunnel every visit arrives from the tunnel: count wrong passwords by the
    // visitor's own address, which Cloudflare passes on (Job Hunt then listens only to the tunnel).
    let peer = req.headers.get("cf-connecting-ip").filter(|ip| ip.parse::<std::net::IpAddr>().is_ok() && is_local(&peer)).cloned().unwrap_or(peer);
    // Reached over HTTPS (through Cloudflare): the sign-in cookie only ever goes over HTTPS.
    let https = req.headers.get("x-forwarded-proto").is_some_and(|p| p == "https") || req.headers.get("cf-visitor").is_some_and(|v| v.contains("https"));
    let secure = if https { "; Secure" } else { "" };
    let resp = match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/login") => html(200, login_page("")),
        ("POST", "/login") => {
            let blocked = {
                let f = failures().lock().unwrap();
                f.get(&peer).map(|(n, t)| *n >= 10 && t.elapsed() < Duration::from_secs(600)).unwrap_or(false)
            };
            let form: HashMap<String, String> = url::form_urlencoded::parse(&req.body).into_owned().collect();
            if blocked {
                html(429, login_page("Too many wrong passwords. Try again in 10 minutes."))
            } else if password_ok(agent, form.get("password").map(|s| s.as_str()).unwrap_or("")) {
                failures().lock().unwrap().remove(&peer);
                match new_session(agent) {
                    Ok(t) => redirect("/", vec![("Set-Cookie".into(), format!("{COOKIE}={t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{secure}"))]),
                    Err(e) => html(500, login_page(&e.0)),
                }
            } else {
                std::thread::sleep(Duration::from_secs(1));
                let mut f = failures().lock().unwrap();
                let e = f.entry(peer.clone()).or_insert((0, Instant::now()));
                if e.1.elapsed() > Duration::from_secs(600) {
                    *e = (0, Instant::now());
                }
                e.0 += 1;
                html(401, login_page("That password isn't right."))
            }
        }
        // A link in a CV or cover letter (see links.rs): anyone can open it.
        ("GET" | "HEAD", p) if p.starts_with("/l/") => {
            let ua = req.headers.get("user-agent").cloned().unwrap_or_default();
            let ua = if req.method == "HEAD" { String::new() } else { ua };
            match crate::links::open(agent, p.trim_start_matches("/l/"), &ua) {
                Some(to) => Resp { status: 302, ctype: "text/plain".into(), body: vec![], headers: vec![("Location".into(), to), ("Cache-Control".into(), "no-store".into()), ("Referrer-Policy".into(), "no-referrer".into())] },
                None => html(404, "<p>This link isn't known.</p>".into()),
            }
        }
        ("POST", "/logout") => {
            sign_out(agent, token.as_deref());
            redirect("/login", vec![("Set-Cookie".into(), format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"))])
        }
        _ if !signed_in(agent, token.as_deref()) => {
            if req.path.starts_with("/api/") {
                Resp::error(401, "Signed out. Reload the page to sign in again.")
            } else {
                redirect("/login", vec![])
            }
        }
        _ => {
            // Changing requests must come from Job Hunt's own pages.
            // The address the browser used: the Host header, or the one a proxy passes on.
            let ours = |o: &str| ["host", "x-forwarded-host"].iter().filter_map(|k| req.headers.get(*k)).any(|h| o.ends_with(&format!("//{h}")));
            let same_origin = req.headers.get("origin").map(|o| ours(o)).unwrap_or(true);
            if req.method != "GET" && !same_origin {
                Resp::error(403, "Blocked a request from another site.")
            } else {
                let api_req = Req { method: req.method.clone(), path: req.path.clone(), query: req.query.clone(), body: req.body.clone(), remote: true };
                handle(agent, host, &api_req)
            }
        }
    };
    write(stream, resp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::setup;

    struct NoHost;
    impl Host for NoHost {
        fn asset(&self, p: &str) -> Option<Vec<u8>> {
            (p == "index.html").then(|| b"<html>app</html>".to_vec())
        }
        fn open_url(&self, _: &str) -> crate::R<()> { Ok(()) }
        fn open_path(&self, _: &std::path::Path) -> crate::R<()> { Ok(()) }
        fn autostart(&self) -> bool { false }
        fn set_autostart(&self, _: bool) -> crate::R<()> { Ok(()) }
        fn version(&self) -> String { "1.9.0".into() }
        fn update_check(&self) -> serde_json::Value { serde_json::json!({}) }
        fn update_install(&self) -> crate::R<bool> { Ok(false) }
    }

    fn send(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn password_sign_in_and_api() {
        let s = setup();
        assert!(set_password(&s.agent, "short").is_err());
        set_password(&s.agent, "correct horse").unwrap();
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let (a, h): (Arc<Agent>, Arc<dyn Host>) = (s.agent.clone(), Arc::new(NoHost));
        std::thread::spawn(move || serve(a, h, &format!("127.0.0.1:{port}"), Arc::new(|| true)));
        std::thread::sleep(Duration::from_millis(200));

        // A link from a CV opens for anyone, and is counted; a link checker's visit apart.
        s.agent.db().add_link("acme-abcd", "test:1", "https://www.linkedin.com/in/alex").unwrap();
        let r = send(port, "GET /l/acme-abcd HTTP/1.1\r\nHost: x\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0) Chrome/130\r\n\r\n");
        assert!(r.starts_with("HTTP/1.1 302") && r.contains("Location: https://www.linkedin.com/in/alex"), "{r}");
        send(port, "GET /l/acme-abcd HTTP/1.1\r\nHost: x\r\nUser-Agent: Microsoft Office SafeLinks\r\n\r\n");
        assert!(send(port, "GET /l/nope HTTP/1.1\r\nHost: x\r\n\r\n").starts_with("HTTP/1.1 404"));
        let l = s.agent.db().links("test:1").unwrap();
        assert_eq!((l[0]["opened"].as_i64(), l[0]["previews"].as_i64()), (Some(1), Some(1)));
        // Signed out: pages go to the sign-in page, the API refuses.
        assert!(send(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").contains("Location: /login"));
        assert!(send(port, "GET /api/overview HTTP/1.1\r\nHost: x\r\n\r\n").starts_with("HTTP/1.1 401"));
        // A wrong password, then the right one.
        let bad = "password=nope";
        assert!(send(port, &format!("POST /login HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{bad}", bad.len())).contains("isn't right"));
        let good = "password=correct+horse";
        let r = send(port, &format!("POST /login HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{good}", good.len()));
        let cookie = r.lines().find(|l| l.starts_with("Set-Cookie:")).unwrap().split(';').next().unwrap().trim_start_matches("Set-Cookie: ").to_string();
        // Signed in: the app and its API answer.
        let page = send(port, &format!("GET / HTTP/1.1\r\nHost: x\r\nCookie: {cookie}\r\n\r\n"));
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("<html>app</html>"));
        assert!(send(port, &format!("GET /api/overview HTTP/1.1\r\nHost: x\r\nCookie: {cookie}\r\n\r\n")).starts_with("HTTP/1.1 200"));
        // Another site can't make changes with your session.
        let csrf = send(port, &format!("POST /api/run/search HTTP/1.1\r\nHost: x\r\nOrigin: http://evil.example\r\nCookie: {cookie}\r\nContent-Length: 0\r\n\r\n"));
        assert!(csrf.starts_with("HTTP/1.1 403"));
        // Signing out ends the session.
        send(port, &format!("POST /logout HTTP/1.1\r\nHost: x\r\nCookie: {cookie}\r\nContent-Length: 0\r\n\r\n"));
        assert!(send(port, &format!("GET /api/overview HTTP/1.1\r\nHost: x\r\nCookie: {cookie}\r\n\r\n")).starts_with("HTTP/1.1 401"));
    }
}
