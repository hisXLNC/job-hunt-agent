//! The work itself: find and score jobs, tailor applications, process the inbox, book interviews.

use crate::claude::{Claude, CvSource, EmailIn, Engine, Llm, TimeSlot, Triage};
use crate::profile::Track;
use crate::cv;
use crate::db::{Db, Job};
use crate::filters::{prefilter, NO_TITLE_MATCH};
use crate::google::{self, Cal, Email, Mail, NewEvent};
use crate::profile::Profile;
use crate::slots::{free_slots, is_free, parse_time, weekday_after};
use crate::sources::{fetch_all, Posting};
use crate::util::now;
use crate::util::{short_hash, slug};
use crate::{err, Error, R};
use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

/// Near-miss titles Claude looks at per search; the rest wait for the next one.
const NEAR_MISS_BATCH: usize = 150;

/// Job-alert emails from the big job sites, and Canada's Job Bank. Kept separate from the inbox
/// check, which skips promotions.
pub const ALERTS_QUERY: &str = "newer_than:7d from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com OR jobs-listings@linkedin.com OR alert@indeed.com OR jobalert.indeed.com OR noreply@glassdoor.com OR jobbank.gc.ca OR guichetemplois.gc.ca OR eluta.ca OR workopolis.com OR bayt.com OR naukrigulf.com OR gulftalent.com OR monstergulf.com OR reed.co.uk OR totaljobs.com OR seek.com.au OR stepstone OR ziprecruiter.com OR naukri.com)";

fn alert_site(from: &str) -> &'static str {
    let f = from.to_lowercase();
    if f.contains("linkedin") {
        "linkedin"
    } else if f.contains("glassdoor") {
        "glassdoor"
    } else if f.contains("indeed") {
        "indeed"
    } else if f.contains("jobbank") || f.contains("guichetemplois") {
        "jobbank"
    } else if f.contains("eluta") {
        "eluta"
    } else if f.contains("workopolis") {
        "workopolis"
    } else if f.contains("bayt") {
        "bayt"
    } else if f.contains("naukrigulf") {
        "naukrigulf"
    } else if f.contains("gulftalent") {
        "gulftalent"
    } else {
        "alert"
    }
}

/// A posting from a job-alert email. Its `posted` field carries "site|date" from process_alerts.
fn alert_posting(j: crate::claude::FoundJob) -> Posting {
    let (site, posted) = j.posted.split_once('|').map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or((j.posted.clone(), String::new()));
    let site = if site.is_empty() { "alert".to_string() } else { site };
    Posting {
        external_id: short_hash(&format!("{}|{}|{}", j.company.to_lowercase(), j.title.to_lowercase(), j.location.to_lowercase())),
        source: site,
        remote: j.location.to_lowercase().contains("remote"),
        posted_at: Some(posted).filter(|x| !x.trim().is_empty()),
        salary: Some(j.salary).filter(|x| !x.trim().is_empty()),
        description: if j.description.trim().is_empty() { format!("{} at {}, {}. (From a job-alert email: open the posting for the full description.)", j.title, j.company, j.location) } else { j.description },
        company: j.company,
        title: j.title,
        location: j.location,
        url: j.url,
        ..Posting::default()
    }
}

/// A posting found on Indeed through the connector.
fn indeed_posting(j: crate::claude::FoundJob) -> Posting {
    Posting {
        source: "indeed".into(),
        // Indeed's ids and links change between searches, so the posting itself is the id.
        external_id: crate::util::short_hash(&format!("{}|{}|{}", j.company.to_lowercase(), j.title.to_lowercase(), j.location.to_lowercase())),
        remote: j.location.to_lowercase().contains("remote"),
        posted_at: Some(j.posted).filter(|x| !x.trim().is_empty()),
        salary: Some(j.salary).filter(|x| !x.trim().is_empty() && !x.eq_ignore_ascii_case("n/a") && !x.eq_ignore_ascii_case("none")),
        company: j.company,
        title: j.title,
        location: j.location,
        url: j.url,
        description: j.description,
        ..Posting::default()
    }
}

/// A phone notice with nothing personal in it: the kind of notice, not the company, role or person.
pub fn private_notice(title: &str) -> (String, String) {
    let t = title.to_lowercase();
    let what = if t.contains("offer") {
        "News about an offer"
    } else if t.contains("interview") {
        "An interview update"
    } else if t.contains("reply") || t.contains("rejected") || t.contains("not moving forward") {
        "A reply to an application"
    } else if t.starts_with("closes") {
        "A posting you picked closes soon"
    } else if t.contains("ready") || t.contains("tailored") {
        "Applications ready for you"
    } else if t.contains("roles") || t.contains("search") || t.contains("found") {
        "New roles to look at"
    } else if t.contains("thank") || t.contains("follow") {
        "A note to send"
    } else {
        "Something new"
    };
    (format!("Job Hunt: {what}"), "Open Job Hunt to see it.".into())
}

/// Where a phone notice is sent: an ntfy topic (https://ntfy.sh, or your own ntfy server).
/// Notices that can't wait: interviews, offers, replies from employers, and posting deadlines.
pub fn is_urgent(title: &str) -> bool {
    !title.contains("didn't") && ["Interview", "You have an offer", "Reply from", "Thank-you note", "Closes "].iter().any(|w| title.starts_with(w))
}

pub fn phone_url(server: &str, topic: &str, title: &str) -> String {
    let server = if server.trim().is_empty() { "https://ntfy.sh" } else { server.trim().trim_end_matches('/') };
    let mut u = url::Url::parse(&format!("{server}/{}", topic.trim())).unwrap_or_else(|_| url::Url::parse("https://ntfy.sh/invalid").unwrap());
    u.query_pairs_mut().append_pair("title", title).append_pair("tags", "briefcase");
    u.to_string()
}

/// The last day to apply: Claude's reading of the posting when it's a real date, else the text's.
fn deadline_of(claude: &str, text: &str) -> Option<String> {
    let today = Utc::now().date_naive();
    chrono::NaiveDate::parse_from_str(claude.trim(), "%Y-%m-%d").ok()
        .filter(|d| *d >= today - Duration::days(7) && *d <= today + Duration::days(365))
        .or_else(|| crate::sources::deadline_from_text(text, today))
        .map(|d| d.to_string())
}

/// One field of a CSV file, quoted.
fn csv_field(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\"").replace(['\r', '\n'], " "))
}

/// What the candidate is after, in a line: every CV's titles and keywords.
fn targets(p: &Profile) -> String {
    let mut out: Vec<String> = vec![];
    for t in &p.tracks {
        for x in t.titles.iter().chain(t.keywords.iter()) {
            if !x.trim().is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(x.trim())) {
                out.push(x.trim().to_string());
            }
        }
    }
    out.join("; ")
}

/// Could this email be about your job search? Words a recruiter, an employer or an application
/// system uses, or the name of a company you applied to. Generous on purpose: anything that might
/// be goes to Claude, which decides; only mail with none of these is skipped.
pub fn about_jobs(msg: &Email, apps: &[(String, String, String, String)]) -> bool {
    const WORDS: &[&str] = &[
        "job", "role", "position", "application", "applied", "applying", "candida", "interview", "recruit", "hiring",
        "hire", "talent", "opportunit", "offer", "assessment", "career", "resume", "résumé", " cv", "vacanc",
        "onboarding", "background check", "reference check", "employ", "screening", "shortlist", "next steps", "your profile",
        "headhunt", "staffing", "salary", "compensation", "start date", "contract", "linkedin", "indeed", "glassdoor",
        "workday", "myworkday", "greenhouse", "lever.co", "ashbyhq", "smartrecruiters", "icims", "taleo", "successfactors",
        "jobvite", "bamboohr", "teamtailor", "workable", "hr team", "human resources",
    ];
    let body: String = msg.body.chars().take(4000).collect();
    let text = format!("{} {} {}", msg.from, msg.subject, body).to_lowercase();
    WORDS.iter().any(|w| text.contains(w))
        || apps.iter().any(|(_, _, company, _)| {
            let c = company.trim().to_lowercase();
            c.chars().count() >= 3 && text.contains(&c)
        })
}

pub const INBOX_QUERY: &str = "newer_than:3d -from:me -in:chats -category:promotions -category:social";

/// Which stage an email moves its application to.
fn email_status(category: &str) -> Option<&'static str> {
    match category {
        "interview_request" | "interview_confirmed" | "assessment" => Some("interviewing"),
        "rejection" => Some("rejected"),
        "offer" => Some("offer"),
        _ => None,
    }
}

/// Gmail label (under JobHunt/) for each category.
fn label(category: &str) -> Option<&'static str> {
    Some(match category {
        "interview_request" | "interview_confirmed" => "Interview",
        "assessment" => "Assessment",
        "rejection" => "Rejected",
        "offer" => "Offer",
        "application_received" => "Applied",
        "recruiter_outreach" => "Recruiter",
        "job_alert" => "Alerts",
        "other_job_related" => "Other",
        _ => return None,
    })
}

#[derive(Serialize, Default, Debug, Clone)]
pub struct Report {
    pub found: usize,
    pub new: usize,
    /// New postings left unscored this time (the per-search cap); they're picked up next time.
    pub deferred: usize,
    pub filtered: usize,
    pub scored: usize,
    pub tailored: usize,
    pub errors: Vec<String>,
    pub source_problems: Vec<String>,
    /// Postings filtered out earlier and checked again (force search).
    pub rechecked: usize,
    /// Postings waiting on you that have closed since they were found.
    pub closed: usize,
    /// Postings found before, in an earlier search (not new).
    #[serde(default)]
    pub known: usize,
    /// Why new postings were filtered out, by kind of reason: location, title, salary…
    #[serde(default)]
    pub why_filtered: BTreeMap<String, usize>,
    /// Company boards that aren't there any more: [{source, name}].
    #[serde(default)]
    pub broken_boards: Vec<Value>,
    /// What each kind of source gave: [{name, searches, found, failed}].
    #[serde(default)]
    pub by_source: Vec<Value>,
    /// Roles that cleared your fit score and wait for you to pick them for tailoring.
    #[serde(default)]
    pub to_pick: usize,
}

impl std::fmt::Display for Report {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} postings, {} new, {} filtered out, {} scored, {} tailored", self.found, self.new, self.filtered, self.scored, self.tailored)?;
        if self.rechecked > 0 {
            write!(f, " ({} filtered out earlier and checked again)", self.rechecked)?;
        }
        if self.deferred > 0 {
            write!(f, ", {} left for the next search", self.deferred)?;
        }
        if self.closed > 0 {
            write!(f, ", {} closed", self.closed)?;
        }
        if !self.errors.is_empty() {
            write!(f, ". {} problem(s): {}", self.errors.len(), self.errors.iter().take(3).cloned().collect::<Vec<_>>().join("; "))?;
        }
        Ok(())
    }
}

type Notify = Box<dyn Fn(&str, &str) + Send + Sync>;

pub struct Agent {
    pub data: PathBuf,
    db: Mutex<Db>,
    pub llm: RwLock<Arc<dyn Llm>>,
    pub mail: RwLock<Option<Arc<dyn Mail>>>,
    pub cal: RwLock<Option<Arc<dyn Cal>>>,
    /// The Job Hunt folder in your Google Drive, for syncing without Google Drive for desktop.
    pub files: RwLock<Option<Arc<dyn google::Files>>>,
    notify: Notify,
    running: Mutex<HashSet<String>>,
    progress: Mutex<Progress>,
    /// The database's change counter at the last sync (u64::MAX: not synced yet).
    pub(crate) sync_mark: std::sync::atomic::AtomicU64,
    /// Whether this computer is the one using Job Hunt (see sync::beat).
    pub(crate) presence: Mutex<crate::sync::Presence>,
    /// What Claude has been used for (Settings → Accounts → Claude usage).
    pub usage: Arc<Mutex<crate::usage::Log>>,
}

/// Where the running search is, for the progress bar.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Progress {
    /// What it's doing now, in words.
    pub stage: String,
    /// Steps done and steps in this stage (total 0: no count, e.g. while Indeed runs).
    pub done: usize,
    pub total: usize,
    /// The thing being worked on, e.g. "Greenhouse board stripe".
    pub detail: String,
    /// Overall share of the search done, 0-100.
    pub percent: u32,
    pub found: usize,
    pub new: usize,
    pub scored: usize,
    pub tailored: usize,
}

/// The search's stages and the share of the bar each one fills.
const STAGES: [(&str, u32, u32); 5] = [
    ("Searching job sites", 0, 30),
    ("Searching Indeed", 30, 45),
    ("Checking near-miss titles", 45, 50),
    ("Scoring postings", 50, 80),
    ("Tailoring applications", 80, 100),
];

/// Stops a background job from running twice at once; released when dropped.
pub struct Running<'a> {
    agent: &'a Agent,
    name: String,
}

pub struct OwnedRunning {
    agent: Arc<Agent>,
    name: String,
}

impl Drop for OwnedRunning {
    fn drop(&mut self) {
        self.agent.running.lock().unwrap().remove(&self.name);
    }
}

impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.agent.running.lock().unwrap().remove(&self.name);
    }
}

impl Agent {
    pub fn new(data: &Path, db: Db, notify: Notify) -> Agent {
        let agent = Agent {
            data: data.to_path_buf(),
            db: Mutex::new(db),
            llm: RwLock::new(Arc::new(Claude::new("", ""))),
            mail: RwLock::new(None),
            cal: RwLock::new(None),
            files: RwLock::new(None),
            notify,
            running: Mutex::new(HashSet::new()),
            progress: Mutex::new(Progress::default()),
            sync_mark: std::sync::atomic::AtomicU64::new(u64::MAX),
            presence: Mutex::new(crate::sync::Presence::default()),
            usage: Arc::new(Mutex::new(crate::usage::Log::default())),
        };
        if let Ok(log) = serde_json::from_str(&agent.secret("usage.log")) {
            *agent.usage.lock().unwrap() = log;
        }
        let _ = agent.drop_outside_locations();
        let _ = agent.db().merge_duplicates();
        agent.connect();
        agent
    }

    pub fn db(&self) -> MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn profile(&self) -> Profile {
        let saved = self.db().get("profile").ok().flatten();
        match saved {
            Some(s) => serde_json::from_str(&s).unwrap_or_default(),
            None => Profile::default(),
        }
    }

    pub fn save_profile(&self, p: &Profile) -> R<()> {
        self.db().save_profile(p)
    }

    /// Keys for the job-search services you've added in Settings > Connections.
    pub fn search_keys(&self) -> crate::sources::Keys {
        let some = |k: &str| Some(self.secret(k)).filter(|v| !v.trim().is_empty());
        crate::sources::Keys {
            adzuna: some("adzuna.id").zip(some("adzuna.key")),
            jsearch: some("jsearch.key").map(|k| (some("jsearch.provider").unwrap_or_else(|| "openwebninja".into()), k)),
            jooble: some("jooble.key"),
            apify: some("apify.key").map(|k| (k, some("apify.actor").unwrap_or_default())),
        }
    }

    /// The Google client to sign in with: your own client file if you added one, else the one built
    /// into this copy of Job Hunt (if any). Empty when there's neither.
    pub fn google_client(&self) -> String {
        let own = self.secret("google.client");
        if own.is_empty() { google::builtin_client().unwrap_or_default() } else { own }
    }

    /// "code" (Claude Code on this PC, the default) or "api".
    pub fn engine_name(&self) -> String {
        match self.secret("claude.engine").as_str() {
            "api" => "api".into(),
            "code" => "code".into(),
            // Never chosen: keep using a key saved before Claude Code became the default.
            _ if !self.secret("claude.key").is_empty() => "api".into(),
            _ => "code".into(),
        }
    }

    /// Google was just connected: start using it, and keep your data safe in your own Google Drive
    /// unless you've chosen how to sync before (then that choice stands).
    pub fn google_connected(&self, email: &str) {
        let _ = self.db().set("google.at", &now());
        self.connect();
        let first_time = self.secret("sync.on").is_empty();
        if first_time && self.files.read().unwrap().is_some() {
            let db = self.db();
            let _ = db.set("sync.where", "drive");
            let _ = db.set("sync.on", "1");
            drop(db);
            // A copy from another computer is there already: the Overview offers to continue from it.
            if crate::sync::newer_elsewhere(self).is_none() {
                if let Err(e) = crate::sync::push(self, true) {
                    let _ = self.db().set("sync.error", &e.0);
                }
            }
        }
        let who = if email.is_empty() { String::new() } else { format!(" for {email}") };
        if first_time {
            self.note("Google connected", &format!("Job Hunt now reads job email, manages interviews and keeps your data synced and backed up in your own Google Drive{who}. Change it in Settings \u{2192} Sync & backup."));
        } else {
            self.note("Google connected", &format!("Job Hunt can now read job email and manage interviews{who}."));
        }
    }

    /// Whether Claude can be called at all (installed Claude Code, or an API key).
    pub fn claude_ready(&self) -> bool {
        match self.engine_name().as_str() {
            "api" => !self.secret("claude.key").is_empty(),
            _ => crate::claude_code::find(&self.secret("claude.path")).is_some(),
        }
    }

    pub fn secret(&self, key: &str) -> String {
        self.db().get(key).ok().flatten().unwrap_or_default()
    }

    /// (Re)build the Claude client and the Google connection from saved settings.
    pub fn connect(&self) {
        let model = self.secret("claude.model");
        let engine = match self.engine_name().as_str() {
            "api" => Engine::Api(self.secret("claude.key")),
            _ => Engine::Code(crate::claude_code::find(&self.secret("claude.path"))),
        };
        let mut claude = Claude::with(engine, &model);
        // Saved choices for tailoring; never chosen means Opus at medium effort.
        if let Some(m) = self.db().get("claude.tailor_model").ok().flatten() {
            claude.tailor_model = m;
        }
        if let Some(e) = self.db().get("claude.tailor_effort").ok().flatten().filter(|e| !e.is_empty()) {
            claude.tailor_effort = e;
        }
        *self.llm.write().unwrap() = Arc::new(crate::usage::Metered { inner: Arc::new(claude), log: self.usage.clone() });
        let client = self.google_client();
        let token = self.secret("google.token");
        let google = if client.is_empty() || token.is_empty() {
            None
        } else {
            match (google::parse_client(&client), serde_json::from_str::<google::Token>(&token)) {
                (Ok(c), Ok(t)) => {
                    let path = self.data.join("jobhunt.db");
                    let save: Box<dyn Fn(&google::Token) + Send + Sync> = Box::new(move |t| {
                        if let Ok(db) = Db::open(&path) {
                            let _ = db.set("google.token", &serde_json::to_string(t).unwrap_or_default());
                        }
                    });
                    Some(Arc::new(google::Google::new(c, t, &self.profile().calendar.calendar_id, save)))
                }
                _ => None,
            }
        };
        *self.mail.write().unwrap() = google.clone().map(|g| g as Arc<dyn Mail>);
        *self.cal.write().unwrap() = google.clone().map(|g| g as Arc<dyn Cal>);
        *self.files.write().unwrap() = google.map(|g| g as Arc<dyn google::Files>);
    }

    /// Keep the usage meter's counts, when they changed.
    pub fn save_usage(&self) {
        let text = {
            let mut log = self.usage.lock().unwrap();
            if !log.dirty {
                return;
            }
            log.dirty = false;
            serde_json::to_string(&*log).unwrap_or_default()
        };
        let _ = self.db().set("usage.log", &text);
    }

    /// When your Claude usage limit resets, while it's reached.
    pub fn limited(&self) -> Option<chrono::DateTime<Utc>> {
        self.usage.lock().unwrap().limited(Utc::now())
    }

