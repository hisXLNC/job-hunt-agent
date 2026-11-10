//! Job Hunt as its own Windows app: its own window and tray icon, no web server and no browser.
//! The screens (HTML, CSS and JavaScript in /static) talk to the app through the private jobhunt://
//! address, which only this window can reach. All the work is in the jobhunt-core library.

use jobhunt_core::api::{self, Host};
use jobhunt_core::db::Db;
use jobhunt_core::pipeline::{run_in_background, Agent};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{http, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

static TOLD_ABOUT_TRAY: AtomicBool = AtomicBool::new(false);
static QUITTING: AtomicBool = AtomicBool::new(false);
/// The tray menu's update item: "Check for updates", or "Install Job Hunt X and restart".
static UPDATE_ITEM: std::sync::OnceLock<MenuItem<tauri::Wry>> = std::sync::OnceLock::new();

pub struct Ctx {
    pub agent: Arc<Agent>,
    pub host: Arc<dyn Host>,
}

/// What the app core asks of the window side.
struct TauriHost {
    app: AppHandle,
}

impl Host for TauriHost {
    fn mcp_command(&self) -> Option<(String, Vec<String>)> {
        let exe = std::env::current_exe().ok()?;
        Some((exe.to_string_lossy().to_string(), vec!["--mcp".into()]))
    }
    fn asset(&self, path: &str) -> Option<Vec<u8>> {
        #[cfg(debug_assertions)]
        {
            // Development builds read the screens straight from the folder, so edits show without rebuilding.
            let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../static").join(path);
            if p.is_file() {
                return std::fs::read(p).ok();
            }
        }
        self.app.asset_resolver().get(path.to_string()).map(|a| a.bytes.to_vec())
    }

    fn open_url(&self, url: &str) -> jobhunt_core::R<()> {
        use tauri_plugin_opener::OpenerExt;
        // The browser you chose in Settings → App (Edge or Chrome), where your sign-ins, password
        // manager and the Job Hunt extension are; else Windows' default browser.
        let browser = self.app.try_state::<Arc<Ctx>>().map(|c| c.agent.secret("app.browser")).unwrap_or_default();
        if url.starts_with("http") && open_in(&browser, url) {
            return Ok(());
        }
        self.app.opener().open_url(url, None::<&str>).map_err(|e| jobhunt_core::Error(format!("Couldn't open the link: {e}")))
    }

    fn open_path(&self, path: &std::path::Path) -> jobhunt_core::R<()> {
        use tauri_plugin_opener::OpenerExt;
        self.app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| jobhunt_core::Error(format!("Couldn't open it: {e}")))
    }

    fn can_fill(&self) -> bool {
        true
    }

    fn fill_application(&self, job_id: &str, url: &str) -> jobhunt_core::R<()> {
        let parsed: tauri::Url = url.parse().map_err(|_| jobhunt_core::Error("That posting's link isn't a web address.".into()))?;
        if !["http", "https"].contains(&parsed.scheme()) {
            return Err(jobhunt_core::Error("That posting's link isn't a web address.".into()));
        }
        open_application(self.app.clone(), job_id.to_string());
        Ok(())
    }

    fn can_console(&self) -> bool {
        cfg!(windows)
    }

    fn open_console(&self, script: &str) -> jobhunt_core::R<()> {
        // -EncodedCommand takes the script as base64 of UTF-16LE, so nothing in it needs quoting.
        let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let encoded = jobhunt_core::util::base64_encode(&utf16);
        let mut c = std::process::Command::new("powershell.exe");
        c.args(["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0000_0010); // CREATE_NEW_CONSOLE: a window of its own
        }
        c.spawn().map(|_| ()).map_err(|e| jobhunt_core::Error(format!("Couldn't open PowerShell ({e}).")))
    }

    fn pick_folder(&self, start: &str) -> jobhunt_core::R<Option<String>> {
        pick_folder(start)
    }

    fn autostart(&self) -> bool {
        self.app.autolaunch().is_enabled().unwrap_or(false)
    }

    fn restart(&self) {
        QUITTING.store(true, Ordering::SeqCst);
        self.app.restart();
    }

    fn set_autostart(&self, on: bool) -> jobhunt_core::R<()> {
        let r = if on { self.app.autolaunch().enable() } else { self.app.autolaunch().disable() };
        r.map_err(|e| jobhunt_core::Error(format!("Windows didn't accept the change: {e}")))
    }

    fn version(&self) -> String {
        self.app.package_info().version.to_string()
    }

    fn update_check(&self) -> serde_json::Value {
        check_for_update(&self.app)
    }

    fn update_install(&self) -> jobhunt_core::R<bool> {
        let app = self.app.clone();
        let res = tauri::async_runtime::block_on(async move {
            let updater = app.updater().map_err(|e| e.to_string())?;
            match updater.check().await.map_err(|e| e.to_string())? {
                Some(u) => u.download_and_install(|_, _| {}, || {}).await.map(|_| true).map_err(|e| e.to_string()),
                None => Ok(false),
            }
        });
        match res {
            Ok(true) => {
                let app = self.app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    QUITTING.store(true, Ordering::SeqCst);
                    let _ = app.save_window_state(StateFlags::all());
                    app.restart();
                });
                Ok(true)
            }
            Ok(false) => Ok(false),
            Err(e) => Err(jobhunt_core::Error(friendly_update_error(&e))),
        }
    }
}

fn friendly_update_error(e: &str) -> String {
    if e.contains("pubkey") || e.contains("signature") {
        "The update isn't signed with Job Hunt's key, so it wasn't installed.".into()
    } else if e.contains("404") || e.contains("Could not fetch") || e.contains("release JSON") {
        "No published updates were found.".into()
    } else {
        "Couldn't check for updates (are you online?).".into()
    }
}

