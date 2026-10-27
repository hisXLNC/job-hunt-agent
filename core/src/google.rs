//! Gmail and Google Calendar with your own Google OAuth client (Desktop app type).
//!
//! Sign-in: the app listens on a random local port, opens Google's consent page in your browser,
//! and swaps the returned code for a refresh token (PKCE). The token is kept in the app's database
//! and refreshed automatically.

use crate::slots::Busy;
use crate::{Error, R};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

pub const SCOPES: [&str; 4] = [
    "https://www.googleapis.com/auth/gmail.modify",      // read, label, draft and send
    "https://www.googleapis.com/auth/calendar.events",   // create interview events, and sync them back
    "https://www.googleapis.com/auth/calendar.freebusy", // check availability
    "https://www.googleapis.com/auth/drive.file",        // the sync copy: only files Job Hunt made, nothing else in your Drive
];

/// The folder in your Google Drive that holds the sync copy.
pub const DRIVE_FOLDER: &str = "Job Hunt";
pub const LABEL_ROOT: &str = "JobHunt";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClientSecret {
    pub client_id: String,
    pub client_secret: String,
    #[serde(default = "auth_uri")]
    pub auth_uri: String,
    #[serde(default = "token_uri")]
    pub token_uri: String,
}

fn auth_uri() -> String {
    "https://accounts.google.com/o/oauth2/auth".into()
}
fn token_uri() -> String {
    "https://oauth2.googleapis.com/token".into()
}

/// The "installed" client from the JSON file Google Cloud Console downloads.
pub fn parse_client(json_text: &str) -> R<ClientSecret> {
    let v: Value = serde_json::from_str(json_text).map_err(|_| Error("That isn't a Google connection file. It should be the .json file from Google Cloud's Clients page (a \u{201c}Desktop app\u{201d} client).".into()))?;
    if v.get("web").is_some() {
        return Err(Error("This OAuth client is a “Web application”. Create a “Desktop app” client instead.".into()));
    }
    let inst = v.get("installed").ok_or_else(|| Error("That isn't a Google connection file. Download it from the Clients page in Google Cloud.".into()))?;
    serde_json::from_value(inst.clone()).map_err(|_| Error("That Google connection file is incomplete. Download it again from Google Cloud.".into()))
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Token {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    #[serde(default)]
    pub email: String,
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(60)).build().expect("http client")
}

fn pkce() -> (String, String) {
    use rand::RngCore;
    use sha2::{Digest, Sha256};
    let mut bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// The Google connection built into this copy of Job Hunt (a "Desktop app" client file's text),
/// when it was built with one, or the server was given one in JOBHUNT_GOOGLE_CLIENT. With it,
/// nobody needs a Google Cloud project of their own: they just sign in.
pub fn builtin_client() -> Option<String> {
    std::env::var("JOBHUNT_GOOGLE_CLIENT").ok()
        .or_else(|| option_env!("JOBHUNT_GOOGLE_CLIENT").map(String::from))
        .filter(|t| parse_client(t).is_ok())
}

/// Google's sign-in address for a client, sending you back to `redirect`.
fn auth_url(client: &ClientSecret, redirect: &str, challenge: &str, state: &str) -> R<url::Url> {
    let mut url = url::Url::parse(&client.auth_uri).map_err(|e| Error(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", &SCOPES.join(" "))
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    Ok(url)
}

/// What a failed sign-in means, in plain words, from the error Google sent back.
pub fn sign_in_error(code: &str) -> String {
    match code {
        "access_denied" => "Google stopped the sign-in. If its page said you don't have access, the person who set up \
Job Hunt's Google connection needs to add your Gmail address to it (or publish it). Otherwise, press Connect Google \
again and choose Continue on each page.".into(),
        "admin_policy_enforced" | "org_internal" => "Your organisation's Google settings don't allow this app (work and \
school accounts often don't). Connect a personal Gmail account instead.".into(),
        "invalid_client" | "unauthorized_client" | "deleted_client" => "This copy of Job Hunt's Google connection file \
isn't valid any more. Ask whoever gave you Job Hunt for a new one.".into(),
        other => format!("Google sign-in didn't finish ({other}). Press Connect Google to try again."),
    }
}

/// The permissions Job Hunt needs that you didn't tick on Google's page, by what they're for.
pub fn missing_permissions(granted: &str) -> Vec<&'static str> {
    let has = |s: &str| granted.split_whitespace().any(|g| g == s);
    let mut out = vec![];
    if !has(SCOPES[0]) {
        out.push("reading and labelling your job email");
    }
    if !has(SCOPES[1]) || !has(SCOPES[2]) {
        out.push("your calendar (to book interviews)");
    }
    if !has(SCOPES[3]) {
        out.push("its own folder in your Google Drive (for sync)");
    }
    out
}

/// The code Google sent back, for a token.
fn exchange(client: &ClientSecret, code: &str, redirect: &str, verifier: &str) -> R<Token> {
    let r: Value = http()
        .post(&client.token_uri)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
        ])
        .send()?
        .json()?;
    if let Some(e) = r.get("error").and_then(|e| e.as_str()) {
        return Err(Error(sign_in_error(e)));
    }
    // Google's page lets you untick each permission: say plainly which ones are needed.
    if let Some(granted) = r.get("scope").and_then(|g| g.as_str()) {
        let missing = missing_permissions(granted);
        if !missing.is_empty() {
            return Err(Error(format!("Google didn't give Job Hunt permission for {}. Press Connect Google again and tick every box on Google's page.", missing.join(", "))));
        }
    }
    token_from(&r, None)
}

