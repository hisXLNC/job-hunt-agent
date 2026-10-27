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
";

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
    let c: String = c.into_iter().filter(|w| !LEGAL.contains(&w.as_str())).collect();
    format!("{c}|{}", words(title).join(" "))
}

/// One employer however a source spells it ("Thomson Reuters Holdings Inc." is "thomsonreuters"),
/// for what's kept per company, like its employee rating.
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
        Ok(Job {
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
            red_flags: list(r.get("red_flags")?),
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
}

impl Db {
    pub fn open(path: &Path) -> R<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Db::init(Connection::open(path)?)
    }

    pub fn memory() -> R<Db> {
        Db::init(Connection::open_in_memory()?)
    }

    fn init(con: Connection) -> R<Db> {
        con.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
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
        Ok(Db { con })
    }

    // --- jobs ----------------------------------------------------------------------------

    /// True if this posting, or the same role at the same company from another source, is known.
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
        let found: Option<(String, String)> = self.con.query_row(
            "SELECT id, found_at FROM jobs WHERE id != ?1 AND (dupe_key = ?2 OR (?3 != '' AND url_key = ?3)) ORDER BY found_at LIMIT 1",
            params![posting_id, dupe_key(company, title), url_key(url)],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
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

    /// How many times each role was posted again.
    pub fn reposts(&self) -> R<std::collections::HashMap<String, i64>> {
        let mut st = self.con.prepare("SELECT job_id, COUNT(*) FROM reposts GROUP BY job_id")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
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
        let rows: Vec<(String, String, String)> = {
            let mut st = self.con.prepare(
                "SELECT dupe_key, id, status FROM jobs WHERE dupe_key IN (SELECT dupe_key FROM jobs GROUP BY dupe_key HAVING COUNT(*) > 1)
                 UNION ALL
                 SELECT 'url:' || url_key, id, status FROM jobs WHERE url_key != '' AND url_key IN (SELECT url_key FROM jobs WHERE url_key != '' GROUP BY url_key HAVING COUNT(*) > 1)
                 ORDER BY 1",
            )?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        // Furthest along first.
        let rank = |s: &str| ["offer", "interviewing", "applied", "rejected", "no_response", "approved", "ready", "saved", "dismissed", "queued", "skipped"].iter().position(|x| *x == s).unwrap_or(9);
        let mut n = 0;
        for group in rows.chunk_by(|a, b| a.0 == b.0) {
            let mut g: Vec<&(String, String, String)> = group.iter().collect();
            g.sort_by_key(|r| rank(&r.2));
            for r in &g[1..] {
                if r.2 == "queued" || r.2 == "skipped" {
                    self.con.execute("DELETE FROM jobs WHERE id = ?1", [&r.1])?;
                    n += 1;
                }
            }
        }
        Ok(n)
    }

    pub fn delete_job(&self, id: &str) -> R<()> {
        self.con.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        self.con.execute("DELETE FROM recruiter_jobs WHERE job_id = ?1", [id])?;
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
                serde_json::to_string(&j.red_flags)?, serde_json::to_string(&j.keywords)?, j.deadline, dupe_key(&j.company, &j.title), url_key(&j.url), j.apply_url, j.score_potential
            ],
        )?;
        Ok(())
    }

    /// Update named columns. Values that are arrays or objects are stored as JSON text.
    #[cfg(test)]
    pub fn backdate(&self, id: &str, found_at: &str) -> R<()> {
        self.con.execute("UPDATE jobs SET found_at = ?2 WHERE id = ?1", params![id, found_at])?;
        Ok(())
    }

    pub fn update_job(&self, id: &str, fields: &[(&str, Value)]) -> R<()> {
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
        self.update_job(id, &f)?;
        self.log(Some(id), &format!("status:{status}"), detail)
    }

    pub fn job(&self, id: &str) -> R<Option<Job>> {
        Ok(self.con.query_row("SELECT * FROM jobs WHERE id = ?1", [id], Job::from_row).optional()?)
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
        self.con.execute(
            "INSERT INTO events (job_id, kind, detail, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![job_id, kind, detail, now()],
        )?;
        Ok(())
    }

    fn events_where(&self, clause: &str, p: &[&dyn rusqlite::ToSql]) -> R<Vec<Event>> {
        let sql = format!(
            "SELECT e.id, e.job_id, e.kind, e.detail, e.created_at, j.company, j.title
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
        self.con.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
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
        self.con.execute("DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(())
    }

    /// Changes made through this connection since it opened; goes up whenever anything is saved.
    pub fn changes(&self) -> u64 {
        self.con.total_changes()
    }

    /// A consistent copy of the whole database at `path` (which must not exist yet).
    pub fn snapshot(&self, path: &Path) -> R<()> {
        self.con.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])?;
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

    fn job(id: &str, company: &str, title: &str) -> Job {
        Job { id: id.into(), source: "t".into(), company: company.into(), title: title.into(), status: "ready".into(), ..Job::default() }
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