    /// Budget mode holds big batches (scoring again, tailoring more than 3 roles) for the night.
    /// True when that's on and it isn't night yet (from your chosen hour until 6 AM).
    /// When this PC next needs to be awake for Job Hunt, if waking it from sleep is turned on:
    /// the daily search, the weekly review, an interview's evening-before prep, and batches held
    /// for the night by budget mode. A minute after each, so the hour has turned.
    pub fn next_wake(&self) -> Option<chrono::DateTime<Utc>> {
        use chrono::Datelike;
        if self.secret("app.wake") != "1" {
            return None;
        }
        let p = self.profile();
        let tz = p.tz();
        let now = Utc::now();
        let local = now.with_timezone(&tz);
        let at = |d: chrono::NaiveDate, h: u32| d.and_hms_opt(h, 1, 0).and_then(|t| t.and_local_timezone(tz).earliest()).map(|t| t.with_timezone(&Utc));
        let today = local.date_naive();
        let mut times: Vec<chrono::DateTime<Utc>> = vec![];
        // The daily search: today's if it's still ahead, else tomorrow's.
        times.extend(at(today, p.search_hour));
        times.extend(at(today + Duration::days(1), p.search_hour));
        // The weekly review: Sunday at 6 PM (a Monday review comes with that day's search).
        if self.secret("weekly.day") != "mon" {
            let to_sunday = (7 - local.weekday().num_days_from_sunday()) % 7;
            times.extend(at(today + Duration::days(to_sunday as i64), 18));
        }
        // Held for the night by budget mode.
        if self.secret("budget.on") == "1" && !self.deferred().is_empty() {
            let h = self.secret("budget.hour").parse::<u32>().unwrap_or(22).min(23);
            times.extend(at(today, h));
            times.extend(at(today + Duration::days(1), h));
        }
        // Prep the evening before an interview.
        let interviews = self.db().upcoming_interviews(&now.to_rfc3339(), 20).unwrap_or_default();
        for i in interviews.iter().filter(|i| i.job_id.is_some()) {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&i.start) {
                times.extend(at(t.with_timezone(&tz).date_naive() - Duration::days(1), 18));
            }
        }
        times.into_iter().filter(|t| *t > now + Duration::minutes(1)).min()
    }

    pub fn budget_wait(&self) -> bool {
        use chrono::Timelike;
        if self.secret("budget.on") != "1" {
            return false;
        }
        let hour = self.secret("budget.hour").parse::<u32>().unwrap_or(22);
        let h = Utc::now().with_timezone(&self.profile().tz()).hour();
        !is_night(h, hour)
    }

    /// Hold a batch for later: {"kind": "rescore", "group": …} or {"kind": "tailor", "ids": […]}.
    pub fn defer(&self, what: Value) -> R<()> {
        let _held = HELD.lock().unwrap();
        let mut list: Vec<Value> = serde_json::from_str(&self.secret("deferred")).unwrap_or_default();
        match what["kind"].as_str() {
            // One per group: the same group held twice runs once.
            Some("rescore") => {
                list.retain(|x| !(x["kind"] == "rescore" && x["group"] == what["group"]));
                list.push(what);
            }
            // Roles to tailor join the batch already held.
            Some("tailor") => {
                let add: Vec<String> = serde_json::from_value(what["ids"].clone()).unwrap_or_default();
                if let Some(t) = list.iter_mut().find(|x| x["kind"] == "tailor") {
                    let mut ids: Vec<String> = serde_json::from_value(t["ids"].clone()).unwrap_or_default();
                    ids.extend(add.into_iter().filter(|i| !ids.contains(i)).collect::<Vec<_>>());
                    t["ids"] = json!(ids);
                } else {
                    list.push(what);
                }
            }
            _ => list.push(what),
        }
        self.db().set("deferred", &Value::Array(list).to_string())
    }

    pub fn deferred(&self) -> Vec<Value> {
        serde_json::from_str(&self.secret("deferred")).unwrap_or_default()
    }

    /// Run the held batches now.
    pub fn run_deferred(self: &Arc<Self>) -> R<usize> {
        let list = {
            let _held = HELD.lock().unwrap();
            let all = self.deferred();
            // A scoring-again that's already running stays held for next time.
            let (keep, go): (Vec<Value>, Vec<Value>) = all.into_iter().partition(|w| w["kind"] == "rescore" && self.is_running("rescore"));
            if keep.is_empty() { self.db().delete("deferred")? } else { self.db().set("deferred", &Value::Array(keep).to_string())? }
            go
        };
        for w in &list {
            match w["kind"].as_str() {
                Some("tailor") => {
                    let ids: Vec<String> = serde_json::from_value(w["ids"].clone()).unwrap_or_default();
                    if let Err(e) = self.tailor_picked(&ids) {
                        self.db().log(None, "tailor:error", &e.0)?;
                    }
                }
                Some("rescore") => {
                    let (a, group) = (self.clone(), w["group"].as_str().unwrap_or("").to_string());
                    std::thread::spawn(move || {
                        if let Err(e) = a.rescore(&group) {
                            let _ = a.db().log(None, "rescore:error", &e.0);
                            // Hit the usage limit: held again, to run once it resets.
                            if e.0.contains("usage limit") || e.0.contains("already running") {
                                let _ = a.defer(json!({ "kind": "rescore", "group": group }));
                            }
                        }
                    });
                }
                _ => {}
            }
        }
        Ok(list.len())
    }

    /// The usage meter, budget mode and what's held, for Settings.
    pub fn usage_summary(&self) -> Value {
        let mut v = self.usage.lock().unwrap().summary(Utc::now());
        v["budget"] = json!({ "on": self.secret("budget.on") == "1", "hour": self.secret("budget.hour").parse::<u32>().unwrap_or(22), "waiting": self.budget_wait() });
        v["deferred"] = json!(self.deferred());
        v["engine"] = json!(self.engine_name());
        v
    }

    pub fn claim(&self, name: &str) -> R<Running<'_>> {
        let mut r = self.running.lock().unwrap();
        if !r.insert(name.to_string()) {
            return err(format!("{name} is already running"));
        }
        Ok(Running { agent: self, name: name.to_string() })
    }

    /// claim, for work handed to another thread.
    fn claim_owned(self: &Arc<Self>, name: &str) -> Option<OwnedRunning> {
        self.running.lock().unwrap().insert(name.to_string()).then(|| OwnedRunning { agent: self.clone(), name: name.to_string() })
    }

    pub fn is_running(&self, name: &str) -> bool {
        self.running.lock().unwrap().contains(name)
    }

    /// The running search's progress, or None when no search is running.
    pub fn progress(&self) -> Option<Progress> {
        self.is_running("search").then(|| self.progress.lock().unwrap().clone())
    }

    pub(crate) fn step(&self, stage: &str, done: usize, total: usize, detail: &str) {
        let (from, to) = STAGES.iter().find(|s| s.0 == stage).map(|s| (s.1, s.2)).unwrap_or((0, 100));
        let share = if total > 0 { done.min(total) as f64 / total as f64 } else { 0.0 };
        let mut p = self.progress.lock().unwrap();
        p.stage = stage.into();
        p.done = done;
        p.total = total;
        p.detail = detail.into();
        p.percent = from + ((to - from) as f64 * share).round() as u32;
    }

    fn tally(&self, r: &Report) {
        let mut p = self.progress.lock().unwrap();
        (p.found, p.new, p.scored, p.tailored) = (r.found, r.new, r.scored, r.tailored);
    }

    pub fn running(&self) -> Vec<String> {
        self.running.lock().unwrap().iter().cloned().collect()
    }

    /// A Windows notification (or whatever the host shows).
    pub fn note(&self, title: &str, body: &str) {
        (self.notify)(title, body);
        self.push_to_phone(title, body);
    }

    /// The same notice on your phone, through the ntfy app, when you've turned that on.
    fn push_to_phone(&self, title: &str, body: &str) {
        let topic = self.secret("phone.topic");
        let urgent = is_urgent(title);
        if topic.is_empty() || cfg!(test) || (!urgent && self.secret("phone.urgent_only") == "1") {
            return;
        }
        // The notice travels through a relay (ntfy.sh unless you run your own), so unless you chose to see
        // details, it only says what kind of notice it is.
        let (title, body) = if self.secret("phone.details") == "1" { (title.to_string(), body.to_string()) } else { private_notice(title) };
        let url = phone_url(&self.secret("phone.server"), &topic, &title);
        // Tapping the notice opens Job Hunt on the phone, when it can be reached from there.
        let click = crate::api::remote_address(self);
        std::thread::spawn(move || {
            let mut req = crate::sources::http().post(url).body(body);
            if urgent {
                // Rings through on the phone, with a star.
                req = req.header("Priority", "high").header("Tags", "briefcase,star");
            }
            if let Some(c) = click {
                req = req.header("Click", c);
            }
            let _ = req.send();
        });
    }

    /// Send a test notice to your phone and say whether it went.
    pub fn test_phone(&self) -> R<()> {
        let topic = self.secret("phone.topic");
        if topic.is_empty() {
            return err("Turn phone notifications on first.");
        }
        let url = phone_url(&self.secret("phone.server"), &topic, "Job Hunt");
        let r = crate::sources::http().post(url).body("Phone notifications work. You'll hear about new applications, interviews and offers here.")
            .send().map_err(|e| Error(format!("Couldn't reach the notification server ({e}).")))?;
        if !r.status().is_success() {
            return Err(Error(format!("The notification server answered {}.", r.status())));
        }
        Ok(())
    }

    pub(crate) fn llm(&self) -> Arc<dyn Llm> {
        self.llm.read().unwrap().clone()
    }

    pub fn cv_path(&self, track: &str) -> PathBuf {
        self.data.join("cv").join(format!("{track}.docx"))
    }

    fn cv_texts(&self, p: &Profile) -> Vec<(String, String)> {
        p.tracks.iter()
            .filter_map(|t| cv::open(&self.cv_path(&t.name)).ok().map(|d| (t.name.clone(), d.plain_text())))
            .collect()
    }

    // --- learning from your choices --------------------------------------------------------

    /// Remember a decision about a posting, so later scoring can learn from it.
    pub fn record_feedback(&self, job: &Job, decision: &str, reason: &str) -> R<()> {
        let db = self.db();
        let mut list: Vec<Value> = db.get("feedback")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        list.retain(|f| f["job"] != json!(job.id));
        list.push(json!({ "job": job.id, "decision": decision, "title": job.title, "company": job.company, "reason": reason.trim() }));
        let keep = list.len().saturating_sub(40);
        db.set("feedback", &serde_json::to_string(&list[keep..]).unwrap_or_default())
    }

    /// Your own scoring notes plus what your recent decisions show.
    fn scoring_guidance(&self, profile: &Profile) -> String {
        let list: Vec<Value> = self.secret("feedback").parse::<Value>().ok().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        let results = self.results_for_scoring();
        if list.is_empty() {
            return format!("{}{results}", profile.guidance.trim());
        }
        let lines: Vec<String> = list.iter().rev().take(25).map(|f| {
            let reason = f["reason"].as_str().unwrap_or("");
            format!("- {}: {} at {}{}", f["decision"].as_str().unwrap_or(""), f["title"].as_str().unwrap_or(""), f["company"].as_str().unwrap_or(""),
                if reason.is_empty() { String::new() } else { format!(" ({reason})") })
        }).collect();
        format!("{}\n\nThe candidate's recent decisions on earlier postings (score similar postings the same way):\n{}{results}", profile.guidance.trim(), lines.join("\n"))
    }

    /// Which kinds of application have had replies so far, for scoring: with 8 or more sent,
    /// the CVs and titles with 3 or more applications each.
    fn results_for_scoring(&self) -> String {
        let Ok(r) = self.results() else { return String::new() };
        if r["funnel"]["sent"].as_u64().unwrap_or(0) < 8 {
            return String::new();
        }
        let mut lines = vec![];
        for (what, key) in [("CV", "by_cv"), ("Title", "by_title")] {
            for g in r[key].as_array().into_iter().flatten().filter(|g| g["sent"].as_u64().unwrap_or(0) >= 3) {
                lines.push(format!("- {what} {}: {} sent, {} replies, {} interviews", g["name"].as_str().unwrap_or(""), g["sent"], g["replied"], g["interviews"]));
            }
        }
        if lines.is_empty() {
            return String::new();
        }
        format!("\n\nHow the candidate's applications have gone so far. Score a little higher for kinds of role that got \
replies and interviews, and a little lower for kinds that got none from several tries; fit still comes first:\n{}", lines.join("\n"))
    }

    // --- job-alert emails ------------------------------------------------------------------

    fn take_pending_alerts(&self) -> Vec<Posting> {
        let db = self.db();
        let list: Vec<crate::claude::FoundJob> = db.get("alerts.pending").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let _ = db.delete("alerts.pending");
        list.into_iter().map(|j| alert_posting(j)).collect()
    }

    /// Read job-alert emails from LinkedIn, Indeed and Glassdoor, and score the postings in them.
    pub fn process_alerts(&self, mail: &Arc<dyn Mail>, limit: usize) -> R<usize> {
        let mut found: Vec<crate::claude::FoundJob> = vec![];
        for id in mail.recent(ALERTS_QUERY, limit)? {
            if self.db().email_seen(&id)? {
                continue;
            }
            let msg = mail.get(&id)?;
            let input = EmailIn { from: &msg.from, to: &msg.to, date: &msg.date, subject: &msg.subject, body: &msg.body };
            match self.llm().alert_jobs(&input) {
                Ok(mut jobs) => {
                    let site = alert_site(&msg.from);
                    for j in &mut jobs {
                        j.posted = if j.posted.is_empty() { site.to_string() } else { format!("{site}|{}", j.posted) };
                    }
                    let n = jobs.len();
                    found.extend(jobs);
                    self.db().record_email(&msg.id, &msg.thread_id, None, &msg.from, &msg.subject, "job_alert", &format!("{n} postings from a {site} job alert"), None, &msg.received_at)?;
                }
                Err(e) if e.0.contains("usage limit") => break,
                Err(e) => self.db().log(None, "inbox:error", &format!("{}: {e}", msg.subject))?,
            }
        }
        let n = found.len();
        if n == 0 {
            return Ok(0);
        }
        // Queue them; score now unless a search is running (it, or the next one, picks them up).
        {
            let db = self.db();
            let mut pending: Vec<crate::claude::FoundJob> = db.get("alerts.pending")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            pending.extend(found);
            db.set("alerts.pending", &serde_json::to_string(&pending).unwrap_or_default())?;
        }
        if !self.is_running("search") {
            let postings = self.take_pending_alerts();
            if let Err(e) = self.search(Some(postings.clone())) {
                // Put them back for the next search.
                let back: Vec<crate::claude::FoundJob> = postings.into_iter().map(|p| crate::claude::FoundJob {
                    title: p.title, company: p.company, location: p.location, url: p.url, description: p.description,
                    posted: format!("{}|{}", p.source, p.posted_at.unwrap_or_default()), salary: p.salary.unwrap_or_default(),
                }).collect();
                self.db().set("alerts.pending", &serde_json::to_string(&back).unwrap_or_default())?;
                if !e.0.contains("already running") {
                    return Err(e);
                }
            }
        }
        Ok(n)
    }

    // --- company boards ----------------------------------------------------------------------

    /// Employers Claude suggests for your titles and places, kept only when their board really exists.
    pub fn suggest_boards(&self) -> R<Vec<Value>> {
        let profile = self.profile();
        let want = targets(&profile);
        if want.is_empty() {
            return err("Add a CV with job titles first (CV & career).");
        }
        let places: Vec<String> = profile.locations.iter().filter(|l| !l.trim().is_empty()).cloned().collect();
        let places = if places.is_empty() { profile.country() } else { format!("{} ({})", places.join(", "), profile.country()) };
        let ideas = self.llm().suggest_boards(&want, &places)?;
        let c = crate::sources::http();
        let have = crate::sources::boards(&profile);
        let removed = self.removed_boards();
        let mut out = vec![];
        for i in ideas {
            // Workday sites are whole links, with capitals that matter; the others are lowercase names.
            let slug = if i.board == "workday" { i.slug.trim().trim_end_matches('/').to_string() } else { i.slug.trim().to_lowercase() };
            if slug.is_empty() || have.iter().any(|(b, n)| *b == i.board && n.eq_ignore_ascii_case(&slug)) || removed.contains(&format!("{}:{}", i.board, slug.to_lowercase())) {
                continue;
            }
            let Ok((jobs, _)) = crate::sources::fetch_board(&c, &profile, &i.board, &slug) else { continue };
            if jobs.is_empty() {
                continue;
            }
            let matching = jobs.iter().filter(|p| crate::filters::prefilter(p, &profile).is_none()).count();
            out.push(json!({ "company": i.company, "board": i.board, "slug": slug, "jobs": jobs.len(), "matching": matching }));
        }
        out.sort_by_key(|v| std::cmp::Reverse(v["matching"].as_u64().unwrap_or(0)));
        Ok(out)
    }

    /// Find employers near your locations whose job boards have matching roles, and add them. Runs
    /// by itself (see due_tasks); returns the companies added.
    pub fn discover_boards(&self) -> R<Vec<String>> {
        let _g = self.claim("discover")?;
        let found = self.suggest_boards();
        // Whatever happens, don't ask Claude again for a while.
        let _ = self.db().set("last.discover", &now());
        let _ = self.db().delete("discover.due");
        let found = found?;
        let pick: Vec<Value> = found.into_iter().filter(|b| b["matching"].as_u64().unwrap_or(0) > 0).take(10).collect();
        if pick.is_empty() {
            self.db().log(None, "discover", "no new employers with matching jobs this time")?;
            return Ok(vec![]);
        }
        let names: Vec<String> = pick.iter().map(|b| b["company"].as_str().unwrap_or("").to_string()).collect();
        let jobs: u64 = pick.iter().map(|b| b["matching"].as_u64().unwrap_or(0)).sum();
        self.add_boards(&pick)?;
        self.db().log(None, "discover", &format!("added {}", names.join(", ")))?;
        let place = self.profile().locations.first().cloned().unwrap_or_default();
        self.note(
            &format!("Added {} employer{}{}", names.len(), if names.len() == 1 { "" } else { "s" }, if place.is_empty() { String::new() } else { format!(" near {place}") }),
            &format!("{} with {jobs} matching job{}. Searching them now.", names.join(", "), if jobs == 1 { "" } else { "s" }),
        );
        Ok(names)
    }

    /// Boards that came back "not found" in two searches in a row are dropped; one that works
    /// again is forgiven. Returns the boards dropped.
    fn drop_dead_boards(&self, failed: &[(String, String)]) -> Vec<Value> {
        let mut strikes: BTreeMap<String, u32> = serde_json::from_str(&self.secret("boards.strikes")).unwrap_or_default();
        let key = |s: &str, n: &str| format!("{s}:{}", n.to_lowercase());
        let failed_keys: HashSet<String> = failed.iter().map(|(s, n)| key(s, n)).collect();
        strikes.retain(|k, _| failed_keys.contains(k));
        let mut drop = vec![];
        for (s, n) in failed {
            let c = strikes.entry(key(s, n)).or_insert(0);
            *c += 1;
            if *c >= 2 {
                drop.push(json!({ "source": s, "name": n }));
            }
        }
        if !drop.is_empty() {
            if self.remove_boards(&drop).is_ok() {
                for d in &drop {
                    strikes.remove(&key(d["source"].as_str().unwrap_or(""), d["name"].as_str().unwrap_or("")));
                }
                let names: Vec<&str> = drop.iter().filter_map(|d| d["name"].as_str()).collect();
                let _ = self.db().log(None, "discover", &format!("removed boards that no longer exist: {}", names.join(", ")));
            }
        }
        let _ = self.db().set("boards.strikes", &serde_json::to_string(&strikes).unwrap_or_default());
        drop
    }

    /// Take company boards out of your search: [{source, name}].
    pub fn remove_boards(&self, list: &[Value]) -> R<usize> {
        let mut p = self.profile();
        let mut n = 0;
        for b in list {
            let (src, name) = (b["source"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or(""));
            let s = &mut p.sources;
            let v = match src {
                "greenhouse" => &mut s.greenhouse,
                "lever" => &mut s.lever,
                "ashby" => &mut s.ashby,
                "workday" => &mut s.workday,
                "smartrecruiters" => &mut s.smartrecruiters,
                "workable" => &mut s.workable,
                _ => continue,
            };
            let before = v.len();
            v.retain(|x| !x.trim().eq_ignore_ascii_case(name.trim()));
            n += before - v.len();
        }
        self.save_profile(&p)?;
        let gone: Vec<(String, String)> = list.iter().map(|b| (b["source"].as_str().unwrap_or("").to_string(), b["name"].as_str().unwrap_or("").to_string())).collect();
        self.mark_removed(&gone, true);
        // The last search's report no longer needs to mention them.
        if let Ok(mut r) = serde_json::from_str::<Value>(&self.secret("last.report")) {
            let same = |a: &Value, b: &Value| a.as_str().unwrap_or("").trim().eq_ignore_ascii_case(b.as_str().unwrap_or("").trim());
            let gone = |x: &Value| list.iter().any(|b| same(&b["source"], &x["source"]) && same(&b["name"], &x["name"]));
            if let Some(a) = r["broken_boards"].as_array_mut() {
                a.retain(|x| !gone(x));
            }
            if let Some(a) = r["source_problems"].as_array_mut() {
                a.retain(|x| !list.iter().any(|b| x.as_str().is_some_and(|t| t.to_lowercase().contains(&format!(" board {}:", b["name"].as_str().unwrap_or("?").trim().to_lowercase())))));
            }
            self.db().set("last.report", &r.to_string())?;
        }
        Ok(n)
    }

    /// Boards you took out (as "source:name", lowercase), which finding employers won't add back.
    pub(crate) fn removed_boards(&self) -> BTreeSet<String> {
        serde_json::from_str(&self.secret("boards.removed")).unwrap_or_default()
    }

    /// Note boards as taken out by you, or (`removed` false) as wanted again.
    fn mark_removed(&self, boards: &[(String, String)], removed: bool) {
        if boards.is_empty() {
            return;
        }
        let mut set = self.removed_boards();
        for (src, name) in boards {
            let k = format!("{src}:{}", name.trim().to_lowercase());
            if removed {
                set.insert(k);
            } else {
                set.remove(&k);
            }
        }
        let _ = self.db().set("boards.removed", &serde_json::to_string(&set).unwrap_or_default());
    }

    /// Save settings from a page that loaded the board lists as `seen`. Boards changed elsewhere
    /// since (removed with a button, added by finding employers) stay as they are: only what you
    /// added or deleted on the page is applied, so an open page never brings a removed board back.
    pub fn save_settings(&self, mut p: Profile, seen: Option<crate::profile::Sources>) -> R<Profile> {
        let now = self.profile();
        if let Some(seen) = seen {
            let (mut gone, mut added) = (vec![], vec![]);
            let (mut old, mut cur) = (seen, now.sources.clone());
            let (old, cur) = (board_lists(&mut old), board_lists(&mut cur));
            for (i, (src, new)) in board_lists(&mut p.sources).into_iter().enumerate() {
                let (old, cur) = (&*old[i].1, &*cur[i].1);
                let has = |v: &[String], x: &str| v.iter().any(|y| y.trim().eq_ignore_ascii_case(x.trim()));
                let mut merged: Vec<String> = cur.iter().filter(|x| has(new, x) || !has(old, x)).cloned().collect();
                for x in new.iter().filter(|x| !has(old, x)) {
                    added.push((src.to_string(), x.clone()));
                    if !has(&merged, x) {
                        merged.push(x.clone());
                    }
                }
                gone.extend(old.iter().filter(|x| !has(new, x)).map(|x| (src.to_string(), x.clone())));
                *new = merged;
            }
            self.mark_removed(&gone, true);
            self.mark_removed(&added, false);
        }
        // New places to look: find employers there soon, without waiting for the weekly look.
        if now.locations != p.locations || now.tracks.iter().map(|t| &t.titles).ne(p.tracks.iter().map(|t| &t.titles)) {
            self.db().set("discover.due", "1")?;
        }
        let moved = now.locations != p.locations || now.remote_ok != p.remote_ok || now.include_metro != p.include_metro || now.sources.adzuna_country != p.sources.adzuna_country;
        self.save_profile(&p)?;
        if moved {
            self.drop_outside_locations()?;
        }
        Ok(p)
    }

    /// Add suggested company boards to your search: [{board, slug}].
    pub fn add_boards(&self, list: &[Value]) -> R<usize> {
        let mut p = self.profile();
        let mut n = 0;
        for b in list {
            let (src, slug) = (b["board"].as_str().unwrap_or(""), b["slug"].as_str().unwrap_or("").trim());
            let s = &mut p.sources;
            let v = match src {
                "greenhouse" => &mut s.greenhouse,
                "lever" => &mut s.lever,
                "ashby" => &mut s.ashby,
                "workday" => &mut s.workday,
                "smartrecruiters" => &mut s.smartrecruiters,
                "workable" => &mut s.workable,
                _ => continue,
            };
            if !slug.is_empty() && !v.iter().any(|x| x.eq_ignore_ascii_case(slug)) {
                v.push(slug.to_string());
                n += 1;
            }
        }
        self.save_profile(&p)?;
        let back: Vec<(String, String)> = list.iter().map(|b| (b["board"].as_str().unwrap_or("").to_string(), b["slug"].as_str().unwrap_or("").to_string())).collect();
        self.mark_removed(&back, false);
        Ok(n)
    }

    // --- interview prep --------------------------------------------------------------------

    pub fn prep(&self, job_id: &str) -> Option<String> {
        self.db().get(&format!("prep:{job_id}")).ok().flatten()
    }

    /// Write the interview prep sheet for a job and keep a copy next to its application files.
    pub fn make_prep(&self, job_id: &str) -> R<String> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let t = profile.track(job.track.as_deref()).cloned().ok_or_else(|| Error("No CV uploaded yet.".into()))?;
        let cv = cv::open(&self.cv_path(&t.name))?.plain_text();
        let text = self.llm().interview_prep(&profile.name, &cv, &job)?;
        self.db().set(&format!("prep:{job_id}"), &text)?;
        let dir = self.application_dir(&job);
        if std::fs::create_dir_all(&dir).is_ok() {
            let _ = std::fs::write(dir.join("Interview prep.md"), &text);
        }
        self.db().log(Some(job_id), "prep", "interview prep sheet written")?;
        Ok(text)
    }

    /// Things that follow a change of stage: learning from it, and interview prep.
    /// What follows a stage change. `learn` false: a "not interested" isn't used to score
    /// postings like it later.
    pub fn after_stage(self: &Arc<Self>, job_id: &str, status: &str, note: &str, learn: bool) {
        let Ok(Some(job)) = self.db().job(job_id) else { return };
        match status {
            "dismissed" if learn => {
                let _ = self.record_feedback(&job, "Not interested", note);
            }
            "approved" | "applied" => {
                let _ = self.record_feedback(&job, "Applied", "");
                // Applied: write to the recruiter there, as you chose (drafted, sent, or not at all).
                if status == "applied" && self.claude_ready() {
                    let (a, id) = (self.clone(), job_id.to_string());
                    std::thread::spawn(move || {
                        let Ok(_g) = a.claim(&format!("contact:{id}")) else { return };
                        if let Err(e) = crate::recruiters::on_applied(&a, &id) {
                            let _ = a.db().log(Some(&id), "recruiter:error", &e.0);
                        }
                    });
                }
            }
            "interviewing" if self.prep(job_id).is_none() => {
                let (a, id) = (self.clone(), job_id.to_string());
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim(&format!("prep:{id}")) else { return };
                    if let Err(e) = a.make_prep(&id) {
                        let _ = a.db().log(Some(&id), "prep:error", &e.0);
                    }
                });
            }
            _ => {}
        }
    }

    // --- search -----------------------------------------------------------------------------

    /// Postings from Indeed for your CVs' job titles, through the Indeed connector (Claude Code only).
    fn indeed_postings(&self, profile: &Profile) -> R<Vec<Posting>> {
        if !profile.sources.indeed {
            return Ok(vec![]);
        }
        let mut titles: Vec<String> = vec![];
        for t in profile.tracks.iter().flat_map(|t| t.titles.iter()) {
            if !t.trim().is_empty() && !titles.iter().any(|x| x.eq_ignore_ascii_case(t.trim())) {
                titles.push(t.trim().to_string());
            }
        }
        if titles.is_empty() {
            return Ok(vec![]);
        }
        if self.engine_name() != "code" {
            return err("searching Indeed needs Claude Code on this PC. Choose it in Settings → Accounts, or turn Indeed off in Job sources.");
        }
        // Your titles across all your places (each title in every place before the next).
        let mut searches = crate::sources::searches(&profile, 8);
        if profile.remote_ok {
            searches.extend(titles.iter().take(2).map(|t| (t.clone(), "remote".to_string())));
        }
        let details = profile.max_scored_per_run.clamp(5, 25);
        let found = self.llm().indeed(&searches, &profile.sources.adzuna_country.to_uppercase(), details)?;
        Ok(found.into_iter().map(indeed_posting).collect())
    }

    /// Search every source (or score the given postings), score what's new and tailor the best.
    pub fn search(&self, postings: Option<Vec<Posting>>) -> R<Report> {
        self.search_with(postings, false)
    }

    /// A search that also re-checks postings filtered out earlier, against your current CVs and settings.
    pub fn force_search(&self) -> R<Report> {
        self.search_with(None, true)
    }

    fn search_with(&self, postings: Option<Vec<Posting>>, force: bool) -> R<Report> {
        let _guard = self.claim("search")?;
        *self.progress.lock().unwrap() = Progress::default();
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & career.");
        }
        let mut report = Report::default();
        let cap = profile.max_scored_per_run.max(1);
        self.drop_outside_locations()?;
        let purged = self.db().purge_older_than(profile.purge_after_days)?;
        if purged > 0 {
            self.db().log(None, "purge", &format!("removed {purged} old posting{} you never acted on", if purged == 1 { "" } else { "s" }))?;
        }
        let postings = match postings {
            Some(p) => p,
            None => {
                let keys = self.search_keys();
                let f = fetch_all(&profile, &keys, &|i, n, name| self.step("Searching job sites", i, n, name));
                report.source_problems = f.problems;
                report.by_source = f.by_source.iter().map(|(n, k, p, e)| json!({ "name": n, "searches": k, "found": p, "failed": e })).collect();
                report.broken_boards = f.failed.iter().map(|(s, n)| json!({ "source": s, "name": n })).collect();
                if profile.sources.auto_boards {
                    let dropped = self.drop_dead_boards(&f.failed);
                    report.broken_boards.retain(|b| !dropped.contains(b));
                }
                let ids: HashSet<String> = f.postings.iter().map(|p| p.id()).collect();
                report.closed += self.close_missing(&profile, &f.complete, &ids)?;
                let mut all = f.postings;
                if profile.sources.indeed {
                    self.step("Searching Indeed", 0, 0, "through the Indeed connector");
                }
                let indeed = self.indeed_postings(&profile);
                if profile.sources.indeed {
                    let (found, failed) = match &indeed { Ok(f) => (f.len(), 0), Err(_) => (0, 1) };
                    report.by_source.push(json!({ "name": "Indeed", "searches": 1, "found": found, "failed": failed }));
                }
                match indeed {
                    Ok(found) => {
                        for p in found {
                            if !all.iter().any(|a| a.id() == p.id()) {
                                all.push(p);
                            }
                        }
                    }
                    Err(e) => report.source_problems.push(format!("Indeed: {}", e.0)),
                }
                // Postings from job-alert emails that arrived while a search was running.
                all.extend(self.take_pending_alerts());
                all
            }
        };
        report.found = postings.len();
        self.tally(&report);

        // Sort what's new: filtered out, a near miss on the title (Claude takes a look), or worth scoring.
        let mut candidates: Vec<Posting> = vec![];
        let mut near: Vec<Posting> = vec![];
        let mut seen: HashSet<String> = HashSet::new();
        for mut p in postings {
            if p.salary.is_none() {
                if let Some((text, max)) = crate::sources::salary_from_text(&p.description) {
                    p.salary = Some(text);
                    p.salary_max = p.salary_max.or(max);
                }
            }
            // The same role listed twice in one search (two sources, or twice on one board).
            // Matched by company and title, or by the link (another source's copy of the same posting).
            let link = crate::db::url_key(&p.url);
            if !seen.insert(crate::db::dupe_key(&p.company, &p.title)) || (!link.is_empty() && !seen.insert(format!("url:{link}"))) {
                continue;
            }
            if force {
                let filtered = self.db().filtered_out(&p.id(), &p.company, &p.title)?;
                if let Some(old) = filtered {
                    self.db().delete_job(&old)?;
                    report.rechecked += 1;
                }
            }
            let known = self.db().job_exists(&p.id(), &p.company, &p.title)? || self.db().url_exists(&p.url)?;
            if known {
                let posted = p.posted_at.as_deref().and_then(posted_date);
                self.db().record_repost(&p.id(), &p.company, &p.title, &p.url, posted)?;
                report.known += 1;
                continue;
            }
            report.new += 1;
            match prefilter(&p, &profile) {
                None => candidates.push(p),
                Some(why) if why == NO_TITLE_MATCH => near.push(p),
                Some(why) => self.skip(&p, &why, &mut report)?,
            }
        }
        if !near.is_empty() {
            // One request for the titles a word match missed; on failure they wait for the next search.
            let take: Vec<Posting> = near.drain(..near.len().min(NEAR_MISS_BATCH)).collect();
            self.step("Checking near-miss titles", 0, 1, &format!("{} titles", take.len()));
            let titles: Vec<String> = take.iter().map(|p| format!("{} ({})", p.title, p.company)).collect();
            match self.llm().pick_titles(&targets(&profile), &titles) {
                Ok(keep) => {
                    for (i, p) in take.into_iter().enumerate() {
                        if keep.contains(&i) {
                            candidates.push(p);
                        } else {
                            self.skip(&p, NO_TITLE_MATCH, &mut report)?;
                        }
                    }
                }
                Err(e) => report.errors.push(format!("checking near-miss titles: {e}")),
            }
            report.deferred += near.len(); // over the batch size: next search
        }
        self.tally(&report);

        // LinkedIn's and Job Bank's searches list postings without their text: read it for the ones
        // about to be scored.
        let thin_source = |s: &str| s == "linkedin" || s == "jobbank" || crate::sites::is_site_source(s);
        for (src, name, max) in [("linkedin", "LinkedIn", 30), ("jobbank", "Job Bank", 20)] {
            let mut thin: Vec<&mut Posting> = candidates.iter_mut().take(cap).filter(|p| p.source == src && p.description.trim().is_empty()).collect();
            if thin.is_empty() {
                continue;
            }
            self.step(&format!("Reading {name} postings"), 0, 1, &format!("{} postings", thin.len()));
            let total = thin.len();
            let c = crate::sources::http();
            let read = if src == "linkedin" { crate::sources::linkedin_details(&c, &mut thin, max) } else { crate::sources::jobbank_details(&c, &mut thin, max) };
            if read < total {
                report.errors.push(format!("{name}: read {read} of {total} new postings; the rest wait for the next search"));
            }
        }
        // Recruiters' and job sites' postings found as links: read from their own pages.
        let mut thin: Vec<&mut Posting> = candidates.iter_mut().take(cap).filter(|p| crate::sites::is_site_source(&p.source) && p.description.trim().is_empty()).collect();
        if !thin.is_empty() {
            self.step("Reading job sites' postings", 0, 1, &format!("{} postings", thin.len()));
            let total = thin.len();
            let read = crate::sites::details(&crate::sources::http(), &mut thin, 30);
            if read < total {
                report.errors.push(format!("Job sites: read {read} of {total} new postings; the rest wait for the next search"));
            }
        }
        // Not read yet: not stored, so the next search picks them up with their text. Read: the
        // filters again, now that there's a description to check.
        let before = candidates.len();
        candidates.retain(|p| !(thin_source(&p.source) && p.description.trim().is_empty()));
        report.deferred += before - candidates.len();
        let mut kept = vec![];
        for p in candidates {
            match thin_source(&p.source).then(|| prefilter(&p, &profile)).flatten() {
                Some(why) => self.skip(&p, &why, &mut report)?,
                None => kept.push(p),
            }
        }
        let candidates = kept;
        let llm = self.llm();
        let guidance = self.scoring_guidance(&profile);
        let to_score = candidates.len().min(cap);
        report.deferred += candidates.len().saturating_sub(cap); // not stored, so they're scored next time
        for (i, p) in candidates.into_iter().take(cap).enumerate() {
            self.step("Scoring postings", i, to_score, &format!("{} at {}", p.title, p.company));
            let mut job = p.to_job();
            match llm.score(&cvs, &guidance, &job) {
                Ok(s) => {
                    report.scored += 1;
                    job.status = if s.score >= profile.score_threshold { "queued" } else { "skipped" }.into();
                    job.score = Some(s.score);
                    job.score_potential = s.potential;
                    job.track = Some(s.track.clone());
                    job.reasoning = Some(s.reasoning);
                    job.red_flags = s.red_flags;
                    job.keywords = s.keywords;
                    job.deadline = deadline_of(&s.deadline, &job.description);
                    let db = self.db();
                    db.insert_job(&job)?;
                    db.log(Some(&job.id), "scored", &format!("{} on the {} track", s.score, s.track))?;
                }
                // Not stored, so the next search retries it.
                Err(e) => {
                    report.errors.push(format!("scoring {} / {}: {e}", p.company, p.title));
                    if e.0.contains("API key") || e.0.contains("usage limit") || e.0.contains("signed in") || e.0.contains("wasn't found") {
                        break; // every other posting would fail the same way
                    }
                }
            }
            self.tally(&report);
        }
        // Unless tailoring is automatic, roles that cleared the bar wait for you to pick them.
        let queued = if profile.auto_tailor { self.db().jobs(Some("queued"), profile.max_per_run)? } else { vec![] };
        if !profile.auto_tailor {
            report.to_pick = self.db().jobs(Some("queued"), 500)?.len();
        }
        let n = queued.len();
        for (i, job) in queued.into_iter().enumerate() {
            self.step("Tailoring applications", i, n, &format!("{} at {}", job.title, job.company));
            // Postings can sit in the queue for days: don't tailor one that has closed.
            if crate::sources::posting_closed(&job.url) == Some(true) {
                self.mark_closed(&job, "the posting says it's closed")?;
                report.closed += 1;
                continue;
            }
            match self.tailor(&job.id, None) {
                Ok(_) => report.tailored += 1,
                Err(e) => report.errors.push(format!("tailoring {} / {}: {e}", job.company, job.title)),
            }
            self.tally(&report);
        }
        self.step("Tailoring applications", 1, 1, "done");
        {
            let db = self.db();
            db.log(None, "search", &report.to_string())?;
            db.set("last.search", &crate::util::now())?;
            db.set("last.report", &serde_json::to_string(&report).unwrap_or_default())?;
        }
        if report.tailored > 0 {
            let n = report.tailored;
            self.note(
                &format!("{n} application{} ready", if n == 1 { "" } else { "s" }),
                "Your CV and a cover letter are tailored. Review and approve them in Job Hunt.",
            );
        } else if report.to_pick > 0 && report.scored > 0 {
            let n = report.to_pick;
            self.note(
                &format!("{n} role{} worth applying to", if n == 1 { "" } else { "s" }),
                "Pick the ones to tailor your CV for on Job Hunt's Overview.",
            );
        }
        Ok(report)
    }

    /// Score a posting that was skipped (filtered out or scored low) now; tailor it if it clears your bar.
    pub fn score_anyway(&self, job_id: &str) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & career.");
        }
        let s = self.llm().score(&cvs, &self.scoring_guidance(&profile), &job)?;
        let status = if s.score >= profile.score_threshold { "queued" } else { "skipped" };
        {
            let db = self.db();
            db.update_job(job_id, &[
                ("status", status.into()),
                ("score", s.score.into()), ("score_potential", json!(s.potential)),
                ("track", s.track.clone().into()),
                ("reasoning", s.reasoning.into()),
                ("red_flags", json!(s.red_flags)),
                ("keywords", json!(s.keywords)),
            ])?;
            db.log(Some(job_id), "scored", &format!("{} on the {} track (scored on request)", s.score, s.track))?;
        }
        if status == "queued" && profile.auto_tailor {
            return self.tailor(job_id, None);
        }
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Store a posting as skipped before scoring, with the reason.
    fn skip(&self, p: &Posting, why: &str, report: &mut Report) -> R<()> {
        report.filtered += 1;
        let kind = if why.starts_with("location") {
            "outside your locations"
        } else if why == NO_TITLE_MATCH {
            "title doesn't match your CVs"
        } else if why.starts_with("title contains") {
            "a title word you skip"
        } else if why.starts_with("salary") {
            "salary below your minimum"
        } else if why.starts_with("excluded") {
            "a company you skip"
        } else {
            "other"
        };
        *report.why_filtered.entry(kind.to_string()).or_insert(0) += 1;
        let mut job = p.to_job();
        job.status = "skipped".into();
        job.reasoning = Some(format!("Filtered out: {why}"));
        self.db().insert_job(&job)
    }

    /// A job you found yourself (LinkedIn, referral), scored and tailored like any other.
    pub fn add_manual(&self, company: &str, title: &str, url: &str, location: &str, description: &str) -> R<String> {
        self.add_found("manual", company, title, url, location, description)
    }

    /// A posting sent from your browser with the Send to Job Hunt button: {url, title, company,
    /// location, text, structured}. When the page didn't describe the job in a standard way,
    /// Claude reads the page to find it.
    pub fn add_clip(&self, clip: &Value) -> R<Job> {
        let f = |k: &str| clip[k].as_str().unwrap_or("").trim().to_string();
        // A LinkedIn job: read it as LinkedIn shows it signed out, which is far cleaner than the
        // signed-in page (a list of other jobs, the feed, messages).
        if let Some(id) = crate::sources::linkedin_job_id(&f("url")).filter(|_| !cfg!(test)) {
            if let Ok(p) = crate::sources::linkedin_posting(&crate::sources::http(), &id) {
                if !p.title.is_empty() && !p.company.is_empty() {
                    let jid = self.add_found("linkedin", &p.company, &p.title, &p.url, &p.location, &p.description)?;
                    let mut set: Vec<(&str, Value)> = vec![];
                    if let Some(u) = p.apply_url { set.push(("apply_url", u.into())); }
                    if let Some(e) = p.apply_email { set.push(("apply_email", e.into())); }
                    if let Some(t) = p.salary { set.push(("salary", t.into())); }
                    if !set.is_empty() {
                        self.db().update_job(&jid, &set)?;
                    }
                    return self.db().job(&jid)?.ok_or_else(|| Error("That job no longer exists.".into()));
                }
            }
        }
        let (url, text) = (f("url"), f("text"));
        let (mut title, mut company, mut location, mut description) = (f("title"), f("company"), f("location"), text.clone());
        if text.chars().count() < 40 {
            return err("That page had no posting text. Select the job description on the page and click the button again.");
        }
        if clip["structured"].as_bool() != Some(true) || title.is_empty() || company.is_empty() {
            let j = self.llm().read_posting(&url, &text)?;
            if j.title.trim().is_empty() || j.description.trim().chars().count() < 40 {
                return err("That page doesn't look like a job posting. Open the posting itself, then click the button.");
            }
            title = j.title.trim().to_string();
            if !j.company.trim().is_empty() {
                company = j.company.trim().to_string();
            }
            if !j.location.trim().is_empty() {
                location = j.location.trim().to_string();
            }
            description = j.description;
        }
        if company.is_empty() {
            company = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_else(|| "Unknown".into());
        }
        let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default();
        let source = ["linkedin", "indeed", "glassdoor", "jobbank", "workopolis", "eluta", "ziprecruiter", "monster"].iter()
            .find(|s| host.contains(*s)).map(|s| s.to_string()).unwrap_or_else(|| "browser".into());
        let id = self.add_found(&source, &company, &title, &url, &location, &description)?;
        self.db().job(&id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    fn add_found(&self, source: &str, company: &str, title: &str, url: &str, location: &str, description: &str) -> R<String> {
        if company.trim().is_empty() || title.trim().is_empty() || description.trim().len() < 40 {
            return err("Add the company, the title and the full job description.");
        }
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & career.");
        }
        let p = Posting {
            source: source.into(),
            external_id: short_hash(&format!("{company}|{title}|{url}")),
            company: company.trim().into(),
            title: title.trim().into(),
            location: location.trim().into(),
            url: url.trim().into(),
            description: description.trim().into(),
            ..Posting::default()
        };
        if self.db().job_exists(&p.id(), &p.company, &p.title)? {
            let known = self.db().job(&p.id())?.map(|j| j.status).unwrap_or_default();
            if known != "skipped" {
                // Sent again: note it on the job that's there, so it's one click away.
                // Read first: an `if let` on self.db() would hold the lock through the log below.
                let existing = self.db().existing_job(&p.id(), &p.company, &p.title);
                if let Some(id) = existing {
                    self.db().log(Some(&id), "added-again", "you sent this posting again; it's already in Job Hunt")?;
                }
                return err(format!("{} at {} is already in Job Hunt.", p.title, p.company));
            }
            // Filtered out or scored low before: you want it, so look again.
            self.db().delete_job(&p.id())?;
        }
        let mut job = p.to_job();
        let s = self.llm().score(&cvs, &self.scoring_guidance(&profile), &job)?;
        job.status = "queued".into();
        job.score = Some(s.score);
        job.score_potential = s.potential;
        job.track = Some(s.track);
        job.reasoning = Some(s.reasoning);
        job.red_flags = s.red_flags;
        job.keywords = s.keywords;
        job.deadline = deadline_of(&s.deadline, &job.description);
        {
            let db = self.db();
            db.insert_job(&job)?;
            db.log(Some(&job.id), "added", if source == "manual" { "added by hand" } else { "sent from the browser" })?;
        }
        self.tailor(&job.id, None)?;
        Ok(job.id)
    }

    // --- closed postings ---------------------------------------------------------------------

    /// Note that a posting has closed. One still waiting to be tailored is skipped.
    pub fn mark_closed(&self, job: &Job, why: &str) -> R<()> {
        let mut f = vec![("closed_at", Value::from(now()))];
        if job.status == "queued" {
            f.push(("status", "skipped".into()));
        }
        let db = self.db();
        db.update_job(&job.id, &f)?;
        db.log(Some(&job.id), "closed", &format!("the posting has closed: {why}"))
    }

    /// Postings waiting on you whose company board was listed in full and no longer has them.
    fn close_missing(&self, profile: &Profile, complete: &[String], ids: &HashSet<String>) -> R<usize> {
        if complete.is_empty() {
            return Ok(0);
        }
        let prefixes: Vec<String> = crate::sources::boards(profile).iter().map(|(s, n)| crate::sources::board_prefix(s, n)).collect();
        let mut waiting = vec![];
        for s in ["queued", "ready", "approved", "saved"] {
            waiting.extend(self.db().jobs(Some(s), 5000)?);
        }
        let mut n = 0;
        for j in waiting {
            if j.closed_at.is_some() || ids.contains(&j.id) {
                continue;
            }
            // The board it came from: the longest prefix that fits ("acme-corp-" over "acme-").
            let Some(board) = prefixes.iter().filter(|p| j.id.starts_with(p.as_str())).max_by_key(|p| p.len()) else { continue };
            if complete.contains(board) {
                self.mark_closed(&j, "it's no longer on the company's job board")?;
                n += 1;
            }
        }
        Ok(n)
    }

    /// Look at every posting still waiting on you and note the ones that have closed. Once a day.
    pub fn check_postings(&self) -> R<(usize, usize)> {
        let _g = self.claim("check-postings")?;
        let mut list = vec![];
        for s in ["queued", "ready", "approved", "saved"] {
            list.extend(self.db().jobs(Some(s), 500)?);
        }
        let (mut checked, mut closed) = (0, 0);
        for j in list.into_iter().filter(|j| j.closed_at.is_none() && j.url.starts_with("http")).take(80) {
            if crate::sources::posting_closed(&j.url) == Some(true) {
                self.mark_closed(&j, "the posting says it's closed")?;
                closed += 1;
            }
            checked += 1;
        }
        self.remind_deadlines();
        let db = self.db();
        db.set("last.check", &now())?;
        if closed > 0 {
            db.log(None, "check", &format!("{closed} of {checked} postings waiting on you have closed"))?;
            drop(db);
            self.note(
                &format!("{closed} posting{} closed", if closed == 1 { " has" } else { "s have" }),
                "They're marked Closed on the Overview, so you can skip them.",
            );
        }
        Ok((checked, closed))
    }

    // --- asking for changes ------------------------------------------------------------------

    /// Change a tailored CV ("cv") or cover letter ("letter") the way you ask. The version before
    /// is kept, so one revision can be undone.
    pub fn revise(&self, job_id: &str, what: &str, note: &str) -> R<Job> {
        let note = note.trim();
        if note.chars().count() < 3 {
            return err("Say what to change, for example \u{201c}Make the summary shorter\u{201d}.");
        }
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let undo_key = format!("undo:{job_id}:{what}");
        if self.own_file(job_id, what) {
            return err("You're using your own file for this, so Claude can't change it. Edit it yourself, or switch back to Job Hunt's version.");
        }
        match what {
            "cv" => {
                let path = job.cv_path.clone().ok_or_else(|| Error("Tailor this application first.".into()))?;
                let doc = cv::open(Path::new(&path)).map_err(|_| Error("The tailored CV file is missing. Re-tailor to make a new one.".into()))?;
                let edits = self.llm().revise_cv(&profile.name, &doc.numbered(), &job, note)?;
                let own = self.own_words(&job, &profile);
                let map: BTreeMap<usize, String> = edits.iter().map(|e| (e.index, cv::humanize(&e.text, &own))).collect();
                let applied = cv::apply_edits(&doc, &map)?;
                if applied.changes.is_empty() {
                    return Err(Error(if applied.rejected.is_empty() {
                        "Claude didn't change anything. Try saying more about what to change.".into()
                    } else {
                        format!("Claude's changes were refused: {}", applied.rejected.join("; "))
                    }));
                }
                let backup = Path::new(&path).with_extension("before-revision.docx");
                std::fs::copy(&path, &backup)?;
                std::fs::write(&path, &applied.bytes)?;
                let _ = crate::util::docx_to_pdf(Path::new(&path));
                // The changes stay listed against your own CV.
                let mut changes = job.cv_changes.clone();
                for c in &applied.changes {
                    match changes.iter_mut().find(|x| x.after.trim() == c.before.trim()) {
                        Some(x) => x.after = c.after.clone(),
                        None => changes.push(c.clone()),
                    }
                }
                changes.retain(|c| c.before.trim() != c.after.trim());
                let (after, missing) = cv::keyword_coverage(&cv::from_bytes(applied.bytes)?.plain_text(), &job.keywords);
                let kw: HashSet<String> = job.keywords.iter().map(|k| k.to_lowercase()).collect();
                let mut gaps: Vec<String> = job.keyword_gaps.iter().filter(|g| !kw.contains(&g.to_lowercase())).cloned().chain(missing).collect();
                gaps.sort_by_key(|g| g.to_lowercase());
                gaps.dedup_by_key(|g| g.to_lowercase());
                let db = self.db();
                db.set(&undo_key, &json!({ "file": backup, "cv_changes": job.cv_changes, "coverage_after": job.coverage_after, "keyword_gaps": job.keyword_gaps }).to_string())?;
                db.update_job(job_id, &[("cv_changes", json!(changes)), ("coverage_after", after.into()), ("keyword_gaps", json!(gaps))])?;
                let mut detail = format!("CV: \u{201c}{note}\u{201d} ({} paragraph{} changed)", applied.changes.len(), if applied.changes.len() == 1 { "" } else { "s" });
                if !applied.rejected.is_empty() {
                    detail.push_str(&format!("; refused: {}", applied.rejected.join("; ")));
                }
                db.log(Some(job_id), "revised", &detail)?;
            }
            "letter" => {
                let letter = job.cover_letter.clone().filter(|l| !l.trim().is_empty()).ok_or_else(|| Error("There's no cover letter yet. Tailor this application first.".into()))?;
                let cv_text = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
                    .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()))
                    .map(|d| d.plain_text())
                    .unwrap_or_default();
                let new = cv::humanize(&self.llm().revise_letter(&profile.name, &cv_text, &letter, &job, note, &profile.stories)?, &self.own_words(&job, &profile));
                self.db().set(&undo_key, &json!({ "letter": letter }).to_string())?;
                self.save_cover_letter(job_id, &new)?;
                self.db().log(Some(job_id), "revised", &format!("cover letter: \u{201c}{note}\u{201d}"))?;
            }
            _ => return err("Choose the CV or the cover letter."),
        }
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Change one paragraph of the tailored CV to your own wording, or put back the line from your
    /// CV (`text` = the change's original). `current` is the paragraph as it reads now. Can be undone.
    pub fn edit_cv_paragraph(&self, job_id: &str, current: &str, text: &str) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let path = job.cv_path.clone().ok_or_else(|| Error("Tailor this application first.".into()))?;
        if self.own_file(job_id, "cv") {
            return err("You're using your own CV file for this role. Edit it in Word, or switch back to Job Hunt's version.");
        }
        let doc = cv::open(Path::new(&path)).map_err(|_| Error("The tailored CV file is missing. Re-tailor to make a new one.".into()))?;
        let plain = |t: &str| t.replace("**", "").split_whitespace().collect::<Vec<_>>().join(" ");
        let Some(p) = doc.paras.iter().find(|p| plain(&p.plain()) == plain(current)) else {
            return err("That paragraph isn't in the CV any more. Reload the page.");
        };
        let text = text.trim();
        if text.is_empty() {
            return err("Write the paragraph first.");
        }
        let applied = cv::apply_own_edits(&doc, &BTreeMap::from([(p.index, text.to_string())]))?;
        if applied.changes.is_empty() {
            return err("That's how it reads already.");
        }
        let backup = Path::new(&path).with_extension("before-revision.docx");
        std::fs::copy(&path, &backup)?;
        std::fs::write(&path, &applied.bytes)?;
        let _ = std::fs::remove_file(Path::new(&path).with_extension("pdf")); // made again when opened
        // The change list stays against your own CV: this paragraph's entry gets the new text, or
        // goes when it's back to the original.
        let mut changes = job.cv_changes.clone();
        if let Some(c) = changes.iter_mut().find(|c| plain(&c.after) == plain(current)) {
            c.after = text.replace("**", "");
        }
        changes.retain(|c| plain(&c.before) != plain(&c.after));
        let (after, _) = cv::keyword_coverage(&cv::from_bytes(applied.bytes)?.plain_text(), &job.keywords);
        let db = self.db();
        db.set(&format!("undo:{job_id}:cv"), &json!({ "file": backup, "cv_changes": job.cv_changes, "coverage_after": job.coverage_after, "keyword_gaps": job.keyword_gaps }).to_string())?;
        db.update_job(job_id, &[("cv_changes", json!(changes)), ("coverage_after", after.into())])?;
        db.log(Some(job_id), "revised", "CV: a paragraph edited by you")?;
        db.job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Whether this application uses a CV or cover letter file you made yourself.
    pub fn own_file(&self, job_id: &str, what: &str) -> bool {
        !self.secret(&format!("own:{job_id}:{what}")).is_empty()
    }

    /// Use your own CV or cover letter for this role (Word or PDF) instead of Job Hunt's. Job
    /// Hunt's version is kept, so you can switch back.
    pub fn use_own_file(&self, job_id: &str, what: &str, filename: &str, bytes: &[u8]) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let ext = Path::new(filename).extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();
        if !["docx", "pdf"].contains(&ext.as_str()) {
            return err("Use a Word (.docx) or PDF file.");
        }
        if bytes.len() > 10_000_000 {
            return err("That file is over 10 MB.");
        }
        let text = if ext == "docx" {
            Some(cv::from_bytes(bytes.to_vec()).map_err(|_| Error("That Word file couldn't be read. Save it again in Word and retry.".into()))?.plain_text())
        } else if !bytes.starts_with(b"%PDF") {
            return err("That file isn't a PDF.");
        } else {
            None
        };
        let (cv_name, letter_name) = self.file_names(&job);
        let base = if what == "letter" { letter_name } else { cv_name };
        let dir = self.application_dir(&job);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(Path::new(&base).with_extension("").to_string_lossy().to_string() + &format!(" (yours).{ext}"));
        std::fs::write(&path, bytes)?;
        let key = format!("own:{job_id}:{what}");
        // What to go back to: Job Hunt's file, and what was known about it (only the first time).
        let previous = if self.own_file(job_id, what) { self.secret(&key) } else {
            json!({ "path": if what == "letter" { &job.letter_path } else { &job.cv_path }, "cv_changes": job.cv_changes, "coverage_after": job.coverage_after, "cover_letter": job.cover_letter }).to_string()
        };
        let name = self.profile().name; // read before taking the database
        let db = self.db();
        db.set(&key, &previous)?;
        let p = path.to_string_lossy().to_string();
        if what == "letter" {
            // Emailed applications use the letter's text as the email; a PDF's text isn't read.
            let body = text.unwrap_or_else(|| format!("Dear Hiring Team,\n\nPlease find my CV and cover letter for the {} role attached.\n\nAll the best,\n{}", job.title, name));
            db.update_job(job_id, &[("letter_path", p.into()), ("cover_letter", body.into())])?;
        } else {
            let coverage = text.map(|t| cv::keyword_coverage(&t, &job.keywords).0);
            db.update_job(job_id, &[("cv_path", p.into()), ("cv_changes", json!([])), ("coverage_after", coverage.into())])?;
        }
        db.log(Some(job_id), "revised", &format!("your own {} attached: {filename}", if what == "letter" { "cover letter" } else { "CV" }))?;
        db.job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Go back to Job Hunt's tailored CV or letter after using your own.
    pub fn drop_own_file(&self, job_id: &str, what: &str) -> R<()> {
        let key = format!("own:{job_id}:{what}");
        let saved: Value = serde_json::from_str(&self.secret(&key)).map_err(|_| Error("This application already uses Job Hunt's file.".into()))?;
        let path = saved["path"].clone();
        let db = self.db();
        if what == "letter" {
            db.update_job(job_id, &[("letter_path", path), ("cover_letter", saved["cover_letter"].clone())])?;
        } else {
            db.update_job(job_id, &[("cv_path", path), ("cv_changes", saved["cv_changes"].clone()), ("coverage_after", saved["coverage_after"].clone())])?;
        }
        db.delete(&key)?;
        db.log(Some(job_id), "revised", &format!("back to Job Hunt's {}", if what == "letter" { "cover letter" } else { "CV" }))
    }

    /// Whether the last revision of the CV or letter can be undone.
    pub fn can_undo(&self, job_id: &str, what: &str) -> bool {
        !self.secret(&format!("undo:{job_id}:{what}")).is_empty()
    }

    /// Put back the CV or cover letter as it was before the last revision.
    pub fn undo_revision(&self, job_id: &str, what: &str) -> R<()> {
        let key = format!("undo:{job_id}:{what}");
        let saved: Value = serde_json::from_str(&self.secret(&key)).map_err(|_| Error("There's nothing to undo.".into()))?;
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if what == "letter" {
            self.save_cover_letter(job_id, saved["letter"].as_str().unwrap_or(""))?;
        } else {
            let (Some(path), Some(file)) = (job.cv_path.as_deref(), saved["file"].as_str()) else { return err("There's nothing to undo.") };
            std::fs::copy(file, path).map_err(|_| Error("The earlier CV file is gone.".into()))?;
            let _ = std::fs::remove_file(file);
            let _ = crate::util::docx_to_pdf(Path::new(path));
            self.db().update_job(job_id, &[("cv_changes", saved["cv_changes"].clone()), ("coverage_after", saved["coverage_after"].clone()), ("keyword_gaps", saved["keyword_gaps"].clone())])?;
        }
        let db = self.db();
        db.delete(&key)?;
        db.log(Some(job_id), "revised", &format!("{} put back as it was", if what == "letter" { "cover letter" } else { "CV" }))
    }

    // --- following up ---------------------------------------------------------------------------

    /// The follow-up written for an application: {at, to, subject, body, draft}.
    pub fn follow_up(&self, job_id: &str) -> Option<Value> {
        serde_json::from_str(&self.secret(&format!("followup:{job_id}"))).ok()
    }

    /// Applications sent long enough ago with no reply (an automatic acknowledgement doesn't count)
    /// and no follow-up yet.
    pub fn follow_ups_due(&self) -> R<Vec<Job>> {
        let days = self.profile().follow_up_after as i64;
        if days == 0 {
            return Ok(vec![]);
        }
        let emails = self.db().job_emails()?;
        let now = Utc::now();
        let mut out = vec![];
        let applied = self.db().jobs(Some("applied"), 2000)?;
        for j in applied {
            let Some(at) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()) else { continue };
            let age = (now - at.with_timezone(&Utc)).num_days();
            // Too soon, or too long ago to be worth chasing.
            if age < days || age > 45 || j.closed_at.is_some() || self.follow_up(&j.id).is_some() {
                continue;
            }
            let heard = emails.iter().any(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str()));
            if !heard {
                out.push(j);
            }
        }
        out.sort_by(|a, b| a.applied_at.cmp(&b.applied_at));
        Ok(out)
    }

    /// Who a follow-up goes to: where the application was emailed, else whoever wrote about it
    /// (not a no-reply address), else nobody yet.
    fn follow_up_to(&self, job: &Job) -> R<String> {
        if let Some(e) = job.apply_email.as_deref().filter(|e| !e.is_empty()) {
            return Ok(e.to_string());
        }
        let robot = |a: &str| ["noreply", "no-reply", "donotreply", "do-not-reply", "notification", "mailer", "talent-acquisition-system"].iter().any(|w| a.contains(w));
        Ok(self.db().job_emails()?.into_iter().rev()
            .filter(|(id, _, _, _)| *id == job.id)
            .map(|(_, _, from, _)| google::address(&from))
            .find(|a| a.contains('@') && !robot(a))
            .unwrap_or_default())
    }

    /// Write the follow-up for an application, and save it as a Gmail draft when Gmail is connected.
    pub fn write_follow_up(&self, job_id: &str) -> R<Value> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let applied_on = job.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok())
            .map(|d| d.with_timezone(&profile.tz()).format("%B %-d").to_string())
            .unwrap_or_else(|| "recently".into());
        let mut f = self.llm().follow_up(&profile.name, &job, &applied_on)?;
        let own = self.own_words(&job, &profile);
        (f.subject, f.body) = (cv::humanize(&f.subject, &own), cv::humanize(&f.body, &own));
        let to = self.follow_up_to(&job)?;
        let mail = self.mail.read().unwrap().clone();
        let draft = match mail {
            Some(m) => Some(m.draft(&to, &f.subject, &f.body)?),
            None => None,
        };
        let v = json!({ "at": now(), "to": to, "subject": f.subject, "body": f.body, "draft": draft });
        let db = self.db();
        db.set(&format!("followup:{job_id}"), &v.to_string())?;
        db.log(Some(job_id), "followup", if draft.is_some() { "follow-up email saved in your Gmail drafts" } else { "follow-up email written" })?;
        Ok(v)
    }

    pub fn thank_you(&self, job_id: &str) -> Option<Value> {
        self.db().get(&format!("thanks:{job_id}")).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
    }

    /// The thank-you email after an interview, saved as a Gmail draft when Gmail is connected.
    pub fn write_thank_you(&self, job_id: &str, interview: &str) -> R<Value> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let mut f = self.llm().thank_you(&profile.name, &job, interview)?;
        let own = self.own_words(&job, &profile);
        (f.subject, f.body) = (cv::humanize(&f.subject, &own), cv::humanize(&f.body, &own));
        let to = self.follow_up_to(&job)?;
        let mail = self.mail.read().unwrap().clone();
        let draft = match mail {
            Some(m) => Some(m.draft(&to, &f.subject, &f.body)?),
            None => None,
        };
        let v = json!({ "at": now(), "to": to, "subject": f.subject, "body": f.body, "draft": draft });
        let db = self.db();
        db.set(&format!("thanks:{job_id}"), &v.to_string())?;
        db.log(Some(job_id), "thanks", if draft.is_some() { "thank-you email saved in your Gmail drafts" } else { "thank-you email written" })?;
        Ok(v)
    }

    /// Around your interviews: the evening before, the prep sheet is ready and you're reminded;
    /// an hour and a half after it starts, the thank-you email is drafted. Each once per interview.
    pub fn interview_care(&self) -> R<Vec<String>> {
        let tz = self.profile().tz();
        let now = Utc::now();
        let mut done = vec![];
        let list = self.db().calendar_between(&(now - Duration::hours(24)).to_rfc3339(), &(now + Duration::hours(40)).to_rfc3339())?;
        for e in list.into_iter().filter(|e| e.kind == "interview") {
            let (Some(job_id), Ok(start)) = (e.job_id.clone(), chrono::DateTime::parse_from_rfc3339(&e.start).map(|t| t.with_timezone(&Utc))) else { continue };
            let local = start.with_timezone(&tz);
            let company = e.company.clone().unwrap_or_else(|| e.title.clone());
            // From 6 PM the day before (or right away, for one booked later than that).
            let eve = (local.date_naive() - Duration::days(1)).and_hms_opt(18, 0, 0).and_then(|t| t.and_local_timezone(tz).single()).map(|t| t.with_timezone(&Utc)).unwrap_or(start - Duration::hours(16));
            // Keyed by the time too, so a rescheduled interview gets its own reminder.
            let eve_key = format!("eve:{}:{}", e.event_id, start.timestamp());
            if now >= eve && now < start && self.secret(&eve_key).is_empty() {
                self.db().set(&eve_key, &now.to_rfc3339())?;
                if self.prep(&job_id).is_none() && self.claude_ready() {
                    if let Err(err) = self.make_prep(&job_id) {
                        self.db().log(Some(&job_id), "prep:error", &err.0)?;
                    }
                }
                let when = if local.date_naive() == now.with_timezone(&tz).date_naive() { "today" } else { "tomorrow" };
                let body = if self.prep(&job_id).is_some() {
                    "Your prep sheet is ready on the application's Interview tab: likely questions, which of your stories answers each, and what's new at the company."
                } else {
                    "Open the application's Interview tab to write your prep sheet."
                };
                self.note(&format!("Interview {when} at {}: {company}", local.format("%-I:%M %p")), body);
                done.push(format!("eve:{job_id}"));
            }
            let thanks_key = format!("thanked:{}", e.event_id);
            if now >= start + Duration::minutes(90) && self.secret(&thanks_key).is_empty() {
                if self.thank_you(&job_id).is_some_and(|t| t["at"].as_str().unwrap_or("") > e.start.as_str()) {
                    self.db().set(&thanks_key, &now.to_rfc3339())?;
                    continue;
                }
                // Without Claude for now (not set up, or the usage limit): try again in 10 minutes,
                // for as long as the interview is in the last day.
                if !self.claude_ready() || self.limited().is_some() {
                    continue;
                }
                let note = format!("{} on {}", e.title, local.format("%A %B %-d at %-I:%M %p"));
                let result = self.write_thank_you(&job_id, &note);
                if !result.as_ref().is_err_and(|e| e.0.contains("usage limit")) {
                    self.db().set(&thanks_key, &now.to_rfc3339())?;
                }
                match result {
                    Ok(v) => {
                        let where_ = if v["draft"].is_string() { "It's in your Gmail drafts" } else { "It's on the application's Interview tab" };
                        self.note(&format!("Thank-you note for {company}"), &format!("{where_}. Add one detail from the conversation, then send it today."));
                        done.push(format!("thanks:{job_id}"));
                    }
                    Err(err) => self.db().log(Some(&job_id), "thanks:error", &err.0)?,
                }
            }
        }
        Ok(done)
    }

    /// Draft follow-ups for applications that are due one (a few per email check).
    fn draft_follow_ups(&self) -> usize {
        let Ok(due) = self.follow_ups_due() else { return 0 };
        let mut n = 0;
        for j in due.into_iter().take(5) {
            match self.write_follow_up(&j.id) {
                Ok(_) => n += 1,
                Err(e) => {
                    let _ = self.db().log(Some(&j.id), "followup:error", &e.0);
                    break;
                }
            }
        }
        if n > 0 {
            self.note(
                &format!("{n} follow-up{} ready", if n == 1 { "" } else { "s" }),
                "Applications with no reply yet have a short follow-up email waiting in your Gmail drafts. Check it and send.",
            );
        }
        n
    }

    // --- checking your sources ------------------------------------------------------------------

    /// Try every source once and say what each one finds, or why it finds nothing. Saved as it
    /// goes, so the screen can show results while the rest run.
    pub fn test_sources(&self) -> R<Value> {
        self.test_sources_only(None)
    }

    /// What the sidebar shows under the menu: when the next search is, sync and backup, and how
    /// many connections need attention.
    pub fn side_status(&self) -> Value {
        let p = self.profile();
        let tz = p.tz();
        let local = Utc::now().with_timezone(&tz);
        use chrono::Timelike;
        let searched_today = chrono::DateTime::parse_from_rfc3339(&self.secret("last.search")).is_ok_and(|t| t.with_timezone(&tz).date_naive() == local.date_naive());
        // Searched today: tomorrow at the hour. Not yet: today at the hour, or now if that's passed.
        let day = if searched_today { local.date_naive() + Duration::days(1) } else { local.date_naive() };
        let next = if !searched_today && local.hour() >= p.search_hour { None } // due now: it runs within a minute
            else { day.and_hms_opt(p.search_hour, 0, 0).and_then(|t| t.and_local_timezone(tz).earliest()).map(|t| t.to_rfc3339()) };
        let problems = self.connections().map(|c| c.iter().filter(|r| r["status"] == "problem").count()).unwrap_or(0);
        json!({
            "next_search": next,
            "sync_on": crate::sync::enabled(self),
            "last_sync": Some(self.secret("last.sync")).filter(|x| !x.is_empty()),
            "sync_error": Some(self.secret("sync.error")).filter(|x| !x.is_empty() && crate::sync::enabled(self)),
            "syncing": self.is_running("sync"),
            "sync_where": if crate::sync::on_drive(self) { "drive" } else { "folder" },
            "last_backup": Some(self.secret("last.backup")).filter(|x| !x.is_empty()),
            "conn_problems": problems,
            "claude_limited_until": self.limited().map(|t| t.to_rfc3339()),
            "deferred": self.deferred().len(),
        })
    }

    /// Every connection and how it's doing, for Settings → Accounts: {id, name, group, status
    /// ("ok", "problem", "off" or "setup"), detail, at (when last checked), actions}. Status comes
    /// from the connection itself, the last source test, or the last search, whichever is newest.
    /// How each recruiter or job site you turned on is doing: from its last test or the last
    /// search, whichever is newer. state: "ok" (postings found), "quiet" (read, but no postings:
    /// the site may list them in a way Job Hunt can't read), "problem" (an error), "unknown".
    pub fn site_status(&self) -> Vec<Value> {
        let p = self.profile();
        let tests: Vec<Value> = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default();
        let report: Value = serde_json::from_str(&self.secret("last.report")).unwrap_or(Value::Null);
        let searched = self.secret("last.search");
        let problems: Vec<String> = report["source_problems"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        crate::sites::targets(&p.sources.sites, &p.sources.custom_sites).into_iter().map(|t| {
            let test = tests.iter().find(|r| r["site"] == t.id.as_str()).map(|r| {
                let found = r["found"].as_u64().unwrap_or(0);
                let (state, detail) = match r["error"].as_str().filter(|e| !e.is_empty()) {
                    Some(e) => ("problem", e.to_string()),
                    None if found == 0 => ("quiet", "Read the page, but found no postings on it.".to_string()),
                    None => ("ok", format!("{found} postings found{}", r["matching"].as_u64().map(|m| format!(", {m} match your CVs")).unwrap_or_default())),
                };
                (state, detail, r["at"].as_str().unwrap_or("").to_string())
            });
            let search = report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"] == t.name.as_str())).map(|b| {
                let (n, found, failed) = (b["searches"].as_u64().unwrap_or(0), b["found"].as_u64().unwrap_or(0), b["failed"].as_u64().unwrap_or(0));
                let err = problems.iter().find(|x| x.starts_with(&format!("{} ", t.name))).and_then(|x| x.split_once(": ")).map(|x| x.1.to_string());
                if failed >= n.max(1) {
                    ("problem", err.unwrap_or_else(|| "The last search couldn't read it.".into()), searched.clone())
                } else if found == 0 {
                    ("quiet", "Read the page in the last search, but found no postings on it.".into(), searched.clone())
                } else {
                    ("ok", format!("{found} postings in the last search"), searched.clone())
                }
            });
            let (state, detail, at) = match (test, search) {
                (Some(a), Some(b)) => if b.2 > a.2 { b } else { a },
                (Some(a), None) | (None, Some(a)) => a,
                (None, None) => ("unknown", "Not searched yet.".to_string(), String::new()),
            };
            json!({ "id": t.id, "name": t.name, "state": state, "detail": detail, "at": at, "template": t.search })
        }).collect()
    }

    pub fn connections(&self) -> R<Vec<Value>> {
        let p = self.profile();
        let tested: Vec<Value> = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default();
        let report: Value = serde_json::from_str(&self.secret("last.report")).unwrap_or(Value::Null);
        let searched = self.secret("last.search");
        let problems: Vec<String> = report["source_problems"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let keys = self.search_keys();
        // Whichever is newer: the last test of a source, or what the last search said about it.
        let tested_at = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["finished"].as_str().or(v["started"].as_str()).map(String::from)).unwrap_or_default();
        let seen = |id: &str, search_prefix: &str| -> (Option<bool>, String, String) {
            let rows: Vec<&Value> = tested.iter().filter(|r| r["id"] == id || source_row_id(r) == id).collect();
            // Failed means an error came back. Nothing found isn't a failure (older tests saved it as one).
            let failed = |r: &Value| r["ok"] == false && r["skipped"] != true && r["error"].as_str().is_some_and(|e| !e.trim().is_empty());
            let test = rows.iter().find(|r| failed(r)).or(rows.first()).filter(|r| r["skipped"] != true).map(|r| {
                let detail = if !failed(r) {
                    let found = r["found"].as_u64().unwrap_or(0);
                    let hint = r["hint"].as_str().filter(|_| found == 0).map(|h| format!(". {h}")).unwrap_or_default();
                    format!("{found} {}{}{hint}", r["unit"].as_str().unwrap_or("found"), r["matching"].as_u64().map(|m| format!(", {m} match your CVs")).unwrap_or_default())
                } else {
                    format!("{} {}", r["error"].as_str().unwrap_or(""), r["hint"].as_str().unwrap_or("")).trim().to_string()
                };
                (Some(!failed(r)), detail, r["at"].as_str().map(String::from).unwrap_or_else(|| tested_at.clone()))
            });
            // A problem only when every search of that kind failed: one of several failing isn't.
            let tally = report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"].as_str().is_some_and(|n| n.starts_with(search_prefix))));
            let all_failed = tally.is_none_or(|b| b["failed"].as_u64().unwrap_or(0) >= b["searches"].as_u64().unwrap_or(0).max(1));
            let search = if let Some(pr) = problems.iter().find(|x| x.starts_with(search_prefix)).filter(|_| all_failed) {
                Some((Some(false), pr.clone(), searched.clone()))
            } else {
                report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"].as_str().is_some_and(|n| n.starts_with(search_prefix))))
                    .map(|b| (Some(true), format!("{} postings in the last search", b["found"].as_u64().unwrap_or(0)), searched.clone()))
            };
            let latest = match (test, search) {
                (Some(t), Some(s)) => if s.2 > t.2 { s } else { t },
                (Some(t), None) => t,
                (None, Some(s)) => s,
                (None, None) => (None, String::new(), String::new()),
            };
            // Claude's usage limit isn't a fault of the source: it's tried again after the reset.
            if latest.0 == Some(false) && crate::claude_code::is_limit(&latest.1) {
                return (None, "Waiting: your Claude usage limit was reached during the last try. It's tried again after it resets.".into(), latest.2);
            }
            latest
        };
        let row = |id: &str, name: &str, group: &str, status: &str, detail: String, at: String, actions: Value| json!({ "id": id, "name": name, "group": group, "status": status, "detail": detail, "at": at, "actions": actions });
        let mut out = vec![];
        // Claude
        let ready = self.claude_ready();
        out.push(row("claude", "Claude", "Essentials", if ready { "ok" } else { "problem" },
            if ready { format!("Ready, through {}", if self.engine_name() == "api" { "your API key" } else { "Claude Code on this PC" }) } else { "Not ready: nothing can be scored or tailored.".into() },
            String::new(), json!(["checkClaude", "goto:claudeCard"])));
        // Google
        let mail = self.mail.read().unwrap().is_some();
        let client = !self.google_client().is_empty();
        out.push(row("google", "Gmail and Google Calendar", "Essentials", if mail { "ok" } else if client { "problem" } else { "setup" },
            if mail { "Connected: job email is read, replies drafted, interviews booked.".into() } else if client { "Disconnected. Connect again to keep reading job email.".into() } else { "Not connected (optional).".into() },
            self.secret("last.inbox"), json!(if client { json!(["google"]) } else { json!(["goto:googleCard"]) })));
        // Job-search services
        let not_here = |id: &str, name: &str| row(id, name, "Job listings", "na", format!("Doesn't search in {}.", p.country()), String::new(), json!([]));
        for (id, name, has, prefix) in [("jsearch", "Google for Jobs", keys.jsearch.is_some(), "Google for Jobs"), ("jooble", "Jooble", keys.jooble.is_some(), "Jooble"), ("adzuna", "Adzuna", keys.adzuna.is_some(), "Adzuna")] {
            if !p.sources.available(id) {
                out.push(not_here(id, name));
                continue;
            }
            if !has {
                out.push(row(id, name, "Job listings", "setup", "No key (optional).".into(), String::new(), json!(["goto:listingsCard"])));
                continue;
            }
            let (ok, detail, at) = seen(id, prefix);
            out.push(row(id, name, "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { "Key saved; not tested yet.".into() } else { detail }, at, json!(["test", "goto:listingsCard"])));
        }
        // Indeed, through the connector on your Claude account
        if !p.sources.indeed {
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on"])));
        } else if self.engine_name() != "code" {
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", "problem", "Needs Claude Code on this PC; it doesn't work with an API key.".into(), String::new(), json!(["off", "goto:claudeCard"])));
        } else {
            let (ok, detail, at) = seen("indeed", "Indeed");
            let fixing = ok == Some(false);
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if fixing { detail.clone() } else if detail.is_empty() { "On; not tested yet.".into() } else { detail },
                at, json!(if fixing { json!(["test", "link:https://claude.ai/settings/connectors", "off"]) } else { json!(["test", "off"]) })));
        }
        // LinkedIn: its signed-out search, or a scraper on Apify
        if !p.sources.linkedin {
            out.push(row("linkedin", "LinkedIn", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on", "goto:listingsCard"])));
        } else {
            let (ok, detail, at) = seen("linkedin", "LinkedIn");
            let how = if keys.apify.is_some() { "Through Apify." } else { "LinkedIn's public job search, without signing in." };
            out.push(row("linkedin", "LinkedIn", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { format!("{how} Not tested yet.") } else { format!("{how} {detail}") }, at, json!(["test", "off", "goto:listingsCard"])));
        }
        // Canada's Job Bank: its own search page
        if !p.sources.available("jobbank") {
            out.push(not_here("jobbank", "Job Bank (Canada)"));
        } else if !p.sources.jobbank {
            out.push(row("jobbank", "Job Bank (Canada)", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on"])));
        } else {
            let (ok, detail, at) = seen("jobbank", "Job Bank");
            out.push(row("jobbank", "Job Bank (Canada)", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { "jobbank.gc.ca's search, a few searches a day. Not tested yet.".into() } else { detail }, at, json!(["test", "off"])));
        }
        // Recruiters' and job sites' own listings
        let sites = self.site_status();
        if sites.is_empty() {
            out.push(row("agencies", "Recruiters and job sites", "Job listings", "setup", "None turned on. Choose them in Settings \u{2192} Job sources.".into(), String::new(), json!(["goto:sitesCard"])));
        } else {
            let of = |st: &str| sites.iter().filter(|x| x["state"] == st).map(|x| x["name"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>();
            let (ok, quiet, bad) = (of("ok"), of("quiet"), of("problem"));
            // A problem when none of them works; "partial" when some can't be read while others work,
            // so a row never says Working over sites that fail.
            let status = if !ok.is_empty() && !bad.is_empty() { "partial" } else if !ok.is_empty() { "ok" } else if !bad.is_empty() && quiet.is_empty() { "problem" } else { "unknown" };
            let bad_ids: Vec<Value> = sites.iter().filter(|x| x["state"] == "problem").map(|x| x["id"].clone()).collect();
            let mut parts = vec![format!("{} on", sites.len())];
            if !ok.is_empty() { parts.push(format!("{} found postings", ok.len())) }
            if !quiet.is_empty() { parts.push(format!("no postings from {}", quiet.join(", "))) }
            if !bad.is_empty() { parts.push(format!("couldn't read {}", bad.join(", "))) }
            let at = sites.iter().filter_map(|x| x["at"].as_str()).max().unwrap_or("").to_string();
            let actions = if bad_ids.is_empty() { json!(["test", "goto:sitesCard"]) } else { json!(["test", "sitesOff", "goto:sitesCard"]) };
            out.push(row("agencies", "Recruiters and job sites", "Job listings", status, format!("{}. Details in Settings \u{2192} Job sources.", parts.join("; ")), at, actions)
                .as_object().cloned().map(|mut o| { o.insert("data".into(), json!(bad_ids)); Value::Object(o) }).unwrap());
        }
        // Company job boards
        let boards = crate::sources::boards(&p).len();
        let broken: Vec<Value> = report["broken_boards"].as_array().cloned().unwrap_or_default();
        let (bok, bdetail, bat) = seen("boards", "Company job boards");
        out.push(row("boards", "Company job boards", "Job listings",
            if boards == 0 { "setup" } else if !broken.is_empty() || bok == Some(false) { "problem" } else if bok.is_some() { "ok" } else { "unknown" },
            if boards == 0 { "None yet. Find employers near you in What to search for.".into() } else if !broken.is_empty() { format!("{boards} boards; {} no longer exist{}.", broken.len(), if broken.len() == 1 { "s" } else { "" }) } else if bdetail.is_empty() { format!("{boards} boards; not tested yet.") } else { format!("{boards} boards. {bdetail}") },
            bat, json!(if boards == 0 { json!(["goto:sources"]) } else if broken.is_empty() { json!(["test", "goto:sources"]) } else { json!(["test", "removeBroken", "goto:sources"]) })).as_object().cloned().map(|mut o| { o.insert("data".into(), json!(broken)); Value::Object(o) }).unwrap());
        // Job-alert emails
        let (aok, adetail, aat) = seen("alerts", "Job-alert");
        // A test from before you (re)connected Google says nothing about it now.
        let (aok, adetail) = if !aat.is_empty() && aat < self.secret("google.at") { (None, String::new()) } else { (aok, adetail) };
        out.push(row("alerts", "Job-alert emails", "Job listings", if !mail { "setup" } else { match aok { Some(true) => "ok", Some(false) => "problem", None => "unknown" } },
            if !mail { "Needs Gmail connected.".into() } else if adetail.is_empty() { "Read on every email check.".into() } else { adetail }, aat, json!(if mail { json!(["test"]) } else { json!(["goto:googleCard"]) })));
        // Phone, sync, backups
        let phone = !self.secret("phone.topic").is_empty();
        out.push(row("phone", "Phone notifications (ntfy)", "Other", if phone { "ok" } else { "setup" }, if phone { "On.".into() } else { "Off (optional).".into() }, String::new(), json!(if phone { json!(["phoneTest", "goto:calendar"]) } else { json!(["goto:calendar"]) })));
        let sync = crate::sync::enabled(self);
        let synced = self.secret("last.sync");
        let stale = |k: &str, days: i64| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).map(|t| (Utc::now() - t.with_timezone(&Utc)).num_days() >= days).unwrap_or(true);
        out.push(row("sync", "Sync between computers", "Other", if !sync { "setup" } else if stale("last.sync", 2) { "problem" } else { "ok" },
            if !sync { "Off (optional).".into() } else if stale("last.sync", 2) { "Hasn't saved in two days. Check the Google Drive folder.".into() } else { "Up to date.".into() }, synced, json!(if sync { json!(["syncNow", "goto:sync"]) } else { json!(["goto:sync"]) })));
        let never = self.secret("last.backup").is_empty();
        out.push(row("backup", "Backups", "Other", if never { "unknown" } else if stale("last.backup", 3) { "problem" } else { "ok" },
            if self.secret("last.backup").is_empty() { "No backup yet.".into() } else if stale("last.backup", 3) { "No backup in three days.".into() } else { "Daily backups are running.".into() }, self.secret("last.backup"), json!(["backupNow", "goto:sync"])));
        // Sources you can switch off one by one: off ones say so and offer to come back on; the
        // rest offer to go off. Their keys and boards stay saved either way.
        for r in out.iter_mut().filter(|r| SWITCHABLE.contains(&r["id"].as_str().unwrap_or("")) && r["status"] != "setup" && r["status"] != "na") {
            let id = r["id"].as_str().unwrap_or("").to_string();
            let mut acts: Vec<Value> = r["actions"].as_array().cloned().unwrap_or_default();
            acts.retain(|a| a != "on" && a != "off");
            if p.sources.is_off(&id) {
                acts.retain(|a| a != "test" && a.as_str().is_none_or(|s| !s.starts_with("link:")));
                acts.insert(0, json!("on"));
                r["status"] = json!("off");
                r["detail"] = json!("Turned off: not searched. Its settings stay saved for when you turn it back on.");
            } else {
                acts.push(json!("off"));
            }
            r["actions"] = json!(acts);
        }
        Ok(out)
    }

    /// test_sources for one connection ("boards", "adzuna", "jsearch", "jooble", "indeed" or
    /// "alerts"), or all of them. The other rows of the last test stay as they were.
    pub fn test_sources_only(&self, only: Option<&str>) -> R<Value> {
        let _g = self.claim("test-sources")?;
        let p = self.profile();
        // A connection you turned off isn't tested.
        let want = |k: &str| only.is_none_or(|o| o == k) && !p.sources.is_off(k);
        let started = now();
        // Testing one: keep the other rows from the last test.
        let kept: Vec<Value> = match only {
            Some(o) => serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
                .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default()
                .into_iter().filter(|r| source_row_id(r) != o).collect(),
            None => vec![],
        };
        let mut results: Vec<Value> = vec![];
        let save = |results: &Vec<Value>, done: bool| {
            let all: Vec<Value> = kept.iter().chain(results.iter()).cloned().map(|mut r| {
                r["id"] = json!(source_row_id(&r));
                if r.get("at").is_none() {
                    r["at"] = json!(now());
                }
                r
            }).collect();
            let v = json!({ "started": started, "finished": if done { Some(now()) } else { None }, "results": all });
            let _ = self.db().set("sources.test", &v.to_string());
            v
        };
        save(&results, false);
        let matching = |list: &[Posting]| list.iter().filter(|x| prefilter(x, &p).is_none()).count();
        let timed = |name: String, kind: &str, run: &dyn Fn() -> Result<Vec<Posting>, String>, hint: &str| {
            let t = std::time::Instant::now();
            let mut v = match run() {
                Ok(list) => json!({ "name": name, "kind": kind, "ok": true, "found": list.len(), "matching": matching(&list),
                    "hint": if list.is_empty() { "Nothing open there right now." } else if matching(&list) == 0 { "Nothing matches your CVs' job titles or keywords right now." } else { "" } }),
                Err(e) => json!({ "name": name, "kind": kind, "ok": false, "error": e, "hint": hint }),
            };
            v["seconds"] = json!(t.elapsed().as_secs());
            v
        };
        let c = crate::sources::http();
        for (src, name) in crate::sources::boards(&p).into_iter().filter(|_| want("boards")) {
            let hint = match src {
                "workday" => "Use the careers site's link as it appears in your browser, like https://company.wd3.myworkdayjobs.com/Careers.",
                "smartrecruiters" => "Use the name after jobs.smartrecruiters.com/ in the company's careers link (capitals matter).",
                "workable" => "Use the name after apply.workable.com/ in the company's careers link.",
                _ => "Check the name: it's the part at the end of the company's careers link. Or remove it.",
            };
            let mut row = timed(crate::sources::board_label(src, &name), "board", &|| crate::sources::fetch_board(&c, &p, src, &name).map(|r| r.0), hint);
            row["source"] = json!(src);
            row["board"] = json!(name);
            results.push(row);
            save(&results, false);
        }
        let first_title = p.tracks.iter().flat_map(|t| t.titles.iter()).find(|t| !t.trim().is_empty()).cloned();
        let place = p.search_places().into_iter().next().unwrap_or_default();
        let (id, key) = (self.secret("adzuna.id"), self.secret("adzuna.key"));
        if want("adzuna") { results.push(match (&first_title, id.is_empty() || key.is_empty()) {
            (_, true) => json!({ "name": "Adzuna", "kind": "search", "ok": false, "skipped": true, "error": "No Adzuna key.", "hint": "Add an Adzuna key in Settings \u{2192} Job sources to search thousands of listings for your titles." }),
            (None, _) => json!({ "name": "Adzuna", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & career." }),
            (Some(t), false) => timed(format!("Adzuna \u{201c}{t}\u{201d}{}", if place.is_empty() { String::new() } else { format!(" in {place}") }), "search",
                &|| crate::sources::adzuna(&c, &id, &key, &p.sources.adzuna_country, t, &place, p.sources.adzuna_days), "Check the Adzuna app ID and key in Settings \u{2192} Job sources."),
        }); }
        save(&results, false);
        let keys = self.search_keys();
        let first = crate::sources::searches(&p, 1).into_iter().next();
        let country = p.sources.adzuna_country.clone();
        if want("jsearch") { results.push(match (&keys.jsearch, &first) {
            (None, _) => json!({ "name": "Google for Jobs", "kind": "search", "ok": false, "skipped": true, "error": "No JSearch key.", "hint": "Postings from LinkedIn, Indeed, Glassdoor and company sites, through Google for Jobs. Add a key in Settings \u{2192} Job sources." }),
            (_, None) => json!({ "name": "Google for Jobs", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & career." }),
            (Some((provider, key)), Some((t, place))) => {
                let q = if place.is_empty() { t.clone() } else { format!("{t} in {place}") };
                timed(format!("Google for Jobs \u{201c}{q}\u{201d}"), "search", &|| crate::sources::jsearch(&c, provider, key, &q, &country), "Check the key and where it's from (OpenWeb Ninja or RapidAPI) in Settings \u{2192} Job sources.")
            }
        }); }
        save(&results, false);
        if want("jooble") { results.push(match (&keys.jooble, &first) {
            (None, _) => json!({ "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No Jooble key.", "hint": "Listings gathered from many job sites. Add a key in Settings \u{2192} Job sources." }),
            (_, None) => json!({ "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "" }),
            (Some(key), Some((t, place))) => timed(format!("Jooble \u{201c}{t}\u{201d}{}", if place.is_empty() { String::new() } else { format!(" in {place}") }), "search",
                &|| crate::sources::jooble(&c, key, t, place), "Check the Jooble key in Settings \u{2192} Job sources."),
        }); }
        save(&results, false);
        if want("indeed") { results.push(if !p.sources.indeed {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Tick \u{201c}Search Indeed\u{201d} below to include it." })
        } else if self.engine_name() != "code" {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "error": "Needs Claude Code on this PC.", "hint": "Choose Claude Code in Settings \u{2192} Accounts, or turn Indeed off below." })
        } else if let Some(t) = &first_title {
            let at = if place.is_empty() { p.country() } else { place.clone() };
            timed(format!("Indeed \u{201c}{t}\u{201d} in {at}"), "search",
                &|| self.llm().indeed(&[(t.clone(), at.clone())], &p.sources.adzuna_country.to_uppercase(), 2).map(|l| l.into_iter().map(indeed_posting).collect()).map_err(|e| e.0),
                "")
        } else {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & career." })
        }); }
        save(&results, false);
        if want("linkedin") { results.push(if !p.sources.linkedin {
            json!({ "name": "LinkedIn", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Turn LinkedIn on in Settings \u{2192} Job sources to include it." })
        } else if let Some((t, w, r)) = crate::sources::linkedin_searches(&p, 1).into_iter().next() {
            match &keys.apify {
                Some((token, actor)) => timed(format!("LinkedIn (through Apify) \u{201c}{t}\u{201d} in {w}"), "search",
                    &|| crate::sources::apify_linkedin(&c, token, actor, &[(t.clone(), w.clone(), r)], 10),
                    "Check the Apify token and the scraper's name in Settings \u{2192} Job sources, and that your Apify account has credit."),
                None => timed(format!("LinkedIn \u{201c}{t}\u{201d} in {w}"), "search", &|| crate::sources::linkedin(&c, &t, &w, r),
                    "LinkedIn may be turning away searches from this connection for now; it usually passes in a day. For steadier results, add an Apify token in Settings \u{2192} Job sources."),
            }
        } else {
            json!({ "name": "LinkedIn", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & career." })
        }); }
        save(&results, false);
        if want("jobbank") || (only == Some("jobbank")) { results.push(if !p.sources.jobbank {
            json!({ "name": "Job Bank", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Turn Job Bank on in Settings \u{2192} Job sources to include it." })
        } else if let Some((t, w)) = crate::sources::searches(&p, 1).into_iter().next() {
            timed(format!("Job Bank \u{201c}{t}\u{201d}{}", if w.is_empty() { String::new() } else { format!(" in {w}") }), "search", &|| crate::sources::jobbank(&c, &t, &w),
                "Job Bank may be limiting searches from this connection for now; it usually passes in a day.")
        } else {
            json!({ "name": "Job Bank", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & career." })
        }); }
        save(&results, false);
        if want("agencies") {
            let tp = crate::sources::searches(&p, 1);
            for t in crate::sites::targets(&p.sources.sites, &p.sources.custom_sites) {
                let (title, w) = crate::sites::searches_for(&t, &tp).into_iter().next().unwrap_or_default();
                let label = if title.is_empty() { format!("{} (all jobs)", t.name) } else { format!("{} \u{201c}{title}\u{201d}", t.name) };
                let mut row = timed(label, "site", &|| crate::sites::search(&c, &t, &title, &w),
                    "Its search address may have changed, or it may block automated reading. Turn it off in Settings \u{2192} Job sources if it keeps failing.");
                row["site"] = json!(t.id);
                if row["ok"] == true && row["found"] == 0 {
                    row["hint"] = json!("Read the page, but found no postings on it: the site may list them in a way Job Hunt can't read.");
                }
                results.push(row);
                save(&results, false);
            }
        }
        // The search services are tried with one search each, to spare your plans' requests.
        let titles = crate::sources::searches(&p, 1000);
        let n_titles = titles.iter().map(|t| t.0.to_lowercase()).collect::<HashSet<_>>().len();
        let n_places = p.search_places().len().max(1);
        if n_titles > 1 || n_places > 1 {
            let all = format!("A test with one search. Real searches also cover your other job titles{} ({n_titles} titles in all; Google for Jobs takes the first 6 searches, Jooble 8).", if n_places > 1 { format!(" and places") } else { String::new() });
            for r in results.iter_mut().filter(|r| r["kind"] == "search" && r["ok"] == true) {
                let hint = r["hint"].as_str().unwrap_or("").to_string();
                r["hint"] = json!(if hint.is_empty() { all.clone() } else { format!("{hint} {all}") });
            }
        }
        save(&results, false);
        let mail = self.mail.read().unwrap().clone();
        if want("alerts") { results.push(match mail {
            None => json!({ "name": "Job-alert emails", "kind": "email", "ok": false, "skipped": true, "error": "Gmail isn't connected.", "hint": "Connect Google in Settings \u{2192} Accounts to read LinkedIn, Indeed and Glassdoor job alerts." }),
            Some(m) => match m.recent(ALERTS_QUERY, 50) {
                Ok(ids) => json!({ "name": "Job-alert emails (LinkedIn, Indeed, Glassdoor, Job Bank)", "kind": "email",
                    // Gmail answered: it works, whether or not any alerts came this week.
                    "ok": true, "found": ids.len(), "unit": "emails this week",
                    "hint": if ids.is_empty() { "None this week. On LinkedIn, Indeed, Glassdoor and Job Bank (jobbank.gc.ca), set up job alerts for your titles sent to this Gmail address; Job Hunt reads them on every email check." } else { "" } }),
                Err(e) => json!({ "name": "Job-alert emails", "kind": "email", "ok": false, "error": e.0, "hint": "Reconnect Google in Settings \u{2192} Accounts." }),
            },
        }); }
        Ok(save(&results, true))
    }

    // --- deadlines ------------------------------------------------------------------------------

    /// Postings waiting on you whose last day to apply is within `days`, soonest first.
    pub fn closing_soon(&self, days: i64) -> R<Vec<Job>> {
        let today = Utc::now().with_timezone(&self.profile().tz()).date_naive();
        let mut out = vec![];
        for s in ["queued", "ready", "approved", "saved"] {
            let list = self.db().jobs(Some(s), 2000)?;
            out.extend(list.into_iter().filter(|j| j.closed_at.is_none() && j.deadline.as_deref()
                .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                .is_some_and(|d| d >= today && (d - today).num_days() <= days)));
        }
        out.sort_by(|a, b| a.deadline.cmp(&b.deadline));
        Ok(out)
    }

    /// A notice when a posting waiting on you closes in two days or less (once per posting).
    fn remind_deadlines(&self) {
        let Ok(soon) = self.closing_soon(2) else { return };
        for j in soon {
            let key = format!("deadline-told:{}", j.id);
            if !self.secret(&key).is_empty() {
                continue;
            }
            let _ = self.db().set(&key, &now());
            let when = j.deadline.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).map(|d| d.format("%A %B %-d").to_string()).unwrap_or_default();
            let what = if j.status == "approved" { "Submit it on the company's site" } else { "Review and approve it in Job Hunt" };
            self.note(&format!("Closes {when}: {}", j.company), &format!("{} at {}. {what} before then.", j.title, j.company));
        }
    }

    // --- application forms ----------------------------------------------------------------------

    /// Answers written for an application's form questions: [{question, answer}].
    pub fn answers(&self, job_id: &str) -> Option<Value> {
        serde_json::from_str(&self.secret(&format!("answers:{job_id}"))).ok()
    }

    /// Draft answers to an application form's questions (one per line), or to the usual ones.
    pub fn answer_questions(&self, job_id: &str, questions: &str) -> R<Value> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let cv = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
            .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()))
            .map(|d| d.plain_text())
            .ok_or_else(|| Error("No CV uploaded yet. Add one in CV & career.".into()))?;
        let mut facts = profile.application_facts.trim().to_string();
        if let Some(min) = profile.min_salary {
            facts.push_str(&format!("\nMinimum yearly salary they'd accept: {min:.0}"));
        }
        let mut list = self.llm().answer_questions(&profile.name, &cv, &job, questions, &facts, &profile.stories)?;
        let own = self.own_words(&job, &profile);
        for a in &mut list {
            a.answer = cv::humanize(&a.answer, &own);
        }
        let v = json!(list);
        let db = self.db();
        db.set(&format!("answers:{job_id}"), &v.to_string())?;
        db.log(Some(job_id), "answers", &format!("{} application question{} answered", list.len(), if list.len() == 1 { "" } else { "s" }))?;
        Ok(v)
    }

    // --- offers -----------------------------------------------------------------------------------

    /// The offer you entered and the advice on it: {offer, advice, at}.
    pub fn offer(&self, job_id: &str) -> Option<Value> {
        serde_json::from_str(&self.secret(&format!("offer:{job_id}"))).ok()
    }

    /// Weigh an offer against the posting, your minimum and any other offers, with a counter-offer email.
    pub fn offer_advice(&self, job_id: &str, offer: &str) -> R<Value> {
        if offer.trim().chars().count() < 10 {
            return err("Paste the offer's details: salary, bonus, benefits, vacation, start date.");
        }
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let mut context = match profile.min_salary {
            Some(m) => format!("Their minimum yearly salary: {m:.0}."),
            None => "They haven't set a minimum salary.".into(),
        };
        let others: Vec<Job> = self.db().jobs(Some("offer"), 50)?.into_iter().filter(|j| j.id != job_id).collect();
        for o in others {
            if let Some(v) = self.offer(&o.id) {
                context.push_str(&format!("\nOther offer: {} at {}: {}", o.title, o.company, v["offer"].as_str().unwrap_or("").replace('\n', "; ")));
            }
        }
        let advice = self.llm().offer_advice(&profile.name, &job, offer, &context)?;
        let v = json!({ "offer": offer.trim(), "advice": advice, "at": now() });
        let db = self.db();
        db.set(&format!("offer:{job_id}"), &v.to_string())?;
        db.log(Some(job_id), "offer", "offer advice written")?;
        Ok(v)
    }

    // --- contacts -----------------------------------------------------------------------------------

    /// People at the company: [{name, role, email, link, note, message}].
    pub fn contacts(&self, job_id: &str) -> Vec<Value> {
        serde_json::from_str(&self.secret(&format!("contacts:{job_id}"))).unwrap_or_default()
    }

    pub fn save_contacts(&self, job_id: &str, list: &[Value]) -> R<()> {
        let clean: Vec<Value> = list.iter().filter(|c| c["name"].as_str().is_some_and(|n| !n.trim().is_empty())).map(|c| {
            let f = |k: &str| c[k].as_str().unwrap_or("").trim().to_string();
            json!({ "name": f("name"), "role": f("role"), "email": f("email"), "link": f("link"), "note": f("note"), "message": f("message") })
        }).collect();
        self.db().set(&format!("contacts:{job_id}"), &json!(clean).to_string())
    }

    /// Write a short message to one of the contacts (a LinkedIn note, or an email when there's an address).
    pub fn write_outreach(&self, job_id: &str, index: usize) -> R<String> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let mut list = self.contacts(job_id);
        let c = list.get(index).cloned().ok_or_else(|| Error("That contact is gone.".into()))?;
        let profile = self.profile();
        let cv = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
            .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()))
            .map(|d| d.plain_text())
            .unwrap_or_default();
        let who = ["name", "role", "email", "note"].iter().map(|k| format!("{k}: {}", c[*k].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n");
        let msg = cv::humanize(&self.llm().outreach(&profile.name, &cv, &job, &who)?, &self.own_words(&job, &profile));
        list[index]["message"] = json!(msg);
        self.save_contacts(job_id, &list)?;
        self.db().log(Some(job_id), "contact", &format!("message written to {}", c["name"].as_str().unwrap_or("")))?;
        Ok(msg)
    }

    // --- coaching -------------------------------------------------------------------------------------

    /// Claude's read of your results so far: what's working and what to change. Kept with its date.
    pub fn write_insights(&self) -> R<Value> {
        let r = self.results()?;
        if r["funnel"]["sent"].as_u64().unwrap_or(0) < 3 {
            return err("Send a few more applications first: with fewer than 3 there's nothing to learn from yet.");
        }
        let profile = self.profile();
        let (jobs, emails) = {
            let db = self.db();
            (db.jobs(None, 1_000_000)?, db.job_emails()?)
        };
        let lines: Vec<String> = jobs.iter().filter(|j| j.applied_at.is_some() || ["applied", "interviewing", "offer", "rejected"].contains(&j.status.as_str())).take(150).map(|j| {
            let replies = emails.iter().filter(|(id, c, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&c.as_str())).count();
            let cv = profile.tracks.iter().find(|t| Some(&t.name) == j.track.as_ref()).map(|t| t.label.as_str()).unwrap_or("");
            format!("- {} at {} | fit {} | CV {} | via {} | now {} | {} replies", j.title, j.company, j.score.map(|s| s.to_string()).unwrap_or("-".into()), cv, j.source, j.status, replies)
        }).collect();
        let text = self.llm().insights(&profile.name, &serde_json::to_string_pretty(&r).unwrap_or_default(), &lines.join("\n"))?;
        let v = json!({ "at": now(), "text": text });
        let db = self.db();
        db.set("insights", &v.to_string())?;
        db.log(None, "insights", "Claude looked at what's working")?;
        Ok(v)
    }

    /// Claude's suggestions for where to take your career, from your CVs and your search so far.
    /// Kept with its date.
    pub fn write_career_paths(&self) -> R<Value> {
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("Add your CV first (CV & career).");
        }
        let r = self.results()?;
        let cv_text: String = cvs.iter().map(|(name, text)| {
            let label = profile.tracks.iter().find(|t| &t.name == name).map(|t| t.label.as_str()).unwrap_or(name);
            format!("<cv name=\"{label}\">\n{text}\n</cv>")
        }).collect::<Vec<_>>().join("\n\n");
        let titles: Vec<String> = profile.tracks.iter().flat_map(|t| t.titles.iter().cloned()).collect();
        let evidence = format!(
            "Searching in: {}\nTitles searched: {}\nMinimum pay: {}\nApplications: {}\nBy kind of role: {}\nBy pay band: {}\nWhat the roles found pay (by kind, yearly midpoints): {}",
            profile.search_places().join("; "), titles.join(", "),
            profile.min_salary.map(|m| format!("{m:.0}")).unwrap_or_else(|| "not set".into()),
            r["funnel"], r["by_title"], r["by_pay"], r["market_pay"]);
        let plan = self.llm().career_paths(&profile.name, &cv_text, &evidence)?;
        let v = json!({ "at": now(), "advice": plan.advice, "paths": plan.paths });
        let db = self.db();
        db.set("career", &v.to_string())?;
        db.log(None, "career", "Claude suggested career paths")?;
        Ok(v)
    }

    /// Search for more titles with one of your CVs (from a career path).
    pub fn add_titles(&self, track: &str, titles: &[String]) -> R<usize> {
        let mut p = self.profile();
        let t = p.tracks.iter_mut().find(|t| t.name == track).ok_or_else(|| Error("That CV no longer exists.".into()))?;
        let mut added = 0;
        for title in titles.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            if !t.titles.iter().any(|x| x.eq_ignore_ascii_case(title)) {
                t.titles.push(title.to_string());
                added += 1;
            }
        }
        self.save_profile(&p)?;
        Ok(added)
    }

    // --- health ---------------------------------------------------------------------------------------

    /// Anything that needs fixing for Job Hunt to keep working: [{level, text, link}].
    pub fn health(&self) -> Vec<Value> {
        let mut out = vec![];
        let add = |out: &mut Vec<Value>, level: &str, text: String, link: &str| out.push(json!({ "level": level, "text": text, "link": link }));
        let act = |out: &mut Vec<Value>, level: &str, text: String, action: &str, data: Value| out.push(json!({ "level": level, "text": text, "action": action, "data": data }));
        // A problem with a button that fixes it right there: (label, action, task for "run").
        let fix = |out: &mut Vec<Value>, level: &str, text: String, label: &str, action: &str, task: &str| out.push(json!({ "level": level, "text": text, "fix": { "label": label, "act": action, "task": task } }));
        let age_days = |k: &str| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).ok().map(|t| (Utc::now() - t.with_timezone(&Utc)).num_days());
        if !self.claude_ready() {
            add(&mut out, "problem", if self.engine_name() == "api" { "No Claude API key, so nothing can be scored or tailored.".into() } else { "Claude Code isn't ready on this computer, so nothing can be scored or tailored.".into() }, "#settings/connections");
        }
        if let Some(t) = self.limited() {
            add(&mut out, "warn", format!("Your Claude usage limit is reached. It resets {}; searching, scoring and tailoring wait until then, and pick up by themselves.", crate::util::reset_time(t, chrono::Utc::now())), "#settings/connections");
        }
        // Google connected, but your data is only on this computer: one click keeps it in your Drive.
        if self.files.read().unwrap().is_some() && !crate::sync::enabled(self) && self.secret("sync.declined").is_empty() {
            fix(&mut out, "warn", "Your Job Hunt data is only on this computer. Keep it backed up and synced in your own Google Drive, to pick up where you left off on any PC.".into(), "Turn on", "syncOn", "");
        }
        if !self.secret("google.token").is_empty() && !self.google_client().is_empty() && self.mail.read().unwrap().is_none() {
            add(&mut out, "problem", "Google is disconnected: job email isn't being read and follow-ups aren't drafted. Reconnect it.".into(), "#settings/connections");
        }
        if let Some(r) = serde_json::from_str::<Value>(&self.secret("last.report")).ok() {
            let broken: Vec<Value> = r["broken_boards"].as_array().cloned().unwrap_or_default();
            if !broken.is_empty() {
                let names: Vec<String> = broken.iter().map(|b| format!("{} ({})", b["name"].as_str().unwrap_or(""), b["source"].as_str().unwrap_or(""))).collect();
                act(&mut out, "warn", format!("{} company board{} no longer exist{}: {}. Remove {} and add others?", broken.len(), if broken.len() == 1 { "" } else { "s" }, if broken.len() == 1 { "s" } else { "" }, names.join(", "), if broken.len() == 1 { "it" } else { "them" }), "removeBroken", json!(broken));
            }
            // The same status as Connections shows: a later test that worked clears a failed search.
            let broken: Vec<String> = self.connections().unwrap_or_default().iter()
                .filter(|c| c["group"] == "Job listings" && c["status"] == "problem" && c["id"] != "boards")
                .filter_map(|c| c["name"].as_str().map(String::from)).collect();
            if !broken.is_empty() {
                add(&mut out, "warn", format!("{} isn't working. See why and fix it in Settings \u{2192} Job sources.", broken.join(", ")), "#settings/sources");
            }
            if r["errors"].as_array().is_some_and(|e| e.iter().any(|x| x.as_str().is_some_and(|t| t.contains("usage limit")))) {
                add(&mut out, "warn", "The last search hit your Claude usage limit, so some postings wait for the next search.".into(), "#overview");
            }
        }
        match age_days("last.search") {
            Some(d) if d >= 2 && self.claude_ready() => fix(&mut out, "warn", format!("No job search for {d} days. Is Job Hunt starting with Windows (Settings \u{2192} App)?"), "Search now", "run", "search"),
            _ => {}
        }
        if crate::sync::enabled(self) && age_days("last.sync").is_none_or(|d| d >= 2) {
            fix(&mut out, "warn", "Sync between computers hasn't saved in two days. Check it in Settings \u{2192} Sync & backup.".into(), "Sync now", "syncNow", "");
        }
        if age_days("last.backup").is_some_and(|d| d >= 3) {
            fix(&mut out, "warn", "No backup in three days. Check it in Settings \u{2192} Sync & backup.".into(), "Back up now", "backupNow", "");
        }
        // Problems logged in the last two days, one line per kind.
        let since = (Utc::now() - Duration::days(2)).to_rfc3339();
        let errors = self.db().errors_since(&since).unwrap_or_default();
        let mut seen = HashSet::new();
        for e in errors {
            let kind = e.kind.trim_end_matches(":error").to_string();
            // The usage limit has its own notice above.
            if crate::claude_code::is_limit(&e.detail) {
                continue;
            }
            // Fixed since: the same task worked afterwards, or (for Google's) Google was connected again.
            let at = |k: &str| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).ok();
            let when = chrono::DateTime::parse_from_rfc3339(&e.created_at).ok();
            let ok_key = match kind.as_str() { "search" => "last.search", "inbox" => "last.inbox", "sync" => "last.sync", "backup" => "last.backup", _ => "last.check" };
            let google = kind == "inbox" || kind == "sync" && self.secret("sync.where") == "drive";
            let fixed = |k: &str| matches!((when, at(k)), (Some(w), Some(t)) if t > w);
            if fixed(ok_key) || google && fixed("google.at") {
                continue;
            }
            if ["search", "inbox", "sync", "backup", "check"].contains(&kind.as_str()) && seen.insert(kind.clone()) {
                let what = match kind.as_str() { "search" => "Job search", "inbox" => "Email check", "sync" => "Sync", "backup" => "Backup", _ => "Posting check" };
                let detail: String = e.detail.chars().take(160).collect();
                match kind.as_str() {
                    // Trying again doesn't help without a CV: the link goes where you add one.
                    _ if detail.contains("No CV") => add(&mut out, "warn", format!("{what} is waiting for your CV. Add one in CV & career."), "#cvs"),
                    "search" | "inbox" => fix(&mut out, "warn", format!("{what} had a problem: {detail}"), "Try again", "run", &kind),
                    _ => add(&mut out, "warn", format!("{what} had a problem: {detail}"), "#overview"),
                }
            }
        }
        out
    }

    // --- the week -------------------------------------------------------------------------------------

    /// The weekly review (Sunday evening, or Monday morning): a short notice, and the whole review
    /// emailed to you when Gmail is connected: what you sent against your goal, who replied, what's
    /// going quiet, what to do this week, and the best new roles to pick.
    pub fn weekly_summary(&self) -> R<String> {
        let profile = self.profile();
        let tz = profile.tz();
        let today = Utc::now().with_timezone(&tz).date_naive();
        let weeks = self.db().applied_per_week(2, today, tz)?;
        // On Sunday, this week so far is the week to review. Any other day (Monday's review, or a
        // Sunday one caught up later), the week before.
        use chrono::Datelike;
        let sunday = self.secret("weekly.day") != "mon" && today.weekday() == chrono::Weekday::Sun;
        let last = if sunday { weeks.last() } else { weeks.first() }.map(|w| w.1).unwrap_or(0);
        let from = (Utc::now() - Duration::days(7)).to_rfc3339();
        let replies: Vec<(String, String)> = {
            let emails = self.db().job_emails()?;
            emails.into_iter()
                .filter(|(_, c, _, at)| at.as_str() >= from.as_str() && !["application_received", "job_alert", "not_job"].contains(&c.as_str()))
                .map(|(id, c, _, _)| (id, c)).collect()
        };
        let upcoming = self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 20)?;
        let ready = self.db().jobs(Some("ready"), 500)?.len();
        let follow = self.follow_ups_due()?.len();
        let soon = self.closing_soon(7)?;
        let quiet = self.quiet_applications()?;
        let goal = if profile.weekly_goal > 0 { format!(" (your goal is {})", profile.weekly_goal) } else { String::new() };
        let span = if sunday { "This week" } else { "Last week" };
        let mut parts = vec![format!("{span} you sent {last} application{}{goal}.", if last == 1 { "" } else { "s" })];
        if !replies.is_empty() {
            parts.push(format!("{} repl{} came in.", replies.len(), if replies.len() == 1 { "y" } else { "ies" }));
        }
        if !upcoming.is_empty() {
            parts.push(format!("{} interview{} coming up.", upcoming.len(), if upcoming.len() == 1 { "" } else { "s" }));
        }
        let mut todo = vec![];
        if ready > 0 {
            todo.push(format!("{ready} ready to approve"));
        }
        if follow > 0 {
            todo.push(format!("{follow} to follow up"));
        }
        if !quiet.is_empty() {
            todo.push(format!("{} quiet for 4+ weeks to close", quiet.len()));
        }
        if !soon.is_empty() {
            todo.push(format!("{} closing this week", soon.len()));
        }
        if !todo.is_empty() {
            parts.push(format!("{}: {}.", if sunday { "Next week" } else { "This week" }, todo.join(", ")));
        }
        let text = parts.join(" ");
        // The best new roles of the week: waiting to be picked, still open, nothing to doubt.
        let reposts = self.db().reposts()?;
        let now = Utc::now();
        let mut picks: Vec<Job> = self.db().jobs(Some("queued"), 2000)?.into_iter()
            .filter(|j| j.found_at.as_str() >= from.as_str() && j.closed_at.is_none())
            .filter(|j| posting_warnings(j, reposts.get(&j.id).copied().unwrap_or(0), now).is_empty())
            .collect();
        picks.sort_by_key(|j| std::cmp::Reverse(j.score.unwrap_or(0)));
        picks.truncate(5);
        // The whole review, for email.
        let job_line = |j: &Job| format!("- {} at {}{}{}", j.title, j.company, j.score.map(|s| format!(" (fit {s})")).unwrap_or_default(),
            if j.url.is_empty() { String::new() } else { format!("\n  {}", j.url) });
        let mut body = vec![format!("Hi {},", profile.name.split_whitespace().next().unwrap_or("there")), String::new(), text.clone()];
        if !picks.is_empty() {
            body.push(format!("\nThe best new roles this week, to pick in Job Hunt:\n{}", picks.iter().map(job_line).collect::<Vec<_>>().join("\n")));
        }
        if !upcoming.is_empty() {
            body.push(format!("\nInterviews coming up:\n{}", upcoming.iter().take(8).map(|i| format!("- {} {}", i.company.clone().unwrap_or_else(|| i.title.clone()),
                chrono::DateTime::parse_from_rfc3339(&i.start).map(|t| t.with_timezone(&tz).format("%a %b %-d, %-I:%M %p").to_string()).unwrap_or_default())).collect::<Vec<_>>().join("\n")));
        }
        if !replies.is_empty() {
            let mut names = vec![];
            for (id, cat) in &replies {
                let job = self.db().job(id)?;
                if let Some(j) = job {
                    let line = format!("- {}: {}", j.company, cat.replace('_', " "));
                    if !names.contains(&line) {
                        names.push(line);
                    }
                }
            }
            body.push(format!("\nWho replied:\n{}", names.join("\n")));
        }
        if !quiet.is_empty() {
            body.push(format!("\nGone quiet (applied 4+ weeks ago, no reply; close them as No response or follow up):\n{}", quiet.iter().take(8).map(|j| format!("- {} at {}", j.title, j.company)).collect::<Vec<_>>().join("\n")));
        }
        if !soon.is_empty() {
            body.push(format!("\nClosing within a week:\n{}", soon.iter().take(8).map(job_line).collect::<Vec<_>>().join("\n")));
        }
        if let Ok(r) = self.results() {
            let best = r["by_title"].as_array().into_iter().flatten()
                .filter(|g| g["sent"].as_u64().unwrap_or(0) >= 3 && g["interviews"].as_u64().unwrap_or(0) > 0)
                .max_by(|a, b| {
                    let rate = |g: &Value| g["interviews"].as_f64().unwrap_or(0.0) / g["sent"].as_f64().unwrap_or(1.0);
                    rate(a).total_cmp(&rate(b))
                });
            if let Some(g) = best {
                body.push(format!("\nWhat's working: {} roles turn into interviews most often ({} of {} sent).", g["name"].as_str().unwrap_or(""), g["interviews"], g["sent"]));
            }
        }
        body.push("\nJob Hunt".into());
        let db = self.db();
        db.set("last.weekly", &now.to_rfc3339())?;
        db.log(None, "weekly", &text)?;
        drop(db);
        self.note("Your week in Job Hunt", &text);
        let to = self.weekly_to();
        let mail = self.mail.read().unwrap().clone();
        if let (Some(m), false) = (mail, to.is_empty()) {
            let subject = format!("Your week in Job Hunt: {last} sent, {} repl{}", replies.len(), if replies.len() == 1 { "y" } else { "ies" });
            if let Err(e) = m.send(&to, &subject, &body.join("\n"), &[]) {
                self.db().log(None, "weekly:error", &format!("couldn't email the review: {}", e.0))?;
            }
        }
        Ok(text)
    }

    /// Where the weekly review is emailed: your address in your profile, else your Gmail address.
    /// Empty when it isn't emailed (turned off, or Gmail isn't connected).
    pub fn weekly_to(&self) -> String {
        if self.secret("weekly.email") == "0" || self.mail.read().unwrap().is_none() {
            return String::new();
        }
        let to = Some(self.profile().email.trim().to_string()).filter(|e| e.contains('@')).unwrap_or_else(|| self.secret("google.email"));
        if to.contains('@') { to } else { String::new() }
    }

    // --- a spreadsheet copy -------------------------------------------------------------------

    /// Your applications as a CSV spreadsheet (everything except postings skipped or turned down).
    pub fn export_csv(&self) -> R<String> {
        let profile = self.profile();
        let tz = profile.tz();
        let jobs = self.db().jobs(None, 1_000_000)?;
        let day = |iso: &Option<String>| iso.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&tz).format("%Y-%m-%d").to_string()).unwrap_or_default();
        let mut out = String::from("\u{feff}");
        out.push_str("Company,Job title,Stage,Fit,Salary,Location,Source,Found,Applied,Closed,Posting,CV,Notes\r\n");
        for j in jobs.iter().filter(|j| !["skipped", "dismissed"].contains(&j.status.as_str())) {
            let stage = match j.status.as_str() {
                "queued" => "Waiting to tailor",
                "ready" => "Ready to approve",
                "approved" => "Approved",
                "applied" => "Applied",
                "interviewing" => "Interviewing",
                "offer" => "Offer",
                "rejected" => "Rejected",
                "no_response" => "No response",
                "saved" => "Saved for later",
                other => other,
            };
            let cv = profile.tracks.iter().find(|t| Some(&t.name) == j.track.as_ref()).map(|t| t.label.clone()).unwrap_or_default();
            let row = [
                j.company.clone(), j.title.clone(), stage.to_string(), j.score.map(|s| s.to_string()).unwrap_or_default(),
                j.salary.clone().unwrap_or_default(), j.location.clone(), j.source.clone(), day(&Some(j.found_at.clone())), day(&j.applied_at),
                day(&j.closed_at), j.url.clone(), cv, j.notes.clone(),
            ];
            out.push_str(&row.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(","));
            out.push_str("\r\n");
        }
        Ok(out)
    }

    // --- what works -----------------------------------------------------------------------------

    /// How applications turn out, overall and by CV, source and fit score.
    pub fn results(&self) -> R<Value> {
        let profile = self.profile();
        let (jobs, emails, stages) = {
            let db = self.db();
            (db.jobs(None, 1_000_000)?, db.job_emails()?, db.stages_reached()?)
        };
        let mut reached: std::collections::HashMap<&str, HashSet<&str>> = std::collections::HashMap::new();
        for (id, st) in &stages {
            reached.entry(id.as_str()).or_default().insert(st.as_str());
        }
        let mut mail: std::collections::HashMap<&str, Vec<(&str, &str)>> = std::collections::HashMap::new();
        for (id, cat, _, at) in &emails {
            mail.entry(id.as_str()).or_default().push((cat.as_str(), at.as_str()));
        }
        #[derive(Default, Clone)]
        struct Row {
            sent: u64,
            replied: u64,
            interviews: u64,
            offers: u64,
        }
        let mut groups: Vec<BTreeMap<String, Row>> = vec![BTreeMap::new(); 5];
        let mut total = Row::default();
        let (mut scored, mut tailored) = (0, 0);
        let mut waits: Vec<i64> = vec![];
        for j in &jobs {
            scored += j.score.is_some() as u64;
            tailored += j.cv_path.is_some() as u64;
            let been = |s: &str| j.status == s || reached.get(j.id.as_str()).is_some_and(|r| r.contains(s));
            let sent = j.applied_at.is_some() || ["applied", "interviewing", "offer", "rejected"].iter().any(|s| been(s));
            if !sent {
                continue;
            }
            let their: Vec<&(&str, &str)> = mail.get(j.id.as_str()).map(|m| m.iter().filter(|(c, _)| !["application_received", "job_alert", "not_job"].contains(c)).collect()).unwrap_or_default();
            let interview = been("interviewing") || been("offer") || their.iter().any(|(c, _)| c.starts_with("interview") || *c == "assessment");
            let row = Row {
                sent: 1,
                replied: (interview || been("rejected") || been("offer") || !their.is_empty()) as u64,
                interviews: interview as u64,
                offers: been("offer") as u64,
            };
            if let (Some(a), Some((_, first))) = (j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()), their.first()) {
                if let Ok(f) = chrono::DateTime::parse_from_rfc3339(first) {
                    waits.push((f - a).num_days().max(0));
                }
            }
            let cv = profile.tracks.iter().find(|t| Some(&t.name) == j.track.as_ref()).map(|t| t.label.clone()).or(j.track.clone()).unwrap_or_else(|| "Unknown".into());
            let fit = match j.score {
                Some(s) if s >= 90 => "90–100",
                Some(s) if s >= 80 => "80–89",
                Some(s) if s >= 70 => "70–79",
                Some(s) if s >= 60 => "60–69",
                Some(_) => "Below 60",
                None => "Not scored",
            };
            for (g, key) in groups.iter_mut().zip([cv, j.source.clone(), fit.to_string(), title_family(&j.title, &profile), pay_band(j).to_string()]) {
                let r = g.entry(key).or_default();
                r.sent += row.sent;
                r.replied += row.replied;
                r.interviews += row.interviews;
                r.offers += row.offers;
            }
            total.sent += row.sent;
            total.replied += row.replied;
            total.interviews += row.interviews;
            total.offers += row.offers;
        }
        let rows = |g: &BTreeMap<String, Row>| {
            let mut v: Vec<Value> = g.iter().map(|(k, r)| json!({ "name": k, "sent": r.sent, "replied": r.replied, "interviews": r.interviews, "offers": r.offers })).collect();
            v.sort_by_key(|x| std::cmp::Reverse(x["sent"].as_u64().unwrap_or(0)));
            v
        };
        waits.sort();
        let mut by_fit = rows(&groups[2]);
        let order = ["90–100", "80–89", "70–79", "60–69", "Below 60", "Not scored"];
        by_fit.sort_by_key(|x| order.iter().position(|o| x["name"] == *o).unwrap_or(9));
        let mut by_pay = rows(&groups[4]);
        by_pay.sort_by_key(|x| PAY_BANDS.iter().position(|o| x["name"] == *o).unwrap_or(9));
        // What the roles you're finding pay, by kind of role: every posting that states it.
        let mut stated: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        for j in jobs.iter().filter(|j| j.score.is_some()) {
            if let Some(mid) = pay_mid(j) {
                stated.entry(title_family(&j.title, &profile)).or_default().push(mid);
            }
        }
        let market: Vec<Value> = stated.into_iter().filter(|(_, v)| v.len() >= 2).map(|(k, mut v)| {
            v.sort_by(|a, b| a.total_cmp(b));
            json!({ "name": k, "postings": v.len(), "median": v[v.len() / 2], "low": v[0], "high": v[v.len() - 1] })
        }).collect();
        // Pay across the roles you tailored: the stated yearly ranges, against your minimum.
        let mut pay: Vec<(f64, f64, &Job)> = jobs.iter()
            .filter(|j| j.cv_path.is_some() && j.status != "dismissed")
            .filter_map(|j| {
                let text = j.salary.clone().or_else(|| crate::sources::salary_from_text(&j.description).map(|s| s.0))?;
                crate::sources::salary_range(&text).map(|(lo, hi)| (lo, hi, j))
            })
            .collect();
        pay.sort_by(|a, b| (a.0 + a.1).total_cmp(&(b.0 + b.1)));
        let tailored_n = jobs.iter().filter(|j| j.cv_path.is_some() && j.status != "dismissed").count();
        let mid = |x: &(f64, f64, &Job)| (x.0 + x.1) / 2.0;
        let pay_json = if pay.is_empty() {
            json!({ "tailored": tailored_n, "stated": 0, "minimum": profile.min_salary })
        } else {
            json!({
                "tailored": tailored_n,
                "stated": pay.len(),
                "low": pay.iter().map(|x| x.0).fold(f64::MAX, f64::min),
                "high": pay.iter().map(|x| x.1).fold(0.0, f64::max),
                "median": mid(&pay[pay.len() / 2]),
                "minimum": profile.min_salary,
                "below_minimum": profile.min_salary.map(|m| pay.iter().filter(|x| x.1 < m).count()),
                "roles": pay.iter().rev().take(8).map(|(lo, hi, j)| json!({ "id": j.id, "title": j.title, "company": j.company, "low": lo, "high": hi, "status": j.status })).collect::<Vec<_>>(),
            })
        };
        Ok(json!({
            "pay": pay_json,
            "funnel": { "found": jobs.len(), "scored": scored, "tailored": tailored, "sent": total.sent, "replied": total.replied, "interviews": total.interviews, "offers": total.offers },
            "days_to_reply": waits.get(waits.len() / 2),
            "by_cv": rows(&groups[0]),
            "by_source": rows(&groups[1]),
            "by_fit": by_fit,
            "by_title": rows(&groups[3]),
            "by_pay": by_pay,
            "market_pay": market,
            "insights": serde_json::from_str::<Value>(&self.secret("insights")).ok(),
            "career": serde_json::from_str::<Value>(&self.secret("career")).ok(),
        }))
    }

    // --- CVs ----------------------------------------------------------------------------------

    /// A CV as an editable Word file: Word files are used as they are (unless `convert`); PDFs and
    /// text are converted by Claude, word for word, into Job Hunt's clean template.
    fn cv_bytes(&self, filename: &str, bytes: &[u8], convert: bool) -> R<(Vec<u8>, String)> {
        let lower = filename.to_lowercase();
        if bytes.starts_with(b"PK") {
            let doc = cv::from_bytes(bytes.to_vec())?;
            if !convert {
                return Ok((bytes.to_vec(), "docx".into()));
            }
            let structured = self.llm().convert_cv(&CvSource::Text(doc.plain_text()))?;
            return Ok((cv::build_docx(&structured)?, "docx-converted".into()));
        }
        if bytes.starts_with(b"%PDF") {
            let structured = self.llm().convert_cv(&CvSource::Pdf(bytes.to_vec()))?;
            return Ok((cv::build_docx(&structured)?, "pdf".into()));
        }
        if lower.ends_with(".doc") || bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
            return err("That's an old .doc Word file. Open it in Word and save it as .docx (or PDF), then upload that.");
        }
        let text = String::from_utf8(bytes.to_vec()).map_err(|_| Error("Job Hunt can read Word (.docx), PDF and plain-text CVs.".into()))?;
        if text.trim().len() < 200 {
            return err("That file has too little text to be a CV.");
        }
        let structured = self.llm().convert_cv(&CvSource::Text(text))?;
        Ok((cv::build_docx(&structured)?, "text".into()))
    }

    /// Add a CV as a new track. Claude names it and suggests titles and keywords to search for.
    pub fn add_cv(&self, filename: &str, bytes: &[u8], convert: bool) -> R<Track> {
        let (docx, kind) = self.cv_bytes(filename, bytes, convert)?;
        let doc = cv::from_bytes(docx.clone())?;
        let suggestion = self.llm().cv_profile(&doc.plain_text()).unwrap_or_default();
        let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "CV".into());
        let label = if suggestion.label.trim().is_empty() { stem.replace(['_', '-'], " ") } else { suggestion.label.trim().to_string() };
        let mut profile = self.profile();
        let id = profile.new_track_id(&label);
        std::fs::create_dir_all(self.data.join("cv").join("originals"))?;
        std::fs::write(self.cv_path(&id), &docx)?;
        let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "bin".into());
        std::fs::write(self.data.join("cv").join("originals").join(format!("{id}.{ext}")), bytes)?;
        let track = Track {
            name: id,
            label,
            titles: suggestion.titles,
            keywords: suggestion.keywords,
            kind,
            original: filename.to_string(),
            letter_style: "standard".into(),
            areas: suggestion.areas,
        };
        if profile.name.trim().is_empty() {
            profile.name = suggestion.name.trim().to_string();
        }
        if profile.email.trim().is_empty() {
            profile.email = suggestion.email.trim().to_string();
        }
        profile.tracks.push(track.clone());
        self.save_profile(&profile)?;
        self.db().log(None, "cv", &format!("added {} ({})", track.label, filename))?;
        Ok(track)
    }

    /// Replace a CV's file, keeping its name, titles and keywords.
    pub fn replace_cv(&self, id: &str, filename: &str, bytes: &[u8], convert: bool) -> R<Track> {
        let mut profile = self.profile();
        let Some(pos) = profile.tracks.iter().position(|t| t.name == id) else { return err("That CV no longer exists.") };
        let (docx, kind) = self.cv_bytes(filename, bytes, convert)?;
        std::fs::create_dir_all(self.data.join("cv").join("originals"))?;
        std::fs::write(self.cv_path(id), &docx)?;
        let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "bin".into());
        std::fs::write(self.data.join("cv").join("originals").join(format!("{id}.{ext}")), bytes)?;
        profile.tracks[pos].kind = kind;
        profile.tracks[pos].original = filename.to_string();
        let t = profile.tracks[pos].clone();
        self.save_profile(&profile)?;
        self.db().log(None, "cv", &format!("replaced {} ({})", t.label, filename))?;
        Ok(t)
    }

    /// Convert an existing Word CV to Job Hunt's editable template (for layouts it can't edit).
    pub fn convert_existing_cv(&self, id: &str) -> R<Track> {
        let bytes = std::fs::read(self.cv_path(id)).map_err(|_| Error("That CV's file is missing.".into()))?;
        let original = self.profile().tracks.iter().find(|t| t.name == id).map(|t| t.original.clone()).unwrap_or_else(|| format!("{id}.docx"));
        self.replace_cv(id, &original, &bytes, true)
    }

    pub fn remove_cv(&self, id: &str) -> R<()> {
        let mut profile = self.profile();
        let before = profile.tracks.len();
        profile.tracks.retain(|t| t.name != id);
        if profile.tracks.len() == before {
            return err("That CV no longer exists.");
        }
        self.save_profile(&profile)?;
        let _ = std::fs::remove_file(self.cv_path(id));
        self.db().log(None, "cv", &format!("removed {id}"))?;
        Ok(())
    }

    /// Ask Claude again for this CV's titles and keywords.
    pub fn suggest_for_cv(&self, id: &str) -> R<Track> {
        let doc = cv::open(&self.cv_path(id))?;
        let s = self.llm().cv_profile(&doc.plain_text())?;
        let mut profile = self.profile();
        let Some(t) = profile.tracks.iter_mut().find(|t| t.name == id) else { return err("That CV no longer exists.") };
        // New ideas are added to yours: titles you typed or kept stay.
        for x in s.titles {
            if !t.titles.iter().any(|y| y.eq_ignore_ascii_case(&x)) {
                t.titles.push(x);
            }
        }
        for x in s.keywords {
            if !t.keywords.iter().any(|y| y.eq_ignore_ascii_case(&x)) {
                t.keywords.push(x);
            }
        }
        t.areas = s.areas;
        let t = t.clone();
        self.save_profile(&profile)?;
        Ok(t)
    }

    // --- tailoring ------------------------------------------------------------------------------

    pub fn application_dir(&self, job: &Job) -> PathBuf {
        self.data.join("applications").join(format!("{}-{}", slug(&format!("{} {}", job.company, job.title), 60), short_hash(&job.id)))
    }

    /// "Ibrahim Al-Taha - Acme.docx" and "Ibrahim Al-Taha - Acme - Cover Letter.docx": what an
    /// employer sees when they download them.
    fn file_names(&self, job: &Job) -> (String, String) {
        let name = crate::util::file_words(&self.profile().name);
        let company = crate::util::file_words(&job.company);
        let base = match (name.is_empty(), company.is_empty()) {
            (false, false) => format!("{name} - {company}"),
            (false, true) => name,
            (true, false) => format!("CV - {company}"),
            (true, true) => "CV".into(),
        };
        (format!("{base}.docx"), format!("{base} - Cover Letter.docx"))
    }

    pub fn tailor(&self, job_id: &str, track: Option<&str>) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let t = profile.track(track.or(job.track.as_deref())).cloned().ok_or_else(|| Error("No CV uploaded yet. Add one in CV & career.".into()))?;
        let doc = cv::open(&self.cv_path(&t.name)).map_err(|_| Error(format!("No CV for the “{}” track yet. Upload it in CV & career.", t.label)))?;
        let mut result = self.llm().tailor(&profile.name, &doc.numbered(), &job, &job.keywords, &profile.stories, &t.letter_style)?;
        // Take out AI tells Claude slipped in (your CV's own style stays).
        let own = format!("{}\n{}", doc.plain_text(), profile.stories);
        result.cover_letter = cv::humanize(&result.cover_letter, &own);
        result.email_subject = cv::humanize(&result.email_subject, &own);

        let edits: BTreeMap<usize, String> = result.edits.iter().map(|e| (e.index, cv::humanize(&e.text, &own))).collect();
        let applied = cv::apply_edits(&doc, &edits)?;
        let dir = self.application_dir(&job);
        std::fs::create_dir_all(&dir)?;
        let (cv_name, letter_name) = self.file_names(&job);
        let (cv_path, letter_path) = (dir.join(cv_name), dir.join(letter_name));
        std::fs::write(&cv_path, &applied.bytes)?;
        std::fs::write(&letter_path, cv::cover_letter(&doc, &result.cover_letter, self.signature().as_deref())?)?;
        // Old PDF copies would show the previous version; new ones are made when you open them
        // (making them here took Word a while for every application).
        for p in [&cv_path, &letter_path] {
            let _ = std::fs::remove_file(p.with_extension("pdf"));
        }

        let tailored_text = cv::from_bytes(applied.bytes)?.plain_text();
        let (before, _) = cv::keyword_coverage(&doc.plain_text(), &job.keywords);
        let (after, missing) = cv::keyword_coverage(&tailored_text, &job.keywords);

        let mut gaps: Vec<String> = result.keyword_gaps.iter().chain(missing.iter()).cloned().collect();
        gaps.sort_by_key(|g| g.to_lowercase());
        gaps.dedup_by_key(|g| g.to_lowercase());

        let db = self.db();
        db.update_job(job_id, &[
            ("status", "ready".into()),
            ("track", t.name.clone().into()),
            ("cv_path", cv_path.to_string_lossy().to_string().into()),
            ("letter_path", letter_path.to_string_lossy().to_string().into()),
            ("cover_letter", result.cover_letter.clone().into()),
            ("email_subject", result.email_subject.clone().into()),
            ("coverage_before", before.into()),
            ("coverage_after", after.into()),
            ("keyword_gaps", json!(gaps)),
            ("cv_changes", json!(applied.changes)),
            ("score_after", Value::Null),
        ])?;
        let mut detail = format!("{} CV edits, keywords {:.0}% → {:.0}%", applied.changes.len(), before * 100.0, after * 100.0);
        if !applied.rejected.is_empty() {
            detail.push_str(&format!("; refused: {}", applied.rejected.join("; ")));
        }
        db.log(Some(job_id), "tailored", &detail)?;
        drop(db);
        // The tailored CV scored the same way your CV was (one more request), once the
        // application is already waiting for you; on failure the page shows the score before.
        if let Ok(s) = self.llm().score(&[(t.name.clone(), tailored_text)], &self.scoring_guidance(&profile), &job) {
            let db = self.db();
            db.update_job(job_id, &[("score_after", s.score.into())])?;
            if let Some(a) = job.score {
                db.log(Some(job_id), "rescored", &format!("fit {a} before tailoring, {} after", s.score))?;
            }
        }
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Take roles you haven't acted on yet (waiting to tailor, or ready to approve) out of your
    /// lists when they're outside your locations, e.g. after you change them. Returns how many.
    pub fn drop_outside_locations(&self) -> R<usize> {
        let profile = self.profile();
        let mut jobs = self.db().jobs(Some("queued"), 5000)?;
        jobs.extend(self.db().jobs(Some("ready"), 5000)?);
        let mut n = 0;
        for j in jobs {
            if self.chosen(&j.id) {
                continue; // you picked it yourself
            }
            let p = Posting { location: j.location.clone(), remote: j.location.to_lowercase().contains("remote"), ..Posting::default() };
            if let Some(why) = crate::filters::outside_locations(&p, &profile) {
                let db = self.db();
                db.update_job(&j.id, &[("status", "skipped".into()), ("reasoning", format!("Filtered out: {why}").into())])?;
                db.log(Some(&j.id), "skipped", &format!("outside your locations: {why}"))?;
                n += 1;
            }
        }
        Ok(n)
    }

    /// Where each application is: the steps it has reached with their dates, how long since the
    /// last one, and what happens next and who it's waiting on. `only` limits it to one job.
    pub fn tracker(&self, only: Option<&str>) -> R<Vec<Value>> {
        const TRACKED: [&str; 8] = ["ready", "approved", "applied", "interviewing", "offer", "rejected", "no_response", "saved"];
        let profile = self.profile();
        let jobs: Vec<Job> = match only {
            Some(id) => self.db().job(id)?.into_iter().collect(),
            None => {
                let mut v = vec![];
                for s in TRACKED {
                    v.extend(self.db().jobs(Some(s), 2000)?);
                }
                v
            }
        };
        let emails = self.db().job_emails()?;
        let interviews = self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 500)?;
        let due: HashSet<String> = self.follow_ups_due().unwrap_or_default().into_iter().map(|j| j.id).collect();
        let now = Utc::now();
        let days_since = |iso: &str| chrono::DateTime::parse_from_rfc3339(iso).ok().map(|t| (now - t.with_timezone(&Utc)).num_days());
        let mut out = vec![];
        for j in jobs {
            let history = self.db().history(&j.id)?; // newest first
            let first = |pred: &dyn Fn(&crate::db::Event) -> bool| history.iter().rev().find(|e| pred(e)).map(|e| e.created_at.clone());
            let reached = |st: &str| first(&|e| e.kind == format!("status:{st}"));
            let tailored = first(&|e| e.kind == "tailored");
            let applied = j.applied_at.clone().or_else(|| reached("applied"));
            let reply = emails.iter().find(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str())).map(|e| e.3.clone())
                .or_else(|| reached("interviewing")).or_else(|| reached("rejected")).or_else(|| reached("offer"));
            let interview = reached("interviewing");
            let outcome = reached("offer").map(|d| ("Offer", d)).or_else(|| reached("rejected").map(|d| ("Rejected", d)));
            let steps = json!([
                { "step": "Found", "at": j.found_at },
                { "step": "Tailored", "at": tailored },
                { "step": "Applied", "at": applied },
                { "step": "Reply", "at": reply },
                { "step": "Interview", "at": interview },
                { "step": outcome.as_ref().map(|o| o.0).unwrap_or("Offer"), "at": outcome.as_ref().map(|o| o.1.clone()), "bad": outcome.as_ref().is_some_and(|o| o.0 == "Rejected") },
            ]);
            // The latest step, and the latest thing that happened at all.
            let last_step = steps.as_array().unwrap().iter().rev().find(|s| s["at"].is_string()).map(|s| (s["step"].as_str().unwrap_or("").to_string(), s["at"].as_str().unwrap_or("").to_string()));
            let next_interview = interviews.iter().find(|i| i.job_id.as_deref() == Some(&j.id)).map(|i| i.start.clone());
            let wait = days_since(applied.as_deref().unwrap_or("")).unwrap_or(0);
            let (next, who) = match j.status.as_str() {
                "ready" => ("Check and approve the tailored CV and letter".to_string(), "you"),
                "approved" => ("Submit it on the company's site, then mark it applied".to_string(), "you"),
                "applied" if due.contains(&j.id) => (format!("No reply in {wait} days: send a follow-up"), "you"),
                "applied" if self.follow_up(&j.id).is_some() => ("Waiting for a reply (you followed up)".to_string(), "them"),
                "applied" => {
                    let left = profile.follow_up_after as i64 - wait;
                    (if profile.follow_up_after > 0 && left > 0 { format!("Waiting for a reply; follow up in {left} day{}", if left == 1 { "" } else { "s" }) } else { "Waiting for a reply".to_string() }, "them")
                }
                "interviewing" => match &next_interview {
                    Some(_) => ("Interview".to_string(), "you"), // the screen adds the date
                    None => ("Waiting to hear back after the interview".to_string(), "them"),
                },
                "offer" => ("Weigh the offer and reply".to_string(), "you"),
                "rejected" => ("Closed".to_string(), "done"),
                "no_response" => ("Closed: no reply".to_string(), "done"),
                "saved" => ("Saved for later".to_string(), "later"),
                _ => (String::new(), "done"),
            };
            out.push(json!({
                "id": j.id, "title": j.title, "company": j.company, "location": j.location, "status": j.status,
                "score": j.score, "score_after": j.score_after, "score_potential": j.score_potential, "deadline": j.deadline, "closed_at": j.closed_at, "url": j.url,
                "apply_email": j.apply_email,
                "steps": steps,
                "last_step": last_step.as_ref().map(|l| l.0.clone()),
                "last_at": last_step.as_ref().map(|l| l.1.clone()),
                "days_since": last_step.as_ref().and_then(|l| days_since(&l.1)),
                "next": next, "who": who, "next_interview": next_interview,
                "follow_up_due": due.contains(&j.id),
            }));
        }
        Ok(out)
    }

    /// The morning summary, once a day after the daily search: what's waiting for you today. Says
    /// nothing when nothing is.
    pub fn morning_digest(&self) -> R<Option<String>> {
        let _ = self.db().set("last.digest", &now());
        let c = self.db().counts()?;
        let n = |k: &str| c.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
        let tomorrow_end = Utc::now() + Duration::hours(36);
        // Bound first: the time zone comes from your profile, which needs the database too.
        let (tz, upcoming) = (self.profile().tz(), self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 10)?);
        let interviews: Vec<String> = upcoming.into_iter()
            .filter(|i| chrono::DateTime::parse_from_rfc3339(&i.start).is_ok_and(|t| t.with_timezone(&Utc) < tomorrow_end))
            .map(|i| format!("{} {}", i.company.unwrap_or_else(|| i.title.clone()), chrono::DateTime::parse_from_rfc3339(&i.start).map(|t| t.with_timezone(&tz).format("%a %-I:%M %p").to_string()).unwrap_or_default()))
            .collect();
        let plural = |k: i64, one: &str, many: &str| format!("{k} {}", if k == 1 { one } else { many });
        let mut parts = vec![];
        if !interviews.is_empty() {
            parts.push(format!("Interview{}: {}", if interviews.len() == 1 { "" } else { "s" }, interviews.join(", ")));
        }
        if n("ready") > 0 {
            parts.push(plural(n("ready"), "application to review", "applications to review"));
        }
        if n("queued") > 0 {
            parts.push(plural(n("queued"), "new role to pick from", "new roles to pick from"));
        }
        if n("approved") > 0 {
            parts.push(plural(n("approved"), "to submit on the company's site", "to submit on company sites"));
        }
        let follow = self.follow_ups_due()?.len() as i64;
        if follow > 0 {
            parts.push(plural(follow, "follow-up due", "follow-ups due"));
        }
        let closing = self.closing_soon(3)?.len() as i64;
        if closing > 0 {
            parts.push(plural(closing, "posting closes in 3 days", "postings close in 3 days"));
        }
        if parts.is_empty() {
            return Ok(None);
        }
        let text = parts.join(" · ");
        self.note("Today in Job Hunt", &text);
        Ok(Some(text))
    }

    /// Applications that went quiet: applied 4+ weeks ago with no reply, and either followed up
    /// already, with follow-ups off, or 6+ weeks old. Worth closing as No response.
    pub fn quiet_applications(&self) -> R<Vec<Job>> {
        let profile = self.profile();
        let emails = self.db().job_emails()?;
        let applied = self.db().jobs(Some("applied"), 5000)?;
        let now = Utc::now();
        let mut out = vec![];
        for j in applied {
            let Some(at) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()) else { continue };
            let age = (now - at.with_timezone(&Utc)).num_days();
            let heard = emails.iter().any(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str()));
            if age >= 28 && !heard && (self.follow_up(&j.id).is_some() || profile.follow_up_after == 0 || age >= 42) {
                out.push(j);
            }
        }
        Ok(out)
    }

    /// Your own writing for a job (the CV it's tailored from, and your stories), so humanize leaves
    /// alone the style you chose yourself.
    pub(crate) fn own_words(&self, job: &Job, profile: &Profile) -> String {
        let cv = profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()).map(|d| d.plain_text()).unwrap_or_default();
        format!("{cv}\n{}", profile.stories)
    }

    /// Whether you picked this posting yourself (Tailor anyway): filters then leave it alone.
    fn chosen(&self, job_id: &str) -> bool {
        self.db().history(job_id).map(|h| h.iter().any(|e| e.kind == "chosen")).unwrap_or(false)
    }

    /// Tailor a posting whatever its score, location or stage: one you skipped, saved, said no to
    /// or that the filters left out. It's scored first if it never was (to pick your CV and the
    /// keywords), and kept from then on, whatever the filters say.
    pub fn tailor_anyway(&self, job_id: &str, track: Option<&str>) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if ["skipped", "dismissed", "saved", "queued"].contains(&job.status.as_str()) && !self.chosen(job_id) {
            self.db().log(Some(job_id), "chosen", "you chose to tailor it")?;
        }
        if job.score.is_none() {
            let profile = self.profile();
            let cvs = self.cv_texts(&profile);
            if cvs.is_empty() {
                return err("No CV uploaded yet. Add one in CV & career.");
            }
            let s = self.llm().score(&cvs, &self.scoring_guidance(&profile), &job)?;
            let db = self.db();
            db.update_job(job_id, &[
                ("score", s.score.into()), ("score_potential", json!(s.potential)), ("track", s.track.clone().into()), ("reasoning", s.reasoning.into()),
                ("red_flags", json!(s.red_flags)), ("keywords", json!(s.keywords)),
            ])?;
            db.log(Some(job_id), "scored", &format!("{} on the {} track (before tailoring it anyway)", s.score, s.track))?;
        }
        self.tailor(job_id, track)
    }

    /// The postings a rescore would look at again: "skipped" (filtered out or scored low) or
    /// "waiting" (cleared the bar, not tailored yet). Never anything you've acted on.
    fn rescore_pool(&self, group: &str) -> R<Vec<Job>> {
        let status = match group {
            "waiting" => "queued",
            "skipped" => "skipped",
            _ => return err("Choose which postings to score again."),
        };
        let mut jobs = self.db().jobs(Some(status), 100_000)?;
        jobs.retain(|j| j.closed_at.is_none());
        jobs.sort_by(|a, b| b.found_at.cmp(&a.found_at)); // newest first
        Ok(jobs)
    }

    /// How a rescore would go, without running it: postings in the group, how many the filters
    /// now leave out (no Claude needed), how many Claude would score, and this run's cap.
    pub fn rescore_plan(&self, group: &str) -> R<Value> {
        let profile = self.profile();
        let pool = self.rescore_pool(group)?;
        let need = pool.iter().filter(|j| prefilter(&posting_of(j), &profile).is_none()).count();
        let cap = profile.max_scored_per_run.max(1);
        Ok(json!({ "postings": pool.len(), "filtered": pool.len() - need, "to_score": need, "this_run": need.min(cap), "cap": cap }))
    }

    /// Score postings found before again, against your CVs and settings as they are now, up to
    /// the per-search cap (newest first). Returns how it went.
    pub fn rescore(&self, group: &str) -> R<Value> {
        let _g = self.claim("rescore")?;
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & career.");
        }
        let guidance = self.scoring_guidance(&profile);
        let cap = profile.max_scored_per_run.max(1);
        let (mut scored, mut cleared, mut filtered, mut failed) = (0, 0, 0, 0);
        for j in self.rescore_pool(group)? {
            if let Some(why) = prefilter(&posting_of(&j), &profile) {
                if j.status != "skipped" || j.reasoning.as_deref() != Some(&format!("Filtered out: {why}")) {
                    let db = self.db();
                    db.update_job(&j.id, &[("status", "skipped".into()), ("reasoning", format!("Filtered out: {why}").into())])?;
                    db.log(Some(&j.id), "skipped", &format!("rescored: {why}"))?;
                }
                filtered += 1;
                continue;
            }
            if scored + failed >= cap {
                break;
            }
            match self.llm().score(&cvs, &guidance, &j) {
                Ok(s) => {
                    scored += 1;
                    let status = if s.score >= profile.score_threshold { "queued" } else { "skipped" };
                    cleared += (status == "queued") as usize;
                    let db = self.db();
                    db.update_job(&j.id, &[
                        ("status", status.into()), ("score", s.score.into()), ("score_potential", json!(s.potential)), ("track", s.track.clone().into()),
                        ("reasoning", s.reasoning.into()), ("red_flags", json!(s.red_flags)), ("keywords", json!(s.keywords)),
                    ])?;
                    db.log(Some(&j.id), "scored", &format!("{} on the {} track (scored again)", s.score, s.track))?;
                }
                Err(e) => {
                    failed += 1;
                    if e.0.contains("API key") || e.0.contains("usage limit") || e.0.contains("signed in") {
                        return Err(e);
                    }
                }
            }
        }
        // Those scored now are out of the group only if they cleared the bar, so count what's left
        // by what was never scored again: everything past this run's cap.
        let r = json!({ "scored": scored, "cleared": cleared, "filtered": filtered, "failed": failed });
        self.db().log(None, "rescore", &format!("{scored} scored again, {cleared} now worth tailoring, {filtered} filtered out"))?;
        Ok(r)
    }

    /// Tailor the roles you picked, one after another, in the background. Returns how many started.
    pub fn tailor_picked(self: &Arc<Self>, ids: &[String]) -> R<usize> {
        let mut picked = vec![];
        for id in ids {
            let job = self.db().job(id)?;
            if let Some(j) = job {
                if !self.is_running(&format!("tailor:{}", j.id)) {
                    picked.push(j.id);
                }
            }
        }
        if picked.is_empty() {
            return err("Pick at least one role.");
        }
        // Claimed now, so each shows as being tailored until its turn comes.
        let claimed: Vec<(String, OwnedRunning)> = picked.into_iter().filter_map(|id| self.claim_owned(&format!("tailor:{id}")).map(|g| (id, g))).collect();
        let n = claimed.len();
        // Up to three at a time: each is mostly waiting on Claude.
        let queue = Arc::new(Mutex::new(claimed));
        let done = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let workers = Arc::new(std::sync::atomic::AtomicUsize::new(n.min(3)));
        for _ in 0..n.min(3) {
            let (a, queue, done, workers) = (self.clone(), queue.clone(), done.clone(), workers.clone());
            std::thread::spawn(move || {
                use std::sync::atomic::Ordering::SeqCst;
                loop {
                    let next = queue.lock().unwrap().pop();
                    let Some((id, g)) = next else { break };
                    match a.tailor(&id, None) {
                        Ok(_) => {
                            done.fetch_add(1, SeqCst);
                        }
                        Err(e) if e.0.contains("usage limit") => {
                            // Held, to tailor once the limit resets.
                            let _ = a.db().log(Some(&id), "tailor:error", &e.0);
                            let _ = a.defer(json!({ "kind": "tailor", "ids": [id] }));
                        }
                        Err(e) => {
                            let _ = a.db().log(Some(&id), "tailor:error", &e.0);
                            a.note("Tailoring didn't finish", &e.0);
                        }
                    }
                    drop(g);
                }
                // The last one to finish says how many are ready.
                if workers.fetch_sub(1, SeqCst) == 1 {
                    let done = done.load(SeqCst);
                    if done > 0 {
                        a.note(&format!("{done} application{} ready", if done == 1 { "" } else { "s" }), "Your CV and a cover letter are tailored. Review and approve them in Job Hunt.");
                    }
                }
            });
        }
        Ok(n)
    }

    fn signature_path(&self, ext: &str) -> PathBuf {
        self.data.join(format!("signature.{ext}"))
    }

    /// Your signature image (PNG or JPEG), placed above your name on every cover letter.
    pub fn signature(&self) -> Option<Vec<u8>> {
        ["png", "jpeg"].iter().find_map(|e| std::fs::read(self.signature_path(e)).ok())
    }

    pub fn set_signature(&self, bytes: &[u8]) -> R<()> {
        let Some((ext, _, _)) = cv::image_info(bytes) else {
            return err("Use a PNG or JPEG picture of your signature.");
        };
        if bytes.len() > 5_000_000 {
            return err("That picture is over 5 MB. Crop it or save it smaller.");
        }
        self.remove_signature()?;
        std::fs::write(self.signature_path(ext), bytes)?;
        Ok(())
    }

    pub fn remove_signature(&self) -> R<()> {
        for e in ["png", "jpeg"] {
            let p = self.signature_path(e);
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        Ok(())
    }

    pub fn save_cover_letter(&self, job_id: &str, text: &str) -> R<()> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if self.own_file(job_id, "letter") {
            return err("You're using your own cover letter file for this role. Edit it in Word, or switch back to Job Hunt's letter.");
        }
        self.db().update_job(job_id, &[("cover_letter", text.into())])?;
        if let (Some(path), Some(track)) = (&job.letter_path, &job.track) {
            if let Ok(doc) = cv::open(&self.cv_path(track)) {
                std::fs::write(path, cv::cover_letter(&doc, text, self.signature().as_deref())?)?;
                let _ = crate::util::docx_to_pdf(Path::new(path));
            }
        }
        Ok(())
    }

    // --- the company's own posting ----------------------------------------------------------------

    /// Look for the posting on the company's own site and keep the link, so Apply goes there
    /// rather than to the job board. None when Claude couldn't find it.
    pub fn find_company_apply(&self, job_id: &str) -> R<Option<String>> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if job.apply_url.is_some() {
            return Ok(job.apply_url);
        }
        let found = self.llm().company_apply(&job)?;
        match &found {
            Some(u) => {
                self.db().update_job(job_id, &[("apply_url", u.clone().into())])?;
                self.db().log(Some(job_id), "apply-link", &format!("found on the company's site: {u}"))?;
            }
            None => self.db().log(Some(job_id), "apply-link", "not found on the company's own site; apply through the posting")?,
        }
        Ok(found)
    }

    /// After approval, look for the company's own posting in the background, when the posting
    /// is on a job board and Claude Code is set up.
    pub fn find_company_apply_later(self: &Arc<Self>, job_id: &str) {
        let Ok(Some(job)) = self.db().job(job_id) else { return };
        if job.apply_url.is_some() || job.apply_email.is_some() || job.url.trim().is_empty() || !crate::sources::is_job_board(&job.url) || self.engine_name() != "code" || !self.claude_ready() {
            return;
        }
        let (a, id) = (self.clone(), job_id.to_string());
        std::thread::spawn(move || {
            let Ok(_g) = a.claim(&format!("apply-link:{id}")) else { return };
            if let Err(e) = a.find_company_apply(&id) {
                let _ = a.db().log(Some(&id), "apply-link:error", &e.0);
            }
        });
    }

    // --- fit forecast for postings scored before it existed ---------------------------------------

    /// Postings to pick (and near misses) scored before the fit forecast existed, best first.
    pub fn without_forecast(&self) -> Vec<Job> {
        let bar = self.profile().score_threshold;
        let mut jobs: Vec<Job> = self.db().jobs(None, 2000).unwrap_or_default().into_iter()
            .filter(|j| j.score_potential.is_none() && j.score_after.is_none() && j.score.is_some())
            .filter(|j| j.status == "queued" || (j.status == "skipped" && j.score.unwrap_or(0) >= bar - 15))
            .collect();
        jobs.sort_by_key(|j| (j.status != "queued", std::cmp::Reverse(j.score.unwrap_or(0))));
        jobs
    }

    /// Score a few of them again for their forecast; the score you've seen stays. Returns how many.
    pub fn forecast_missing(&self, max: usize) -> usize {
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return 0;
        }
        let mut n = 0;
        for job in self.without_forecast().into_iter().take(max) {
            if self.limited().is_some() {
                break;
            }
            match self.llm().score(&cvs, &self.scoring_guidance(&profile), &job) {
                Ok(s) => {
                    // Not below the score already shown: a forecast never reads as a drop.
                    let p = s.potential.unwrap_or(s.score).max(job.score.unwrap_or(0));
                    let _ = self.db().update_job(&job.id, &[("score_potential", p.into())]);
                    n += 1;
                }
                Err(e) => {
                    let _ = self.db().log(Some(&job.id), "forecast:error", &e.0);
                    break;
                }
            }
        }
        n
    }

    // --- what employees say ----------------------------------------------------------------------

    /// Look up what employees say about a company, and keep it for every job there.
    pub fn rate_company(&self, company: &str, location: &str) -> R<Value> {
        let r = self.llm().company_rating(company, location)?;
        let v = self.db().set_rating(company, &r)?;
        self.db().log(None, "ratings", &if r.found {
            format!("{company}: {:.1} out of 5 on {}", r.rating.unwrap_or(0.0), r.source)
        } else {
            format!("{company}: no employee reviews found")
        })?;
        Ok(v)
    }

    /// Companies of roles you're considering whose rating is missing or old (60 days; 7 when none
    /// was found), best fit first, with a place for each.
    pub fn companies_to_rate(&self) -> Vec<(String, String)> {
        const CONSIDERING: [&str; 7] = ["queued", "ready", "approved", "applied", "interviewing", "offer", "saved"];
        let db = self.db();
        let mut jobs: Vec<Job> = db.jobs(None, 2000).unwrap_or_default().into_iter().filter(|j| CONSIDERING.contains(&j.status.as_str())).collect();
        jobs.sort_by_key(|j| std::cmp::Reverse(j.score.unwrap_or(0)));
        let mut seen = std::collections::HashSet::new();
        let now = Utc::now();
        jobs.into_iter()
            .filter(|j| seen.insert(crate::db::company_key(&j.company)) && !crate::db::company_key(&j.company).is_empty())
            .filter(|j| match db.rating(&j.company) {
                None => true,
                Some(r) => {
                    let days = r["at"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| (now - t.with_timezone(&Utc)).num_days()).unwrap_or(999);
                    days >= if r["found"].as_bool() == Some(true) { 60 } else { 7 }
                }
            })
            .map(|j| (j.company, j.location))
            .collect()
    }

    /// Look up a few companies' ratings. Returns how many were looked up.
    pub fn rate_companies(&self, max: usize) -> usize {
        let mut n = 0;
        for (company, location) in self.companies_to_rate().into_iter().take(max) {
            if self.limited().is_some() {
                break;
            }
            match self.rate_company(&company, &location) {
                Ok(_) => n += 1,
                Err(e) => {
                    let _ = self.db().log(None, "ratings:error", &format!("{company}: {}", e.0));
                    // One company that didn't work doesn't stop the rest; a problem with Claude itself does.
                    if self.limited().is_some() || e.0.contains("Claude Code") || e.0.contains("signed in") {
                        break;
                    }
                }
            }
        }
        n
    }

    /// Whether Job Hunt looks up company ratings by itself (on unless you turned it off).
    pub fn ratings_auto(&self) -> bool {
        self.secret("ratings.auto") != "0"
    }

    // --- approval ---------------------------------------------------------------------------------

    /// Your go-ahead. Email applications are sent from your Gmail; anything else waits for you to
    /// submit on the company's site and mark it applied.
    pub fn approve(&self, job_id: &str) -> R<&'static str> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if job.status != "ready" {
            return err("Only applications waiting for approval can be approved.");
        }
        let mail = self.mail.read().unwrap().clone();
        if let (Some(to), Some(mail)) = (&job.apply_email, mail) {
            let files: Vec<PathBuf> = [&job.cv_path, &job.letter_path].iter().filter_map(|p| p.as_ref().map(PathBuf::from)).collect();
            let subject = job.email_subject.clone().unwrap_or_else(|| format!("Application: {}", job.title));
            // The email body is plain text, so drop the bold markers the Word letter uses.
            let body = job.cover_letter.as_deref().unwrap_or("").replace("**", "");
            let id = mail.send(to, &subject, &body, &files)?;
            self.db().set_status(job_id, "applied", &format!("emailed to {to} (message {id})"))?;
            return Ok("applied");
        }
        self.db().set_status(job_id, "approved", "approved; submit on the company site")?;
        Ok("approved")
    }

    // --- inbox --------------------------------------------------------------------------------------

    pub fn process_inbox(&self, limit: usize) -> R<BTreeMap<String, usize>> {
        let Some(mail) = self.mail.read().unwrap().clone() else {
            return err("Gmail isn't connected. Connect Google in Settings → Accounts.");
        };
        let _guard = self.claim("inbox")?;
        let _ = crate::recruiters::backfill(self);
        let profile = self.profile();
        let me = profile.email.to_lowercase();
        let mut stats = BTreeMap::new();
        match if profile.sources.is_off("alerts") { Ok(0) } else { self.process_alerts(&mail, 30) } {
            Ok(0) => {}
            Ok(n) => {
                stats.insert("job_alert_postings".to_string(), n);
            }
            Err(e) => self.db().log(None, "inbox:error", &format!("job alerts: {e}"))?,
        }
        let recruiters: HashSet<String> = crate::recruiters::list(self).into_iter().map(|r| r.email).collect();
        for id in mail.recent(INBOX_QUERY, limit)? {
            if self.db().email_seen(&id)? {
                continue;
            }
            // While the usage limit lasts, the rest waits for the next check (it isn't marked read).
            if self.limited().is_some() {
                break;
            }
            let msg = mail.get(&id)?;
            if google::address(&msg.from) == me {
                continue;
            }
            let apps = self.db().active_applications()?;
            // Mail with nothing about jobs in it (a bill, a smart-home alert) isn't sent to Claude.
            let known = self.db().thread_linked(&msg.thread_id)? || recruiters.contains(&crate::recruiters::sender(&msg.from).1);
            if !known && !about_jobs(&msg, &apps) {
                self.db().record_email(&msg.id, &msg.thread_id, None, &msg.from, &msg.subject, "not_job", "", None, &msg.received_at)?;
                *stats.entry("skipped".to_string()).or_insert(0) += 1;
                continue;
            }
            let input = EmailIn { from: &msg.from, to: &msg.to, date: &msg.date, subject: &msg.subject, body: &msg.body };
            let t = match self.llm().triage(&profile.name, &profile.timezone, &input, &apps) {
                Ok(t) => t,
                // Shown once as the usage-limit notice, not as a problem with this email.
                Err(e) if e.0.contains("usage limit") => break,
                Err(e) => {
                    self.db().log(None, "inbox:error", &format!("{}: {e}", msg.subject))?;
                    continue;
                }
            };
            let draft = self.handle_email(&mail, &msg, &t, &profile)?;
            // A recruiter who wrote to you personally: kept in your recruiters list.
            crate::recruiters::note_email(self, &msg, &t);
            if ["interview_request", "interview_confirmed", "assessment", "rejection", "offer", "recruiter_outreach"].contains(&t.category.as_str())
                && crate::recruiters::list(self).iter().any(|r| r.email == crate::recruiters::sender(&msg.from).1) {
                let _ = mail.label(&msg.id, crate::recruiters::LABEL);
            }
            self.db().record_email(&msg.id, &msg.thread_id, t.job_id.as_deref(), &msg.from, &msg.subject, &t.category, &t.summary, draft.as_deref(), &msg.received_at)?;
            *stats.entry(t.category.clone()).or_insert(0) += 1;
        }
        let drafted = self.draft_follow_ups();
        if drafted > 0 {
            stats.insert("follow_ups_drafted".to_string(), drafted);
        }
        let db = self.db();
        db.set("last.inbox", &crate::util::now())?;
        if !stats.is_empty() {
            db.log(None, "inbox", &stats.iter().map(|(k, v)| format!("{v} {}", k.replace('_', " "))).collect::<Vec<_>>().join(", "))?;
        }
        Ok(stats)
    }

    fn handle_email(&self, mail: &Arc<dyn Mail>, msg: &Email, t: &Triage, profile: &Profile) -> R<Option<String>> {
        if let Some(l) = label(&t.category) {
            mail.label(&msg.id, l)?;
        }
        let job = match &t.job_id {
            Some(id) => self.db().job(id)?,
            None => None,
        };
        let mut now_applied = false;
        if let Some(job) = &job {
            let db = self.db();
            db.log(Some(&job.id), &format!("email:{}", t.category), &t.summary)?;
            let mut target = email_status(&t.category);
            // "We received your application": you applied, even if you didn't tell Job Hunt.
            if t.category == "application_received" && ["approved", "ready", "saved", "queued"].contains(&job.status.as_str()) {
                target = Some("applied");
                now_applied = true;
            }
            if let Some(target) = target {
                if target != job.status {
                    db.set_status(&job.id, target, &format!("from email: {}", msg.subject))?;
                }
            }
        }
        // Just applied: write to the recruiter, as you chose (Settings on the Recruiters page).
        if let (true, Some(job)) = (now_applied, &job) {
            if let Err(e) = crate::recruiters::on_applied(self, &job.id) {
                self.db().log(Some(&job.id), "recruiter:error", &e.0)?;
            }
        }
        // An interview invitation: write the prep sheet now, so it's ready when you look.
        if let Some(job) = &job {
            if email_status(&t.category) == Some("interviewing") && self.prep(&job.id).is_none() {
                if let Err(e) = self.make_prep(&job.id) {
                    self.db().log(Some(&job.id), "prep:error", &e.0)?;
                }
            }
        }
        match t.category.as_str() {
            "interview_confirmed" if t.confirmed_time.is_some() && self.cal.read().unwrap().is_some() => {
                self.book_interview(job.as_ref(), t, msg, profile)?;
                Ok(None)
            }
            "interview_request" => match self.scheduling_reply(msg, t, profile)? {
                Some(body) => Ok(Some(mail.draft_reply(msg, &body)?)),
                None => Ok(None),
            },
            _ if t.needs_reply && t.reply_draft.as_deref().is_some_and(|d| !d.trim().is_empty()) => {
                let id = mail.draft_reply(msg, t.reply_draft.as_deref().unwrap())?;
                let from = t.company.clone().filter(|c| !c.is_empty()).or_else(|| job.as_ref().map(|j| j.company.clone())).unwrap_or_else(|| google::address(&msg.from));
                self.note(&format!("Reply from {from}"), &format!("An answer is waiting in your Gmail drafts: {}", msg.subject));
                Ok(Some(id))
            }
            "offer" => {
                self.note("You have an offer", &format!("{}: {}", t.company.clone().unwrap_or_default(), t.summary));
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    // --- calendar -----------------------------------------------------------------------------------

    fn scheduling_reply(&self, msg: &Email, t: &Triage, profile: &Profile) -> R<Option<String>> {
        let Some(cal) = self.cal.read().unwrap().clone() else { return Ok(None) };
        let tz = profile.tz();
        let now = Utc::now();
        let busy = cal.busy(now, now + Duration::days(21))?;
        let accept = t.offered_times.iter().find(|s| {
            match (parse_time(&s.start, tz), parse_time(&s.end, tz)) {
                (Some(a), Some(b)) => a > now && is_free(&busy, a, b),
                _ => false,
            }
        });
        let c = &profile.calendar;
        let free: Vec<TimeSlot> = if accept.is_some() {
            vec![]
        } else {
            free_slots(&busy, now, tz, (c.work_start, c.work_end), c.slot_minutes, c.propose_slots)
                .into_iter()
                .map(|(a, b)| TimeSlot { start: a.with_timezone(&tz).to_rfc3339(), end: b.with_timezone(&tz).to_rfc3339() })
                .collect()
        };
        let input = EmailIn { from: &msg.from, to: &msg.to, date: &msg.date, subject: &msg.subject, body: &msg.body };
        let body = self.llm().scheduling_reply(&profile.name, &profile.timezone, &input, accept, &free)?;
        self.note("Interview request", &format!("A reply proposing times is waiting in your Gmail drafts: {}", msg.subject));
        Ok(Some(body))
    }

    /// The interview event, a prep block before it, and follow-up reminders after it.
    pub fn book_interview(&self, job: Option<&Job>, t: &Triage, msg: &Email, profile: &Profile) -> R<Vec<String>> {
        // Interviews confirmed by email are booked only with Google connected (that's where the email came from).
        if self.cal.read().unwrap().is_none() {
            return Ok(vec![]);
        }
        let Some(slot) = &t.confirmed_time else { return Ok(vec![]) };
        let tz = profile.tz();
        let (Some(start), Some(end)) = (parse_time(&slot.start, tz), parse_time(&slot.end, tz)) else {
            return err(format!("Couldn't read the interview time “{}”.", slot.start));
        };
        let company = job.map(|j| j.company.clone()).or(t.company.clone()).unwrap_or_else(|| "Interview".into());
        let role = job.map(|j| j.title.clone()).or(t.role.clone()).unwrap_or_default();
        let mut details = vec![];
        if !role.is_empty() {
            details.push(format!("Role: {role}"));
        }
        if !t.interviewers.is_empty() {
            details.push(format!("Interviewers: {}", t.interviewers.join(", ")));
        }
        if let Some(l) = &t.meeting_link {
            details.push(format!("Join: {l}"));
        }
        if let Some(j) = job {
            if !j.url.is_empty() {
                details.push(format!("Posting: {}", j.url));
            }
        }
        details.push(format!("\nFrom: {} — {}", msg.from, msg.subject));
        details.push(t.summary.clone());
        let details = details.join("\n");

        self.schedule_interview(job, &company, &role, start, end, &details, t.meeting_link.clone(), profile)
    }

    /// Put an interview in your calendar, with prep time before it and thank-you and follow-up
    /// reminders after (Settings → Calendar). With Google connected they go into Google Calendar;
    /// either way Job Hunt keeps them for its Calendar page. Returns the new entries' ids.
    #[allow(clippy::too_many_arguments)]
    fn schedule_interview(&self, job: Option<&Job>, company: &str, role: &str, start: chrono::DateTime<Utc>, end: chrono::DateTime<Utc>, details: &str, link: Option<String>, profile: &Profile) -> R<Vec<String>> {
        let cal = self.cal.read().unwrap().clone();
        let tz = profile.tz();
        let job_id = job.map(|j| j.id.as_str());
        let mut made = vec![];
        let mut add = |kind: &str, e: NewEvent| -> R<()> {
            let key = e.start.to_rfc3339();
            if self.db().calendar_event_exists(job_id, kind, &key)? {
                return Ok(());
            }
            let id = match &cal {
                Some(c) => c.create(&e)?,
                None => format!("local:{kind}:{}:{key}", job_id.unwrap_or("")),
            };
            self.db().record_calendar_event(&id, job_id, kind, &key, &e.summary)?;
            made.push(id);
            Ok(())
        };
        add("interview", NewEvent {
            summary: format!("Interview: {company}{}", if role.is_empty() { String::new() } else { format!(" – {role}") }),
            start, end, description: details.to_string(), location: link, color: Some("11".into()), reminders: Some(vec![60, 15]),
        })?;
        let c = &profile.calendar;
        if c.prep_minutes > 0 {
            add("prep", NewEvent {
                summary: format!("Prep: {company} interview"),
                start: start - Duration::minutes(c.prep_minutes), end: start,
                description: format!("Review the posting, your tailored CV and your questions.\n\n{details}"),
                color: Some("5".into()), reminders: Some(vec![10]), ..NewEvent::default()
            })?;
        }
        for &n in &c.followup_days {
            let s = weekday_after(start, tz, n, 9);
            let what = if n <= 1 { "Send thank-you note" } else { "Follow up if no reply" };
            add(&format!("followup-{n}"), NewEvent {
                summary: format!("{what}: {company}"), start: s, end: s + Duration::minutes(15),
                description: details.to_string(), reminders: Some(vec![0]), ..NewEvent::default()
            })?;
        }
        if !made.is_empty() {
            let when = start.with_timezone(&tz).format("%a %-d %b, %H:%M").to_string();
            if let Some(id) = job_id {
                self.db().log(Some(id), "calendar", &format!("interview booked for {when}"))?;
            }
            let where_ = if cal.is_some() { "your calendar" } else { "Job Hunt's calendar" };
            self.note("Interview booked", &format!("{company}, {when}. Prep time and follow-up reminders are in {where_}."));
        }
        Ok(made)
    }

    /// An interview you arranged yourself (by phone, or an email Job Hunt didn't read): booked like
    /// one from email, and the application moves to Interviewing.
    pub fn add_interview(&self, job_id: &str, start: &str, minutes: i64, link: &str, note: &str) -> R<Vec<String>> {
        let profile = self.profile();
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let at = parse_time(start, profile.tz()).ok_or_else(|| Error("Choose a date and time for the interview.".into()))?;
        let mut details = vec![format!("Role: {}", job.title)];
        if !link.trim().is_empty() {
            details.push(format!("Join: {}", link.trim()));
        }
        if !job.url.is_empty() {
            details.push(format!("Posting: {}", job.url));
        }
        if !note.trim().is_empty() {
            details.push(note.trim().to_string());
        }
        let made = self.schedule_interview(Some(&job), &job.company, &job.title, at, at + Duration::minutes(minutes.clamp(15, 480)), &details.join("\n"),
            Some(link.trim().to_string()).filter(|l| !l.is_empty()), &profile)?;
        if made.is_empty() {
            return err("That interview is in the calendar already.");
        }
        if ["ready", "approved", "applied", "saved", "queued"].contains(&job.status.as_str()) {
            self.db().set_status(job_id, "interviewing", "interview added to the calendar")?;
        }
        Ok(made)
    }

    /// What's coming up, and what just happened, as one list: interviews, prep time and reminders
    /// from the calendar; application deadlines; and follow-ups that are due.
    pub fn calendar(&self, back_days: i64, ahead_days: i64) -> R<Vec<Value>> {
        let profile = self.profile();
        let tz = profile.tz();
        let now = Utc::now();
        let (from, to) = (now - Duration::days(back_days), now + Duration::days(ahead_days));
        let mut out = vec![];
        let entries = self.db().calendar_between(&from.to_rfc3339(), &to.to_rfc3339())?;
        for e in entries {
            let kind = if e.kind.starts_with("followup") { "reminder" } else { e.kind.as_str() };
            out.push(json!({ "id": e.event_id, "kind": kind, "at": e.start, "all_day": false, "title": e.title,
                "job_id": e.job_id, "company": e.company, "job_title": e.job_title, "local": e.event_id.starts_with("local:") }));
        }
        let day = |d: chrono::NaiveDate| d.and_hms_opt(9, 0, 0).and_then(|t| t.and_local_timezone(tz).single()).map(|t| t.with_timezone(&Utc));
        for st in ["queued", "ready", "approved", "saved"] {
            let jobs = self.db().jobs(Some(st), 5000)?; // bound first: the database lock is released
            for j in jobs {
                let Some(d) = j.deadline.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).and_then(day) else { continue };
                if d >= from && d < to && j.closed_at.is_none() {
                    out.push(json!({ "id": format!("deadline:{}", j.id), "kind": "deadline", "at": d.to_rfc3339(), "all_day": true, "apply_email": j.apply_email,
                        "title": format!("Last day to apply: {}", j.company), "job_id": j.id, "company": j.company, "job_title": j.title, "status": j.status }));
                }
            }
        }
        // Applications waiting on a reply: the day a follow-up is due (today, if it's overdue).
        let due: HashSet<String> = self.follow_ups_due()?.into_iter().map(|j| j.id).collect();
        if profile.follow_up_after > 0 {
            let applied_jobs = self.db().jobs(Some("applied"), 5000)?; // bound first: follow_up needs the database
            for j in applied_jobs {
                let Some(applied) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()) else { continue };
                if self.follow_up(&j.id).is_some() {
                    continue;
                }
                let when = applied.with_timezone(&Utc) + Duration::days(profile.follow_up_after as i64);
                let when = if due.contains(&j.id) { now } else { when };
                if when < to && (due.contains(&j.id) || when >= now) {
                    out.push(json!({ "id": format!("followup:{}", j.id), "kind": "follow-up", "at": when.to_rfc3339(), "all_day": true,
                        "title": format!("Follow up: {}", j.company), "job_id": j.id, "company": j.company, "job_title": j.title, "overdue": due.contains(&j.id) }));
                }
            }
        }
        // Your other Google Calendar events, from the last sync.
        if self.secret("cal.show_google") != "0" {
            let cache: Value = serde_json::from_str(&self.secret("gcal.cache")).unwrap_or(Value::Null);
            let known: HashSet<String> = self.db().calendar_ids()?.into_iter().map(|e| e.event_id).collect();
            for e in cache["events"].as_array().into_iter().flatten() {
                let Some(at) = e["start"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)) else { continue };
                // An all-day event is a date, not a moment: noon of that day where you are.
                let at = if e["all_day"] == true { day(at.date_naive()).map(|d| d + Duration::hours(3)).unwrap_or(at) } else { at };
                if at < from || at >= to || known.contains(e["id"].as_str().unwrap_or("")) {
                    continue;
                }
                out.push(json!({ "id": e["id"], "kind": "google", "at": at.to_rfc3339(), "all_day": e["all_day"], "title": e["title"],
                    "job_id": Value::Null, "suggest": e["suggest"] }));
            }
        }
        out.sort_by(|a, b| a["at"].as_str().cmp(&b["at"].as_str()));
        Ok(out)
    }

    /// Two-way sync with Google Calendar:
    /// - entries Job Hunt kept itself (added while Google wasn't connected) are copied there;
    /// - interviews, prep and reminders moved or deleted in Google Calendar are moved or removed here;
    /// - your other events are kept for the Calendar page, and ones that look like an interview for
    ///   one of your applications are suggested to link.
    pub fn sync_calendar(&self) -> R<Value> {
        let Some(cal) = self.cal.read().unwrap().clone() else {
            return err("Connect Google in Settings → Accounts to sync with Google Calendar.");
        };
        let profile = self.profile();
        let now = Utc::now();
        let mine = self.db().calendar_ids()?;
        // 1. Ours, not in Google yet: copy them.
        let mut pushed = 0;
        for e in mine.iter().filter(|e| e.event_id.starts_with("local:")) {
            let Ok(start) = chrono::DateTime::parse_from_rfc3339(&e.start).map(|t| t.with_timezone(&Utc)) else { continue };
            if start < now {
                continue;
            }
            let minutes = match e.kind.as_str() { "interview" => 60, "prep" => profile.calendar.prep_minutes.max(15), _ => 15 };
            let id = cal.create(&NewEvent { summary: e.title.clone(), start, end: start + Duration::minutes(minutes), description: "Added by Job Hunt.".into(), ..NewEvent::default() })?;
            self.db().update_calendar_event(&e.event_id, Some(&id), None)?;
            pushed += 1;
        }
        // 2. What Google has now.
        let items = cal.events(now - Duration::days(14), now + Duration::days(90))?;
        let mine = self.db().calendar_ids()?;
        let (mut moved, mut removed) = (0, 0);
        for it in &items {
            let Some(e) = mine.iter().find(|e| e.event_id == it.id) else { continue };
            if it.cancelled {
                self.db().delete_calendar_event(&e.event_id)?;
                if let (Some(job), "interview") = (&e.job_id, e.kind.as_str()) {
                    self.db().log(Some(job), "calendar", "interview removed from your Google Calendar")?;
                }
                removed += 1;
            } else if !it.start.is_empty() && chrono::DateTime::parse_from_rfc3339(&it.start).ok() != chrono::DateTime::parse_from_rfc3339(&e.start).ok() {
                self.db().update_calendar_event(&e.event_id, None, Some(&it.start))?;
                if let (Some(job), "interview") = (&e.job_id, e.kind.as_str()) {
                    let when = chrono::DateTime::parse_from_rfc3339(&it.start).map(|t| t.with_timezone(&profile.tz()).format("%a %-d %b, %H:%M").to_string()).unwrap_or_default();
                    self.db().log(Some(job), "calendar", &format!("interview moved to {when} in your Google Calendar"))?;
                }
                moved += 1;
            }
        }
        // 3. Everything else, for the Calendar page; an interview-looking one names its application.
        let mut active: Vec<Job> = vec![];
        for st in ["ready", "approved", "applied", "interviewing"] {
            active.extend(self.db().jobs(Some(st), 2000)?);
        }
        let interviewish = ["interview", "call", "chat", "meeting", "screen", "conversation", "panel"];
        let others: Vec<Value> = items.iter().filter(|it| !it.cancelled && !mine.iter().any(|e| e.event_id == it.id)).map(|it| {
            let text = format!("{} {}", it.summary, it.description).to_lowercase();
            let suggest = interviewish.iter().any(|w| text.contains(w)).then(|| active.iter().find(|j| {
                let c = crate::db::dupe_key(&j.company, "").trim_end_matches('|').to_string();
                c.len() >= 3 && (text.contains(&j.company.to_lowercase()) || text.replace(|ch: char| !ch.is_alphanumeric(), "").contains(&c))
            })).flatten();
            json!({ "id": it.id, "title": it.summary, "start": it.start, "end": it.end, "all_day": it.all_day,
                "suggest": suggest.map(|j| json!({ "job_id": j.id, "company": j.company, "title": j.title })) })
        }).collect();
        let db = self.db();
        db.set("gcal.cache", &json!({ "at": now.to_rfc3339(), "events": others }).to_string())?;
        db.set("last.calsync", &now.to_rfc3339())?;
        Ok(json!({ "pushed": pushed, "moved": moved, "removed": removed, "others": others.len() }))
    }

    /// Mark one of your Google Calendar events as the interview for an application: it then shows
    /// with that application (and it moves to Interviewing).
    pub fn link_calendar_event(&self, event_id: &str, job_id: &str) -> R<()> {
        let cache: Value = serde_json::from_str(&self.secret("gcal.cache")).unwrap_or(Value::Null);
        let ev = cache["events"].as_array().and_then(|a| a.iter().find(|e| e["id"] == event_id)).cloned()
            .ok_or_else(|| Error("That event isn't in the last sync. Sync again and retry.".into()))?;
        if ev["all_day"] == true {
            return err("That's an all-day event, so it has no time. Give it a time in Google Calendar and sync again, or use Add interview.");
        }
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let db = self.db();
        db.record_calendar_event(event_id, Some(job_id), "interview", ev["start"].as_str().unwrap_or(""), ev["title"].as_str().unwrap_or("Interview"))?;
        if ["queued", "ready", "approved", "applied", "saved"].contains(&job.status.as_str()) {
            db.set_status(job_id, "interviewing", "interview found in your Google Calendar")?;
        }
        db.log(Some(job_id), "calendar", "interview linked from your Google Calendar")
    }

    /// The coming 90 days of your calendar as an iCalendar file, for Outlook or Apple Calendar.
    pub fn calendar_ics(&self) -> R<String> {
        let esc = |t: &str| t.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n");
        let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Job Hunt//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Job Hunt\r\n");
        for e in self.calendar(0, 90)? {
            let Some(at) = e["at"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc)) else { continue };
            let title = e["title"].as_str().unwrap_or("");
            let what = e["job_title"].as_str().map(|t| format!("{t} at {}", e["company"].as_str().unwrap_or(""))).unwrap_or_default();
            out.push_str("BEGIN:VEVENT\r\n");
            out.push_str(&format!("UID:{}@jobhunt\r\nDTSTAMP:{stamp}\r\n", esc(e["id"].as_str().unwrap_or(""))));
            if e["all_day"] == true {
                let d = at.with_timezone(&self.profile().tz()).date_naive();
                out.push_str(&format!("DTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\n", d.format("%Y%m%d"), (d + Duration::days(1)).format("%Y%m%d")));
            } else {
                let len = match e["kind"].as_str() { Some("interview") => 60, Some("prep") => self.profile().calendar.prep_minutes.max(15), _ => 15 };
                out.push_str(&format!("DTSTART:{}\r\nDTEND:{}\r\n", at.format("%Y%m%dT%H%M%SZ"), (at + Duration::minutes(len)).format("%Y%m%dT%H%M%SZ")));
            }
            out.push_str(&format!("SUMMARY:{}\r\nDESCRIPTION:{}\r\nEND:VEVENT\r\n", esc(title), esc(&what)));
        }
        out.push_str("END:VCALENDAR\r\n");
        Ok(out)
    }
}