/// A sign-in started away from the computer running Job Hunt (on the server, from a phone):
/// after you approve, Google sends your browser to an address on 127.0.0.1 that doesn't open,
/// and you paste that address back into Job Hunt.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Pasted {
    pub url: String,
    pub verifier: String,
    pub state: String,
    pub redirect: String,
}

/// Nothing listens on port 1, so the page fails to open and its address stays in the address bar.
const PASTE_REDIRECT: &str = "http://127.0.0.1:1/";

pub fn start_pasted(client: &ClientSecret) -> R<Pasted> {
    let (verifier, challenge) = pkce();
    let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 16]>());
    let url = auth_url(client, PASTE_REDIRECT, &challenge, &state)?;
    Ok(Pasted { url: url.to_string(), verifier, state, redirect: PASTE_REDIRECT.into() })
}

/// Finish a pasted sign-in with the address the browser ended up on.
pub fn finish_pasted(client: &ClientSecret, p: &Pasted, pasted: &str) -> R<Token> {
    let t = pasted.trim();
    let u = url::Url::parse(t).map_err(|_| Error("Paste the whole address from the page that didn't open, starting with http://127.0.0.1".into()))?;
    let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
    if let Some(e) = q.get("error") {
        return Err(Error(sign_in_error(e)));
    }
    let code = q.get("code").ok_or_else(|| Error("That address has no sign-in code in it. Copy it from the page that didn't open, after you approved.".into()))?;
    if q.get("state") != Some(&p.state) {
        return Err(Error("That address is from a different sign-in. Start Connect Google again and use the newest one.".into()));
    }
    exchange(client, code, &p.redirect, &p.verifier)
}

/// Run the browser sign-in. `open` opens a URL in the default browser. Blocks until Google redirects
/// back (or five minutes pass).
pub fn sign_in(client: &ClientSecret, open: &dyn Fn(&str) -> R<()>) -> R<Token> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let (verifier, challenge) = pkce();
    let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 16]>());
    let url = auth_url(client, &redirect, &challenge, &state)?;
    open(url.as_str())?;

    listener.set_nonblocking(true)?;
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(s) => break s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() > deadline {
                    return Err(Error("Google sign-in timed out. Try Connect again.".into()));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.into()),
        }
    };
    stream.set_nonblocking(false)?;
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    let path = line.split_whitespace().nth(1).unwrap_or("/");
    let params: std::collections::HashMap<String, String> = url::Url::parse(&format!("http://x{path}"))
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let ok = params.get("state") == Some(&state) && params.contains_key("code");
    let page = if ok {
        "<div style='font-family:Segoe UI,sans-serif;max-width:520px;margin:60px auto;text-align:center'><h2>✓ Done</h2><p>Job Hunt is finishing the connection. Close this tab and go back to Job Hunt.</p></div>"
    } else {
        "<h2 style='font-family:Segoe UI,sans-serif'>Google sign-in didn't finish.</h2><p style='font-family:Segoe UI,sans-serif'>Go back to Job Hunt and try Connect again.</p>"
    };
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len());
    if !ok {
        let why = params.get("error").cloned().unwrap_or_else(|| "no code returned".into());
        return Err(Error(sign_in_error(&why)));
    }
    exchange(client, &params["code"], &redirect, &verifier)
}

fn token_from(r: &Value, old_refresh: Option<&str>) -> R<Token> {
    let access = r.get("access_token").and_then(|x| x.as_str()).ok_or_else(|| {
        Error(format!("Google didn't issue a token: {}", r.get("error_description").or(r.get("error")).and_then(|x| x.as_str()).unwrap_or("unknown error")))
    })?;
    let refresh = r.get("refresh_token").and_then(|x| x.as_str()).or(old_refresh).unwrap_or("");
    let expires_in = r.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    Ok(Token { access_token: access.into(), refresh_token: refresh.into(), expires_at: Utc::now().timestamp() + expires_in - 60, email: String::new() })
}

