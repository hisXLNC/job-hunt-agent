//! Filling in a company's application form for you: the desktop app opens the form in its own
//! window with `script` in it, the script sends the form's fields here, and `answers` gives back
//! what to put in each one, with your CV and cover letter to attach. You press Submit yourself.

use crate::cv;
use crate::pipeline::Agent;
use crate::util::now;
use crate::{Error, R};
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The address the script "opens" to reach the app; the app cancels it and handles the message.
pub const MESSAGE_HOST: &str = "jobhunt.invalid";

/// The script for the Apply window: `token` proves a message came from it, not from the page.
pub fn script(token: &str, title: &str, company: &str) -> String {
    script_with(token, &json!({ "title": title, "company": company }))
}

/// The script, with what the panel shows about the job: {title, company, queue ("2 of 5"), auto}.
pub fn script_with(token: &str, job: &Value) -> String {
    include_str!("fill.js")
        .replacen("__TOKEN__", token, 1)
        .replacen("__JOB__", &job.to_string(), 1)
}

/// The script as the browser extension runs it: no token (the extension's messages go through its
/// own channel) and the job filled in when Job Hunt answers.
pub fn extension_script() -> String {
    include_str!("fill.js").replacen("'__TOKEN__'", "''", 1).replacen("__JOB__", "(window.__jobhuntExt || { title: '', company: '' })", 1)
}

// --- how much work an application is ---------------------------------------------------------

/// Application systems whose forms are short and need no account.
const QUICK_FORMS: &[&str] = &["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com", "bamboohr.com",
    "recruitee.com", "teamtailor.com", "breezy.hr", "jazzhr.com", "applytojob.com", "jobvite.com", "pinpointhq.com", "rippling.com", "dover.com"];
/// The ones Job Hunt may submit for you (see auto_submit): plain forms it reads reliably.
const AUTO_FORMS: &[&str] = &["greenhouse.io", "lever.co", "ashbyhq.com"];
/// Systems that make you create an account first.
const ACCOUNT_FORMS: &[(&str, &str)] = &[("myworkdayjobs.com", "Workday"), ("myworkdaysite.com", "Workday"), ("icims.com", "iCIMS"), ("taleo.net", "Taleo"),
    ("successfactors.com", "SuccessFactors"), ("oraclecloud.com", "Oracle"), ("brassring.com", "BrassRing"), ("ultipro.com", "UKG"),
    ("dayforcehcm.com", "Dayforce"), ("adp.com", "ADP"), ("gojobs.gov.on.ca", "Ontario Public Service"), ("emploisfp-psjobs.cfp-psc.gc.ca", "GC Jobs")];

fn host_of(url: &str) -> String {
    url::Url::parse(url.trim()).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default()
}

/// How you apply to a job, and roughly how long it takes: {kind, label, minutes}. kind: "email"
/// (Approve sends it), "quick" (a short form), "account" (sign in or make an account first),
/// "board" (only on a job board so far; the company's own site is looked for) or "site" (a company
/// site Job Hunt doesn't know).
pub fn effort(job: &crate::db::Job) -> Value {
    if job.apply_email.as_deref().is_some_and(|e| !e.is_empty()) {
        return json!({ "kind": "email", "label": "Email · 1 click", "about": "Approve sends your CV and letter by email from your Gmail.", "minutes": 1 });
    }
    let link = job.apply_url.as_deref().filter(|u| !u.is_empty()).unwrap_or(&job.url);
    let host = host_of(link);
    if let Some((_, name)) = ACCOUNT_FORMS.iter().find(|(h, _)| host.ends_with(h)) {
        return json!({ "kind": "account", "label": format!("{name} · ~15 min"), "about": format!("{name} makes you sign in or create an account first: easiest in your own browser, with the Job Hunt extension."), "minutes": 15 });
    }
    if QUICK_FORMS.iter().any(|h| host.ends_with(h)) {
        return json!({ "kind": "quick", "label": "Quick form · ~3 min", "about": "A short form with no account: Job Hunt fills it in.", "minutes": 3 });
    }
    // Still only on a job board: the company's own site is preferred, and looked for.
    if job.apply_url.as_deref().is_none_or(|u| u.is_empty()) && crate::sources::is_job_board(&job.url) {
        return json!({ "kind": "board", "label": "Job board", "about": "Only on a job board so far. Job Hunt looks for it on the company's own site, and applies there when it finds it.", "minutes": 10 });
    }
    if host.is_empty() {
        return json!({ "kind": "site", "label": "No link", "about": "No link to the posting is saved.", "minutes": 10 });
    }
    json!({ "kind": "site", "label": "Company site", "about": "On the company's own site.", "minutes": 10 })
}

// --- answers you've given before ---------------------------------------------------------------