/// The connections you can turn off one by one in Connections.
pub const SWITCHABLE: [&str; 9] = ["jsearch", "jooble", "adzuna", "indeed", "linkedin", "jobbank", "agencies", "boards", "alerts"];

/// Budget mode's night: from your hour until 6 AM (an hour after midnight: from then until 6).
fn is_night(h: u32, from: u32) -> bool {
    if from < 6 { h >= from && h < 6 } else { h >= from || h < 6 }
}

/// Held batches are read and written under this, so none is lost or run twice.
static HELD: Mutex<()> = Mutex::new(());

/// Yearly pay bands for comparing replies by pay.
const PAY_BANDS: [&str; 6] = ["Under $80k", "$80k–100k", "$100k–120k", "$120k–140k", "$140k+", "Not stated"];

/// The middle of a posting's stated yearly pay.
fn pay_mid(j: &Job) -> Option<f64> {
    let text = j.salary.clone().or_else(|| crate::sources::salary_from_text(&j.description).map(|s| s.0))?;
    crate::sources::salary_range(&text).map(|(lo, hi)| (lo + hi) / 2.0).filter(|m| *m >= 20_000.0)
}

fn pay_band(j: &Job) -> &'static str {
    match pay_mid(j) {
        None => PAY_BANDS[5],
        Some(m) if m < 80_000.0 => PAY_BANDS[0],
        Some(m) if m < 100_000.0 => PAY_BANDS[1],
        Some(m) if m < 120_000.0 => PAY_BANDS[2],
        Some(m) if m < 140_000.0 => PAY_BANDS[3],
        Some(_) => PAY_BANDS[4],
    }
}

