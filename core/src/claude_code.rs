//! Claude through Claude Code on this PC, using whatever account it is signed in with (usually your
//! Claude subscription), so Job Hunt needs no API key or credits.
//!
//! Each request runs `claude -p` in an empty folder with every tool switched off (Read only when a
//! PDF must be read), no MCP servers, no slash commands and no saved session, and asks for output
//! that matches a JSON schema. The window stays hidden on Windows.

use crate::{Error, R};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeCode {
    /// The program to start: claude(.exe), or node for an npm install.
    pub program: PathBuf,
    /// Arguments that come before Claude Code's own (the cli.js path for an npm install).
    pub prefix: Vec<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct Status {
    pub found: bool,
    pub path: String,
    pub version: String,
    pub signed_in: bool,
    /// claude.ai (subscription), api_key, oauth_token, ...
    pub method: String,
    pub problem: String,
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Where Claude Code is installed, if anywhere. `custom` is a path set in Settings.
pub fn find(custom: &str) -> Option<ClaudeCode> {
    if !custom.trim().is_empty() {
        let p = PathBuf::from(custom.trim());
        return p.is_file().then(|| from_path(&p)).flatten();
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(h) = home() {
        dirs.push(h.join(".local").join("bin")); // the native installer
        dirs.push(h.join(".claude").join("local"));
    }
    if let Some(a) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(a).join("npm")); // npm install -g on Windows
    }
    for d in &dirs {
        let native = d.join(exe("claude"));
        if native.is_file() {
            return Some(ClaudeCode { program: native, prefix: vec![] });
        }
    }
    for d in &dirs {
        let cmd = d.join("claude.cmd");
        if cmd.is_file() {
            if let Some(c) = from_path(&cmd) {
                return Some(c);
            }
        }
    }
    None
}

/// A claude.cmd from npm can't take JSON arguments safely through cmd.exe, so run its script with node.
fn from_path(p: &Path) -> Option<ClaudeCode> {
    let is_cmd = p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("cmd")).unwrap_or(false);
    if !is_cmd {
        return Some(ClaudeCode { program: p.to_path_buf(), prefix: vec![] });
    }
    let dir = p.parent()?;
    let script = dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("cli.js");
    if !script.is_file() {
        return None;
    }
    let node = [dir.join(exe("node"))]
        .into_iter()
        .chain(std::env::var_os("PATH").map(|v| std::env::split_paths(&v).map(|d| d.join(exe("node"))).collect::<Vec<_>>()).unwrap_or_default())
        .find(|n| n.is_file())?;
    Some(ClaudeCode { program: node, prefix: vec![script.to_string_lossy().to_string()] })
}

fn command(cc: &ClaudeCode) -> Command {
    let mut c = Command::new(&cc.program);
    c.args(&cc.prefix);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
    }
    c
}

/// Run to completion with a time limit; returns (exit ok, stdout, stderr).
fn run_capture(mut c: Command, stdin: &str, limit: Duration) -> R<(bool, String, String)> {
    let mut child = c
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error(format!("Couldn't start Claude Code ({e}).")))?;
    if let Some(mut si) = child.stdin.take() {
        let data = stdin.to_string();
        std::thread::spawn(move || {
            let _ = si.write_all(data.as_bytes());
        });
    }
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let t_out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error("Claude Code took too long to answer and was stopped.".into()));
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    Ok((status.success(), t_out.join().unwrap_or_default(), t_err.join().unwrap_or_default()))
}

/// Is Claude Code installed, which version, and is it signed in?
pub fn status(custom: &str) -> Status {
    let Some(cc) = find(custom) else {
        return Status { problem: "Claude Code isn't installed on this PC (or isn't where Job Hunt looks).".into(), ..Status::default() };
    };
    let mut st = Status { found: true, path: cc.program.to_string_lossy().to_string(), ..Status::default() };
    let mut v = command(&cc);
    v.arg("--version");
    if let Ok((_, out, _)) = run_capture(v, "", Duration::from_secs(30)) {
        st.version = out.split_whitespace().next().unwrap_or("").to_string();
    }
    let mut a = command(&cc);
    a.args(["auth", "status"]);
    match run_capture(a, "", Duration::from_secs(30)) {
        Ok((ok, out, _)) => {
            let v: Value = serde_json::from_str(out.trim()).unwrap_or(Value::Null);
            st.method = v.get("authMethod").and_then(|m| m.as_str()).unwrap_or("").to_string();
            st.signed_in = ok && st.method != "none";
            if !st.signed_in {
                st.problem = "Claude Code isn't signed in. Open a terminal, run claude, and sign in with your Claude account.".into();
            }
        }
        Err(e) => st.problem = e.0,
    }
    st
}