/// A question as the bank keys it: lowercase words, without the "*" and punctuation forms add.
pub fn question_key(label: &str) -> String {
    label.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Questions the bank never keeps: agreeing to terms and certifying (yours to tick each time),
/// and anything that's about this one employer.
fn personal_to_the_role(label: &str) -> bool {
    work_history(label) || {
    let l = label.to_lowercase();
    ["agree", "consent", "certify", "acknowledge", "attest", "privacy", "terms", "why do you want", "why are you interested", "why this",
        "cover letter", "tell us about", "describe", "what interests you", "anything else", "additional information", "captcha"]
        .iter().any(|w| l.contains(w))
        || l.contains(" at ") && l.contains("why")
    }
}

/// A box in a work-history or education entry ("Job Title", "Company", "From", "Degree"…): it
/// differs from entry to entry, so one saved answer would put the same job in every entry. Those
/// come from your CV each time.
fn work_history(label: &str) -> bool {
    const KEYS: &[&str] = &["job title", "title", "position", "position title", "role", "role title", "company", "company name",
        "employer", "employer name", "organization", "organisation", "role description", "description", "job description",
        "responsibilities", "duties", "from", "to", "start date", "end date", "dates", "location", "city", "school",
        "school name", "school or university", "university", "college", "institution", "degree", "field of study", "major",
        "discipline", "i currently work here", "currently work here", "current job"];
    let k = question_key(label);
    KEYS.contains(&k.as_str())
}

/// Your answers to questions forms ask again and again (work authorization, notice, salary…):
/// [{q (as asked), key (question_key), a, at, uses}], newest first.
pub fn bank(agent: &Agent) -> Vec<Value> {
    serde_json::from_str(&agent.secret("answer.bank")).unwrap_or_default()
}

pub fn save_bank(agent: &Agent, list: &[Value]) -> R<()> {
    let clean: Vec<Value> = list.iter().filter_map(|x| {
        let q = x["q"].as_str()?.trim();
        let a = x["a"].as_str()?.trim();
        (!q.is_empty() && !a.is_empty()).then(|| json!({ "q": q, "key": question_key(q), "a": a, "at": x["at"].as_str().unwrap_or(""), "uses": x["uses"].as_u64().unwrap_or(0) }))
    }).take(300).collect();
    agent.db().set("answer.bank", &json!(clean).to_string())
}

/// Keep what you submitted: each short answer to a question that comes up on other forms too.
/// `fields`: the form as it was sent, with its values ([{label, type, value, options}]).
pub fn learn(agent: &Agent, fields: &[Value]) -> R<usize> {
    let mut list = bank(agent);
    let mut n = 0;
    for f in fields {
        let (label, value, kind) = (f["label"].as_str().unwrap_or(""), f["value"].as_str().unwrap_or("").trim(), f["type"].as_str().unwrap_or(""));
        if label.trim().len() < 3 || value.is_empty() || value.chars().count() > 200 || ["file", "password", "checkbox", "add", "skills"].contains(&kind) || personal_to_the_role(label) {
            continue;
        }
        let key = question_key(label);
        list.retain(|x| x["key"] != key.as_str());
        list.insert(0, json!({ "q": label.trim(), "key": key, "a": value, "at": now(), "uses": 0 }));
        n += 1;
    }
    save_bank(agent, &list)?;
    Ok(n)
}

/// The bank's answer to a field, if it has one that fits (for a list of options, one of them).
fn from_bank(list: &[Value], f: &Value) -> Option<String> {
    let label = f["label"].as_str().unwrap_or("");
    if personal_to_the_role(label) || ["file", "checkbox", "add", "skills"].contains(&f["type"].as_str().unwrap_or("")) {
        return None;
    }
    let key = question_key(label);
    if key.len() < 3 {
        return None;
    }
    let a = list.iter().find(|x| x["key"] == key.as_str())?["a"].as_str()?.to_string();
    match f["options"].as_array().filter(|o| !o.is_empty()) {
        Some(opts) => opts.iter().filter_map(|o| o.as_str()).find(|o| question_key(o) == question_key(&a)).map(String::from),
        None => Some(a),
    }
}

/// Whether Job Hunt may press Submit for you on simple forms (off unless you turn it on).
pub fn auto_submit_on(agent: &Agent) -> bool {
    agent.secret("apply.auto_submit") == "1"
}

// --- applying to several in a row ---------------------------------------------------------------

/// The jobs waiting their turn in the Apply window, in order (the first is the open one).
pub fn queue(agent: &Agent) -> Vec<String> {
    serde_json::from_str(&agent.secret("apply.queue")).unwrap_or_default()
}

pub fn set_queue(agent: &Agent, ids: &[String]) -> R<()> {
    agent.db().set("apply.queue", &json!(ids).to_string())
}

/// A new queue: these jobs, in this order.
pub fn start_queue(agent: &Agent, ids: &[String]) -> R<()> {
    agent.db().set("apply.queue.total", &ids.len().to_string())?;
    set_queue(agent, ids)
}

/// Done with `job_id` (submitted or skipped): the next job in the queue to open, if any.
pub fn queue_next(agent: &Agent, job_id: &str) -> Option<String> {
    let mut q = queue(agent);
    if q.first().map(String::as_str) != Some(job_id) && !q.iter().any(|x| x == job_id) {
        return None; // not applying from the queue
    }
    q.retain(|x| x != job_id);
    // Ones applied to (or gone) meanwhile drop out.
    q.retain(|id| agent.db().job(id).ok().flatten().is_some_and(|j| j.status == "approved"));
    let _ = set_queue(agent, &q);
    q.first().cloned()
}

/// What the Apply window's panel shows about a job: its title and company, "2 of 5" when it's
/// part of a queue, and whether Job Hunt may submit it.
pub fn panel_job(agent: &Agent, job: &crate::db::Job) -> Value {
    let q = queue(agent);
    let total = agent.secret("apply.queue.total").parse::<usize>().unwrap_or(q.len()).max(q.len());
    let pos = q.iter().position(|x| *x == job.id);
    let queue_note = pos.map(|i| format!("{} of {total}", total - q.len() + i + 1)).unwrap_or_default();
    json!({ "title": job.title, "company": job.company, "queue": queue_note, "more": pos.is_some_and(|i| i + 1 < q.len()) })
}

/// The link to open for a job's application: the company's own posting when Job Hunt found one.
pub fn form_link(job: &crate::db::Job) -> String {
    job.apply_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| job.url.clone())
}