/// {available, current, version, notes, history, date} or {available: false, error}.
fn check_for_update(app: &AppHandle) -> serde_json::Value {
    let a = app.clone();
    let found = tauri::async_runtime::block_on(async move {
        let updater = a.updater().map_err(|e| e.to_string())?;
        updater.check().await.map_err(|e| e.to_string())
    });
    let current = app.package_info().version.to_string();
    match found {
        Ok(Some(u)) => serde_json::json!({
            "available": true, "current": current, "version": u.version, "notes": u.body,
            "history": u.raw_json.get("history").cloned().unwrap_or(serde_json::Value::Null),
            "date": u.date.map(|d| d.to_string()),
        }),
        Ok(None) => serde_json::json!({ "available": false, "current": current }),
        Err(e) => serde_json::json!({ "available": false, "current": current, "error": friendly_update_error(&e) }),
    }
}

/// Check for a new version soon after starting and every 30 minutes. When one is out: the window
/// shows its notice straight away (its own timer is paused while it's in the tray), the tray icon
/// and menu say so, and a notification comes when it's first found and again once a day until it's
/// installed (one notification is easy to miss: Do Not Disturb, or the PC was away).
fn update_watch(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        // Updated by itself while you were away: say so, once.
        if let Some(ctx) = app.try_state::<Arc<Ctx>>() {
            let done = ctx.agent.secret("update.auto_installed");
            let now_v = app.package_info().version.to_string();
            if !done.is_empty() && done == now_v {
                let _ = ctx.agent.db().set("update.auto_installed", "");
                notify(&app, &format!("Job Hunt updated to {now_v}"), "It installed by itself while you weren't using it. See what's new in Settings \u{2192} App.");
            }
        }
        loop {
            let u = check_for_update(&app);
            let auto = app.try_state::<Arc<Ctx>>().is_some_and(|c| c.agent.secret("update.auto") == "1");
            if u.get("available").and_then(|v| v.as_bool()) == Some(true) {
                let v = u.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
                update_found(&app, &v);
                // Installing by itself: once nothing's running and you're not using Job Hunt's windows.
                if auto && quiet_for_update(&app) {
                    if let Some(ctx) = app.try_state::<Arc<Ctx>>() {
                        let _ = ctx.agent.db().set("update.auto_installed", &v);
                        let req = api::Req { method: "POST".into(), path: "/api/update/install".into(), query: Default::default(), body: vec![], remote: false };
                        let r = api::handle(&ctx.agent, &ctx.host, &req);
                        if r.status >= 400 {
                            let _ = ctx.agent.db().set("update.auto_installed", "");
                            let _ = ctx.agent.db().log(None, "update:error", &String::from_utf8_lossy(&r.body));
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(5 * 60));
                    continue;
                }
                if let Some(ctx) = app.try_state::<Arc<Ctx>>().filter(|_| !auto) {
                    let now = chrono::Utc::now().timestamp();
                    let at: i64 = ctx.agent.secret("update.notified_at").parse().unwrap_or(0);
                    if ctx.agent.secret("update.notified") != v || now - at >= 24 * 3600 {
                        let _ = ctx.agent.db().set("update.notified", &v);
                        let _ = ctx.agent.db().set("update.notified_at", &now.to_string());
                        notify(&app, &format!("Job Hunt {v} is ready to install"),
                            "Click Install and restart in Job Hunt, or right-click the tray icon. Your applications and settings stay as they are.");
                    }
                }
            }
            // Waiting to install by itself: look again in a few minutes, not half an hour.
            let wait = if auto && u.get("available").and_then(|v| v.as_bool()) == Some(true) { 3 * 60 } else { 30 * 60 };
            std::thread::sleep(std::time::Duration::from_secs(wait));
        }
    });
}

/// Whether an update can install by itself now: nothing running that it would interrupt (a search,
/// tailoring, an email check, anything), no application form open, and you're not using Job Hunt's window.
fn quiet_for_update(app: &AppHandle) -> bool {
    let Some(ctx) = app.try_state::<Arc<Ctx>>() else { return false };
    // Nothing at all running: unlike installing on request, nobody's waiting, so it can wait for a lull.
    if !ctx.agent.running().is_empty() || app.get_webview_window("apply").is_some() {
        return false;
    }
    match app.get_webview_window("main") {
        Some(w) => !(w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)),
        None => true,
    }
}

/// Tell the window and the tray that version `v` is out.
fn update_found(app: &AppHandle, v: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("typeof checkUpdate === 'function' && checkUpdate()");
    }
    if let Some(t) = app.tray_by_id("jobhunt") {
        let _ = t.set_tooltip(Some(format!("Job Hunt: version {v} is ready to install")));
    }
    if let Some(item) = UPDATE_ITEM.get() {
        let _ = item.set_text(format!("Install Job Hunt {v} and restart"));
    }
}