/// A PowerShell script that installs Claude Code (`install`) and/or signs it in, for a window the
/// desktop app opens, so nobody has to find a terminal and type commands.
pub fn setup_script(install: bool, custom: &str) -> String {
    let say = |t: &str, colour: &str| format!("Write-Host '{}' -ForegroundColor {colour}\n", t.replace('\'', "''"));
    let mut s = String::from("$ErrorActionPreference = 'Continue'\n$Host.UI.RawUI.WindowTitle = 'Job Hunt: setting up Claude'\n");
    let run = match find(custom).filter(|_| !install) {
        Some(cc) => format!("& {}", std::iter::once(cc.program.to_string_lossy().to_string()).chain(cc.prefix.iter().cloned())
            .map(|a| format!("'{}'", a.replace('\'', "''"))).collect::<Vec<_>>().join(" ")),
        None => "& (Join-Path $env:USERPROFILE '.local\\bin\\claude.exe')".to_string(),
    };
    if install {
        s += &say("Installing Claude Code. This takes a minute or two...", "Cyan");
        s += "irm https://claude.ai/install.ps1 | iex\n";
        s += "if (-not (Test-Path (Join-Path $env:USERPROFILE '.local\\bin\\claude.exe'))) {\n";
        s += &say("The install didn't finish. Check your internet connection, close this window and try again.", "Red");
        s += "  return\n}\nWrite-Host ''\n";
    }
    s += &say("Now sign in with your Claude account. Your browser opens: approve it there.", "Cyan");
    s += &format!("{run} auth login\nif ($LASTEXITCODE -ne 0) {{\n");
    s += &say("If Claude asks you to choose a style or sign in below, follow its steps. When it says you're signed in, type /exit and press Enter.", "Yellow");
    s += &format!("  {run}\n}}\nWrite-Host ''\n");
    s += &say("All done. Close this window and go back to Job Hunt.", "Green");
    s
}

/// Why a claude.ai connector (like Indeed) isn't reaching Claude Code here, in plain words, from how
/// Claude Code is signed in and what `claude mcp list` shows.
pub fn connector_diagnosis(cc: &ClaudeCode, name: &str) -> String {
    let mut a = command(cc);
    a.args(["auth", "status"]);
    let method = run_capture(a, "", Duration::from_secs(30)).ok()
        .and_then(|(_, out, _)| serde_json::from_str::<Value>(out.trim()).ok())
        .and_then(|v| v.get("authMethod").and_then(|m| m.as_str()).map(String::from)).unwrap_or_default();
    let mut l = command(cc);
    l.args(["mcp", "list"]);
    let listed = run_capture(l, "", Duration::from_secs(90)).map(|(_, out, err)| format!("{out}\n{err}")).unwrap_or_default();
    explain_connector(name, &method, &listed)
}

/// The words for `connector_diagnosis`, from the sign-in method and the `claude mcp list` output.
pub fn explain_connector(name: &str, method: &str, listed: &str) -> String {
    if method == "api_key" || method == "oauth_token" {
        return format!("Claude Code on this computer is signed in with {}, which doesn't bring your claude.ai connectors. \
Sign it in with your Claude account instead (Settings → Accounts → Sign in to Claude), then Test {name} again.",
            if method == "api_key" { "an API key" } else { "a token" });
    }
    let line = listed.lines().find(|l| l.to_lowercase().contains(&name.to_lowercase())).map(|l| l.to_lowercase());
    match line {
        None => format!("Claude Code on this computer doesn't see a {name} connector. At claude.ai → Settings → Connectors, connect \
{name} with the same Claude account Claude Code is signed in with here, then Test again."),
        Some(l) if l.contains("auth") || l.contains("✗") || l.contains("fail") || l.contains("error") => format!("Claude Code sees your \
{name} connector, but it isn't connected right now. Reconnect {name} at claude.ai → Settings → Connectors, then Test again."),
        Some(_) => format!("Claude Code sees your {name} connector, but it didn't answer this time. Test again in a few minutes."),
    }
}