// --- your own browser ------------------------------------------------------------------------------

/// Which job a page in your own browser is the application for: the one whose link it is, else
/// the one you last chose "Fill in my browser" for (in the last two hours), else the one approved
/// job whose company the page names.
pub fn job_for_page(agent: &Agent, url: &str, title: &str) -> R<crate::db::Job> {
    let jobs: Vec<crate::db::Job> = ["approved", "ready", "applied"].iter().flat_map(|s| agent.db().jobs(Some(s), 500).unwrap_or_default()).collect();
    let key = crate::db::url_key(url);
    if let Some(j) = jobs.iter().find(|j| !key.is_empty() && (crate::db::url_key(&j.url) == key || j.apply_url.as_deref().is_some_and(|a| crate::db::url_key(a) == key))) {
        return Ok(j.clone());
    }
    // The page names one approved job's company (bmo.wd3.myworkdayjobs.com, "Careers at BMO"): that one.
    let page = format!("{} {}", host_of(url), title).to_lowercase();
    let named: Vec<&crate::db::Job> = jobs.iter().filter(|j| j.status == "approved").filter(|j| {
        let co = question_key(&j.company);
        let first = co.split(' ').next().unwrap_or("");
        first.len() >= 3 && (page.contains(&co) || page.contains(first))
    }).collect();
    if let [one] = named.as_slice() {
        return Ok((*one).clone());
    }
    // The one you chose (Fill in my browser, or from the extension's list) in the last two hours, on
    // the site you chose it on: not on another company's site.
    let recent = agent.secret("apply.browser");
    let mut parts = recent.splitn(3, '|');
    if let (Some(id), Some(at)) = (parts.next(), parts.next()) {
        let site = parts.next().unwrap_or("");
        let fresh = chrono::DateTime::parse_from_rfc3339(at).is_ok_and(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_hours() < 2);
        let here = site.is_empty() || site == host_of(url);
        if let Some(j) = jobs.iter().find(|j| j.id == id).filter(|_| fresh && here) {
            return Ok(j.clone());
        }
    }
    Err(Error("Job Hunt can't tell which application this is. On the job's Apply page in Job Hunt, press Fill in my browser, then press Fill this form here again.".into()))
}