/// The tray's update item: install the update that's out (after any search or tailoring running
/// now), or check and say there's none.
fn tray_update(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let u = check_for_update(&app);
        if u.get("available").and_then(|v| v.as_bool()) != Some(true) {
            let msg = u.get("error").and_then(|e| e.as_str()).map(String::from)
                .unwrap_or_else(|| format!("You're on the newest version ({}).", app.package_info().version));
            notify(&app, "Job Hunt is up to date", &msg);
            return;
        }
        let Some(ctx) = app.try_state::<Arc<Ctx>>() else { return };
        let req = api::Req { method: "POST".into(), path: "/api/update/install".into(), query: Default::default(), body: vec![], remote: false };
        let r = api::handle(&ctx.agent, &ctx.host, &req);
        let body: serde_json::Value = serde_json::from_slice(&r.body).unwrap_or_default();
        if body.get("waiting").and_then(|w| w.as_bool()) == Some(true) {
            notify(&app, "Installing after the current work", "Job Hunt installs the update and restarts as soon as the search or tailoring running now finishes.");
        } else if r.status >= 400 {
            notify(&app, "The update didn't install", body.get("error").and_then(|e| e.as_str()).unwrap_or("Try again from Settings → App."));
        }
    });
}

/// %LOCALAPPDATA%\Job Hunt\data, apart from the program so updating or uninstalling never touches it.
pub fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("JOBHUNT_DATA") {
        return PathBuf::from(d);
    }
    let base = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    base.join("Job Hunt").join("data")
}

/// `JobHunt.exe --mcp`: Job Hunt as a tool in Claude Desktop, talking over stdin/stdout. No window.
fn serve_mcp() {
    let data = data_dir();
    let _ = std::fs::create_dir_all(&data);
    let Ok(db) = Db::open(&data.join("jobhunt.db")) else { return };
    let agent = Arc::new(Agent::new(&data, db, Box::new(|_, _| {})));
    jobhunt_core::mcp::serve_stdio(agent);
}

/// The Send to Job Hunt button in your browser puts the posting on the clipboard; pick it up and
/// add it. Only text starting with Job Hunt's own marker is ever used.
fn clip_watch(agent: Arc<Agent>) {
    std::thread::spawn(move || {
        let mut clipboard: Option<arboard::Clipboard> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if agent.secret("clip.watch") == "0" || jobhunt_core::sync::handed_over(&agent).is_some() {
                continue;
            }
            if clipboard.is_none() {
                clipboard = arboard::Clipboard::new().ok();
            }
            let Some(cb) = clipboard.as_mut() else { continue };
            let Ok(text) = cb.get_text() else { continue };
            let Some(clip) = api::parse_clip(&text) else { continue };
            // Leave the posting's link on the clipboard instead, so it isn't picked up twice.
            let _ = cb.set_text(clip["url"].as_str().unwrap_or("").to_string());
            api::start_clip(&agent, clip);
        }
    });
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // Back from the tray: anything new (an update, say) shows now, not at the page's next timer.
        let _ = w.eval("typeof onShown === 'function' && onShown()");
    }
}

fn quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    // Leave the latest copy in the sync folder, so another computer continues from here.
    if let Some(ctx) = app.try_state::<Arc<Ctx>>() {
        let _ = jobhunt_core::sync::push(&ctx.agent, false);
        // And say this computer is no longer using Job Hunt.
        jobhunt_core::sync::release(&ctx.agent);
    }
    let _ = app.save_window_state(StateFlags::all());
    app.exit(0);
}

/// Run a search or an inbox check in the background (errors are logged and shown as notifications).
fn run_task(app: &AppHandle, task: &str) -> bool {
    match app.try_state::<Arc<Ctx>>() {
        Some(ctx) => run_in_background(&ctx.agent, task),
        None => false,
    }
}

/// Keeps Windows from sleeping while Job Hunt is working (searching, tailoring, checking email,
/// backing up), unless you turned that off in Settings → App. It holds on for a few minutes after
/// the work stops, so the gap between one step and the next (a search, then tailoring) isn't a
/// chance to sleep: after a wake-up Windows sleeps again after only two idle minutes. And if
/// Windows sleeps during work all the same, that's kept for Settings → App to show.
fn keep_awake(app: AppHandle) {
    std::thread::spawn(move || {
        const GRACE: u64 = 3 * 60;
        let mut awake = false;
        let mut last_busy = std::time::SystemTime::UNIX_EPOCH;
        let mut last_tick = std::time::SystemTime::now();
        let mut was_running: Vec<String> = vec![];
        loop {
            let now = std::time::SystemTime::now();
            let gap = now.duration_since(last_tick).map(|d| d.as_secs()).unwrap_or(0);
            let ctx = app.try_state::<Arc<Ctx>>();
            // Asleep in the middle of work: the loop runs every 15 seconds, so a long gap while work
            // was running means Windows slept anyway.
            if gap > 120 && !was_running.is_empty() {
                if let Some(c) = &ctx {
                    let v = serde_json::json!({ "at": jobhunt_core::util::now(), "minutes": gap / 60, "during": was_running });
                    let _ = c.agent.db().set("awake.slept", &v.to_string());
                    let _ = c.agent.db().log(None, "awake", &format!("Windows slept for {} minutes while {} was running", gap / 60, was_running.join(", ")));
                }
            }
            last_tick = now;
            let (running, wanted) = ctx.as_ref().map(|ctx| {
                // A search you paused can wait with the PC asleep.
                let held = ctx.agent.search_held();
                let r: Vec<String> = ctx.agent.running().into_iter().filter(|n| !(held && n == "search")).collect();
                (r, ctx.agent.secret("app.keep_awake") != "0")
            }).unwrap_or_default();
            if !running.is_empty() {
                last_busy = now;
            }
            let recent = now.duration_since(last_busy).map(|d| d.as_secs() < GRACE).unwrap_or(false);
            let busy = wanted && (!running.is_empty() || recent);
            was_running = if wanted { running } else { vec![] };
            if busy != awake {
                set_awake(busy);
                awake = busy;
            }
            std::thread::sleep(std::time::Duration::from_secs(15));
        }
    });
}