pub struct Ask<'a> {
    pub system: &'a str,
    pub prompt: &'a str,
    pub schema: &'a Value,
    pub model: &'a str,
    pub effort: &'a str,
    /// Files copied into the working folder for Claude to read (e.g. a PDF CV). Enables the Read tool.
    pub files: &'a [(String, Vec<u8>)],
    /// Connector (MCP) tools from your Claude account that this request may use, e.g. Indeed's search.
    /// Empty: no MCP servers at all.
    pub connectors: &'a [&'a str],
    /// Let Claude search and read the web (WebSearch, WebFetch), e.g. to research a company.
    pub web: bool,
    pub limit: Duration,
}

/// Built-in tools refused when a request uses your connectors (see `args`).
pub const CONNECTOR_DENIED: &[&str] = &["Bash", "BashOutput", "KillShell", "Edit", "MultiEdit", "Write", "NotebookEdit",
    "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "SlashCommand", "Skill"];

/// The arguments for one request. Separate so tests can check them.
pub fn args(ask: &Ask, system_file: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--json-schema".into(),
        ask.schema.to_string(),
        "--system-prompt-file".into(),
        system_file.to_string_lossy().to_string(),
        "--disable-slash-commands".into(),
        "--no-session-persistence".into(),
        "--max-turns".into(),
        if !ask.connectors.is_empty() { "60".into() } else if ask.web { "30".into() } else if ask.files.is_empty() { "3".into() } else { "6".into() },
    ];
    if ask.connectors.is_empty() {
        // Only the built-in tools this request needs (none, usually), and no MCP servers.
        let mut t: Vec<&str> = vec![];
        if !ask.files.is_empty() {
            t.push("Read");
        }
        if ask.web {
            t.extend(["WebSearch", "WebFetch"]);
        }
        a.extend(["--tools".into(), t.join(","), "--strict-mcp-config".into()]);
    } else {
        // With connectors, "--tools" left empty also hides your claude.ai connectors, so instead the
        // built-in tools that could change or reach anything are refused by name. It runs in an empty
        // folder, and only the connector tools in --allowedTools may run.
        a.extend(["--disallowedTools".into(), CONNECTOR_DENIED.join(",")]);
    }
    // Your claude.ai connectors load, but only these tools may run; anything else is refused.
    // ToolSearch too: with several connectors, Claude Code may hold their tools back until it
    // looks them up, and refused, the connector's tools never appear.
    let mut allowed: Vec<&str> = ask.connectors.to_vec();
    if !ask.connectors.is_empty() {
        allowed.push("ToolSearch");
    }
    if ask.web {
        allowed.extend(["WebSearch", "WebFetch"]);
    }
    if !allowed.is_empty() {
        a.push("--allowedTools".into());
        a.push(allowed.join(","));
    }
    if !ask.model.trim().is_empty() {
        a.push("--model".into());
        a.push(ask.model.trim().into());
    }
    if !ask.effort.is_empty() {
        a.push("--effort".into());
        a.push(ask.effort.into());
    }
    a
}

