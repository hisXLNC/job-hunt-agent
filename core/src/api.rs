//! Requests from the app window, answered inside the app through the private jobhunt:// address.
//! The window code supplies a `Host` for the few things only it can do (open files and links,
//! start at sign-in, serve the bundled screens); everything else is answered here.

use crate::claude;
use crate::cv;
use crate::db::STATUSES;
use crate::google;
use crate::pipeline::{run_in_background, Agent};
use crate::profile::Profile;
use crate::{Error, R};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct Req {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub body: Vec<u8>,
    /// From a web browser (Remote access or the server), not the app window: files and links are
    /// handed back for the browser to open instead of opening on this computer.
    pub remote: bool,
}

impl Req {
    pub fn json(&self) -> R<Value> {
        if self.body.is_empty() {
            return Ok(json!({}));
        }
        serde_json::from_slice(&self.body).map_err(|_| Error("The request wasn't valid JSON.".into()))
    }
}

pub struct Resp {
    pub status: u16,
    pub ctype: String,
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

impl Resp {
    pub fn json(v: &Value) -> Resp {
        Resp { status: 200, ctype: "application/json; charset=utf-8".into(), body: serde_json::to_vec(v).unwrap_or_default(), headers: vec![("Cache-Control".into(), "no-store".into())] }
    }
    pub fn error(status: u16, msg: &str) -> Resp {
        Resp { status, ..Resp::json(&json!({ "error": msg })) }
    }
    fn bytes(body: Vec<u8>, ctype: &str) -> Resp {
        Resp { status: 200, ctype: ctype.into(), body, headers: vec![("Cache-Control".into(), "no-cache".into())] }
    }
    /// A file to save, with its name.
    fn download(path: &Path) -> R<Resp> {
        let body = std::fs::read(path).map_err(|_| Error("That file isn't there any more.".into()))?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
        let ctype = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
            "pdf" => "application/pdf",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "zip" => "application/zip",
            "md" => "text/markdown; charset=utf-8",
            _ => "application/octet-stream",
        };
        let ascii: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || " .-_()".contains(c) { c } else { '_' }).collect();
        let encoded: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>().replace('+', "%20");
        Ok(Resp {
            status: 200,
            ctype: ctype.into(),
            body,
            headers: vec![
                ("Cache-Control".into(), "no-store".into()),
                ("Content-Disposition".into(), format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")),
            ],
        })
    }
}

/// What only the window side can do.
pub trait Host: Send + Sync {
    fn asset(&self, path: &str) -> Option<Vec<u8>>;
    fn open_url(&self, url: &str) -> R<()>;
    fn open_path(&self, path: &Path) -> R<()>;
    fn autostart(&self) -> bool;
    fn set_autostart(&self, on: bool) -> R<()>;
    fn version(&self) -> String;
    /// Look for a newer version: {available, current, version, notes, history, date, error}.
    fn update_check(&self) -> Value;
    /// Download and install the newest version, then restart. Ok(false) if there was none.
    fn update_install(&self) -> R<bool>;
    /// Open a job's application form in a window where Job Hunt fills it in (the desktop app only).
    fn fill_application(&self, _job_id: &str, _url: &str) -> R<()> {
        Err(Error("Filling in forms works in the Job Hunt app on your PC.".into()))
    }
    /// Whether `fill_application` works here.
    fn can_fill(&self) -> bool {
        false
    }
    /// "desktop" for the Windows app, "server" for the Synology / Docker version.
    fn kind(&self) -> &'static str {
        "desktop"
    }
    /// Start again (to apply a restore).
    fn restart(&self) {}
    /// Let you choose a folder in the system's folder dialog, starting at `start`. Ok(None) when
    /// you cancel. Only the Windows app has one.
    fn pick_folder(&self, _start: &str) -> R<Option<String>> {
        Err(Error("Choosing a folder works in the Job Hunt app on your PC; type the path instead.".into()))
    }
    /// Run a PowerShell script in a window of its own (setting up Claude Code). Only the Windows app.
    fn open_console(&self, _script: &str) -> R<()> {
        Err(Error("This works in the Job Hunt app on a Windows PC.".into()))
    }
    /// Whether `open_console` works here.
    fn can_console(&self) -> bool {
        false
    }
    /// How Claude Desktop starts Job Hunt as a tool (program and arguments), where it can.
    fn mcp_command(&self) -> Option<(String, Vec<String>)> {
        None
    }
}

/// Claude's career advice, written in the background (after a CV is added, or when asked). False when
/// it's already being written.
fn start_career(agent: &Arc<Agent>) -> bool {
    if agent.is_running("career") || !agent.claude_ready() {
        return false;
    }
    let a = agent.clone();
    std::thread::spawn(move || {
        let Ok(_g) = a.claim("career") else { return };
        match a.write_career_paths() {
            Ok(_) => a.note("Your career options are ready", "Roles you could go for, their pay, pros and cons, and Claude's advice: CV & career."),
            Err(e) => {
                let _ = a.db().log(None, "career:error", &e.0);
                a.note("No career paths yet", &e.0);
            }
        }
    });
    true
}

/// Searching and adding a job need Claude and at least one CV: say which is missing, before starting.
fn ready_to_search(agent: &Agent) -> R<()> {
    let p = agent.profile();
    if !p.tracks.iter().any(|t| agent.cv_path(&t.name).exists()) {
        return Err(Error("Add your CV first (CV & career): Job Hunt compares every posting with it.".into()));
    }
    if !agent.claude_ready() {
        return Err(Error("Connect Claude first (Settings → Accounts): it reads the postings.".into()));
    }
    Ok(())
}

/// Open a file on this computer, or hand the browser a link to download it.
fn give_file(host: &Arc<dyn Host>, req: &Req, path: &Path, download: String) -> R<Resp> {
    if req.remote {
        if !path.exists() {
            return Err(Error("That file isn't there any more.".into()));
        }
        return Ok(Resp::json(&json!({ "download": download })));
    }
    host.open_path(path)?;
    ok()
}

/// Open a link on this computer, or hand it to the browser.
fn give_url(host: &Arc<dyn Host>, req: &Req, url: &str) -> R<Resp> {
    if req.remote {
        return Ok(Resp::json(&json!({ "url": url })));
    }
    host.open_url(url)?;
    ok()
}

/// A job's file by name: cv, letter, cv-pdf, letter-pdf or prep. PDFs are made when missing.
fn job_file(agent: &Agent, job: &crate::db::Job, what: &str) -> R<PathBuf> {
    let need = |p: &Option<String>| p.as_deref().map(PathBuf::from).ok_or_else(|| Error("Not tailored yet.".into()));
    Ok(match what {
        "cv" => need(&job.cv_path)?,
        "letter" => need(&job.letter_path)?,
        "cv-pdf" | "letter-pdf" => {
            let docx = need(if what == "cv-pdf" { &job.cv_path } else { &job.letter_path })?;
            // Made now when there's none yet, or again when you changed the Word file since.
            crate::util::pdf_of(&docx).map_err(|e| Error(format!("Couldn't make the PDF from the Word file: {} Close it in Word and try again.", e.0)))?
        }
        "prep" => agent.application_dir(job).join("Interview prep.md"),
        _ => return Err(Error("Nothing to open.".into())),
    })
}

fn static_type(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

/// What the Send to Job Hunt button puts on the clipboard: a marker, then the posting as JSON.
pub const CLIP_MARK: &str = "JOBHUNT-CLIP:";

pub fn parse_clip(text: &str) -> Option<Value> {
    let rest = text.trim().strip_prefix(CLIP_MARK)?;
    serde_json::from_str::<Value>(rest).ok().filter(|v| v.is_object())
}

/// Add a posting sent from the browser, in the background, with a notice when it's done.
pub fn start_clip(agent: &Arc<Agent>, clip: Value) {
    let a = agent.clone();
    std::thread::spawn(move || {
        let Ok(_g) = a.claim("add") else {
            a.note("One at a time", "Job Hunt is still adding the last posting. Click the button again in a minute.");
            return;
        };
        let title = clip["title"].as_str().filter(|t| !t.is_empty()).unwrap_or("the posting").to_string();
        a.note("Adding to Job Hunt", &format!("Reading {title} and checking how well it fits…"));
        match a.add_clip(&clip) {
            Ok(j) if j.status == "ready" => a.note("Application ready", &format!("{} at {} (fit {}) has a tailored CV and cover letter waiting for your approval.", j.title, j.company, j.score.unwrap_or(0))),
            Ok(j) => a.note("Added to Job Hunt", &format!("{} at {}: fit {}.", j.title, j.company, j.score.unwrap_or(0))),
            // Already there: not a problem, and noted on that job (see add_found).
            Err(e) if e.0.ends_with("is already in Job Hunt.") => a.note("Already in Job Hunt", &e.0),
            Err(e) => {
                let _ = a.db().log(None, "add:error", &e.0);
                a.note("Couldn't add that posting", &e.0);
            }
        }
    });
}

fn ok() -> R<Resp> {
    Ok(Resp::json(&json!({ "ok": true })))
}

pub fn handle(agent: &Arc<Agent>, host: &Arc<dyn Host>, req: &Req) -> Resp {
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| route(agent, host, req)));
    match out {
        Ok(Ok(r)) => r,
        Ok(Err(e)) if e.0 == "not found" => Resp::error(404, "Not found"),
        Ok(Err(e)) => Resp::error(400, &e.0),
        Err(_) => Resp::error(500, "Something went wrong inside Job Hunt. Please try again."),
    }
}

fn not_found<T>() -> R<T> {
    Err(Error("not found".into()))
}

fn job_or_404(agent: &Agent, id: &str) -> R<crate::db::Job> {
    agent.db().job(id)?.map_or_else(not_found, Ok)
}

/// Where Job Hunt can be opened from your phone (Tailscale), when remote access is on.
pub fn remote_address(agent: &Agent) -> Option<String> {
    (agent.secret("remote.on") == "1").then(|| format!("http://{}:{}", machine_name(), remote_port_of(&agent.secret("remote.port"))))
}

fn remote_port_of(v: &str) -> u16 {
    v.parse().ok().filter(|p| *p >= 1024).unwrap_or(8790)
}

pub fn remote_port(agent: &Agent) -> u16 {
    remote_port_of(&agent.secret("remote.port"))
}

/// This computer's name, as other devices on Tailscale or the home network can reach it.
fn machine_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).map(|n| n.to_lowercase()).unwrap_or_else(|_| "this-computer".into())
}