/// A signed-in Google account; refreshes its access token as needed and reports new tokens to `save`.
pub struct Google {
    client: ClientSecret,
    token: Mutex<Token>,
    save: Box<dyn Fn(&Token) + Send + Sync>,
    http: reqwest::blocking::Client,
    labels: Mutex<Option<std::collections::HashMap<String, String>>>,
    pub calendar_id: String,
    /// The Drive folder's id and its files' ids, once looked up.
    drive_ids: Mutex<std::collections::HashMap<String, String>>,
}

impl Google {
    pub fn new(client: ClientSecret, token: Token, calendar_id: &str, save: Box<dyn Fn(&Token) + Send + Sync>) -> Google {
        Google { client, token: Mutex::new(token), save, http: http(), labels: Mutex::new(None), calendar_id: calendar_id.into(), drive_ids: Mutex::new(Default::default()) }
    }

    fn bearer(&self) -> R<String> {
        let mut t = self.token.lock().unwrap();
        if t.expires_at > Utc::now().timestamp() && !t.access_token.is_empty() {
            return Ok(t.access_token.clone());
        }
        let r: Value = self
            .http
            .post(&self.client.token_uri)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", t.refresh_token.as_str()),
                ("client_id", self.client.client_id.as_str()),
                ("client_secret", self.client.client_secret.as_str()),
            ])
            .send()?
            .json()?;
        if r.get("error").and_then(|e| e.as_str()) == Some("invalid_grant") {
            return Err(Error("Google signed Job Hunt out. If that happens about a week after you connect, the Google project is still in Testing, \
and Google signs it out every 7 days: publish it once at console.cloud.google.com \u{2192} Google Auth Platform \u{2192} Audience \u{2192} Publish app. \
Then reconnect Google in Settings \u{2192} Connections.".into()));
        }
        let email = t.email.clone();
        *t = token_from(&r, Some(&t.refresh_token))?;
        t.email = email;
        (self.save)(&t);
        Ok(t.access_token.clone())
    }

    fn call(&self, method: reqwest::Method, url: &str, body: Option<Value>) -> R<Value> {
        let mut req = self.http.request(method, url).bearer_auth(self.bearer()?);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let r = req.send()?;
        let status = r.status();
        let v: Value = r.json().unwrap_or(Value::Null);
        if !status.is_success() {
            let msg = v.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("");
            return Err(Error(format!("Google said {status}: {msg}")));
        }
        Ok(v)
    }

    pub fn account_email(&self) -> R<String> {
        let v = self.call(reqwest::Method::GET, "https://gmail.googleapis.com/gmail/v1/users/me/profile", None)?;
        Ok(v.get("emailAddress").and_then(|e| e.as_str()).unwrap_or("").to_string())
    }

    fn label_id(&self, name: &str) -> R<String> {
        let mut cache = self.labels.lock().unwrap();
        if cache.is_none() {
            let v = self.call(reqwest::Method::GET, "https://gmail.googleapis.com/gmail/v1/users/me/labels", None)?;
            let map = v.get("labels").and_then(|l| l.as_array()).into_iter().flatten()
                .filter_map(|l| Some((l.get("name")?.as_str()?.to_string(), l.get("id")?.as_str()?.to_string())))
                .collect();
            *cache = Some(map);
        }
        let map = cache.as_mut().unwrap();
        for part in [LABEL_ROOT.to_string(), name.to_string()] {
            if !map.contains_key(&part) {
                let v = self.call(reqwest::Method::POST, "https://gmail.googleapis.com/gmail/v1/users/me/labels",
                    Some(json!({"name": part, "labelListVisibility": "labelShow", "messageListVisibility": "show"})))?;
                map.insert(part.clone(), v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string());
            }
        }
        Ok(map[name].clone())
    }
}

// --- email -----------------------------------------------------------------------------------------

/// Files in a folder of your Google Drive that Job Hunt made (it can't see any others).
pub trait Files: Send + Sync {
    /// A file's contents, or None if there's no such file.
    fn read(&self, name: &str) -> R<Option<Vec<u8>>>;
    /// Make or replace a file.
    fn write(&self, name: &str, bytes: &[u8], mime: &str) -> R<()>;
    fn remove(&self, name: &str) -> R<()>;
}

/// A Drive error that needs you to sign in to Google again, to allow Drive.
fn drive_error(e: Error) -> Error {
    if e.0.contains("403") && (e.0.contains("has not been used") || e.0.contains("is disabled")) {
        return Error("The Google Drive API is off in your Google project. Turn it on at console.cloud.google.com \u{2192} APIs & Services \u{2192} Library \u{2192} Google Drive API, then sync again.".into());
    }
    if e.0.contains("403") && (e.0.contains("scope") || e.0.contains("insufficient") || e.0.contains("Insufficient")) {
        Error("Job Hunt isn't allowed to use Google Drive yet. Reconnect Google in Settings \u{2192} Accounts, and allow Drive.".into())
    } else {
        e
    }
}