/// What Claude Code printed: the structured answer, or a readable error.
pub fn parse_output(ok: bool, stdout: &str, stderr: &str) -> R<Value> {
    let start = stdout.find('{');
    let v: Value = start.and_then(|s| serde_json::from_str(stdout[s..].trim()).ok()).unwrap_or(Value::Null);
    if v.is_null() {
        let why = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        let short: String = why.chars().take(300).collect();
        return Err(Error(format!("Claude Code didn't answer as expected{}", if short.is_empty() { ".".into() } else { format!(": {short}") })));
    }
    // What it used, for the usage meter.
    let n = |k: &str| v.pointer(&format!("/usage/{k}")).and_then(|x| x.as_u64()).unwrap_or(0);
    crate::usage::report(n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"), n("output_tokens"),
        v.get("total_cost_usd").and_then(|c| c.as_f64()).unwrap_or(0.0));
    let is_error = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(!ok);
    let result = v.get("result").and_then(|r| r.as_str()).unwrap_or("");
    let subtype = v.get("subtype").and_then(|r| r.as_str()).unwrap_or("");
    if is_error || subtype.starts_with("error") {
        let low = result.to_lowercase();
        let msg = if is_limit(result) {
            // "Claude AI usage limit reached|1760000000", or "You've hit your session limit · resets 10:50am (Asia/Dubai)".
            let at = result.rsplit('|').next().and_then(|t| t.trim().parse::<i64>().ok()).filter(|t| *t > 1_000_000_000)
                .or_else(|| resets_at(result, chrono::Utc::now()));
            crate::usage::report_limit(at);
            "Your Claude usage limit is reached for now. Job Hunt will try again once it resets.".to_string()
        } else if low.contains("login") || low.contains("log in") || low.contains("not logged") || low.contains("authenticat") {
            "Claude Code isn't signed in. Open a terminal, run claude, and sign in with your Claude account.".to_string()
        } else if subtype == "error_max_turns" {
            "Claude Code ran out of steps before answering.".to_string()
        } else {
            let r: String = result.chars().take(300).collect();
            format!("Claude Code reported a problem: {}", if r.is_empty() { subtype.to_string() } else { r })
        };
        return Err(Error(msg));
    }
    match v.get("structured_output") {
        Some(s) if !s.is_null() => Ok(s.clone()),
        _ => {
            // Older versions without --json-schema support: take JSON out of the text result.
            let s = result.find('{').zip(result.rfind('}')).map(|(a, b)| &result[a..=b]).unwrap_or("");
            serde_json::from_str(s).map_err(|_| Error("Claude Code's answer wasn't in the expected shape. Updating Claude Code (claude update) may help.".into()))
        }
    }
}

/// Is this Claude's usage limit (the 5-hour session, the weekly one, or an older "usage limit reached")?
pub fn is_limit(text: &str) -> bool {
    let low = text.to_lowercase();
    low.contains("limit") && ["usage", "reached", "rate", "session", "weekly", "hit your", "resets"].iter().any(|w| low.contains(w))
}

/// When a limit message says it resets ("resets 10:50am (Asia/Dubai)", "resets Oct 24, 9am (Europe/London)"),
/// as Unix seconds: the next such time after `now`.
pub fn resets_at(text: &str, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    let low = text.to_lowercase();
    let rest = &text[low.find("resets")? + 6..];
    let (when, zone) = match rest.find('(') {
        Some(i) => (rest[..i].trim(), rest[i + 1..].split(')').next().unwrap_or("").trim()),
        None => (rest.trim(), ""),
    };
    // Claude Code names the zone; without one, it's this computer's own time.
    match zone.parse::<chrono_tz::Tz>() {
        Ok(tz) => reset_in(when, &tz, now),
        Err(_) => reset_in(when, &chrono::Local, now),
    }
}

fn reset_in<Z: chrono::TimeZone>(when: &str, tz: &Z, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    use chrono::{Datelike, NaiveTime};
    let when = when.trim_start_matches("at ").trim();
    let (date, time) = match when.rsplit_once(',') {
        Some((d, t)) => (Some(d.trim()), t.trim()),
        None => (None, when),
    };
    let mut t = time.to_lowercase().replace(' ', "");
    if !t.contains(':') && t.len() > 2 {
        t.insert_str(t.len() - 2, ":00"); // "9am" -> "9:00am"
    }
    let time = NaiveTime::parse_from_str(&t, "%I:%M%p").ok()?;
    let local_now = now.with_timezone(tz);
    let day = match date {
        Some(d) => {
            let d = chrono::NaiveDate::parse_from_str(&format!("{d} {}", local_now.year()), "%b %d %Y").ok()?;
            if d < local_now.date_naive() - chrono::Duration::days(1) { d.with_year(d.year() + 1)? } else { d }
        }
        None => local_now.date_naive(),
    };
    let mut at = tz.from_local_datetime(&day.and_time(time)).earliest()?.with_timezone(&chrono::Utc);
    if date.is_none() && at <= now {
        at += chrono::Duration::days(1);
    }
    Some(at.timestamp())
}