/// The kind of role a posting is, as one of the titles you search for: the longest of them whose
/// words are all in its title ("Senior Tax Manager, Indirect" is "Tax Manager"). Otherwise "Other titles".
pub fn title_family(title: &str, profile: &Profile) -> String {
    let words = |t: &str| -> Vec<String> {
        t.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty())
            .filter(|w| !["senior", "sr", "junior", "jr", "lead", "principal", "staff", "i", "ii", "iii", "iv", "of", "and", "the"].contains(w))
            .map(String::from).collect()
    };
    let have = words(title);
    profile.tracks.iter().flat_map(|t| t.titles.iter())
        .filter(|t| { let w = words(t); !w.is_empty() && w.iter().all(|x| have.contains(x)) })
        .max_by_key(|t| words(t).len())
        .cloned()
        .unwrap_or_else(|| "Other titles".into())
}

/// A posting's date as sources give it: Unix seconds or milliseconds, RFC 3339, or a date.
pub fn posted_date(raw: &str) -> Option<chrono::DateTime<Utc>> {
    let t = raw.trim();
    let t = t.rsplit('|').next().unwrap_or(t).trim(); // "source|date" from email alerts
    if t.len() >= 9 && t.len() <= 13 && t.chars().all(|c| c.is_ascii_digit()) {
        let n: i64 = t.parse().ok()?;
        let secs = if n < 1_000_000_000_000 { n } else { n / 1000 };
        return chrono::DateTime::from_timestamp(secs, 0).filter(|d| d.timestamp() >= 946_684_800);
    }
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(t) {
        return Some(d.with_timezone(&Utc));
    }
    if t.len() == 8 && t.chars().all(|c| c.is_ascii_digit()) {
        return chrono::NaiveDate::parse_from_str(t, "%Y%m%d").ok().and_then(|d| d.and_hms_opt(12, 0, 0)).map(|d| d.and_utc());
    }
    chrono::NaiveDate::parse_from_str(t.get(..10)?, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(12, 0, 0)).map(|d| d.and_utc())
}