/// Hold the PC awake, or let it go. Two ways at once: the classic per-thread request, and Windows'
/// power requests, which newer laptops ("Modern Standby", which pauses desktop apps once the
/// screen is off) honour: "system required" keeps it from sleeping, "execution required" keeps
/// Job Hunt running with the screen off.
#[cfg(windows)]
fn set_awake(on: bool) {
    use std::ffi::c_void;
    use std::sync::OnceLock;
    #[repr(C)]
    struct ReasonContext {
        version: u32,
        flags: u32,
        reason: *const u16,
        _rest: [usize; 2], // the union's larger (detailed) form
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
        fn PowerCreateRequest(context: *const ReasonContext) -> *mut c_void;
        fn PowerSetRequest(request: *mut c_void, kind: i32) -> i32;
        fn PowerClearRequest(request: *mut c_void, kind: i32) -> i32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const SYSTEM_REQUIRED: i32 = 1;
    const EXECUTION_REQUIRED: i32 = 3;
    struct Handle(*mut c_void);
    // SAFETY: a kernel handle, used only through these calls.
    unsafe impl Send for Handle {}
    unsafe impl Sync for Handle {}
    static REQUEST: OnceLock<Handle> = OnceLock::new();
    static REASON: OnceLock<Vec<u16>> = OnceLock::new();
    let reason = REASON.get_or_init(|| "Job Hunt is searching for jobs or tailoring applications".encode_utf16().chain([0]).collect());
    // SAFETY: plain Win32 calls; the reason string lives for the program's life (a static), and the
    // request handle is created once and kept.
    unsafe {
        SetThreadExecutionState(if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS });
        let h = REQUEST.get_or_init(|| {
            let ctx = ReasonContext { version: 0, flags: 0x1, reason: reason.as_ptr(), _rest: [0; 2] };
            Handle(PowerCreateRequest(&ctx))
        });
        let invalid = h.0.is_null() || h.0 as isize == -1;
        if !invalid {
            for kind in [SYSTEM_REQUIRED, EXECUTION_REQUIRED] {
                if on {
                    PowerSetRequest(h.0, kind);
                } else {
                    PowerClearRequest(h.0, kind);
                }
            }
        }
    }
}

#[cfg(not(windows))]
fn set_awake(_on: bool) {}

