//! SQLite storage: jobs and their history, processed emails, calendar events, settings.

use crate::util::now;
use crate::{err, R};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

/// Pipeline stages, in board order.
pub const STATUSES: [&str; 11] = [
    "queued",       // scored above threshold, waiting for tailoring
    "ready",        // tailored, waiting for your approval
    "approved",     // approved; submit on the company site, then mark applied
    "applied",
    "interviewing",
    "offer",
    "rejected",
    "skipped",      // below threshold or filtered out
    "dismissed",    // you said no
    "saved",        // kept as a backup, to come back to later
    "no_response",  // applied, but the company never replied
];

const SCHEMA: &str = "
-- Recruiters you've dealt with, and which of your applications each one handled.
CREATE TABLE IF NOT EXISTS recruiters (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT '[]',
    stage TEXT NOT NULL DEFAULT '',
    first_at TEXT NOT NULL DEFAULT '',
    last_at TEXT NOT NULL DEFAULT '',
    emails INTEGER NOT NULL DEFAULT 0,
    gmail_ids TEXT NOT NULL DEFAULT '[]',
    asked TEXT NOT NULL DEFAULT '[]',
    hidden INTEGER NOT NULL DEFAULT 0,
    phone TEXT NOT NULL DEFAULT '',
    linkedin TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recruiter_jobs (
    email TEXT NOT NULL,
    job_id TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT '',
    first_at TEXT NOT NULL DEFAULT '',
    last_at TEXT NOT NULL DEFAULT '',
    emails INTEGER NOT NULL DEFAULT 0,
    last_subject TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (email, job_id)
);
CREATE INDEX IF NOT EXISTS recruiter_jobs_job ON recruiter_jobs(job_id);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    apply_email TEXT,
    description TEXT NOT NULL DEFAULT '',
    salary TEXT,
    posted_at TEXT,
    found_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'skipped',
    score INTEGER,
    track TEXT,
    reasoning TEXT,
    red_flags TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '[]',
    coverage_before REAL,
    coverage_after REAL,
    keyword_gaps TEXT NOT NULL DEFAULT '[]',
    cv_changes TEXT NOT NULL DEFAULT '[]',
    cv_path TEXT,
    letter_path TEXT,
    cover_letter TEXT,
    email_subject TEXT,
    applied_at TEXT,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
CREATE TABLE IF NOT EXISTS emails (
    gmail_id TEXT PRIMARY KEY,
    thread_id TEXT,
    job_id TEXT,
    sender TEXT,
    subject TEXT,
    category TEXT,
    summary TEXT,
    draft_id TEXT,
    received_at TEXT,
    processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_events (
    event_id TEXT PRIMARY KEY,
    job_id TEXT,
    kind TEXT NOT NULL,
    start TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Postings removed after a while, remembered so a search doesn't bring them back as new.
CREATE TABLE IF NOT EXISTS purged (id TEXT PRIMARY KEY, dupe_key TEXT NOT NULL, purged_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS purged_dupe ON purged(dupe_key);
-- The same role posted again later under another listing: a sign it's hard to fill, or not real.
CREATE TABLE IF NOT EXISTS reposts (job_id TEXT NOT NULL, posting_id TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (job_id, posting_id));
-- Other listings of a job that's stored already (the same role on another site, or posted again),
-- kept whole to set beside the first one (see pipeline/copies.rs).
CREATE TABLE IF NOT EXISTS copies (job_id TEXT NOT NULL, posting_id TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (job_id, posting_id));
-- Links in tailored CVs and letters that note when they're opened (see links.rs).
CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, job_id TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clicks (token TEXT NOT NULL, at TEXT NOT NULL, bot INTEGER NOT NULL DEFAULT 0);
-- Which sources listed each role (by company and title), to show how much they overlap.
-- Emails Job Hunt wrote that wait for your approval before they reach Gmail (see pipeline/drafts.rs).
CREATE TABLE IF NOT EXISTS held_drafts (id TEXT PRIMARY KEY, status TEXT NOT NULL, job_id TEXT, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sightings (dupe_key TEXT NOT NULL, source TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (dupe_key, source));
";

/// The job a posting found again is a copy of, by role and by link (see Db::record_repost).
const REPOST_BY_ROLE: &str = "SELECT id, found_at FROM jobs WHERE dupe_key = ?2 AND id != ?1 ORDER BY found_at LIMIT 1";
const REPOST_BY_LINK: &str = "SELECT id, found_at FROM jobs WHERE url_key = ?2 AND id != ?1 ORDER BY found_at LIMIT 1";
/// Every lookup a search makes for each posting it finds. None may read the whole jobs table: a
/// search finds thousands of postings, and the table holds every posting's text.
#[cfg(test)]
const PER_POSTING: &[&str] = &[
    "SELECT (SELECT COUNT(*) FROM jobs WHERE id = ?1 OR dupe_key = ?2) + (SELECT COUNT(*) FROM purged WHERE id = ?1 OR dupe_key = ?2)",
    "SELECT id FROM jobs WHERE id = ?1 OR dupe_key = ?2 LIMIT 1",
    "SELECT COUNT(*) FROM jobs WHERE url_key = ?1",
    REPOST_BY_ROLE,
    REPOST_BY_LINK,
    "SELECT url FROM jobs WHERE id = ?1 AND apply_url IS NULL",
    "SELECT id FROM jobs WHERE (id = ?1 OR dupe_key = ?2)
             AND status = 'skipped' AND score IS NULL AND reasoning LIKE 'Filtered out:%' LIMIT 1",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Change {
    pub before: String,
    pub after: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Job {
    pub id: String,
    pub source: String,
    pub company: String,
    pub title: String,
    pub location: String,
    pub url: String,
    pub apply_email: Option<String>,
    pub description: String,
    pub salary: Option<String>,
    pub posted_at: Option<String>,
    pub found_at: String,
    pub updated_at: String,
    pub status: String,
    pub score: Option<i64>,
    pub track: Option<String>,
    pub reasoning: Option<String>,
    pub red_flags: Vec<String>,
    pub keywords: Vec<String>,
    pub coverage_before: Option<f64>,
    pub coverage_after: Option<f64>,
    pub keyword_gaps: Vec<String>,
    pub cv_changes: Vec<Change>,
    pub cv_path: Option<String>,
    pub letter_path: Option<String>,
    pub cover_letter: Option<String>,
    pub email_subject: Option<String>,
    pub applied_at: Option<String>,
    pub notes: String,
    /// When Job Hunt saw the posting had closed (taken down or no longer accepting applications).
    pub closed_at: Option<String>,
    /// The last day to apply, when the posting gives one (YYYY-MM-DD).
    pub deadline: Option<String>,
    /// The company's own application page, when known (see sources::Posting::apply_url).
    pub apply_url: Option<String>,
    /// The fit score of the tailored CV (`score` is your CV before tailoring).
    pub score_after: Option<i64>,
    /// What the fit could be once the CV is tailored, predicted when it's scored.
    pub score_potential: Option<i64>,
    /// How the role reads against the career path you chose, when the scorer said: whether it
    /// leads toward it, and why. Kept as one of the stored red flags (profile::PATH_FLAG), and
    /// taken out of `red_flags` when the job is read.
    #[serde(default)]
    pub career: Option<Career>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Career {
    pub toward: bool,
    pub why: String,
}

impl Job {
    /// These flags as they're stored: with the career-path read put back.
    pub fn flags_to_store(&self, mut flags: Vec<String>) -> Vec<String> {
        if let Some(c) = &self.career {
            flags.push(format!("{} {}. {}", crate::profile::PATH_FLAG, if c.toward { "toward" } else { "away" }, c.why));
        }
        flags
    }
}

/// Employers that go by more than one name: (the key they share, names that are exactly them, names
/// that start with one of these). Sources spell them differently ("Bank of Montreal" on one board,
/// "BMO" on another, "mufgub" as Workday's code), and each spelling was its own company: no shared
/// logo, no "Applied here before", the same posting kept twice. Names are lower-case words, without
/// the legal endings dupe_key drops. Only exact names where a start would catch someone else
/// ("TD SYNNEX" isn't the bank).
const SAME_COMPANY: &[(&str, &[&str], &[&str])] = &[
    ("bmo", &["bank of montreal"], &["bmo"]),
    ("rbc", &["royal bank of canada", "royal bank"], &["rbc"]),
    ("td", &["td", "td bank", "td securities", "td insurance", "td canada trust", "td wealth", "td asset management", "toronto dominion bank", "toronto dominion"], &[]),
    ("cibc", &["canadian imperial bank of commerce"], &["cibc"]),
    ("scotiabank", &["bank of nova scotia"], &["scotiabank"]),
    ("nationalbank", &["national bank of canada", "national bank", "banque nationale du canada", "banque nationale"], &[]),
    ("ey", &["ey", "ernst young", "ernst and young"], &[]),
    ("pwc", &["pricewaterhousecoopers"], &["pwc"]),
    ("mufg", &["mufgub"], &["mufg"]),
    ("jpmorgan", &["jpmorgan", "jpmorgan chase", "jpmorganchase", "jp morgan", "jp morgan chase", "j p morgan"], &[]),
    ("sunlife", &["sun life", "sun life financial", "sunlife"], &[]),
    ("manulife", &[], &["manulife"]),
    ("deloitte", &[], &["deloitte"]),
    ("kpmg", &[], &["kpmg"]),
    ("hsbc", &[], &["hsbc"]),
    ("cppinvestments", &["cpp investments", "cpp investment board", "canada pension plan investment board"], &[]),
    ("otpp", &["otpp", "ontario teachers pension plan", "ontario teachers"], &[]),
];

/// The key an employer's names share (see SAME_COMPANY), from its name as lower-case words.
fn same_company(name: &str) -> Option<&'static str> {
    SAME_COMPANY.iter().find(|(_, exact, starts)| exact.contains(&name) || starts.iter().any(|s| name == *s || name.starts_with(&format!("{s} ")))).map(|(k, _, _)| *k)
}

/// The same role, however a source spells the company: "USA018 Thomson Reuters Holdings Inc." and
/// "Thomson Reuters" are one employer, and "Product Owner I (US)" is "Product Owner I".
pub fn dupe_key(company: &str, title: &str) -> String {
    const LEGAL: [&str; 17] = ["inc", "incorporated", "holdings", "holding", "corp", "corporation", "ltd", "limited", "llc", "plc", "co", "company", "the", "group", "na", "lp", "llp"];
    let words = |s: &str| -> Vec<String> {
        // Drop bracketed notes like "(Canada)" or "(US)".
        let mut out = String::new();
        let mut depth = 0;
        for c in s.chars() {
            match c {
                '(' | '[' => depth += 1,
                ')' | ']' => depth = (depth - 1).max(0),
                _ if depth == 0 => out.push(c),
                _ => {}
            }
        }
        out.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
    };
    let mut c = words(&company.replace("N.A.", "NA"));
    // A leading code like "USA018" that some Workday sites put before the company name.
    if c.len() > 1 && is_company_code(&c[0]) {
        c.remove(0);
    }
    let c: Vec<String> = c.into_iter().filter(|w| !LEGAL.contains(&w.as_str())).collect();
    // One employer under several names ("Bank of Montreal", "BMO Financial Group"): one key.
    let c: String = same_company(&c.join(" ")).map(String::from).unwrap_or_else(|| c.concat());
    format!("{c}|{}", words(title).join(" "))
}

/// One employer however a source spells it ("Thomson Reuters Holdings Inc." is "thomsonreuters"),
/// for what's kept per company, like its employee rating.
/// Settings that only note when something last ran or was tried: not a change worth a sync.
fn bookkeeping(key: &str) -> bool {
    (key.starts_with("last.") && key != "last.report") || key == "sync.tried" || key == "sync.error" || key == "search.held.count"
}

pub fn company_key(company: &str) -> String {
    dupe_key(company, "").trim_end_matches('|').to_string()
}

/// A posting's link reduced to what identifies the job, so the same posting found through two
/// sources matches: no tracking tags, language part, "www.", trailing /apply or slash. Empty when
/// the link doesn't point at one job (none, or a site's home page).
pub fn url_key(url: &str) -> String {
    const KEEP: [&str; 12] = ["gh_jid", "jk", "vjk", "jobid", "job_id", "currentjobid", "reqid", "requisitionid", "jobreqid", "pid", "id", "posting_id"];
    let u = url.trim();
    let Some(rest) = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")) else { return String::new() };
    let rest = rest.split('#').next().unwrap_or("");
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (host, path) = path.split_once('/').unwrap_or((path, ""));
    let host = host.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let host = if host == "job-boards.greenhouse.io" { "boards.greenhouse.io" } else { host };
    let host = host.strip_suffix(".linkedin.com").map(|_| "linkedin.com").unwrap_or(host);
    let locale = |x: &str| x.len() == 5 && x.as_bytes()[2] == b'-' && x.chars().filter(|c| *c != '-').all(|c| c.is_ascii_alphabetic());
    let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && !locale(p)).collect();
    if matches!(parts.last(), Some(&"apply") | Some(&"application")) {
        parts.pop();
    }
    let mut keep: Vec<String> = query.split('&').filter_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (KEEP.contains(&k.to_lowercase().as_str()) && !v.is_empty()).then(|| format!("{}={v}", k.to_lowercase()))
    }).collect();
    keep.sort();
    // LinkedIn shows one job under several addresses; its number is what counts.
    if host == "linkedin.com" {
        let id = keep.iter().find_map(|k| k.strip_prefix("currentjobid=").map(String::from))
            .or_else(|| parts.last().map(|p| p.rsplit('-').next().unwrap_or(p).to_string()).filter(|p| p.chars().all(|c| c.is_ascii_digit())));
        return id.map(|i| format!("linkedin.com/jobs/view/{i}")).unwrap_or_default();
    }
    if parts.is_empty() && keep.is_empty() {
        return String::new();
    }
    let mut k = format!("{host}/{}", parts.join("/").to_lowercase());
    if !keep.is_empty() {
        k.push('?');
        k.push_str(&keep.join("&"));
    }
    k
}

/// The employer's own number for a posting, from a link on its careers site: (site, number).
/// Workday's "…/Project-Manager_J69324", Greenhouse's job number, Lever's and Ashby's job id,
/// SmartRecruiters' number, or a requisition number in the query. None for job boards (LinkedIn,
/// Indeed…), whose numbers change when a posting is put up again.
pub fn requisition(url: &str) -> Option<(String, String)> {
    let u = url::Url::parse(url.trim()).ok()?;
    let host = u.host_str()?.to_lowercase();
    if crate::sources::is_job_board(url) {
        return None;
    }
    let parts: Vec<&str> = u.path_segments().map(|p| p.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let q = |k: &str| u.query_pairs().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.to_string()).filter(|v| !v.is_empty());
    let id = if host.ends_with("myworkdayjobs.com") || host.ends_with("myworkdaysite.com") {
        let last = parts.iter().rev().find(|p| **p != "apply" && **p != "login")?;
        // ("…_R12345-1" is R12345 again, posted for a second place.)
        last.rsplit_once('_').map(|(_, id)| match id.rsplit_once('-') { Some((a, n)) if !a.is_empty() && n.len() <= 2 && n.chars().all(|c| c.is_ascii_digit()) => a.to_string(), _ => id.to_string() })
            .filter(|id| id.chars().any(|c| c.is_ascii_digit()))
    } else if host.contains("greenhouse.io") {
        q("gh_jid").or_else(|| parts.iter().position(|p| *p == "jobs").and_then(|i| parts.get(i + 1)).map(|s| s.to_string()))
    } else if host == "jobs.lever.co" || host == "jobs.ashbyhq.com" {
        parts.get(1).map(|s| s.to_string())
    } else if host.contains("smartrecruiters.com") {
        parts.iter().find_map(|p| p.split('-').next().filter(|d| d.len() >= 6 && d.chars().all(|c| c.is_ascii_digit())).map(String::from))
    } else {
        ["gh_jid", "jobid", "job_id", "reqid", "requisitionid", "jobreqid", "posting_id"].iter().find_map(|k| q(k))
    }?;
    Some((host, id.to_lowercase()))
}

/// Two postings' links name different requisitions on the same careers site: two jobs, however
/// alike their titles.
pub fn different_requisitions(a: &[&str], b: &[&str]) -> bool {
    let ra: Vec<(String, String)> = a.iter().filter_map(|l| requisition(l)).collect();
    let rb: Vec<(String, String)> = b.iter().filter_map(|l| requisition(l)).collect();
    let shared: Vec<&(String, String)> = ra.iter().filter(|x| rb.iter().any(|y| y.0 == x.0)).collect();
    !shared.is_empty() && shared.iter().all(|x| !rb.iter().any(|y| y.0 == x.0 && y.1 == x.1))
}

/// An internal code like "USA018": two or more letters, then two or more digits.
pub fn is_company_code(w: &str) -> bool {
    let letters = w.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    let digits = w.chars().skip(letters).take_while(|c| c.is_ascii_digit()).count();
    letters >= 2 && digits >= 2 && letters + digits == w.chars().count()
}

fn list<T: serde::de::DeserializeOwned + Default>(s: String) -> T {
    serde_json::from_str(&s).unwrap_or_default()
}

impl Job {
    fn from_row(r: &Row) -> rusqlite::Result<Job> {
        let all_flags: Vec<String> = list(r.get("red_flags")?);
        let career = crate::profile::path_read(&all_flags).map(|(toward, why)| Career { toward, why });
        Ok(Job {
            career,
            id: r.get("id")?,
            source: r.get("source")?,
            company: r.get("company")?,
            title: r.get("title")?,
            location: r.get("location")?,
            url: r.get("url")?,
            apply_email: r.get("apply_email")?,
            description: r.get("description")?,
            salary: r.get("salary")?,
            posted_at: r.get("posted_at")?,
            found_at: r.get("found_at")?,
            updated_at: r.get("updated_at")?,
            status: r.get("status")?,
            score: r.get("score")?,
            track: r.get("track")?,
            reasoning: r.get("reasoning")?,
            red_flags: all_flags.into_iter().filter(|f| !f.starts_with(crate::profile::PATH_FLAG)).collect(),
            keywords: list(r.get("keywords")?),
            coverage_before: r.get("coverage_before")?,
            coverage_after: r.get("coverage_after")?,
            keyword_gaps: list(r.get("keyword_gaps")?),
            cv_changes: list(r.get("cv_changes")?),
            cv_path: r.get("cv_path")?,
            letter_path: r.get("letter_path")?,
            cover_letter: r.get("cover_letter")?,
            email_subject: r.get("email_subject")?,
            applied_at: r.get("applied_at")?,
            notes: r.get("notes")?,
            closed_at: r.get("closed_at")?,
            deadline: r.get("deadline")?,
            apply_url: r.get("apply_url").ok().flatten(),
            score_after: r.get("score_after")?,
            score_potential: r.get("score_potential").ok().flatten(),
        })
    }

    /// The job without its long description, for lists.
    pub fn brief(&self) -> Value {
        let mut v = serde_json::to_value(self).unwrap_or_default();
        if let Some(o) = v.as_object_mut() {
            for k in ["description", "cover_letter", "cv_changes", "notes"] {
                o.remove(k);
            }
            // How you'd apply, and how long it takes (email, a quick form, an account…).
            o.insert("effort".into(), crate::fill::effort(self));
            // Full-time, contract (and for how long), part-time…, from the title and text.
            o.insert("employment".into(), json!(crate::sources::employment_type_cached(&self.id, &self.title, &self.description)));
        }
        v
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Event {
    pub id: i64,
    pub job_id: Option<String>,
    pub kind: String,
    pub detail: String,
    pub created_at: String,
    pub company: Option<String>,
    pub title: Option<String>,
    /// Who made the change: "you", "jobhunt", "claude"; empty on lines older than this was kept.
    pub by: String,
}

thread_local! {
    static ACTOR: std::cell::Cell<&'static str> = const { std::cell::Cell::new("") };
}

/// Who the history says did what this thread does next, until the returned value is dropped: "you"
/// while something you pressed is carried out, "claude" for what Claude asks for. Anything else
/// (searches, the email check, what runs by itself) is Job Hunt's.
pub fn acting(who: &'static str) -> Acting {
    Acting(ACTOR.with(|a| a.replace(who)))
}
pub struct Acting(&'static str);
impl Drop for Acting {
    fn drop(&mut self) {
        ACTOR.with(|a| a.set(self.0));
    }
}
pub fn actor() -> &'static str {
    let a = ACTOR.with(|a| a.get());
    if a.is_empty() { "jobhunt" } else { a }
}

#[derive(Serialize, Clone, Debug)]
pub struct EmailRow {
    pub gmail_id: String,
    pub thread_id: Option<String>,
    pub job_id: Option<String>,
    pub sender: Option<String>,
    pub subject: Option<String>,
    pub category: Option<String>,
    pub summary: Option<String>,
    pub draft_id: Option<String>,
    pub received_at: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
}

/// An email Job Hunt wrote, held until you approve it. `status`: waiting (only in Job Hunt), gmail
/// (approved: in your Gmail drafts), sent, discarded.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Held {
    pub id: String,
    /// follow-up, thank-you, decline, reply, recruiter.
    pub kind: String,
    pub job_id: Option<String>,
    pub to: String,
    pub subject: String,
    pub body: String,
    /// The Gmail message it answers (kept in that thread), when it's a reply.
    pub reply_to: Option<String>,
    /// Files that go with it (your tailored CV, to a recruiter).
    pub attach: Vec<String>,
    pub status: String,
    /// The Gmail draft (or sent message) it became.
    pub gmail_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// What it said before each change, oldest first: {at, subject, body, note}.
    pub versions: Vec<serde_json::Value>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CalEvent {
    pub event_id: String,
    pub job_id: Option<String>,
    pub kind: String,
    pub start: String,
    pub title: String,
    pub company: Option<String>,
    pub job_title: Option<String>,
}

pub struct Db {
    pub con: Connection,
    /// Changes that were only bookkeeping (when something last ran): see `changes`.
    quiet: std::sync::atomic::AtomicU64,
}

impl Db {
    pub fn open(path: &Path) -> R<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Db::init(Connection::open(path)?)
    }

    /// A second connection to the same file that only reads: for what the page asks for again and
    /// again (the Queue, a job), beside whatever the app's own connection is busy with. The file is
    /// in WAL mode, so it sees everything written up to the moment of each read.
    pub fn open_reader(path: &Path) -> R<Db> {
        let con = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        con.busy_timeout(std::time::Duration::from_secs(5))?;
        con.execute_batch("PRAGMA cache_size=-32000;")?;
        Ok(Db { con, quiet: Default::default() })
    }

    pub fn memory() -> R<Db> {
        Db::init(Connection::open_in_memory()?)
    }

    fn init(con: Connection) -> R<Db> {
        // synchronous=NORMAL: with WAL, a save no longer waits for the disk each time (it did, once
        // per row in some loops); a power cut can lose the last moments' saves but can't damage the
        // file. cache_size: 32 MB kept in memory, not the default 2 (the file is tens of MB).
        con.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32000;")?;
        con.execute_batch(SCHEMA)?;
        // Columns added after the first release.
        let has = |col: &str| -> R<bool> {
            let n: i64 = con.query_row("SELECT COUNT(*) FROM pragma_table_info('jobs') WHERE name = ?1", [col], |r| r.get(0))?;
            Ok(n > 0)
        };
        for (col, kind) in [("closed_at", "TEXT"), ("deadline", "TEXT"), ("score_after", "INTEGER"), ("dupe_key", "TEXT"), ("url_key", "TEXT"), ("apply_url", "TEXT"), ("score_potential", "INTEGER")] {
            if !has(col)? {
                con.execute_batch(&format!("ALTER TABLE jobs ADD COLUMN {col} {kind}"))?;
            }
        }
        con.execute_batch("CREATE INDEX IF NOT EXISTS jobs_dupe ON jobs(dupe_key); CREATE INDEX IF NOT EXISTS jobs_url ON jobs(url_key)")?;
        // Who made each change in the history: you, Job Hunt, or Claude. Older lines say who only
        // where what they say settles it (an email moved it, the site confirmed, Claude changed it).
        let by_there = con.prepare("SELECT 1 FROM pragma_table_info('events') WHERE name = 'by_whom'")?.exists([])?;
        if !by_there {
            con.execute_batch(
                "ALTER TABLE events ADD COLUMN by_whom TEXT NOT NULL DEFAULT '';
                 UPDATE events SET by_whom = 'jobhunt' WHERE kind LIKE 'status:%' AND (detail LIKE 'from email:%' OR detail LIKE '%confirmed by the site%' OR detail LIKE 'applied by email%');
                 UPDATE events SET by_whom = 'you' WHERE kind LIKE 'status:%' AND (detail LIKE '%(filled in by Job Hunt)%' OR detail = 'changed in Job Hunt' OR detail LIKE 'not interested (from your browser)%');
                 UPDATE events SET by_whom = 'claude' WHERE kind LIKE 'status:%' AND detail = 'changed from Claude';
                 UPDATE events SET by_whom = 'jobhunt' WHERE kind LIKE 'email:%' OR kind IN ('search', 'inbox', 'scored', 'rescored', 'check', 'backup', 'copies', 'weekly', 'care');",
            )?;
        }
        // What the Queue asks for every second or two (applications a week, the newest found, recent
        // errors) read the whole table without these: every row, long posting text included.
        con.execute_batch(
            "CREATE INDEX IF NOT EXISTS jobs_applied ON jobs(applied_at) WHERE applied_at IS NOT NULL;
             CREATE INDEX IF NOT EXISTS jobs_found ON jobs(found_at);
             CREATE INDEX IF NOT EXISTS events_created ON events(created_at);",
        )?;
        // Which sources listed which roles is only read for the last 90 days: older rows go.
        let old = (chrono::Utc::now() - chrono::Duration::days(120)).to_rfc3339();
        let _ = con.execute("DELETE FROM sightings WHERE last_at < ?1", [&old]);
        let no_url: Vec<(String, String)> = {
            let mut st = con.prepare("SELECT id, url FROM jobs WHERE url_key IS NULL")?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, url) in no_url {
            con.execute("UPDATE jobs SET url_key = ?1 WHERE id = ?2", params![url_key(&url), id])?;
        }
        // Fill the duplicate key in for postings stored before it existed.
        let missing: Vec<(String, String, String)> = {
            let mut st = con.prepare("SELECT id, company, title FROM jobs WHERE dupe_key IS NULL")?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, company, title) in missing {
            con.execute("UPDATE jobs SET dupe_key = ?1 WHERE id = ?2", params![dupe_key(&company, &title), id])?;
        }
        Ok(Db { con, quiet: Default::default() })
    }

    // --- jobs ----------------------------------------------------------------------------

    /// True if this posting, or the same role at the same company from another source, is known.
    /// The stored job that is this posting: the same id, or the same role at the same company,
    /// unless the two links name different requisitions on the employer's site (two openings).
    pub fn existing_job_at(&self, id: &str, company: &str, title: &str, links: &[&str]) -> Option<String> {
        let mut st = self.con.prepare("SELECT id, url, apply_url FROM jobs WHERE id = ?1 OR dupe_key = ?2").ok()?;
        let rows: Vec<(String, String, Option<String>)> = st.query_map(params![id, dupe_key(company, title)], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).ok()?.filter_map(Result::ok).collect();
        if let Some(r) = rows.iter().find(|r| r.0 == id) {
            return Some(r.0.clone());
        }
        rows.into_iter().find(|r| !different_requisitions(links, &[r.1.as_str(), r.2.as_deref().unwrap_or("")])).map(|r| r.0)
    }

    /// job_exists, telling apart two openings with the same title by their requisition numbers.
    /// A posting removed earlier (only its id and role are kept) matches by role only when this
    /// one names no requisition.
    pub fn job_exists_at(&self, id: &str, company: &str, title: &str, links: &[&str]) -> R<bool> {
        if self.existing_job_at(id, company, title, links).is_some() {
            return Ok(true);
        }
        let has_req = links.iter().any(|l| requisition(l).is_some());
        let n: i64 = self.con.query_row("SELECT COUNT(*) FROM purged WHERE id = ?1 OR (?3 = 0 AND dupe_key = ?2)", params![id, dupe_key(company, title), has_req as i64], |r| r.get(0))?;
        Ok(n > 0)
    }

    pub fn job_exists(&self, id: &str, company: &str, title: &str) -> R<bool> {
        let n: i64 = self.con.query_row(
            "SELECT (SELECT COUNT(*) FROM jobs WHERE id = ?1 OR dupe_key = ?2) + (SELECT COUNT(*) FROM purged WHERE id = ?1 OR dupe_key = ?2)",
            params![id, dupe_key(company, title)],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    /// The stored job that is this posting (same id, or the same role at the same company).
    pub fn existing_job(&self, id: &str, company: &str, title: &str) -> Option<String> {
        self.con.query_row("SELECT id FROM jobs WHERE id = ?1 OR dupe_key = ?2 LIMIT 1", params![id, dupe_key(company, title)], |r| r.get(0)).optional().ok().flatten()
    }

    /// Remove postings you never acted on that haven't changed in `days` days: skipped (filtered
    /// out or scored low), not interested, and closed ones still waiting to be tailored. Never
    /// anything tailored, saved or applied to. Each is remembered so it isn't found again as new.
    /// Whether a posting with this link is stored already (the same job from another source, or
    /// under another title or company name).
    pub fn url_exists(&self, url: &str) -> R<bool> {
        let k = url_key(url);
        if k.is_empty() {
            return Ok(false);
        }
        Ok(self.con.query_row("SELECT COUNT(*) FROM jobs WHERE url_key = ?1", [&k], |r| r.get::<_, i64>(0))? > 0)
    }

    /// A posting already known by company and title (or link) seen again as another listing:
    /// remembered as a repost when the role was first found weeks before, or the new listing is
    /// dated well after that.
    pub fn record_repost(&self, posting_id: &str, company: &str, title: &str, url: &str, posted: Option<chrono::DateTime<chrono::Utc>>) -> R<()> {
        // Two lookups, each by its own index, and the earlier of the two.
        let by = |sql: &str, key: &str| -> R<Option<(String, String)>> {
            Ok(self.con.query_row(sql, params![posting_id, key], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
        };
        let link = url_key(url);
        let mut found = by(REPOST_BY_ROLE, &dupe_key(company, title))?;
        if !link.is_empty() {
            if let Some(b) = by(REPOST_BY_LINK, &link)? {
                if found.as_ref().is_none_or(|a| b.1 < a.1) {
                    found = Some(b);
                }
            }
        }
        let Some((job, found_at)) = found else { return Ok(()) };
        let Ok(first) = chrono::DateTime::parse_from_rfc3339(&found_at).map(|t| t.with_timezone(&chrono::Utc)) else { return Ok(()) };
        let now = chrono::Utc::now();
        // Only a listing dated well after the role was first found: an undated copy may simply be
        // the same posting on another site, seen again on every search.
        let again = posted.is_some_and(|p| p > first + chrono::Duration::days(14) && p <= now + chrono::Duration::days(1));
        if again {
            self.con.execute("INSERT OR IGNORE INTO reposts (job_id, posting_id, seen_at) VALUES (?1, ?2, ?3)", params![job, posting_id, now.to_rfc3339()])?;
        }
        Ok(())
    }

    /// Note that each of these sources listed these roles (source, company, title), today.
    pub fn record_sightings(&self, seen: &[(String, String, String)]) -> R<()> {
        let at = now();
        let tx = self.con.unchecked_transaction()?;
        for (source, company, title) in seen {
            tx.execute(
                "INSERT INTO sightings (dupe_key, source, first_at, last_at) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT (dupe_key, source) DO UPDATE SET last_at = ?3",
                params![dupe_key(company, title), source, at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Per source, over the last `days`: how many roles it listed, how many no other source did,
    /// and how many of its roles each other source also listed. Biggest first.
    pub fn source_overlap(&self, days: i64) -> R<Vec<Value>> {
        use std::collections::{BTreeMap, BTreeSet};
        let since = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let mut by_role: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        {
            let mut st = self.con.prepare("SELECT dupe_key, source FROM sightings WHERE last_at >= ?1")?;
            let rows = st.query_map([&since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for r in rows {
                let (k, s) = r?;
                by_role.entry(k).or_default().insert(s);
            }
        }
        let mut per: BTreeMap<String, (u64, u64, BTreeMap<String, u64>)> = BTreeMap::new();
        for sources in by_role.values() {
            for s in sources {
                let e = per.entry(s.clone()).or_default();
                e.0 += 1;
                if sources.len() == 1 {
                    e.1 += 1;
                }
                for o in sources.iter().filter(|o| *o != s) {
                    *e.2.entry(o.clone()).or_default() += 1;
                }
            }
        }
        let mut out: Vec<Value> = per.into_iter().map(|(source, (roles, only, also))| {
            let mut also: Vec<(String, u64)> = also.into_iter().collect();
            also.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
            json!({ "source": source, "roles": roles, "only": only, "also": also.into_iter().map(|(s, n)| json!({ "source": s, "roles": n })).collect::<Vec<_>>() })
        }).collect();
        out.sort_by_key(|v| std::cmp::Reverse(v["roles"].as_u64().unwrap_or(0)));
        Ok(out)
    }

    pub fn add_link(&self, token: &str, job_id: &str, target: &str) -> R<()> {
        self.con.execute("INSERT OR REPLACE INTO links (token, job_id, target, created_at) VALUES (?1, ?2, ?3, ?4)", params![token, job_id, target, now()])?;
        Ok(())
    }

    pub fn link_target(&self, token: &str) -> R<Option<String>> {
        Ok(self.con.query_row("SELECT target FROM links WHERE token = ?1", [token], |r| r.get(0)).optional()?)
    }

    pub fn add_click(&self, token: &str, bot: bool) -> R<()> {
        self.con.execute("INSERT INTO clicks (token, at, bot) VALUES (?1, ?2, ?3)", params![token, now(), bot as i64])?;
        Ok(())
    }

    /// An application's links, one per address (its latest files' links and any earlier ones):
    /// {target, opened (by people), previews (by link checkers), last}.
    pub fn links(&self, job_id: &str) -> R<Vec<Value>> {
        let mut st = self.con.prepare(
            "SELECT l.target, COALESCE(SUM(c.bot = 0), 0), COALESCE(SUM(c.bot = 1), 0), MAX(CASE WHEN c.bot = 0 THEN c.at END)
             FROM links l LEFT JOIN clicks c ON c.token = l.token WHERE l.job_id = ?1 GROUP BY l.target ORDER BY MIN(l.created_at)",
        )?;
        let rows = st.query_map([job_id], |r| Ok(json!({ "target": r.get::<_, String>(0)?, "opened": r.get::<_, i64>(1)?, "previews": r.get::<_, i64>(2)?, "last": r.get::<_, Option<String>>(3)? })))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Another listing of a job that's stored: kept (up to eight a job) to compare with it. Not for
    /// jobs set aside, nor a listing with the job's own link (the same page from another source).
    /// True when it's one not seen before.
    pub fn copy_put(&self, job_id: &str, p: &crate::sources::Posting) -> R<bool> {
        let pid = p.id();
        if pid == job_id {
            return Ok(false);
        }
        let at = now();
        let known: Option<String> = self.con.query_row("SELECT last_at FROM copies WHERE job_id = ?1 AND posting_id = ?2", params![job_id, pid], |r| r.get(0)).optional()?;
        if let Some(last) = known {
            // Still listed: noted once a day, not on every search.
            if last.get(..10) != at.get(..10) {
                self.con.execute("UPDATE copies SET last_at = ?3 WHERE job_id = ?1 AND posting_id = ?2", params![job_id, pid, at])?;
            }
            return Ok(false);
        }
        let Some((status, url)) = self.con.query_row("SELECT status, url FROM jobs WHERE id = ?1", [job_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).optional()? else { return Ok(false) };
        let link = url_key(&p.url);
        if ["skipped", "dismissed"].contains(&status.as_str()) || (!link.is_empty() && link == url_key(&url)) {
            return Ok(false);
        }
        let others = self.copies_of(job_id)?;
        if others.len() >= 8 || (!link.is_empty() && others.iter().any(|c| url_key(&c.2.url) == link)) {
            return Ok(false);
        }
        let mut kept = p.clone();
        if kept.description.chars().count() > 12000 {
            kept.description = kept.description.chars().take(12000).collect();
        }
        self.con.execute("INSERT INTO copies (job_id, posting_id, first_at, last_at, data) VALUES (?1, ?2, ?3, ?3, ?4)", params![job_id, pid, at, serde_json::to_string(&kept).unwrap_or_default()])?;
        Ok(true)
    }

    /// A job's other listings, in the order they were found: (first seen, last seen, the listing).
    pub fn copies_of(&self, job_id: &str) -> R<Vec<(String, String, crate::sources::Posting)>> {
        let mut st = self.con.prepare("SELECT first_at, last_at, data FROM copies WHERE job_id = ?1 ORDER BY first_at, posting_id")?;
        let rows = st.query_map([job_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|(a, b, d)| Some((a, b, serde_json::from_str(&d).ok()?))).collect())
    }

    /// How many other listings each job has.
    pub fn copy_counts(&self) -> R<std::collections::HashMap<String, i64>> {
        let mut st = self.con.prepare("SELECT job_id, COUNT(*) FROM copies GROUP BY job_id")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// How many times each role was posted again.
    pub fn reposts(&self) -> R<std::collections::HashMap<String, i64>> {
        let mut st = self.con.prepare("SELECT job_id, COUNT(*) FROM reposts GROUP BY job_id")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Drop the long text of postings the filters left out more than `days` days ago and that you
    /// never touched: not tailored, not applied to, no letter, no notes, not chosen by you. The
    /// title, company, link and reason stay. Anything you applied to or prepared keeps its text.
    /// Returns how many were trimmed.
    pub fn trim_filtered_text(&self, days: i64) -> R<usize> {
        let before = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        Ok(self.con.execute(
            "UPDATE jobs SET description = '' WHERE status = 'skipped' AND reasoning LIKE 'Filtered out:%' AND description != '' AND updated_at < ?1
               AND cv_path IS NULL AND letter_path IS NULL AND cover_letter IS NULL AND applied_at IS NULL AND notes = ''
               AND id NOT IN (SELECT job_id FROM events WHERE job_id IS NOT NULL AND kind IN ('chosen', 'tailored', 'applied', 'restored'))",
            params![before])?)
    }

    /// Give the space freed by deleted and trimmed postings back to the disk.
    pub fn compact(&self) -> R<()> {
        Ok(self.con.execute_batch("VACUUM")?)
    }

    pub fn purge_older_than(&self, days: u32) -> R<usize> {
        if days == 0 {
            return Ok(0);
        }
        let before = (chrono::Utc::now() - chrono::Duration::days(days as i64)).to_rfc3339();
        let pick = "FROM jobs WHERE updated_at < ?1 AND (status IN ('skipped', 'dismissed') OR (status = 'queued' AND closed_at IS NOT NULL))";
        self.con.execute(&format!("INSERT OR IGNORE INTO purged (id, dupe_key, purged_at) SELECT id, COALESCE(dupe_key, ''), ?2 {pick}"), params![before, now()])?;
        self.con.execute(&format!("DELETE FROM events WHERE job_id IN (SELECT id {pick})"), params![before])?;
        Ok(self.con.execute(&format!("DELETE {pick}"), params![before])?)
    }

    /// Matches left waiting to be picked for `days` days are set aside as not interested (unless
    /// the posting says it's still open past today), so the list holds what's current. Returns how many.
    pub fn archive_unpicked(&self, days: i64) -> R<usize> {
        let before = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let ids: Vec<String> = {
            let mut st = self.con.prepare("SELECT id FROM jobs WHERE status = 'queued' AND found_at < ?1 AND (deadline IS NULL OR deadline = '' OR deadline < ?2)")?;
            let rows = st.query_map(params![before, today], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for id in &ids {
            self.set_status(id, "dismissed", &format!("set aside: not picked in {days} days"))?;
        }
        Ok(ids.len())
    }

    /// The id and reasoning of skipped postings that were filtered out before scoring.
    pub fn filtered_out(&self, id: &str, company: &str, title: &str) -> R<Option<String>> {
        Ok(self.con.query_row(
            "SELECT id FROM jobs WHERE (id = ?1 OR dupe_key = ?2)
             AND status = 'skipped' AND score IS NULL AND reasoning LIKE 'Filtered out:%' LIMIT 1",
            params![id, dupe_key(company, title)],
            |r| r.get(0),
        ).optional()?)
    }

    /// Remove copies of the same role found more than once (another source, another company
    /// name for the same employer). The copy furthest along is kept; only copies waiting to be
    /// tailored or skipped are removed, never one you've worked on. Returns how many went.
    pub fn merge_duplicates(&self) -> R<usize> {
        let rows: Vec<(String, String, String, String)> = {
            let mut st = self.con.prepare(
                "SELECT dupe_key, id, status, url FROM jobs WHERE dupe_key IN (SELECT dupe_key FROM jobs GROUP BY dupe_key HAVING COUNT(*) > 1)
                 UNION ALL
                 SELECT 'url:' || url_key, id, status, url FROM jobs WHERE url_key != '' AND url_key IN (SELECT url_key FROM jobs WHERE url_key != '' GROUP BY url_key HAVING COUNT(*) > 1)
                 ORDER BY 1",
            )?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        // Furthest along first; between equals, the copy on the company's own site.
        let rank = |s: &str| ["offer", "interviewing", "applied", "rejected", "no_response", "approved", "ready", "saved", "dismissed", "queued", "skipped"].iter().position(|x| *x == s).unwrap_or(9);
        let mut n = 0;
        for group in rows.chunk_by(|a, b| a.0 == b.0) {
            let mut g: Vec<&(String, String, String, String)> = group.iter().collect();
            g.sort_by_key(|r| (rank(&r.2), crate::sources::is_job_board(&r.3)));
            for r in &g[1..] {
                // Two openings the search keeps apart (same title, different requisition numbers)
                // aren't copies: merged here, the next search found and scored the other again.
                if different_requisitions(&[&g[0].3, &g[0].1], &[&r.3, &r.1]) {
                    continue;
                }
                if r.2 == "queued" || r.2 == "skipped" {
                    // The kept copy came from a job board: apply on the company's site instead.
                    self.prefer_company_link(&g[0].1, &r.3)?;
                    // What the copy said stays, to compare with the one kept.
                    if let (Some(j), Some((source, ext))) = (self.job(&r.1)?, r.1.split_once(':')) {
                        self.copy_put(&g[0].1, &crate::sources::Posting { source: source.into(), external_id: ext.into(), company: j.company, title: j.title, location: j.location,
                            url: j.url, description: j.description, posted_at: j.posted_at, salary: j.salary, apply_url: j.apply_url, ..Default::default() })?;
                    }
                    self.con.execute("DELETE FROM jobs WHERE id = ?1", [&r.1])?;
                    n += 1;
                }
            }
        }
        Ok(n)
    }

    /// The same role seen on the company's own site while the stored copy came from a job board:
    /// the company's link becomes where you apply. Never the other way round. True if it changed.
    pub fn prefer_company_link(&self, id: &str, url: &str) -> R<bool> {
        if url.trim().is_empty() || crate::sources::is_job_board(url) {
            return Ok(false);
        }
        // Only over a job board's copy: two company links (a careers page and its ATS) stay as found.
        let stored: Option<String> = self.con.query_row("SELECT url FROM jobs WHERE id = ?1 AND apply_url IS NULL", [id], |r| r.get(0)).optional()?;
        if !stored.is_some_and(|u| crate::sources::is_job_board(&u)) {
            return Ok(false);
        }
        Ok(self.con.execute("UPDATE jobs SET apply_url = ?2 WHERE id = ?1", params![id, url.trim()])? > 0)
    }

    pub fn delete_job(&self, id: &str) -> R<()> {
        self.con.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        self.con.execute("DELETE FROM recruiter_jobs WHERE job_id = ?1", [id])?;
        self.con.execute("DELETE FROM copies WHERE job_id = ?1", [id])?;
        Ok(())
    }

    /// insert_job for many at once, written together (one write to the disk, not one each).
    pub fn insert_jobs(&self, jobs: &[Job]) -> R<()> {
        if jobs.is_empty() {
            return Ok(());
        }
        let tx = self.con.unchecked_transaction()?;
        for j in jobs {
            self.insert_job(j)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn insert_job(&self, j: &Job) -> R<()> {
        let stamp = now();
        self.con.execute(
            "INSERT OR IGNORE INTO jobs (id, source, company, title, location, url, apply_email, description, salary,
                posted_at, found_at, updated_at, status, score, track, reasoning, red_flags, keywords, deadline, dupe_key, url_key, apply_url, score_potential)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                j.id, j.source, j.company, j.title, j.location, j.url, j.apply_email, j.description, j.salary,
                j.posted_at, stamp, j.status, j.score, j.track, j.reasoning,
                serde_json::to_string(&j.flags_to_store(j.red_flags.clone()))?, serde_json::to_string(&j.keywords)?, j.deadline, dupe_key(&j.company, &j.title), url_key(&j.url), j.apply_url, j.score_potential
            ],
        )?;
        Ok(())
    }

    /// Give a job's company its proper name (and the key that groups it with the same role elsewhere).
    /// Work out every job's dupe_key again (the way it's made changed). Returns how many changed.
    pub fn rekey_jobs(&self) -> R<usize> {
        let rows: Vec<(String, String, String, String)> = {
            let mut st = self.con.prepare("SELECT id, company, title, COALESCE(dupe_key, '') FROM jobs")?;
            let r = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.filter_map(|x| x.ok()).collect();
            r
        };
        let mut n = 0;
        for (id, company, title, old) in rows {
            let new = dupe_key(&company, &title);
            if new != old {
                self.con.execute("UPDATE jobs SET dupe_key = ?2 WHERE id = ?1", params![id, new])?;
                n += 1;
            }
        }
        Ok(n)
    }

    pub fn rename_company(&self, id: &str, title: &str, company: &str) -> R<()> {
        self.con.execute("UPDATE jobs SET company = ?2, dupe_key = ?3 WHERE id = ?1", params![id, company, dupe_key(company, title)])?;
        Ok(())
    }

    /// Update named columns. Values that are arrays or objects are stored as JSON text.
    #[cfg(test)]
    pub fn backdate(&self, id: &str, found_at: &str) -> R<()> {
        self.con.execute("UPDATE jobs SET found_at = ?2 WHERE id = ?1", params![id, found_at])?;
        Ok(())
    }

    /// Change a job. A change of stage is written in its history, with why as far as the change
    /// itself tells (set_status writes its own line, with the reason it's given).
    pub fn update_job(&self, id: &str, fields: &[(&str, Value)]) -> R<()> {
        let to = fields.iter().find(|f| f.0 == "status").and_then(|f| f.1.as_str());
        let from = match to {
            Some(_) => self.con.query_row("SELECT status FROM jobs WHERE id = ?1", [id], |r| r.get::<_, String>(0)).optional().ok().flatten(),
            None => None,
        };
        self.update_job_quiet(id, fields)?;
        if let (Some(to), Some(from)) = (to, from) {
            if to != from {
                let has = |k: &str| fields.iter().find(|f| f.0 == k).map(|f| &f.1);
                let why = if let Some(n) = has("score").and_then(|v| v.as_i64()) {
                    format!("scored {n}")
                } else if let Some(r) = has("reasoning").and_then(|v| v.as_str()).filter(|r| r.starts_with("Filtered out") || r.starts_with("Scored ")) {
                    r.chars().take(200).collect()
                } else if has("closed_at").is_some() {
                    "the posting has closed".to_string()
                } else if to == "ready" {
                    "CV and letter written".to_string()
                } else {
                    String::new()
                };
                self.log(Some(id), &format!("status:{to}"), &why)?;
            }
        }
        Ok(())
    }

    fn update_job_quiet(&self, id: &str, fields: &[(&str, Value)]) -> R<()> {
        // Every change of stage passes here: the lifecycle sees it (and, for now, only notes a
        // move it doesn't expect).
        if let Some(to) = fields.iter().find(|f| f.0 == "status").and_then(|f| f.1.as_str()) {
            if let Ok(Some(from)) = self.con.query_row("SELECT status FROM jobs WHERE id = ?1", [id], |r| r.get::<_, String>(0)).optional() {
                crate::lifecycle::watch(id, &from, to);
            }
        }
        const ALLOWED: [&str; 23] = [
            "status", "score", "track", "reasoning", "red_flags", "keywords", "coverage_before", "coverage_after",
            "keyword_gaps", "cv_changes", "cv_path", "letter_path", "cover_letter", "email_subject", "applied_at",
            "notes", "apply_email", "closed_at", "deadline", "score_after", "apply_url", "salary", "score_potential",
        ];
        let mut sets = vec![];
        let mut vals: Vec<rusqlite::types::Value> = vec![];
        for (k, v) in fields {
            if !ALLOWED.contains(k) {
                return err(format!("unknown job field {k}"));
            }
            sets.push(format!("{k} = ?"));
            vals.push(match v {
                Value::Null => rusqlite::types::Value::Null,
                Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
                Value::Number(n) if n.is_i64() => rusqlite::types::Value::Integer(n.as_i64().unwrap()),
                Value::Number(n) => rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)),
                Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                other => rusqlite::types::Value::Text(other.to_string()),
            });
        }
        sets.push("updated_at = ?".into());
        vals.push(rusqlite::types::Value::Text(now()));
        vals.push(rusqlite::types::Value::Text(id.to_string()));
        let sql = format!("UPDATE jobs SET {} WHERE id = ?", sets.join(", "));
        self.con.execute(&sql, rusqlite::params_from_iter(vals))?;
        Ok(())
    }

    pub fn set_status(&self, id: &str, status: &str, detail: &str) -> R<()> {
        if !STATUSES.contains(&status) {
            return err(format!("unknown status {status}"));
        }
        let mut f = vec![("status", Value::from(status))];
        if status == "applied" {
            f.push(("applied_at", Value::from(now())));
        }
        self.update_job_quiet(id, &f)?;
        self.log(Some(id), &format!("status:{status}"), detail)
    }

    pub fn job(&self, id: &str) -> R<Option<Job>> {
        Ok(self.con.query_row("SELECT * FROM jobs WHERE id = ?1", [id], Job::from_row).optional()?)
    }

    /// Every job's saved files: (id, cv_path, letter_path), without the rest of the job.
    pub fn file_paths(&self) -> R<Vec<(String, Option<String>, Option<String>)>> {
        let mut st = self.con.prepare("SELECT id, cv_path, letter_path FROM jobs WHERE cv_path IS NOT NULL OR letter_path IS NOT NULL")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// When each posting found went up, for those whose source said (newest 5,000).
    pub fn posted_stamps(&self) -> R<Vec<String>> {
        let mut q = self.con.prepare("SELECT posted_at FROM jobs WHERE posted_at LIKE '%T%' ORDER BY found_at DESC LIMIT 5000")?;
        let rows = q.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn jobs(&self, status: Option<&str>, limit: usize) -> R<Vec<Job>> {
        let mut out = vec![];
        if let Some(s) = status {
            let mut st = self.con.prepare(
                "SELECT * FROM jobs WHERE status = ?1 ORDER BY score DESC, found_at DESC LIMIT ?2",
            )?;
            for j in st.query_map(params![s, limit as i64], Job::from_row)? {
                out.push(j?);
            }
        } else {
            let mut st = self.con.prepare("SELECT * FROM jobs ORDER BY found_at DESC LIMIT ?1")?;
            for j in st.query_map([limit as i64], Job::from_row)? {
                out.push(j?);
            }
        }
        Ok(out)
    }

    /// Jobs an incoming email could be about: (id, title, company, status).
    pub fn active_applications(&self) -> R<Vec<(String, String, String, String)>> {
        let mut st = self.con.prepare(
            "SELECT id, title, company, status FROM jobs
             WHERE status IN ('approved', 'applied', 'interviewing', 'offer') ORDER BY updated_at DESC",
        )?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn counts(&self) -> R<serde_json::Map<String, Value>> {
        let mut out = serde_json::Map::new();
        for s in STATUSES {
            out.insert(s.into(), Value::from(0));
        }
        let mut st = self.con.prepare("SELECT status, COUNT(*) FROM jobs GROUP BY status")?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (s, n) = row?;
            out.insert(s, Value::from(n));
        }
        Ok(out)
    }

    // --- history ---------------------------------------------------------------------------

    pub fn log(&self, job_id: Option<&str>, kind: &str, detail: &str) -> R<()> {
        if kind.contains("error") {
            crate::debug::always("event", &format!("{kind}{}: {detail}", job_id.map(|j| format!(" ({j})")).unwrap_or_default()));
        } else {
            crate::debug::note("event", &format!("{kind}{}: {detail}", job_id.map(|j| format!(" ({j})")).unwrap_or_default()));
        }
        if let Some(j) = job_id {
            crate::lifecycle::failed(j, kind, detail);
        }
        self.con.execute(
            "INSERT INTO events (job_id, kind, detail, created_at, by_whom) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![job_id, kind, detail, now(), actor()],
        )?;
        Ok(())
    }

    fn events_where(&self, clause: &str, p: &[&dyn rusqlite::ToSql]) -> R<Vec<Event>> {
        let sql = format!(
            "SELECT e.id, e.job_id, e.kind, e.detail, e.created_at, j.company, j.title, e.by_whom
             FROM events e LEFT JOIN jobs j ON j.id = e.job_id {clause}"
        );
        let mut st = self.con.prepare(&sql)?;
        let rows = st.query_map(p, |r| {
            Ok(Event {
                id: r.get(0)?,
                job_id: r.get(1)?,
                kind: r.get(2)?,
                detail: r.get(3)?,
                created_at: r.get(4)?,
                company: r.get(5)?,
                title: r.get(6)?,
                by: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn history(&self, job_id: &str) -> R<Vec<Event>> {
        self.events_where("WHERE e.job_id = ?1 ORDER BY e.id DESC", &[&job_id])
    }

    /// Problems logged since a time, newest first.
    pub fn errors_since(&self, since: &str) -> R<Vec<Event>> {
        self.events_where("WHERE e.kind LIKE '%:error' AND e.created_at >= ?1 ORDER BY e.id DESC LIMIT 50", &[&since])
    }

    /// The newest events of one kind.
    pub fn events_of_kind(&self, kind: &str, limit: usize) -> R<Vec<Event>> {
        self.events_where("WHERE e.kind = ?1 ORDER BY e.id DESC LIMIT ?2", &[&kind, &(limit as i64)])
    }

    pub fn recent_events(&self, limit: usize) -> R<Vec<Event>> {
        self.events_where("ORDER BY e.id DESC LIMIT ?1", &[&(limit as i64)])
    }

    /// Applications sent per week for the last `weeks` weeks, oldest first, as (week start date, count).
    /// Applications sent per week (Monday to Sunday where you are), oldest first.
    pub fn applied_per_week(&self, weeks: i64, today: chrono::NaiveDate, tz: chrono_tz::Tz) -> R<Vec<(String, i64)>> {
        use chrono::Datelike;
        let monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
        let first = monday - chrono::Duration::weeks(weeks - 1);
        let mut buckets: Vec<(chrono::NaiveDate, i64)> =
            (0..weeks).map(|i| (first + chrono::Duration::weeks(i), 0)).collect();
        let mut st = self.con.prepare("SELECT applied_at FROM jobs WHERE applied_at IS NOT NULL")?;
        for row in st.query_map([], |r| r.get::<_, String>(0))? {
            let Ok(t) = chrono::DateTime::parse_from_rfc3339(&row?) else { continue };
            let d = t.with_timezone(&tz).date_naive();
            if d < first {
                continue;
            }
            let i = ((d - first).num_days() / 7) as usize;
            if let Some(b) = buckets.get_mut(i) {
                b.1 += 1;
            }
        }
        Ok(buckets.into_iter().map(|(d, n)| (d.to_string(), n)).collect())
    }

    // --- emails -------------------------------------------------------------------------------

    /// Is this thread one Job Hunt already linked to an application?
    pub fn thread_linked(&self, thread_id: &str) -> R<bool> {
        let n: i64 = self.con.query_row("SELECT COUNT(*) FROM emails WHERE thread_id = ?1 AND job_id IS NOT NULL", [thread_id], |r| r.get(0))?;
        Ok(n > 0)
    }

    pub fn held_put(&self, h: &Held) -> R<()> {
        self.con.execute("INSERT OR REPLACE INTO held_drafts (id, status, job_id, updated_at, data) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![h.id, h.status, h.job_id, h.updated_at, serde_json::to_string(h).unwrap_or_default()])?;
        Ok(())
    }

    pub fn held(&self, id: &str) -> R<Option<Held>> {
        Ok(self.con.query_row("SELECT data FROM held_drafts WHERE id = ?1", params![id], |r| r.get::<_, String>(0)).optional()?
            .and_then(|d| serde_json::from_str(&d).ok()))
    }

    /// Held emails of one status, newest first.
    pub fn held_with(&self, status: &str) -> R<Vec<Held>> {
        let mut st = self.con.prepare("SELECT data FROM held_drafts WHERE status = ?1 ORDER BY updated_at DESC")?;
        let rows = st.query_map(params![status], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|d| d.ok()).filter_map(|d| serde_json::from_str(&d).ok()).collect())
    }

    /// Every held email about one job, whatever became of it, oldest first.
    pub fn held_of_job(&self, job_id: &str) -> R<Vec<Held>> {
        let mut st = self.con.prepare("SELECT data FROM held_drafts WHERE job_id = ?1 ORDER BY updated_at")?;
        let rows = st.query_map(params![job_id], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|d| d.ok()).filter_map(|d| serde_json::from_str(&d).ok()).collect())
    }

    /// What happened to one job, oldest first.
    pub fn events_of_job(&self, job_id: &str) -> R<Vec<Event>> {
        self.events_where("WHERE e.job_id = ?1 ORDER BY e.id LIMIT 400", &[&job_id])
    }

    /// The emails kept about one job, oldest first.
    pub fn emails_of_job(&self, job_id: &str) -> R<Vec<EmailRow>> {
        Ok(self.emails(5000)?.into_iter().filter(|e| e.job_id.as_deref() == Some(job_id)).rev().collect())
    }

    /// The draft reply now waiting for an email already kept.
    pub fn set_email_draft(&self, gmail_id: &str, draft_id: &str) -> R<()> {
        self.con.execute("UPDATE emails SET draft_id = ?2 WHERE gmail_id = ?1", params![gmail_id, draft_id])?;
        Ok(())
    }

    /// Say which application an email already kept is about.
    pub fn set_email_job(&self, gmail_id: &str, job_id: &str) -> R<()> {
        self.con.execute("UPDATE emails SET job_id = ?2 WHERE gmail_id = ?1", params![gmail_id, job_id])?;
        Ok(())
    }

    pub fn email_seen(&self, gmail_id: &str) -> R<bool> {
        let n: i64 = self.con.query_row("SELECT COUNT(*) FROM emails WHERE gmail_id = ?1", [gmail_id], |r| r.get(0))?;
        Ok(n > 0)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_email(
        &self,
        gmail_id: &str,
        thread_id: &str,
        job_id: Option<&str>,
        sender: &str,
        subject: &str,
        category: &str,
        summary: &str,
        draft_id: Option<&str>,
        received_at: &str,
    ) -> R<()> {
        self.con.execute(
            "INSERT OR REPLACE INTO emails (gmail_id, thread_id, job_id, sender, subject, category, summary, draft_id, received_at, processed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![gmail_id, thread_id, job_id, sender, subject, category, summary, draft_id, received_at, now()],
        )?;
        Ok(())
    }

    pub fn emails(&self, limit: usize) -> R<Vec<EmailRow>> {
        let mut st = self.con.prepare(
            "SELECT m.gmail_id, m.thread_id, m.job_id, m.sender, m.subject, m.category, m.summary, m.draft_id, m.received_at, j.company, j.title
             FROM emails m LEFT JOIN jobs j ON j.id = m.job_id
             WHERE m.category != 'not_job' ORDER BY m.received_at DESC LIMIT ?1",
        )?;
        let rows = st.query_map([limit as i64], |r| {
            Ok(EmailRow {
                gmail_id: r.get(0)?,
                thread_id: r.get(1)?,
                job_id: r.get(2)?,
                sender: r.get(3)?,
                subject: r.get(4)?,
                category: r.get(5)?,
                summary: r.get(6)?,
                draft_id: r.get(7)?,
                received_at: r.get(8)?,
                company: r.get(9)?,
                title: r.get(10)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Emails about each job, as (job id, category, sender, received at), oldest first.
    // --- recruiters -----------------------------------------------------------------------------

    /// Every recruiter, as stored (roles, gmail_ids and asked as JSON).
    pub fn recruiter_rows(&self) -> R<Vec<Value>> {
        let mut st = self.con.prepare("SELECT email, name, company, kind, roles, stage, first_at, last_at, emails, gmail_ids, asked, hidden, phone, linkedin, notes FROM recruiters")?;
        let rows = st.query_map([], |r| {
            let j = |i: usize| -> rusqlite::Result<Value> { Ok(serde_json::from_str(&r.get::<_, String>(i)?).unwrap_or(Value::Array(vec![]))) };
            Ok(serde_json::json!({ "email": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "company": r.get::<_, String>(2)?, "kind": r.get::<_, String>(3)?,
                "roles": j(4)?, "stage": r.get::<_, String>(5)?, "first_at": r.get::<_, String>(6)?, "last_at": r.get::<_, String>(7)?, "emails": r.get::<_, i64>(8)?,
                "gmail_ids": j(9)?, "asked": j(10)?, "hidden": r.get::<_, i64>(11)? != 0, "phone": r.get::<_, String>(12)?, "linkedin": r.get::<_, String>(13)?, "notes": r.get::<_, String>(14)? }))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Add or replace one recruiter (from the same fields recruiter_rows gives).
    pub fn put_recruiter(&self, r: &Value) -> R<()> {
        let s = |k: &str| r[k].as_str().unwrap_or("").to_string();
        let j = |k: &str| r[k].as_array().map(|a| Value::Array(a.clone()).to_string()).unwrap_or_else(|| "[]".into());
        self.con.execute(
            "INSERT INTO recruiters (email, name, company, kind, roles, stage, first_at, last_at, emails, gmail_ids, asked, hidden, phone, linkedin, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(email) DO UPDATE SET name = excluded.name, company = excluded.company, kind = excluded.kind, roles = excluded.roles,
                stage = excluded.stage, first_at = excluded.first_at, last_at = excluded.last_at, emails = excluded.emails, gmail_ids = excluded.gmail_ids,
                asked = excluded.asked, hidden = excluded.hidden, phone = excluded.phone, linkedin = excluded.linkedin, notes = excluded.notes",
            params![s("email").to_lowercase(), s("name"), s("company"), s("kind"), j("roles"), s("stage"), s("first_at"), s("last_at"), r["emails"].as_i64().unwrap_or(0),
                j("gmail_ids"), j("asked"), r["hidden"].as_bool().unwrap_or(false) as i64, s("phone"), s("linkedin"), s("notes")],
        )?;
        Ok(())
    }

    /// Note that a recruiter emailed about one of your applications (counted once per email).
    pub fn link_recruiter(&self, email: &str, job_id: &str, stage: &str, at: &str, subject: &str) -> R<()> {
        self.con.execute(
            "INSERT INTO recruiter_jobs (email, job_id, stage, first_at, last_at, emails, last_subject) VALUES (?1, ?2, ?3, ?4, ?4, 1, ?5)
             ON CONFLICT(email, job_id) DO UPDATE SET emails = emails + 1,
                first_at = MIN(first_at, excluded.first_at), last_at = MAX(last_at, excluded.last_at),
                last_subject = CASE WHEN excluded.last_at >= last_at THEN excluded.last_subject ELSE last_subject END,
                stage = CASE WHEN excluded.stage <> '' THEN excluded.stage ELSE stage END",
            params![email.to_lowercase(), job_id, stage, at, subject],
        )?;
        Ok(())
    }

    /// Which applications recruiters handled: for one recruiter, one job, or all.
    /// [{email, job_id, stage, first_at, last_at, emails, last_subject, title, company, status}]
    pub fn recruiter_links(&self, email: Option<&str>, job_id: Option<&str>) -> R<Vec<Value>> {
        let mut st = self.con.prepare(
            "SELECT l.email, l.job_id, l.stage, l.first_at, l.last_at, l.emails, l.last_subject, COALESCE(j.title, ''), COALESCE(j.company, ''), COALESCE(j.status, '')
             FROM recruiter_jobs l LEFT JOIN jobs j ON j.id = l.job_id
             WHERE (?1 IS NULL OR l.email = ?1) AND (?2 IS NULL OR l.job_id = ?2) ORDER BY l.last_at DESC",
        )?;
        let rows = st.query_map(params![email.map(|e| e.to_lowercase()), job_id], |r| {
            Ok(serde_json::json!({ "email": r.get::<_, String>(0)?, "job_id": r.get::<_, String>(1)?, "stage": r.get::<_, String>(2)?, "first_at": r.get::<_, String>(3)?,
                "last_at": r.get::<_, String>(4)?, "emails": r.get::<_, i64>(5)?, "last_subject": r.get::<_, String>(6)?, "title": r.get::<_, String>(7)?,
                "company": r.get::<_, String>(8)?, "status": r.get::<_, String>(9)? }))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Emails already read that belong to an application: (gmail id, job id, sender, subject, category, received).
    pub fn application_emails(&self) -> R<Vec<(String, String, String, String, String, String)>> {
        let mut st = self.con.prepare(
            "SELECT gmail_id, job_id, COALESCE(sender, ''), COALESCE(subject, ''), COALESCE(category, ''), COALESCE(received_at, processed_at)
             FROM emails WHERE job_id IS NOT NULL",
        )?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn job_emails(&self) -> R<Vec<(String, String, String, String)>> {
        let mut st = self.con.prepare(
            "SELECT job_id, COALESCE(category, ''), COALESCE(sender, ''), COALESCE(received_at, processed_at)
             FROM emails WHERE job_id IS NOT NULL ORDER BY received_at",
        )?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Jobs that ever reached a stage, from their history: (job id, stage).
    pub fn stages_reached(&self) -> R<Vec<(String, String)>> {
        let mut st = self.con.prepare("SELECT DISTINCT job_id, substr(kind, 8) FROM events WHERE job_id IS NOT NULL AND kind LIKE 'status:%'")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // --- calendar -----------------------------------------------------------------------------

    pub fn calendar_event_exists(&self, job_id: Option<&str>, kind: &str, start: &str) -> R<bool> {
        let n: i64 = self.con.query_row(
            "SELECT COUNT(*) FROM calendar_events WHERE job_id IS ?1 AND kind = ?2 AND start = ?3",
            params![job_id, kind, start],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    pub fn record_calendar_event(&self, event_id: &str, job_id: Option<&str>, kind: &str, start: &str, title: &str) -> R<()> {
        self.con.execute(
            "INSERT OR IGNORE INTO calendar_events (event_id, job_id, kind, start, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![event_id, job_id, kind, start, title, now()],
        )?;
        Ok(())
    }

    /// Everything Job Hunt put in your calendar between two times (RFC 3339), soonest first.
    pub fn calendar_between(&self, from: &str, to: &str) -> R<Vec<CalEvent>> {
        let mut st = self.con.prepare(
            "SELECT c.event_id, c.job_id, c.kind, c.start, c.title, j.company, j.title
             FROM calendar_events c LEFT JOIN jobs j ON j.id = c.job_id
             WHERE c.start >= ?1 AND c.start < ?2 ORDER BY c.start",
        )?;
        let rows = st.query_map(params![from, to], |r| {
            Ok(CalEvent { event_id: r.get(0)?, job_id: r.get(1)?, kind: r.get(2)?, start: r.get(3)?, title: r.get(4)?, company: r.get(5)?, job_title: r.get(6)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Calendar entries Job Hunt made, with their Google event ids (and the local ones).
    pub fn calendar_ids(&self) -> R<Vec<CalEvent>> {
        self.calendar_between("0000", "9999")
    }

    /// An entry's new id (once copied to Google Calendar) or new time (moved there).
    pub fn update_calendar_event(&self, event_id: &str, new_id: Option<&str>, start: Option<&str>) -> R<()> {
        if let Some(s) = start {
            self.con.execute("UPDATE calendar_events SET start = ?1 WHERE event_id = ?2", params![s, event_id])?;
        }
        if let Some(n) = new_id {
            self.con.execute("UPDATE calendar_events SET event_id = ?1 WHERE event_id = ?2", params![n, event_id])?;
        }
        Ok(())
    }

    /// Forget a calendar entry (and, for an interview, the prep and reminders that came with it).
    pub fn delete_calendar_event(&self, event_id: &str) -> R<usize> {
        let found: Option<(Option<String>, String, String)> = self.con.query_row(
            "SELECT job_id, kind, start FROM calendar_events WHERE event_id = ?1", [event_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
        let Some((job, kind, start)) = found else { return Ok(0) };
        let mut n = self.con.execute("DELETE FROM calendar_events WHERE event_id = ?1", [event_id])?;
        let at = |t: &str| chrono::DateTime::parse_from_rfc3339(t).ok();
        if let (true, Some(at_start)) = (kind == "interview", at(&start)) {
            // Its prep block ends at the interview's start; its reminders come in the two weeks after.
            let near: Vec<(String, String)> = {
                let mut st = self.con.prepare("SELECT event_id, start FROM calendar_events WHERE job_id IS ?1 AND event_id LIKE 'local:%' AND (kind = 'prep' OR kind LIKE 'followup-%')")?;
                let rows = st.query_map(params![job], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<rusqlite::Result<_>>()?
            };
            for (id, t) in near {
                if at(&t).is_some_and(|t| t >= at_start - chrono::Duration::days(1) && t <= at_start + chrono::Duration::days(15)) {
                    n += self.con.execute("DELETE FROM calendar_events WHERE event_id = ?1", [&id])?;
                }
            }
        }
        Ok(n)
    }

    /// Interviews from now on, soonest first.
    pub fn upcoming_interviews(&self, from: &str, limit: usize) -> R<Vec<CalEvent>> {
        let mut st = self.con.prepare(
            "SELECT c.event_id, c.job_id, c.kind, c.start, c.title, j.company, j.title
             FROM calendar_events c LEFT JOIN jobs j ON j.id = c.job_id
             WHERE c.kind = 'interview' AND c.start >= ?1 ORDER BY c.start LIMIT ?2",
        )?;
        let rows = st.query_map(params![from, limit as i64], |r| {
            Ok(CalEvent {
                event_id: r.get(0)?,
                job_id: r.get(1)?,
                kind: r.get(2)?,
                start: r.get(3)?,
                title: r.get(4)?,
                company: r.get(5)?,
                job_title: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // --- settings -----------------------------------------------------------------------------

    pub fn get(&self, key: &str) -> R<Option<String>> {
        Ok(self.con.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set(&self, key: &str, value: &str) -> R<()> {
        let n = self.con.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        if bookkeeping(key) {
            self.quiet.fetch_add(n as u64, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(())
    }

    /// What employees say about a company (see claude::CompanyRating), with when it was looked up
    /// ("at"), or None if it hasn't been.
    pub fn rating(&self, company: &str) -> Option<Value> {
        let key = company_key(company);
        if key.is_empty() {
            return None;
        }
        self.get(&format!("rating:{key}")).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn set_rating(&self, company: &str, rating: &crate::claude::CompanyRating) -> R<Value> {
        let mut v = serde_json::to_value(rating)?;
        v["at"] = json!(now());
        v["company"] = json!(company);
        self.set(&format!("rating:{}", company_key(company)), &v.to_string())?;
        Ok(v)
    }

    pub fn delete(&self, key: &str) -> R<()> {
        let n = self.con.execute("DELETE FROM kv WHERE key = ?1", [key])?;
        if bookkeeping(key) {
            self.quiet.fetch_add(n as u64, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(())
    }

    /// Jobs in these stages (or, with `not`, in none of them), the newest found first.
    pub fn jobs_in(&self, stages: &[&str], not: bool) -> R<Vec<Job>> {
        let marks = vec!["?"; stages.len()].join(", ");
        let mut st = self.con.prepare(&format!("SELECT * FROM jobs WHERE status {} ({marks}) ORDER BY found_at DESC", if not { "NOT IN" } else { "IN" }))?;
        let rows = st.query_map(rusqlite::params_from_iter(stages.iter()), Job::from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Every job, the newest found first (at most `limit`), without the long text: the posting, the
    /// cover letter and the CV changes come back empty. For counting and listing; reading 14,000
    /// postings whole took tens of MB each time. With `tailored_text`, the posting's text is kept for
    /// the jobs that have a tailored CV.
    pub fn jobs_light(&self, limit: usize, tailored_text: bool) -> R<Vec<Job>> {
        let cols: Vec<String> = {
            let mut st = self.con.prepare("SELECT name FROM pragma_table_info('jobs')")?;
            let names = st.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
            names.into_iter().map(|c| match c.as_str() {
                "description" if tailored_text => "CASE WHEN cv_path IS NOT NULL THEN description ELSE '' END AS description".to_string(),
                "description" => "'' AS description".to_string(),
                "cover_letter" => "NULL AS cover_letter".to_string(),
                "cv_changes" => "'[]' AS cv_changes".to_string(),
                _ => c,
            }).collect()
        };
        let mut st = self.con.prepare(&format!("SELECT {} FROM jobs ORDER BY found_at DESC LIMIT ?1", cols.join(", ")))?;
        let rows = st.query_map([limit as i64], Job::from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// The jobs a certification could change the fit of: waiting or saved, or set aside with a fit
    /// of at least `floor`; still open.
    pub fn jobs_near_bar(&self, floor: i64) -> R<Vec<Job>> {
        let mut st = self.con.prepare("SELECT * FROM jobs WHERE closed_at IS NULL AND score IS NOT NULL AND (status IN ('queued', 'saved') OR (status = 'skipped' AND score >= ?1))")?;
        let rows = st.query_map([floor], Job::from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// The job whose posting has this link (by its url_key), if any.
    pub fn job_by_url(&self, url: &str) -> Option<Job> {
        let key = url_key(url);
        if key.is_empty() {
            return None;
        }
        self.con.query_row("SELECT * FROM jobs WHERE url_key = ?1 LIMIT 1", [key], Job::from_row).optional().ok().flatten()
    }

    /// Jobs applied to since `since` (RFC 3339).
    pub fn applied_since(&self, since: &str) -> R<Vec<Job>> {
        let mut st = self.con.prepare("SELECT * FROM jobs WHERE applied_at IS NOT NULL AND applied_at >= ?1")?;
        let rows = st.query_map([since], Job::from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// A company's roles you could still apply to (waiting to be picked, saved, tailored or approved;
    /// not sent, not closed), by its company_key, best fit first: (id, title, location, status, fit
    /// of your own CV, fit after tailoring).
    pub fn open_at_company(&self, key: &str) -> Vec<(String, String, String, String, Option<i64>, Option<i64>)> {
        if key.is_empty() {
            return vec![];
        }
        let run = || -> R<Vec<(String, String, String, String, Option<i64>, Option<i64>)>> {
            let mut st = self.con.prepare("SELECT id, title, location, status, score, score_after FROM jobs WHERE dupe_key >= ?1 AND dupe_key < ?2 \
                AND status IN ('queued', 'saved', 'ready', 'approved') AND applied_at IS NULL AND closed_at IS NULL ORDER BY score DESC LIMIT 100")?;
            let rows = st.query_map(params![format!("{key}|"), format!("{key}}}")], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        };
        run().unwrap_or_default()
    }

    /// The links (posting, where to apply) of a company's jobs, by its company_key.
    pub fn company_links(&self, key: &str) -> Vec<(String, Option<String>)> {
        if key.is_empty() {
            return vec![];
        }
        let run = || -> R<Vec<(String, Option<String>)>> {
            let mut st = self.con.prepare("SELECT url, apply_url FROM jobs WHERE dupe_key >= ?1 AND dupe_key < ?2 LIMIT 200")?;
            let rows = st.query_map(params![format!("{key}|"), format!("{key}}}")], |r| Ok((r.get(0)?, r.get(1)?)))?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        };
        run().unwrap_or_default()
    }

    /// Changes made through this connection since it opened; goes up whenever anything is saved.
    pub fn changes(&self) -> u64 {
        // Not the bookkeeping (see `bookkeeping`): syncing wrote down when it last tried, which
        // counted as a change, so the next sync was always due and copied the whole file again.
        self.con.total_changes().saturating_sub(self.quiet.load(std::sync::atomic::Ordering::SeqCst))
    }

    /// A consistent copy of the whole database at `path` (which must not exist yet).
    pub fn snapshot(&self, path: &Path) -> R<()> {
        self.con.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])?;
        Ok(())
    }

    /// The file this database is, when it is one (not the in-memory database of the tests).
    pub fn file(&self) -> Option<std::path::PathBuf> {
        self.con.path().filter(|p| !p.is_empty()).map(std::path::PathBuf::from).filter(|p| p.is_file())
    }

    /// A copy of the database file `from`, made on a connection of its own. Copying takes as long
    /// as the database is big; on the app's own connection (see `snapshot`) everything else in Job
    /// Hunt waited for it, every few minutes when a sync was due: a search crawled and the browser
    /// extension's requests timed out. A second connection reads beside the first.
    pub fn snapshot_file(from: &Path, to: &Path) -> R<()> {
        let con = Connection::open_with_flags(from, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        con.busy_timeout(std::time::Duration::from_secs(20))?;
        con.execute("VACUUM INTO ?1", [to.to_string_lossy().to_string()])?;
        Ok(())
    }

    pub fn profile(&self) -> R<crate::profile::Profile> {
        match self.get("profile")? {
            Some(s) => Ok(serde_json::from_str(&s)?),
            None => Ok(crate::profile::Profile::default()),
        }
    }

    pub fn save_profile(&self, p: &crate::profile::Profile) -> R<()> {
        self.set("profile", &serde_json::to_string(p)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copy_is_made_without_the_apps_own_connection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobhunt.db");
        let db = Db::open(&path).unwrap();
        db.set("k", "v").unwrap();
        assert_eq!(db.file().as_deref(), Some(path.as_path()));
        assert!(Db::memory().unwrap().file().is_none());
        // While the app's connection is in the middle of something of its own.
        let out = dir.path().join("copy.db");
        Db::snapshot_file(&path, &out).unwrap();
        db.set("later", "1").unwrap();
        let copy = Db::open(&out).unwrap();
        assert_eq!(copy.get("k").unwrap().as_deref(), Some("v"));
        assert!(copy.get("later").unwrap().is_none());
    }

    #[test]
    fn no_lookup_a_search_makes_for_each_posting_reads_the_whole_table() {
        let db = Db::memory().unwrap();
        for sql in PER_POSTING {
            let n = if sql.contains("?2") { 2 } else { 1 };
            let mut st = db.con.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            let plan: Vec<String> = st.query_map(rusqlite::params_from_iter(vec!["x"; n]), |r| r.get::<_, String>(3)).unwrap().map(|r| r.unwrap()).collect();
            assert!(!plan.iter().any(|l| l.starts_with("SCAN jobs") || l.starts_with("SCAN purged")), "{sql}\nreads every row: {plan:?}");
        }
    }

    fn job(id: &str, company: &str, title: &str) -> Job {
        Job { id: id.into(), source: "t".into(), company: company.into(), title: title.into(), status: "ready".into(), ..Job::default() }
    }

    #[test]
    fn two_openings_with_one_title_are_two_jobs() {
        let a = "https://fil.wd3.myworkdayjobs.com/fidelitycanada/job/Toronto-Office/Project-Manager_J69324?source=LinkedIn";
        let b = "https://fil.wd3.myworkdayjobs.com/fidelitycanada/job/Toronto-Office/Project-Manager_J64186?source=LinkedIn";
        assert_eq!(requisition(a), Some(("fil.wd3.myworkdayjobs.com".into(), "j69324".into())));
        assert!(different_requisitions(&[a], &[b]));
        assert_eq!(requisition("https://acme.wd1.myworkdayjobs.com/Careers/job/Ottawa/Project-Manager_R12345-1").map(|r| r.1).as_deref(), Some("r12345"), "the same opening, posted for a second place");
        assert!(!different_requisitions(&[a], &[a]));
        assert!(!different_requisitions(&[a], &["https://www.linkedin.com/jobs/view/4351296062/"]), "a job board's number says nothing");
        assert_eq!(requisition("https://job-boards.greenhouse.io/leagueinc/jobs/4567890"), Some(("job-boards.greenhouse.io".into(), "4567890".into())));
        let db = Db::memory().unwrap();
        let mut j = job("workday:fil-1", "Fidelity Canada", "Project Manager");
        j.url = b.into();
        db.insert_job(&j).unwrap();
        assert!(!db.job_exists_at("workday:fil-2", "Fidelity Canada", "Project Manager", &[a]).unwrap(), "another requisition: a new job");
        assert!(db.job_exists_at("workday:fil-3", "Fidelity Canada", "Project Manager", &[b]).unwrap());
        assert!(db.job_exists_at("linkedin:9", "Fidelity Canada", "Project Manager", &["https://www.linkedin.com/jobs/view/9/"]).unwrap(), "no requisition to tell them apart: the same role");
    }

    #[test]
    fn jobs_roundtrip_and_dedupe() {
        let db = Db::memory().unwrap();
        let mut j = job("t:1", "Acme", "TPM");
        j.keywords = vec!["UAT".into()];
        db.insert_job(&j).unwrap();
        assert!(db.job_exists("t:2", "ACME", "tpm").unwrap());
        assert!(!db.job_exists("t:2", "Acme", "PM").unwrap());
        db.update_job("t:1", &[("cv_changes", serde_json::json!([{"before": "a", "after": "b"}])), ("score", 88.into())]).unwrap();
        let back = db.job("t:1").unwrap().unwrap();
        assert_eq!(back.keywords, vec!["UAT"]);
        assert_eq!(back.cv_changes[0].after, "b");
        assert_eq!(back.score, Some(88));
        assert!(db.update_job("t:1", &[("id", "x".into())]).is_err());
        db.set_status("t:1", "applied", "sent").unwrap();
        let back = db.job("t:1").unwrap().unwrap();
        assert!(back.applied_at.is_some());
        assert_eq!(db.history("t:1").unwrap()[0].kind, "status:applied");
        assert_eq!(db.counts().unwrap()["applied"], 1);
        assert!(db.set_status("t:1", "nope", "").is_err());
    }

    #[test]
    fn older_databases_get_new_columns() {
        let con = Connection::open_in_memory().unwrap();
        con.execute_batch("CREATE TABLE jobs (id TEXT PRIMARY KEY, source TEXT NOT NULL, company TEXT NOT NULL, title TEXT NOT NULL,
            location TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', apply_email TEXT, description TEXT NOT NULL DEFAULT '',
            salary TEXT, posted_at TEXT, found_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'skipped',
            score INTEGER, track TEXT, reasoning TEXT, red_flags TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '[]',
            coverage_before REAL, coverage_after REAL, keyword_gaps TEXT NOT NULL DEFAULT '[]', cv_changes TEXT NOT NULL DEFAULT '[]',
            cv_path TEXT, letter_path TEXT, cover_letter TEXT, email_subject TEXT, applied_at TEXT, notes TEXT NOT NULL DEFAULT '');").unwrap();
        let db = Db::init(con).unwrap();
        db.insert_job(&job("t:1", "Acme", "TPM")).unwrap();
        db.update_job("t:1", &[("closed_at", "2026-10-15T00:00:00Z".into())]).unwrap();
        assert_eq!(dupe_key("USA018 Thomson Reuters Holdings Inc.", "Product Owner I (US)"), dupe_key("Thomson Reuters", "Product Owner I"));
        assert_eq!(dupe_key("The Toronto-Dominion Bank (Canada)", "PM"), dupe_key("Toronto Dominion Bank", "pm"));
        assert_ne!(dupe_key("Acme", "Senior PM"), dupe_key("Acme", "PM"));
        assert_ne!(dupe_key("3M Canada", "PM"), dupe_key("Canada", "PM"));
        assert_eq!(url_key("https://www.Acme.com/en-US/jobs/123/apply?utm_source=jsearch#top"), url_key("https://acme.com/jobs/123/"));
        assert_eq!(url_key("https://job-boards.greenhouse.io/acme/jobs/9?gh_src=x"), "boards.greenhouse.io/acme/jobs/9");
        assert_eq!(url_key("https://ca.linkedin.com/jobs/view/senior-pm-at-acme-4012345678?trk=x"), url_key("https://www.linkedin.com/jobs/search/?currentJobId=4012345678"));
        assert_ne!(url_key("https://acme.com/careers?jobId=1"), url_key("https://acme.com/careers?jobId=2"));
        assert_eq!(url_key("https://acme.com/"), "");
        assert_eq!(url_key(""), "");
        // A second copy of t:1 under another company spelling: known, and merged away.
        assert!(db.job_exists("other:9", "Acme Inc.", "TPM").unwrap());
        db.con.execute("INSERT INTO jobs (id, source, company, title, location, url, description, found_at, updated_at, status, dupe_key)
            VALUES ('t:2', 't', 'ACME Holdings', 'TPM', '', '', '', 'x', 'x', 'queued', ?1)", [dupe_key("ACME Holdings", "TPM")]).unwrap();
        db.update_job("t:1", &[("status", "ready".into())]).unwrap();
        assert_eq!(db.merge_duplicates().unwrap(), 1);
        assert!(db.job("t:2").unwrap().is_none() && db.job("t:1").unwrap().is_some());
        assert!(db.job("t:1").unwrap().unwrap().closed_at.is_some());
    }

    #[test]
    fn the_company_site_wins_over_a_job_board_copy() {
        let db = Db::memory().unwrap();
        let mut board = job("li:1", "Acme", "TPM");
        board.url = "https://www.linkedin.com/jobs/view/4012345678".into();
        db.insert_job(&board).unwrap();
        assert!(!db.prefer_company_link("li:1", "https://ca.indeed.com/viewjob?jk=9").unwrap(), "another board isn't better");
        assert!(db.prefer_company_link("li:1", "https://careers.acme.com/jobs/7").unwrap());
        assert_eq!(db.job("li:1").unwrap().unwrap().apply_url.as_deref(), Some("https://careers.acme.com/jobs/7"));
        // Found on the company's site first: a board's copy never replaces it.
        let mut own = job("co:1", "Beta", "PM");
        own.url = "https://beta.com/careers/1".into();
        db.insert_job(&own).unwrap();
        assert!(!db.prefer_company_link("co:1", "https://beta.wd3.myworkdayjobs.com/x/job/1").unwrap());
        // Two stored copies: the company's is kept when neither is worked on.
        let mut dup = job("li:2", "Beta Inc.", "PM");
        dup.url = "https://www.linkedin.com/jobs/view/4099999999".into();
        db.insert_job(&dup).unwrap();
        db.update_job("co:1", &[("status", "queued".into())]).unwrap();
        db.update_job("li:2", &[("status", "queued".into())]).unwrap();
        assert_eq!(db.merge_duplicates().unwrap(), 1);
        assert!(db.job("co:1").unwrap().is_some() && db.job("li:2").unwrap().is_none());
    }

    #[test]
    fn matches_not_picked_in_60_days_are_set_aside() {
        let db = Db::memory().unwrap();
        for (id, status, found, deadline) in [("t:old", "queued", "2026-01-01T00:00:00Z", None), ("t:new", "queued", "2099-01-01T00:00:00Z", None),
            ("t:open", "queued", "2026-01-01T00:00:00Z", Some("2099-01-01")), ("t:ready", "ready", "2026-01-01T00:00:00Z", None)] {
            db.insert_job(&job(id, "C", id)).unwrap();
            db.update_job(id, &[("status", status.into())]).unwrap();
            db.backdate(id, found).unwrap();
            if let Some(d) = deadline {
                db.update_job(id, &[("deadline", d.into())]).unwrap();
            }
        }
        assert_eq!(db.archive_unpicked(60).unwrap(), 1);
        let st = |id: &str| db.job(id).unwrap().unwrap().status;
        assert_eq!((st("t:old"), st("t:new"), st("t:open"), st("t:ready")), ("dismissed".into(), "queued".into(), "queued".into(), "ready".into()));
    }

    #[test]
    fn how_much_sources_overlap() {
        let db = Db::memory().unwrap();
        let s = |src: &str, co: &str, t: &str| (src.to_string(), co.to_string(), t.to_string());
        db.record_sightings(&[s("adzuna", "Acme Inc.", "PM"), s("linkedin", "Acme", "PM"), s("adzuna", "Beta", "Analyst"), s("jobbank", "Gamma", "Clerk")]).unwrap();
        db.record_sightings(&[s("linkedin", "Acme", "PM")]).unwrap();
        let o = db.source_overlap(90).unwrap();
        let get = |n: &str| o.iter().find(|v| v["source"] == n).unwrap().clone();
        assert_eq!((get("adzuna")["roles"].as_u64(), get("adzuna")["only"].as_u64()), (Some(2), Some(1)));
        assert_eq!(get("adzuna")["also"][0], json!({ "source": "linkedin", "roles": 1 }));
        assert_eq!((get("linkedin")["roles"].as_u64(), get("linkedin")["only"].as_u64()), (Some(1), Some(0)));
        assert_eq!(get("jobbank")["only"], 1);
        assert_eq!(o[0]["source"], "adzuna", "biggest first");
    }

    #[test]
    fn applied_per_week_buckets() {
        let db = Db::memory().unwrap();
        for (i, at) in ["2026-10-13T10:00:00Z", "2026-10-14T10:00:00Z", "2026-10-06T10:00:00Z", "2026-01-01T10:00:00Z"].iter().enumerate() {
            db.insert_job(&job(&format!("t:{i}"), "C", &format!("T{i}"))).unwrap();
            db.update_job(&format!("t:{i}"), &[("applied_at", (*at).into())]).unwrap();
        }
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 14).unwrap();
        let w = db.applied_per_week(3, today, chrono_tz::UTC).unwrap();
        assert_eq!(w, vec![("2026-09-28".into(), 0), ("2026-10-05".into(), 1), ("2026-10-12".into(), 2)]);
    }

    #[test]
    fn profile_defaults_to_empty_and_saves() {
        let db = Db::memory().unwrap();
        assert!(db.profile().unwrap().tracks.is_empty());
        let mut p = db.profile().unwrap();
        p.score_threshold = 80;
        db.save_profile(&p).unwrap();
        assert_eq!(db.profile().unwrap().score_threshold, 80);
    }
}

#[cfg(test)]
mod backend_tests {
    use super::*;

    /// Noting when something last ran isn't a change worth a sync (it used to make every sync due
    /// again); a real change is.
    #[test]
    fn bookkeeping_is_not_a_change() {
        let db = Db::memory().unwrap();
        let before = db.changes();
        db.set("sync.tried", "now").unwrap();
        db.set("last.check", "now").unwrap();
        db.delete("sync.error").unwrap();
        assert_eq!(db.changes(), before);
        db.set("profile", "{}").unwrap();
        assert!(db.changes() > before);
    }

    /// What the Queue asks for every second or two uses the indexes, not the whole table.
    #[test]
    fn the_queues_lookups_use_indexes() {
        let db = Db::memory().unwrap();
        let plan = |sql: &str| -> String {
            let mut st = db.con.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            let rows: Vec<String> = st.query_map([], |r| r.get::<_, String>(3)).unwrap().map(|r| r.unwrap()).collect();
            rows.join("; ")
        };
        for sql in [
            "SELECT applied_at FROM jobs WHERE applied_at IS NOT NULL",
            "SELECT * FROM jobs WHERE applied_at IS NOT NULL AND applied_at >= 'x'",
            "SELECT * FROM jobs ORDER BY found_at DESC LIMIT 400",
            "SELECT url, apply_url FROM jobs WHERE dupe_key >= 'a|' AND dupe_key < 'a}' LIMIT 200",
            "SELECT * FROM jobs WHERE status IN ('approved', 'applied') ORDER BY found_at DESC",
        ] {
            let p = plan(sql);
            assert!(p.contains("USING") && !p.contains("SCAN jobs\n") && p != "SCAN jobs", "{sql}: {p}");
        }
    }

    /// The light list leaves the long text out (kept, when asked, for jobs with a tailored CV), and
    /// reads every other column as the full list does.
    #[test]
    fn the_light_list_leaves_out_the_long_text() {
        let db = Db::memory().unwrap();
        for (id, cv) in [("1", None), ("2", Some("cv/2.docx"))] {
            let mut j = Job::default();
            (j.id, j.company, j.title, j.status, j.description) = (id.into(), "Acme".into(), format!("Role {id}"), "queued".into(), "A long posting".into());
            j.url = format!("https://acme.com/jobs/{id}");
            db.insert_job(&j).unwrap();
            if let Some(p) = cv {
                db.update_job(id, &[("cv_path", p.into()), ("cover_letter", "Dear Acme".into())]).unwrap();
            }
        }
        let light = db.jobs_light(10, false).unwrap();
        assert_eq!(light.len(), 2);
        assert!(light.iter().all(|j| j.description.is_empty() && j.cover_letter.is_none() && j.title.starts_with("Role") && j.status == "queued"));
        let some = db.jobs_light(10, true).unwrap();
        let text = |id: &str| some.iter().find(|j| j.id == id).unwrap().description.clone();
        assert_eq!((text("1").as_str(), text("2").as_str()), ("", "A long posting"));
        assert_eq!(db.job_by_url("https://www.acme.com/jobs/2/").map(|j| j.id).as_deref(), Some("2"));
    }

    #[test]
    fn a_companys_links_come_by_its_key() {
        let db = Db::memory().unwrap();
        for (id, co, url) in [("1", "Acme Inc", "https://acme.com/jobs/1"), ("2", "Acme", "https://acme.com/jobs/2"), ("3", "Acmeworks", "https://acmeworks.com/j/3")] {
            let mut j = Job::default();
            (j.id, j.company, j.title, j.url, j.status) = (id.into(), co.into(), format!("Role {id}"), url.into(), "queued".into());
            db.insert_job(&j).unwrap();
        }
        let mut got: Vec<String> = db.company_links(&company_key("Acme")).into_iter().map(|l| l.0).collect();
        got.sort();
        assert_eq!(got, ["https://acme.com/jobs/1", "https://acme.com/jobs/2"]);
    }
}