/// Reasons to doubt a posting is a real, open role: posted again and again, old, from an agency
/// for an unnamed client, or a pool of CVs for openings that don't exist yet.
pub fn posting_warnings(j: &Job, reposts: i64, now: chrono::DateTime<Utc>) -> Vec<String> {
    let mut out = vec![];
    let text = format!("{} {}", j.title, j.description).to_lowercase();
    let company = j.company.to_lowercase();
    let pool = ["future opportunit", "talent pool", "talent community", "talent pipeline", "pipeline requisition", "evergreen",
        "not for an existing vacancy", "not an existing vacancy", "no current vacancy", "future vacancies", "general application", "future openings"];
    if pool.iter().any(|w| text.contains(w)) {
        out.push("Not an open role: they're collecting CVs for future openings.".to_string());
    }
    if reposts > 0 {
        out.push(format!("Posted again{} since Job Hunt first found it: hard to fill, or not really open.", if reposts > 1 { format!(" {reposts} times") } else { String::new() }));
    }
    let open = !["applied", "interviewing", "offer", "rejected", "no_response"].contains(&j.status.as_str());
    let since = j.posted_at.as_deref().and_then(posted_date)
        .or_else(|| chrono::DateTime::parse_from_rfc3339(&j.found_at).ok().map(|t| t.with_timezone(&Utc)));
    if let Some(d) = since.map(|t| (now - t).num_days()).filter(|d| *d >= 45 && open) {
        out.push(format!("Posted {d} days ago: it may already be filled."));
    }
    let agency = ["staffing", "recruit", "personnel", "headhunt", "placement", "talent solutions", "search group", "executive search"];
    let unnamed = ["our client", "confidential client", "client of ours", "a leading client", "on behalf of our"];
    if ["confidential", "anonymous", "undisclosed", "private company"].iter().any(|w| company.contains(w)) {
        out.push("The employer's name is hidden.".to_string());
    } else if agency.iter().any(|w| company.contains(w)) && unnamed.iter().any(|w| text.contains(w)) {
        out.push("A recruiting agency, for a client it doesn't name.".to_string());
    }
    out
}