/// A random token for one Apply window.
pub fn new_token() -> String {
    use rand::Rng;
    let mut b = [0u8; 18];
    rand::thread_rng().fill(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// A message from the script, if `url` is one and carries the right token: (kind, data).
pub fn message(url: &url::Url, token: &str) -> Option<(String, Value)> {
    if url.host_str() != Some(MESSAGE_HOST) {
        return None;
    }
    // /kind/data: in the path, since a navigation's address may come without its #fragment.
    let (kind, data) = url.path().trim_matches('/').split_once('/')?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    (v["t"].as_str() == Some(token)).then(|| (kind.to_string(), v))
}

/// Which of your files a file field wants, from its label: the CV, the cover letter, or neither.
fn file_for(label: &str, only_one: bool) -> Option<&'static str> {
    let l = label.to_lowercase();
    if l.contains("cover") || l.contains("letter") || l.contains("motivation") {
        Some("letter")
    } else if l.contains("resume") || l.contains("résumé") || l.contains("cv") || l.contains("curriculum") || only_one {
        Some("cv")
    } else {
        None
    }
}

/// The PDF of a Word file, made now if there isn't one or it's older than the Word file; the Word
/// file if a PDF can't be made.
fn as_pdf(docx: &Path) -> PathBuf {
    crate::util::pdf_of(docx).unwrap_or_else(|_| docx.to_path_buf())
}

fn attachment(path: &Path, name: &str) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    let pdf = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    let mime = if pdf { "application/pdf" } else { "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    Some(json!({ "name": format!("{name}.{}", if pdf { "pdf" } else { "docx" }), "mime": mime, "b64": base64::engine::general_purpose::STANDARD.encode(bytes) }))
}

/// What to put in the form's fields, as {values: {key: text}, files: {key: {name, mime, b64}}}.
pub fn answers(agent: &Agent, job_id: &str, fields: &[Value]) -> R<Value> {
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    let profile = agent.profile();
    let cv_text = job.cv_path.as_deref().and_then(|p| cv::open(Path::new(p)).ok())
        .or_else(|| profile.track(job.track.as_deref()).and_then(|t| cv::open(&agent.cv_path(&t.name)).ok()))
        .map(|d| d.plain_text())
        .ok_or_else(|| Error("No CV uploaded yet. Add one in CV & Career.".into()))?;
    // Your files, for the upload fields.
    let who = profile.name.trim();
    let stem = |what: &str| if who.is_empty() { what.to_string() } else { format!("{who} - {what}") };
    let files_wanted: Vec<&Value> = fields.iter().filter(|f| f["type"] == "file").collect();
    let mut files = serde_json::Map::new();
    for f in &files_wanted {
        let which = file_for(f["label"].as_str().unwrap_or(""), files_wanted.len() == 1);
        let path = match which {
            Some("cv") => job.cv_path.as_deref().map(|p| as_pdf(Path::new(p))),
            Some("letter") => job.letter_path.as_deref().map(|p| as_pdf(Path::new(p))),
            _ => None,
        };
        if let Some(a) = path.and_then(|p| attachment(&p, &stem(if which == Some("cv") { "CV" } else { "Cover letter" }))) {
            files.insert(f["key"].as_str().unwrap_or("").to_string(), a);
        }
    }
    // Questions you've answered before, from the bank: no need to ask Claude.
    let saved = bank(agent);
    let mut values = serde_json::Map::new();
    let mut banked: Vec<String> = vec![];
    for f in fields.iter().filter(|f| f["type"] != "file" && f["value"].as_str().unwrap_or("").is_empty()) {
        if let (Some(k), Some(a)) = (f["key"].as_str(), from_bank(&saved, f)) {
            values.insert(k.to_string(), json!(a));
            banked.push(k.to_string());
        }
    }
    // Everything else, from Claude: one line per field, without the file fields and what the bank answered.
    let lines: Vec<String> = fields.iter().filter(|f| f["type"] != "file" && !f["key"].as_str().is_some_and(|k| banked.iter().any(|b| b == k))).map(|f| {
        let mut o = json!({ "key": f["key"], "type": f["type"], "label": f["label"] });
        for k in ["section", "entries", "options", "context", "value", "required", "checked"] {
            if f.get(k).is_some_and(|v| !v.is_null() && v != "" && v != false) {
                o[k] = f[k].clone();
            }
        }
        o.to_string()
    }).collect();
    let mut facts = profile.application_facts.trim().to_string();
    if !profile.email.trim().is_empty() {
        facts.push_str(&format!("\nEmail: {}", profile.email.trim()));
    }
    if let Some(min) = profile.min_salary {
        facts.push_str(&format!("\nMinimum yearly salary they'd accept: {min:.0}"));
    }
    if let Some(prev) = agent.answers(job_id) {
        facts.push_str(&format!("\nAnswers already written for this application (use the same ones): {prev}"));
    }
    // A work-history Add button: Claude lists every role on the CV (a list it gets right more often
    // than a count), and the Add is pressed for each one the form doesn't have yet.
    let work_add = fields.iter().any(|f| f["type"] == "add" && is_work(f["section"].as_str().unwrap_or("")));
    let mut lines = lines;
    if work_add {
        lines.push(json!({"key": "_roles", "type": "textarea", "label": "Every role in the CV's work experience, newest first, one per line as: title | employer | dates. Each title counts, promotions at the same employer included."}).to_string());
    }
    let mut roles_listed = 0usize;
    let mut written: Vec<String> = vec![];
    // Only blank fields that Claude could answer: a form of nothing but what's already filled or banked needs no request.
    if lines.iter().any(|l| !l.contains("\"value\"")) {
        let own = agent.own_words(&job, &profile);
        let known: std::collections::HashSet<&str> = fields.iter().filter_map(|f| f["key"].as_str()).collect();
        for v in agent.llm().fill_form(&profile.name, &cv_text, &job, &lines.join("\n"), &facts, &profile.stories)? {
            if v.key == "_roles" {
                roles_listed = v.value.lines().filter(|l| l.trim().len() > 3).count();
                continue;
            }
            if known.contains(v.key.as_str()) && !v.value.trim().is_empty() {
                let long = v.value.chars().count() > 120;
                written.push(v.key.clone());
                values.insert(v.key, json!(if long { cv::humanize(&v.value, &own) } else { v.value }));
            }
        }
    }
    tidy_answers(fields, &mut values, &cv_text, &profile.application_facts, roles_listed);
    let n = values.len() + files.len();
    agent.db().log(Some(job_id), "fill", &format!("{n} of {} fields filled in on the application form ({} from your saved answers)", fields.len(), banked.len()))?;
    // Count the bank's answers as used.
    if !banked.is_empty() {
        let keys: Vec<String> = fields.iter().filter(|f| f["key"].as_str().is_some_and(|k| banked.iter().any(|b| b == k))).map(|f| question_key(f["label"].as_str().unwrap_or(""))).collect();
        let mut list = bank(agent);
        for x in list.iter_mut().filter(|x| x["key"].as_str().is_some_and(|k| keys.iter().any(|q| q == k))) {
            x["uses"] = json!(x["uses"].as_u64().unwrap_or(0) + 1);
        }
        let _ = save_bank(agent, &list);
    }
    // Submit for you only on a plain form you've turned that on for, with every required field
    // answered from your saved answers, your facts or your files, and nothing Claude wrote at length
    // (the page itself still checks for a captcha and unticked boxes before it presses Submit).
    let page = fields.first().and_then(|f| f["page"].as_str()).unwrap_or("");
    let link = if page.is_empty() { form_link(&job) } else { page.to_string() };
    let host = host_of(&link);
    let required_open = fields.iter().any(|f| f["required"] == true && f["type"] != "file" && !values.contains_key(f["key"].as_str().unwrap_or("")) && f["value"].as_str().unwrap_or("").is_empty());
    let long_written = written.iter().any(|k| values.get(k).and_then(|v| v.as_str()).is_some_and(|v| v.chars().count() > 120));
    let auto = auto_submit_on(agent) && AUTO_FORMS.iter().any(|h| host.ends_with(h)) && !required_open && !long_written;
    Ok(json!({ "values": values, "files": files, "banked": banked, "auto": auto }))
}

/// What Claude wrote, made right where it can be checked: links in full (a LinkedIn box given
/// "linkedin.com/in/jane" gets "https://www.linkedin.com/in/jane"), and a work-history Add button
/// Claude left at nothing pressed once for each role the CV has that the form doesn't.
fn tidy_answers(fields: &[Value], values: &mut serde_json::Map<String, Value>, cv_text: &str, facts: &str, roles_listed: usize) {
    for f in fields {
        let (Some(key), label) = (f["key"].as_str(), f["label"].as_str().unwrap_or("").to_lowercase()) else { continue };
        if f["type"] == "add" {
            let section = f["section"].as_str().unwrap_or("").to_lowercase();
            let given = values.get(key).and_then(|v| v.as_str()).and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0);
            let have = f["entries"].as_i64().unwrap_or(1);
            // Languages: as many entries as languages on the CV and in your application facts
            // ("French: beginner"), never more (Claude guessing added empty ones).
            if section.contains("language") {
                let langs = cv_languages(&format!("{cv_text}\n{facts}")).len() as i64;
                let more = if langs > 0 { (langs - have).max(0) } else { given.min(1) };
                values.insert(key.to_string(), json!(more.to_string()));
            } else if is_work(&section) {
                let more = cv_roles(cv_text).max(roles_listed) as i64 - have;
                if more > given {
                    values.insert(key.to_string(), json!(more.min(12).to_string()));
                }
            }
            continue;
        }
        let Some(v) = values.get(key).and_then(|v| v.as_str()).map(|v| v.trim().to_string()) else { continue };
        let linky = ["linkedin", "website", "url", "portfolio", "github", "profile link", "social"].iter().any(|w| label.contains(w)) || v.contains("linkedin.com/");
        if linky && !v.starts_with("http") && !v.contains(' ') && v.contains('.') {
            let full = if v.starts_with("linkedin.com") { format!("https://www.{v}") } else { format!("https://{v}") };
            values.insert(key.to_string(), json!(full));
        }
    }
}