/// One request through Claude Code.
pub fn ask(cc: &ClaudeCode, ask: &Ask) -> R<Value> {
    // A fresh, empty folder per request: no project settings, hooks or MCP servers apply.
    let dir = std::env::temp_dir().join("JobHunt").join(format!("claude-{}", crate::util::short_hash(&format!("{:?}{}", Instant::now(), rand::random::<u64>()))));
    std::fs::create_dir_all(&dir)?;
    let result = (|| {
        let system_file = dir.join("instructions.txt");
        std::fs::write(&system_file, ask.system)?;
        for (name, bytes) in ask.files {
            std::fs::write(dir.join(name), bytes)?;
        }
        let mut c = command(cc);
        c.args(args(ask, &system_file)).current_dir(&dir);
        if !ask.connectors.is_empty() {
            // A minute for claude.ai connectors to connect before the first turn.
            c.env("MCP_TIMEOUT", "60000");
        }
        let (ok, out, err) = run_capture(c, ask.prompt, ask.limit)?;
        parse_output(ok, &out, &err)
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn arguments() {
        let schema = json!({"type": "object"});
        let a = args(&Ask { system: "s", prompt: "p", schema: &schema, model: "", effort: "low", files: &[], connectors: &[], web: false, limit: Duration::from_secs(1) }, Path::new("/tmp/i.txt"));
        let pos = |f: &str| a.iter().position(|x| x == f).unwrap();
        assert_eq!(a[pos("--tools") + 1], "", "every tool off");
        assert_eq!(a[pos("--json-schema") + 1], r#"{"type":"object"}"#);
        assert_eq!(a[pos("--output-format") + 1], "json");
        assert!(a.contains(&"--no-session-persistence".to_string()) && a.contains(&"--strict-mcp-config".to_string()));
        assert!(!a.contains(&"--model".to_string()), "no model: use Claude Code's own default");
        assert!(!a.contains(&"--bare".to_string()), "bare mode ignores the subscription login");
        let files = vec![("cv.pdf".to_string(), vec![1u8])];
        let b = args(&Ask { system: "s", prompt: "p", schema: &schema, model: "sonnet", effort: "", files: &files, connectors: &[], web: false, limit: Duration::from_secs(1) }, Path::new("/tmp/i.txt"));
        assert_eq!(b[b.iter().position(|x| x == "--tools").unwrap() + 1], "Read");
        let c = args(&Ask { system: "s", prompt: "p", schema: &schema, model: "", effort: "", files: &[], connectors: &["mcp__x__a", "mcp__x__b"], web: false, limit: Duration::from_secs(1) }, Path::new("/tmp/i.txt"));
        assert!(!c.contains(&"--strict-mcp-config".to_string()), "connectors need your account's MCP servers");
        assert_eq!(c[c.iter().position(|x| x == "--allowedTools").unwrap() + 1], "mcp__x__a,mcp__x__b,ToolSearch");
        // An empty --tools hides claude.ai connectors too, so the risky built-ins are refused by name instead.
        assert!(!c.contains(&"--tools".to_string()));
        let denied = &c[c.iter().position(|x| x == "--disallowedTools").unwrap() + 1];
        assert!(["Bash", "Write", "Edit", "WebFetch"].iter().all(|t| denied.split(',').any(|d| d == *t)));
        let w = args(&Ask { system: "s", prompt: "p", schema: &schema, model: "", effort: "", files: &[], connectors: &[], web: true, limit: Duration::from_secs(1) }, Path::new("/tmp/i.txt"));
        assert_eq!(w[w.iter().position(|x| x == "--tools").unwrap() + 1], "WebSearch,WebFetch");
        assert_eq!(w[w.iter().position(|x| x == "--allowedTools").unwrap() + 1], "WebSearch,WebFetch");
        assert!(w.contains(&"--strict-mcp-config".to_string()), "no MCP servers for web research");
        assert_eq!(b[b.iter().position(|x| x == "--model").unwrap() + 1], "sonnet");
    }

    #[test]
    fn connector_problems_in_plain_words() {
        assert!(explain_connector("Indeed", "oauth_token", "").contains("signed in with a token"));
        assert!(explain_connector("Indeed", "claude.ai", "claude.ai Gmail: ✓ Connected").contains("doesn't see a Indeed") || explain_connector("Indeed", "claude.ai", "").contains("doesn't see"));
        assert!(explain_connector("Indeed", "claude.ai", "claude.ai Indeed: https://x - ! Needs authentication").contains("isn't connected right now"));
        assert!(explain_connector("Indeed", "claude.ai", "claude.ai Indeed: https://x - ✓ Connected").contains("didn't answer"));
    }

    #[test]
    fn outputs() {
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"","structured_output":{"body":"hi"}}"#;
        assert_eq!(parse_output(true, ok, "").unwrap(), json!({"body": "hi"}));
        let fallback = r#"{"type":"result","subtype":"success","is_error":false,"result":"Here: {\"body\": \"yo\"}"}"#;
        assert_eq!(parse_output(true, fallback, "").unwrap(), json!({"body": "yo"}));
        let limit = r#"{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1760000000"}"#;
        assert!(parse_output(false, limit, "").unwrap_err().0.contains("usage limit"));
        let session = r#"{"type":"result","subtype":"success","is_error":true,"result":"You've hit your session limit · resets 10:50am (Asia/Dubai)"}"#;
        assert!(parse_output(false, session, "").unwrap_err().0.contains("usage limit"));
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-21T10:00:00+04:00").unwrap().with_timezone(&chrono::Utc);
        let at = |t: &str| resets_at(t, now).map(|s| chrono::DateTime::from_timestamp(s, 0).unwrap().to_rfc3339());
        assert_eq!(at("You've hit your session limit · resets 10:50am (Asia/Dubai)").as_deref(), Some("2026-10-21T06:50:00+00:00"));
        assert_eq!(at("resets 8am (Asia/Dubai)").as_deref(), Some("2026-10-22T04:00:00+00:00"), "already past today: tomorrow");
        assert_eq!(at("You've hit your weekly limit · resets Oct 24, 9am (Asia/Dubai)").as_deref(), Some("2026-10-24T05:00:00+00:00"));
        assert!(is_limit("You've hit your weekly limit") && !is_limit("Invalid API key"));
        let login = r#"{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}"#;
        assert!(parse_output(false, login, "").unwrap_err().0.contains("isn't signed in"));
        assert!(parse_output(false, "", "command not found").unwrap_err().0.contains("command not found"));
    }

    #[cfg(unix)]
    #[test]
    fn runs_a_fake_claude_code() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("claude");
        // Echo back the prompt (from stdin) and whether the instructions file arrived.
        std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2.1.300 (Claude Code)'; exit 0; fi\n\
if [ \"$1\" = \"auth\" ]; then echo '{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}'; exit 0; fi\n\
p=$(cat); n=$(cat instructions.txt); printf '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"\",\"structured_output\":{\"body\":\"%s|%s\"}}' \"$p\" \"$n\"\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cc = find(script.to_str().unwrap()).unwrap();
        let schema = json!({"type": "object"});
        let v = ask(&cc, &Ask { system: "be brief", prompt: "hello", schema: &schema, model: "", effort: "low", files: &[], connectors: &[], web: false, limit: Duration::from_secs(20) }).unwrap();
        assert_eq!(v, json!({"body": "hello|be brief"}));
        let st = status(script.to_str().unwrap());
        assert!(st.found && st.signed_in);
        assert_eq!((st.version.as_str(), st.method.as_str()), ("2.1.300", "claude.ai"));
        assert!(!status("/nonexistent/claude").found);
    }
}