// --- background runs ------------------------------------------------------------------------

/// Start a search or an inbox check on its own thread. False if one is already running.
/// What's due now, checked once a minute: the daily search at your chosen hour (or as soon as Job
/// Hunt is running after it), an email check every few minutes once Google is connected, and the
/// daily backup.
pub fn due_tasks(agent: &Agent) -> Vec<&'static str> {
    use chrono::Timelike;
    let mut out = vec![];
    let p = agent.profile();
    let tz = p.tz();
    let now = Utc::now();
    let local = now.with_timezone(&tz);
    let ready = agent.claude_ready() && agent.limited().is_none();
    let searched_today = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.search"))
        .map(|t| t.with_timezone(&tz).date_naive() == local.date_naive())
        .unwrap_or(false);
    // Asked for from Claude (search_now) since the last search.
    let requested = { let r = agent.secret("request.search"); !r.is_empty() && r > agent.secret("last.search") };
    if ready && (requested || (!searched_today && local.hour() >= p.search_hour)) && !agent.is_running("search") {
        out.push("search");
    }
    if ready && agent.mail.read().map(|m| m.is_some()).unwrap_or(false) && !agent.is_running("inbox") {
        let due = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.inbox"))
            .map(|t| (now - t.with_timezone(&Utc)).num_minutes() >= p.inbox_minutes as i64)
            .unwrap_or(true);
        if due {
            out.push("inbox");
        }
    }
    if crate::backup::due(agent) && !agent.is_running("backup") {
        out.push("backup");
    }
    // Fit forecasts for postings scored before they existed: a few every 15 minutes.
    let forecast_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.forecast"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 15)
        .unwrap_or(false);
    if ready && !forecast_lately && !agent.budget_wait() && !agent.is_running("forecast") && !agent.is_running("search") && !agent.without_forecast().is_empty() {
        out.push("forecast");
    }
    // Company ratings for roles you're considering: a few every 10 minutes, through Claude Code.
    let rated_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.ratings"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 10)
        .unwrap_or(false);
    if ready && !rated_lately && agent.ratings_auto() && agent.engine_name() == "code" && !agent.budget_wait() && !agent.is_running("ratings") && !agent.is_running("search") && !agent.companies_to_rate().is_empty() {
        out.push("ratings");
    }
    if crate::sync::due(agent) && !agent.is_running("sync") {
        out.push("sync");
    }
    // The weekly review: Sunday from 6 PM (or Monday from the hour of the daily search), once a week.
    use chrono::Datelike;
    let (back, hour) = if agent.secret("weekly.day") == "mon" { (local.weekday().num_days_from_monday(), p.search_hour) } else { (local.weekday().num_days_from_sunday(), 18) };
    let review_at = (local.date_naive() - Duration::days(back as i64)).and_hms_opt(hour, 0, 0).and_then(|t| t.and_local_timezone(tz).earliest());
    let weekly_done = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.weekly")).ok()
        .zip(review_at)
        .is_some_and(|(t, at)| t >= at);
    if !weekly_done && review_at.is_some_and(|at| local >= at) && agent.db().counts().map(|c| c.values().any(|n| n.as_i64().unwrap_or(0) > 0)).unwrap_or(false) {
        out.push("weekly");
    }
    // Batches held by budget mode, or by a usage limit: once it's night, and the limit has reset.
    if ready && !agent.budget_wait() && !agent.deferred().is_empty() && !agent.is_running("rescore") {
        out.push("deferred");
    }
    // Recruiters in your Gmail: once Gmail is connected, then monthly.
    let recruiters_due = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.recruiters"))
        .map(|t| (now - t.with_timezone(&Utc)).num_days() >= 30)
        .unwrap_or(true);
    if recruiters_due && ready && agent.mail.read().map(|m| m.is_some()).unwrap_or(false) && !agent.is_running("recruiters") && !agent.is_running("search") {
        out.push("recruiters");
    }
    // Interview eves and thank-you notes: checked every 10 minutes.
    let cared = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.care"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() >= 10)
        .unwrap_or(true);
    if cared && !agent.is_running("care") {
        out.push("care");
    }
    // Google Calendar, both ways, every half hour once Google is connected.
    let calsync_due = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.calsync"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() >= 30)
        .unwrap_or(true);
    if calsync_due && agent.cal.read().map(|c| c.is_some()).unwrap_or(false) && !agent.is_running("calsync") {
        out.push("calsync");
    }
    // The morning summary: once a day, after the day's search has finished.
    let digest_today = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.digest"))
        .map(|t| t.with_timezone(&tz).date_naive() == local.date_naive())
        .unwrap_or(false);
    if searched_today && !digest_today && !agent.is_running("search") && local.hour() >= p.search_hour {
        out.push("digest");
    }
    // Employers near your locations: weekly; sooner when your locations changed, a search found
    // little that's new, or there are no company boards at all.
    if p.sources.auto_boards && ready && !agent.is_running("discover") && !agent.is_running("search") && !p.tracks.is_empty() {
        let days = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.discover")).map(|t| (now - t.with_timezone(&Utc)).num_hours() as f64 / 24.0).unwrap_or(f64::MAX);
        let thin = serde_json::from_str::<Value>(&agent.secret("last.report")).ok().is_some_and(|r| r["new"].as_u64().unwrap_or(0) < 25);
        let none = crate::sources::boards(&p).is_empty();
        let asked = !agent.secret("discover.due").is_empty();
        if days >= 7.0 || ((thin || none || asked) && days >= 1.0) || (asked && days >= 0.02) {
            out.push("discover");
        }
    }
    let checked_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.check"))
        .map(|t| (now - t.with_timezone(&Utc)).num_hours() < 20)
        .unwrap_or(false);
    if !checked_lately && !agent.is_running("check-postings") && !agent.is_running("search") {
        out.push("check-postings");
    }
    out
}

/// A company's rating for lists: the stars, how many reviews, and where from.
pub fn rating_brief(r: &Value) -> Value {
    json!({ "found": r["found"], "rating": r["rating"], "reviews": r["reviews"], "source": r["source"] })
}

/// See which postings waiting on you have closed, in the background.
pub fn check_in_background(agent: &Arc<Agent>) {
    let agent = agent.clone();
    std::thread::spawn(move || {
        if let Err(e) = agent.check_postings() {
            if !e.0.contains("already running") {
                let _ = agent.db().log(None, "check:error", &e.0);
                let _ = agent.db().set("last.check", &now());
            }
        }
    });
}

/// Save the latest copy to the sync folder, in the background.
pub fn sync_in_background(agent: &Arc<Agent>) {
    let agent = agent.clone();
    std::thread::spawn(move || {
        let Ok(_g) = agent.claim("sync") else { return };
        let r = crate::sync::push(&agent, false);
        // The last problem, for Settings; cleared once a sync works.
        let _ = match &r { Err(e) => agent.db().set("sync.error", &e.0), Ok(_) => agent.db().delete("sync.error") };
        // Try again after the usual gap, not every minute; "last.sync" stays the last one that worked.
        let _ = agent.db().set("sync.tried", &crate::util::now());
        if let Err(e) = r {
            let _ = agent.db().log(None, "sync:error", &e.0);
        }
    });
}

/// Run whatever due_tasks says is due.
pub fn run_due(agent: &Arc<Agent>, start: &dyn Fn(&str) -> bool) {
    // Say this computer is using Job Hunt, or hand over to another that took over.
    crate::sync::beat(agent);
    if crate::sync::handed_over(agent).is_some() {
        return; // the other computer carries on; anything done here would be lost
    }
    agent.save_usage();
    for task in due_tasks(agent) {
        match task {
            "backup" => backup_in_background(agent),
            "sync" => sync_in_background(agent),
            "check-postings" => check_in_background(agent),
            "discover" => {
                let a = agent.clone();
                std::thread::spawn(move || match a.discover_boards() {
                    Ok(added) if !added.is_empty() => {
                        if let Err(e) = a.search(None) {
                            if !e.0.contains("already running") {
                                let _ = a.db().log(None, "search:error", &e.0);
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        if !e.0.contains("already running") {
                            let _ = a.db().log(None, "discover:error", &e.0);
                        }
                    }
                });
            }
            "forecast" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("forecast") else { return };
                    a.forecast_missing(6);
                    let _ = a.db().set("last.forecast", &now());
                });
            }
            "ratings" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("ratings") else { return };
                    a.rate_companies(6);
                    let _ = a.db().set("last.ratings", &now());
                });
            }
            "calsync" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("calsync") else { return };
                    if let Err(e) = a.sync_calendar() {
                        let _ = a.db().set("last.calsync", &now()); // try again in half an hour
                        let _ = a.db().log(None, "calsync:error", &e.0);
                    }
                });
            }
            "deferred" => {
                if let Err(e) = agent.run_deferred() {
                    let _ = agent.db().log(None, "deferred:error", &e.0);
                }
            }
            "recruiters" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    if let Err(e) = crate::recruiters::scan(&a) {
                        if !e.0.contains("already running") {
                            let _ = a.db().set("last.recruiters", &now()); // not again for a month
                            let _ = a.db().log(None, "recruiters:error", &e.0);
                        }
                    }
                });
            }
            "care" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("care") else { return };
                    let _ = a.db().set("last.care", &now());
                    if let Err(e) = a.interview_care() {
                        let _ = a.db().log(None, "care:error", &e.0);
                    }
                });
            }
            "digest" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    if let Err(e) = a.morning_digest() {
                        let _ = a.db().log(None, "digest:error", &e.0);
                    }
                });
            }
            "weekly" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("weekly") else { return };
                    if let Err(e) = a.weekly_summary() {
                        let _ = a.db().set("last.weekly", &now());
                        let _ = a.db().log(None, "weekly:error", &e.0);
                    }
                    // Once a month, with enough to go on, Claude looks at what's working.
                    let stale = chrono::DateTime::parse_from_rfc3339(serde_json::from_str::<Value>(&a.secret("insights")).ok().and_then(|v| v["at"].as_str().map(String::from)).as_deref().unwrap_or(""))
                        .map(|t| (Utc::now() - t.with_timezone(&Utc)).num_days() >= 28)
                        .unwrap_or(true);
                    let sent = a.results().map(|r| r["funnel"]["sent"].as_u64().unwrap_or(0)).unwrap_or(0);
                    if stale && sent >= 10 && a.claude_ready() {
                        let _ = a.write_insights();
                    }
                });
            }
            t => {
                start(t);
            }
        }
    }
}

/// The daily backup, in the background. Problems are logged and shown as a notification.
pub fn backup_in_background(agent: &Arc<Agent>) {
    let agent = agent.clone();
    std::thread::spawn(move || {
        let Ok(_g) = agent.claim("backup") else { return };
        match crate::backup::create(&agent) {
            Ok(p) => {
                let _ = agent.db().log(None, "backup", &format!("saved {}", p.display()));
            }
            Err(e) => {
                let _ = agent.db().log(None, "backup:error", &e.0);
                // Don't retry every minute: try again tomorrow.
                let _ = agent.db().set("last.backup", &crate::util::now());
                agent.note("Backup didn't finish", &e.0);
            }
        }
    });
}

pub fn run_in_background(agent: &Arc<Agent>, task: &str) -> bool {
    if agent.is_running(task) {
        return false;
    }
    let agent = agent.clone();
    let task = task.to_string();
    std::thread::spawn(move || {
        let result = match task.as_str() {
            "search" => agent.search(None).map(|r| r.to_string()),
            "search-force" => agent.force_search().map(|r| r.to_string()),
            "inbox" => agent.process_inbox(100).map(|s| format!("{} new job emails", s.values().sum::<usize>())),
            other => Err(Error(format!("unknown task {other}"))),
        };
        if let Err(e) = result {
            if !e.0.contains("already running") {
                let _ = agent.db().log(None, &format!("{task}:error"), &e.0);
                let what = if task.starts_with("search") { "Job search" } else { "Email check" };
                agent.note(&format!("{what} didn't finish"), &e.0);
            }
        }
    });
    true
}

impl Agent {
    // --- dashboard ----------------------------------------------------------------------------------

    pub fn overview(&self) -> R<Value> {
        let profile = self.profile();
        let newer = crate::sync::newer_elsewhere(self).map(|(d, i)| json!({ "folder": d, "device": i.device_name, "saved_at": i.saved_at, "jobs": i.jobs }));
        let in_use = crate::sync::presence_status(self);
        let follow_ups: Vec<Value> = self.follow_ups_due().unwrap_or_default().iter().map(|j| j.brief()).collect();
        let closing: Vec<Value> = self.closing_soon(7).unwrap_or_default().iter().map(|j| j.brief()).collect();
        let health = self.health();
        let (claude_ready, engine) = (self.claude_ready(), self.engine_name());
        let tz = profile.tz();
        let today = Utc::now().with_timezone(&tz).date_naive();
        // Recruiters you know (read before taking the database below: it needs it too).
        let recruiters = crate::recruiters::list(self);
        let db = self.db();
        let counts = db.counts()?;
        let n = |k: &str| counts.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
        let applied_ever = n("applied") + n("interviewing") + n("offer") + n("rejected");
        let responded = n("interviewing") + n("offer") + n("rejected");
        let weeks = db.applied_per_week(8, today, tz)?;
        let this_week = weeks.last().map(|w| w.1).unwrap_or(0);
        let last_week = weeks.iter().rev().nth(1).map(|w| w.1).unwrap_or(0);
        // With what to check before putting time in, for the "Check first" tag.
        let (reposts, at) = (db.reposts()?, Utc::now());
        let with_warnings = |j: &Job| {
            let mut b = j.brief();
            b["warnings"] = json!(posting_warnings(j, reposts.get(&j.id).copied().unwrap_or(0), at));
            if let Some(r) = crate::recruiters::for_company(&recruiters, &j.company) {
                b["recruiter"] = json!(r.name);
            }
            if let Some(r) = db.rating(&j.company) {
                b["rating"] = rating_brief(&r);
            }
            b
        };
        // Applications at a company where you know a recruiter, and haven't asked them yet: ask.
        let asks: Vec<Value> = db.jobs(None, 400)?.iter().filter(|j| ["approved", "applied"].contains(&j.status.as_str()))
            .filter_map(|j| crate::recruiters::for_company(&recruiters, &j.company).filter(|r| !r.asked.iter().any(|a| a.job_id == j.id)).map(|r| {
                let mut b = j.brief();
                b["recruiter"] = json!(r.name);
                b
            })).take(5).collect();
        let ready: Vec<Value> = db.jobs(Some("ready"), 8)?.iter().map(with_warnings).collect();
        let to_tailor: Vec<Value> = db.jobs(Some("queued"), 30)?.iter().map(with_warnings).collect();
        drop(db);
        let quiet_jobs = self.quiet_applications()?;
        let db = self.db();
        let rated = |j: &Job| {
            let mut b = j.brief();
            if let Some(r) = db.rating(&j.company) {
                b["rating"] = rating_brief(&r);
            }
            b
        };
        let quiet: Vec<Value> = quiet_jobs.iter().map(rated).collect();
        let approved: Vec<Value> = db.jobs(Some("approved"), 8)?.iter().map(rated).collect();
        let interviews = db.upcoming_interviews(&Utc::now().to_rfc3339(), 5)?;
        // Optional setup steps you said "Not now" to.
        let skipped_steps: Vec<&str> = ["google", "search_service"].into_iter().filter(|k| db.get(&format!("setup.skip.{k}")).ok().flatten().is_some()).collect();
        let tracks_missing: Vec<String> = profile.tracks.iter().filter(|t| !self.cv_path(&t.name).exists()).map(|t| t.label.clone()).collect();
        Ok(json!({
            "name": profile.name,
            "counts": counts,
            "applied_total": applied_ever,
            "response_rate": if applied_ever > 0 { Some(responded as f64 / applied_ever as f64) } else { None },
            "this_week": this_week,
            "last_week": last_week,
            "weeks": weeks.iter().map(|(d, c)| json!({"week": d, "count": c})).collect::<Vec<_>>(),
            "ready": ready,
            "to_tailor": to_tailor,
            "recruiter_asks": asks,
            "track_labels": profile.tracks.iter().map(|t| (t.name.clone(), t.label.clone())).collect::<BTreeMap<_, _>>(),
            "quiet": quiet,
            "auto_tailor": profile.auto_tailor,
            "approved": approved,
            "interviews": interviews,
            "events": db.recent_events(12)?,
            "last_search": db.get("last.search")?,
            "last_inbox": db.get("last.inbox")?,
            "running": self.running(),
            "progress": self.progress(),
            "sync_newer": newer,
            "in_use": in_use,
            "follow_ups": follow_ups,
            "closing_soon": closing,
            "health": health,
            "weekly_goal": profile.weekly_goal,
            "places": profile.locations,
            "auto_boards": profile.sources.auto_boards,
            "last_report": db.get("last.report")?.and_then(|r| serde_json::from_str::<Value>(&r).ok()),
            "setup": {
                "skipped": skipped_steps,
                "claude": claude_ready,
                "engine": engine,
                "cvs": profile.tracks.len(),
                "google": self.mail.read().unwrap().is_some(),
                "adzuna": !db.get("adzuna.key")?.unwrap_or_default().is_empty() || !db.get("jsearch.key")?.unwrap_or_default().is_empty() || !db.get("jooble.key")?.unwrap_or_default().is_empty(),
                "cvs_missing": tracks_missing,
            },
        }))
    }
}

/// Which connection a source-test row belongs to (see test_sources_only).
fn source_row_id(r: &Value) -> String {
    if r["kind"] == "board" {
        return "boards".into();
    }
    if r["kind"] == "site" {
        return "agencies".into();
    }
    let n = r["name"].as_str().unwrap_or("");
    for (prefix, id) in [("Adzuna", "adzuna"), ("Google for Jobs", "jsearch"), ("Jooble", "jooble"), ("Indeed", "indeed"), ("LinkedIn", "linkedin"), ("Job Bank", "jobbank"), ("Job-alert", "alerts")] {
        if n.starts_with(prefix) {
            return id.into();
        }
    }
    n.to_lowercase()
}

/// A stored job as a posting again, for the filters.
fn posting_of(j: &Job) -> Posting {
    let salary_max = j.salary.as_deref().and_then(crate::sources::salary_from_text).and_then(|s| s.1);
    Posting {
        title: j.title.clone(), company: j.company.clone(), location: j.location.clone(), description: j.description.clone(),
        salary: j.salary.clone(), salary_max, remote: j.location.to_lowercase().contains("remote"), url: j.url.clone(),
        ..Posting::default()
    }
}

