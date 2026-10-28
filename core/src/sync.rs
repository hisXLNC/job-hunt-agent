//! Pick up where you left off on any computer: Job Hunt keeps an up-to-date copy of everything in a
//! folder that Google Drive (or OneDrive, or a Synology share) syncs, or straight in your Google Drive
//! through the Google connection, and a new or other computer that sees a newer copy offers to
//! continue from it.
//!
//! In the sync folder (or the "Job Hunt" folder in Google Drive):
//!   "Job Hunt latest.zip"   everything, as a backup snapshot (saved sign-ins included unless turned off)
//!   "Job Hunt latest.json"  who saved it and when, read without opening the zip
//! Daily dated backups go to the same folder.
//!
//! Only one computer should use Job Hunt at a time. A computer never overwrites a newer copy saved
//! by another computer; it offers to continue from it instead. While Job Hunt is open, it also
//! keeps "Job Hunt in use.json" fresh, so another computer that opens it can warn you and offer to
//! take over: this one then saves its latest data and stops, and the other continues from it.

use crate::pipeline::Agent;
use crate::{Error, R};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

pub const ZIP: &str = "Job Hunt latest.zip";
pub const INFO: &str = "Job Hunt latest.json";
pub const IN_USE: &str = "Job Hunt in use.json";
pub const CSV: &str = "Job Hunt applications.csv";

/// How often an open Job Hunt says it's in use, and how long that counts after the last time.
const BEAT_MINUTES: i64 = 2;
const FRESH_MINUTES: i64 = 10;

/// Who's using Job Hunt right now, as written in the sync folder.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct InUse {
    pub device: String,
    pub device_name: String,
    pub at: String,
    /// The computer this one took over from, until it has handed over.
    pub took_over_from: String,
}

/// This computer's side of it, kept in memory while Job Hunt runs.
#[derive(Clone, Debug, Default)]
pub struct Presence {
    /// When this computer last wrote that it's in use.
    last_beat: Option<chrono::DateTime<chrono::Utc>>,
    /// Another computer took over, and this one handed over to it (its name).
    handed_to: Option<String>,
    /// This computer took over from another: (id, name, when).
    took_over: Option<(String, String, String)>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Info {
    pub device: String,
    pub device_name: String,
    pub saved_at: String,
    pub version: String,
    pub jobs: i64,
}

/// Where the sync copy lives: a folder on this computer that a sync app copies to the cloud, or
/// the Job Hunt folder in your Google Drive, reached directly.
pub enum Store {
    Folder(PathBuf),
    Drive(std::sync::Arc<dyn crate::google::Files>),
}

/// The place name `continue_from` and the screens use for Google Drive.
pub const DRIVE: &str = "drive:";

/// Small files read from Drive, kept a minute: the Overview asks every few seconds.
static DRIVE_CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, (std::time::Instant, Option<Vec<u8>>)>>> = std::sync::Mutex::new(None);
const DRIVE_CACHE_SECS: u64 = 60;

/// A cache entry's name: the file, and which Drive connection it's from.
fn cache_key(f: &std::sync::Arc<dyn crate::google::Files>, name: &str) -> String {
    format!("{:p}/{name}", std::sync::Arc::as_ptr(f) as *const ())
}

impl Store {
    fn read(&self, name: &str) -> R<Option<Vec<u8>>> {
        match self {
            Store::Folder(d) => {
                let p = d.join(name);
                Ok(if p.is_file() { Some(std::fs::read(p)?) } else { None })
            }
            Store::Drive(f) => {
                let small = name.ends_with(".json");
                if small {
                    if let Some((at, v)) = DRIVE_CACHE.lock().unwrap().get_or_insert_with(Default::default).get(&cache_key(f, name)) {
                        if at.elapsed().as_secs() < DRIVE_CACHE_SECS {
                            return Ok(v.clone());
                        }
                    }
                }
                let v = f.read(name)?;
                if small {
                    DRIVE_CACHE.lock().unwrap().get_or_insert_with(Default::default).insert(cache_key(f, name), (std::time::Instant::now(), v.clone()));
                }
                Ok(v)
            }
        }
    }

    fn write(&self, name: &str, bytes: &[u8]) -> R<()> {
        match self {
            Store::Folder(d) => {
                std::fs::create_dir_all(d).map_err(|e| Error(format!("Couldn't use the sync folder {}: {e}", d.display())))?;
                let tmp = d.join(format!("{name}.part"));
                std::fs::write(&tmp, bytes)?;
                std::fs::rename(&tmp, d.join(name))?;
                Ok(())
            }
            Store::Drive(f) => {
                let mime = if name.ends_with(".zip") { "application/zip" } else if name.ends_with(".csv") { "text/csv" } else { "application/json" };
                f.write(name, bytes, mime)?;
                if name.ends_with(".json") {
                    DRIVE_CACHE.lock().unwrap().get_or_insert_with(Default::default).insert(cache_key(f, name), (std::time::Instant::now(), Some(bytes.to_vec())));
                }
                Ok(())
            }
        }
    }

