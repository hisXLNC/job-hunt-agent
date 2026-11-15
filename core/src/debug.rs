//! Debugging mode: a record of what Job Hunt does, for finding the cause of a problem.
//!
//! Errors are always recorded (requests that fail, crashes, script errors in the page). With
//! debugging on (Settings → App → Finding problems), so is everything else: every button pressed
//! (request, how long it took, how it ended), every request to Claude, every piece of background
//! work starting and ending, every event written to a job's history, and each step of a search.
//! The record is kept in memory (the newest `KEEP` lines) and, outside tests, in `debug-log.txt`
//! beside your data, so it survives a crash or a restart. Never recorded: the text sent to or
//! from Claude, request bodies, keys, CVs, or the text of emails.

use once_cell::sync::Lazy;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const KEEP: usize = 4000;
/// The file starts again past this size (the one before is kept as debug-log.old.txt).
const FILE_MAX: u64 = 4 * 1024 * 1024;

static ON: AtomicBool = AtomicBool::new(false);
static LINES: Lazy<Mutex<VecDeque<String>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static FILE: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

/// Called once the data folder is known: where the record is kept, and whether debugging is on.
pub fn init(data: &std::path::Path, on: bool) {
    if !cfg!(test) {
        *FILE.lock().unwrap_or_else(|e| e.into_inner()) = Some(data.join("debug-log.txt"));
    }
    if !cfg!(test) {
        catch_panics();
    }
    ON.store(on, Ordering::SeqCst);
    always("app", &format!("Job Hunt {} started on {} (debugging {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS, if on { "on" } else { "off" }));
}

pub fn on() -> bool {
    ON.load(Ordering::Relaxed)
}

pub fn set(on: bool) {
    ON.store(on, Ordering::SeqCst);
    always("app", if on { "debugging turned on" } else { "debugging turned off" });
}

/// Recorded only while debugging is on.
pub fn note(area: &str, what: &str) {
    if on() {
        always(area, what);
    }
}

/// Recorded whether debugging is on or not: errors, and the few lines that give them context.
pub fn always(area: &str, what: &str) {
    let line = format!("{} [{area}] {}", chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), scrub(&what.chars().take(1500).collect::<String>()).replace('\n', " \u{21b5} "));
    {
        let mut l = LINES.lock().unwrap_or_else(|e| e.into_inner());
        l.push_back(line.clone());
        while l.len() > KEEP {
            l.pop_front();
        }
    }
    let file = FILE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(path) = file.as_ref() {
        if std::fs::metadata(path).map(|m| m.len() > FILE_MAX).unwrap_or(false) {
            let _ = std::fs::rename(path, path.with_file_name("debug-log.old.txt"));
        }
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// The newest `max` lines, oldest first.
pub fn lines(max: usize) -> Vec<String> {
    let l = LINES.lock().unwrap_or_else(|e| e.into_inner());
    l.iter().skip(l.len().saturating_sub(max)).cloned().collect()
}

pub fn count() -> usize {
    LINES.lock().unwrap_or_else(|e| e.into_inner()).len()
}

/// Empty the record (the file too).
pub fn clear() {
    LINES.lock().unwrap_or_else(|e| e.into_inner()).clear();
    if let Some(path) = FILE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_file_name("debug-log.old.txt"));
    }
}

/// Email addresses and anything that looks like a key are taken out of what's recorded, so a report
/// can be pasted to someone else.
pub fn scrub(s: &str) -> String {
    static EMAIL: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap());
    static KEY: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"(?i)\b(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{40,}|(?:key|token|secret|password)=[^&\s]+)").unwrap());
    KEY.replace_all(&EMAIL.replace_all(s, "[email]"), "[hidden]").into_owned()
}

/// A crash anywhere in Job Hunt is written down with where it happened (the app's own handler still runs).
pub fn catch_panics() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let before = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let thread = std::thread::current().name().unwrap_or("a background thread").to_string();
            always("crash", &format!("{info} (in {thread})"));
            before(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn addresses_and_keys_are_taken_out() {
        let s = super::scrub("sent to dana@maple.example with sk-ant-abcdefgh12345678 and https://x.example/?key=abc123&x=1");
        assert_eq!(s, "sent to [email] with [hidden] and https://x.example/?[hidden]&x=1");
    }

    #[test]
    fn errors_are_kept_even_when_off() {
        super::set(false);
        super::note("test", "a quiet line that isn't kept");
        super::always("test", "an error that is kept");
        let l = super::lines(50).join("\n");
        assert!(l.contains("an error that is kept") && !l.contains("a quiet line"));
    }
}