/// Wakes the PC from sleep for Job Hunt's next task (the daily search, say), when that's turned
/// on in Settings → App. A Windows wake timer, set again whenever the next time changes. Works
/// while Job Hunt is open or in the tray, and only where Windows allows wake timers.
#[cfg(windows)]
fn wake_timer(app: AppHandle) {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateWaitableTimerW(attrs: *const c_void, manual_reset: i32, name: *const u16) -> *mut c_void;
        fn SetWaitableTimer(timer: *mut c_void, due: *const i64, period: i32, routine: *const c_void, arg: *const c_void, resume: i32) -> i32;
        fn CancelWaitableTimer(timer: *mut c_void) -> i32;
        fn WaitForSingleObject(handle: *mut c_void, ms: u32) -> u32;
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    std::thread::spawn(move || {
        // SAFETY: a plain Win32 call; the handle lives as long as this thread.
        let timer = unsafe { CreateWaitableTimerW(std::ptr::null(), 0, std::ptr::null()) };
        if timer.is_null() {
            return;
        }
        let mut armed: Option<i64> = None;
        loop {
            let Some(ctx) = app.try_state::<Arc<Ctx>>() else {
                std::thread::sleep(std::time::Duration::from_secs(30));
                continue;
            };
            let agent = ctx.agent.clone();
            let next = agent.next_wake().map(|t| t.timestamp());
            if next != armed {
                // SAFETY: the timer handle is valid; `due` outlives the call.
                unsafe {
                    match next {
                        // Absolute time, in 100-nanosecond steps since 1601.
                        Some(t) => {
                            let due: i64 = (t + 11_644_473_600) * 10_000_000;
                            SetWaitableTimer(timer, &due, 0, std::ptr::null(), std::ptr::null(), 1);
                        }
                        None => {
                            CancelWaitableTimer(timer);
                        }
                    }
                }
                armed = next;
            }
            // SAFETY: waits on our own timer handle, a minute at most.
            if unsafe { WaitForSingleObject(timer, 60_000) } != 0 {
                continue;
            }
            armed = None;
            // Woken (or simply reached the time): stay up, give the network a moment, start what's due,
            // and hold on until it's running; the usual keep-awake takes over from there.
            // SAFETY: changes only this thread's power request.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            let _ = agent.db().set("last.wake", &jobhunt_core::util::now());
            std::thread::sleep(std::time::Duration::from_secs(30));
            jobhunt_core::pipeline::run_due(&agent, &|t| run_task(&app, t));
            for _ in 0..12 {
                std::thread::sleep(std::time::Duration::from_secs(15));
                if !agent.running().is_empty() {
                    break;
                }
            }
            // SAFETY: as above.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }
    });
}

#[cfg(not(windows))]
fn wake_timer(_app: AppHandle) {}

/// The Apply window: the company's application page, with Job Hunt's filling-in script in it.
/// The page gets none of the app's permissions (only the main window has those); the script
/// reaches the app by asking to open a jobhunt.invalid address, which is caught and cancelled here.
fn apply_window(app: &AppHandle, job_id: &str, url: tauri::Url) -> Result<(), String> {
    use jobhunt_core::fill;
    let ctx = app.try_state::<Arc<Ctx>>().ok_or("Job Hunt is still starting.")?;
    let job = ctx.agent.db().job(job_id).map_err(|e| e.0)?.ok_or("That job no longer exists.")?;
    // One application at a time: a new one replaces the window.
    if let Some(w) = app.get_webview_window("apply") {
        APP_CLOSED_APPLY.store(true, Ordering::SeqCst);
        let _ = w.destroy();
    }
    let token = fill::new_token();
    let (tok, id, handle) = (token.clone(), job_id.to_string(), app.clone());
    // Once Job Hunt has filled in a form here, each page that loads afterwards is asked whether it's
    // the site's confirmation, so the application is marked applied by itself (even on another site).
    let filled = Arc::new(AtomicBool::new(false));
    let (filled_msg, filled_load) = (filled.clone(), filled.clone());
    let win = WebviewWindowBuilder::new(app, "apply", WebviewUrl::External(url))
        .title(format!("Apply: {} at {} \u{2013} Job Hunt", job.title, job.company))
        .inner_size(1200.0, 900.0)
        .center()
        .initialization_script(fill::script_with(&token, &fill::panel_job(&ctx.agent, &job)))
        .on_navigation(move |u| {
            if u.host_str() != Some(fill::MESSAGE_HOST) {
                return true;
            }
            if let Some((kind, data)) = fill::message(u, &tok) {
                if kind == "fields" {
                    filled_msg.store(true, Ordering::SeqCst);
                }
                on_fill_message(handle.clone(), id.clone(), kind, data);
            }
            false
        })
        // An Apply button that opens a new tab: open it here instead, where the filling-in script
        // runs (a new window of its own wouldn't have it, and nothing would be filled in).
        .on_new_window({
            let handle = app.clone();
            move |u, _| {
                if ["http", "https"].contains(&u.scheme()) {
                    let h = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Some(w) = h.get_webview_window("apply") {
                            let _ = w.navigate(u);
                        }
                    });
                }
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .on_page_load(move |w, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) && filled_load.load(Ordering::SeqCst) {
                let _ = w.eval("window.__jobhuntAfterFill && window.__jobhuntAfterFill()");
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    // Closed by you, after the form was filled: did it go through?
    let (handle, id, filled_close) = (app.clone(), job_id.to_string(), filled.clone());
    win.on_window_event(move |e| {
        if matches!(e, WindowEvent::Destroyed) && !APP_CLOSED_APPLY.swap(false, Ordering::SeqCst) && filled_close.load(Ordering::SeqCst) {
            ask_if_submitted(&handle, &id);
        }
    });
    Ok(())
}

/// Read a job site's page in a real browser (see `jobhunt_core::sites::set_browser`): a window kept
/// off screen, at most two at once. It waits out bot checks ("Just a moment…") and the scripts that
/// fill the list in, then hands back the page.
fn read_in_browser(app: &AppHandle, url: &str) -> Result<String, String> {
    use std::sync::atomic::AtomicUsize;
    use std::sync::{mpsc, Condvar, Mutex};
    use std::time::{Duration, Instant};
    static SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Slot;
    impl Drop for Slot {
        fn drop(&mut self) {
            *SLOTS.0.lock().unwrap() -= 1;
            SLOTS.1.notify_one();
        }
    }
    struct Close(AppHandle, String);
    impl Drop for Close {
        fn drop(&mut self) {
            let (app, label) = (self.0.clone(), self.1.clone());
            let _ = self.0.run_on_main_thread(move || {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.destroy();
                }
            });
        }
    }

    let page: tauri::Url = url.parse().map_err(|_| "not a web address".to_string())?;
    {
        let mut busy = SLOTS.0.lock().unwrap();
        while *busy >= 2 {
            busy = SLOTS.1.wait(busy).unwrap();
        }
        *busy += 1;
    }
    let _slot = Slot;
    let label = format!("reader{}", NEXT.fetch_add(1, Ordering::SeqCst));
    let (tx, rx) = mpsc::channel();
    let (a, l) = (app.clone(), label.clone());
    app.run_on_main_thread(move || {
        // Never seen and never in your way: made hidden, placed past the right edge of every
        // screen, unable to take focus, behind every window, and letting the mouse pass through.
        // Only then shown, since some sites only finish loading in a window that's showing.
        let right = a.available_monitors().unwrap_or_default().iter()
            .map(|m| m.position().x as f64 + m.size().width as f64)
            .fold(0.0, f64::max);
        let made = WebviewWindowBuilder::new(&a, &l, WebviewUrl::External(page))
            .title("Job Hunt \u{2013} reading a job site")
            .inner_size(1280.0, 900.0)
            .position(right + 400.0, 0.0)
            .visible(false)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .always_on_bottom(true)
            .build();
        let made = made.and_then(|w| {
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.set_position(tauri::PhysicalPosition::new((right + 400.0) as i32, 0));
            w.show().map(|_| ())
        });
        let _ = tx.send(made.map_err(|e| e.to_string()));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "the browser didn't start".to_string())??;
    let _close = Close(app.clone(), label.clone());

    // Run `js` in the page; its answer comes back as JSON.
    let ask = |js: &str, wait: Duration| -> Option<serde_json::Value> {
        let w = app.get_webview_window(&label)?;
        let (tx, rx) = mpsc::channel();
        w.eval_with_callback(js, move |out| {
            let _ = tx.send(out);
        })
        .ok()?;
        rx.recv_timeout(wait).ok().and_then(|out| serde_json::from_str(&out).ok())
    };
    // Settled: loaded, past any bot check, and nothing new on the page for two seconds.
    let start = Instant::now();
    let (mut last, mut steady, mut checking) = ((0, 0), 0, false);
    while start.elapsed() < Duration::from_secs(45) {
        std::thread::sleep(Duration::from_secs(1));
        let Some(v) = ask("({ s: document.readyState, t: document.title, a: document.links.length, h: document.body ? document.body.innerText.length : 0 })", Duration::from_secs(5)) else { continue };
        let title = v["t"].as_str().unwrap_or("").to_lowercase();
        let now = (v["a"].as_u64().unwrap_or(0), v["h"].as_u64().unwrap_or(0));
        checking = title.contains("just a moment") || title.contains("attention required") || title.contains("security check");
        if v["s"] != "complete" || checking || now.1 < 200 {
            steady = 0;
            continue;
        }
        steady = if now == last { steady + 1 } else { 0 };
        last = now;
        if steady >= 2 && start.elapsed() > Duration::from_secs(3) {
            break;
        }
    }
    if checking {
        return Err("the site's bot check didn't let Job Hunt through".into());
    }
    ask("document.documentElement.outerHTML", Duration::from_secs(15))
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| "the page didn't load".to_string())
}

/// A message from the Apply window's script: the form's fields to answer, or "I submitted it".
/// Open a web address in Microsoft Edge or Google Chrome ("edge" / "chrome"): the browser itself,
/// started with the address (no shell in between, so nothing in the address is read as a command).
/// False when that browser isn't installed, or for any other choice.
fn open_in(browser: &str, url: &str) -> bool {
    let env = |k: &str| std::env::var(k).map(PathBuf::from).ok();
    let candidates: Vec<PathBuf> = match browser {
        "edge" => [env("ProgramFiles(x86)"), env("ProgramFiles"), env("LOCALAPPDATA")].into_iter().flatten()
            .map(|d| d.join("Microsoft").join("Edge").join("Application").join("msedge.exe")).collect(),
        "chrome" => [env("ProgramFiles"), env("ProgramFiles(x86)"), env("LOCALAPPDATA")].into_iter().flatten()
            .map(|d| d.join("Google").join("Chrome").join("Application").join("chrome.exe")).collect(),
        _ => return false,
    };
    candidates.into_iter().find(|p| p.is_file()).is_some_and(|exe| std::process::Command::new(exe).arg(url).spawn().is_ok())
}

/// Open a job's form in the Apply window. The company's own site is preferred: a posting still only
/// on a job board is looked for there first (unless that was tried in the last week).
fn open_application(app: AppHandle, job_id: String) {
    std::thread::spawn(move || {
        let Some(ctx) = app.try_state::<Arc<Ctx>>() else { return };
        let agent = ctx.agent.clone();
        let Ok(Some(job)) = agent.db().job(&job_id) else { return };
        let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
        let tried = agent.secret(&format!("applylink.tried:{job_id}"));
        if job.apply_url.as_deref().is_none_or(|u| u.is_empty()) && job.apply_email.is_none() && jobhunt_core::sources::is_job_board(&job.url)
            && tried < week_ago && agent.engine_name() == "code" && agent.claude_ready()
        {
            notify(&app, &format!("Finding {}'s own posting", job.company), "Applying on the company's site goes straight to them. The form opens in a minute.");
            let _ = agent.db().set(&format!("applylink.tried:{job_id}"), &jobhunt_core::util::now());
            if let Err(e) = agent.find_company_apply(&job_id) {
                let _ = agent.db().log(Some(&job_id), "apply-link:error", &e.0);
            }
        }
        let Ok(Some(job)) = agent.db().job(&job_id) else { return };
        let Ok(url) = jobhunt_core::fill::form_link(&job).parse::<tauri::Url>() else {
            notify(&app, "Couldn't open the application form", "That posting's link isn't a web address.");
            return;
        };
        let (a, id) = (app.clone(), job_id.clone());
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = apply_window(&a, &id, url) {
                notify(&a, "Couldn't open the application form", &e);
            }
        });
    });
}