    fn remove(&self, name: &str) -> R<()> {
        match self {
            Store::Folder(d) => {
                let _ = std::fs::remove_file(d.join(name));
                Ok(())
            }
            Store::Drive(f) => {
                DRIVE_CACHE.lock().unwrap().get_or_insert_with(Default::default).remove(&cache_key(f, name));
                f.remove(name)
            }
        }
    }

    /// How `continue_from` and the screens name it: the folder's path, or "drive:".
    pub fn place(&self) -> String {
        match self {
            Store::Folder(d) => d.to_string_lossy().to_string(),
            Store::Drive(_) => DRIVE.into(),
        }
    }

    fn info(&self) -> Option<Info> {
        match self {
            Store::Folder(d) => info_in(d),
            Store::Drive(_) => self.read(INFO).ok().flatten().and_then(|b| serde_json::from_slice(&b).ok()),
        }
    }
}

/// Syncing straight with Google Drive (rather than through a folder).
pub fn on_drive(agent: &Agent) -> bool {
    agent.secret("sync.where") == "drive"
}

fn drive(agent: &Agent) -> Option<Store> {
    agent.files.read().unwrap().clone().map(Store::Drive)
}

/// Where this computer syncs: Google Drive, or the sync folder.
pub fn store(agent: &Agent) -> Option<Store> {
    if on_drive(agent) { drive(agent) } else { folder(agent).map(Store::Folder) }
}

/// A place by the name `Store::place` gives it.
fn store_at(agent: &Agent, place: &str) -> R<Store> {
    if place == DRIVE {
        drive(agent).ok_or_else(|| Error("Connect Google in Settings \u{2192} Accounts first.".into()))
    } else {
        Ok(Store::Folder(PathBuf::from(place)))
    }
}

/// What this computer knows about the sync folder. Kept outside the database, so a restore
/// doesn't overwrite it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
struct State {
    /// saved_at of the copy this computer last wrote or continued from.
    known: String,
    /// saved_at of a copy you chose not to continue from.
    declined: String,
}

/// A save time precise enough to order two saves in the same second.
fn stamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

fn read_json<T: for<'a> Deserialize<'a> + Default>(p: &Path) -> T {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// This computer's id and name, made once and never copied to other computers.
pub fn device(data: &Path) -> (String, String) {
    let p = data.join("device.json");
    let v: Value = read_json(&p);
    let name = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "this computer".into());
    if let Some(id) = v["id"].as_str().filter(|s| !s.is_empty()) {
        return (id.to_string(), name);
    }
    let id = crate::util::short_hash(&format!("{}{}", rand::random::<u64>(), crate::util::now()));
    let _ = std::fs::create_dir_all(data);
    let _ = std::fs::write(&p, json!({ "id": id }).to_string());
    (id, name)
}

fn state(data: &Path) -> State {
    read_json(&data.join("sync-state.json"))
}

fn save_state(data: &Path, s: &State) {
    let _ = std::fs::write(data.join("sync-state.json"), serde_json::to_string(s).unwrap_or_default());
}

pub fn enabled(agent: &Agent) -> bool {
    agent.secret("sync.on") == "1"
}

/// The sync folder: the backup folder you chose.
pub fn folder(agent: &Agent) -> Option<PathBuf> {
    let d = agent.secret("backup.dir");
    (!d.trim().is_empty()).then(|| PathBuf::from(d.trim()))
}

pub fn info_in(dir: &Path) -> Option<Info> {
    let p = dir.join(INFO);
    if !p.is_file() || !dir.join(ZIP).is_file() {
        return None;
    }
    Some(read_json(&p))
}

/// Folders where Google Drive for desktop, OneDrive or Dropbox usually keep your files, with a
/// "Job Hunt" folder inside. Used to find your data on a new computer.
pub fn candidates() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = vec![];
    if cfg!(windows) {
        for letter in b'D'..=b'Z' {
            let l = letter as char;
            roots.push(PathBuf::from(format!("{l}:\\My Drive")));
            roots.push(PathBuf::from(format!("{l}:\\Google Drive\\My Drive")));
        }
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from) {
        for sub in ["My Drive", "Google Drive", "Google Drive/My Drive", "OneDrive", "Dropbox"] {
            roots.push(home.join(sub));
        }
        if let Ok(rd) = std::fs::read_dir(&home) {
            // "OneDrive - Company" and similar.
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("OneDrive") || n.starts_with("Google Drive") {
                    roots.push(e.path());
                }
            }
        }
    }
    if let Some(od) = std::env::var_os("OneDrive") {
        roots.push(PathBuf::from(od));
    }
    roots.push(PathBuf::from("/backups"));
    let mut out = vec![];
    for r in roots {
        for p in [r.join("Job Hunt"), r.clone()] {
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

/// The likeliest Google Drive (or OneDrive) folder on this computer for a new "Job Hunt" folder.
pub fn suggest_folder() -> Option<PathBuf> {
    candidates().into_iter().filter(|p| p.ends_with("Job Hunt")).find(|p| p.parent().map(|r| r.is_dir()).unwrap_or(false))
}

/// A newer copy saved by another computer, if there is one: (place, info). Not set up yet, it
/// looks in the usual Google Drive folders and, with Google connected, in Google Drive itself.
pub fn newer_elsewhere(agent: &Agent) -> Option<(String, Info)> {
    let (me, _) = device(&agent.data);
    let st = state(&agent.data);
    let places: Vec<Store> = match store(agent) {
        Some(s) => vec![s],
        None if on_drive(agent) => vec![],
        None => candidates().into_iter().map(Store::Folder).chain(if enabled(agent) { None } else { drive(agent) }).collect(),
    };
    for p in places {
        let Some(info) = p.info() else { continue };
        if info.device == me || info.saved_at <= st.known || info.saved_at == st.declined {
            continue;
        }
        return Some((p.place(), info));
    }
    None
}

/// Save the latest copy to the sync folder. Skipped (Ok(false)) when nothing changed, or when another
/// computer saved a newer copy that this one hasn't picked up (it's never overwritten).
pub fn push(agent: &Agent, force: bool) -> R<bool> {
    let Some(place) = store(agent) else { return Ok(false) };
    if let Some(to) = handed_over(agent) {
        return Err(Error(format!("Job Hunt is in use on {to} now; this computer's copy was saved for it. Continue from it there.")));
    }
    let changes = agent.db().changes();
    if !force && agent.sync_mark.load(Ordering::SeqCst) == changes {
        return Ok(false);
    }
    let (me, name) = device(&agent.data);
    let mut st = state(&agent.data);
    if let Some(info) = place.info() {
        if info.device != me && info.saved_at > st.known && info.saved_at != st.declined {
            return Err(Error(format!(
                "{} has newer Job Hunt data (saved {}). Continue from it, or choose to keep this computer's, before syncing.",
                info.device_name, info.saved_at
            )));
        }
    }
    let secrets = agent.secret("sync.secrets") != "0";
    match &place {
        Store::Folder(dir) => {
            std::fs::create_dir_all(dir).map_err(|e| Error(format!("Couldn't use the sync folder {}: {e}", dir.display())))?;
            crate::backup::write_snapshot(agent, &dir.join(ZIP), secrets)?;
        }
        Store::Drive(_) => {
            // Made here first, then uploaded.
            let tmp = agent.data.join("sync-upload.zip");
            crate::backup::write_snapshot(agent, &tmp, secrets)?;
            let bytes = std::fs::read(&tmp)?;
            let _ = std::fs::remove_file(&tmp);
            place.write(ZIP, &bytes)?;
        }
    }
    // A spreadsheet copy of your applications, to open in Google Sheets or Excel.
    if let Ok(csv) = agent.export_csv() {
        let _ = place.write(CSV, csv.as_bytes());
    }
    let jobs: i64 = agent.db().counts().map(|c| c.values().filter_map(|v| v.as_i64()).sum()).unwrap_or(0);
    let info = Info { device: me, device_name: name, saved_at: stamp(), version: agent.secret("app.version"), jobs };
    place.write(INFO, &serde_json::to_vec_pretty(&info).unwrap_or_default())?;
    st.known = info.saved_at.clone();
    save_state(&agent.data, &st);
    // Record the time first: saving it is itself a change.
    agent.db().set("last.sync", &info.saved_at)?;
    agent.sync_mark.store(agent.db().changes(), Ordering::SeqCst);
    Ok(true)
}

/// Continue from the copy in `dir`: stage it as a restore (applied when Job Hunt restarts) and
/// remember the folder, so this computer keeps syncing there.
pub fn continue_from(agent: &Agent, place: &str) -> R<Info> {
    let at = store_at(agent, place)?;
    let info = at.info().ok_or_else(|| Error("There's no Job Hunt data there.".into()))?;
    let bytes = at.read(ZIP)?.ok_or_else(|| Error("There's no Job Hunt data there.".into()))?;
    crate::backup::stage_restore(&agent.data, &bytes)?;
    let mut st = state(&agent.data);
    st.known = info.saved_at.clone();
    save_state(&agent.data, &st);
    // Written next to the staged restore; applied after it (see apply_after_restore).
    std::fs::write(agent.data.join("sync-folder.txt"), place.as_bytes())?;
    Ok(info)
}

/// After a restore from the sync folder, keep syncing to that folder on this computer.
pub fn apply_after_restore(agent: &Agent) {
    let p = agent.data.join("sync-folder.txt");
    if let Ok(place) = std::fs::read_to_string(&p) {
        let db = agent.db();
        if place.trim() == DRIVE {
            let _ = db.set("sync.where", "drive");
        } else {
            let _ = db.set("sync.where", "folder");
            let _ = db.set("backup.dir", place.trim());
        }
        let _ = db.set("sync.on", "1");
        drop(db);
        let _ = std::fs::remove_file(&p);
        // Start counting from here: nothing new to push yet.
        agent.sync_mark.store(agent.db().changes(), Ordering::SeqCst);
    }
}

/// You chose to keep this computer's data over another computer's newer copy.
pub fn decline(agent: &Agent, saved_at: &str) {
    let mut st = state(&agent.data);
    st.declined = saved_at.to_string();
    save_state(&agent.data, &st);
}

/// For the screens: whether syncing is on, where, when, and any newer copy from another computer.
pub fn status(agent: &Agent) -> Value {
    let (_, name) = device(&agent.data);
    let newer = newer_elsewhere(agent).map(|(d, i)| json!({ "folder": d, "device": i.device_name, "saved_at": i.saved_at, "jobs": i.jobs }));
    json!({
        "on": enabled(agent),
        "where": if on_drive(agent) { "drive" } else { "folder" },
        "error": agent.secret("sync.error"),
        "drive_ready": agent.files.read().unwrap().is_some(),
        "folder": folder(agent),
        "suggest": suggest_folder(),
        "secrets": agent.secret("sync.secrets") != "0",
        "last": agent.secret("last.sync"),
        "every": every(agent),
        "running": agent.is_running("sync"),
        "drive_backup": agent.secret("last.drive_backup"),
        "device": name,
        "newer": newer,
    })
}

fn fresh(u: &InUse) -> bool {
    chrono::DateTime::parse_from_rfc3339(&u.at)
        .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_minutes() < FRESH_MINUTES)
        .unwrap_or(false)
}

fn in_use_file(agent: &Agent) -> Option<(Store, Option<InUse>)> {
    if !enabled(agent) {
        return None;
    }
    let place = store(agent)?;
    let u = place.read(IN_USE).ok().flatten().map(|b| serde_json::from_slice::<InUse>(&b).unwrap_or_default());
    Some((place, u))
}

fn write_in_use(place: &Store, u: &InUse) -> R<()> {
    place.write(IN_USE, &serde_json::to_vec_pretty(u).unwrap_or_default())
}

/// The computer this one handed over to, if another took over.
pub fn handed_over(agent: &Agent) -> Option<String> {
    agent.presence.lock().unwrap().handed_to.clone()
}

/// Once a minute while Job Hunt runs: say this computer is using it. When another computer has
/// taken over from this one, save the latest data for it and stop.
pub fn beat(agent: &Agent) {
    let Some((dir, file)) = in_use_file(agent) else { return };
    let (me, name) = device(&agent.data);
    let now = chrono::Utc::now();
    let mut pr = agent.presence.lock().unwrap().clone();
    if pr.handed_to.is_some() {
        return;
    }
    let dir = &dir;
    if let Some(u) = file.as_ref().filter(|u| u.device != me && fresh(u)) {
        if u.took_over_from == me {
            // Taken over: save everything for the other computer, then stop working here.
            if let Err(e) = push(agent, true) {
                let _ = agent.db().log(None, "sync:error", &format!("handing over to {}: {}", u.device_name, e.0));
                return;
            }
            pr.handed_to = Some(u.device_name.clone());
            *agent.presence.lock().unwrap() = pr;
            let _ = agent.db().log(None, "sync", &format!("handed over to {}", u.device_name));
            agent.note(&format!("Job Hunt moved to {}", u.device_name), "Your latest data is saved for it. Close Job Hunt on this computer.");
        }
        // Someone else is using it: leave their note alone.
        return;
    }
    let mine = file.as_ref().is_some_and(|u| u.device == me);
    if mine && pr.last_beat.is_some_and(|t| (now - t).num_minutes() < BEAT_MINUTES) {
        return;
    }
    let took = pr.took_over.as_ref().filter(|(_, _, at)| {
        chrono::DateTime::parse_from_rfc3339(at).map(|t| (now - t.with_timezone(&chrono::Utc)).num_minutes() < FRESH_MINUTES * 3).unwrap_or(false)
    });
    let u = InUse { device: me, device_name: name, at: now.to_rfc3339(), took_over_from: took.map(|t| t.0.clone()).unwrap_or_default() };
    if write_in_use(dir, &u).is_ok() {
        agent.presence.lock().unwrap().last_beat = Some(now);
    }
}

/// Use Job Hunt here although another computer has it open: that one saves its data and stops,
/// then this one offers to continue from it.
pub fn take_over(agent: &Agent) -> R<String> {
    let (dir, file) = in_use_file(agent).ok_or_else(|| Error("Sync between computers is off.".into()))?;
    let (me, name) = device(&agent.data);
    let other = file.filter(|u| u.device != me && fresh(u)).ok_or_else(|| Error("No other computer is using Job Hunt now.".into()))?;
    let now = chrono::Utc::now();
    write_in_use(&dir, &InUse { device: me, device_name: name, at: now.to_rfc3339(), took_over_from: other.device.clone() })?;
    let mut pr = agent.presence.lock().unwrap();
    pr.took_over = Some((other.device, other.device_name.clone(), now.to_rfc3339()));
    pr.last_beat = Some(now);
    Ok(other.device_name)
}

/// After handing over: use Job Hunt here again (a server can't be closed, so this is how it comes
/// back). If the other computer is still using it, this one takes over from it; either way, its
/// newer data is then offered here to continue from.
pub fn resume_here(agent: &Agent) -> R<()> {
    agent.presence.lock().unwrap().handed_to = None;
    match take_over(agent) {
        Ok(_) => Ok(()),
        // Nobody else using it now: just carry on here.
        Err(e) if e.0.contains("No other computer") => {
            beat(agent);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// On exit: this computer is no longer using Job Hunt.
pub fn release(agent: &Agent) {
    let Some((place, Some(u))) = in_use_file(agent) else { return };
    if u.device == device(&agent.data).0 {
        let _ = place.remove(IN_USE);
    }
}

/// For the Overview: another computer using Job Hunt now, a take-over waiting for the other
/// computer's data, or a hand-over done.
pub fn presence_status(agent: &Agent) -> Value {
    let pr = agent.presence.lock().unwrap().clone();
    if let Some(to) = pr.handed_to {
        return json!({ "handed_to": to });
    }
    let Some((_, file)) = in_use_file(agent) else { return Value::Null };
    let me = device(&agent.data).0;
    if let Some(u) = file.filter(|u| u.device != me && fresh(u)) {
        return json!({ "other": u.device_name, "since": u.at });
    }
    if let Some((_, from, at)) = pr.took_over {
        let recent = chrono::DateTime::parse_from_rfc3339(&at).map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_minutes() < FRESH_MINUTES * 3).unwrap_or(false);
        if recent && newer_elsewhere(agent).is_none() {
            return json!({ "waiting_for": from, "since": at });
        }
    }
    Value::Null
}

/// How often to sync by itself after a change, in minutes; 0: only when you press Sync now (and
/// when Job Hunt exits). Uploading the whole copy to Google Drive is heavier than a folder, so it
/// waits longer unless you choose.
pub fn every(agent: &Agent) -> i64 {
    agent.secret("sync.every").parse::<i64>().ok().filter(|m| *m >= 0).unwrap_or(if on_drive(agent) { 10 } else { 5 })
}

/// Daily backups kept in your Google Drive: the newest ones, older ones deleted.
pub const DRIVE_BACKUPS: usize = 3;

/// A copy of a daily backup in your Google Drive, when you sync there: "Job Hunt backup
/// 2026-10-27.zip", keeping the last three. Ok(false) when you don't sync with Google Drive.
pub fn backup_to_drive(agent: &Agent, zip: &Path) -> R<bool> {
    if !enabled(agent) || !on_drive(agent) {
        return Ok(false);
    }
    backup_to_drive_on(agent, zip, &chrono::Local::now().format("%Y-%m-%d").to_string())
}

fn backup_to_drive_on(agent: &Agent, zip: &Path, day: &str) -> R<bool> {
    let Some(place) = drive(agent) else { return Ok(false) };
    let name = format!("Job Hunt backup {day}.zip");
    place.write(&name, &std::fs::read(zip)?)?;
    agent.db().set("last.drive_backup", &crate::util::now())?;
    // The ones Job Hunt put there (it can only find its files by name), newest last.
    let mut kept: Vec<String> = serde_json::from_str(&agent.secret("drive.backups")).unwrap_or_default();
    kept.retain(|n| n != &name);
    kept.push(name);
    let old = kept.len().saturating_sub(DRIVE_BACKUPS);
    for gone in kept.drain(..old) {
        let _ = place.remove(&gone);
    }
    // Versions before this one kept one per weekday ("Job Hunt backup Mon.zip"): cleared once.
    if agent.secret("drive.backups.weekdays_cleared").is_empty() {
        for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] {
            let _ = place.remove(&format!("Job Hunt backup {d}.zip"));
        }
        agent.db().set("drive.backups.weekdays_cleared", "1")?;
    }
    agent.db().set("drive.backups", &serde_json::to_string(&kept)?)?;
    Ok(true)
}

/// Whether a sync is due: on, something changed, and the last one (or the last try) was at
/// least `every` minutes ago.
pub fn due(agent: &Agent) -> bool {
    let gap = every(agent);
    let ago = |k: &str| chrono::DateTime::parse_from_rfc3339(&agent.secret(k)).map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_minutes()).ok();
    let recent = [ago("last.sync"), ago("sync.tried")].into_iter().flatten().any(|m| m < gap);
    gap > 0 && enabled(agent) && store(agent).is_some() && !recent && handed_over(agent).is_none() && agent.sync_mark.load(Ordering::SeqCst) != agent.db().changes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{posting, setup};

    #[test]
    fn syncs_as_often_as_you_choose() {
        let drive = tempfile::tempdir().unwrap();
        let a = setup();
        a.agent.db().set("backup.dir", &drive.path().to_string_lossy()).unwrap();
        a.agent.db().set("sync.on", "1").unwrap();
        a.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        assert_eq!(every(&a.agent), 5, "a folder: five minutes unless you choose");
        assert!(due(&a.agent), "changed, never synced");
        a.agent.db().set("sync.every", "0").unwrap();
        assert!(!due(&a.agent), "only when you press Sync now");
        a.agent.db().set("sync.every", "60").unwrap();
        a.agent.db().set("sync.tried", &(chrono::Utc::now() - chrono::Duration::minutes(30)).to_rfc3339()).unwrap();
        assert!(!due(&a.agent), "a failed try half an hour ago waits for the hour");
        a.agent.db().set("sync.tried", &(chrono::Utc::now() - chrono::Duration::minutes(61)).to_rfc3339()).unwrap();
        assert!(due(&a.agent));
        assert!(push(&a.agent, false).unwrap());
        assert_eq!(status(&a.agent)["every"], 60);
    }

    #[test]
    fn two_computers_take_turns() {
        let drive = tempfile::tempdir().unwrap();
        let dir = drive.path().join("Job Hunt");

        // Computer A works and syncs.
        let a = setup();
        a.agent.db().set("backup.dir", &dir.to_string_lossy()).unwrap();
        a.agent.db().set("sync.on", "1").unwrap();
        a.agent.db().set("claude.key", "sk-a").unwrap();
        a.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        assert!(due(&a.agent));
        assert!(push(&a.agent, false).unwrap());
        assert!(std::fs::read_to_string(dir.join(CSV)).unwrap().contains("Technical Program Manager"), "a spreadsheet copy too");
        assert!(!due(&a.agent) && !push(&a.agent, false).unwrap(), "nothing changed since");
        a.agent.db().set("y", "1").unwrap();
        assert!(!due(&a.agent), "a change right after a sync waits a few minutes");
        assert!(newer_elsewhere(&a.agent).is_none(), "its own copy isn't news");

        // Computer B, a fresh install, sees A's copy and continues from it.
        let b = setup();
        b.agent.db().set("backup.dir", &dir.to_string_lossy()).unwrap();
        let (_, info) = newer_elsewhere(&b.agent).expect("A's data is offered");
        assert!(info.jobs >= 1);
        // B must not overwrite it before deciding.
        b.agent.db().set("sync.on", "1").unwrap();
        assert!(push(&b.agent, true).is_err());
        continue_from(&b.agent, &dir.to_string_lossy()).unwrap();
        assert!(crate::backup::apply_pending(&b.agent.data).unwrap());
        let restored = crate::db::Db::open(&b.agent.data.join("jobhunt.db")).unwrap();
        assert!(restored.job("test:1").unwrap().is_some(), "B continues where A left off");
        assert_eq!(restored.get("claude.key").unwrap().as_deref(), Some("sk-a"), "sign-ins travel by default");
        assert!(newer_elsewhere(&b.agent).is_none(), "already picked up");

        // A, later, sees B's newer copy after B saves.
        b.agent.db().set("x", "1").unwrap();
        push(&b.agent, false).unwrap();
        let (_, from_b) = newer_elsewhere(&a.agent).expect("B's newer copy is offered to A");
        // Keeping A's own data instead lets A sync over it.
        decline(&a.agent, &from_b.saved_at);
        assert!(newer_elsewhere(&a.agent).is_none());
        assert!(push(&a.agent, true).unwrap());
    }

    /// Google Drive, in memory.
    #[derive(Default)]
    struct FakeDrive(std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>);
    impl crate::google::Files for FakeDrive {
        fn read(&self, name: &str) -> R<Option<Vec<u8>>> {
            Ok(self.0.lock().unwrap().get(name).cloned())
        }
        fn write(&self, name: &str, bytes: &[u8], _mime: &str) -> R<()> {
            self.0.lock().unwrap().insert(name.into(), bytes.to_vec());
            Ok(())
        }
        fn remove(&self, name: &str) -> R<()> {
            self.0.lock().unwrap().remove(name);
            Ok(())
        }
    }

    #[test]
    fn two_computers_through_google_drive() {
        let drive: std::sync::Arc<dyn crate::google::Files> = std::sync::Arc::new(FakeDrive::default());
        // Computer A syncs straight to Google Drive: no folder.
        let a = setup();
        *a.agent.files.write().unwrap() = Some(drive.clone());
        a.agent.db().set("sync.where", "drive").unwrap();
        a.agent.db().set("sync.on", "1").unwrap();
        a.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        assert!(due(&a.agent) && push(&a.agent, false).unwrap());
        assert!(drive.read(ZIP).unwrap().is_some() && drive.read(CSV).unwrap().is_some());
        beat(&a.agent);
        assert!(drive.read(IN_USE).unwrap().is_some(), "says it's in use, in Drive");

        // Computer B: Google connected, sync not set up yet. It finds A's copy in Drive.
        let b = setup();
        *b.agent.files.write().unwrap() = Some(drive.clone());
        let (place, info) = newer_elsewhere(&b.agent).expect("A's data in Google Drive is offered");
        assert_eq!((place.as_str(), info.jobs >= 1), (DRIVE, true));
        continue_from(&b.agent, &place).unwrap();
        assert_eq!(std::fs::read_to_string(b.agent.data.join("sync-folder.txt")).unwrap(), DRIVE, "and keeps syncing there");
        assert!(crate::backup::apply_pending(&b.agent.data).unwrap());
        let restored = crate::db::Db::open(&b.agent.data.join("jobhunt.db")).unwrap();
        assert!(restored.job("test:1").unwrap().is_some());

        // A exits: no longer in use.
        release(&a.agent);
        assert!(drive.read(IN_USE).unwrap().is_none());
    }

    #[test]
    fn cvs_and_tailored_files_travel_through_google_drive() {
        let drive = std::sync::Arc::new(FakeDrive::default());
        // Computer A keeps its files in a folder of its own (like Documents\\Job Hunt) and syncs to Drive.
        let a = setup();
        let a_docs = tempfile::tempdir().unwrap();
        a.agent.set_files_folder(&a_docs.path().join("Job Hunt").to_string_lossy()).unwrap();
        *a.agent.files.write().unwrap() = Some(drive.clone());
        a.agent.db().set("sync.where", "drive").unwrap();
        a.agent.db().set("sync.on", "1").unwrap();
        a.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let job = a.agent.tailor("test:1", None).unwrap();
        let track = a.agent.profile().tracks[0].name.clone();
        assert!(a.agent.cv_path(&track).starts_with(a_docs.path()) && a.agent.cv_path(&track).is_file());
        assert!(Path::new(job.cv_path.as_deref().unwrap()).starts_with(a_docs.path()));
        assert!(push(&a.agent, true).unwrap());

        // What went to Drive has the CV and the tailored CV, letter and PDFs.
        let bytes = drive.0.lock().unwrap().get(ZIP).cloned().unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&format!("cv/{track}.docx")), "{names:?}");
        assert!(names.iter().filter(|n| n.starts_with("applications/") && n.ends_with(".docx")).count() >= 2, "{names:?}");

        // Computer B keeps its files somewhere else, and continues from Drive.
        let b = setup();
        let b_docs = tempfile::tempdir().unwrap();
        let b_files = b_docs.path().join("My Job Hunt");
        std::fs::write(b.agent.data.join(crate::util::FILES_POINTER), b_files.to_string_lossy().as_bytes()).unwrap();
        *b.agent.files.write().unwrap() = Some(drive.clone());
        continue_from(&b.agent, DRIVE).unwrap();
        assert!(crate::backup::apply_pending(&b.agent.data).unwrap());
        assert!(b_files.join("cv").join(format!("{track}.docx")).is_file(), "the CV is in B's folder");
        // When Job Hunt starts on B, each application finds its files in B's folder.
        let db = crate::db::Db::open(&b.agent.data.join("jobhunt.db")).unwrap();
        let on_b = Agent::new(&b.agent.data, db, Box::new(|_, _| {}));
        assert_eq!(on_b.fix_file_paths(), 1);
        let moved = on_b.db().job("test:1").unwrap().unwrap();
        for p in [moved.cv_path.unwrap(), moved.letter_path.unwrap()] {
            assert!(Path::new(&p).starts_with(&b_files) && Path::new(&p).is_file(), "{p}");
        }
    }

    #[test]
    fn keeps_the_last_three_backups_in_drive() {
        let drive = std::sync::Arc::new(FakeDrive::default());
        let a = setup();
        *a.agent.files.write().unwrap() = Some(drive.clone());
        a.agent.db().set("sync.where", "drive").unwrap();
        a.agent.db().set("sync.on", "1").unwrap();
        drive.0.lock().unwrap().insert("Job Hunt backup Mon.zip".into(), b"old".to_vec());
        let zip = a.agent.data.join("b.zip");
        std::fs::write(&zip, b"zip").unwrap();
        for day in ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-27"] {
            assert!(backup_to_drive_on(&a.agent, &zip, day).unwrap());
        }
        let mut names: Vec<String> = drive.0.lock().unwrap().keys().cloned().collect();
        names.sort();
        assert_eq!(names, vec!["Job Hunt backup 2026-10-25.zip", "Job Hunt backup 2026-10-26.zip", "Job Hunt backup 2026-10-27.zip"]);
    }

    #[test]
    fn a_second_computer_is_warned_and_can_take_over() {
        let drive = tempfile::tempdir().unwrap();
        let dir = drive.path().join("Job Hunt");
        let on = |s: &crate::testkit::Setup| {
            s.agent.db().set("backup.dir", &dir.to_string_lossy()).unwrap();
            s.agent.db().set("sync.on", "1").unwrap();
        };
        let a = setup();
        on(&a);
        a.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        beat(&a.agent);
        assert!(presence_status(&a.agent).is_null(), "A is the one using it");

        // B opens Job Hunt while A is still open: it's told, and doesn't claim it.
        let b = setup();
        on(&b);
        beat(&b.agent);
        assert!(presence_status(&b.agent)["other"].is_string());
        assert!(take_over(&a.agent).is_err(), "A has nothing to take over");

        // B takes over: A saves its data and stops; B is offered A's data.
        take_over(&b.agent).unwrap();
        beat(&a.agent);
        assert!(handed_over(&a.agent).is_some());
        assert!(presence_status(&a.agent)["handed_to"].is_string());
        assert!(!due(&a.agent) && push(&a.agent, true).is_err(), "A no longer syncs");
        assert!(newer_elsewhere(&b.agent).is_some(), "B can continue from A's latest data");
        beat(&b.agent);
        assert!(presence_status(&b.agent).is_null());

        // B exits: the note is removed, so A (or anyone) isn't warned about it.
        release(&b.agent);
        assert!(!dir.join(IN_USE).exists());
    }

    #[test]
    fn a_server_that_handed_over_can_take_back_over() {
        let drive = tempfile::tempdir().unwrap();
        let dir = drive.path().join("Job Hunt");
        let (srv, pc) = (setup(), setup());
        for x in [&srv, &pc] {
            x.agent.db().set("backup.dir", &dir.to_string_lossy()).unwrap();
            x.agent.db().set("sync.on", "1").unwrap();
        }
        beat(&srv.agent);
        // The PC takes over; the server saves its data and stops.
        take_over(&pc.agent).unwrap();
        beat(&srv.agent);
        assert!(handed_over(&srv.agent).is_some());
        continue_from(&pc.agent, &dir.to_string_lossy()).unwrap(); // the PC picks up the server's data
        // Later, on the server: use it here again. The PC, still open, is asked to hand back.
        resume_here(&srv.agent).unwrap();
        assert!(handed_over(&srv.agent).is_none());
        beat(&pc.agent);
        assert!(handed_over(&pc.agent).is_some(), "the PC saved its data for the server and stopped");
        assert!(newer_elsewhere(&srv.agent).is_some(), "and the server is offered it");
        // With the PC closed instead, it just carries on.
        let (srv, pc) = (setup(), setup());
        let dir2 = drive.path().join("Two");
        for x in [&srv, &pc] {
            x.agent.db().set("backup.dir", &dir2.to_string_lossy()).unwrap();
            x.agent.db().set("sync.on", "1").unwrap();
        }
        beat(&srv.agent);
        take_over(&pc.agent).unwrap();
        beat(&srv.agent);
        release(&pc.agent);
        resume_here(&srv.agent).unwrap();
        assert!(handed_over(&srv.agent).is_none());
    }

    #[test]
    fn device_id_stays_put() {
        let d = tempfile::tempdir().unwrap();
        let (a, _) = device(d.path());
        assert_eq!(device(d.path()).0, a);
        assert!(crate::backup::LOCAL_ONLY.contains(&"device.json"));
    }
}