fn settings(agent: &Agent, host: &Arc<dyn Host>) -> R<Value> {
    let p = agent.profile();
    let engine = agent.engine_name();
    let (bfolder, bfiles) = {
        let f = crate::backup::folder(agent);
        let l = crate::backup::list(&f);
        (f, l)
    };
    let signature = agent.signature();
    let sync = crate::sync::status(agent);
    let cd_config = crate::mcp::claude_desktop_config();
    // Before taking the database below: these need it too.
    let (weekly_to, next_wake) = (agent.weekly_to(), agent.next_wake().map(|t| t.to_rfc3339()));
    let site_status = agent.site_status();
    let builtin_google = google::builtin_client().is_some();
    let site_catalog: Vec<Value> = crate::sites::SITES.iter().map(|x| json!({ "id": x.id, "name": x.name, "kind": x.kind, "about": x.about, "country": x.country })).collect();
    let db = agent.db();
    let get = |k: &str| db.get(k).ok().flatten().unwrap_or_default();
    let token: google::Token = serde_json::from_str(&get("google.token")).unwrap_or_default();
    let cvs: Vec<Value> = p.tracks.iter().map(|t| {
        let path = agent.cv_path(&t.name);
        let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok()
            .map(|m| chrono::DateTime::<chrono::Utc>::from(m).to_rfc3339());
        let doc = cv::open(&path).ok();
        json!({
            "track": t.name, "label": t.label, "exists": doc.is_some(), "updated": modified,
            "kind": t.kind, "original": t.original, "titles": t.titles, "keywords": t.keywords, "letter_style": t.letter_style, "areas": t.areas,
            "paragraphs": doc.as_ref().map(|d| d.paras.iter().filter(|p| !p.plain().trim().is_empty()).count()).unwrap_or(0),
            "ats": doc.as_ref().map(crate::cv::ats_check),
            "editable": doc.as_ref().map(|d| d.paras.iter().filter(|p| p.editable).count()).unwrap_or(0),
        })
    }).collect();
    Ok(json!({
        "profile": p,
        "problems": p.problems(),
        "claude": {
            "engine": engine,
            "key": !get("claude.key").is_empty(),
            "model": get("claude.model"),
            "tailor_model": db.get("claude.tailor_model")?.unwrap_or_else(|| claude::TAILOR_MODEL.into()),
            "tailor_effort": Some(get("claude.tailor_effort")).filter(|e| !e.is_empty()).unwrap_or_else(|| claude::TAILOR_EFFORT.into()),
            "path": get("claude.path"),
            "code_found": crate::claude_code::find(&get("claude.path")).is_some(),
        },
        "adzuna": { "id": get("adzuna.id"), "key": !get("adzuna.key").is_empty() },
        "jsearch": { "key": !get("jsearch.key").is_empty(), "provider": Some(get("jsearch.provider")).filter(|p| !p.is_empty()).unwrap_or_else(|| "openwebninja".into()) },
        "jooble": { "key": !get("jooble.key").is_empty() },
        "apify": { "key": !get("apify.key").is_empty(), "actor": get("apify.actor"), "default_actor": crate::sources::APIFY_ACTOR },
        "google": {
            "client": !get("google.client").is_empty() || builtin_google,
            "own_client": !get("google.client").is_empty(),
            "builtin": builtin_google,
            "pasting": !get("google.pending").is_empty(),
            "paste_url": serde_json::from_str::<Value>(&get("google.pending")).ok().and_then(|v| v["url"].as_str().map(String::from)),
            "connected": agent.mail.read().unwrap().is_some(),
            "email": token.email,
            "connecting": agent.is_running("google"),
        },
        "cvs": cvs,
        // Where your CVs, tailored applications and backups are (chosen at setup or in Settings).
        "files": { "folder": agent.files().to_string_lossy(), "chosen": agent.files() != agent.data },
        "backup": {
            "dir": get("backup.dir"),
            "folder": bfolder.to_string_lossy(),
            "secrets": get("backup.secrets") == "1",
            "last": get("last.backup"),
            "files": bfiles.iter().take(crate::backup::KEEP).map(|(n, size)| json!({"name": n, "size": size})).collect::<Vec<_>>(),
        },
        "remote": {
            "on": get("remote.on") == "1",
            "port": remote_port_of(&get("remote.port")),
            "password": get("remote.password").contains('$'),
            "address": format!("http://{}:{}", machine_name(), remote_port_of(&get("remote.port"))),
            "here": false,
        },
        "kind": host.kind(),
        "sync": sync,
        "sites": { "catalog": site_catalog, "status": site_status },
        "career": serde_json::from_str::<Value>(&get("career")).ok(),
        "career_thinking": agent.is_running("career"),
        "countries": crate::profile::COUNTRIES.iter().map(|c| json!({ "code": c.0, "name": c.1, "tz": c.3,
            "cities": crate::profile::CITIES.iter().find(|x| x.0 == c.0).map(|x| x.1).unwrap_or(&[]) })).collect::<Vec<_>>(),
        "weekly": { "day": if get("weekly.day") == "mon" { "mon" } else { "sun" }, "email": get("weekly.email") != "0", "to": weekly_to },
        "phone": { "topic": get("phone.topic"), "server": get("phone.server"), "urgent_only": get("phone.urgent_only") == "1", "details": get("phone.details") == "1" },
        "clip_watch": get("clip.watch") != "0",
        "ratings_auto": get("ratings.auto") != "0",
        "claude_desktop": {
            "available": host.mcp_command().is_some(),
            "added": cd_config.as_deref().map(crate::mcp::in_claude_desktop).unwrap_or(false),
            "config": cd_config,
        },
        "signature": signature.and_then(|b| crate::cv::image_info(&b).map(|(ext, _, _)| {
            use base64::Engine;
            format!("data:image/{ext};base64,{}", base64::engine::general_purpose::STANDARD.encode(&b))
        })),
        "app": { "version": host.version(), "autostart": host.autostart(), "close": Some(get("app.close")).filter(|c| !c.is_empty()).unwrap_or_else(|| "tray".into()), "keep_awake": get("app.keep_awake") != "0", "wake": get("app.wake") == "1", "next_wake": next_wake, "last_wake": get("last.wake"), "data": agent.data.to_string_lossy() },
    }))
}