/// Set when Job Hunt itself closes the Apply window (the next application opens, or this one is
/// done), so closing it isn't taken as you closing it.
static APP_CLOSED_APPLY: AtomicBool = AtomicBool::new(false);

fn close_apply_window(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window("apply") {
            APP_CLOSED_APPLY.store(true, Ordering::SeqCst);
            let _ = w.destroy();
        }
    });
}

/// You closed the Apply window yourself after Job Hunt filled the form, and it's not marked
/// applied: ask in Job Hunt whether it went through (the site's confirmation may not have been
/// one Job Hunt recognises).
fn ask_if_submitted(app: &AppHandle, job_id: &str) {
    let Some(ctx) = app.try_state::<Arc<Ctx>>() else { return };
    let Ok(Some(job)) = ctx.agent.db().job(job_id) else { return };
    if job.status != "approved" && job.status != "ready" {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!("window.askApplied && window.askApplied({})", serde_json::json!({ "id": job.id, "title": job.title, "company": job.company })));
        if !w.is_visible().unwrap_or(false) {
            notify(app, &format!("Did your application to {} go through?", job.company), "Open Job Hunt to mark it applied.");
        }
    }
}

/// Done with a job in the Apply window (sent, or skipped): the next one in the queue, or the end.
fn next_in_queue(app: &AppHandle, agent: &Arc<Agent>, job_id: &str) {
    let had_queue = !jobhunt_core::fill::queue(agent).is_empty();
    match jobhunt_core::fill::queue_next(agent, job_id) {
        Some(next) => open_application(app.clone(), next),
        None if had_queue => {
            let _ = jobhunt_core::fill::set_queue(agent, &[]);
            notify(app, "That's the last one", "Every application in the queue has been through the Apply window.");
        }
        None => {}
    }
}