fn is_work(section: &str) -> bool {
    let s = section.to_lowercase();
    ["experience", "employment", "work", "job", "position"].iter().any(|w| s.contains(w))
}

/// How many roles a CV's experience lists: the lines with a date range ("2019 – Present",
/// "06/2010 - 05/2014", "Jan 2018 to Mar 2020") between its Experience heading and the next section.
/// A CV without an Experience heading the reader knows: every date range outside its education,
/// certificates and the like.
pub fn cv_roles(cv: &str) -> usize {
    use once_cell::sync::Lazy;
    use regex::Regex;
    static RANGE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(?:(?:19|20)\d{2}|\d{1,2}/(?:19|20)\d{2})\b.{0,12}?(?:\u{2013}|\u{2014}|-|\bto\b|\buntil\b).{0,12}?(?:\b(?:19|20)\d{2}\b|present|current|now|to date|date|ongoing)").unwrap());
    static START: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^[\s#*_|]*(?:professional |work |relevant |career |employment |selected )?(?:experience|employment(?: history)?|work history|career history|professional background)\b.{0,30}$").unwrap());
    static END: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^[\s#*_|]*(?:education|academic|qualifications|certifications?|skills|core skills|key skills|languages|training|volunteer|awards|references|publications|interests|professional development|memberships)\b.{0,30}$").unwrap());
    let (mut on, mut off, mut seen_start) = (false, false, false);
    let (mut n, mut loose) = (0, 0);
    for line in cv.lines() {
        if START.is_match(line) {
            on = true;
            off = false;
            seen_start = true;
            continue;
        }
        if END.is_match(line) {
            if on {
                break;
            }
            off = true;
            continue;
        }
        if RANGE.is_match(line) {
            if on {
                n += 1;
            } else if !off {
                loose += 1;
            }
        }
    }
    if seen_start { n } else { loose }
}

/// The languages a CV names (English, Arabic, French…), each once.
pub fn cv_languages(cv: &str) -> Vec<&'static str> {
    const ALL: &[&str] = &["English", "French", "Arabic", "Spanish", "Portuguese", "German", "Italian", "Dutch", "Russian", "Ukrainian", "Polish", "Turkish", "Persian", "Farsi", "Urdu", "Hindi", "Punjabi", "Bengali", "Gujarati", "Tamil", "Telugu", "Marathi", "Malayalam", "Kannada", "Mandarin", "Cantonese", "Chinese", "Japanese", "Korean", "Vietnamese", "Thai", "Indonesian", "Malay", "Tagalog", "Filipino", "Greek", "Hebrew", "Swahili", "Somali", "Amharic", "Romanian", "Hungarian", "Czech", "Slovak", "Serbian", "Croatian", "Bosnian", "Bulgarian", "Swedish", "Norwegian", "Danish", "Finnish", "Kurdish", "Pashto", "Dari", "Armenian", "Albanian", "Tigrinya", "Yoruba", "Igbo", "Hausa", "Sinhala", "Nepali"];
    let words: std::collections::HashSet<String> = cv.split(|c: char| !c.is_alphabetic()).map(|w| w.to_lowercase()).collect();
    let mut out: Vec<&'static str> = ALL.iter().copied().filter(|l| words.contains(&l.to_lowercase())).collect();
    // Farsi is Persian, and Chinese with Mandarin or Cantonese is one of them.
    if out.contains(&"Persian") { out.retain(|l| *l != "Farsi"); }
    if out.contains(&"Mandarin") || out.contains(&"Cantonese") { out.retain(|l| *l != "Chinese"); }
    out
}

/// You submitted the application in the Apply window: the site confirmed it (`auto`), or you pressed
/// "I submitted it".
pub fn submitted(agent: &Agent, job_id: &str, url: &str, auto: bool) -> R<()> {
    submitted_with(agent, job_id, url, auto, &[])
}

/// submitted, with the form as you sent it (`fields`, with their values), so the answers you gave
/// to questions forms often ask are kept for next time (see learn).
pub fn submitted_with(agent: &Agent, job_id: &str, url: &str, auto: bool, fields: &[Value]) -> R<()> {
    if !fields.is_empty() {
        if let Ok(n) = learn(agent, fields) {
            if n > 0 {
                let _ = agent.db().log(Some(job_id), "fill", &format!("kept {n} answers for next time"));
            }
        }
    }
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    if ["applied", "interviewing", "offer", "rejected"].contains(&job.status.as_str()) {
        return Ok(());
    }
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
    agent.db().set_status(job_id, "applied", &format!("submitted on {} (filled in by Job Hunt{}) {}", if host.is_empty() { "the company's site" } else { &host }, if auto { ", confirmed by the site" } else { "" }, now()))?;
    if auto {
        agent.note(&format!("Applied: {} at {}", job.title, job.company), "The site confirmed your application, so Job Hunt marked it as applied. It reminds you to follow up if there's no reply.");
    }
    // And the email to the recruiter there, as you chose.
    if agent.claude_ready() {
        if let Err(e) = crate::recruiters::on_applied(agent, job_id) {
            agent.db().log(Some(job_id), "recruiter:error", &e.0)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_in_full_and_every_role_added() {
        let cv = "Jane Candidate\nSummary\nPM.\nProfessional Experience\nSenior PM, Acme\n2021 \u{2013} Present\nPM, Acme\n2018 \u{2013} 2021\nAnalyst, Beta | 06/2010 - 05/2014\nEducation\nBSc, 2006 \u{2013} 2010\n";
        assert_eq!(cv_roles(cv), 3);
        let fields = vec![json!({"key": "f1", "type": "text", "label": "Please provide your Linkedin profile:"}), json!({"key": "a1", "type": "add", "section": "Work Experience", "entries": 1})];
        let mut v = serde_json::Map::new();
        v.insert("f1".into(), json!("linkedin.com/in/jane-c"));
        tidy_answers(&fields, &mut v, cv, "", 0);
        assert_eq!(v["f1"], "https://www.linkedin.com/in/jane-c");
        assert_eq!(v["a1"], "2", "two more roles than the one entry there");
        // Claude's list of roles counts when the CV's own layout hides them.
        let mut v = serde_json::Map::new();
        tidy_answers(&fields, &mut v, "Jane\nno dates here", "", 5);
        assert_eq!(v["a1"], "4");
        // Headings in markdown or capitals, and a CV with no Experience heading at all.
        assert_eq!(cv_roles("## PROFESSIONAL EXPERIENCE\n**Lead**, X | Jul 2023 \u{2013} Present\nB, Y | 2019 - 2023\n## EDUCATION\nBSc 2005 - 2009"), 2);
        assert_eq!(cv_roles("Jane\nLead, X | 2023 \u{2013} Present\nB, Y | 2019 - 2023\nEducation\nBSc 2005 - 2009"), 2);
        // Languages: as many entries as the CV names, not Claude's guess.
        let cv = format!("{cv}Languages\nEnglish (fluent), Arabic (native)\n");
        let fields = vec![json!({"key": "a2", "type": "add", "section": "Languages", "entries": 1})];
        let mut v = serde_json::Map::new();
        v.insert("a2".into(), json!("3"));
        tidy_answers(&fields, &mut v, &cv, "", 0);
        assert_eq!(v["a2"], "1");
        // A language only in your facts counts too.
        tidy_answers(&fields, &mut v, &cv, "French: beginner (school, to grade 6)", 0);
        assert_eq!(v["a2"], "2");
    }

    #[test]
    fn messages_need_the_token_and_files_go_by_label() {
        let tok = new_token();
        let b64 = |v: &Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string());
        let good = url::Url::parse(&format!("https://jobhunt.invalid/fields/{}", b64(&json!({ "t": tok, "fields": [] })))).unwrap();
        let (kind, v) = message(&good, &tok).unwrap();
        assert_eq!((kind.as_str(), v["fields"].is_array()), ("fields", true));
        let forged = url::Url::parse(&format!("https://jobhunt.invalid/applied/{}", b64(&json!({ "t": "guess" })))).unwrap();
        assert!(message(&forged, &tok).is_none());
        assert!(message(&url::Url::parse("https://boards.greenhouse.io/acme/jobs/1").unwrap(), &tok).is_none());
        assert_eq!(file_for("Resume/CV", false), Some("cv"));
        assert_eq!(file_for("Cover Letter", false), Some("letter"));
        assert_eq!(file_for("Transcript", false), None);
        assert_eq!(file_for("Attach", true), Some("cv"));
        let s = script(&tok, "Tax Manager", "Acme <b>");
        assert!(s.contains(&tok) && s.contains(r#""company":"Acme <b>""#) && !s.contains("__TOKEN__"));
    }

    #[test]
    fn work_history_isnt_banked() {
        for l in ["Job Title*", "Company", "Role Description", "From", "Degree", "Location"] {
            assert!(personal_to_the_role(l), "{l}");
        }
        assert!(!personal_to_the_role("Are you legally eligible to work in Canada?"));
        assert!(!personal_to_the_role("Notice period"));
        let list = vec![json!({ "q": "Job Title", "key": "job title", "a": "Assistant" })];
        assert_eq!(from_bank(&list, &json!({ "label": "Job Title", "type": "text" })), None, "an old saved job title isn't reused");
    }

    #[test]
    fn effort_by_how_you_apply() {
        let job = |url: &str, apply: Option<&str>, email: Option<&str>| crate::db::Job { url: url.into(), apply_url: apply.map(String::from), apply_email: email.map(String::from), ..Default::default() };
        let kind = |j: &crate::db::Job| effort(j)["kind"].as_str().unwrap().to_string();
        assert_eq!(kind(&job("https://x.example/1", None, Some("jobs@x.example"))), "email");
        assert_eq!(kind(&job("https://boards.greenhouse.io/acme/jobs/1", None, None)), "quick");
        assert_eq!(kind(&job("https://rbc.wd3.myworkdayjobs.com/RBC/job/1", None, None)), "account");
        assert_eq!(kind(&job("https://www.linkedin.com/jobs/view/1/", None, None)), "board", "only on a job board so far");
        assert_eq!(kind(&job("https://www.linkedin.com/jobs/view/1/", Some("https://jobs.lever.co/acme/1"), None)), "quick", "the company's own form counts");
        assert_eq!(kind(&job("https://careers.acme.example/1", None, None)), "site");
    }

    #[test]
    fn saved_answers_fill_without_claude_and_may_submit() {
        let s = crate::testkit::setup();
        s.agent.search(Some(vec![crate::testkit::posting("Technical Program Manager", "1")])).unwrap();
        let auth = json!({ "key": "f0", "type": "select", "label": "Are you legally authorized to work in Canada? *", "options": ["Yes", "No"], "required": true, "value": "", "page": "https://boards.greenhouse.io/acme/jobs/1" });
        let why = json!({ "key": "f1", "type": "textarea", "label": "Why do you want to work at Acme?", "required": false, "value": "" });
        let calls = || s.llm.calls.lock().unwrap().iter().filter(|c| c.starts_with("fill:")).count();
        answers(&s.agent, "test:1", &[auth.clone(), why.clone()]).unwrap();
        assert_eq!(calls(), 1, "nothing saved yet: Claude answers");
        // You submit: the work-authorization answer is kept, the why-us one isn't.
        let n = learn(&s.agent, &[json!({ "label": "Are you legally authorized to work in Canada? *", "type": "select", "value": "Yes" }),
            json!({ "label": "Why do you want to work at Acme?", "type": "textarea", "value": "Because…" }), json!({ "label": "I agree to the terms", "type": "checkbox", "value": "" })]).unwrap();
        assert_eq!(n, 1);
        let a = answers(&s.agent, "test:1", &[auth.clone()]).unwrap();
        assert_eq!((a["values"]["f0"].as_str(), calls()), (Some("Yes"), 1), "answered from the bank, no new request");
        assert_eq!(bank(&s.agent)[0]["uses"], 1);
        assert_eq!(a["auto"], false, "submitting for you is off until you turn it on");
        s.agent.db().set("apply.auto_submit", "1").unwrap();
        assert_eq!(answers(&s.agent, "test:1", &[auth.clone()]).unwrap()["auto"], true, "all required answered from the bank, on Greenhouse");
        let open = json!({ "key": "f2", "type": "text", "label": "Desired start date", "required": true, "value": "" });
        assert_eq!(answers(&s.agent, "test:1", &[auth.clone(), open]).unwrap()["auto"], false, "a required question left open");
        let mut elsewhere = auth.clone();
        elsewhere["page"] = json!("https://acme.wd3.myworkdayjobs.com/Careers/job/1/apply");
        assert_eq!(answers(&s.agent, "test:1", &[elsewhere]).unwrap()["auto"], false, "only plain forms");
    }

    #[test]
    fn queue_and_your_own_browser() {
        let s = crate::testkit::setup();
        s.agent.search(Some(vec![crate::testkit::posting("Technical Program Manager", "1"), crate::testkit::posting("Senior Program Manager", "2")])).unwrap();
        for id in ["test:1", "test:2"] {
            s.agent.db().set_status(id, "approved", "").unwrap();
        }
        start_queue(&s.agent, &["test:1".into(), "test:2".into()]).unwrap();
        let j1 = s.agent.db().job("test:1").unwrap().unwrap();
        assert_eq!(panel_job(&s.agent, &j1)["queue"], "1 of 2");
        assert_eq!(queue_next(&s.agent, "test:1").as_deref(), Some("test:2"));
        let j2 = s.agent.db().job("test:2").unwrap().unwrap();
        assert_eq!(panel_job(&s.agent, &j2)["queue"], "2 of 2");
        assert_eq!(queue_next(&s.agent, "test:2"), None);
        assert_eq!(queue_next(&s.agent, "elsewhere"), None, "not from a queue");
        // A page in your own browser: by its link, or the one you chose Fill in my browser for.
        assert_eq!(job_for_page(&s.agent, &j1.url, "").unwrap().id, "test:1");
        assert!(job_for_page(&s.agent, "https://forms.example/apply/77", "Apply").is_err());
        s.agent.db().set("apply.browser", &format!("test:2|{}", now())).unwrap();
        assert_eq!(job_for_page(&s.agent, "https://forms.example/apply/77", "Apply").unwrap().id, "test:2");
        // Chosen on one company's site: not taken for another company's.
        s.agent.db().set("apply.browser", &format!("test:2|{}|trcareers.wd5.myworkdayjobs.com", now())).unwrap();
        assert_eq!(job_for_page(&s.agent, "https://trcareers.wd5.myworkdayjobs.com/apply", "Apply").unwrap().id, "test:2");
        assert!(job_for_page(&s.agent, "https://bmo.wd3.myworkdayjobs.com/apply", "Careers at BMO").is_err(), "BMO's site isn't the job chosen on Thomson Reuters'");
    }
}