fn route(agent: &Arc<Agent>, host: &Arc<dyn Host>, req: &Req) -> R<Resp> {
    let p = req.path.as_str();
    let m = req.method.as_str();
    let parts: Vec<&str> = p.trim_matches('/').split('/').collect();

    if m == "GET" {
        if p == "/" || p == "/index.html" {
            return host.asset("index.html").map(|b| Resp::bytes(b, "text/html; charset=utf-8")).map_or_else(not_found, Ok);
        }
        if let Some(rel) = p.strip_prefix("/static/") {
            if rel.contains("..") {
                return not_found();
            }
            return host.asset(rel).map(|b| Resp::bytes(b, static_type(rel))).map_or_else(not_found, Ok);
        }
        match parts.as_slice() {
            ["api", "overview"] => {
                let mut o = agent.overview()?;
                o["version"] = json!(host.version());
                o["side"] = agent.side_status();
                return Ok(Resp::json(&o));
            }
            ["api", "usage"] => return Ok(Resp::json(&agent.usage_summary())),
            ["api", "recruiters.csv"] => {
                let _ = crate::recruiters::backfill(agent);
                return Ok(Resp {
                    status: 200,
                    ctype: "text/csv; charset=utf-8".into(),
                    body: crate::recruiters::csv(agent).into_bytes(),
                    headers: vec![("Cache-Control".into(), "no-store".into()), ("Content-Disposition".into(), "attachment; filename=\"Job Hunt recruiters.csv\"".into())],
                });
            }
            ["api", "recruiters"] => {
                let _ = crate::recruiters::backfill(agent);
                let links = agent.db().recruiter_links(None, None)?;
                let mut list = crate::recruiters::list(agent);
                list.sort_by(|a, b| b.last_at.cmp(&a.last_at));
                let mail = agent.mail.read().unwrap().is_some();
                // How many postings at each one's company, in your lists.
                let jobs = agent.db().jobs(None, 5000)?;
                let rows: Vec<Value> = list.iter().map(|r| {
                    let open: Vec<Value> = jobs.iter().filter(|j| ["queued", "ready", "approved", "applied", "saved"].contains(&j.status.as_str())
                        && crate::recruiters::for_company(std::slice::from_ref(r), &j.company).is_some()).take(5)
                        .map(|j| json!({ "id": j.id, "title": j.title, "status": j.status })).collect();
                    let mut v = serde_json::to_value(r).unwrap_or_default();
                    v.as_object_mut().map(|o| o.remove("gmail_ids"));
                    v["jobs"] = json!(open);
                    v["applications"] = json!(links.iter().filter(|l| l["email"] == r.email.as_str()).cloned().collect::<Vec<_>>());
                    v
                }).collect();
                return Ok(Resp::json(&json!({ "recruiters": rows, "last": agent.secret("last.recruiters"), "scanning": agent.is_running("recruiters"), "gmail": mail,
                    "on_apply": { "mode": crate::recruiters::apply_mode(agent), "attach_cv": agent.secret("apply.recruiter_cv") == "1" } })));
            }
            ["api", "results"] => {
                let mut r = agent.results()?;
                r["thinking"] = json!(agent.is_running("insights"));
                r["career_thinking"] = json!(agent.is_running("career"));
                return Ok(Resp::json(&r));
            }
            ["api", "sources", "test"] => {
                let last: Value = serde_json::from_str(&agent.secret("sources.test")).unwrap_or(Value::Null);
                return Ok(Resp::json(&json!({ "running": agent.is_running("test-sources"), "last": last })));
            }
            ["api", "tracker"] => return Ok(Resp::json(&json!({ "rows": agent.tracker(None)? }))),
            ["api", "connections"] => {
                let testing = agent.is_running("test-sources");
                // While testing: which one (none: all), and how far along.
                let t: Value = if testing { serde_json::from_str(&agent.secret("sources.test")).unwrap_or(Value::Null) } else { Value::Null };
                let progress = testing.then(|| json!({ "only": t["only"], "done": t["done"], "total": t["total"] }));
                return Ok(Resp::json(&json!({ "rows": agent.connections()?, "testing": testing, "progress": progress })));
            }
            ["api", "rescore"] => {
                let group = req.query.get("group").map(|s| s.as_str()).unwrap_or("skipped");
                let mut plan = agent.rescore_plan(group)?;
                plan["running"] = json!(agent.is_running("rescore"));
                return Ok(Resp::json(&plan));
            }
            ["api", "jobs"] => {
                let status = req.query.get("status").map(|s| s.as_str()).filter(|s| !s.is_empty());
                let pdf = |p: &Option<String>| p.as_deref().map(|p| Path::new(p).with_extension("pdf").exists()).unwrap_or(false);
                let (now, reposts) = (chrono::Utc::now(), agent.db().reposts()?);
                let list = agent.db().jobs(status, 2000)?;
                // Each company's rating, read once.
                let rated: std::collections::HashMap<String, Value> = {
                    let db = agent.db();
                    list.iter().map(|j| crate::db::company_key(&j.company)).collect::<std::collections::HashSet<_>>().into_iter()
                        .filter_map(|k| list.iter().find(|j| crate::db::company_key(&j.company) == k).and_then(|j| db.rating(&j.company)).map(|r| (k, crate::pipeline::rating_brief(&r))))
                        .collect()
                };
                let jobs: Vec<Value> = list.iter().map(|j| {
                    let mut b = j.brief();
                    if let Some(r) = rated.get(&crate::db::company_key(&j.company)) {
                        b["rating"] = r.clone();
                    }
                    b["warnings"] = json!(crate::pipeline::posting_warnings(j, reposts.get(&j.id).copied().unwrap_or(0), now));
                    // Postings found before salaries were read from the text.
                    if j.salary.is_none() {
                        b["salary"] = json!(crate::sources::salary_from_text(&j.description).map(|(t, _)| t));
                    }
                    if j.deadline.is_none() {
                        b["deadline"] = json!(crate::sources::deadline_from_text(&j.description, chrono::Utc::now().date_naive()).map(|d| d.to_string()));
                    }
                    b["cv_pdf"] = json!(pdf(&j.cv_path));
                    b["letter_pdf"] = json!(pdf(&j.letter_path));
                    b
                }).collect();
                return Ok(Resp::json(&json!({ "jobs": jobs, "counts": agent.db().counts()? })));
            }
            ["api", "jobs", id, "download", what] => {
                let job = job_or_404(agent, id)?;
                return Resp::download(&job_file(agent, &job, what)?);
            }
            ["api", "cvs", id, "download"] => {
                if !agent.profile().tracks.iter().any(|t| t.name == *id) {
                    return not_found();
                }
                return Resp::download(&agent.cv_path(id));
            }
            ["api", "backup", "download", name] => {
                // Only backups listed in the backup folder, by exact name.
                let dir = crate::backup::folder(agent);
                if !crate::backup::list(&dir).iter().any(|(n, _)| n == name) {
                    return not_found();
                }
                return Resp::download(&dir.join(name));
            }
            ["api", "jobs", id, "preview"] => {
                let job = job_or_404(agent, id)?;
                // The tailored CV as it is on disk now, with the reworded paragraphs marked.
                let changed: Vec<String> = job.cv_changes.iter().map(|c| c.after.replace("**", "").trim().to_string()).collect();
                let cv = match job.cv_path.as_deref().map(|p| crate::cv::open(Path::new(p))) {
                    Some(Ok(doc)) => {
                        let blocks = crate::cv::preview(&doc).into_iter().map(|mut b| {
                            let plain = b["text"].as_str().unwrap_or("").replace("**", "");
                            b["changed"] = json!(!plain.trim().is_empty() && changed.iter().any(|c| c == plain.trim()));
                            b
                        }).collect::<Vec<_>>();
                        json!(blocks)
                    }
                    _ => Value::Null,
                };
                return Ok(Resp::json(&json!({ "cv": cv })));
            }
            ["api", "jobs", id] => {
                let job = job_or_404(agent, id)?;
                let history = agent.db().history(id)?;
                let pdf = |p: &Option<String>| p.as_deref().map(|p| !crate::util::pdf_stale(Path::new(p))).unwrap_or(false);
                return Ok(Resp::json(&json!({
                    "warnings": crate::pipeline::posting_warnings(&job, agent.db().reposts()?.get(&job.id).copied().unwrap_or(0), chrono::Utc::now()),
                    "job": job, "history": history, "progress": agent.tracker(Some(id))?.pop(),
                    "own": { "cv": agent.own_file(id, "cv"), "letter": agent.own_file(id, "letter") }, "prep": agent.prep(id), "preparing": agent.is_running(&format!("prep:{id}")), "thanks": agent.thank_you(id), "thanking": agent.is_running(&format!("thanks:{id}")), "finding_apply": agent.is_running(&format!("apply-link:{id}")),
                    "rating": agent.db().rating(&job.company), "rating_busy": agent.is_running(&format!("rating:{}", crate::db::company_key(&job.company))),
                    "cv_pdf": pdf(&job.cv_path), "letter_pdf": pdf(&job.letter_path),
                    "revising": agent.is_running(&format!("revise:{id}")),
                    "undo": { "cv": agent.can_undo(id, "cv"), "letter": agent.can_undo(id, "letter") },
                    "follow_up": agent.follow_up(id), "following_up": agent.is_running(&format!("followup:{id}")),
                    "answers": agent.answers(id), "answering": agent.is_running(&format!("answers:{id}")),
                    "can_fill": host.can_fill() && !req.remote,
                    "recruiters_here": crate::recruiters::for_job(agent, id),
                    "on_apply": {
                        "mode": crate::recruiters::apply_mode(agent),
                        "to": crate::recruiters::contact_for(agent, &job).map(|(e, n, known)| json!({ "email": e, "name": n, "known": known })),
                    },
                    "recruiter": crate::recruiters::for_company(&crate::recruiters::list(agent), &job.company).map(|r| {
                        let mut v = json!({ "name": r.name, "email": r.email, "company": r.company, "kind": r.kind, "roles": r.roles, "stage": r.stage, "last_at": r.last_at });
                        v["asked"] = json!(r.asked.iter().any(|a| a.job_id == job.id));
                        v
                    }),
                    "offer": agent.offer(id), "advising": agent.is_running(&format!("offer:{id}")),
                    "contacts": agent.contacts(id), "writing_to": agent.is_running(&format!("contact:{id}")),
                    "ats": job.cv_path.as_deref().and_then(|p| crate::cv::open(Path::new(p)).ok()).map(|d| crate::cv::ats_check(&d)),
                    "claude_desktop": crate::mcp::claude_desktop_config().as_deref().map(crate::mcp::in_claude_desktop).unwrap_or(false),
                })));
            }
            ["api", "emails"] => return Ok(Resp::json(&json!({ "emails": agent.db().emails(200)? }))),
            ["api", "calendar"] => {
                let n = |k: &str, d: i64| req.query.get(k).and_then(|v| v.parse::<i64>().ok()).unwrap_or(d).clamp(0, 400);
                let items = agent.calendar(n("back", 14), n("ahead", 60))?;
                let (synced, show) = (agent.secret("last.calsync"), agent.secret("cal.show_google") != "0");
                return Ok(Resp::json(&json!({ "items": items, "google": agent.cal.read().unwrap().is_some(),
                    "synced": synced, "show_google": show, "syncing": agent.is_running("calsync") })));
            }
            ["api", "calendar.ics"] => {
                return Ok(Resp {
                    status: 200,
                    ctype: "text/calendar; charset=utf-8".into(),
                    body: agent.calendar_ics()?.into_bytes(),
                    headers: vec![("Cache-Control".into(), "no-store".into()), ("Content-Disposition".into(), "attachment; filename=\"Job Hunt.ics\"".into())],
                });
            }
            ["api", "export.csv"] => {
                let csv = agent.export_csv()?;
                return Ok(Resp {
                    status: 200,
                    ctype: "text/csv; charset=utf-8".into(),
                    body: csv.into_bytes(),
                    headers: vec![("Cache-Control".into(), "no-store".into()), ("Content-Disposition".into(), "attachment; filename=\"Job Hunt applications.csv\"".into())],
                });
            }
            ["api", "update", "check"] => {
                let mut u = host.update_check();
                // Remember what was found, so the background check notifies once per version.
                if u.get("available").and_then(|a| a.as_bool()) == Some(true) {
                    let v = u.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    u["notified"] = json!(agent.secret("update.notified") == v);
                }
                return Ok(Resp::json(&u));
            }
            ["api", "changelog"] => {
                let log = host.asset("changelog.json").and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(json!([]));
                return Ok(Resp::json(&json!({ "current": host.version(), "log": log })));
            }
            ["api", "settings"] => {
                let mut v = settings(agent, host)?;
                v["remote"]["here"] = json!(req.remote);
                return Ok(Resp::json(&v));
            }
            // Runs `claude --version` and `claude auth status`, so it's asked for separately.
            ["api", "settings", "claude-code"] => {
                let mut st = json!(crate::claude_code::status(&agent.secret("claude.path")));
                st["can_setup"] = json!(host.can_console() && !req.remote);
                return Ok(Resp::json(&st));
            }
            _ => return not_found(),
        }
    }

    if m != "POST" {
        return not_found();
    }
    let b = req.json().unwrap_or(json!({}));
    match parts.as_slice() {
        ["api", "jobs", id, action] => {
            let job = job_or_404(agent, id)?;
            match *action {
                "ask-recruiter" => Ok(Resp::json(&crate::recruiters::ask(agent, id)?)),
                "fill" => {
                    if req.remote {
                        return Err(Error("Forms are filled in on the computer running Job Hunt.".into()));
                    }
                    if job.url.trim().is_empty() {
                        return Err(Error("There's no link to this posting, so there's no form to fill in.".into()));
                    }
                    if !agent.claude_ready() {
                        return Err(Error("Set up Claude in Settings \u{2192} Accounts first: it writes the answers.".into()));
                    }
                    // Filling it in is approving it, without the email Approve sends when there's an address.
                    if job.status == "ready" {
                        agent.db().set_status(id, "approved", "approved; filling in the form on the company site")?;
                    }
                    host.fill_application(id, job.apply_url.as_deref().unwrap_or(&job.url))?;
                    ok()
                }
                "approve" => {
                    let outcome = agent.approve(id)?;
                    agent.after_stage(id, outcome, "", true);
                    if outcome == "approved" {
                        agent.find_company_apply_later(id);
                    }
                    Ok(Resp::json(&json!({ "outcome": outcome })))
                }
                "status" => {
                    let status = s(&b, "status");
                    if !STATUSES.contains(&status) {
                        return Err(Error("Unknown stage.".into()));
                    }
                    let note = if s(&b, "note").is_empty() { "changed in Job Hunt" } else { s(&b, "note") };
                    agent.db().set_status(id, status, note)?;
                    agent.after_stage(id, status, s(&b, "note"), b.get("learn").and_then(|v| v.as_bool()).unwrap_or(true));
                    ok()
                }
                "tailor" => {
                    if agent.is_running(&format!("tailor:{id}")) {
                        return Err(Error("This application is being tailored already.".into()));
                    }
                    let (a, id, track) = (agent.clone(), id.to_string(), s(&b, "track").to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&format!("tailor:{id}")) else { return };
                        if let Err(e) = a.tailor_anyway(&id, Some(&track).filter(|t| !t.is_empty()).map(|t| t.as_str())) {
                            let _ = a.db().log(Some(&id), "tailor:error", &e.0);
                            a.note("Tailoring didn't finish", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "letter" => {
                    agent.save_cover_letter(id, s(&b, "text"))?;
                    ok()
                }
                "score" => {
                    let key = format!("tailor:{id}");
                    if agent.is_running(&key) {
                        return Err(Error("This posting is being scored already.".into()));
                    }
                    let (a, id) = (agent.clone(), id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&format!("tailor:{id}")) else { return };
                        if let Err(e) = a.score_anyway(&id) {
                            let _ = a.db().log(Some(&id), "score:error", &e.0);
                            a.note("Scoring didn't finish", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "rating" => {
                    let key = format!("rating:{}", crate::db::company_key(&job.company));
                    let _g = agent.claim(&key).map_err(|_| Error("Job Hunt is already looking this company up.".into()))?;
                    Ok(Resp::json(&json!({ "rating": agent.rate_company(&job.company, &job.location)? })))
                }
                "apply-link" => {
                    if agent.is_running(&format!("apply-link:{id}")) {
                        return Err(Error("Job Hunt is already looking for it.".into()));
                    }
                    let _g = agent.claim(&format!("apply-link:{id}"))?;
                    Ok(Resp::json(&json!({ "url": agent.find_company_apply(id)? })))
                }
                "prep" => {
                    let key = format!("prep:{id}");
                    if agent.is_running(&key) {
                        return Err(Error("The prep sheet is being written already.".into()));
                    }
                    let (a, id) = (agent.clone(), id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&format!("prep:{id}")) else { return };
                        if let Err(e) = a.make_prep(&id) {
                            let _ = a.db().log(Some(&id), "prep:error", &e.0);
                            a.note("Interview prep didn't finish", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "notes" => {
                    agent.db().update_job(id, &[("notes", s(&b, "text").into())])?;
                    ok()
                }
                "revise" => {
                    let (what, note) = (s(&b, "what").to_string(), s(&b, "note").trim().to_string());
                    if !["cv", "letter"].contains(&what.as_str()) {
                        return Err(Error("Choose the CV or the cover letter.".into()));
                    }
                    if note.chars().count() < 3 {
                        return Err(Error("Say what to change, for example \u{201c}Make the summary shorter\u{201d}.".into()));
                    }
                    let key = format!("revise:{id}");
                    if agent.is_running(&key) || agent.is_running(&format!("tailor:{id}")) {
                        return Err(Error("This application is being changed already.".into()));
                    }
                    let (a, id) = (agent.clone(), id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&key) else { return };
                        if let Err(e) = a.revise(&id, &what, &note) {
                            let _ = a.db().log(Some(&id), "revise:error", &e.0);
                            a.note("The change didn't work", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "answers" | "offer" | "outreach" => {
                    let key = format!("{}:{id}", match *action { "answers" => "answers", "offer" => "offer", _ => "contact" });
                    if agent.is_running(&key) {
                        return Err(Error("That's being written already.".into()));
                    }
                    if *action == "offer" && s(&b, "offer").trim().chars().count() < 10 {
                        return Err(Error("Paste the offer's details: salary, bonus, benefits, vacation, start date.".into()));
                    }
                    let (a, id, what, body) = (agent.clone(), id.to_string(), action.to_string(), b.clone());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&key) else { return };
                        let r = match what.as_str() {
                            "answers" => a.answer_questions(&id, s(&body, "questions")).map(|_| ()),
                            "offer" => a.offer_advice(&id, s(&body, "offer")).map(|_| ()),
                            _ => a.write_outreach(&id, body["index"].as_u64().unwrap_or(0) as usize).map(|_| ()),
                        };
                        if let Err(e) = r {
                            let _ = a.db().log(Some(&id), &format!("{what}:error"), &e.0);
                            a.note("That didn't work", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "contacts" => {
                    let list = b.get("contacts").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                    agent.save_contacts(id, &list)?;
                    ok()
                }
                "cv-edit" => {
                    agent.edit_cv_paragraph(id, s(&b, "current"), s(&b, "text"))?;
                    ok()
                }
                "own-file" => {
                    let what = if req.query.get("what").map(|w| w.as_str()) == Some("letter") { "letter" } else { "cv" };
                    let name = req.query.get("filename").cloned().unwrap_or_default();
                    agent.use_own_file(id, what, &name, &req.body)?;
                    ok()
                }
                "own-file-off" => {
                    agent.drop_own_file(id, if s(&b, "what") == "letter" { "letter" } else { "cv" })?;
                    ok()
                }
                "undo" => {
                    let what = if s(&b, "what") == "letter" { "letter" } else { "cv" };
                    agent.undo_revision(id, what)?;
                    ok()
                }
                "thanks" => {
                    let key = format!("thanks:{id}");
                    if agent.is_running(&key) {
                        return Err(Error("The thank-you note is being written already.".into()));
                    }
                    let (a, id) = (agent.clone(), id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&key) else { return };
                        // The last interview on the calendar for it, when there is one.
                        let when = a.db().calendar_ids().unwrap_or_default().into_iter()
                            .filter(|e| e.kind == "interview" && e.job_id.as_deref() == Some(id.as_str()) && e.start <= crate::util::now())
                            .max_by(|x, y| x.start.cmp(&y.start))
                            .map(|e| format!("{} on {}", e.title, e.start.get(..10).unwrap_or("")))
                            .unwrap_or_else(|| "recently".into());
                        if let Err(e) = a.write_thank_you(&id, &when) {
                            let _ = a.db().log(Some(&id), "thanks:error", &e.0);
                            a.note("The thank-you note didn't work", &e.0);
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "followup" => {
                    let key = format!("followup:{id}");
                    if agent.is_running(&key) {
                        return Err(Error("The follow-up is being written already.".into()));
                    }
                    let (a, id) = (agent.clone(), id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&key) else { return };
                        match a.write_follow_up(&id) {
                            Ok(v) if v["draft"].is_string() => a.note("Follow-up ready", "It's waiting in your Gmail drafts. Check it and send."),
                            Ok(_) => {}
                            Err(e) => {
                                let _ = a.db().log(Some(&id), "followup:error", &e.0);
                                a.note("The follow-up didn't work", &e.0);
                            }
                        }
                    });
                    Ok(Resp::json(&json!({ "started": true })))
                }
                "open" => {
                    let what = s(&b, "what");
                    match what {
                        "posting" if job.url.starts_with("http") => give_url(host, req, &job.url),
                        "company" => match job.apply_url.as_deref().filter(|u| u.starts_with("http")) {
                            Some(u) => give_url(host, req, u),
                            None => Err(Error("There's no link to this job on the company's own site yet.".into())),
                        },
                        "folder" if req.remote => Err(Error("Folders open only on the computer running Job Hunt. Use the CV, letter and PDF buttons to download the files.".into())),
                        "folder" => {
                            let dir = agent.application_dir(&job);
                            std::fs::create_dir_all(&dir)?;
                            host.open_path(&dir)?;
                            ok()
                        }
                        _ => {
                            let path = job_file(agent, &job, what)?;
                            give_file(host, req, &path, format!("/api/jobs/{}/download/{what}", url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()))
                        }
                    }
                }
                _ => not_found(),
            }
        }
        ["api", "add"] => {
            let (a, f) = (agent.clone(), b.clone());
            if s(&f, "company").trim().is_empty() || s(&f, "title").trim().is_empty() || s(&f, "description").trim().len() < 40 {
                return Err(Error("Add the company, the title and the full job description.".into()));
            }
            ready_to_search(agent)?;
            std::thread::spawn(move || {
                let Ok(_g) = a.claim("add") else { return };
                match a.add_manual(s(&f, "company"), s(&f, "title"), s(&f, "url"), s(&f, "location"), s(&f, "description")) {
                    Ok(_) => a.note("Application ready", &format!("{} at {} is tailored and waiting for your approval.", s(&f, "title"), s(&f, "company"))),
                    Err(e) => {
                        let _ = a.db().log(None, "add:error", &e.0);
                        a.note("Couldn't add that job", &e.0);
                    }
                }
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "run", task] if ["search", "search-force", "inbox"].contains(task) => {
            if task.starts_with("search") {
                ready_to_search(agent)?;
            }
            if *task == "inbox" && agent.mail.read().unwrap().is_none() {
                return Err(Error("Connect Google first, in Settings → Accounts.".into()));
            }
            Ok(Resp::json(&json!({ "started": run_in_background(agent, task) })))
        }
        ["api", "open-url"] => {
            let url = s(&b, "url");
            if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
                return Err(Error("Only web and email links can be opened.".into()));
            }
            give_url(host, req, url)
        }
        ["api", "open-folder"] if req.remote => Err(Error("Folders open only on the computer running Job Hunt.".into())),
        ["api", "open-folder"] => {
            let dir: PathBuf = match s(&b, "which") {
                "applications" => agent.files().join("applications"),
                "cv" => agent.files().join("cv"),
                _ => agent.data.clone(),
            };
            std::fs::create_dir_all(&dir)?;
            host.open_path(&dir)?;
            ok()
        }
        ["api", "settings", "profile"] => {
            let profile: Profile = serde_json::from_value(b.clone()).map_err(|e| Error(format!("The profile couldn't be read: {e}")))?;
            let problems = profile.problems();
            if !problems.is_empty() {
                return Err(Error(problems.join(" ")));
            }
            // The board lists this page loaded, so boards changed elsewhere since aren't overwritten.
            let seen = b.get("seen_sources").and_then(|v| serde_json::from_value(v.clone()).ok());
            let saved = agent.save_settings(profile, seen)?;
            agent.connect(); // the calendar id may have changed
            Ok(Resp::json(&json!({ "ok": true, "profile": saved })))
        }
        // What runs programs or reads and writes folders on the computer is set there, not from a phone.
        ["api", "settings", "claude"] if req.remote && b.get("path").is_some() && s(&b, "path").trim() != agent.secret("claude.path") => Err(Error(
            "Claude Code's location can only be changed on the computer running Job Hunt.".into(),
        )),
        ["api", "settings", "backup"] if req.remote && b.get("dir").is_some() && s(&b, "dir").trim() != agent.secret("backup.dir") => Err(Error(
            "The backup folder can only be changed on the computer running Job Hunt.".into(),
        )),
        ["api", "sync", "continue"] | ["api", "settings", "claude-desktop"] if req.remote && host.kind() != "server" => Err(Error("Do this on the computer running Job Hunt.".into())),
        ["api", "settings", "files-folder"] if req.remote || host.kind() == "server" => Err(Error("Your files' folder can only be changed in the Job Hunt app on your PC.".into())),
        ["api", "settings", "files-folder"] => {
            let folder = agent.set_files_folder(s(&b, "dir"))?;
            Ok(Resp::json(&json!({ "folder": folder.to_string_lossy() })))
        }
        ["api", "sync", "resume"] => {
            crate::sync::resume_here(agent)?;
            Ok(Resp::json(&json!({ "sync": crate::sync::status(agent) })))
        }
        ["api", "update", "install"] if req.remote && host.kind() != "server" => Err(Error("Install the update on the computer running Job Hunt.".into())),
        ["api", "settings", "claude"] => {
            if let Some(e) = b.get("engine").and_then(|v| v.as_str()) {
                agent.db().set("claude.engine", if e == "api" { "api" } else { "code" })?;
            }
            let key = s(&b, "claude_key").trim().to_string();
            if !key.is_empty() {
                claude::check_key(&key)?;
                agent.db().set("claude.key", &key)?;
            }
            if b.get("model").is_some() {
                agent.db().set("claude.model", s(&b, "model").trim())?;
            }
            if let Some(m) = b.get("tailor_model").and_then(|v| v.as_str()) {
                agent.db().set("claude.tailor_model", if ["opus", "sonnet"].contains(&m) { m } else { "" })?;
            }
            if let Some(e) = b.get("tailor_effort").and_then(|v| v.as_str()) {
                if !["low", "medium", "high"].contains(&e) {
                    return Err(Error("Choose low, medium or high.".into()));
                }
                agent.db().set("claude.tailor_effort", e)?;
            }
            if b.get("path").is_some() {
                let path = s(&b, "path").trim();
                if !path.is_empty() && crate::claude_code::find(path).is_none() {
                    return Err(Error("There's no Claude Code program at that path.".into()));
                }
                agent.db().set("claude.path", path)?;
            }
            agent.connect();
            ok()
        }
        ["api", "rescore"] => {
            let group = s(&b, "group").to_string();
            agent.rescore_plan(&group)?; // a bad group fails here, not in the background
            if agent.is_running("rescore") {
                return Err(Error("Postings are being scored again already.".into()));
            }
            if let Some(why) = hold_for_later(agent, &b) {
                agent.defer(json!({ "kind": "rescore", "group": group }))?;
                return Ok(Resp::json(&json!({ "deferred": why })));
            }
            let a = agent.clone();
            std::thread::spawn(move || match a.rescore(&group) {
                Ok(r) => a.note("Postings scored again", &format!("{} scored, {} now worth tailoring, {} left out by your filters.", r["scored"], r["cleared"], r["filtered"])),
                Err(e) => a.note("Scoring again didn't finish", &e.0),
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "settings", "weekly"] => {
            if let Some(d) = b.get("day").and_then(|v| v.as_str()) {
                agent.db().set("weekly.day", if d == "mon" { "mon" } else { "sun" })?;
            }
            if let Some(e) = b.get("email").and_then(|v| v.as_bool()) {
                agent.db().set("weekly.email", if e { "1" } else { "0" })?;
            }
            ok()
        }
        ["api", "weekly", "send"] => {
            let _g = agent.claim("weekly").map_err(|_| Error("The weekly review is being sent already.".into()))?;
            let emailed = !agent.weekly_to().is_empty();
            Ok(Resp::json(&json!({ "text": agent.weekly_summary()?, "emailed": emailed })))
        }
        ["api", "usage", "budget"] => {
            if let Some(on) = b.get("on").and_then(|v| v.as_bool()) {
                agent.db().set("budget.on", if on { "1" } else { "0" })?;
            }
            if let Some(h) = b.get("hour").and_then(|v| v.as_u64()) {
                agent.db().set("budget.hour", &h.min(23).to_string())?;
            }
            ok()
        }
        ["api", "usage", "run-held"] => {
            if let Some(t) = agent.limited() {
                return Err(Error(format!("Your Claude usage limit is reached. It resets {}.", crate::util::reset_time(t, chrono::Utc::now()))));
            }
            Ok(Resp::json(&json!({ "started": agent.run_deferred()? })))
        }
        ["api", "usage", "clear-held"] => {
            agent.db().delete("deferred")?;
            ok()
        }
        ["api", "setup-skip"] => {
            let what = s(&b, "what");
            if !["google", "search_service"].contains(&what) {
                return Err(Error("Unknown setup step.".into()));
            }
            agent.db().set(&format!("setup.skip.{what}"), "1")?;
            ok()
        }
        ["api", "calendar", "interview"] => {
            let minutes = b.get("minutes").and_then(|v| v.as_i64()).unwrap_or(60);
            let made = agent.add_interview(s(&b, "job_id"), s(&b, "start"), minutes, s(&b, "link"), s(&b, "note"))?;
            Ok(Resp::json(&json!({ "added": made.len() })))
        }
        ["api", "calendar", "sync"] => {
            // The same claim as the half-hourly sync, so the two never copy an entry twice.
            let _g = agent.claim("calsync").map_err(|_| Error("Syncing with Google Calendar already. Try again in a moment.".into()))?;
            Ok(Resp::json(&agent.sync_calendar()?))
        }
        ["api", "calendar", "link"] => {
            agent.link_calendar_event(s(&b, "event_id"), s(&b, "job_id"))?;
            ok()
        }
        ["api", "calendar", "show-google"] => {
            let on = b.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
            agent.db().set("cal.show_google", if on { "1" } else { "0" })?;
            ok()
        }
        ["api", "calendar", "delete"] => {
            let id = s(&b, "id");
            if !id.starts_with("local:") {
                return Err(Error("Job Hunt can only remove entries it keeps itself. Remove this one in Google Calendar.".into()));
            }
            Ok(Resp::json(&json!({ "removed": agent.db().delete_calendar_event(id)? })))
        }
        ["api", "pick-folder"] => {
            if req.remote {
                return Err(Error("The folder dialog opens on the PC running Job Hunt; type the path here instead.".into()));
            }
            Ok(Resp::json(&json!({ "path": host.pick_folder(s(&b, "start"))? })))
        }
        ["api", "tailor"] => {
            let ids: Vec<String> = b.get("ids").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
            if ids.len() > 3 || agent.limited().is_some() {
                if let Some(why) = hold_for_later(agent, &b) {
                    agent.defer(json!({ "kind": "tailor", "ids": ids }))?;
                    return Ok(Resp::json(&json!({ "deferred": why, "started": 0 })));
                }
            }
            let n = agent.tailor_picked(&ids)?;
            Ok(Resp::json(&json!({ "started": n })))
        }
        ["api", "settings", "keys"] => {
            if b.get("adzuna_id").is_some() {
                agent.db().set("adzuna.id", s(&b, "adzuna_id").trim())?;
            }
            if !s(&b, "adzuna_key").trim().is_empty() {
                agent.db().set("adzuna.key", s(&b, "adzuna_key").trim())?;
            }
            if let Some(p) = b.get("jsearch_provider").and_then(|v| v.as_str()) {
                agent.db().set("jsearch.provider", if p == "rapidapi" { "rapidapi" } else { "openwebninja" })?;
            }
            if !s(&b, "jsearch_key").trim().is_empty() {
                agent.db().set("jsearch.key", s(&b, "jsearch_key").trim())?;
            }
            if !s(&b, "apify_key").trim().is_empty() {
                agent.db().set("apify.key", s(&b, "apify_key").trim())?;
            }
            if b.get("apify_actor").is_some() {
                agent.db().set("apify.actor", s(&b, "apify_actor").trim())?;
            }
            if !s(&b, "jooble_key").trim().is_empty() {
                agent.db().set("jooble.key", s(&b, "jooble_key").trim())?;
            }
            ok()
        }
        ["api", "settings", "backup"] => {
            if let Some(d) = b.get("dir").and_then(|v| v.as_str()) {
                if host.kind() == "server" && !d.trim().is_empty() && d.trim() != "/backups" {
                    return Err(Error("On the server, backups go to the /backups folder you mapped in Container Manager.".into()));
                }
                agent.db().set("backup.dir", d.trim())?;
            }
            if let Some(on) = b.get("secrets").and_then(|v| v.as_bool()) {
                agent.db().set("backup.secrets", if on { "1" } else { "0" })?;
            }
            ok()
        }
        ["api", "sync", "settings"] => {
            if let Some(d) = b.get("dir").and_then(|v| v.as_str()) {
                agent.db().set("backup.dir", d.trim())?;
            }
            if let Some(on) = b.get("secrets").and_then(|v| v.as_bool()) {
                agent.db().set("sync.secrets", if on { "1" } else { "0" })?;
            }
            if let Some(w) = b.get("where").and_then(|v| v.as_str()) {
                agent.db().set("sync.where", if w == "drive" { "drive" } else { "folder" })?;
            }
            if let Some(m) = b.get("every").and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))) {
                agent.db().set("sync.every", &m.clamp(0, 24 * 60).to_string())?;
            }
            if let Some(on) = b.get("on").and_then(|v| v.as_bool()) {
                if on && crate::sync::on_drive(agent) && agent.files.read().unwrap().is_none() {
                    return Err(Error("Connect Google in Settings \u{2192} Accounts first, then turn on syncing with Google Drive.".into()));
                }
                if on && !crate::sync::on_drive(agent) && crate::sync::folder(agent).is_none() {
                    return Err(Error("Choose a folder first, for example \"My Drive\\Job Hunt\" in Google Drive.".into()));
                }
                agent.db().set("sync.on", if on { "1" } else { "0" })?;
                // Turned off on purpose: stop suggesting it on the Overview.
                if on { agent.db().delete("sync.declined")?; } else { agent.db().set("sync.declined", "1")?; }
            }
            // Check for newer data from another computer in the new folder before writing to it.
            let newer = crate::sync::newer_elsewhere(agent);
            if newer.is_none() && crate::sync::enabled(agent) {
                crate::sync::push(agent, true)?;
            }
            Ok(Resp::json(&json!({ "sync": crate::sync::status(agent) })))
        }
        ["api", "sync", "now"] => {
            if let Err(e) = crate::sync::push(agent, true) {
                agent.db().set("sync.error", &e.0)?;
                return Err(e);
            }
            agent.db().delete("sync.error")?;
            Ok(Resp::json(&json!({ "sync": crate::sync::status(agent) })))
        }
        ["api", "sync", "continue"] => {
            let info = crate::sync::continue_from(agent, s(&b, "folder"))?;
            let h = host.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                h.restart();
            });
            Ok(Resp::json(&json!({ "restarting": true, "from": info.device_name })))
        }
        ["api", "results", "career"] => Ok(Resp::json(&json!({ "started": start_career(agent) }))),
        ["api", "results", "add-titles"] => {
            let titles: Vec<String> = b.get("titles").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
            Ok(Resp::json(&json!({ "added": agent.add_titles(s(&b, "track"), &titles)? })))
        }
        ["api", "results", "insights"] => {
            if agent.is_running("insights") {
                return Ok(Resp::json(&json!({ "started": false })));
            }
            let a = agent.clone();
            std::thread::spawn(move || {
                let Ok(_g) = a.claim("insights") else { return };
                if let Err(e) = a.write_insights() {
                    let _ = a.db().log(None, "insights:error", &e.0);
                    a.note("No insights yet", &e.0);
                }
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "clip"] => {
            // A posting sent with the Send to Job Hunt button, pasted into Job Hunt.
            let text = String::from_utf8_lossy(&req.body).to_string();
            let clip = parse_clip(&text).ok_or_else(|| Error("That isn't a posting from the Send to Job Hunt button.".into()))?;
            start_clip(agent, clip);
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "settings", "phone"] => {
            if let Some(on) = b.get("on").and_then(|v| v.as_bool()) {
                if on {
                    if agent.secret("phone.topic").is_empty() {
                        // Anyone who knows the topic can read it, so it's long and random.
                        let topic = format!("jobhunt-{}", crate::util::short_hash(&format!("{}{}", rand::random::<u64>(), crate::util::now())));
                        agent.db().set("phone.topic", &topic)?;
                    }
                } else {
                    agent.db().delete("phone.topic")?;
                }
            }
            if let Some(u) = b.get("urgent_only").and_then(|v| v.as_bool()) {
                agent.db().set("phone.urgent_only", if u { "1" } else { "0" })?;
            }
            if let Some(d) = b.get("details").and_then(|v| v.as_bool()) {
                agent.db().set("phone.details", if d { "1" } else { "0" })?;
            }
            if let Some(server) = b.get("server").and_then(|v| v.as_str()) {
                let server = server.trim();
                if !server.is_empty() && !server.starts_with("https://") && !server.starts_with("http://") {
                    return Err(Error("The server is a web address, like https://ntfy.sh.".into()));
                }
                agent.db().set("phone.server", server)?;
            }
            ok()
        }
        ["api", "settings", "phone-test"] => {
            agent.test_phone()?;
            ok()
        }
        ["api", "bookmark-page"] => {
            // The page that gives the Send to Job Hunt bookmark the Job Hunt logo: bookmarked, then its
            // address swapped for the button's code. Opened in your browser, on this computer only.
            if req.remote {
                return Err(Error("Set up the button on the computer running Job Hunt.".into()));
            }
            let html = s(&b, "html");
            if !html.starts_with("<!doctype html>") || html.len() > 200_000 {
                return Err(Error("That isn't the setup page.".into()));
            }
            let path = agent.data.join("Send to Job Hunt.html");
            std::fs::write(&path, html)?;
            host.open_path(&path)?;
            ok()
        }
        ["api", "settings", "sites-off"] => {
            // Turn off recruiter and job sites that can't be read: known ones by id, your own by theirs.
            let ids: Vec<String> = b["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            let mut p = agent.profile();
            p.sources.sites.retain(|x| !ids.contains(x));
            p.sources.custom_sites.retain(|c| !ids.contains(&c.id()));
            agent.save_profile(&p)?;
            ok()
        }
        ["api", "settings", "ratings"] => {
            let on = b.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
            agent.db().set("ratings.auto", if on { "1" } else { "0" })?;
            ok()
        }
        ["api", "settings", "clip-watch"] => {
            let on = b.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
            agent.db().set("clip.watch", if on { "1" } else { "0" })?;
            ok()
        }
        ["api", "settings", "claude-desktop"] => {
            let (command, args) = host.mcp_command().ok_or_else(|| Error("Adding Job Hunt to Claude Desktop works from the Windows app.".into()))?;
            let config = crate::mcp::claude_desktop_config().ok_or_else(|| Error("Couldn't find where Claude Desktop keeps its settings.".into()))?;
            let data = std::env::var("JOBHUNT_DATA").ok().map(|_| agent.data.clone());
            crate::mcp::add_to_claude_desktop(&config, &command, &args, data.as_deref())?;
            Ok(Resp::json(&json!({ "config": config })))
        }
        ["api", "sync", "takeover"] => {
            let from = crate::sync::take_over(agent)?;
            Ok(Resp::json(&json!({ "from": from })))
        }
        ["api", "connections", "test"] => {
            let id = s(&b, "id").to_string();
            if !["boards", "adzuna", "jsearch", "jooble", "indeed", "linkedin", "jobbank", "agencies", "alerts"].contains(&id.as_str()) {
                return Err(Error("That connection has no test.".into()));
            }
            if agent.is_running("test-sources") {
                return Err(Error("A test is running already. Try again in a moment.".into()));
            }
            let a = agent.clone();
            std::thread::spawn(move || {
                if let Err(e) = a.test_sources_only(Some(&id)) {
                    let _ = a.db().log(None, "test:error", &e.0);
                }
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "recruiters", "scan"] => {
            if agent.mail.read().unwrap().is_none() {
                return Err(Error("Connect Gmail first (Settings \u{2192} Accounts).".into()));
            }
            if agent.is_running("recruiters") {
                return Ok(Resp::json(&json!({ "started": false })));
            }
            let a = agent.clone();
            std::thread::spawn(move || match crate::recruiters::scan(&a) {
                Ok(v) => a.note("Recruiters found", &format!("{} recruiters in your email ({} new).{}", v["found"], v["new"],
                    v["boards"].as_array().filter(|b| !b.is_empty()).map(|b| format!(" Added the job boards of {}.", b.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))).unwrap_or_default())),
                Err(e) => a.note("Couldn't look for recruiters", &e.0),
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "recruiters", "settings"] => {
            if let Some(m) = b.get("mode").and_then(|v| v.as_str()) {
                if !["draft", "send", "off"].contains(&m) {
                    return Err(Error("Choose draft, send or off.".into()));
                }
                agent.db().set("apply.recruiter", m)?;
            }
            if let Some(on) = b.get("attach_cv").and_then(|v| v.as_bool()) {
                agent.db().set("apply.recruiter_cv", if on { "1" } else { "0" })?;
            }
            ok()
        }
        ["api", "recruiters", "edit"] => {
            crate::recruiters::edit(agent, &b)?;
            ok()
        }
        ["api", "recruiters", "hide"] => {
            crate::recruiters::set_hidden(agent, s(&b, "email"), b.get("hidden").and_then(|v| v.as_bool()).unwrap_or(true))?;
            ok()
        }
        ["api", "sites"] => {
            let mut p = agent.profile();
            if let Some(on) = b.get("sites").and_then(|v| v.as_array()) {
                p.sources.sites = on.iter().filter_map(|x| x.as_str()).filter(|x| crate::sites::SITES.iter().any(|s| s.id == *x)).map(String::from).collect();
            }
            if let Some(list) = b.get("custom") {
                let list: Vec<crate::sites::CustomSite> = serde_json::from_value(list.clone()).map_err(|_| Error("Couldn't read your sites.".into()))?;
                for c in &list {
                    let ok = url::Url::parse(c.url.trim()).is_ok_and(|u| ["http", "https"].contains(&u.scheme()));
                    if !ok {
                        return Err(Error(format!("\u{201c}{}\u{201d} isn't a web address. Copy it from your browser after searching on the site.", c.url)));
                    }
                }
                p.sources.custom_sites = list.into_iter().map(|c| crate::sites::CustomSite { name: c.name.trim().into(), url: c.url.trim().into() }).collect();
            }
            // Turning a site on turns the group on too.
            if !p.sources.sites.is_empty() || !p.sources.custom_sites.is_empty() {
                p.sources.set_on("agencies", true);
            }
            agent.save_profile(&p)?;
            ok()
        }
        ["api", "connections", which @ ("indeed" | "linkedin" | "jsearch" | "jooble" | "adzuna" | "boards" | "alerts" | "jobbank" | "agencies")] => {
            let mut p = agent.profile();
            let on = b.get("on").and_then(|v| v.as_bool()).ok_or_else(|| Error("Say on or off.".into()))?;
            p.sources.set_on(which, on);
            agent.save_profile(&p)?;
            ok()
        }
        ["api", "sources", "test"] => {
            if agent.is_running("test-sources") {
                return Ok(Resp::json(&json!({ "started": false })));
            }
            let a = agent.clone();
            std::thread::spawn(move || {
                if let Err(e) = a.test_sources() {
                    let _ = a.db().log(None, "test:error", &e.0);
                }
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        ["api", "sync", "decline"] => {
            crate::sync::decline(agent, s(&b, "saved_at"));
            ok()
        }
        ["api", "backup", "now"] => {
            let path = crate::backup::create(agent)?;
            Ok(Resp::json(&json!({ "file": path.file_name().map(|n| n.to_string_lossy().to_string()), "folder": crate::backup::folder(agent) })))
        }
        ["api", "backup", "restore"] => {
            crate::backup::stage_restore(&agent.data, &req.body)?;
            let h = host.clone();
            // Answer first, then restart to apply it.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                h.restart();
            });
            Ok(Resp::json(&json!({ "restarting": true })))
        }
        ["api", "settings", "remote"] => {
            if host.kind() == "server" {
                if let Some(pw) = b.get("password").and_then(|v| v.as_str()).filter(|p| !p.is_empty()) {
                    crate::web::set_password(agent, pw)?;
                }
                return ok();
            }
            if let Some(pw) = b.get("password").and_then(|v| v.as_str()).filter(|p| !p.is_empty()) {
                crate::web::set_password(agent, pw)?;
            }
            if let Some(port) = b.get("port").and_then(|v| v.as_u64()) {
                if !(1024..=65535).contains(&port) {
                    return Err(Error("Use a port between 1024 and 65535, such as 8790.".into()));
                }
                agent.db().set("remote.port", &port.to_string())?;
            }
            if let Some(on) = b.get("on").and_then(|v| v.as_bool()) {
                if on && !crate::web::has_password(agent) {
                    return Err(Error("Set a password first.".into()));
                }
                agent.db().set("remote.on", if on { "1" } else { "0" })?;
                if on {
                    crate::web::ensure_started(agent.clone(), host.clone(), remote_port(agent)).map_err(Error)?;
                }
            }
            ok()
        }
        ["api", "settings", "suggest-boards"] => Ok(Resp::json(&json!({ "boards": agent.suggest_boards()? }))),
        ["api", "settings", "remove-boards"] => {
            let list = b.get("boards").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            Ok(Resp::json(&json!({ "removed": agent.remove_boards(&list)? })))
        }
        ["api", "settings", "add-boards"] => {
            let list = b.get("boards").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            Ok(Resp::json(&json!({ "added": agent.add_boards(&list)? })))
        }
        ["api", "settings", "signature"] => {
            agent.set_signature(&req.body)?;
            ok()
        }
        ["api", "settings", "forget", what] => {
            match *what {
                "signature" => agent.remove_signature()?,
                "claude" => agent.db().delete("claude.key")?,
                "adzuna" => {
                    agent.db().delete("adzuna.id")?;
                    agent.db().delete("adzuna.key")?
                }
                "jsearch" => agent.db().delete("jsearch.key")?,
                "jooble" => agent.db().delete("jooble.key")?,
                "apify" => agent.db().delete("apify.key")?,
                "google" => {
                    agent.db().delete("google.token")?;
                    agent.db().delete("google.pending")?;
                    agent.db().delete("google.client")?
                }
                _ => return not_found(),
            }
            agent.connect();
            ok()
        }
        ["api", "cvs"] => {
            let name = req.query.get("filename").cloned().unwrap_or_else(|| "CV.docx".into());
            let t = agent.add_cv(&name, &req.body, req.query.get("convert").is_some())?;
            start_career(agent);
            Ok(Resp::json(&json!({ "ok": true, "track": t })))
        }
        ["api", "cvs", id, action] => {
            if !agent.profile().tracks.iter().any(|t| t.name == *id) {
                return not_found();
            }
            match *action {
                "file" => {
                    let name = req.query.get("filename").cloned().unwrap_or_else(|| "CV.docx".into());
                    let t = agent.replace_cv(id, &name, &req.body, req.query.get("convert").is_some())?;
                    Ok(Resp::json(&json!({ "ok": true, "track": t })))
                }
                "meta" => {
                    let mut p = agent.profile();
                    let t = p.tracks.iter_mut().find(|t| t.name == *id).unwrap();
                    if let Some(l) = b.get("label").and_then(|v| v.as_str()).filter(|l| !l.trim().is_empty()) {
                        t.label = l.trim().to_string();
                    }
                    let list = |k: &str| b.get(k).and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect::<Vec<_>>());
                    if let Some(v) = list("titles") {
                        t.titles = v;
                    }
                    if let Some(v) = list("keywords") {
                        t.keywords = v;
                    }
                    if let Some(st) = b.get("letter_style").and_then(|v| v.as_str()) {
                        if !["standard", "formal", "short", "warm"].contains(&st) {
                            return Err(Error("Choose a cover-letter style from the list.".into()));
                        }
                        t.letter_style = st.to_string();
                    }
                    agent.save_profile(&p)?;
                    ok()
                }
                "suggest" => Ok(Resp::json(&json!({ "track": agent.suggest_for_cv(id)? }))),
                "convert" => Ok(Resp::json(&json!({ "track": agent.convert_existing_cv(id)? }))),
                "remove" => {
                    agent.remove_cv(id)?;
                    ok()
                }
                "open" => give_file(host, req, &agent.cv_path(id), format!("/api/cvs/{id}/download")),
                _ => not_found(),
            }
        }
        ["api", "settings", "google-client"] => {
            let text = String::from_utf8_lossy(&req.body).to_string();
            google::parse_client(&text)?;
            agent.db().set("google.client", &text)?;
            ok()
        }
        // Away from the computer running Job Hunt (the server, a phone): sign in in this browser,
        // then paste back the address Google ends on.
        ["api", "settings", "google-connect"] if req.remote || host.kind() == "server" => {
            let client = google::parse_client(&agent.google_client()).map_err(|_| Error("Choose the Google connection file first (Settings → Accounts).".into()))?;
            let p = google::start_pasted(&client)?;
            agent.db().set("google.pending", &serde_json::to_string(&p)?)?;
            Ok(Resp::json(&json!({ "started": true, "paste": true, "url": p.url })))
        }
        ["api", "settings", "google-finish"] => {
            let client = google::parse_client(&agent.google_client()).map_err(|_| Error("Choose the Google connection file first (Settings → Accounts).".into()))?;
            let p: google::Pasted = serde_json::from_str(&agent.secret("google.pending")).map_err(|_| Error("Start with Connect Google first.".into()))?;
            let mut token = google::finish_pasted(&client, &p, s(&b, "url"))?;
            token.email = google::Google::new(client.clone(), token.clone(), "primary", Box::new(|_| {})).account_email().unwrap_or_default();
            let db = agent.db();
            db.set("google.token", &serde_json::to_string(&token)?)?;
            db.delete("google.pending")?;
            drop(db);
            agent.google_connected(&token.email);
            Ok(Resp::json(&json!({ "email": token.email })))
        }
        ["api", "settings", "google-connect"] => {
            let client = google::parse_client(&agent.google_client()).map_err(|_| Error("Choose the Google connection file first (Settings → Accounts).".into()))?;
            let (a, h) = (agent.clone(), host.clone());
            if a.is_running("google") {
                return Ok(Resp::json(&json!({ "started": false })));
            }
            std::thread::spawn(move || {
                let Ok(g) = a.claim("google") else { return };
                let result = google::sign_in(&client, &|url| h.open_url(url)).and_then(|mut token| {
                    token.email = google::Google::new(client.clone(), token.clone(), "primary", Box::new(|_| {})).account_email().unwrap_or_default();
                    a.db().set("google.token", &serde_json::to_string(&token)?)?;
                    Ok(token.email)
                });
                drop(g);
                match result {
                    Ok(email) => a.google_connected(&email),
                    Err(e) => a.note("Google didn't connect", &e.0),
                }
            });
            Ok(Resp::json(&json!({ "started": true })))
        }
        // Install and/or sign in to Claude Code in a window of its own.
        ["api", "claude", "setup"] => {
            if req.remote {
                return Err(Error("Do this on the PC itself, in the Job Hunt app.".into()));
            }
            let install = b["install"].as_bool().unwrap_or(false);
            host.open_console(&crate::claude_code::setup_script(install, &agent.secret("claude.path")))?;
            ok()
        }
        ["api", "update", "install"] => {
            let installed = host.update_install()?;
            Ok(Resp::json(&json!({ "installed": installed })))
        }
        ["api", "settings", "app"] => {
            if let Some(on) = b.get("autostart").and_then(|v| v.as_bool()) {
                host.set_autostart(on)?;
            }
            if let Some(c) = b.get("close").and_then(|v| v.as_str()) {
                agent.db().set("app.close", if c == "exit" { "exit" } else { "tray" })?;
            }
            if let Some(on) = b.get("wake").and_then(|v| v.as_bool()) {
                agent.db().set("app.wake", if on { "1" } else { "0" })?;
            }
            if let Some(on) = b.get("keep_awake").and_then(|v| v.as_bool()) {
                agent.db().set("app.keep_awake", if on { "1" } else { "0" })?;
            }
            ok()
        }
        _ => not_found(),
    }
}

/// Why a big batch waits instead of starting now: your usage limit is reached, or budget mode
/// holds it for the night. None when it can start (or you asked for it now: {"now": true}).
fn hold_for_later(agent: &Agent, b: &Value) -> Option<String> {
    if b.get("now").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }
    if let Some(t) = agent.limited() {
        return Some(format!("Your Claude usage limit is reached, so this starts by itself after it resets, {}.", crate::util::reset_time(t, chrono::Utc::now())));
    }
    if agent.budget_wait() {
        let hour = agent.secret("budget.hour").parse::<u32>().unwrap_or(22);
        let at = chrono::NaiveTime::from_hms_opt(hour, 0, 0).map(|t| t.format("%-I %p").to_string()).unwrap_or_default();
        return Some(format!("Budget mode: this starts by itself tonight at {at}."));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeHost {
        opened: Mutex<Vec<String>>,
        auto: Mutex<bool>,
    }

    impl Host for FakeHost {
        fn asset(&self, path: &str) -> Option<Vec<u8>> {
            match path {
                "index.html" | "app.js" => Some(b"hello".to_vec()),
                "changelog.json" => Some(br#"[{"version": "1.1.0", "title": "Updates"}]"#.to_vec()),
                _ => None,
            }
        }
        fn open_url(&self, url: &str) -> R<()> {
            self.opened.lock().unwrap().push(url.into());
            Ok(())
        }
        fn open_path(&self, path: &Path) -> R<()> {
            self.opened.lock().unwrap().push(path.to_string_lossy().into());
            Ok(())
        }
        fn autostart(&self) -> bool {
            *self.auto.lock().unwrap()
        }
        fn set_autostart(&self, on: bool) -> R<()> {
            *self.auto.lock().unwrap() = on;
            Ok(())
        }
        fn version(&self) -> String {
            "1.0.0".into()
        }
        fn update_check(&self) -> Value {
            json!({"available": true, "current": "1.0.0", "version": "1.1.0", "notes": "Better CVs"})
        }
        fn update_install(&self) -> R<bool> {
            Ok(true)
        }
    }

    fn call(agent: &Arc<Agent>, host: &Arc<dyn Host>, method: &str, path: &str, body: Value) -> (u16, Value) {
        let (path, query) = match path.split_once('?') {
            Some((p, q)) => (p, url::form_urlencoded::parse(q.as_bytes()).into_owned().collect()),
            None => (path, HashMap::new()),
        };
        let r = handle(agent, host, &Req { method: method.into(), path: path.into(), query, body: if body.is_null() { vec![] } else { serde_json::to_vec(&body).unwrap() }, remote: false });
        (r.status, serde_json::from_slice(&r.body).unwrap_or(Value::Null))
    }

    fn world() -> (Setup, Arc<Agent>, Arc<FakeHost>, Arc<dyn Host>) {
        let s = setup();
        let agent = s.agent.clone();
        let fh = Arc::new(FakeHost::default());
        let host: Arc<dyn Host> = fh.clone();
        (s, agent, fh, host)
    }

    #[test]
    fn screens_and_routes() {
        let (_s, agent, fh, host) = world();
        let r = handle(&agent, &host, &Req { method: "GET".into(), path: "/".into(), query: HashMap::new(), body: vec![], remote: false });
        assert_eq!((r.status, r.body.as_slice()), (200, b"hello".as_slice()));
        assert_eq!(call(&agent, &host, "GET", "/static/../x", Value::Null).0, 404);
        assert_eq!(call(&agent, &host, "GET", "/api/nope", Value::Null).0, 404);
        // Settings answers (it once waited on its own database lock), with the countries and their cities.
        agent.db().set("career", r#"{"advice":"Lead with delivery.","paths":[]}"#).unwrap();
        let (code, st) = call(&agent, &host, "GET", "/api/settings", Value::Null);
        assert_eq!(code, 200);
        assert_eq!(st["career"]["advice"], "Lead with delivery.");
        let qa = st["countries"].as_array().unwrap().iter().find(|c| c["code"] == "qa").unwrap();
        assert!(qa["cities"].as_array().unwrap().iter().any(|c| c == "Doha"));

        agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let (st, o) = call(&agent, &host, "GET", "/api/overview", Value::Null);
        assert_eq!((st, o["counts"]["ready"].as_i64()), (200, Some(1)));
        let (_, list) = call(&agent, &host, "GET", "/api/jobs?status=ready", Value::Null);
        assert_eq!(list["jobs"].as_array().unwrap().len(), 1);
        let (_, one) = call(&agent, &host, "GET", "/api/jobs/test:1", Value::Null);
        assert_eq!(one["job"]["title"], "Technical Program Manager");
        assert_eq!((one["history"][0]["kind"].as_str(), one["history"][1]["kind"].as_str()), (Some("rescored"), Some("tailored")));
        assert_eq!((one["job"]["score"].as_i64(), one["job"]["score_after"].as_i64()), (Some(85), Some(92)));
        assert_eq!(call(&agent, &host, "GET", "/api/jobs/none", Value::Null).0, 404);

        assert_eq!(call(&agent, &host, "POST", "/api/jobs/test:1/status", json!({"status": "bogus"})).0, 400);
        call(&agent, &host, "POST", "/api/jobs/test:1/letter", json!({"text": "Dear team,\n\nNew letter.\n\nJane"}));
        assert_eq!(agent.db().job("test:1").unwrap().unwrap().cover_letter.as_deref(), Some("Dear team,\n\nNew letter.\n\nJane"));
        call(&agent, &host, "POST", "/api/jobs/test:1/open", json!({"what": "posting"}));
        call(&agent, &host, "POST", "/api/jobs/test:1/open", json!({"what": "cv"}));
        let opened = fh.opened.lock().unwrap().clone();
        assert_eq!(opened[0], "https://acme.example/jobs/1");
        assert!(opened[1].ends_with("Jane Candidate - Acme.docx"));
        let (_, u) = call(&agent, &host, "GET", "/api/update/check", Value::Null);
        assert_eq!((u["version"].as_str(), u["notified"].as_bool()), (Some("1.1.0"), Some(false)));
        assert_eq!(call(&agent, &host, "POST", "/api/update/install", Value::Null).1["installed"], true);
        assert_eq!(call(&agent, &host, "GET", "/api/changelog", Value::Null).1["log"][0]["version"], "1.1.0");
        assert_eq!(call(&agent, &host, "POST", "/api/jobs/test:1/revise", json!({"what": "cv", "note": ""})).0, 400);
        assert_eq!(call(&agent, &host, "POST", "/api/jobs/test:1/revise", json!({"what": "nope", "note": "shorter"})).0, 400);
        let (_, r) = call(&agent, &host, "GET", "/api/results", Value::Null);
        assert_eq!(r["funnel"]["found"], 1);
        let (_, one) = call(&agent, &host, "GET", "/api/jobs/test:1", Value::Null);
        assert_eq!((one["undo"]["cv"].as_bool(), one["follow_up"].is_null()), (Some(false), true));
        let (_, a) = call(&agent, &host, "POST", "/api/jobs/test:1/approve", Value::Null);
        assert_eq!(a["outcome"], "approved");
        assert_eq!(call(&agent, &host, "POST", "/api/open-url", json!({"url": "file:///etc/passwd"})).0, 400);
    }

    #[test]
    fn settings_flow() {
        let (s, agent, fh, host) = world();
        assert_eq!(call(&agent, &host, "POST", "/api/run/inbox", Value::Null).0, 200, "fake Gmail is connected");
        let (_, st) = call(&agent, &host, "GET", "/api/settings", Value::Null);
        assert_eq!(st["claude"]["key"], false);
        assert_eq!(st["claude"]["engine"], "code", "Claude Code on this PC is the default");
        assert_eq!(st["cvs"].as_array().unwrap().len(), 2);
        assert!(st["cvs"][0]["editable"].as_u64().unwrap() > 0);

        let mut bad = st["profile"].clone();
        bad["timezone"] = json!("Mars/Base");
        let (code, e) = call(&agent, &host, "POST", "/api/settings/profile", bad);
        assert!(code == 400 && e["error"].as_str().unwrap().contains("time zone"));
        let mut good = st["profile"].clone();
        good["score_threshold"] = json!(80);
        assert_eq!(call(&agent, &host, "POST", "/api/settings/profile", good).0, 200);
        assert_eq!(agent.profile().score_threshold, 80);

        // Saving settings reconnects the real engine; put the stand-in back so no real Claude is called.
        *agent.llm.write().unwrap() = s.llm.clone();
        // CVs: replace a track's file, add new ones, edit, remove.
        let post_bytes = |path: &str, body: Vec<u8>| {
            let (p, q) = path.split_once('?').unwrap_or((path, ""));
            handle(&agent, &host, &Req { method: "POST".into(), path: p.into(), query: url::form_urlencoded::parse(q.as_bytes()).into_owned().collect(), body, remote: false })
        };
        assert_eq!(post_bytes("/api/cvs/data/file?filename=x.txt", b"tiny".to_vec()).status, 400);
        assert_eq!(post_bytes("/api/cvs/data/file?filename=data.docx", cv::sample_docx()).status, 200);
        assert!(agent.cv_path("data").exists());
        let r = post_bytes("/api/cvs?filename=Alex%20CV.docx", cv::sample_docx());
        assert_eq!(r.status, 200);
        let added: Value = serde_json::from_slice(&r.body).unwrap();
        assert_eq!(added["track"]["name"], "data-analysis");
        call(&agent, &host, "POST", "/api/cvs/data-analysis/meta", json!({"label": "Analytics", "titles": ["Analytics Lead", " "], "keywords": ["sql"]}));
        let t = agent.profile().tracks.into_iter().find(|t| t.name == "data-analysis").unwrap();
        assert_eq!((t.label.as_str(), t.titles.clone()), ("Analytics", vec!["Analytics Lead".to_string()]));
        assert_eq!(call(&agent, &host, "POST", "/api/cvs/data-analysis/remove", Value::Null).0, 200);
        assert_eq!(call(&agent, &host, "POST", "/api/cvs/data-analysis/remove", Value::Null).0, 404);

        let r = handle(&agent, &host, &Req { method: "POST".into(), path: "/api/settings/google-client".into(), query: HashMap::new(), body: br#"{"web":{}}"#.to_vec(), remote: false });
        assert_eq!(r.status, 400);
        assert_eq!(call(&agent, &host, "POST", "/api/settings/google-connect", Value::Null).0, 400);

        call(&agent, &host, "POST", "/api/settings/keys", json!({"adzuna_id": "id1", "adzuna_key": "k1"}));
        assert_eq!(call(&agent, &host, "POST", "/api/settings/claude", json!({"path": "/no/such/claude"})).0, 400);
        call(&agent, &host, "POST", "/api/settings/claude", json!({"engine": "api", "model": "claude-opus-5-5"}));
        let st0 = call(&agent, &host, "GET", "/api/settings", Value::Null).1;
        assert_eq!((st0["claude"]["tailor_model"].as_str(), st0["claude"]["tailor_effort"].as_str()), (Some("opus"), Some("medium")), "Opus at medium unless changed");
        assert_eq!(call(&agent, &host, "POST", "/api/settings/claude", json!({"tailor_effort": "extreme"})).0, 400);
        call(&agent, &host, "POST", "/api/settings/claude", json!({"tailor_model": "sonnet", "tailor_effort": "high"}));
        let st1 = call(&agent, &host, "GET", "/api/settings", Value::Null).1;
        assert_eq!((st1["claude"]["tailor_model"].as_str(), st1["claude"]["tailor_effort"].as_str()), (Some("sonnet"), Some("high")));
        let (_, st2) = call(&agent, &host, "GET", "/api/settings", Value::Null);
        assert_eq!((st2["claude"]["engine"].as_str(), st2["claude"]["model"].as_str()), (Some("api"), Some("claude-opus-5-5")));
        let (_, st) = call(&agent, &host, "GET", "/api/settings", Value::Null);
        assert_eq!((st["adzuna"]["id"].as_str(), st["adzuna"]["key"].as_bool()), (Some("id1"), Some(true)));
        assert!(serde_json::to_string(&st).unwrap().find("k1").is_none(), "secrets are never sent to the window");

        call(&agent, &host, "POST", "/api/settings/app", json!({"autostart": true, "close": "exit"}));
        assert!(*fh.auto.lock().unwrap());
        assert_eq!(agent.secret("app.close"), "exit");
        // Saving keys reloads connections from storage, where no Google token exists here.
        assert_eq!(call(&agent, &host, "POST", "/api/run/inbox", Value::Null).0, 400);
    }
}