const DRIVE: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";

impl Google {
    /// The id of a file in the Job Hunt folder (or of the folder itself, for name ""), if there is one.
    fn drive_id(&self, name: &str, create_folder: bool) -> R<Option<String>> {
        if let Some(id) = self.drive_ids.lock().unwrap().get(name) {
            return Ok(Some(id.clone()));
        }
        let q = |s: &str| s.replace('\\', "\\\\").replace('\'', "\\'");
        let query = if name.is_empty() {
            format!("name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", q(DRIVE_FOLDER))
        } else {
            let Some(folder) = self.drive_id("", create_folder)? else { return Ok(None) };
            format!("name = '{}' and '{folder}' in parents and trashed = false", q(name))
        };
        let mut u = url::Url::parse(DRIVE).expect("drive url");
        u.query_pairs_mut().append_pair("q", &query).append_pair("fields", "files(id)").append_pair("orderBy", "modifiedTime desc").append_pair("spaces", "drive");
        let v = self.call(reqwest::Method::GET, u.as_str(), None).map_err(drive_error)?;
        let mut id = v["files"].get(0).and_then(|f| f["id"].as_str()).map(String::from);
        if id.is_none() && name.is_empty() && create_folder {
            let made = self.call(reqwest::Method::POST, &format!("{DRIVE}?fields=id"), Some(json!({ "name": DRIVE_FOLDER, "mimeType": "application/vnd.google-apps.folder" }))).map_err(drive_error)?;
            id = made["id"].as_str().map(String::from);
        }
        if let Some(i) = &id {
            self.drive_ids.lock().unwrap().insert(name.to_string(), i.clone());
        }
        Ok(id)
    }

    /// An upload can take a while for the full copy: its own client with a long timeout.
    fn upload(&self, url: &str, method: reqwest::Method, meta: Value, bytes: &[u8], mime: &str) -> R<String> {
        let long = reqwest::blocking::Client::builder().timeout(Duration::from_secs(600)).build()?;
        // A resumable upload in one go: ask for an upload address, then send the bytes there.
        let r = long.request(method, url).bearer_auth(self.bearer()?).header("X-Upload-Content-Type", mime).json(&meta).send()?;
        if !r.status().is_success() {
            let status = r.status();
            let v: Value = r.json().unwrap_or(Value::Null);
            return Err(drive_error(Error(format!("Google said {status}: {}", v.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("")))));
        }
        let at = r.headers().get("location").and_then(|l| l.to_str().ok()).map(String::from).ok_or_else(|| Error("Google Drive didn't give an upload address.".into()))?;
        let r = long.put(&at).header("Content-Type", mime).body(bytes.to_vec()).send()?;
        let status = r.status();
        let v: Value = r.json().unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(Error(format!("Google Drive said {status} to the upload: {}", v.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or(""))));
        }
        Ok(v["id"].as_str().unwrap_or("").to_string())
    }
}

