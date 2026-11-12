//! The work itself: find and score jobs, tailor applications, process the inbox, book interviews.

use crate::claude::{Claude, CvSource, EmailIn, Engine, Llm, TimeSlot, Triage};
use crate::profile::Track;
use crate::cv;
use crate::db::{Db, Job};
use crate::filters::{prefilter, NO_TITLE_MATCH};
use crate::google::{self, Cal, Email, Mail, NewEvent};
use crate::profile::Profile;
use crate::slots::{free_slots, is_free, parse_time, weekday_after};
use crate::sources::Posting;
use crate::util::now;
use crate::util::{short_hash, slug};
use crate::{err, Error, R};
use chrono::{Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

// The engine in parts: each file adds its methods to Agent.
mod search;
mod checks;
mod people;
mod reports;
mod tailoring;
mod mail;

/// Near-miss titles Claude looks at per search; the rest wait for the next one.
const NEAR_MISS_BATCH: usize = 150;
/// At most this many postings held over for the next search (see Agent::hold).
const HELD_MAX: usize = 400;

/// Canada's big pension funds, banks and insurers whose careers sites Job Hunt reads (all on
/// Workday). CPP Investments (behind a bot check) and Scotiabank (SuccessFactors) can't be read.
pub const CANADA_EMPLOYERS: &[(&str, &str)] = &[
    ("Ontario Teachers'", "https://otppb.wd3.myworkdayjobs.com/OntarioTeachers_Careers"),
    ("HOOPP", "https://hoopp.wd10.myworkdayjobs.com/HOOPP"),
    ("OMERS", "https://omers.wd3.myworkdayjobs.com/OMERS_External"),
    ("RBC", "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1"),
    ("TD", "https://td.wd3.myworkdayjobs.com/TD_Bank_Careers"),
    ("CIBC", "https://cibc.wd3.myworkdayjobs.com/search"),
    ("BMO", "https://bmo.wd3.myworkdayjobs.com/External"),
    ("Manulife", "https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs"),
    ("Sun Life", "https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs"),
];
/// Matches waiting this long to be picked are set aside as not interested.
const UNPICKED_DAYS: i64 = 60;
/// Job-alert emails from the big job sites, and Canada's Job Bank. Kept separate from the inbox
/// check, which skips promotions.
pub const ALERTS_QUERY: &str = "newer_than:7d from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com OR jobs-listings@linkedin.com OR alert@indeed.com OR jobalert.indeed.com OR noreply@glassdoor.com OR jobbank.gc.ca OR guichetemplois.gc.ca OR eluta.ca OR workopolis.com OR bayt.com OR naukrigulf.com OR gulftalent.com OR monstergulf.com OR reed.co.uk OR totaljobs.com OR seek.com.au OR stepstone OR ziprecruiter.com OR naukri.com OR randstad.ca OR randstad.com OR adecco.ca OR adecco.com OR hays.ca OR hays.com OR roberthalf.com OR roberthalf.ca OR michaelpage.ca OR michaelpage.com OR altis.com OR lrostaffing.com OR peoplefirsthr.com OR techtalent.ca OR jobs.ca OR aplin.com)";

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
        // Recruiters' own job alerts: their sites are hard to read directly, their emails aren't.
        for (domain, id) in [("randstad.", "randstad"), ("adecco.", "adecco"), ("hays.", "hays"), ("roberthalf.", "roberthalf"), ("michaelpage.", "michaelpage"),
            ("altis.", "altis"), ("lrostaffing.", "lro"), ("peoplefirsthr.", "peoplefirst"), ("techtalent.", "techtalent"), ("jobs.ca", "jobsca"), ("aplin.", "aplin")] {
            if f.contains(domain) {
                return id;
            }
        }
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

/// A problem's message short enough for a notice: whole sentences up to about 200 characters
/// (never cut mid-word), with "…" when there was more.
fn short_problem(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= 200 {
        return text.to_string();
    }
    let mut out = String::new();
    for sentence in text.split_inclusive(". ") {
        if !out.is_empty() && out.chars().count() + sentence.chars().count() > 200 {
            return format!("{}…", out.trim_end().trim_end_matches('.'));
        }
        out.push_str(sentence);
    }
    // One long sentence: cut at a word.
    let cut: String = text.chars().take(200).collect();
    format!("{}…", cut.rsplit_once(' ').map(|x| x.0).unwrap_or(&cut))
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
/// Confirmations of applications you sent yourself: two weeks back, archived or not, and in any
/// tab (some land in Promotions), so a missed check or a quick archive doesn't lose them.
pub const CONFIRM_QUERY: &str = "newer_than:14d -from:me -in:chats subject:(application OR applying OR applied OR \"thank you for your interest\" OR \"thanks for your interest\" OR candidature)";

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

/// What a change of CV (replaced or removed) leaves to redo: see Agent::cv_changed.
#[derive(Serialize, serde::Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct CvChange {
    /// Jobs whose fit was against the old CV: to score again.
    pub unscored: Vec<String>,
    /// Applications waiting for your approval: to tailor again from your CVs as they are now.
    pub retailor: Vec<String>,
    /// Applications with your own file or your edits: kept as they are, with a note.
    pub kept: usize,
}

#[derive(Serialize, Default, Debug, Clone)]
pub struct Report {
    pub found: usize,
    pub new: usize,
    /// New postings left unscored this time (the per-search cap); they're held and scored first next time.
    pub deferred: usize,
    /// Postings held over from the last search and looked at again in this one.
    pub held: usize,
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
    /// Scoring every waiting posting (Score them all now): (scored so far, how many were waiting).
    scoring_all: Mutex<Option<(usize, usize)>>,
    /// The database's change counter at the last sync (u64::MAX: not synced yet).
    pub(crate) sync_mark: std::sync::atomic::AtomicU64,
    /// Whether this computer is the one using Job Hunt (see sync::beat).
    pub(crate) presence: Mutex<crate::sync::Presence>,
    /// The Overview's last look at the sync folder or Google Drive (see sync::overview_view).
    pub(crate) sync_view: Mutex<crate::sync::View>,
    /// What Claude has been used for (Settings → Accounts → Claude usage).
    pub usage: Arc<Mutex<crate::usage::Log>>,
    /// You pressed Stop: the running search ends at its next step, keeping what it has.
    stop: std::sync::atomic::AtomicBool,
    /// The running search is paused: it waits at its next step until resumed (or stopped).
    hold: std::sync::atomic::AtomicBool,
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
    /// Paused by you: waiting at this step until you resume it.
    pub paused: bool,
    /// Alongside the stage: the posting being scored while the sources are still searched.
    #[serde(default)]
    pub also: String,
    /// Scoring the postings that were waiting (Score them all now), not a search.
    #[serde(default)]
    pub scoring: bool,
}

/// The search's stages and the share of the bar each one fills.
// Scoring runs alongside the search (see take_in), so searching is most of the bar.
/// A tailored CV scored this much lower than before, or less, is the scorer's own variation.
const RESCORE_NOISE: i64 = 5;

/// With more matches than this waiting to be picked, a search scores half its usual number.
const BACKLOG: usize = 40;

const STAGES: [(&str, u32, u32); 5] = [
    ("Searching job sites", 0, 70),
    ("Searching Indeed", 70, 80),
    ("Checking near-miss titles", 80, 85),
    ("Scoring postings", 85, 90),
    ("Tailoring applications", 90, 100),
];

/// What a search keeps across the batches its sources send (see Agent::take_in).
#[derive(Default)]
struct SearchRun {
    cap: usize,
    scored: usize,
    /// Claude can't score now (no key, usage limit…): the rest are held.
    halted: bool,
    seen: HashSet<String>,
    all_ids: HashSet<String>,
    near: Vec<Posting>,
    found_here: Vec<Posting>,
    known_before: HashSet<String>,
}

/// What every batch of a search is scored against.
struct SearchCtx<'a> {
    profile: &'a crate::profile::Profile,
    cvs: &'a [(String, String)],
    guidance: &'a str,
    force: bool,
    keep_found: bool,
}

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
            scoring_all: Mutex::new(None),
            stop: std::sync::atomic::AtomicBool::new(false),
            hold: std::sync::atomic::AtomicBool::new(false),
            sync_mark: std::sync::atomic::AtomicU64::new(u64::MAX),
            presence: Mutex::new(crate::sync::Presence::default()),
            sync_view: Mutex::new(crate::sync::View::default()),
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
        if matches!(self.secret("other.for").as_str(), "search" | "all") && !self.secret("other.url").is_empty() && !self.secret("other.model").is_empty() {
            return true;
        }
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
        // Another AI for searching, or for everything (Settings, Accounts).
        let for_what = self.secret("other.for");
        if for_what == "search" || for_what == "all" {
            claude.other = Some(crate::claude::OtherAi { url: self.secret("other.url"), key: self.secret("other.key"), model: self.secret("other.model"), for_what });
        }
        claude.score_batch = self.secret("claude.score_batch").parse().unwrap_or(crate::claude::SCORE_BATCH);
        // Saved choices for tailoring; never chosen means Opus at medium effort.
        if let Some(m) = self.db().get("claude.tailor_model").ok().flatten() {
            claude.tailor_model = m;
        }
        if let Some(e) = self.db().get("claude.tailor_effort").ok().flatten().filter(|e| !e.is_empty()) {
            claude.tailor_effort = e;
        }
        // Never chosen: Sonnet (see claude::SCORE_MODEL); chosen "" means the model for everything else.
        if let Some(m) = self.db().get("claude.score_model").ok().flatten() {
            claude.score_model = m;
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
        let (first, second) = p.search_hours();
        for h in std::iter::once(first).chain(second) {
            times.extend(at(today, h));
            times.extend(at(today + Duration::days(1), h));
        }
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

    /// Stop the running search: it ends at its next step and keeps what it found and scored.
    /// A paused search stops too.
    pub fn stop_search(&self) -> bool {
        let running = self.is_running("search");
        if running {
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            self.hold.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        running
    }

    /// Pause the running search at its next step, keeping everything it has found so far, or
    /// resume it from there. Returns whether a search is running.
    pub fn hold_search(&self, on: bool) -> bool {
        let running = self.is_running("search");
        if running {
            self.hold.store(on, std::sync::atomic::Ordering::SeqCst);
            self.progress.lock().unwrap().paused = on;
        }
        running
    }

    /// Whether the running search is paused (or about to pause at its next step).
    pub fn search_held(&self) -> bool {
        self.is_running("search") && self.hold.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn stopping(&self) -> bool {
        self.stop.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Scheduled searches paused: "off", or until when (RFC 3339); empty when they run.
    pub fn search_paused(&self) -> String {
        let v = self.secret("search.paused");
        if v == "off" {
            return v;
        }
        match chrono::DateTime::parse_from_rfc3339(&v) {
            Ok(t) if t.with_timezone(&Utc) > Utc::now() => v,
            _ => String::new(),
        }
    }

    /// Pause scheduled searches for `days` (0: run them again; None: off until you turn them on).
    pub fn pause_searches(&self, days: Option<i64>) -> R<()> {
        match days {
            None => self.db().set("search.paused", "off"),
            Some(0) => self.db().set("search.paused", ""),
            Some(d) => self.db().set("search.paused", &(Utc::now() + Duration::days(d)).to_rfc3339()),
        }
    }

    /// The running search's progress, or None when no search is running.
    pub fn progress(&self) -> Option<Progress> {
        let mut p = self.is_running("search").then(|| self.progress.lock().unwrap().clone())?;
        // Scoring what's waiting, not searching: say so, with how far through them it is.
        if let Some((done, total)) = *self.scoring_all.lock().unwrap() {
            let now = done + p.scored;
            p.stage = "Scoring waiting postings".into();
            p.done = now.min(total);
            p.total = total;
            p.percent = if total > 0 { (now * 100 / total).min(99) as u32 } else { 0 };
            p.scoring = true;
        }
        Some(p)
    }

    /// What the search is doing alongside its stage (scoring a posting while the sources are still
    /// being searched): shown with the stage.
    fn also(&self, what: &str) {
        self.progress.lock().unwrap().also = what.to_string();
    }

    /// Paused by you: wait here until you resume or stop the search.
    fn wait_while_held(&self) {
        while self.hold.load(std::sync::atomic::Ordering::SeqCst) && !self.stopping() {
            self.progress.lock().unwrap().paused = true;
            std::thread::sleep(std::time::Duration::from_millis(if cfg!(test) { 5 } else { 400 }));
        }
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
        drop(p);
        // Paused: wait here, with everything found so far, until you resume or stop it.
        while self.hold.load(std::sync::atomic::Ordering::SeqCst) && !self.stopping() {
            self.progress.lock().unwrap().paused = true;
            std::thread::sleep(std::time::Duration::from_millis(if cfg!(test) { 5 } else { 400 }));
        }
        self.progress.lock().unwrap().paused = false;
    }

    fn tally(&self, r: &Report) {
        let mut p = self.progress.lock().unwrap();
        (p.found, p.new, p.scored, p.tailored) = (r.found, r.new, r.scored, r.tailored);
    }

    /// Work an update must not cut short: a search, tailoring, or a posting being added.
    pub fn busy_for_update(&self) -> Vec<String> {
        self.running().into_iter().filter(|n| n == "search" || n.starts_with("tailor:") || n == "add").collect()
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

    /// Your files' folder (see util::files_dir): CVs, tailored applications, backups.
    pub fn files(&self) -> PathBuf {
        crate::util::files_dir(&self.data)
    }

    /// Keep your files (CVs, tailored applications, and backups unless you chose a folder for
    /// them) in `dir` from now on: they're moved there and the paths saved with each application
    /// follow. Returns the folder.
    pub fn set_files_folder(&self, dir: &str) -> R<PathBuf> {
        let new = PathBuf::from(dir.trim());
        if !new.is_absolute() {
            return err("Choose a whole folder path, like C:\\Users\\you\\Documents\\Job Hunt.");
        }
        let _g = self.claim("files-move")?;
        let old = self.files();
        if new == old {
            return Ok(new);
        }
        std::fs::create_dir_all(&new).map_err(|e| Error(format!("Couldn't use {}: {e}", new.display())))?;
        let mut subs = vec!["cv", "applications"];
        if self.secret("backup.dir").trim().is_empty() {
            subs.push("backups");
        }
        for sub in subs {
            let from = old.join(sub);
            if from.exists() {
                crate::backup::move_path(&from, &new.join(sub)).map_err(|e| Error(format!("Couldn't move your {sub} folder: {}", e.0)))?;
            }
        }
        std::fs::write(self.data.join(crate::util::FILES_POINTER), new.to_string_lossy().as_bytes())?;
        self.fix_file_paths();
        self.db().log(None, "files", &format!("your files are now in {}", new.display()))?;
        Ok(new)
    }

    /// Point each application's saved CV and letter at their copies in your files' folder: after
    /// your files moved, or on another computer after a restore.
    pub fn fix_file_paths(&self) -> usize {
        let apps = self.files().join("applications");
        // The copy in your files' folder wins: a path into another folder or computer is followed here.
        let here = |p: &str| -> Option<String> {
            let parts: Vec<&str> = p.split(['/', '\\']).collect();
            let at = parts.iter().rposition(|x| *x == "applications")?;
            let moved = parts[at + 1..].iter().fold(apps.clone(), |acc, x| acc.join(x));
            (moved.exists() && moved != Path::new(p)).then(|| moved.to_string_lossy().to_string())
        };
        let mut n = 0;
        // The list first: the database is used again inside the loop.
        let jobs = self.db().file_paths().unwrap_or_default();
        for (id, cv_path, letter_path) in jobs {
            let mut set: Vec<(&str, Value)> = vec![];
            if let Some(p) = cv_path.as_deref().and_then(here) { set.push(("cv_path", p.into())); }
            if let Some(p) = letter_path.as_deref().and_then(here) { set.push(("letter_path", p.into())); }
            if !set.is_empty() && self.db().update_job(&id, &set).is_ok() {
                n += 1;
            }
        }
        n
    }

    pub fn cv_path(&self, track: &str) -> PathBuf {
        self.files().join("cv").join(format!("{track}.docx"))
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
        // What you want (the fields in Me, Looking for), then your own notes.
        let wants = profile.wants.for_scoring();
        let own = [wants.as_str(), profile.guidance.trim()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join("\n\n");
        if list.is_empty() {
            return format!("{own}{results}");
        }
        let lines: Vec<String> = list.iter().rev().take(25).map(|f| {
            let reason = f["reason"].as_str().unwrap_or("");
            format!("- {}: {} at {}{}", f["decision"].as_str().unwrap_or(""), f["title"].as_str().unwrap_or(""), f["company"].as_str().unwrap_or(""),
                if reason.is_empty() { String::new() } else { format!(" ({reason})") })
        }).collect();
        format!("{own}\n\nThe candidate's recent decisions on earlier postings (score similar postings the same way):\n{}{results}", lines.join("\n"))
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

    /// Keep postings a search found but couldn't get to (over the scoring cap, text not read yet,
    /// a near-miss check that failed), so the next search scores them first. Sources take turns
    /// with your titles, so the next search might not find them again by itself.
    fn hold(&self, list: Vec<Posting>) {
        if list.is_empty() {
            return;
        }
        let db = self.db();
        let mut held: Vec<Posting> = db.get("search.held").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        for p in list {
            if !held.iter().any(|h| h.id() == p.id()) {
                held.push(p);
            }
        }
        let keep = held.len().saturating_sub(HELD_MAX); // the newest
        let _ = db.set("search.held", &serde_json::to_string(&held[keep..]).unwrap_or_default());
    }

    fn take_held(&self) -> Vec<Posting> {
        let db = self.db();
        let list: Vec<Posting> = db.get("search.held").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let _ = db.delete("search.held");
        list
    }

    fn take_pending_alerts(&self) -> Vec<Posting> {
        let db = self.db();
        let list: Vec<crate::claude::FoundJob> = db.get("alerts.pending").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let _ = db.delete("alerts.pending");
        list.into_iter().map(alert_posting).collect()
    }

    /// The new postings a LinkedIn job alert links to, read from LinkedIn without Claude. None when
    /// the email has no job links or LinkedIn wouldn't show any of them (Claude reads it instead).
    fn linkedin_alert(&self, body: &str) -> Option<Vec<crate::claude::FoundJob>> {
        let ids = crate::sources::linkedin_ids_in(body);
        if ids.is_empty() {
            return None;
        }
        let c = crate::sources::http();
        let (mut out, mut failed) = (vec![], 0);
        for id in ids.into_iter().take(20) {
            let url = format!("https://www.linkedin.com/jobs/view/{id}/");
            if self.db().url_exists(&url).unwrap_or(false) {
                continue; // seen before: nothing to read
            }
            std::thread::sleep(std::time::Duration::from_millis(1500));
            match crate::sources::linkedin_posting(&c, &id) {
                Ok(p) if !p.title.is_empty() && !p.company.is_empty() => out.push(crate::claude::FoundJob {
                    title: p.title, company: p.company, location: p.location, url, description: p.description,
                    posted: format!("linkedin|{}", p.posted_at.unwrap_or_default()), salary: p.salary.unwrap_or_default(),
                }),
                Ok(_) => failed += 1,
                Err(e) => {
                    failed += 1;
                    if e.contains("limiting") {
                        break;
                    }
                }
            }
        }
        (!out.is_empty() || failed == 0).then_some(out)
    }

    /// Read job-alert emails from LinkedIn, Indeed and Glassdoor, and score the postings in them.
    pub fn process_alerts(&self, mail: &Arc<dyn Mail>, limit: usize) -> R<usize> {
        let mut found: Vec<crate::claude::FoundJob> = vec![];
        for id in mail.recent(ALERTS_QUERY, limit)? {
            if self.db().email_seen(&id)? {
                continue;
            }
            let msg = mail.get(&id)?;
            // LinkedIn's alerts link each job by its number: read them from LinkedIn's public pages,
            // with no Claude request (and with their full text, which the email doesn't have).
            if alert_site(&msg.from) == "linkedin" && !cfg!(test) {
                if let Some(jobs) = self.linkedin_alert(&msg.body) {
                    let n = jobs.len();
                    found.extend(jobs);
                    self.db().record_email(&msg.id, &msg.thread_id, None, &msg.from, &msg.subject, "job_alert", &format!("{n} new postings from a linkedin job alert"), None, &msg.received_at)?;
                    continue;
                }
            }
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
            return err("Add a CV with job titles first (CV & Career).");
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
        if !drop.is_empty()
            && self.remove_boards(&drop).is_ok() {
                for d in &drop {
                    strikes.remove(&key(d["source"].as_str().unwrap_or(""), d["name"].as_str().unwrap_or("")));
                }
                let names: Vec<&str> = drop.iter().filter_map(|d| d["name"].as_str()).collect();
                let _ = self.db().log(None, "discover", &format!("removed boards that no longer exist: {}", names.join(", ")));
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
                "bamboohr" => &mut s.bamboohr,
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
                "bamboohr" => &mut s.bamboohr,
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

    /// Add a company by any of its careers links: Job Hunt works out its job board (see
    /// sources::board_from_link). Returns (kind, name, whether it was new).
    pub fn add_board_link(&self, link: &str) -> R<(String, String, bool)> {
        let (kind, name) = crate::sources::board_from_link(&crate::sources::http(), link).map_err(Error)?;
        let n = self.add_boards(&[json!({ "board": kind, "slug": name })])?;
        self.db().log(None, "sources", &format!("added the {kind} board {name} from {link}"))?;
        Ok((kind.to_string(), name, n > 0))
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

    /// Never show this job's company again: it joins the companies to skip, and its other postings
    /// still waiting to be picked go to Not interested. How many others went.
    pub fn block_company(&self, job_id: &str) -> R<usize> {
        let job = self.db().job(job_id)?;
        let Some(job) = job else { return Ok(0) };
        let name = job.company.trim().to_string();
        if name.is_empty() || name == "Unknown" {
            return Err(Error("This posting doesn't say which company it's from.".into()));
        }
        let mut p = self.profile();
        if !p.exclude_companies.iter().any(|c| c.trim().eq_ignore_ascii_case(&name)) {
            p.exclude_companies.push(name.clone());
            self.save_profile(&p)?;
        }
        let waiting = self.db().jobs(Some("queued"), 5000)?;
        let others: Vec<_> = waiting.into_iter().filter(|j| j.id != job.id && j.company.trim().eq_ignore_ascii_case(&name)).collect();
        for j in &others {
            self.db().set_status(&j.id, "dismissed", &format!("{name} is one of the companies you skip"))?;
        }
        Ok(others.len())
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
                "They're marked Closed in All jobs, so you can skip them.",
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
                drop(db);
                self.keep_revision(job_id, "cv", note, applied.changes.iter().map(|c| (c.before.clone(), c.after.clone())).collect());
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
                self.keep_revision(job_id, "letter", note, paragraph_changes(&letter, &new));
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
        drop(db);
        self.keep_revision(job_id, "cv", "your edit", applied.changes.iter().map(|c| (c.before.clone(), c.after.clone())).collect());
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// What the last change to an application's CV or letter changed, for the page to highlight:
    /// {what ("cv" or "letter"), note (what you asked), at, changes: [{before, after}]}, until you
    /// say you've seen it.
    pub fn last_revision(&self, job_id: &str) -> Option<Value> {
        serde_json::from_str(&self.secret(&format!("revision.last:{job_id}"))).ok()
    }

    fn keep_revision(&self, job_id: &str, what: &str, note: &str, changes: Vec<(String, String)>) {
        let changes: Vec<Value> = changes.into_iter().filter(|(b, a)| b.trim() != a.trim())
            .map(|(b, a)| json!({ "before": b.replace("**", ""), "after": a.replace("**", "") })).collect();
        if changes.is_empty() {
            return;
        }
        let v = json!({ "what": what, "note": note, "at": now(), "changes": changes });
        let _ = self.db().set(&format!("revision.last:{job_id}"), &v.to_string());
    }

    pub fn revision_seen(&self, job_id: &str) -> R<()> {
        self.db().set(&format!("revision.last:{job_id}"), "")
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
            // Your own tailored CV for a role Job Hunt hasn't tailored: it's ready for you to approve.
            if ["queued", "skipped", "dismissed", "saved"].contains(&job.status.as_str()) {
                db.set_status(job_id, "ready", "your own tailored CV attached")?;
            }
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
            // Government hiring is formal: chasing doesn't help. And a recruiter you're already
            // messaging gets their own follow-up (contact_follow_ups_due): one channel, not two.
            if !crate::playbook::kind(&j).reach_out() || self.contacts(&j.id).iter().any(|c| contact_time(c, "sent_at").is_some()) {
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

    pub fn rejection_reply(&self, job_id: &str) -> Option<Value> {
        self.db().get(&format!("decline:{job_id}")).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
    }

    /// A short reply to a rejection, saved as a Gmail draft when Gmail is connected: in the thread of
    /// their email when a person sent it, otherwise a new email to whoever you dealt with there.
    pub fn write_rejection_reply(&self, job_id: &str) -> R<Value> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let emails = self.db().emails(5000)?;
        let said = emails.into_iter().find(|e| e.job_id.as_deref() == Some(job_id) && e.category.as_deref() == Some("rejection"));
        let interviewed = self.db().calendar_ids().unwrap_or_default().iter().any(|e| e.kind == "interview" && e.job_id.as_deref() == Some(job_id));
        let their = said.as_ref().map(|e| format!("{}: {}", e.subject.as_deref().unwrap_or(""), e.summary.as_deref().unwrap_or(""))).unwrap_or_default();
        let mut f = self.llm().rejection_reply(&profile.name, &job, &their, interviewed)?;
        let own = self.own_words(&job, &profile);
        (f.subject, f.body) = (cv::humanize(&f.subject, &own), cv::humanize(&f.body, &own));
        let person = said.as_ref().and_then(|e| e.sender.as_deref()).map(google::address).filter(|a| crate::recruiters::looks_personal(a));
        let mail = self.mail.read().unwrap().clone();
        let (to, draft, in_thread) = match (&mail, &said, &person) {
            (Some(m), Some(e), Some(p)) => {
                let original = m.get(&e.gmail_id)?;
                (p.clone(), Some(m.draft_reply(&original, &f.body)?), true)
            }
            _ => {
                let to = match &person {
                    Some(p) => p.clone(),
                    None => self.follow_up_to(&job)?,
                };
                let draft = match &mail {
                    Some(m) => Some(m.draft(&to, &f.subject, &f.body)?),
                    None => None,
                };
                (to, draft, false)
            }
        };
        // Their email came from an address nobody reads: say so, so it isn't sent into the void.
        let robot = said.is_some() && person.is_none();
        let v = json!({ "at": now(), "to": to, "subject": f.subject, "body": f.body, "draft": draft, "in_thread": in_thread, "robot": robot, "interviewed": interviewed });
        let db = self.db();
        db.set(&format!("decline:{job_id}"), &v.to_string())?;
        db.log(Some(job_id), "decline", if draft.is_some() { "reply to the rejection saved in your Gmail drafts" } else { "reply to the rejection written" })?;
        Ok(v)
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
            .ok_or_else(|| Error("No CV uploaded yet. Add one in CV & Career.".into()))?;
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
            return err("Add your CV first (CV & Career).");
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

    /// The skills the postings you go for ask for and your CV doesn't show, most missed first, from
    /// the roles scored in the last 90 days that came near your fit score. Also the hard requirements
    /// those postings had that you didn't meet.
    pub fn skill_gaps(&self) -> R<Value> {
        let p = self.profile();
        let jobs = self.db().jobs(None, 1_000_000)?;
        let since = (Utc::now() - Duration::days(90)).to_rfc3339();
        let floor = (p.score_threshold - 15).max(40);
        let mut cvs: BTreeMap<String, String> = BTreeMap::new();
        let mut asked: BTreeMap<String, (String, usize, usize, Vec<Value>)> = BTreeMap::new();
        let mut musts: Vec<Value> = vec![];
        let mut n = 0;
        for j in jobs.iter().filter(|j| j.found_at >= since && j.score.is_some_and(|x| x >= floor) && !j.keywords.is_empty()) {
            n += 1;
            let track = j.track.clone().unwrap_or_default();
            if !cvs.contains_key(&track) {
                let text = p.track(j.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()).map(|d| d.plain_text().to_lowercase()).unwrap_or_default();
                cvs.insert(track.clone(), text);
            }
            let cv_text = &cvs[&track];
            let gaps: HashSet<String> = j.keyword_gaps.iter().map(|g| g.trim().to_lowercase()).collect();
            let tailored = j.coverage_after.is_some();
            let mut seen = HashSet::new();
            for k in &j.keywords {
                let key = k.trim().to_lowercase();
                if key.is_empty() || !seen.insert(key.clone()) {
                    continue;
                }
                let missing = gaps.contains(&key) || (!tailored && !cv_text.is_empty() && !cv_text.contains(&key));
                let e = asked.entry(key).or_insert_with(|| (k.trim().to_string(), 0, 0, vec![]));
                e.1 += 1;
                if missing {
                    e.2 += 1;
                    if e.3.len() < 3 {
                        e.3.push(json!({ "id": j.id, "company": j.company, "title": j.title }));
                    }
                }
            }
            for f in j.red_flags.iter().filter_map(|f| f.strip_prefix("Must have:")) {
                if musts.len() < 12 {
                    musts.push(json!({ "text": f.trim(), "id": j.id, "company": j.company, "title": j.title }));
                }
            }
        }
        let min = if n >= 10 { 2 } else { 1 };
        let mut skills: Vec<_> = asked.into_values().filter(|e| e.2 >= min).collect();
        skills.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0)));
        let skills: Vec<Value> = skills.into_iter().take(20).map(|(skill, asked, missing, jobs)| json!({
            "skill": skill, "asked": asked, "missing": missing, "share": if n > 0 { (missing * 100 / n) as i64 } else { 0 }, "jobs": jobs,
        })).collect();
        Ok(json!({ "postings": n, "skills": skills, "must_haves": musts }))
    }

    /// The career coach: how to close the gaps that cost you most, and titles to try. Kept with its
    /// date; the titles also show on the Overview until you add or dismiss them.
    pub fn write_coach(&self) -> R<Value> {
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("Add your CV first (CV & Career).");
        }
        let gaps = self.skill_gaps()?;
        let cv_text: String = cvs.iter().map(|(name, text)| {
            let label = profile.tracks.iter().find(|t| &t.name == name).map(|t| t.label.as_str()).unwrap_or(name);
            format!("<cv label=\"{label}\">\n{text}\n</cv>")
        }).collect::<Vec<_>>().join("\n\n");
        let titles: Vec<String> = profile.tracks.iter().flat_map(|t| t.titles.iter().cloned()).collect();
        let r = self.results()?;
        let skills: Vec<String> = gaps["skills"].as_array().into_iter().flatten()
            .map(|g| format!("- {}: asked for in {} postings, not shown in your CV in {}", g["skill"].as_str().unwrap_or(""), g["asked"], g["missing"])).collect();
        let musts: Vec<String> = gaps["must_haves"].as_array().into_iter().flatten().map(|m| format!("- {}", m["text"].as_str().unwrap_or(""))).collect();
        let evidence = format!("Postings looked at (near or above their fit score, last 90 days): {}\nTitles searched: {}\nSkills asked for that the CV doesn't show:\n{}\nHard requirements they missed:\n{}\nResults by kind of role: {}",
            gaps["postings"], titles.join(", "), if skills.is_empty() { "none yet".into() } else { skills.join("\n") },
            if musts.is_empty() { "none".into() } else { musts.join("\n") }, r["by_title"]);
        let plan = self.llm().coach(&profile.name, &cv_text, &evidence)?;
        // Titles you search already, or one of your CVs can't be told, are left out.
        let ideas: Vec<Value> = plan.titles.iter().filter(|t| !titles.iter().any(|x| x.eq_ignore_ascii_case(t.title.trim())) && !t.title.trim().is_empty()).map(|t| {
            let track = profile.tracks.iter().find(|x| x.label.eq_ignore_ascii_case(t.cv.trim()) || x.name == t.cv).or(profile.tracks.first());
            json!({ "title": t.title.trim(), "track": track.map(|x| x.name.clone()), "cv": track.map(|x| x.label.clone()), "why": t.why })
        }).collect();
        let v = json!({ "at": now(), "advice": plan.advice, "skills": plan.skills, "titles": ideas });
        let db = self.db();
        db.set("coach", &v.to_string())?;
        db.set("title.ideas", &json!(ideas).to_string())?;
        db.log(None, "coach", "Claude looked at the skills you're missing")?;
        Ok(v)
    }

    /// Titles the coach suggested that you haven't added or dismissed.
    pub fn title_ideas(&self) -> Vec<Value> {
        serde_json::from_str(&self.secret("title.ideas")).unwrap_or_default()
    }

    /// Done with a suggested title: added to its CV's searches, or dismissed.
    pub fn title_idea_done(&self, title: &str, add: bool) -> R<()> {
        let mut ideas = self.title_ideas();
        if add {
            let track = ideas.iter().find(|i| i["title"] == title).and_then(|i| i["track"].as_str().map(String::from))
                .or_else(|| self.profile().tracks.first().map(|t| t.name.clone()))
                .ok_or_else(|| Error("Add your CV first.".into()))?;
            self.add_titles(&track, &[title.to_string()])?;
        }
        ideas.retain(|i| i["title"] != title);
        self.db().set("title.ideas", &json!(ideas).to_string())
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
                // The company's own posting often states the pay the job board's copy left out.
                if let Ok(p) = crate::sites::read_posting_link(&crate::sources::http(), u) {
                    if let Some(text) = p.salary {
                        let _ = self.found_salary(job_id, &text, "on the company's own posting");
                    }
                }
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

    /// Tailored and approved postings on a job board (LinkedIn, Indeed…) whose own posting on the
    /// company's site hasn't been looked for in the last week: newest first.
    pub fn without_apply_link(&self) -> Vec<Job> {
        let week_ago = (Utc::now() - Duration::days(7)).to_rfc3339();
        let mut jobs: Vec<Job> = ["ready", "approved"].iter().flat_map(|s| self.db().jobs(Some(s), 500).unwrap_or_default()).collect();
        jobs.retain(|j| j.apply_url.is_none() && j.apply_email.is_none() && !j.url.trim().is_empty() && crate::sources::is_job_board(&j.url)
            && self.secret(&format!("applylink.tried:{}", j.id)) < week_ago);
        jobs.sort_by(|a, b| b.found_at.cmp(&a.found_at));
        jobs
    }

    /// Look for a few of them on the companies' own sites, so Apply goes straight to the company.
    /// Returns how many were found.
    pub fn find_apply_links(&self, max: usize) -> usize {
        let mut found = 0;
        for job in self.without_apply_link().into_iter().take(max) {
            if self.limited().is_some() {
                break;
            }
            let _ = self.db().set(&format!("applylink.tried:{}", job.id), &now());
            match self.find_company_apply(&job.id) {
                Ok(Some(_)) => found += 1,
                Ok(None) => {}
                Err(e) => {
                    let _ = self.db().log(Some(&job.id), "apply-link:error", &e.0);
                    break;
                }
            }
        }
        found
    }

    /// Fit reasons from before they were kept short: still-open postings whose reason runs long.
    pub fn long_reasons(&self) -> Vec<Job> {
        self.db().jobs(None, 5000).unwrap_or_default().into_iter()
            .filter(|j| j.reasoning.as_deref().unwrap_or("").chars().count() > 160 && !["dismissed", "rejected", "no_response"].contains(&j.status.as_str()))
            .collect()
    }

    /// Make a few of them one line, in one request. Returns how many.
    pub fn shorten_old_reasons(&self, max: usize) -> usize {
        let jobs: Vec<Job> = self.long_reasons().into_iter().take(max).collect();
        if jobs.is_empty() || self.limited().is_some() {
            return 0;
        }
        let reasons: Vec<String> = jobs.iter().map(|j| j.reasoning.clone().unwrap_or_default()).collect();
        match self.llm().shorten_reasons(&reasons) {
            Ok(lines) => {
                for (j, line) in jobs.iter().zip(lines) {
                    if !line.is_empty() {
                        let _ = self.db().update_job(&j.id, &[("reasoning", line.into())]);
                    }
                }
                jobs.len()
            }
            Err(e) => {
                let _ = self.db().log(None, "reasons:error", &e.0);
                0
            }
        }
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
        // Below your minimum: its roles waiting to be picked or approved are set aside.
        if let (Some(min), Some(got), true) = (self.profile().min_rating, r.rating, r.found) {
            if got < min {
                let key = crate::db::company_key(company);
                let waiting: Vec<Job> = self.db().jobs(None, 5000)?.into_iter()
                    .filter(|j| ["queued", "ready"].contains(&j.status.as_str()) && crate::db::company_key(&j.company) == key).collect();
                for j in waiting {
                    self.db().set_status(&j.id, "skipped", &format!("{company} is rated {got:.1} by employees, below your minimum of {min:.1}"))?;
                }
            }
        }
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
    /// Canada's Job Bank is free and has most Canadian postings: turned on once for searches in
    /// Canada (you can turn it off again; it isn't turned back on).
    pub fn jobbank_on_once(&self) {
        if !self.secret("jobbank.defaulted").is_empty() {
            return;
        }
        let mut p = self.profile();
        if p.sources.adzuna_country != "ca" {
            return;
        }
        if !p.sources.jobbank {
            p.sources.jobbank = true;
            let _ = self.save_profile(&p);
            let _ = self.db().log(None, "sources", "Job Bank turned on: free, with most Canadian postings");
        }
        let _ = self.db().set("jobbank.defaulted", "1");
    }

    /// In Canada, the careers sites of the big pension funds, banks and insurers, added once: the
    /// steadiest employers, posting first on their own sites. Ones you remove stay removed.
    pub fn canada_employers_once(&self) {
        if !self.secret("employers.ca.defaulted").is_empty() || self.profile().sources.adzuna_country != "ca" {
            return;
        }
        let list: Vec<Value> = CANADA_EMPLOYERS.iter().map(|(_, link)| json!({ "board": "workday", "slug": link })).collect();
        if let Ok(n) = self.add_boards(&list) {
            if n > 0 {
                let names: Vec<&str> = CANADA_EMPLOYERS.iter().map(|(n, _)| *n).collect();
                let _ = self.db().log(None, "sources", &format!("added the careers sites of {}", names.join(", ")));
            }
        }
        let _ = self.db().set("employers.ca.defaulted", "1");
    }

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
            // The letter from "Dear…" on (the date, ATTN and Subject lines are for paper; the email
            // has its own subject), formatted as an email: bullets and bold (see google::email_parts).
            let body = email_letter(job.cover_letter.as_deref().unwrap_or(""));
            let id = mail.send(to, &subject, &body, &files)?;
            self.db().set_status(job_id, "applied", &format!("emailed to {to} (message {id})"))?;
            return Ok("applied");
        }
        self.db().set_status(job_id, "approved", "approved; submit on the company site")?;
        Ok("approved")
    }

}

/// The connections you can turn off one by one in Connections.
pub const SWITCHABLE: [&str; 10] = ["jsearch", "jooble", "adzuna", "indeed", "linkedin", "jobbank", "freehire", "agencies", "boards", "alerts"];

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
    agent.jobbank_on_once();
    crate::logos::name_hosts_once(agent);
    agent.canada_employers_once();
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
    // Paused or off: only a search you ask for runs.
    let last = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.search")).ok().map(|t| t.with_timezone(&tz).naive_local());
    let scheduled = agent.search_paused().is_empty() && p.search_due(local.naive_local(), last);
    if ready && (requested || scheduled) && !agent.is_running("search") {
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
    // Postings the last search couldn't score: a batch every 45 minutes while Claude has room.
    let held_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.held"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 45)
        .unwrap_or(false);
    if ready && !held_lately && !agent.budget_wait() && !agent.is_running("search") && !out.contains(&"search") && agent.held_count() > 0 {
        out.push("held");
    }
    // Fit forecasts for postings scored before they existed: a few every 15 minutes.
    let forecast_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.forecast"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 15)
        .unwrap_or(false);
    if ready && !forecast_lately && !agent.budget_wait() && !agent.is_running("forecast") && !agent.is_running("search") && !agent.without_forecast().is_empty() {
        out.push("forecast");
    }
    // Long fit reasons from before they were kept short: ten at a time, every 15 minutes, until done.
    let reasons_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.reasons"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 15)
        .unwrap_or(false);
    if ready && !reasons_lately && !agent.budget_wait() && !agent.is_running("reasons") && !agent.is_running("search") && !agent.long_reasons().is_empty() {
        out.push("reasons");
    }
    // Postings without a salary: looked for once a week (and once right after this version arrives).
    let salaries_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.salaries"))
        .map(|t| (now - t.with_timezone(&Utc)).num_days() < 7)
        .unwrap_or(false);
    if ready && !salaries_lately && !agent.budget_wait() && !agent.is_running("salaries") && !agent.is_running("search") {
        out.push("salaries");
    }
    // Job board postings you've tailored: found on the company's own site, a few every 10 minutes.
    let links_lately = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.applylinks"))
        .map(|t| (now - t.with_timezone(&Utc)).num_minutes() < 10)
        .unwrap_or(false);
    if ready && agent.engine_name() == "code" && !links_lately && !agent.budget_wait() && !agent.is_running("applylinks") && !agent.is_running("search") && !agent.without_apply_link().is_empty() {
        out.push("applylinks");
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
    // Leads from the web (companies that raised money, people saying they're hiring): once a day,
    // when you've turned that on.
    if ready && !agent.budget_wait() && !out.contains(&"search") && crate::leads::due(agent) {
        out.push("leads");
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
            "leads" => crate::leads::find_in_background(agent),
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
            "held" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    if let Err(e) = a.score_held() {
                        let _ = a.db().log(None, "held:error", &e.0);
                    }
                    let _ = a.db().set("last.held", &now());
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
            "reasons" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("reasons") else { return };
                    a.shorten_old_reasons(10);
                    let _ = a.db().set("last.reasons", &now());
                });
            }
            "salaries" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    if let Err(e) = a.rescan_salaries() {
                        if !e.0.contains("already running") {
                            let _ = a.db().log(None, "salaries:error", &e.0);
                        }
                    }
                });
            }
            "applylinks" => {
                let a = agent.clone();
                std::thread::spawn(move || {
                    let Ok(_g) = a.claim("applylinks") else { return };
                    a.find_apply_links(4);
                    let _ = a.db().set("last.applylinks", &now());
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
                    // The career coach, weekly: the gaps that cost you most and new titles to try.
                    if a.claude_ready() && !a.budget_wait() {
                        if let Ok(_c) = a.claim("coach") {
                            if let Err(e) = a.write_coach() {
                                let _ = a.db().log(None, "coach:error", &e.0);
                            }
                        }
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

/// Pay as a posting states it, tidied, with its yearly maximum when it's yearly: "$95K–$110K a
/// year" -> ("$95,000–$110,000", Some(110000)). Empty text: None.
pub fn salary_parts(stated: &str) -> Option<(String, Option<f64>)> {
    let t = stated.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(found) = crate::sources::salary_from_text(t) {
        return Some(found);
    }
    let shown: String = t.chars().take(80).collect();
    Some((shown, crate::sources::salary_max_of(t)))
}

/// Why a yearly maximum is below your minimum, as a red flag, or None.
fn below_minimum(profile: &crate::profile::Profile, max: Option<f64>) -> Option<String> {
    let (min, max) = (profile.min_salary?, max?);
    (max < min).then(|| format!("Pays up to ${}, below your minimum of ${}", fmt_money(max), fmt_money(min)))
}

fn fmt_money(x: f64) -> String {
    let n = x.round() as i64;
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// The paragraphs of a text that changed between two versions, as (before, after) pairs: the same
/// paragraphs line up (a longest common run), and what's left between them pairs in order; a
/// paragraph only added or only removed pairs with an empty one.
pub fn paragraph_changes(old: &str, new: &str) -> Vec<(String, String)> {
    let split = |t: &str| t.split('\n').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect::<Vec<_>>();
    let (a, b) = (split(old), split(new));
    let (n, m) = (a.len(), b.len());
    let mut l = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            l[i][j] = if a[i] == b[j] { l[i + 1][j + 1] + 1 } else { l[i + 1][j].max(l[i][j + 1]) };
        }
    }
    let (mut i, mut j, mut out) = (0, 0, vec![]);
    let (mut gone, mut came): (Vec<String>, Vec<String>) = (vec![], vec![]);
    let flush = |gone: &mut Vec<String>, came: &mut Vec<String>, out: &mut Vec<(String, String)>| {
        let k = gone.len().max(came.len());
        for x in 0..k {
            out.push((gone.get(x).cloned().unwrap_or_default(), came.get(x).cloned().unwrap_or_default()));
        }
        gone.clear();
        came.clear();
    };
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            flush(&mut gone, &mut came, &mut out);
            i += 1;
            j += 1;
        } else if j < m && (i == n || l[i][j + 1] >= l[i + 1][j]) {
            came.push(b[j].clone());
            j += 1;
        } else {
            gone.push(a[i].clone());
            i += 1;
        }
    }
    flush(&mut gone, &mut came, &mut out);
    out
}

/// A cover letter as an email body: from the greeting on, without the printed letter's header
/// (date, ATTN, company) and Subject line.
pub fn email_letter(letter: &str) -> String {
    let blocks: Vec<&str> = letter.split("\n\n").collect();
    match blocks.iter().position(|b| b.trim_start().starts_with("Dear ") || b.trim_start().starts_with("Hello") || b.trim_start().starts_with("Hi ")) {
        Some(i) => blocks[i..].join("\n\n").trim().to_string(),
        None => letter.trim().to_string(),
    }
}

/// Stages where a CV went to the company.
const SENT: &[&str] = &["applied", "interviewing", "offer", "rejected", "no_response"];
/// At most this many paragraphs change for a company that has your CV already (see tailor).
const MAX_REPEAT_EDITS: usize = 4;

/// The headline area: the reworded lines under your name, before the first section.
fn headline_indices(doc: &cv::Doc) -> Vec<usize> {
    doc.paras.iter().take(8).filter(|p| p.editable && !p.bullet).map(|p| p.index).take(2).collect()
}

/// When a contact was sent a message ("sent_at") or the follow-up ("followed_at"), if they were.
fn contact_time(c: &Value, key: &str) -> Option<chrono::DateTime<Utc>> {
    c[key].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc))
}

/// Matches first, best first; then the rest, and what was filtered out last.
fn sort_outcomes(list: &mut [Value]) {
    let rank = |v: &Value| match v["outcome"].as_str().unwrap_or("") { "match" => 0, "new" => 1, "low" => 2, "waiting" => 3, "known" => 4, _ => 5 };
    list.sort_by(|a, b| rank(a).cmp(&rank(b)).then(b["score"].as_i64().unwrap_or(-1).cmp(&a["score"].as_i64().unwrap_or(-1))));
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
            "score-held" => agent.score_all_held().map(|n| {
                let left = agent.held_count();
                agent.note(&format!("Scored {n} waiting postings"), &if left > 0 { format!("{left} still wait (Claude's usage limit, or you stopped it); they're scored in batches as Claude has room.") } else { "All of them: the good fits are on your Overview, under Pick.".into() });
                format!("{n} scored")
            }),
            other => Err(Error(format!("unknown task {other}"))),
        };
        if let Err(e) = result {
            if !e.0.contains("already running") {
                let _ = agent.db().log(None, &format!("{task}:error"), &e.0);
                let what = if task.starts_with("search") { "Job search" } else if task == "score-held" { "Scoring" } else { "Email check" };
                agent.note(&format!("{what} didn't finish"), &e.0);
            }
        }
    });
    true
}

impl Agent {
    // --- dashboard ----------------------------------------------------------------------------------

    pub fn overview(&self) -> R<Value> {
        self.overview_with(crate::sync::newer_value(self), crate::sync::presence_status(self))
    }

    /// The Overview, with what the sync folder or Google Drive says given (the app passes its last
    /// look, so the page doesn't wait on the network; see sync::overview_view).
    pub fn overview_with(&self, newer: Value, in_use: Value) -> R<Value> {
        let profile = self.profile();
        // Leads you haven't written to yet: the number on the Queue's Leads tab. (Counted here,
        // before the database is held for the rest.)
        let leads_open = crate::leads::open_count(self);
        let follow_ups: Vec<Value> = self.follow_ups_due().unwrap_or_default().iter().map(|j| j.brief()).collect();
        // Companies you've applied to: for "Applied here before" on the roles in your lists.
        let mut sent_to: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for s in SENT {
            for j in self.db().jobs(Some(s), 5000).unwrap_or_default() {
                sent_to.entry(crate::db::company_key(&j.company)).or_default().push(json!({ "id": j.id, "title": j.title, "status": j.status, "applied_at": j.applied_at }));
            }
        }
        // Approved roles whose form Job Hunt filled in, still not marked applied: did they go through?
        // (Before 2.26.1, the Apply window's I submitted it could fail without a word.)
        // (The list is read first: the history of each takes the database again.)
        let approved_now = self.db().jobs(Some("approved"), 500).unwrap_or_default();
        let filled_unconfirmed: Vec<Value> = approved_now.into_iter()
            .filter(|j| self.db().history(&j.id).unwrap_or_default().iter().any(|e| e.kind == "fill" && e.detail.contains("filled in on the application form")))
            .map(|j| j.brief()).collect();
        // The playbook's nudges: message the recruiter now, or follow up once (read before taking the database).
        let reach_out: Vec<Value> = self.reach_out_due().unwrap_or_default().iter().map(|j| j.brief()).collect();
        let contact_follow_ups = self.contact_follow_ups_due().unwrap_or_default();
        let closing: Vec<Value> = self.closing_soon(7).unwrap_or_default().iter().map(|j| j.brief()).collect();
        let health = self.health();
        let (claude_ready, engine) = (self.claude_ready(), self.engine_name());
        let tz = profile.tz();
        let today = Utc::now().with_timezone(&tz).date_naive();
        // Recruiters you know (read before taking the database below: it needs it too).
        let recruiters = crate::recruiters::list(self);
        let network = crate::network::list(self);
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
            let before: Vec<Value> = sent_to.get(&crate::db::company_key(&j.company)).map(|l| l.iter().filter(|x| x["id"] != j.id.as_str()).cloned().collect()).unwrap_or_default();
            if !before.is_empty() {
                b["applied_before"] = json!(before);
            }
            let know: Vec<Value> = crate::network::at_company(&network, &j.company).iter().map(|p| p["name"].clone()).collect();
            if !know.is_empty() {
                b["know"] = json!(know);
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
        // All of them (the page shows the best first, and says how many): eight and thirty used to be
        // the most, so the Queue's counts fell short of the Pipeline's and its order missed most of them.
        let ready: Vec<Value> = db.jobs(Some("ready"), 300)?.iter().map(with_warnings).collect();
        let to_tailor: Vec<Value> = db.jobs(Some("queued"), 500)?.iter().map(with_warnings).collect();
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
            "leads": leads_open,
            "recruiter_asks": asks,
            "track_labels": profile.tracks.iter().map(|t| (t.name.clone(), t.label.clone())).collect::<BTreeMap<_, _>>(),
            "quiet": quiet,
            "auto_tailor": profile.auto_tailor,
            "min_salary": profile.min_salary,
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
            "reach_out": reach_out,
            "filled_unconfirmed": filled_unconfirmed,
            "contact_follow_ups": contact_follow_ups,
            "closing_soon": closing,
            "health": health,
            "weekly_goal": profile.weekly_goal,
            "places": profile.locations,
            "remote_ok": profile.remote_ok,
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
    for (prefix, id) in [("Adzuna", "adzuna"), ("Google for Jobs", "jsearch"), ("Jooble", "jooble"), ("Indeed", "indeed"), ("LinkedIn", "linkedin"), ("Job Bank", "jobbank"), ("FreeHire", "freehire"), ("Job-alert", "alerts")] {
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
fn board_lists(s: &mut crate::profile::Sources) -> [(&'static str, &mut Vec<String>); 7] {
    [
        ("greenhouse", &mut s.greenhouse),
        ("lever", &mut s.lever),
        ("ashby", &mut s.ashby),
        ("workday", &mut s.workday),
        ("smartrecruiters", &mut s.smartrecruiters),
        ("workable", &mut s.workable),
        ("bamboohr", &mut s.bamboohr),
    ]
}

#[cfg(test)]
mod tests;