/// The company-board lists in your sources, by source name.
fn board_lists(s: &mut crate::profile::Sources) -> [(&'static str, &mut Vec<String>); 6] {
    [
        ("greenhouse", &mut s.greenhouse),
        ("lever", &mut s.lever),
        ("ashby", &mut s.ashby),
        ("workday", &mut s.workday),
        ("smartrecruiters", &mut s.smartrecruiters),
        ("workable", &mut s.workable),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::*;
    use chrono::TimeZone;

    #[test]
    fn you_pick_the_roles_to_tailor_and_see_the_fit_before_and_after() {
        let s = setup();
        let mut p = s.agent.profile();
        p.auto_tailor = false;
        s.agent.save_profile(&p).unwrap();
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        assert_eq!((r.scored, r.tailored, r.to_pick), (2, 0, 2));
        assert!(!s.llm.calls.lock().unwrap().contains(&"tailor".to_string()), "nothing tailored before you pick");
        assert_eq!(s.agent.overview().unwrap()["to_tailor"].as_array().unwrap().len(), 2);
        assert!(s.notes.lock().unwrap().iter().any(|n| n.contains("worth applying")));
        assert!(s.agent.tailor_picked(&[]).is_err());
        assert_eq!(s.agent.tailor_picked(&["test:1".to_string()]).unwrap(), 1);
        for _ in 0..1000 {
            if s.agent.running().is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let one = s.agent.db().job("test:1").unwrap().unwrap();
        let two = s.agent.db().job("test:2").unwrap().unwrap();
        assert_eq!((one.status.as_str(), one.score, one.score_after), ("ready", Some(85), Some(92)));
        assert_eq!(two.status, "queued", "not picked");
        // Your CV is picked by itself: the one the scorer matched.
        assert_eq!(one.track.as_deref(), Some("program"));
    }

    #[test]
    fn you_can_edit_the_tailored_cv_or_use_your_own_files() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let job = s.agent.db().job("test:1").unwrap().unwrap();
        let change = job.cv_changes[0].clone();
        // Your own wording, even with a figure Claude couldn't add.
        let mine = "Led vendor management of 2 system integrators through UAT and release, cutting defects 40%.";
        let job = s.agent.edit_cv_paragraph("test:1", &change.after, mine).unwrap();
        assert_eq!(job.cv_changes[0].after, mine);
        let text = cv::open(Path::new(job.cv_path.as_ref().unwrap())).unwrap().plain_text();
        assert!(text.contains("cutting defects 40%"));
        assert!(s.agent.can_undo("test:1", "cv"));
        // Put back: the line from your CV, and the change is gone from the list.
        let job = s.agent.edit_cv_paragraph("test:1", mine, &change.before).unwrap();
        assert!(job.cv_changes.is_empty());
        assert!(s.agent.edit_cv_paragraph("test:1", "No such paragraph", "x").is_err());

        // Your own files: a Word CV and a PDF letter; Claude leaves them alone; switch back.
        let tailored = job.cv_path.clone();
        assert!(s.agent.use_own_file("test:1", "cv", "mine.txt", b"hello").is_err());
        assert!(s.agent.use_own_file("test:1", "letter", "letter.pdf", b"not a pdf").is_err());
        let job = s.agent.use_own_file("test:1", "cv", "My CV for Acme.docx", &cv::sample_docx()).unwrap();
        assert!(job.cv_path.as_deref().unwrap().ends_with("(yours).docx") && s.agent.own_file("test:1", "cv"));
        let job = s.agent.use_own_file("test:1", "letter", "Letter.pdf", b"%PDF-1.4 test").unwrap();
        assert!(job.letter_path.as_deref().unwrap().ends_with("(yours).pdf"));
        assert!(job.cover_letter.unwrap().contains("attached"), "the email body for a PDF letter");
        assert!(s.agent.revise("test:1", "cv", "Make it shorter").is_err());
        assert!(s.agent.save_cover_letter("test:1", "New text").is_err());
        s.agent.drop_own_file("test:1", "cv").unwrap();
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().cv_path, tailored);
        assert!(!s.agent.own_file("test:1", "cv") && s.agent.own_file("test:1", "letter"));
    }

    #[test]
    fn connections_show_their_status_and_test_one_at_a_time() {
        let s = setup();
        s.agent.db().set("claude.engine", "code").unwrap();
        let rows = s.agent.connections().unwrap();
        let ids: Vec<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
        for id in ["claude", "google", "jsearch", "indeed", "boards", "alerts", "phone", "sync", "backup"] {
            assert!(ids.contains(&id), "{id} in {ids:?}");
        }
        let indeed = |s: &crate::testkit::Setup| s.agent.connections().unwrap().into_iter().find(|r| r["id"] == "indeed").unwrap();
        assert_eq!(indeed(&s)["status"], "unknown");
        // A failing Indeed says how to fix it; testing it alone leaves the other rows be.
        s.agent.db().set("sources.test", &json!({ "results": [
            { "name": "Indeed “PM” in Toronto", "kind": "search", "ok": false, "error": "The Indeed connector isn't connected.", "hint": "" },
            { "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No Jooble key." }] }).to_string()).unwrap();
        let row = indeed(&s);
        assert_eq!(row["status"], "problem");
        // The error explains itself (Claude Code's own diagnosis); the row offers the claude.ai connectors page.
        assert_eq!(row["detail"], "The Indeed connector isn't connected.", "{row}");
        assert!(row["actions"].as_array().unwrap().iter().any(|a| a.as_str().unwrap_or("").starts_with("link:https://claude.ai")), "{row}");
        s.agent.test_sources_only(Some("indeed")).unwrap();
        let t: Value = serde_json::from_str(&s.agent.secret("sources.test")).unwrap();
        let names: Vec<&str> = t["results"].as_array().unwrap().iter().filter_map(|r| r["name"].as_str()).collect();
        assert!(names.contains(&"Jooble") && names.iter().filter(|n| n.starts_with("Indeed")).count() == 1, "{names:?}");
        assert_eq!(indeed(&s)["status"], "ok");
        // A search 7 hours ago where Indeed failed doesn't outweigh the test that just worked:
        // Connections and the Overview agree.
        let report = json!({ "source_problems": ["Indeed: the Indeed connector isn't available to Claude Code."] }).to_string();
        s.agent.db().set("last.report", &report).unwrap();
        s.agent.db().set("last.search", &(Utc::now() - Duration::hours(7)).to_rfc3339()).unwrap();
        assert_eq!(indeed(&s)["status"], "ok");
        assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Indeed")));
        // A later search that failed does.
        s.agent.db().set("last.search", &(Utc::now() + Duration::minutes(1)).to_rfc3339()).unwrap();
        assert_eq!(indeed(&s)["status"], "problem");
        let h = s.agent.health();
        assert!(h.iter().any(|h| h["text"] == "Indeed (through your Claude account) isn't working. See why and fix it in Settings \u{2192} Job sources."), "{h:?}");
        // Turned off.
        let mut p = s.agent.profile();
        p.sources.indeed = false;
        s.agent.save_profile(&p).unwrap();
        assert_eq!(indeed(&s)["status"], "off");
    }

    #[test]
    fn quiet_applications_can_be_closed() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        for id in ["test:1", "test:2"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
        }
        let old = (Utc::now() - Duration::days(50)).to_rfc3339();
        s.agent.db().update_job("test:1", &[("applied_at", old.into())]).unwrap();
        let quiet = s.agent.quiet_applications().unwrap();
        assert_eq!(quiet.iter().map(|j| j.id.as_str()).collect::<Vec<_>>(), vec!["test:1"], "only the old one");
        assert_eq!(s.agent.overview().unwrap()["quiet"].as_array().unwrap().len(), 1);
        s.agent.db().set_status("test:1", "no_response", "quiet for 7 weeks").unwrap();
        assert!(s.agent.quiet_applications().unwrap().is_empty());
        let row = s.agent.tracker(Some("test:1")).unwrap().pop().unwrap();
        assert_eq!(row["who"], "done");
    }

    #[test]
    fn interviews_added_by_hand_and_the_calendar() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None; // without Google: Job Hunt keeps them itself
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let when = (Utc::now() + Duration::days(3)).to_rfc3339();
        assert!(s.agent.add_interview("test:1", "not a date", 60, "", "").is_err());
        let made = s.agent.add_interview("test:1", &when, 45, "https://meet.example/x", "Panel of three").unwrap();
        assert!(made.len() >= 2 && made.iter().all(|id| id.starts_with("local:")), "{made:?}");
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "interviewing");
        assert!(s.agent.add_interview("test:1", &when, 45, "", "").is_err(), "not twice");
        // An application waiting on a reply shows when its follow-up is due.
        s.agent.search(Some(vec![posting("Senior Program Manager", "2")])).unwrap();
        s.agent.db().set_status("test:2", "applied", "").unwrap();
        let items = s.agent.calendar(1, 30).unwrap();
        assert!(items.iter().any(|i| i["kind"] == "follow-up" && i["job_id"] == "test:2"));
        let kinds: Vec<&str> = items.iter().filter_map(|i| i["kind"].as_str()).collect();
        assert!(kinds.contains(&"interview") && kinds.contains(&"prep") && kinds.contains(&"reminder"), "{kinds:?}");
        let ics = s.agent.calendar_ics().unwrap();
        assert!(ics.starts_with("BEGIN:VCALENDAR") && ics.contains("SUMMARY:Interview: Acme"));
        let interview = items.iter().find(|i| i["kind"] == "interview").unwrap()["id"].as_str().unwrap().to_string();
        assert!(s.agent.db().delete_calendar_event(&interview).unwrap() >= 2, "prep and reminders go with it");
        assert!(!s.agent.calendar(1, 30).unwrap().iter().any(|i| i["kind"] == "interview"));
    }

    #[test]
    fn filling_in_an_application_form() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let fields = vec![
            json!({ "key": "f0", "type": "text", "label": "First Name", "required": true, "value": "" }),
            json!({ "key": "f1", "type": "email", "label": "Email", "required": true, "value": "" }),
            json!({ "key": "g2", "type": "radio", "label": "Are you legally able to work in Canada?", "options": ["Yes", "No"], "value": "" }),
            json!({ "key": "f3", "type": "file", "label": "Resume/CV", "value": "" }),
            json!({ "key": "f4", "type": "text", "label": "Favourite colour", "value": "" }),
        ];
        let a = crate::fill::answers(&s.agent, "test:1", &fields).unwrap();
        assert_eq!(a["values"]["f1"], "me@example.com");
        assert_eq!(a["values"]["g2"], "Yes");
        assert!(a["values"].get("f4").is_none(), "nothing to say: left for you");
        // The tailored CV, for the upload field (as Word here: no PDF converter on the test machine).
        let cv = &a["files"]["f3"];
        assert!(cv["name"].as_str().unwrap().contains("CV") && !cv["b64"].as_str().unwrap().is_empty(), "{cv}");
        assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("fill:")));
        crate::fill::submitted(&s.agent, "test:1", "https://boards.greenhouse.io/acme/jobs/1", true).unwrap();
        let j = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!(j.status, "applied");
    }

    #[test]
    fn recruiters_and_job_sites_status() {
        let s = setup();
        let row = |s: &crate::testkit::Setup| s.agent.connections().unwrap().into_iter().find(|r| r["id"] == "agencies").unwrap();
        assert_eq!(row(&s)["status"], "setup", "none chosen yet");
        let mut p = s.agent.profile();
        p.sources.sites = vec!["michaelpage".into(), "hays".into(), "lro".into()];
        s.agent.save_profile(&p).unwrap();
        // The last search: Michael Page found postings, Hays turned it away, LRO's page had none.
        let report = json!({ "by_source": [
            { "name": "Michael Page", "searches": 2, "found": 14, "failed": 0 },
            { "name": "Hays", "searches": 2, "found": 0, "failed": 2 },
            { "name": "LRO Staffing", "searches": 1, "found": 0, "failed": 0 } ],
            "source_problems": ["Hays \u{201c}Tax Manager\u{201d}: the site turned the request away (it may block automated reading)"] });
        s.agent.db().set("last.report", &report.to_string()).unwrap();
        s.agent.db().set("last.search", &now()).unwrap();
        let st = s.agent.site_status();
        let by = |id: &str| st.iter().find(|x| x["id"] == id).unwrap().clone();
        assert_eq!((by("michaelpage")["state"].as_str(), by("hays")["state"].as_str(), by("lro")["state"].as_str()), (Some("ok"), Some("problem"), Some("quiet")));
        assert!(by("hays")["detail"].as_str().unwrap().contains("turned the request away"));
        let r = row(&s);
        // Some working and some not: "partial", never Working over a site that fails, with the
        // ones to turn off.
        assert_eq!(r["status"], "partial", "{r}");
        assert_eq!(r["data"], json!(["hays"]));
        assert!(r["detail"].as_str().unwrap().contains("couldn't read Hays") && r["detail"].as_str().unwrap().contains("no postings from LRO Staffing"), "{r}");
        assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Recruiters")), "not a problem to fix");
        // None working: then it is.
        let report = json!({ "by_source": [{ "name": "Michael Page", "searches": 2, "found": 0, "failed": 2 }, { "name": "Hays", "searches": 2, "found": 0, "failed": 2 }, { "name": "LRO Staffing", "searches": 1, "found": 0, "failed": 1 }] });
        s.agent.db().set("last.report", &report.to_string()).unwrap();
        assert_eq!(row(&s)["status"], "problem");
        // A site of your own, by its search address.
        let mut p = s.agent.profile();
        p.sources.custom_sites = vec![crate::sites::CustomSite { name: "Eluta".into(), url: "https://www.eluta.ca/search?q={title}&l={place}".into() }];
        s.agent.save_profile(&p).unwrap();
        assert!(s.agent.site_status().iter().any(|x| x["name"] == "Eluta" && x["template"] == "https://www.eluta.ca/search?q={q}&l={l}"));
    }

    #[test]
    fn connections_turn_off_one_by_one() {
        let s = setup();
        s.agent.db().set("jooble.key", "k").unwrap();
        let mut p = s.agent.profile();
        p.sources.greenhouse = vec!["acme".into()];
        p.sources.set_on("jooble", false);
        p.sources.set_on("boards", false);
        s.agent.save_profile(&p).unwrap();
        let p = s.agent.profile();
        assert!(p.sources.is_off("jooble") && p.sources.is_off("boards") && !p.sources.is_off("adzuna"));
        // Not searched: no request to either.
        let f = crate::sources::fetch_all(&p, &s.agent.search_keys(), &|_, _, _| {});
        assert!(f.by_source.iter().all(|b| b.0 != "Jooble" && b.0 != "Company job boards"), "{:?}", f.by_source);
        let rows = s.agent.connections().unwrap();
        let row = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap().clone();
        assert_eq!((row("jooble")["status"].as_str(), row("jooble")["actions"][0].as_str()), (Some("off"), Some("on")));
        assert_eq!(row("boards")["status"], "off");
        assert!(row("alerts")["actions"].as_array().unwrap().contains(&json!("off")), "the others can be turned off");
        // Back on: as before, key and boards still there.
        let mut p = s.agent.profile();
        p.sources.set_on("jooble", true);
        s.agent.save_profile(&p).unwrap();
        let rows = s.agent.connections().unwrap();
        assert_ne!(rows.iter().find(|r| r["id"] == "jooble").unwrap()["status"], "off");
        assert_eq!(s.agent.profile().sources.greenhouse, vec!["acme".to_string()]);
    }

    #[test]
    fn no_job_alert_emails_is_not_a_problem() {
        let s = setup();
        assert!(s.agent.mail.read().unwrap().is_some(), "Gmail connected");
        // A test saved by an older version: no alerts this week, marked as failing.
        let old = json!({ "started": now(), "finished": now(), "results": [{ "id": "alerts", "name": "Job-alert emails (LinkedIn, Indeed, Glassdoor, Job Bank)", "kind": "email",
            "ok": false, "found": 0, "unit": "emails this week", "hint": "None this week. On LinkedIn, Indeed, Glassdoor and Job Bank, set up job alerts.", "at": now() }] });
        s.agent.db().set("sources.test", &old.to_string()).unwrap();
        let rows = s.agent.connections().unwrap();
        let alerts = rows.iter().find(|r| r["id"] == "alerts").unwrap();
        assert_eq!(alerts["status"], "ok", "{alerts}");
        assert!(alerts["detail"].as_str().unwrap().starts_with("0 emails this week. None this week"), "{alerts}");
        assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Job-alert")), "nothing to fix");
        // A real error still is one.
        let broken = json!({ "finished": now(), "results": [{ "id": "alerts", "name": "Job-alert emails", "kind": "email", "ok": false, "error": "Google said 401", "hint": "Reconnect Google.", "at": now() }] });
        s.agent.db().set("sources.test", &broken.to_string()).unwrap();
        assert_eq!(s.agent.connections().unwrap().iter().find(|r| r["id"] == "alerts").unwrap()["status"], "problem");
    }

    #[test]
    fn emailing_the_recruiter_when_you_apply() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        crate::recruiters::edit(&s.agent, &json!({ "email": "jane@acme.example", "name": "Jane Smith", "company": "Acme" })).unwrap();
        // Draft (the default): in Gmail drafts, once.
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let v = crate::recruiters::on_applied(&s.agent, "test:1").unwrap().unwrap();
        assert_eq!((v["to"].as_str(), v["drafted"].as_bool(), v["sent"].as_bool()), (Some("jane@acme.example"), Some(true), Some(false)));
        assert!(s.mail.drafts.lock().unwrap().iter().any(|(to, _)| to == "to:jane@acme.example"));
        assert!(crate::recruiters::on_applied(&s.agent, "test:1").unwrap().is_none(), "not twice for one application");
        // Another application the same week: not again to her.
        s.agent.db().set_status("test:2", "applied", "").unwrap();
        assert!(crate::recruiters::on_applied(&s.agent, "test:2").unwrap().is_none(), "once a week at most");
        assert!(crate::recruiters::for_job(&s.agent, "test:1").iter().any(|l| l["email"] == "jane@acme.example"), "saved with the application");
        // Off: nothing.
        s.agent.db().set("apply.recruiter", "off").unwrap();
        crate::recruiters::set_hidden(&s.agent, "jane@acme.example", true).unwrap();
        assert!(crate::recruiters::on_applied(&s.agent, "test:2").unwrap().is_none());
    }

    #[test]
    fn emailing_the_person_named_in_the_posting() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        let p = Posting { description: "Apply through our site. Questions? careers@acme.example, or Maria Lopez (maria.lopez@acme.example), Talent Acquisition.".into(), ..posting("Technical Program Manager", "1") };
        s.agent.search(Some(vec![p])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let job = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!(crate::recruiters::contact_for(&s.agent, &job), Some(("maria.lopez@acme.example".into(), String::new(), false)), "not the careers@ inbox");
        // Sent, with the CV, when you chose that.
        s.agent.db().set("apply.recruiter", "send").unwrap();
        s.agent.db().set("apply.recruiter_cv", "1").unwrap();
        let v = crate::recruiters::on_applied(&s.agent, "test:1").unwrap().unwrap();
        assert_eq!(v["sent"], true);
        let sent = s.mail.sent.lock().unwrap();
        assert_eq!(sent[0].0, "maria.lopez@acme.example");
        assert_eq!(sent[0].1.len(), if job.cv_path.is_some() { 1 } else { 0 }, "the tailored CV attached");
    }

    #[test]
    fn recruiters_saved_with_their_applications() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        // A list kept before the database had a table: moved over.
        s.agent.db().set("recruiters", &json!([{ "email": "old@globex.example", "name": "Olga", "company": "Globex", "stage": "screen" }]).to_string()).unwrap();
        assert_eq!(crate::recruiters::list(&s.agent)[0].company, "Globex");
        assert!(s.agent.secret("recruiters").is_empty());
        // You applied; the recruiter writes about it.
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        s.mail.messages.lock().unwrap().insert("m9".into(), crate::google::Email { id: "m9".into(), thread_id: "t9".into(), from: "Priya Shah <priya.shah@acme.example>".into(),
            subject: "Your application: Technical Program Manager".into(), received_at: "2026-10-01T14:00:00Z".into(),
            body: "Hi, thanks for applying. Are you free for a call this week?\n\nPriya Shah\nTalent Acquisition, Acme\n(416) 555-0199\nlinkedin.com/in/priyashah\n\nOn Mon, Sam wrote:\n> my old email 647-555-0000".into(), ..Default::default() });
        s.llm.triages.lock().unwrap().push(triage("interview_request", Some("test:1")));
        s.agent.process_inbox(50).unwrap();
        let here = crate::recruiters::for_job(&s.agent, "test:1");
        assert_eq!(here.len(), 1, "{here:?}");
        assert_eq!((here[0]["email"].as_str(), here[0]["stage"].as_str(), here[0]["name"].as_str()), (Some("priya.shah@acme.example"), Some("interview"), Some("Priya Shah")));
        let r = crate::recruiters::list(&s.agent).into_iter().find(|r| r.email == "priya.shah@acme.example").unwrap();
        assert_eq!((r.phone.as_str(), r.linkedin.as_str()), ("(416) 555-0199", "https://linkedin.com/in/priyashah"), "from her signature, not the quoted email");
        assert!(s.agent.contacts("test:1").iter().any(|c| c["email"] == "priya.shah@acme.example"), "on the application's People list");
        // Added by you, to the same application; and all of it as a spreadsheet.
        crate::recruiters::edit(&s.agent, &json!({ "email": "Sam@Acme.example", "name": "Sam Lee", "company": "Acme", "notes": "Met at a meetup", "job_id": "test:1" })).unwrap();
        assert_eq!(crate::recruiters::for_job(&s.agent, "test:1").len(), 2);
        assert!(crate::recruiters::edit(&s.agent, &json!({ "email": "nobody" })).is_err());
        let csv = crate::recruiters::csv(&s.agent);
        assert!(csv.contains("\"Priya Shah\",\"Acme\"") && csv.contains("Technical Program Manager (interviewing)") && csv.contains("Met at a meetup"), "{csv}");
        // An application deleted: its links go too.
        s.agent.db().delete_job("test:1").unwrap();
        assert!(crate::recruiters::for_job(&s.agent, "test:1").is_empty());
    }

    #[test]
    fn recruiters_linked_from_emails_already_read() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().record_email("old1", "t", Some("test:1"), "Dana Wu <dana@acme.example>", "Re: your interview", "interview_confirmed", "s", None, "2026-05-02T10:00:00Z").unwrap();
        s.agent.db().record_email("old2", "t", Some("test:1"), "Acme <no-reply@greenhouse.io>", "Thanks for applying", "application_received", "s", None, "2026-05-01T10:00:00Z").unwrap();
        assert_eq!(crate::recruiters::backfill(&s.agent).unwrap(), 1, "the person, not the automated email");
        assert_eq!(crate::recruiters::backfill(&s.agent).unwrap(), 0, "once");
        let here = crate::recruiters::for_job(&s.agent, "test:1");
        assert_eq!((here[0]["email"].as_str(), here[0]["stage"].as_str()), (Some("dana@acme.example"), Some("interview")));
    }

    #[test]
    fn recruiters_you_know_and_asking_them() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        let mail = |id: &str, from: &str, subject: &str| crate::google::Email { id: id.into(), thread_id: id.into(), from: from.into(), subject: subject.into(),
            body: "Thanks for your time on the call. Unfortunately we've moved forward with another candidate.".into(), received_at: "2026-04-10T15:00:00Z".into(), ..Default::default() };
        {
            let mut m = s.mail.messages.lock().unwrap();
            m.insert("r1".into(), mail("r1", "Jane Recruiter <jane@acme.example>", "Tax Manager: next steps"));
            m.insert("r2".into(), mail("r2", "Jane Recruiter <jane@acme.example>", "Re: Tax Manager interview"));
            m.insert("r3".into(), mail("r3", "Acme Careers <no-reply@greenhouse.io>", "Thank you for applying"));
            m.insert("r4".into(), mail("r4", "Acme Careers <careers@acme.example>", "Your application"));
        }
        let v = crate::recruiters::scan(&s.agent).unwrap();
        assert_eq!((v["found"].as_u64(), v["new"].as_u64()), (Some(1), Some(1)), "{v}");
        let list = crate::recruiters::list(&s.agent);
        assert_eq!((list[0].email.as_str(), list[0].company.as_str(), list[0].emails), ("jane@acme.example", "Acme", 2));
        assert!(s.mail.labels.lock().unwrap().iter().filter(|(_, l)| l == crate::recruiters::LABEL).count() == 2, "her emails in one Gmail label");
        // A posting at Acme: she's named on it, and asking her drafts the email in Gmail.
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let ov = s.agent.overview().unwrap();
        let named = ov["to_tailor"].as_array().unwrap().iter().chain(ov["ready"].as_array().unwrap()).any(|j| j["recruiter"] == "Jane Recruiter");
        assert!(named, "{}", ov["to_tailor"]);
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        assert_eq!(s.agent.overview().unwrap()["recruiter_asks"].as_array().unwrap().len(), 1, "a reminder to ask her");
        let a = crate::recruiters::ask(&s.agent, "test:1").unwrap();
        assert_eq!((a["to"].as_str(), a["drafted"].as_bool()), (Some("jane@acme.example"), Some(true)));
        assert!(s.mail.drafts.lock().unwrap().iter().any(|(to, _)| to == "to:jane@acme.example"));
        assert!(s.agent.overview().unwrap()["recruiter_asks"].as_array().unwrap().is_empty(), "asked: not reminded again");
        assert!(s.agent.contacts("test:1").iter().any(|c| c["email"] == "jane@acme.example"));
        // Hidden: not used.
        crate::recruiters::set_hidden(&s.agent, "jane@acme.example", true).unwrap();
        assert!(crate::recruiters::ask(&s.agent, "test:1").is_err());
    }

    #[test]
    fn next_wake_for_the_daily_search() {
        let s = setup();
        assert!(s.agent.next_wake().is_none(), "off until turned on");
        s.agent.db().set("app.wake", "1").unwrap();
        let tz = s.agent.profile().tz();
        let w = s.agent.next_wake().unwrap().with_timezone(&tz);
        let now = Utc::now();
        assert!(w > now && w <= now + Duration::days(1) + Duration::hours(2), "{w}");
        use chrono::Timelike;
        let hours = [s.agent.profile().search_hour, 18];
        assert!(hours.contains(&w.hour()) && w.minute() == 1, "{w}");
    }

    #[test]
    fn budget_night_urgent_notices_and_held_batches() {
        assert!(is_night(23, 22) && is_night(3, 22) && !is_night(12, 22));
        assert!(is_night(2, 2) && is_night(5, 2) && !is_night(1, 2) && !is_night(14, 2), "an hour after midnight");
        assert!(is_urgent("Interview tomorrow at 10:00 AM: Acme") && is_urgent("Reply from Acme"));
        assert!(!is_urgent("Interview prep didn't finish") && !is_urgent("Your week in Job Hunt"));
        let s = setup();
        s.agent.defer(json!({ "kind": "rescore", "group": "skipped" })).unwrap();
        s.agent.defer(json!({ "kind": "rescore", "group": "dismissed" })).unwrap();
        s.agent.defer(json!({ "kind": "rescore", "group": "skipped" })).unwrap();
        s.agent.defer(json!({ "kind": "tailor", "ids": ["a", "b"] })).unwrap();
        s.agent.defer(json!({ "kind": "tailor", "ids": ["b", "c"] })).unwrap();
        let held = s.agent.deferred();
        assert_eq!(held.iter().filter(|w| w["kind"] == "rescore").count(), 2, "one per group: {held:?}");
        assert_eq!(held.iter().find(|w| w["kind"] == "tailor").unwrap()["ids"], json!(["a", "b", "c"]));
    }

    #[test]
    fn all_day_google_events_stay_on_their_day() {
        let s = setup();
        let day = (Utc::now() + Duration::days(3)).date_naive();
        let cache = json!({ "at": now(), "events": [{ "id": "g1", "title": "Offsite", "start": format!("{day}T00:00:00+00:00"), "all_day": true, "suggest": null }] });
        s.agent.db().set("gcal.cache", &cache.to_string()).unwrap();
        let item = s.agent.calendar(1, 30).unwrap().into_iter().find(|i| i["id"] == "g1").unwrap();
        let at = chrono::DateTime::parse_from_rfc3339(item["at"].as_str().unwrap()).unwrap().with_timezone(&s.agent.profile().tz());
        assert_eq!(at.date_naive(), day, "noon where you are, not midnight UTC (the evening before in Toronto)");
        assert!(s.agent.link_calendar_event("g1", "test:1").unwrap_err().0.contains("all-day"));
    }

    #[test]
    fn morning_digest_with_an_interview_tomorrow() {
        let s = setup();
        *s.agent.cal.write().unwrap() = None;
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        s.agent.add_interview("test:1", &(Utc::now() + Duration::hours(20)).to_rfc3339(), 60, "", "").unwrap();
        // Used to hang: the time zone was read while the interview list held the database.
        let text = s.agent.morning_digest().unwrap().unwrap();
        assert!(text.starts_with("Interview: Acme"), "{text}");
    }

    #[test]
    fn interview_eve_and_thank_you() {
        let s = setup();
        // Claude counts as set up whether or not Claude Code is installed on this machine.
        s.agent.db().set("claude.engine", "api").unwrap();
        s.agent.db().set("claude.key", "test").unwrap();
        *s.agent.cal.write().unwrap() = None;
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        for id in ["test:1", "test:2"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
        }
        s.agent.add_interview("test:1", &(Utc::now() + Duration::hours(3)).to_rfc3339(), 60, "", "").unwrap();
        s.agent.add_interview("test:2", &(Utc::now() - Duration::hours(2)).to_rfc3339(), 60, "", "").unwrap();
        let done = s.agent.interview_care().unwrap();
        assert_eq!(done, vec!["thanks:test:2".to_string(), "eve:test:1".to_string()]);
        assert!(s.agent.prep("test:1").is_some(), "prep written for the eve");
        let notes = s.notes.lock().unwrap().clone();
        assert!(notes.iter().any(|n| n.starts_with("Interview today at") || n.starts_with("Interview tomorrow at")), "{notes:?}");
        assert!(notes.contains(&"Thank-you note for Acme".to_string()));
        let t = s.agent.thank_you("test:2").unwrap();
        assert!(t["subject"].as_str().unwrap().starts_with("Thank you") && t["draft"].is_string(), "{t}");
        assert!(s.agent.interview_care().unwrap().is_empty(), "once each");
    }

    #[test]
    fn results_by_title_and_pay_and_career_paths() {
        let s = setup();
        let paid = |t: &str, ext: &str, pay: &str| Posting { salary: Some(pay.into()), ..posting(t, ext) };
        s.agent.search(Some(vec![
            paid("Senior Technical Program Manager", "1", "$120,000 - $140,000"), paid("Technical Program Manager II", "2", "$90,000 - $100,000"),
            posting("Program Manager, Delivery", "3"),
        ])).unwrap();
        for id in ["test:1", "test:2", "test:3"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
        }
        s.agent.db().set_status("test:1", "interviewing", "").unwrap();
        let r = s.agent.results().unwrap();
        let tpm = r["by_title"].as_array().unwrap().iter().find(|g| g["name"] == "Technical Program Manager").unwrap();
        assert_eq!((tpm["sent"].as_u64(), tpm["interviews"].as_u64()), (Some(2), Some(1)), "{}", r["by_title"]);
        let bands: Vec<&str> = r["by_pay"].as_array().unwrap().iter().filter_map(|g| g["name"].as_str()).collect();
        assert_eq!(bands, vec!["$80k–100k", "$120k–140k", "Not stated"]);
        assert_eq!(r["market_pay"][0]["postings"].as_u64(), Some(2));
        let c = s.agent.write_career_paths().unwrap();
        assert_eq!(c["paths"][0]["title"], "Data Engineering Manager");
        assert!(s.agent.results().unwrap()["career"]["paths"].is_array());
        let track = s.agent.profile().tracks[0].name.clone();
        assert_eq!(s.agent.add_titles(&track, &["Data Systems Lead".into(), "data systems lead".into()]).unwrap(), 1);
        assert!(s.agent.profile().tracks[0].titles.contains(&"Data Systems Lead".to_string()));
    }

    #[test]
    fn warnings_about_postings() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let old = (Utc::now() - Duration::days(50)).to_rfc3339();
        s.agent.db().backdate("test:1", &old).unwrap();
        // The same role on another site, undated: likely the same posting, not a repost.
        s.agent.search(Some(vec![Posting { url: "https://acme.example/jobs/98".into(), ..posting("Technical Program Manager", "3") }])).unwrap();
        assert!(s.agent.db().reposts().unwrap().is_empty());
        // The same role, as a new listing dated weeks after it was first found: a repost.
        let yesterday = (Utc::now() - Duration::days(1)).format("%Y-%m-%d").to_string();
        s.agent.search(Some(vec![Posting { url: "https://acme.example/jobs/99".into(), posted_at: Some(yesterday), ..posting("Technical Program Manager", "2") }])).unwrap();
        let reposts = s.agent.db().reposts().unwrap();
        assert_eq!(reposts.get("test:1"), Some(&1));
        let j = s.agent.db().job("test:1").unwrap().unwrap();
        let w = posting_warnings(&j, 1, Utc::now());
        assert!(w.iter().any(|x| x.contains("Posted again")) && w.iter().any(|x| x.contains("50 days")), "{w:?}");
        let pool = Job { description: "Join our talent community for future opportunities.".into(), found_at: Utc::now().to_rfc3339(), ..j.clone() };
        assert!(posting_warnings(&pool, 0, Utc::now())[0].contains("Not an open role"));
        let agency = Job { company: "Northstar Staffing Inc.".into(), description: "Our client, a leading bank, is hiring.".into(), found_at: Utc::now().to_rfc3339(), ..j.clone() };
        assert_eq!(posting_warnings(&agency, 0, Utc::now()), vec!["A recruiting agency, for a client it doesn't name.".to_string()]);
        let fine = Job { found_at: Utc::now().to_rfc3339(), ..j };
        assert!(posting_warnings(&fine, 0, Utc::now()).is_empty());
        assert_eq!(posted_date("1760000000").unwrap().timestamp(), 1760000000);
        assert!(posted_date("jsearch|2026-10-01").is_some() && posted_date("3 days ago").is_none());
    }

    #[test]
    fn two_way_google_calendar_sync() {
        use crate::google::CalItem;
        let s = setup();
        *s.agent.cal.write().unwrap() = None; // kept locally first
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let when = (Utc::now() + Duration::days(3)).to_rfc3339();
        s.agent.add_interview("test:1", &when, 60, "", "").unwrap();
        s.agent.search(Some(vec![Posting { company: "Globex".into(), url: "https://globex.example/9".into(), ..posting("Senior Program Manager", "2") }])).unwrap();
        s.agent.db().set_status("test:2", "applied", "").unwrap();
        // Google connected: local entries are copied there.
        *s.agent.cal.write().unwrap() = Some(s.cal.clone());
        let r = s.agent.sync_calendar().unwrap();
        assert!(r["pushed"].as_i64().unwrap() >= 2, "{r}");
        assert!(s.agent.db().calendar_ids().unwrap().iter().all(|e| !e.event_id.starts_with("local:")));
        let interview = s.agent.db().calendar_ids().unwrap().into_iter().find(|e| e.kind == "interview").unwrap();
        // In Google: the interview is moved, a reminder deleted, and a new event looks like a Globex interview.
        let later = (Utc::now() + Duration::days(4)).to_rfc3339();
        let other = s.agent.db().calendar_ids().unwrap().into_iter().find(|e| e.kind != "interview").unwrap();
        let start = (Utc::now() + Duration::days(5)).to_rfc3339();
        *s.cal.items.lock().unwrap() = vec![
            CalItem { id: interview.event_id.clone(), summary: interview.title.clone(), start: later.clone(), ..Default::default() },
            CalItem { id: other.event_id.clone(), cancelled: true, ..Default::default() },
            CalItem { id: "g1".into(), summary: "Interview - Globex".into(), start: start.clone(), ..Default::default() },
            CalItem { id: "g2".into(), summary: "Dentist".into(), start: start.clone(), ..Default::default() },
        ];
        let r = s.agent.sync_calendar().unwrap();
        assert_eq!((r["moved"].as_i64(), r["removed"].as_i64(), r["others"].as_i64()), (Some(1), Some(1), Some(2)), "{r}");
        let ids = s.agent.db().calendar_ids().unwrap();
        assert_eq!(ids.iter().find(|e| e.event_id == interview.event_id).unwrap().start, later);
        assert!(!ids.iter().any(|e| e.event_id == other.event_id));
        let items = s.agent.calendar(1, 30).unwrap();
        let g1 = items.iter().find(|i| i["id"] == "g1").unwrap();
        assert_eq!((g1["kind"].as_str(), g1["suggest"]["job_id"].as_str()), (Some("google"), Some("test:2")));
        assert!(items.iter().find(|i| i["id"] == "g2").unwrap()["suggest"].is_null());
        // Linking it makes it that application's interview.
        s.agent.link_calendar_event("g1", "test:2").unwrap();
        assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().status, "interviewing");
        let items = s.agent.calendar(1, 30).unwrap();
        assert!(items.iter().any(|i| i["id"] == "g1" && i["kind"] == "interview" && i["job_id"] == "test:2"));
        s.agent.db().set("cal.show_google", "0").unwrap();
        assert!(!s.agent.calendar(1, 30).unwrap().iter().any(|i| i["kind"] == "google"));
    }

    #[test]
    fn the_same_posting_by_link_counts_once() {
        let s = setup();
        let a = Posting { url: "https://acme.example/jobs/77?utm_source=jsearch".into(), ..posting("Technical Program Manager", "1") };
        let b = Posting { source: "jsearch".into(), company: "Acme Inc. (Canada)".into(), title: "Technical Program Manager - Payments".into(), url: "https://www.acme.example/en-US/jobs/77/apply".into(), ..posting("x", "2") };
        let r = s.agent.search(Some(vec![a, b.clone()])).unwrap();
        assert_eq!(r.new, 1, "one search, two sources");
        let r = s.agent.search(Some(vec![Posting { external_id: "3".into(), ..b }])).unwrap();
        assert_eq!((r.new, r.known), (0, 1), "a later search");
    }

    #[test]
    fn tailor_anyway_rescore_and_purge() {
        let s = setup();
        s.llm.scores.lock().unwrap().insert("Weak Program Manager".into(), 40);
        let far = Posting { location: "Vancouver, BC".into(), ..posting("Program Manager", "3") };
        s.agent.search(Some(vec![posting("Weak Program Manager", "2"), far])).unwrap();
        // Tailor anyway: a low score, and one the filters left out (never scored, outside your places).
        let low = s.agent.tailor_anyway("test:2", None).unwrap();
        assert_eq!((low.status.as_str(), low.score), ("ready", Some(40)));
        let out = s.agent.tailor_anyway("test:3", None).unwrap();
        assert_eq!(out.status, "ready");
        assert!(out.score.is_some(), "scored first");
        s.agent.drop_outside_locations().unwrap();
        assert_eq!(s.agent.db().job("test:3").unwrap().unwrap().status, "ready", "you chose it: kept");

        // Rescore: a skipped posting that now clears the bar.
        s.agent.search(Some(vec![posting("Weak Program Manager", "5")])).unwrap_or_default();
        let mut job = posting("Senior Program Manager", "6").to_job();
        (job.status, job.score) = ("skipped".into(), Some(30));
        s.agent.db().insert_job(&job).unwrap();
        let plan = s.agent.rescore_plan("skipped").unwrap();
        assert!(plan["to_score"].as_u64().unwrap() >= 1);
        let r = s.agent.rescore("skipped").unwrap();
        assert!(r["cleared"].as_u64().unwrap() >= 1);
        assert_eq!(s.agent.db().job("test:6").unwrap().unwrap().status, "queued");
        assert!(s.agent.rescore_plan("everything").is_err());

        // Purge: old skipped postings go and are remembered; tailored ones stay.
        let mut old = posting("Barista", "9").to_job();
        old.status = "skipped".into();
        s.agent.db().insert_job(&old).unwrap();
        s.agent.db().con.execute("UPDATE jobs SET updated_at = '2020-01-01T00:00:00Z' WHERE id IN ('test:9', 'test:2')", []).unwrap();
        assert_eq!(s.agent.db().purge_older_than(0).unwrap(), 0, "off");
        assert_eq!(s.agent.db().purge_older_than(30).unwrap(), 1);
        assert!(s.agent.db().job("test:9").unwrap().is_none() && s.agent.db().job("test:2").unwrap().is_some());
        assert!(s.agent.db().job_exists("test:9", "Co", "Barista").unwrap(), "not new if found again");
    }

    #[test]
    fn the_tracker_shows_steps_and_whats_next() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let row = s.agent.tracker(Some("test:1")).unwrap().pop().unwrap();
        assert_eq!((row["who"].as_str(), row["last_step"].as_str()), (Some("you"), Some("Tailored")));
        // The morning summary mentions it, once a day.
        let digest = s.agent.morning_digest().unwrap().unwrap();
        assert!(digest.contains("1 application to review"), "{digest}");
        assert!(s.notes.lock().unwrap().contains(&"Today in Job Hunt".to_string()));
        assert!(!due_tasks(&s.agent).contains(&"digest"), "done for today");
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let rows = s.agent.tracker(None).unwrap();
        let row = rows.iter().find(|r| r["id"] == "test:1").unwrap();
        assert_eq!((row["who"].as_str(), row["last_step"].as_str()), (Some("them"), Some("Applied")));
        assert!(row["next"].as_str().unwrap().starts_with("Waiting for a reply"));
        assert!(row["steps"][3]["at"].is_null(), "no reply yet");
    }

    #[test]
    fn search_scores_filters_and_tailors() {
        let s = setup();
        s.llm.scores.lock().unwrap().insert("Weak Program Manager".into(), 40);
        let far = Posting { location: "Vancouver, BC".into(), ..posting("Program Manager", "3") };
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Weak Program Manager", "2"), far, posting("Technical Program Manager", "4")])).unwrap();
        assert_eq!((r.new, r.filtered, r.scored, r.tailored), (3, 1, 2, 1));
        let job = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!(job.status, "ready");
        assert!(job.coverage_after.unwrap() > job.coverage_before.unwrap());
        assert!(job.keyword_gaps.contains(&"Kubernetes".to_string()));
        assert!(job.cv_changes[0].before.starts_with("Managed contracted"));
        let tailored = cv::open(Path::new(job.cv_path.as_ref().unwrap())).unwrap();
        assert!(tailored.plain_text().contains("Led vendor management of contracted"));
        assert!(Path::new(job.letter_path.as_ref().unwrap()).exists());
        assert!(job.cv_path.unwrap().ends_with("Jane Candidate - Acme.docx"));
        assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().status, "skipped");
        assert!(s.agent.db().job("test:3").unwrap().unwrap().reasoning.unwrap().starts_with("Filtered out: location"));
        assert_eq!(*s.notes.lock().unwrap(), vec!["1 application ready"]);
        // Again: nothing new, nothing re-scored.
        let calls = s.llm.calls.lock().unwrap().len();
        assert_eq!(s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap().new, 0);
        assert_eq!(s.llm.calls.lock().unwrap().len(), calls);
    }

    #[test]
    fn daily_cap_queues_the_rest() {
        let s = setup();
        let mut p = s.agent.profile();
        p.max_per_run = 1;
        s.agent.db().save_profile(&p).unwrap();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        let counts = s.agent.db().counts().unwrap();
        assert_eq!((counts["ready"].as_i64(), counts["queued"].as_i64()), (Some(1), Some(1)));
        drop(counts);
        s.agent.search(Some(vec![])).unwrap();
        assert_eq!(s.agent.db().counts().unwrap()["ready"].as_i64(), Some(2));
    }

    #[test]
    fn no_cv_no_search() {
        let s = setup();
        std::fs::remove_file(s.agent.cv_path("program")).unwrap();
        assert!(s.agent.search(Some(vec![])).unwrap_err().0.contains("No CV"));
    }

    #[test]
    fn a_posting_sent_twice_points_at_the_one_there() {
        let s = setup();
        let clip = json!({"url": "https://careers.acme.example/1", "title": "Data Lead", "company": "Acme", "location": "Toronto, ON", "structured": true,
            "text": "Lead the data platform team and its roadmap, with stakeholders across the bank."});
        let first = s.agent.add_clip(&clip).unwrap();
        let e = s.agent.add_clip(&clip).unwrap_err();
        assert!(e.0.ends_with("is already in Job Hunt."));
        let h = s.agent.db().history(&first.id).unwrap();
        assert!(h.iter().any(|x| x.kind == "added-again"), "noted on that job, so Recent activity links to it");
    }

    #[test]
    fn looks_up_each_company_once() {
        let s = setup();
        s.agent.search(Some(vec![
            Posting { company: "Acme Inc.".into(), ..posting("Technical Program Manager", "1") },
            Posting { company: "Acme".into(), ..posting("Senior Program Manager", "2") },
            Posting { company: "Unknown Co".into(), ..posting("Program Manager", "3") },
        ])).unwrap();
        assert_eq!(s.agent.companies_to_rate().len(), 2, "Acme Inc. and Acme are one employer");
        assert_eq!(s.agent.rate_companies(5), 2);
        assert!(s.agent.companies_to_rate().is_empty(), "kept for 60 days (7 when none was found)");
        let r = s.agent.db().rating("ACME Inc").unwrap();
        assert_eq!((r["rating"].as_f64(), r["reviews"].as_i64(), r["source"].as_str()), (Some(4.1), Some(1234), Some("Glassdoor")));
        assert_eq!(s.agent.db().rating("Unknown Co").unwrap()["found"], false);
        assert_eq!(s.llm.calls.lock().unwrap().iter().filter(|c| c.starts_with("company_rating")).count(), 2);
    }

    #[test]
    fn keeps_the_predicted_fit_after_tailoring() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let j = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!((j.score, j.score_potential), (Some(85), Some(92)));
        assert_eq!(j.brief()["score_potential"], 92);
    }

    #[test]
    fn finds_the_company_posting_once() {
        let s = setup();
        let board = |t: &str, id: &str| Posting { url: format!("https://www.linkedin.com/jobs/view/{id}/"), ..posting(t, id) };
        s.agent.search(Some(vec![board("Technical Program Manager", "1"), board("Senior Program Manager", "2")])).unwrap();
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().apply_url, None, "a job board isn't the company's site");
        assert_eq!(s.agent.find_company_apply("test:1").unwrap().as_deref(), Some("https://careers.example.com/jobs/1"));
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().apply_url.as_deref(), Some("https://careers.example.com/jobs/1"));
        assert_eq!(s.agent.find_company_apply("test:1").unwrap().as_deref(), Some("https://careers.example.com/jobs/1"), "kept, not asked again");
        assert_eq!(s.agent.find_company_apply("test:2").unwrap(), None);
        assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().apply_url, None);
    }

    #[test]
    fn approve_sends_email_applications_or_waits() {
        let s = setup();
        s.agent.search(Some(vec![Posting { apply_email: Some("jobs@acme.example".into()), ..posting("Technical Program Manager", "1") }, posting("Senior Program Manager", "2")])).unwrap();
        assert_eq!(s.agent.approve("test:1").unwrap(), "applied");
        let sent = s.mail.sent.lock().unwrap().clone();
        assert_eq!(sent[0].0, "jobs@acme.example");
        assert_eq!(sent[0].1.len(), 2);
        assert!(s.agent.db().job("test:1").unwrap().unwrap().applied_at.is_some());
        assert_eq!(s.agent.approve("test:2").unwrap(), "approved");
        assert!(s.agent.approve("test:2").is_err(), "only ready jobs");
    }

    #[test]
    fn inbox_updates_tracker_and_labels() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        s.mail.messages.lock().unwrap().insert("m1".into(), email("m1"));
        s.llm.triages.lock().unwrap().push(triage("rejection", Some("test:1")));
        let stats = s.agent.process_inbox(50).unwrap();
        assert_eq!(stats.get("rejection"), Some(&1));
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "rejected");
        // Labelled as a rejection, and (from a person at the company) as a recruiter you know.
        assert_eq!(*s.mail.labels.lock().unwrap(), vec![("m1".to_string(), "Rejected".to_string()), ("m1".to_string(), "Recruiters".to_string())]);
        assert_eq!(crate::recruiters::list(&s.agent)[0].email, "r@acme.example");
        assert!(s.mail.drafts.lock().unwrap().is_empty());
        assert!(s.agent.process_inbox(50).unwrap().is_empty(), "already processed");
    }

    #[test]
    fn inbox_skips_mail_not_about_jobs_and_waits_out_the_limit() {
        let s = setup();
        let mut alert = email("m1");
        (alert.from, alert.subject, alert.body) = ("Power Co <billing@power.example>".into(), "Your electricity bill is ready".into(), "Your bill for this month is ready to view.".into());
        s.mail.messages.lock().unwrap().insert("m1".into(), alert);
        let stats = s.agent.process_inbox(50).unwrap();
        assert_eq!(stats.get("skipped"), Some(&1));
        assert!(!s.llm.calls.lock().unwrap().contains(&"triage".to_string()), "not sent to Claude");
        assert!(s.agent.db().emails(10).unwrap().is_empty(), "not listed in the Inbox");
        // While the usage limit lasts, nothing is read (and nothing reported as an email problem).
        s.agent.usage.lock().unwrap().limited_until = Some(Utc::now().timestamp() + 600);
        s.mail.messages.lock().unwrap().insert("m2".into(), email("m2"));
        assert!(s.agent.process_inbox(50).unwrap().is_empty());
        assert!(!s.agent.db().email_seen("m2").unwrap(), "read after the reset");
        assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Email check")));
    }

    #[test]
    fn confirmed_interview_books_calendar_once() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        s.agent.db().set_status("test:1", "applied", "").unwrap();
        let tz = chrono_tz::America::Toronto;
        let start = tz.with_ymd_and_hms(2026, 10, 21, 14, 0, 0).unwrap(); // a Wednesday
        let slot = TimeSlot { start: start.to_rfc3339(), end: (start + Duration::hours(1)).to_rfc3339() };
        for id in ["m1", "m2"] {
            s.mail.messages.lock().unwrap().insert(id.into(), email(id));
            s.llm.triages.lock().unwrap().push(Triage { confirmed_time: Some(slot.clone()), meeting_link: Some("https://meet.example/x".into()), ..triage("interview_confirmed", Some("test:1")) });
        }
        s.agent.process_inbox(50).unwrap();
        let created = s.cal.created.lock().unwrap().clone();
        let kinds: Vec<&str> = created.iter().map(|e| e.summary.split(':').next().unwrap()).collect();
        assert_eq!(kinds, vec!["Interview", "Prep", "Send thank-you note", "Follow up if no reply"]);
        assert_eq!(created[0].start, start.with_timezone(&Utc));
        assert_eq!(created[0].location.as_deref(), Some("https://meet.example/x"));
        assert_eq!(created[1].end, start.with_timezone(&Utc));
        assert_eq!(created[2].start, tz.with_ymd_and_hms(2026, 10, 22, 9, 0, 0).unwrap().with_timezone(&Utc));
        assert_eq!(created[3].start, tz.with_ymd_and_hms(2026, 10, 28, 9, 0, 0).unwrap().with_timezone(&Utc));
        assert_eq!(created.len(), 4, "the duplicate confirmation added nothing");
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "interviewing");
        assert!(s.notes.lock().unwrap().contains(&"Interview booked".to_string()));
    }

    #[test]
    fn interview_request_drafts_reply_accepting_a_free_slot() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let future = Utc::now() + Duration::days(3);
        let busy_slot = TimeSlot { start: future.to_rfc3339(), end: (future + Duration::hours(1)).to_rfc3339() };
        let free_slot = TimeSlot { start: (future + Duration::days(1)).to_rfc3339(), end: (future + Duration::days(1) + Duration::hours(1)).to_rfc3339() };
        *s.cal.busy.lock().unwrap() = vec![(future, future + Duration::hours(1))];
        s.mail.messages.lock().unwrap().insert("m1".into(), email("m1"));
        s.llm.triages.lock().unwrap().push(Triage { offered_times: vec![busy_slot, free_slot.clone()], ..triage("interview_request", Some("test:1")) });
        s.agent.process_inbox(50).unwrap();
        assert_eq!(*s.llm.accepted.lock().unwrap(), Some(Some(free_slot)));
        assert_eq!(*s.mail.drafts.lock().unwrap(), vec![("m1".to_string(), "Tuesday works, thanks. Jane".to_string())]);
        assert!(s.cal.created.lock().unwrap().is_empty());
    }

    #[test]
    fn cvs_can_be_added_in_any_format_and_removed() {
        let s = setup();
        // A Word CV: used as is, named and set up by Claude.
        let t = s.agent.add_cv("Alex_CV.docx", &cv::sample_docx(), false).unwrap();
        assert_eq!((t.name.as_str(), t.label.as_str(), t.kind.as_str()), ("data-analysis", "Data analysis", "docx"));
        assert_eq!(t.titles, vec!["Senior Data Analyst", "Analytics Manager"]);
        assert_eq!(std::fs::read(s.agent.cv_path("data-analysis")).unwrap(), cv::sample_docx());
        // A PDF: converted to an editable Word copy; the original is kept.
        let pdf = s.agent.add_cv("resume.pdf", b"%PDF-1.7 fake", false).unwrap();
        assert_eq!((pdf.name.as_str(), pdf.kind.as_str()), ("data-analysis-2", "pdf"));
        let doc = cv::open(&s.agent.cv_path(&pdf.name)).unwrap();
        assert!(doc.paras.iter().filter(|p| p.editable).count() >= 3);
        assert!(s.agent.data.join("cv/originals/data-analysis-2.pdf").exists());
        assert!(s.llm.calls.lock().unwrap().contains(&"convert_pdf".to_string()));
        // Plain text works the same way; an old .doc is refused with a clear message.
        let long = "Alex Morgan\nData analyst\n".repeat(20);
        assert_eq!(s.agent.add_cv("cv.txt", long.as_bytes(), false).unwrap().kind, "text");
        assert!(s.agent.add_cv("cv.doc", &[0xD0, 0xCF, 0x11, 0xE0, 0, 0], false).unwrap_err().0.contains(".docx"));
        assert_eq!(s.agent.profile().tracks.len(), 2 + 3);
        // Any track can be removed; searching scores against every remaining CV.
        s.agent.remove_cv("program").unwrap();
        assert!(!s.agent.cv_path("program").exists());
        assert!(s.agent.profile().tracks.iter().all(|t| t.name != "program"));
        assert!(s.agent.remove_cv("program").is_err());
        let conv = s.agent.convert_existing_cv("data-analysis").unwrap();
        assert_eq!(conv.kind, "docx-converted");
    }

    #[test]
    fn first_cv_fills_in_name_and_email() {
        let s = setup();
        let mut p = Profile::default();
        p.name.clear();
        s.agent.save_profile(&p).unwrap();
        s.agent.add_cv("cv.docx", &cv::sample_docx(), false).unwrap();
        let p = s.agent.profile();
        assert_eq!((p.name.as_str(), p.email.as_str()), ("Alex Morgan", "alex@example.com"));
    }

    #[test]
    fn a_saved_api_key_keeps_the_api_engine() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::memory().unwrap();
        db.set("claude.key", "sk-old").unwrap();
        let agent = Agent::new(dir.path(), db, Box::new(|_, _| {}));
        assert_eq!(agent.engine_name(), "api", "a key saved before Claude Code became the default stays in use");
        // Choosing Claude Code explicitly wins over the saved key.
        agent.db().set("claude.engine", "code").unwrap();
        assert_eq!(agent.engine_name(), "code");
        // A new install starts empty, with Claude Code.
        let fresh = Agent::new(dir.path(), Db::memory().unwrap(), Box::new(|_, _| {}));
        let p = fresh.profile();
        assert!(p.locations.is_empty() && p.tracks.is_empty() && p.name.is_empty());
        assert_eq!(fresh.engine_name(), "code");
    }

    #[test]
    fn a_skipped_posting_can_be_scored_anyway() {
        let s = setup();
        let mut p = s.agent.profile();
        p.locations = vec!["Ottawa".into()];
        p.remote_ok = false;
        s.agent.save_profile(&p).unwrap();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "skipped");
        let job = s.agent.score_anyway("test:1").unwrap();
        assert_eq!((job.status.as_str(), job.score), ("ready", Some(85)), "scored, cleared the bar, tailored");
    }

    #[test]
    fn progress_moves_through_the_stages() {
        let s = setup();
        assert!(s.agent.progress().is_none(), "no search, no progress");
        s.agent.step("Scoring postings", 1, 2, "x");
        assert_eq!(s.agent.progress.lock().unwrap().percent, 65);
        s.agent.step("Searching job sites", 0, 4, "y");
        assert_eq!(s.agent.progress.lock().unwrap().percent, 0);
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let o = s.agent.overview().unwrap();
        assert_eq!(o["last_report"]["scored"], 1);
        assert!(o["progress"].is_null());
    }

    #[test]
    fn near_miss_titles_get_a_second_look() {
        let s = setup();
        let r = s.agent.search(Some(vec![
            posting("Transformation Lead, Finance Systems", "1"),
            posting("Registered Nurse", "2"),
        ])).unwrap();
        assert_eq!((r.scored, r.filtered), (1, 1), "{r}");
        assert!(s.llm.calls.lock().unwrap().contains(&"pick_titles".to_string()));
        let nurse = s.agent.db().jobs(Some("skipped"), 10).unwrap();
        assert!(nurse.iter().any(|j| j.title == "Registered Nurse" && j.reasoning.as_deref().unwrap_or("").contains(NO_TITLE_MATCH)));
    }

    #[test]
    fn job_alert_emails_become_postings() {
        let s = setup();
        *s.llm.alerts.lock().unwrap() = vec![crate::claude::FoundJob {
            title: "Technical Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(),
            url: "https://www.linkedin.com/jobs/view/1".into(), ..Default::default()
        }];
        s.mail.messages.lock().unwrap().insert("a1".into(), Email {
            id: "a1".into(), thread_id: "t1".into(), from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>".into(),
            subject: "1 new job for Technical Program Manager".into(), body: "Technical Program Manager · Maple Bank · Toronto".into(), ..Email::default()
        });
        let stats = s.agent.process_inbox(50).unwrap();
        assert_eq!(stats.get("job_alert_postings"), Some(&1));
        let jobs = s.agent.db().jobs(None, 10).unwrap();
        let j = jobs.iter().find(|j| j.company == "Maple Bank").expect("the alert's posting was scored");
        assert_eq!(j.source, "linkedin");
        assert!(s.agent.process_inbox(50).unwrap().get("job_alert_postings").is_none(), "each alert is read once");
    }

    #[test]
    fn decisions_teach_the_scorer_and_interviews_get_prep() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let id = s.agent.db().jobs(None, 1).unwrap()[0].id.clone();
        s.agent.after_stage(&id, "dismissed", "too junior", true);
        let g = s.agent.scoring_guidance(&s.agent.profile());
        assert!(g.contains("Not interested: Technical Program Manager at Acme (too junior)"), "{g}");
        // Stories reach the cover letter writer.
        let mut p = s.agent.profile();
        p.stories = "Shipped urgent medical supplies to Iraq.".into();
        s.agent.save_profile(&p).unwrap();
        s.agent.tailor(&id, None).unwrap();
        assert!(s.llm.stories_seen.lock().unwrap().contains("Iraq"));
        // Interview prep is written and kept.
        assert!(s.agent.make_prep(&id).unwrap().contains("The role in brief"));
        assert!(s.agent.prep(&id).is_some());
    }

    #[test]
    fn force_search_rechecks_filtered_postings() {
        let s = setup();
        let mut p = s.agent.profile();
        p.locations = vec!["Ottawa".into()];
        p.remote_ok = false;
        s.agent.save_profile(&p).unwrap();
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        assert_eq!(r.filtered, 1, "Toronto is filtered out while looking in Ottawa");
        // Widen the search and force: the filtered posting is checked again and scored.
        p.locations = vec!["Toronto".into()];
        s.agent.save_profile(&p).unwrap();
        assert_eq!(s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap().new, 0, "a normal search skips it");
        let r = s.agent.search_with(Some(vec![posting("Technical Program Manager", "1")]), true).unwrap();
        assert_eq!((r.rechecked, r.new, r.scored), (1, 1, 1));
        // Scored or tailored postings are never re-checked.
        assert_eq!(s.agent.search_with(Some(vec![posting("Technical Program Manager", "1")]), true).unwrap().rechecked, 0);
    }

    #[test]
    fn indeed_postings_join_the_search() {
        let s = setup();
        *s.llm.indeed.lock().unwrap() = vec![crate::claude::FoundJob {
            title: "Senior Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(),
            url: "https://to.indeed.com/x".into(), description: "Lead program delivery, UAT, vendor management.".into(),
            posted: "October 13, 2026".into(), salary: "N/A".into(),
        }];
        s.agent.db().set("claude.engine", "code").unwrap();
        let found = s.agent.indeed_postings(&s.agent.profile()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].source.as_str(), found[0].salary.as_deref()), ("indeed", None));
        let searches = s.llm.indeed_searches.lock().unwrap().clone();
        assert!(searches.iter().all(|(_, place)| place == "Toronto, ON" || place == "remote"), "{searches:?}");
        assert!(searches.len() <= 10);

        // Off, or using an API key: no Indeed calls.
        s.agent.db().set("claude.engine", "api").unwrap();
        assert!(s.agent.indeed_postings(&s.agent.profile()).is_err());
        let mut p = s.agent.profile();
        p.sources.indeed = false;
        s.agent.save_profile(&p).unwrap();
        assert!(s.agent.indeed_postings(&p).unwrap().is_empty());
    }

    #[test]
    fn signature_is_stored_and_checked() {
        let s = setup();
        assert!(s.agent.signature().is_none());
        assert!(s.agent.set_signature(b"not a picture").is_err());
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(300u32.to_be_bytes());
        png.extend(80u32.to_be_bytes());
        png.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        s.agent.set_signature(&png).unwrap();
        assert_eq!(s.agent.signature().unwrap(), png);
        s.agent.remove_signature().unwrap();
        assert!(s.agent.signature().is_none());
    }

    #[test]
    fn scoring_is_capped_per_search() {
        let s = setup();
        let mut p = s.agent.profile();
        p.max_scored_per_run = 1;
        s.agent.save_profile(&p).unwrap();
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        assert_eq!((r.scored, r.deferred), (1, 1));
        assert!(r.to_string().contains("1 left for the next search"));
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
        assert_eq!((r.new, r.scored), (1, 1), "the deferred one is scored next time");
    }

    #[test]
    fn closed_postings_are_noted() {
        let s = setup();
        let mut p = s.agent.profile();
        p.sources.greenhouse = vec!["acme".into(), "acme-corp".into()];
        s.agent.save_profile(&p).unwrap();
        let gone = Posting { source: "greenhouse".into(), external_id: "acme-1".into(), ..posting("Technical Program Manager", "a1") };
        let other = Posting { source: "greenhouse".into(), external_id: "acme-corp-2".into(), title: "Senior Program Manager".into(), ..posting("x", "a2") };
        let kept = Posting { source: "greenhouse".into(), external_id: "acme-3".into(), title: "Delivery Manager".into(), ..posting("x", "a3") };
        s.agent.search(Some(vec![gone, other, kept])).unwrap();
        // Acme's board was listed in full and no longer has acme-1; acme-corp's board wasn't listed.
        let ids: HashSet<String> = ["greenhouse:acme-3".to_string()].into();
        let n = s.agent.close_missing(&s.agent.profile(), &["greenhouse:acme-".into()], &ids).unwrap();
        assert_eq!(n, 1);
        let j = s.agent.db().job("greenhouse:acme-1").unwrap().unwrap();
        assert!(j.closed_at.is_some() && j.status == "ready", "a tailored one stays put, marked closed");
        assert!(s.agent.db().job("greenhouse:acme-corp-2").unwrap().unwrap().closed_at.is_none(), "acme-corp is a different board");
        assert!(s.agent.db().job("greenhouse:acme-3").unwrap().unwrap().closed_at.is_none());
        // Waiting to be tailored: skipped instead.
        s.agent.db().update_job("greenhouse:acme-3", &[("status", "queued".into())]).unwrap();
        let queued = s.agent.db().job("greenhouse:acme-3").unwrap().unwrap();
        s.agent.mark_closed(&queued, "test").unwrap();
        assert_eq!(s.agent.db().job("greenhouse:acme-3").unwrap().unwrap().status, "skipped");
    }

    #[test]
    fn cv_and_letter_can_be_revised_and_put_back() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let before = s.agent.db().job("test:1").unwrap().unwrap();
        assert!(s.agent.revise("test:1", "cv", "").is_err(), "needs a request");
        let j = s.agent.revise("test:1", "cv", "shorter bullets").unwrap();
        assert!(s.llm.calls.lock().unwrap().contains(&"revise_cv:shorter bullets".to_string()));
        let text = cv::open(Path::new(j.cv_path.as_ref().unwrap())).unwrap().plain_text();
        assert!(text.contains("Led vendor management of contracted teams and integrators"));
        // Still one change against your own CV, now with the revised wording.
        assert_eq!(j.cv_changes.len(), 1);
        assert!(j.cv_changes[0].before.starts_with("Managed contracted") && j.cv_changes[0].after.contains("teams and integrators"));
        assert!(s.agent.can_undo("test:1", "cv"));
        s.agent.undo_revision("test:1", "cv").unwrap();
        let back = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!(back.cv_changes, before.cv_changes);
        assert!(cv::open(Path::new(back.cv_path.as_ref().unwrap())).unwrap().plain_text().contains("Led vendor management of contracted development teams"));
        assert!(!s.agent.can_undo("test:1", "cv"));

        let j = s.agent.revise("test:1", "letter", "make it shorter").unwrap();
        assert!(j.cover_letter.unwrap().ends_with("Shorter now."));
        s.agent.undo_revision("test:1", "letter").unwrap();
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().cover_letter, before.cover_letter);
        assert_eq!(s.agent.db().history("test:1").unwrap()[0].kind, "revised");
    }

    #[test]
    fn quiet_applications_get_a_follow_up_draft() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), Posting { company: "Beta".into(), ..posting("Delivery Manager", "3") }])).unwrap();
        let ten_days_ago = (Utc::now() - Duration::days(10)).to_rfc3339();
        for id in ["test:1", "test:2", "test:3"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
            s.agent.db().update_job(id, &[("applied_at", ten_days_ago.clone().into())]).unwrap();
        }
        s.agent.db().update_job("test:1", &[("apply_email", "jobs@acme.example".into())]).unwrap();
        // test:2 had only the automatic acknowledgement; test:3 had a real reply.
        s.agent.db().record_email("e1", "t", Some("test:2"), "Acme <no-reply@acme.example>", "Thanks", "application_received", "", None, &now()).unwrap();
        s.agent.db().record_email("e2", "t", Some("test:3"), "Sam <sam@beta.example>", "Quick question", "other_job_related", "", None, &now()).unwrap();
        let due: Vec<String> = s.agent.follow_ups_due().unwrap().into_iter().map(|j| j.id).collect();
        assert_eq!(due, vec!["test:1", "test:2"]);
        assert_eq!(s.agent.overview().unwrap()["follow_ups"].as_array().unwrap().len(), 2);
        // The email check drafts them in Gmail, once.
        s.agent.process_inbox(50).unwrap();
        let drafts = s.mail.drafts.lock().unwrap().clone();
        assert!(drafts.contains(&("to:jobs@acme.example".to_string(), "Hello, I applied on ".to_string() + &drafts[0].1["Hello, I applied on ".len()..])));
        assert!(drafts.iter().any(|(to, _)| to == "to:"), "no address for test:2: the draft has no recipient yet");
        assert!(s.agent.follow_up("test:1").unwrap()["draft"].is_string());
        assert!(s.agent.follow_ups_due().unwrap().is_empty());
        assert!(s.notes.lock().unwrap().contains(&"2 follow-ups ready".to_string()));
        // Off means off.
        let mut p = s.agent.profile();
        p.follow_up_after = 0;
        s.agent.save_profile(&p).unwrap();
        assert!(s.agent.follow_ups_due().unwrap().is_empty());
    }

    #[test]
    fn results_count_replies_and_interviews() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), posting("Delivery Manager", "3")])).unwrap();
        for id in ["test:1", "test:2"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
        }
        s.agent.db().set_status("test:1", "interviewing", "").unwrap();
        s.agent.db().set_status("test:1", "rejected", "").unwrap();
        let r = s.agent.results().unwrap();
        assert_eq!(r["funnel"]["found"], 3);
        assert_eq!((r["funnel"]["sent"].as_u64(), r["funnel"]["replied"].as_u64(), r["funnel"]["interviews"].as_u64()), (Some(2), Some(1), Some(1)));
        assert_eq!(r["by_cv"][0]["name"], "Program delivery");
        assert_eq!(r["by_source"][0]["name"], "test");
        assert_eq!(r["by_fit"][0]["name"], "80–89");
    }

    #[test]
    fn sources_can_be_tested() {
        let s = setup();
        let mut p = s.agent.profile();
        p.sources.greenhouse.clear();
        p.sources.lever.clear();
        p.sources.ashby.clear();
        s.agent.save_profile(&p).unwrap();
        s.agent.db().set("claude.engine", "code").unwrap();
        *s.llm.indeed.lock().unwrap() = vec![crate::claude::FoundJob { title: "Senior Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(), ..Default::default() }];
        let v = s.agent.test_sources().unwrap();
        let r = v["results"].as_array().unwrap();
        let by = |n: &str| r.iter().find(|x| x["name"].as_str().unwrap().starts_with(n)).unwrap().clone();
        assert_eq!(by("Adzuna")["skipped"], true);
        assert_eq!((by("Indeed")["ok"].as_bool(), by("Indeed")["found"].as_u64(), by("Indeed")["matching"].as_u64()), (Some(true), Some(1), Some(1)));
        assert_eq!((by("Job-alert")["found"].as_u64(), by("Job-alert")["ok"].as_bool()), (Some(0), Some(true)), "no alerts this week isn't broken");
        assert!(by("Job-alert")["hint"].as_str().unwrap().contains("job alerts"));
        assert!(v["finished"].is_string());
        assert_eq!(serde_json::from_str::<Value>(&s.agent.secret("sources.test")).unwrap(), v);
    }

    #[test]
    fn deadlines_answers_offers_and_contacts() {
        let s = setup();
        let soon = (Utc::now() + Duration::days(1)).date_naive();
        s.agent.search(Some(vec![
            Posting { description: format!("Lead program delivery, UAT. Apply by {}.", soon.format("%B %-d, %Y")), ..posting("Technical Program Manager", "1") },
            Posting { description: "Lead program delivery, UAT, vendor management; apply by Halloween.".into(), ..posting("Senior Program Manager", "2") },
        ])).unwrap();
        assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().deadline, Some(soon.to_string()), "read from the text");
        assert!(s.agent.db().job("test:2").unwrap().unwrap().deadline.is_none(), "Claude's date is too far off to trust");
        assert_eq!(s.agent.closing_soon(7).unwrap().len(), 1);
        assert_eq!(s.agent.overview().unwrap()["closing_soon"].as_array().unwrap().len(), 1);
        s.agent.remind_deadlines();
        s.agent.remind_deadlines();
        assert_eq!(s.notes.lock().unwrap().iter().filter(|n| n.starts_with("Closes")).count(), 1, "told once");

        // Application questions, with the facts you gave for forms.
        let mut p = s.agent.profile();
        p.application_facts = "Canadian citizen; two weeks' notice".into();
        s.agent.save_profile(&p).unwrap();
        let a = s.agent.answer_questions("test:1", "Why us?\nNotice period?").unwrap();
        assert_eq!(a.as_array().unwrap().len(), 2);
        assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("answers:Canadian citizen")));
        assert_eq!(s.agent.answers("test:1").unwrap(), a);

        // An offer, weighed against your minimum.
        assert!(s.agent.offer_advice("test:1", "").is_err());
        let o = s.agent.offer_advice("test:1", "Base 135,000, 10% bonus, start Nov 3").unwrap();
        assert!(o["advice"].as_str().unwrap().contains("Base 135,000"));

        // Contacts and a message to one.
        s.agent.save_contacts("test:1", &[json!({ "name": "Sam Lee", "role": "Hiring manager" }), json!({ "name": " " })]).unwrap();
        assert_eq!(s.agent.contacts("test:1").len(), 1, "blank rows dropped");
        let m = s.agent.write_outreach("test:1", 0).unwrap();
        assert!(m.contains("Technical Program Manager"));
        assert_eq!(s.agent.contacts("test:1")[0]["message"], json!(m));
    }

    #[test]
    fn health_weekly_summary_and_insights() {
        let s = setup();
        s.agent.db().set("claude.engine", "api").unwrap();
        assert!(s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("No Claude API key")));
        s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), posting("Delivery Manager", "3")])).unwrap();
        s.agent.db().log(None, "inbox:error", "Gmail said 401").unwrap();
        assert!(s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Email check had a problem")));
        // Reconnecting Google (or a check that works) clears it.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        s.agent.db().set("google.at", &now()).unwrap();
        assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Email check had a problem")));
        assert!(s.agent.write_insights().is_err(), "too few applications");
        for id in ["test:1", "test:2", "test:3"] {
            s.agent.db().set_status(id, "applied", "").unwrap();
        }
        assert!(s.agent.write_insights().unwrap()["text"].as_str().unwrap().contains("What's working"));
        assert!(s.agent.results().unwrap()["insights"].is_object());
        let w = s.agent.weekly_summary().unwrap();
        assert!(w.contains("your goal is 10"), "{w}");
        assert!(s.notes.lock().unwrap().contains(&"Your week in Job Hunt".to_string()));
        assert_eq!(s.mail.sent.lock().unwrap().last().map(|x| x.0.clone()), Some("jane@example.com".to_string()), "the review, emailed to you");
        assert!(!due_tasks(&s.agent).contains(&"weekly"), "once a week");
    }

    #[test]
    fn boards_are_added_and_removed_in_one_click() {
        let s = setup();
        s.agent.db().set("last.report", &json!({ "broken_boards": [{ "source": "lever", "name": "koho" }], "source_problems": ["Lever board koho: not found (board name wrong or removed?)"] }).to_string()).unwrap();
        assert!(s.agent.health().iter().any(|h| h["action"] == "removeBroken"));
        assert_eq!(s.agent.remove_boards(&[json!({ "source": "lever", "name": "KOHO" })]).unwrap(), 1);
        assert!(!s.agent.profile().sources.lever.contains(&"koho".to_string()));
        assert!(!s.agent.health().iter().any(|h| h["action"] == "removeBroken"), "no longer flagged");
        let n = s.agent.add_boards(&[json!({ "board": "workday", "slug": "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1" }), json!({ "board": "ashby", "slug": "ramp" })]).unwrap();
        assert_eq!(n, 1, "ramp was there already");
        assert_eq!(s.agent.profile().sources.workday.len(), 1);
        // The search report says what was seen before and why the rest were filtered.
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), Posting { location: "Vancouver, BC".into(), ..posting("Senior Program Manager", "2") }])).unwrap();
        assert_eq!((r.known, r.why_filtered.get("outside your locations").copied()), (1, Some(1)));
    }

    #[test]
    fn a_settings_page_left_open_doesnt_bring_removed_boards_back() {
        let s = setup();
        let page = s.agent.profile(); // the settings page loads, with koho on Lever
        assert!(page.sources.lever.contains(&"koho".to_string()));
        s.agent.remove_boards(&[json!({ "source": "lever", "name": "koho" })]).unwrap();
        s.agent.add_boards(&[json!({ "board": "greenhouse", "slug": "found-by-itself" })]).unwrap();
        // The page saves an unrelated change, with its old board lists, plus one board typed in.
        let mut edited = page.clone();
        edited.weekly_goal = 3;
        edited.sources.ashby.push("typed".into());
        let saved = s.agent.save_settings(edited, Some(page.sources.clone())).unwrap();
        let src = &s.agent.profile().sources;
        assert_eq!(&saved.sources, src);
        assert!(!src.lever.contains(&"koho".to_string()), "removed stays removed");
        assert!(src.greenhouse.contains(&"found-by-itself".to_string()), "found elsewhere stays");
        assert!(src.ashby.contains(&"typed".to_string()) && s.agent.profile().weekly_goal == 3);
        // Deleting one on the page is remembered, so finding employers won't add it back.
        let mut page = s.agent.profile();
        let seen = page.sources.clone();
        page.sources.ashby.retain(|x| x != "typed");
        s.agent.save_settings(page, Some(seen)).unwrap();
        assert!(s.agent.removed_boards().contains("ashby:typed") && s.agent.removed_boards().contains("lever:koho"));
        s.agent.add_boards(&[json!({ "board": "lever", "slug": "koho" })]).unwrap();
        assert!(!s.agent.removed_boards().contains("lever:koho"), "added back by you: wanted again");
    }

    #[test]
    fn dead_boards_go_and_new_places_bring_a_look_for_employers() {
        let s = setup();
        let koho = vec![("lever".to_string(), "koho".to_string())];
        assert!(s.agent.drop_dead_boards(&koho).is_empty(), "one miss could be a blip");
        assert!(s.agent.drop_dead_boards(&[]).is_empty(), "it worked again: forgiven");
        assert!(s.agent.drop_dead_boards(&koho).is_empty());
        assert_eq!(s.agent.drop_dead_boards(&koho).len(), 1, "two in a row: dropped");
        assert!(!s.agent.profile().sources.lever.iter().any(|b| b == "koho"));
        // Changing your locations asks for a look for employers there.
        s.agent.db().set("claude.engine", "api").unwrap();
        s.agent.db().set("claude.key", "sk-test").unwrap();
        s.agent.db().set("last.discover", &now()).unwrap();
        assert!(!due_tasks(&s.agent).contains(&"discover"), "looked just now");
        s.agent.db().set("last.discover", &(Utc::now() - Duration::hours(1)).to_rfc3339()).unwrap();
        s.agent.db().set("discover.due", "1").unwrap();
        assert!(due_tasks(&s.agent).contains(&"discover"));
        let mut p = s.agent.profile();
        p.sources.auto_boards = false;
        s.agent.save_profile(&p).unwrap();
        assert!(!due_tasks(&s.agent).contains(&"discover"), "off means off");
    }

    #[test]
    fn postings_sent_from_the_browser() {
        let s = setup();
        // A page that describes the job in the standard way: used as is.
        let j = s.agent.add_clip(&json!({ "url": "https://boards.greenhouse.io/acme/jobs/1", "title": "Technical Program Manager", "company": "Acme",
            "location": "Toronto, ON", "text": "Lead program delivery, UAT and vendor management across finance systems.", "structured": true })).unwrap();
        assert_eq!((j.source.as_str(), j.status.as_str()), ("browser", "ready"));
        assert!(!s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("read_posting")));
        // A LinkedIn page without that: Claude reads it.
        let j = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "title": "LinkedIn", "text": "Jobs you may like ... Senior Program Manager at Maple Bank ... Lead program delivery across finance systems." })).unwrap();
        assert_eq!((j.source.as_str(), j.company.as_str(), j.title.as_str()), ("linkedin", "Maple Bank", "Senior Program Manager"));
        // Twice is refused; a page with no posting is explained.
        let again = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "text": "Senior Program Manager at Maple Bank. Lead program delivery across finance systems." }));
        assert!(again.unwrap_err().0.contains("already in Job Hunt"));
        assert!(s.agent.add_clip(&json!({ "url": "https://example.com", "text": "A recipe for banana bread with walnuts and a little cinnamon." })).unwrap_err().0.contains("doesn't look like a job posting"));
        assert!(crate::api::parse_clip("JOBHUNT-CLIP:{\"url\":\"x\"}").is_some() && crate::api::parse_clip("hello").is_none());
    }

    #[test]
    fn phone_links_and_spreadsheet() {
        assert_eq!(phone_url("", "jh-abc", "2 applications ready"), "https://ntfy.sh/jh-abc?title=2+applications+ready&tags=briefcase");
        // Nothing personal by default: not the company, nor the role.
        let (t, b) = private_notice("Interview tomorrow at 10:00 AM: Maple Bank");
        assert!(t.contains("interview update") && !t.contains("Maple") && !b.contains("Maple"));
        assert!(phone_url("https://ntfy.mynas.ts.net/", "t", "x").starts_with("https://ntfy.mynas.ts.net/t?"));
        let s = setup();
        s.agent.search(Some(vec![Posting { company: "Acme, \"Inc\"".into(), ..posting("Technical Program Manager", "1") }])).unwrap();
        let csv = s.agent.export_csv().unwrap();
        assert!(csv.starts_with('\u{feff}'));
        let row = csv.lines().nth(1).unwrap();
        assert!(row.starts_with("\"Acme, \"\"Inc\"\"\",\"Technical Program Manager\",\"Ready to approve\",\"85\""), "{row}");
    }

    #[test]
    fn overview_and_running_guard() {
        let s = setup();
        s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
        let o = s.agent.overview().unwrap();
        assert_eq!(o["counts"]["ready"], 1);
        assert_eq!(o["ready"][0]["title"], "Technical Program Manager");
        assert!(o["ready"][0].get("description").is_none());
        assert_eq!(o["weeks"].as_array().unwrap().len(), 8);
        assert_eq!(o["setup"]["cvs_missing"], json!(["Data engineering"]));
        assert_eq!(o["setup"]["engine"], "code");
        let g = s.agent.claim("search").unwrap();
        assert!(s.agent.search(Some(vec![])).unwrap_err().0.contains("already running"));
        drop(g);
        assert!(s.agent.search(Some(vec![])).is_ok());
    }
}