impl Files for Google {
    fn read(&self, name: &str) -> R<Option<Vec<u8>>> {
        let Some(id) = self.drive_id(name, false)? else { return Ok(None) };
        let r = self.http.get(format!("{DRIVE}/{id}?alt=media")).bearer_auth(self.bearer()?).send()?;
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            self.drive_ids.lock().unwrap().remove(name);
            return Ok(None);
        }
        if !r.status().is_success() {
            return Err(drive_error(Error(format!("Google said {} reading {name} from Drive", r.status()))));
        }
        Ok(Some(r.bytes()?.to_vec()))
    }

    fn write(&self, name: &str, bytes: &[u8], mime: &str) -> R<()> {
        let folder = self.drive_id("", true)?.ok_or_else(|| Error("Couldn't make the Job Hunt folder in Google Drive.".into()))?;
        let id = match self.drive_id(name, true)? {
            Some(id) => match self.upload(&format!("{DRIVE_UPLOAD}/{id}?uploadType=resumable&fields=id"), reqwest::Method::PATCH, json!({}), bytes, mime) {
                Ok(id) => id,
                // Deleted in Drive meanwhile: make it again.
                Err(e) if e.0.contains("404") => {
                    self.drive_ids.lock().unwrap().remove(name);
                    self.upload(&format!("{DRIVE_UPLOAD}?uploadType=resumable&fields=id"), reqwest::Method::POST, json!({ "name": name, "parents": [folder] }), bytes, mime)?
                }
                Err(e) => return Err(e),
            },
            None => self.upload(&format!("{DRIVE_UPLOAD}?uploadType=resumable&fields=id"), reqwest::Method::POST, json!({ "name": name, "parents": [folder] }), bytes, mime)?,
        };
        if !id.is_empty() {
            self.drive_ids.lock().unwrap().insert(name.to_string(), id);
        }
        Ok(())
    }

    fn remove(&self, name: &str) -> R<()> {
        let Some(id) = self.drive_id(name, false)? else { return Ok(()) };
        let r = self.http.delete(format!("{DRIVE}/{id}")).bearer_auth(self.bearer()?).send()?;
        self.drive_ids.lock().unwrap().remove(name);
        if !r.status().is_success() && r.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(drive_error(Error(format!("Google said {} removing {name} from Drive", r.status()))));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct Email {
    pub id: String,
    pub thread_id: String,
    pub from: String,
    pub to: String,
    pub date: String,
    pub subject: String,
    pub message_id: String,
    pub references: String,
    pub body: String,
    pub received_at: String,
}

fn b64url(data: &str) -> Vec<u8> {
    URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')).unwrap_or_default()
}

/// Plain-text body of a Gmail message payload, falling back to stripped HTML.
pub fn message_body(payload: &Value) -> String {
    fn walk(p: &Value, plain: &mut Vec<String>, html: &mut Vec<String>) {
        let mime = p.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
        if let Some(d) = p.pointer("/body/data").and_then(|d| d.as_str()) {
            let text = String::from_utf8_lossy(&b64url(d)).to_string();
            if mime == "text/plain" {
                plain.push(text);
            } else if mime == "text/html" {
                html.push(text);
            }
        }
        for c in p.get("parts").and_then(|x| x.as_array()).into_iter().flatten() {
            walk(c, plain, html);
        }
    }
    let (mut plain, mut html) = (vec![], vec![]);
    walk(payload, &mut plain, &mut html);
    if !plain.is_empty() {
        plain.join("\n").trim().to_string()
    } else {
        crate::util::html_to_text(&html.join("\n"))
    }
}

pub fn parse_message(m: &Value) -> Email {
    let headers = m.pointer("/payload/headers").and_then(|h| h.as_array()).cloned().unwrap_or_default();
    let h = |name: &str| {
        headers.iter().find(|x| x.get("name").and_then(|n| n.as_str()).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
            .and_then(|x| x.get("value").and_then(|v| v.as_str())).unwrap_or("").to_string()
    };
    let ms = m.get("internalDate").and_then(|d| d.as_str()).and_then(|d| d.parse::<i64>().ok()).unwrap_or(0);
    Email {
        id: m.get("id").and_then(|x| x.as_str()).unwrap_or("").into(),
        thread_id: m.get("threadId").and_then(|x| x.as_str()).unwrap_or("").into(),
        from: h("From"),
        to: h("To"),
        date: h("Date"),
        subject: h("Subject"),
        message_id: h("Message-ID"),
        references: h("References"),
        body: message_body(m.get("payload").unwrap_or(&Value::Null)),
        received_at: DateTime::from_timestamp_millis(ms).unwrap_or_default().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    }
}

/// The address part of a From header: "Jane <j@x.com>" -> "j@x.com".
pub fn address(header: &str) -> String {
    match (header.rfind('<'), header.rfind('>')) {
        (Some(a), Some(b)) if a < b => header[a + 1..b].trim().to_lowercase(),
        _ => header.trim().to_lowercase(),
    }
}

fn header_value(s: &str) -> String {
    if s.is_ascii() {
        s.replace(['\r', '\n'], " ")
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(s.replace(['\r', '\n'], " ")))
    }
}

/// A MIME message: plain-text body, optional attachments.
pub fn build_mime(from: &str, to: &str, subject: &str, body: &str, extra_headers: &[(&str, &str)], attachments: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut m = String::new();
    if !from.is_empty() {
        m.push_str(&format!("From: {}\r\n", header_value(from)));
    }
    m.push_str(&format!("To: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\n", header_value(to), header_value(subject)));
    for (k, v) in extra_headers {
        if !v.is_empty() {
            m.push_str(&format!("{k}: {}\r\n", header_value(v)));
        }
    }
    let text = STANDARD.encode(body.replace("\r\n", "\n").replace('\n', "\r\n"));
    let wrap = |s: &str| s.as_bytes().chunks(76).map(|c| String::from_utf8_lossy(c).to_string()).collect::<Vec<_>>().join("\r\n");
    if attachments.is_empty() {
        m.push_str("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
        m.push_str(&wrap(&text));
        m.push_str("\r\n");
        return m.into_bytes();
    }
    let boundary = format!("jobhunt-{}", URL_SAFE_NO_PAD.encode(rand::random::<[u8; 12]>()));
    m.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"));
    m.push_str(&format!("--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n", wrap(&text)));
    for (name, bytes) in attachments {
        let ctype = if name.ends_with(".docx") {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        } else if name.ends_with(".pdf") {
            "application/pdf"
        } else {
            "application/octet-stream"
        };
        m.push_str(&format!(
            "--{boundary}\r\nContent-Type: {ctype}; name=\"{name}\"\r\nContent-Disposition: attachment; filename=\"{name}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
            wrap(&STANDARD.encode(bytes))
        ));
    }
    m.push_str(&format!("--{boundary}--\r\n"));
    m.into_bytes()
}

/// Gmail as the pipeline uses it (faked in tests).
pub trait Mail: Send + Sync {
    fn recent(&self, query: &str, limit: usize) -> R<Vec<String>>;
    fn get(&self, id: &str) -> R<Email>;
    fn label(&self, id: &str, name: &str) -> R<()>;
    fn draft_reply(&self, original: &Email, body: &str) -> R<String>;
    fn send(&self, to: &str, subject: &str, body: &str, attachments: &[PathBuf]) -> R<String>;
    /// A new email saved as a draft for you to check and send. `to` may be empty.
    fn draft(&self, to: &str, subject: &str, body: &str) -> R<String>;
}

impl Mail for Google {
    fn recent(&self, query: &str, limit: usize) -> R<Vec<String>> {
        let mut ids = vec![];
        let mut page: Option<String> = None;
        while ids.len() < limit {
            let mut url = url::Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/messages").unwrap();
            url.query_pairs_mut().append_pair("q", query).append_pair("maxResults", "100");
            if let Some(p) = &page {
                url.query_pairs_mut().append_pair("pageToken", p);
            }
            let v = self.call(reqwest::Method::GET, url.as_str(), None)?;
            for m in v.get("messages").and_then(|m| m.as_array()).into_iter().flatten() {
                if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                    ids.push(id.to_string());
                }
            }
            page = v.get("nextPageToken").and_then(|p| p.as_str()).map(|s| s.to_string());
            if page.is_none() {
                break;
            }
        }
        ids.truncate(limit);
        Ok(ids)
    }

    fn get(&self, id: &str) -> R<Email> {
        let v = self.call(reqwest::Method::GET, &format!("https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=full"), None)?;
        Ok(parse_message(&v))
    }

    fn label(&self, id: &str, name: &str) -> R<()> {
        let label = self.label_id(&format!("{LABEL_ROOT}/{name}"))?;
        self.call(reqwest::Method::POST, &format!("https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}/modify"), Some(json!({"addLabelIds": [label]})))?;
        Ok(())
    }

    fn draft_reply(&self, o: &Email, body: &str) -> R<String> {
        let subject = if o.subject.to_lowercase().starts_with("re:") { o.subject.clone() } else { format!("Re: {}", o.subject) };
        let refs = format!("{} {}", o.references, o.message_id).trim().to_string();
        let raw = build_mime("", &o.from, &subject, body, &[("In-Reply-To", &o.message_id), ("References", &refs)], &[]);
        let v = self.call(reqwest::Method::POST, "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
            Some(json!({"message": {"raw": URL_SAFE_NO_PAD.encode(raw), "threadId": o.thread_id}})))?;
        Ok(v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }

    fn draft(&self, to: &str, subject: &str, body: &str) -> R<String> {
        let raw = build_mime("", to, subject, body, &[], &[]);
        let v = self.call(reqwest::Method::POST, "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
            Some(json!({"message": {"raw": URL_SAFE_NO_PAD.encode(raw)}})))?;
        Ok(v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }

    fn send(&self, to: &str, subject: &str, body: &str, attachments: &[PathBuf]) -> R<String> {
        let mut files = vec![];
        for p in attachments {
            files.push((p.file_name().unwrap_or_default().to_string_lossy().to_string(), std::fs::read(p)?));
        }
        let raw = build_mime("", to, subject, body, &[], &files);
        let v = self.call(reqwest::Method::POST, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            Some(json!({"raw": URL_SAFE_NO_PAD.encode(raw)})))?;
        Ok(v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }
}

// --- calendar --------------------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct NewEvent {
    pub summary: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub description: String,
    pub location: Option<String>,
    pub color: Option<String>,
    pub reminders: Option<Vec<i64>>,
}

/// An event in your Google Calendar, as the calendar sync sees it.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct CalItem {
    pub id: String,
    pub summary: String,
    pub description: String,
    /// RFC 3339; for an all-day event, its date at midnight UTC.
    pub start: String,
    pub end: String,
    pub all_day: bool,
    /// Deleted in Google Calendar.
    pub cancelled: bool,
}

/// Google Calendar as the pipeline uses it (faked in tests).
pub trait Cal: Send + Sync {
    fn busy(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> R<Busy>;
    fn create(&self, e: &NewEvent) -> R<String>;
    /// Events between two times, deleted ones included (marked cancelled).
    fn events(&self, _start: DateTime<Utc>, _end: DateTime<Utc>) -> R<Vec<CalItem>> {
        Ok(vec![])
    }
}

/// One event from Google Calendar's events.list.
pub fn parse_cal_item(v: &Value) -> Option<CalItem> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let when = |k: &str| -> (String, bool) {
        let o = v.get(k);
        if let Some(t) = o.and_then(|o| o.get("dateTime")).and_then(|x| x.as_str()) {
            return (DateTime::parse_from_rfc3339(t).map(|d| d.with_timezone(&Utc).to_rfc3339()).unwrap_or_default(), false);
        }
        let d = o.and_then(|o| o.get("date")).and_then(|x| x.as_str()).unwrap_or("");
        (if d.is_empty() { String::new() } else { format!("{d}T00:00:00+00:00") }, true)
    };
    let id = s("id");
    if id.is_empty() {
        return None;
    }
    let (start, all_day) = when("start");
    let (end, _) = when("end");
    Some(CalItem { id, summary: s("summary"), description: s("description"), start, end, all_day, cancelled: s("status") == "cancelled" })
}

impl Cal for Google {
    fn busy(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> R<Busy> {
        let v = self.call(reqwest::Method::POST, "https://www.googleapis.com/calendar/v3/freeBusy", Some(json!({
            "timeMin": start.to_rfc3339(), "timeMax": end.to_rfc3339(), "items": [{"id": self.calendar_id}],
        })))?;
        let mut out = vec![];
        for b in v.pointer(&format!("/calendars/{}/busy", self.calendar_id.replace('~', "~0").replace('/', "~1"))).and_then(|b| b.as_array()).into_iter().flatten() {
            let s = b.get("start").and_then(|x| x.as_str()).and_then(|x| DateTime::parse_from_rfc3339(x).ok());
            let e = b.get("end").and_then(|x| x.as_str()).and_then(|x| DateTime::parse_from_rfc3339(x).ok());
            if let (Some(s), Some(e)) = (s, e) {
                out.push((s.with_timezone(&Utc), e.with_timezone(&Utc)));
            }
        }
        Ok(out)
    }

    fn create(&self, e: &NewEvent) -> R<String> {
        let mut body = json!({
            "summary": e.summary, "description": e.description,
            "start": {"dateTime": e.start.to_rfc3339()}, "end": {"dateTime": e.end.to_rfc3339()},
        });
        if let Some(l) = &e.location {
            body["location"] = json!(l);
        }
        if let Some(c) = &e.color {
            body["colorId"] = json!(c);
        }
        if let Some(r) = &e.reminders {
            body["reminders"] = json!({"useDefault": false, "overrides": r.iter().map(|m| json!({"method": "popup", "minutes": m})).collect::<Vec<_>>()});
        }
        let id = url::form_urlencoded::byte_serialize(self.calendar_id.as_bytes()).collect::<String>();
        let v = self.call(reqwest::Method::POST, &format!("https://www.googleapis.com/calendar/v3/calendars/{id}/events"), Some(body))?;
        Ok(v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }

    fn events(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> R<Vec<CalItem>> {
        let id = url::form_urlencoded::byte_serialize(self.calendar_id.as_bytes()).collect::<String>();
        let enc = |t: DateTime<Utc>| url::form_urlencoded::byte_serialize(t.to_rfc3339().as_bytes()).collect::<String>();
        let mut out = vec![];
        let mut page = String::new();
        for _ in 0..5 {
            let url = format!("https://www.googleapis.com/calendar/v3/calendars/{id}/events?timeMin={}&timeMax={}&singleEvents=true&showDeleted=true&maxResults=250{}",
                enc(start), enc(end), if page.is_empty() { String::new() } else { format!("&pageToken={page}") });
            let v = self.call(reqwest::Method::GET, &url, None)?;
            out.extend(v.get("items").and_then(|i| i.as_array()).into_iter().flatten().filter_map(parse_cal_item));
            match v.get("nextPageToken").and_then(|t| t.as_str()) {
                Some(t) => page = t.to_string(),
                None => break,
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signing_in_by_pasting_the_address() {
        let c = parse_client(r#"{"installed": {"client_id": "id.apps.googleusercontent.com", "client_secret": "s"}}"#).unwrap();
        let p = start_pasted(&c).unwrap();
        let u = url::Url::parse(&p.url).unwrap();
        let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
        assert_eq!((q["redirect_uri"].as_str(), q["state"].as_str(), q["code_challenge_method"].as_str()), ("http://127.0.0.1:1/", p.state.as_str(), "S256"));
        assert!(q["scope"].contains("drive.file") && q["access_type"] == "offline");
        // Checked before anything is sent to Google.
        let wrong = format!("http://127.0.0.1:1/?state=other&code=4/abc&scope=x");
        assert!(finish_pasted(&c, &p, &wrong).unwrap_err().0.contains("different sign-in"));
        assert!(finish_pasted(&c, &p, &format!("http://127.0.0.1:1/?state={}", p.state)).unwrap_err().0.contains("no sign-in code"));
        assert!(finish_pasted(&c, &p, "http://127.0.0.1:1/?error=access_denied").unwrap_err().0.contains("add your Gmail address"));
        let all = SCOPES.join(" ");
        assert!(missing_permissions(&all).is_empty());
        assert_eq!(missing_permissions(&SCOPES[..2].join(" ")), vec!["your calendar (to book interviews)", "its own folder in your Google Drive (for sync)"]);
        assert!(finish_pasted(&c, &p, "just some words").unwrap_err().0.contains("whole address"));
    }

    #[test]
    fn drive_errors_say_what_to_do() {
        assert!(drive_error(Error("Google said 403 Forbidden: Request had insufficient authentication scopes.".into())).0.contains("Reconnect Google"));
        assert!(drive_error(Error("Google said 403 Forbidden: Google Drive API has not been used in project 123 before or it is disabled.".into())).0.contains("Turn it on"));
        assert!(drive_error(Error("Google said 500: oops".into())).0.contains("500"));
    }

    #[test]
    fn calendar_items() {
        let e = parse_cal_item(&json!({"id": "a", "summary": "Interview – Big Bank", "status": "confirmed",
            "start": {"dateTime": "2026-10-22T14:00:00-04:00"}, "end": {"dateTime": "2026-10-22T15:00:00-04:00"}})).unwrap();
        assert_eq!((e.start.as_str(), e.all_day, e.cancelled), ("2026-10-22T18:00:00+00:00", false, false));
        let d = parse_cal_item(&json!({"id": "b", "status": "cancelled", "start": {"date": "2026-10-23"}})).unwrap();
        assert!(d.all_day && d.cancelled && d.start.starts_with("2026-10-23"));
        assert!(parse_cal_item(&json!({"summary": "no id"})).is_none());
    }

    #[test]
    fn client_file() {
        assert!(parse_client(r#"{"web": {}}"#).unwrap_err().0.contains("Desktop app"));
        assert!(parse_client("nope").is_err());
        let c = parse_client(r#"{"installed": {"client_id": "id", "client_secret": "s"}}"#).unwrap();
        assert_eq!(c.token_uri, "https://oauth2.googleapis.com/token");
    }

    #[test]
    fn bodies_and_headers() {
        let enc = |s: &str| URL_SAFE_NO_PAD.encode(s);
        let payload = json!({"mimeType": "multipart/alternative", "parts": [
            {"mimeType": "text/html", "body": {"data": enc("<p>Hi <b>there</b></p>")}},
            {"mimeType": "text/plain", "body": {"data": enc("Hi there")}}]});
        assert_eq!(message_body(&payload), "Hi there");
        assert_eq!(message_body(&json!({"mimeType": "text/html", "body": {"data": enc("<p>Hi</p>")}})), "Hi");
        let m = parse_message(&json!({"id": "m1", "threadId": "t1", "internalDate": "1760450400000",
            "payload": {"headers": [{"name": "From", "value": "Rec <r@acme.com>"}, {"name": "subject", "value": "Interview"}],
                        "mimeType": "text/plain", "body": {"data": enc("Hello")}}}));
        assert_eq!((m.subject.as_str(), m.body.as_str(), address(&m.from).as_str()), ("Interview", "Hello", "r@acme.com"));
        assert!(m.received_at.starts_with("2025-10-14"));
    }

    #[test]
    fn mime_with_attachment() {
        let raw = String::from_utf8(build_mime("", "jobs@x.com", "Application – Jane", "Hello\nThere", &[("In-Reply-To", "<a@b>")], &[("CV.docx".into(), vec![1, 2, 3])])).unwrap();
        assert!(raw.contains("Subject: =?UTF-8?B?"));
        assert!(raw.contains("In-Reply-To: <a@b>"));
        assert!(raw.contains("multipart/mixed") && raw.contains("filename=\"CV.docx\"") && raw.contains("AQID"));
        assert!(raw.contains(&STANDARD.encode("Hello\r\nThere")));
    }
}