fn on_fill_message(app: AppHandle, job_id: String, kind: String, data: serde_json::Value) {
    std::thread::spawn(move || {
        let Some(ctx) = app.try_state::<Arc<Ctx>>() else { return };
        let agent = ctx.agent.clone();
        let reply = match kind.as_str() {
            "fields" => {
                let fields = data["fields"].as_array().cloned().unwrap_or_default();
                match jobhunt_core::fill::answers(&agent, &job_id, &fields) {
                    Ok(a) => format!("window.__jobhunt && window.__jobhunt.fill({a})"),
                    Err(e) => format!("window.__jobhunt && window.__jobhunt.failed({})", serde_json::json!(format!("Couldn't fill it in: {}", e.0))),
                }
            }
            "applied" => {
                let fields = data["fields"].as_array().cloned().unwrap_or_default();
                if let Err(e) = jobhunt_core::fill::submitted_with(&agent, &job_id, data["url"].as_str().unwrap_or(""), data["auto"].as_bool().unwrap_or(false), &fields) {
                    let _ = agent.db().log(Some(&job_id), "fill:error", &e.0);
                }
                // Applying from a queue: the next one, after a moment to see the confirmation. Else the
                // window closes by itself.
                std::thread::sleep(std::time::Duration::from_secs(4));
                if !jobhunt_core::fill::queue(&agent).is_empty() {
                    next_in_queue(&app, &agent, &job_id);
                } else {
                    close_apply_window(&app);
                }
                return;
            }
            // The answers you gave, as you pressed Submit: kept for the next form.
            "learn" => {
                let _ = jobhunt_core::fill::learn(&agent, &data["fields"].as_array().cloned().unwrap_or_default());
                return;
            }
            // Pay stated on a page in the window: kept when the job had none (flagged if below your minimum).
            "salary" => {
                let _ = agent.found_salary(&job_id, data["text"].as_str().unwrap_or(""), "on the company's page");
                return;
            }
            // Not for you after all: set aside, and on with the queue.
            "dismiss" => {
                let _ = agent.db().set_status(&job_id, "dismissed", "not interested (from the Apply window)");
                agent.after_stage(&job_id, "dismissed", "", true);
                if jobhunt_core::fill::queue(&agent).is_empty() {
                    close_apply_window(&app);
                } else {
                    next_in_queue(&app, &agent, &job_id);
                }
                return;
            }
            // Leave this one for later and go on with the queue.
            "skip" => {
                next_in_queue(&app, &agent, &job_id);
                return;
            }
            _ => return,
        };
        if let Some(w) = app.get_webview_window("apply") {
            let _ = w.eval(reply);
        }
    });
}

