//! Job Hunt as a server, for a Synology NAS (Container Manager) or any Docker host: the same app,
//! used from a web browser on your phone or computer, running all day without your PC.
//!
//! Settings come from environment variables (see server/docker-compose.yml):
//!   JOBHUNT_PASSWORD   the password to sign in with (required the first time; changeable in the app)
//!   JOBHUNT_DATA       where data is kept (default /data)
//!   JOBHUNT_STATIC     the app's screens (default /app/static)
//!   JOBHUNT_PORT       the port to serve on (default 8790)
//! and, for Claude: CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or an API key set in the app.

use jobhunt_core::api::Host;
use jobhunt_core::db::Db;
use jobhunt_core::pipeline::{run_due, run_in_background, Agent};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

struct ServerHost {
    static_dir: PathBuf,
}

impl Host for ServerHost {
    fn asset(&self, path: &str) -> Option<Vec<u8>> {
        if path.contains("..") {
            return None;
        }
        std::fs::read(self.static_dir.join(path)).ok()
    }
    // A browser always asks for files and links itself (requests are marked remote), so these
    // are only reached by mistake.
    fn open_url(&self, _url: &str) -> jobhunt_core::R<()> {
        Err(jobhunt_core::Error("Open it from your browser.".into()))
    }
    fn open_path(&self, _path: &std::path::Path) -> jobhunt_core::R<()> {
        Err(jobhunt_core::Error("Download it from your browser.".into()))
    }
    fn autostart(&self) -> bool {
        true
    }
    fn set_autostart(&self, _on: bool) -> jobhunt_core::R<()> {
        Err(jobhunt_core::Error("The server always runs; Container Manager starts it with the NAS.".into()))
    }
    fn version(&self) -> String {
        // The newest entry in the bundled changelog is this build's version.
        std::fs::read(self.static_dir.join("changelog.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v[0]["version"].as_str().map(String::from))
            .unwrap_or_else(|| "unknown".into())
    }
    fn update_check(&self) -> Value {
        // Updates come as a new container image; say whether one is out.
        let current = self.version();
        let latest = reqwest::blocking::get("https://github.com/hisXLNC/job-hunt-releases/releases/latest/download/latest.json")
            .ok()
            .and_then(|r| r.json::<Value>().ok());
        match latest {
            Some(l) => {
                let v = l["version"].as_str().unwrap_or("").to_string();
                let newer = version_key(&v) > version_key(&current);
                json!({ "available": false, "server": true, "newer": newer, "current": current, "version": v, "notes": l["notes"], "history": l["history"] })
            }
            None => json!({ "available": false, "server": true, "current": current, "error": "Couldn't reach the update feed." }),
        }
    }
    fn update_install(&self) -> jobhunt_core::R<bool> {
        Err(jobhunt_core::Error("On the server, update by pulling the new image in Container Manager (Project → Action → Build, or Image → Update).".into()))
    }
    fn kind(&self) -> &'static str {
        "server"
    }
    fn restart(&self) {
        // Container Manager's restart policy starts it again, which applies a staged restore.
        std::process::exit(0);
    }
}

fn version_key(v: &str) -> u64 {
    let p: Vec<u64> = v.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    p.first().copied().unwrap_or(0) * 1_000_000 + p.get(1).copied().unwrap_or(0) * 1_000 + p.get(2).copied().unwrap_or(0)
}

fn main() {
    let env = |k: &str, d: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| d.to_string());
    let data = PathBuf::from(env("JOBHUNT_DATA", "/data"));
    let static_dir = PathBuf::from(env("JOBHUNT_STATIC", "/app/static"));
    let port = env("JOBHUNT_PORT", "8790");
    std::fs::create_dir_all(&data).expect("can't create the data folder");

    match jobhunt_core::backup::apply_pending(&data) {
        Ok(true) => println!("Restored from a backup."),
        Ok(false) => {}
        Err(e) => eprintln!("A restore couldn't be applied: {e}"),
    }
    let db = Db::open(&data.join("jobhunt.db")).expect("can't open the database");
    let agent = Arc::new(Agent::new(&data, db, Box::new(|title, body| println!("[note] {title}: {body}"))));
    agent.fix_file_paths();
    jobhunt_core::sync::apply_after_restore(&agent);
    // Backups go to the /backups folder mapped to a NAS share, unless set otherwise.
    if agent.secret("backup.dir").is_empty() && std::path::Path::new("/backups").is_dir() {
        let _ = agent.db().set("backup.dir", "/backups");
    }
    if let Ok(pw) = std::env::var("JOBHUNT_PASSWORD") {
        if !pw.is_empty() && !jobhunt_core::web::has_password(&agent) {
            if let Err(e) = jobhunt_core::web::set_password(&agent, &pw) {
                eprintln!("JOBHUNT_PASSWORD: {e}");
                std::process::exit(1);
            }
        }
    }
    if !jobhunt_core::web::has_password(&agent) {
        eprintln!("Set JOBHUNT_PASSWORD (at least 8 characters) the first time you start the server.");
        std::process::exit(1);
    }

    // Once a minute: the daily search, email checks and the daily backup.
    let a = agent.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        loop {
            run_due(&a, &|t| run_in_background(&a, t));
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });

    let host: Arc<dyn Host> = Arc::new(ServerHost { static_dir });
    let _ = agent.db().set("app.version", &host.version());
    let addr = format!("0.0.0.0:{port}");
    println!("Job Hunt {} is serving on {addr}", host.version());
    if let Err(e) = jobhunt_core::web::serve(agent, host, &addr, Arc::new(|| true)) {
        eprintln!("Couldn't serve on {addr}: {e}");
        std::process::exit(1);
    }
}