/// Once a minute: whatever is due (the daily search, email checks, the daily backup).
fn scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        loop {
            if let Some(ctx) = app.try_state::<Arc<Ctx>>() {
                let agent = ctx.agent.clone();
                jobhunt_core::pipeline::run_due(&agent, &|t| run_task(&app, t));
            }
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Job Hunt", true, None::<&str>)?;
    let search = MenuItem::with_id(app, "search", "Search for jobs now", true, None::<&str>)?;
    let inbox = MenuItem::with_id(app, "inbox", "Check email now", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let _ = UPDATE_ITEM.set(update.clone());
    let auto = CheckMenuItem::with_id(app, "autostart", "Start when I sign in", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit Job Hunt", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &search, &inbox, &PredefinedMenuItem::separator(app)?, &update, &auto, &PredefinedMenuItem::separator(app)?, &exit])?;
    let auto_item = auto.clone();
    TrayIconBuilder::with_id("jobhunt")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("Job Hunt")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, e| match e.id().as_ref() {
            "open" => show_main(app),
            "search" => {
                if !run_task(app, "search") {
                    notify(app, "Already searching", "A job search is running now.");
                }
            }
            "inbox" => {
                if !run_task(app, "inbox") {
                    notify(app, "Already checking", "An email check is running now.");
                }
            }
            "autostart" => {
                let on = !app.autolaunch().is_enabled().unwrap_or(false);
                let r = if on { app.autolaunch().enable() } else { app.autolaunch().disable() };
                if r.is_ok() {
                    let _ = auto_item.set_checked(on);
                }
            }
            "update" => tray_update(app),
            "exit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn to_req(r: &http::Request<Vec<u8>>) -> api::Req {
    let uri = r.uri();
    let path = percent_encoding::percent_decode_str(uri.path()).decode_utf8_lossy().to_string();
    let query = uri.query().map(|q| url::form_urlencoded::parse(q.as_bytes()).into_owned().collect()).unwrap_or_default();
    api::Req { method: r.method().as_str().to_string(), path, query, body: r.body().clone(), remote: false }
}

fn to_response(r: api::Resp) -> http::Response<Vec<u8>> {
    let mut b = http::Response::builder().status(r.status).header("Content-Type", r.ctype);
    for (k, v) in r.headers {
        b = b.header(k, v);
    }
    b.body(r.body).unwrap_or_else(|_| http::Response::new(Vec::new()))
}

pub fn run() {
    if std::env::args().any(|a| a == "--mcp") {
        serve_mcp();
        return;
    }
    let background = std::env::args().any(|a| a == "--background");
    let mut builder = tauri::Builder::default();
    if std::env::var("JOBHUNT_DATA").is_err() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));
    }
    builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--background"])))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                // The off-screen windows that read job sites keep no size or place.
                .with_filter(|label| !label.starts_with("reader"))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("jobhunt", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let req = to_req(&request);
                let resp = match app.try_state::<Arc<Ctx>>() {
                    Some(state) => api::handle(&state.agent, &state.host, &req),
                    None => api::Resp::error(503, "Job Hunt is still starting"),
                };
                responder.respond(to_response(resp));
            });
        })
        .setup(move |app| {
            let data = data_dir();
            std::fs::create_dir_all(data.join("cv"))?;
            // A restore chosen in Settings is applied here, before the database is opened.
            if let Err(e) = jobhunt_core::backup::apply_pending(&data) {
                eprintln!("restore failed: {e}");
            }
            // A new install keeps your files (CVs, applications, backups) in Documents\\Job Hunt; the
            // first-run setup and Settings can choose another folder. Older installs keep theirs.
            let new_install = !data.join("jobhunt.db").exists();
            if new_install && !data.join(jobhunt_core::util::FILES_POINTER).exists() {
                if let Ok(docs) = app.path().document_dir() {
                    let _ = std::fs::write(data.join(jobhunt_core::util::FILES_POINTER), docs.join("Job Hunt").to_string_lossy().as_bytes());
                }
            }
            let db = Db::open(&data.join("jobhunt.db")).map_err(|e| format!("Couldn't open the database: {e}"))?;
            let handle = app.handle().clone();
            let agent = Agent::new(&data, db, Box::new(move |title, body| notify(&handle, title, body)));
            let host: Arc<dyn Host> = Arc::new(TauriHost { app: app.handle().clone() });
            let agent = Arc::new(agent);
            jobhunt_core::sync::apply_after_restore(&agent);
            // Files saved with a path from another computer, or before they moved, are found again.
            agent.fix_file_paths();
            // A brand-new install starts with Windows, so searches and email checks carry on after a
            // restart. (Settings → App turns it off; existing installs keep their choice.)
            if agent.secret("profile").is_empty() && agent.secret("app.version").is_empty() && !cfg!(debug_assertions) {
                let _ = app.autolaunch().enable();
            }
            let _ = agent.db().set("app.version", &host.version());
            // Remote access (Settings → App): Job Hunt in a browser on your phone, over Tailscale.
            if agent.secret("remote.on") == "1" {
                let _ = jobhunt_core::web::ensure_started(agent.clone(), host.clone(), api::remote_port(&agent));
            }
            clip_watch(agent.clone());
            // The browser extension's Fill this form talks to Job Hunt here (this computer only).
            jobhunt_core::bridge::start(agent.clone());
            // The extension's folder, up to date with this version (it reloads itself from there).
            {
                let (agent, host) = (agent.clone(), host.clone());
                std::thread::spawn(move || {
                    if let Err(e) = jobhunt_core::bridge::write_extension(&agent, host.as_ref()) {
                        agent.note("Couldn't update the browser extension's folder", &e.0);
                    }
                });
            }
            // Job sites behind a bot check, or that list their jobs with scripts, are read in a browser.
            let reader = app.handle().clone();
            jobhunt_core::sites::set_browser(Box::new(move |url| read_in_browser(&reader, url)));
            app.manage(Arc::new(Ctx { agent, host }));
            if app.autolaunch().is_enabled().unwrap_or(false) {
                let _ = app.autolaunch().enable(); // keep the sign-in entry pointing at this copy
            }
            let url = WebviewUrl::CustomProtocol("jobhunt://localhost/".parse().unwrap());
            let win = WebviewWindowBuilder::new(app, "main", url)
                .title("Job Hunt")
                .inner_size(1360.0, 880.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .visible(false)
                .build()?;
            if !background {
                let _ = win.show();
                let _ = win.set_focus();
            }
            build_tray(app.handle())?;
            scheduler(app.handle().clone());
            keep_awake(app.handle().clone());
            wake_timer(app.handle().clone());
            update_watch(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window goes to the tray; the Apply window simply closes.
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::SeqCst) {
                    return;
                }
                let app = window.app_handle();
                let _ = app.save_window_state(StateFlags::all());
                let exit = app.try_state::<Arc<Ctx>>().map(|c| c.agent.secret("app.close") == "exit").unwrap_or(false);
                if exit {
                    quit(app);
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
                if !TOLD_ABOUT_TRAY.swap(true, Ordering::SeqCst) {
                    notify(app, "Job Hunt is still running", "It keeps searching and checking email. Click the tray icon to open it, or right-click it to exit.");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting Job Hunt")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Closing the window hides it; only Exit really quits.
                if code.is_none() && !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}

/// Windows' folder dialog, through PowerShell (no extra libraries), on top of Job Hunt's window.
/// The starting folder goes in an environment variable so no quoting can break. None when cancelled.
fn pick_folder(start: &str) -> jobhunt_core::R<Option<String>> {
    if !cfg!(windows) {
        return Err(jobhunt_core::Error("Choosing a folder works on Windows; type the path instead.".into()));
    }
    let script = "Add-Type -AssemblyName System.Windows.Forms; \
        $d = New-Object System.Windows.Forms.FolderBrowserDialog; \
        $d.Description = 'Choose a folder for Job Hunt'; $d.ShowNewFolderButton = $true; \
        if ($env:JH_START -and (Test-Path $env:JH_START)) { $d.SelectedPath = $env:JH_START }; \
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }; \
        if ($d.ShowDialog($owner) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }";
    let mut c = std::process::Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script]).env("JH_START", start);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes up
    }
    let out = c.output().map_err(|e| jobhunt_core::Error(format!("Couldn't open the folder dialog ({e}).")))?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(Some(path).filter(|p| !p.is_empty()))
}
