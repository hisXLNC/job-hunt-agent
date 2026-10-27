//! The recruiters you've dealt with, and the companies they hire for.
//!
//! The idea: when you got as far as an interview, there was nearly always a recruiter's email. Those
//! people already know you. So Job Hunt finds every recruiter in your Gmail, keeps them in one list
//! (and one Gmail label), searches their companies' job boards, flags postings at those companies,
//! and drafts the short email: "I applied for a role with you a while ago; I've seen this one and
//! I'm really interested. Could you put me forward?"

use crate::claude::Triage;
use crate::google::Email;
use crate::pipeline::Agent;
use crate::util::now;
use crate::{Error, R};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Gmail label (under JobHunt/) on recruiters' emails.
pub const LABEL: &str = "Recruiters";

/// What Gmail is searched for: two years of email about roles, without promotions.
const QUERY: &str = "newer_than:2y -category:promotions -category:social -category:forums (interview OR \"your application\" OR \"your candidacy\" OR \"next steps\" OR position OR role OR opportunity OR recruiter OR \"talent acquisition\")";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Asked {
    pub job_id: String,
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Recruiter {
    pub email: String,
    pub name: String,
    pub company: String,
    /// "in-house" or "agency".
    pub kind: String,
    pub roles: Vec<String>,
    /// The furthest it got (see `rank`).
    pub stage: String,
    pub first_at: String,
    pub last_at: String,
    pub emails: u32,
    /// Their emails, for the Gmail label.
    pub gmail_ids: Vec<String>,
    /// Roles you asked them to put you forward for.
    pub asked: Vec<Asked>,
    /// You said not to use this one.
    pub hidden: bool,
    /// From their email signature, or as you entered them.
    pub phone: String,
    pub linkedin: String,
    /// Your own notes about them.
    pub notes: String,
}

fn rank(stage: &str) -> u8 {
    match stage {
        "offer" => 5,
        "interview" => 4,
        "screen" => 3,
        "rejected" => 2,
        "outreach" => 1,
        _ => 0,
    }
}

/// Every recruiter in Job Hunt's database.
pub fn list(agent: &Agent) -> Vec<Recruiter> {
    let rows = agent.db().recruiter_rows().unwrap_or_default();
    if rows.is_empty() {
        // Kept as one list before the database had a table for them: move them over once.
        let old: Vec<Recruiter> = serde_json::from_str(&agent.secret("recruiters")).unwrap_or_default();
        if !old.is_empty() && save(agent, &old).is_ok() {
            let _ = agent.db().delete("recruiters");
            return old;
        }
    }
    rows.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect()
}

fn save(agent: &Agent, list: &[Recruiter]) -> R<()> {
    let db = agent.db();
    for r in list {
        db.put_recruiter(&serde_json::to_value(r)?)?;
    }
    Ok(())
}

/// The recruiters who emailed about one of your applications, with how far it got and when.
pub fn for_job(agent: &Agent, job_id: &str) -> Vec<Value> {
    let all = list(agent);
    agent.db().recruiter_links(None, Some(job_id)).unwrap_or_default().into_iter().filter_map(|mut l| {
        let r = all.iter().find(|r| l["email"] == r.email.as_str() && !r.hidden)?;
        l["name"] = json!(r.name);
        l["company_of"] = json!(r.company);
        l["phone"] = json!(r.phone);
        l["linkedin"] = json!(r.linkedin);
        Some(l)
    }).collect()
}

/// A phone number and a LinkedIn link from the end of an email (the signature), if there are any.
pub fn signature(body: &str) -> (String, String) {
    use once_cell::sync::Lazy;
    use regex::Regex;
    static PHONE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?)\s*\d{1,5})?").unwrap());
    static LINKEDIN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?").unwrap());
    // The signature: the last lines before any quoted earlier email.
    let own: Vec<&str> = body.lines().take_while(|l| !l.trim_start().starts_with('>') && !(l.starts_with("On ") && l.trim_end().ends_with("wrote:"))).collect();
    let tail = own[own.len().saturating_sub(15)..].join("\n");
    let phone = PHONE.find(&tail).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
    let linkedin = LINKEDIN.find(&tail).map(|m| { let u = m.as_str().trim_end_matches('/'); if u.starts_with("http") { u.to_string() } else { format!("https://{u}") } }).unwrap_or_default();
    (phone, linkedin)
}

/// A company name for matching: "Maple Bank of Canada Inc." and "maple bank" match.
pub fn company_key(name: &str) -> String {
    const SKIP: &[&str] = &["inc", "incorporated", "ltd", "limited", "llc", "llp", "corp", "corporation", "co", "company", "group", "the", "plc", "canada", "of", "lp", "ulc"];
    name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty() && !SKIP.contains(w)).collect::<Vec<_>>().join(" ")
}

/// The recruiter you know at a company, if any: in-house first, then the latest.
pub fn for_company<'a>(list: &'a [Recruiter], company: &str) -> Option<&'a Recruiter> {
    let k = company_key(company);
    if k.len() < 3 {
        return None;
    }
    let same = |r: &Recruiter| {
        let rk = company_key(&r.company);
        rk.len() >= 3 && (rk == k || (rk.len() >= 5 && k.starts_with(&format!("{rk} "))) || (k.len() >= 5 && rk.starts_with(&format!("{k} "))))
    };
    list.iter().filter(|r| !r.hidden && same(r)).max_by(|a, b| (a.kind == "in-house", &a.last_at).cmp(&(b.kind == "in-house", &b.last_at)))
}

/// "Jane Smith <jane@acme.com>" as (name, address).
pub fn sender(from: &str) -> (String, String) {
    match from.rsplit_once('<') {
        Some((n, a)) => (n.trim().trim_matches('"').to_string(), a.trim_end_matches('>').trim().to_lowercase()),
        None => (String::new(), from.trim().to_lowercase()),
    }
}

/// Whether an address could be a person: not a no-reply or shared inbox, not a job board or hiring
/// system.
pub fn looks_personal(address: &str) -> bool {
    let Some((user, domain)) = address.split_once('@') else { return false };
    const ROBOT: &[&str] = &["noreply", "no-reply", "donotreply", "do-not-reply", "notification", "notifications", "mailer", "alerts", "alert", "jobs", "careers", "career",
        "recruiting", "recruitment", "talent", "hr", "hiring", "info", "hello", "team", "support", "news", "newsletter", "updates", "invitations", "calendar", "workday", "apply", "applications"];
    const SYSTEMS: &[&str] = &["greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "myworkday.com", "myworkdayjobs.com", "smartrecruiters.com", "workablemail.com", "workable.com",
        "icims.com", "jobvite.com", "taleo.net", "successfactors.com", "linkedin.com", "indeed.com", "indeedemail.com", "glassdoor.com", "ziprecruiter.com", "jobbank.gc.ca", "talent.com",
        "eluta.ca", "monster.com", "google.com", "calendly.com", "zoom.us", "teams.microsoft.com", "bamboohr.com", "recruitee.com", "teamtailor-mail.com", "breezy.hr", "applytojob.com", "hirevue.com"];
    let u = user.to_lowercase();
    let d = domain.to_lowercase();
    !ROBOT.iter().any(|r| u == *r || u.starts_with(&format!("{r}.")) || u.starts_with(&format!("{r}-")) || u.starts_with(&format!("{r}+")))
        && !SYSTEMS.iter().any(|s| d == *s || d.ends_with(&format!(".{s}")))
}

/// What one sender wrote about, for Claude to judge.
#[derive(Default)]
struct Seen {
    name: String,
    subjects: Vec<String>,
    snippets: Vec<String>,
    ids: Vec<String>,
    first: String,
    last: String,
}

fn merge(list: &mut Vec<Recruiter>, idea: &crate::claude::RecruiterIdea, seen: Option<&Seen>) -> bool {
    let email = idea.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return false;
    }
    let (first, last, ids, n) = seen.map(|s| (s.first.clone(), s.last.clone(), s.ids.clone(), s.ids.len() as u32)).unwrap_or_else(|| (now(), now(), vec![], 1));
    match list.iter_mut().find(|r| r.email == email) {
        Some(r) => {
            if !idea.name.trim().is_empty() { r.name = idea.name.trim().into() }
            if !idea.company.trim().is_empty() { r.company = idea.company.trim().into() }
            if !idea.kind.is_empty() { r.kind = idea.kind.clone() }
            for role in &idea.roles {
                if !role.trim().is_empty() && !r.roles.iter().any(|x| x.eq_ignore_ascii_case(role.trim())) {
                    r.roles.push(role.trim().into());
                }
            }
            if rank(&idea.stage) > rank(&r.stage) { r.stage = idea.stage.clone() }
            if !first.is_empty() && (r.first_at.is_empty() || first < r.first_at) { r.first_at = first }
            if last > r.last_at { r.last_at = last }
            for id in ids {
                if !r.gmail_ids.contains(&id) { r.gmail_ids.push(id); r.emails += 1; }
            }
            false
        }
        None => {
            list.push(Recruiter { email, name: idea.name.trim().into(), company: idea.company.trim().into(), kind: idea.kind.clone(), roles: idea.roles.clone(),
                stage: idea.stage.clone(), first_at: first, last_at: last, emails: n.max(1), gmail_ids: ids, ..Default::default() });
            true
        }
    }
}

/// Go through your Gmail for recruiters: two years of email about roles, grouped by sender, and
/// Claude picks out the recruiters. Then their emails get a Gmail label and their companies' job
/// boards are added to the search. {found, new, labelled, boards}
pub fn scan(agent: &Agent) -> R<Value> {
    let mail = agent.mail.read().unwrap().clone().ok_or_else(|| Error("Connect Gmail first (Settings \u{2192} Accounts).".into()))?;
    let _g = agent.claim("recruiters")?;
    let _ = backfill(agent);
    let profile = agent.profile();
    let me: Vec<String> = [profile.email.to_lowercase(), agent.secret("google.email").to_lowercase()].into_iter().filter(|x| !x.is_empty()).collect();
    let mut by: BTreeMap<String, Seen> = BTreeMap::new();
    let ids = mail.recent(QUERY, 300)?;
    let total = ids.len();
    for (i, id) in ids.into_iter().enumerate() {
        agent.step("Looking for recruiters in your email", i, total, "");
        let Ok(e) = mail.get(&id) else { continue };
        let (name, addr) = sender(&e.from);
        if me.contains(&addr) || !looks_personal(&addr) {
            continue;
        }
        let s = by.entry(addr).or_default();
        if s.name.is_empty() { s.name = name }
        if s.subjects.len() < 4 && !s.subjects.contains(&e.subject) { s.subjects.push(e.subject.chars().take(120).collect()) }
        if s.snippets.len() < 2 { s.snippets.push(e.body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(280).collect()) }
        s.ids.push(e.id.clone());
        let at = e.received_at.clone();
        if s.first.is_empty() || at < s.first { s.first = at.clone() }
        if at > s.last { s.last = at }
    }
    // Most-emailed first; at most 120 senders, 40 at a time.
    let mut senders: Vec<(&String, &Seen)> = by.iter().collect();
    senders.sort_by_key(|(_, s)| std::cmp::Reverse(s.ids.len()));
    let mut list = list(agent);
    let mut new = 0;
    let mut found = 0;
    for chunk in senders.iter().take(120).collect::<Vec<_>>().chunks(40) {
        let text = chunk.iter().map(|(a, s)| format!("{} <{a}> ({} emails)\nSubjects: {}\nSnippets: {}", s.name, s.ids.len(), s.subjects.join(" | "), s.snippets.join(" | "))).collect::<Vec<_>>().join("\n\n");
        for idea in agent.llm().recruiters(&profile.name, &text)? {
            let key = idea.email.trim().to_lowercase();
            if let Some(s) = by.get(&key) {
                found += 1;
                if merge(&mut list, &idea, Some(s)) {
                    new += 1;
                }
            }
        }
    }
    save(agent, &list)?;
    // Their emails, in one Gmail label.
    let mut labelled = 0;
    for r in list.iter().filter(|r| !r.hidden) {
        for id in r.gmail_ids.iter().take(50) {
            if mail.label(id, LABEL).is_ok() {
                labelled += 1;
            }
        }
    }
    let boards = add_their_boards(agent, &list);
    let db = agent.db();
    db.set("last.recruiters", &now())?;
    db.log(None, "recruiters", &format!("{found} recruiters found ({new} new); {} job boards added", boards.len()))?;
    drop(db);
    Ok(json!({ "found": found, "new": new, "labelled": labelled, "boards": boards }))
}

/// What an email's category says about how far an application got.
fn stage_of(category: &str) -> &'static str {
    match category {
        "interview_request" | "interview_confirmed" | "assessment" => "interview",
        "rejection" => "rejected",
        "offer" => "offer",
        "recruiter_outreach" => "outreach",
        _ => "",
    }
}

/// A person who emailed you about a role, noted as their email is read (no Claude call): kept in the
/// recruiters database, with their phone and LinkedIn from the signature, and when the email is
/// about one of your applications, saved with that application too.
pub fn note_email(agent: &Agent, e: &Email, t: &Triage) {
    if ["job_alert", "not_job"].contains(&t.category.as_str()) {
        return;
    }
    let (name, addr) = sender(&e.from);
    if !looks_personal(&addr) || name.is_empty() {
        return;
    }
    let job = t.job_id.as_deref().and_then(|id| agent.db().job(id).ok().flatten());
    // Only people writing about a role you're in for, or approaching you about one.
    if job.is_none() && t.category != "recruiter_outreach" && stage_of(&t.category).is_empty() {
        return;
    }
    let company = t.company.clone().filter(|c| !c.trim().is_empty()).or_else(|| job.as_ref().map(|j| j.company.clone())).unwrap_or_default();
    if company.is_empty() {
        return;
    }
    let stage = stage_of(&t.category);
    let roles: Vec<String> = t.role.clone().or_else(|| job.as_ref().map(|j| j.title.clone())).into_iter().collect();
    let idea = crate::claude::RecruiterIdea { email: addr.clone(), name: name.clone(), company: company.clone(), kind: String::new(), roles, stage: stage.into() };
    let seen = Seen { ids: vec![e.id.clone()], first: e.received_at.clone(), last: e.received_at.clone(), ..Default::default() };
    let mut all = list(agent);
    merge(&mut all, &idea, Some(&seen));
    let (phone, linkedin) = signature(&e.body);
    if let Some(r) = all.iter_mut().find(|r| r.email == addr) {
        if r.phone.is_empty() { r.phone = phone }
        if r.linkedin.is_empty() { r.linkedin = linkedin }
    }
    let _ = save(agent, &all);
    if let Some(j) = job {
        save_with_application(agent, &j, &addr, &name, stage, &e.received_at, &e.subject);
    }
}

/// Record a recruiter on an application: linked in the database, and on its People list.
fn save_with_application(agent: &Agent, job: &crate::db::Job, email: &str, name: &str, stage: &str, at: &str, subject: &str) {
    let _ = agent.db().link_recruiter(email, &job.id, stage, at, subject);
    let mut people = agent.contacts(&job.id);
    if !people.iter().any(|c| c["email"].as_str().is_some_and(|x| x.eq_ignore_ascii_case(email))) {
        let r = list(agent).into_iter().find(|r| r.email == email);
        let when = chrono::DateTime::parse_from_rfc3339(at).map(|t| t.format("%b %-d, %Y").to_string()).unwrap_or_default();
        people.push(json!({ "name": name, "role": format!("Recruiter at {}", r.as_ref().map(|r| r.company.as_str()).unwrap_or(job.company.as_str())), "email": email,
            "link": r.as_ref().map(|r| r.linkedin.clone()).unwrap_or_default(), "note": format!("Emailed you about this application{}", if when.is_empty() { String::new() } else { format!(" ({when})") }), "message": "" }));
        let _ = agent.save_contacts(&job.id, &people);
    }
}

/// Once: link recruiters to applications from the emails Job Hunt already read.
pub fn backfill(agent: &Agent) -> R<usize> {
    if !agent.secret("recruiters.linked").is_empty() {
        return Ok(0);
    }
    let emails = agent.db().application_emails()?;
    let mut n = 0;
    for (gmail_id, job_id, from, subject, category, at) in emails {
        if ["job_alert", "not_job"].contains(&category.as_str()) {
            continue;
        }
        let (name, addr) = sender(&from);
        if name.is_empty() || !looks_personal(&addr) {
            continue;
        }
        let Some(job) = agent.db().job(&job_id)? else { continue };
        let idea = crate::claude::RecruiterIdea { email: addr.clone(), name: name.clone(), company: job.company.clone(), kind: String::new(), roles: vec![job.title.clone()], stage: stage_of(&category).into() };
        let seen = Seen { ids: vec![gmail_id], first: at.clone(), last: at.clone(), ..Default::default() };
        let mut all = list(agent);
        merge(&mut all, &idea, Some(&seen));
        save(agent, &all)?;
        save_with_application(agent, &job, &addr, &name, stage_of(&category), &at, &subject);
        n += 1;
    }
    agent.db().set("recruiters.linked", &now())?;
    Ok(n)
}

/// Change a recruiter's details, or add one you know yourself (to an application, optionally).
pub fn edit(agent: &Agent, v: &Value) -> R<()> {
    let email = v["email"].as_str().unwrap_or("").trim().to_lowercase();
    if !email.contains('@') || email.contains(' ') {
        return Err(Error("Give their email address.".into()));
    }
    let mut all = list(agent);
    let i = match all.iter().position(|r| r.email == email) {
        Some(i) => i,
        None => {
            all.push(Recruiter { email: email.clone(), first_at: now(), last_at: now(), ..Default::default() });
            all.len() - 1
        }
    };
    let r = &mut all[i];
    for (k, f) in [("name", &mut r.name), ("company", &mut r.company), ("phone", &mut r.phone), ("linkedin", &mut r.linkedin), ("notes", &mut r.notes), ("kind", &mut r.kind)] {
        if let Some(x) = v[k].as_str() {
            *f = x.trim().to_string();
        }
    }
    if r.company.is_empty() {
        return Err(Error("Give the company they recruit for.".into()));
    }
    let r = r.clone();
    save(agent, &all)?;
    if let Some(job_id) = v["job_id"].as_str().filter(|x| !x.is_empty()) {
        let job = agent.db().job(job_id)?.ok_or_else(|| Error("That application no longer exists.".into()))?;
        save_with_application(agent, &job, &r.email, &r.name, "", &now(), "added by you");
    }
    Ok(())
}

/// Every recruiter and the applications they handled, as a spreadsheet.
pub fn csv(agent: &Agent) -> String {
    let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let mut out = String::from("Name,Company,Kind,Email,Phone,LinkedIn,Roles,Furthest stage,First contact,Last contact,Applications,Asked to put you forward,Notes\n");
    let links = agent.db().recruiter_links(None, None).unwrap_or_default();
    for r in list(agent).iter().filter(|r| !r.hidden) {
        let apps: Vec<String> = links.iter().filter(|l| l["email"] == r.email.as_str()).map(|l| format!("{} ({})", l["title"].as_str().unwrap_or(""), l["status"].as_str().unwrap_or(""))).collect();
        let row = [&r.name, &r.company, &r.kind, &r.email, &r.phone, &r.linkedin, &r.roles.join("; "), &r.stage, &r.first_at.chars().take(10).collect::<String>(),
            &r.last_at.chars().take(10).collect::<String>(), &apps.join("; "), &r.asked.len().to_string(), &r.notes];
        out.push_str(&row.iter().map(|x| q(x)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    out
}

/// Board names a company's careers site likely uses: "Maple Bank" as maplebank, maple-bank, maple.
fn slugs(company: &str) -> Vec<String> {
    let words: Vec<String> = company_key(company).split(' ').map(String::from).filter(|w| !w.is_empty()).collect();
    let mut out = vec![words.concat(), words.join("-")];
    if let Some(f) = words.first().filter(|f| f.len() >= 4) {
        out.push(f.clone());
    }
    out.dedup();
    out.into_iter().filter(|s| s.len() >= 3).collect()
}

/// Add the job boards of the companies your in-house recruiters work for, where Job Hunt finds one
/// (Greenhouse, Lever, Ashby, SmartRecruiters, Workable). Returns the companies added.
pub fn add_their_boards(agent: &Agent, list: &[Recruiter]) -> Vec<String> {
    let profile = agent.profile();
    let have = crate::sources::boards(&profile);
    let removed = agent.removed_boards();
    let c = crate::sources::http();
    let mut added = vec![];
    let mut tried = std::collections::HashSet::new();
    for r in list.iter().filter(|r| !r.hidden && r.kind != "agency") {
        let key = company_key(&r.company);
        if key.is_empty() || !tried.insert(key) {
            continue;
        }
        'company: for slug in slugs(&r.company) {
            for board in ["greenhouse", "lever", "ashby", "smartrecruiters", "workable"] {
                if have.iter().any(|(b, n)| *b == board && n.eq_ignore_ascii_case(&slug)) || removed.contains(&format!("{board}:{slug}")) {
                    break 'company;
                }
                if let Ok((jobs, _)) = crate::sources::fetch_board(&c, &profile, board, &slug) {
                    if !jobs.is_empty() && agent.add_boards(&[json!({ "board": board, "slug": slug })]).unwrap_or(0) > 0 {
                        added.push(r.company.clone());
                        break 'company;
                    }
                }
            }
        }
    }
    added
}

/// Draft the email asking a recruiter you know to put you forward for a role at their company, in
/// your Gmail drafts (or just written, without Gmail). {to, name, subject, body, drafted, sent}
pub fn ask(agent: &Agent, job_id: &str) -> R<Value> {
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    let (to, name, known) = contact_for(agent, &job).ok_or_else(|| Error("You don't know a recruiter at this company yet.".into()))?;
    write(agent, &job, &to, &name, known, false)
}

// --- when you apply ----------------------------------------------------------------------------

/// What to do with the email to a recruiter when you apply: "draft" (in Gmail, the default),
/// "send" (sent for you) or "off".
pub fn apply_mode(agent: &Agent) -> String {
    match agent.secret("apply.recruiter").as_str() {
        "send" => "send".into(),
        "off" => "off".into(),
        _ => "draft".into(),
    }
}

/// Who to write to about an application: the recruiter on it, a recruiter you know at the company,
/// or a person whose address is in the posting. (address, name, known to you)
pub fn contact_for(agent: &Agent, job: &crate::db::Job) -> Option<(String, String, bool)> {
    if let Some(l) = for_job(agent, &job.id).into_iter().next() {
        return Some((l["email"].as_str()?.to_string(), l["name"].as_str().unwrap_or("").to_string(), true));
    }
    let all = list(agent);
    if let Some(r) = for_company(&all, &job.company) {
        return Some((r.email.clone(), r.name.clone(), true));
    }
    use once_cell::sync::Lazy;
    use regex::Regex;
    static EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap());
    let applied_to = job.apply_email.clone().unwrap_or_default().to_lowercase();
    EMAIL.find_iter(&job.description).map(|m| m.as_str().trim_end_matches('.').to_lowercase())
        .find(|e| *e != applied_to && looks_personal(e))
        .map(|e| (e, String::new(), false))
}

/// When you apply: write to the recruiter (or the person in the posting) to say so and ask them to
/// put you forward; drafted in Gmail, or sent, as you chose. At most one email a week to the same
/// person, and never to the address the application itself went to. What happened, or None when
/// there was nobody to write to (or it's off).
pub fn on_applied(agent: &Agent, job_id: &str) -> R<Option<Value>> {
    let mode = apply_mode(agent);
    if mode == "off" {
        return Ok(None);
    }
    let job = agent.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
    let Some((to, name, known)) = contact_for(agent, &job) else { return Ok(None) };
    let all = list(agent);
    if let Some(r) = all.iter().find(|r| r.email == to) {
        if r.asked.iter().any(|a| a.job_id == job_id) {
            return Ok(None);
        }
        let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
        if r.asked.iter().any(|a| a.at > week_ago) {
            agent.db().log(Some(job_id), "recruiter", &format!("not writing to {} again this week", if r.name.is_empty() { &to } else { &r.name }))?;
            return Ok(None);
        }
    }
    let v = write(agent, &job, &to, &name, known, mode == "send")?;
    let who = if name.is_empty() { to.clone() } else { name.clone() };
    if v["sent"] == true {
        agent.note(&format!("Emailed {who} at {}", job.company), &format!("To say you applied for {} and ask them to put you forward. It's in your Gmail Sent folder.", job.title));
    } else if v["drafted"] == true {
        agent.note(&format!("Email to {who} ready"), &format!("About your application for {} at {}: it's in your Gmail drafts. Read it over and send it.", job.title, job.company));
    }
    Ok(Some(v))
}

/// Write to someone about an application. `known`: a recruiter you dealt with (asks them to put you
/// forward); otherwise a short note to say you've applied. `send`: sent now, else a Gmail draft.
fn write(agent: &Agent, job: &crate::db::Job, to: &str, name: &str, known: bool, send: bool) -> R<Value> {
    let mut all = list(agent);
    if !all.iter().any(|r| r.email == to) {
        all.push(Recruiter { email: to.into(), name: name.into(), company: job.company.clone(), first_at: now(), last_at: now(), ..Default::default() });
    }
    let r = all.iter().find(|r| r.email == to).cloned().unwrap_or_default();
    let profile = agent.profile();
    let cv = job.cv_path.as_deref().and_then(|p| crate::cv::open(std::path::Path::new(p)).ok())
        .or_else(|| profile.track(job.track.as_deref()).and_then(|t| crate::cv::open(&agent.cv_path(&t.name)).ok()))
        .map(|d| d.plain_text()).unwrap_or_default();
    let applied = matches!(job.status.as_str(), "applied" | "interviewing");
    let contact = if known {
        let when = chrono::DateTime::parse_from_rfc3339(&r.last_at).map(|t| t.format("%B %Y").to_string()).unwrap_or_else(|_| "a while ago".into());
        let earlier = if r.roles.is_empty() { "a role".to_string() } else { r.roles.join(", ") };
        format!(
            "name: {}\nrole: {} recruiter at {}\nemail: {}\nnote: They emailed me about {earlier} (last in {when}; it got to: {}). {} \
Ask them, warmly and in a few lines, to put me forward for it, like: \"I applied for {earlier} with you back in {when}. I've {} for this role and I'm really interested: could you put me forward?\" \
Name the earlier role and this one. Don't ask for a call.",
            r.name, if r.kind.is_empty() { "a" } else { &r.kind }, r.company, r.email, if r.stage.is_empty() { "a conversation" } else { &r.stage },
            if applied { "I've just applied for this role." } else { "I'm applying for this role." }, if applied { "just applied" } else { "seen the posting" })
    } else {
        format!(
            "name: {}\nrole: named in the job posting as the contact\nemail: {to}\nnote: I've {} for this role. Write a short email (under 120 words) to say so: \
one line on why I fit, with a real figure from my CV, and ask them to make sure my application reaches the hiring manager. No request for a call.",
            if name.is_empty() { "unknown (start with \"Hello,\")" } else { name }, if applied { "just applied" } else { "applied" })
    };
    let text = crate::cv::humanize(&agent.llm().outreach(&profile.name, &cv, job, &contact)?, &agent.own_words(job, &profile));
    let (subject, body) = match text.trim().strip_prefix("Subject:") {
        Some(rest) => {
            let (s, b) = rest.split_once('\n').unwrap_or((rest, ""));
            (s.trim().to_string(), b.trim().to_string())
        }
        None => (format!("{} at {}", job.title, job.company), text.trim().to_string()),
    };
    let mail = agent.mail.read().unwrap().clone();
    // Your tailored CV goes with a sent email, if you chose that.
    let attach: Vec<std::path::PathBuf> = if agent.secret("apply.recruiter_cv") == "1" {
        job.cv_path.as_deref().map(std::path::PathBuf::from).map(|p| crate::util::pdf_of(&p).unwrap_or(p)).into_iter().collect()
    } else { vec![] };
    let (mut sent, mut drafted) = (false, false);
    if let Some(m) = &mail {
        if send {
            sent = m.send(to, &subject, &body, &attach).is_ok();
        }
        if !sent {
            drafted = m.draft(to, &subject, &body).is_ok();
        }
    }
    if let Some(x) = all.iter_mut().find(|x| x.email == to) {
        x.asked.retain(|a| a.job_id != job.id);
        x.asked.push(Asked { job_id: job.id.clone(), at: now() });
    }
    save(agent, &all)?;
    let _ = agent.db().link_recruiter(to, &job.id, "", &now(), &subject);
    let mut contacts = agent.contacts(&job.id);
    contacts.retain(|c| c["email"].as_str() != Some(to));
    contacts.push(json!({ "name": if name.is_empty() { to } else { name }, "role": format!("{} at {}", if known { "Recruiter" } else { "Contact from the posting" }, r.company),
        "email": to, "link": r.linkedin, "note": if sent { "Emailed when you applied" } else { "Email written when you applied" }, "message": format!("Subject: {subject}\n\n{body}") }));
    agent.save_contacts(&job.id, &contacts)?;
    agent.db().log(Some(&job.id), "recruiter", &format!("{} {}", if sent { "emailed" } else if drafted { "drafted an email to" } else { "wrote an email to" }, if name.is_empty() { to } else { name }))?;
    Ok(json!({ "to": to, "name": name, "subject": subject, "body": body, "sent": sent, "drafted": drafted }))
}

/// Hide a recruiter (not used for matches), or show them again.
pub fn set_hidden(agent: &Agent, email: &str, hidden: bool) -> R<()> {
    let mut all = list(agent);
    let r = all.iter_mut().find(|r| r.email == email.to_lowercase()).ok_or_else(|| Error("That recruiter isn't in the list.".into()))?;
    r.hidden = hidden;
    save(agent, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn people_companies_and_board_names() {
        assert!(looks_personal("jane.smith@maplebank.com") && looks_personal("recruiter.jane@agency.ca"));
        assert!(!looks_personal("no-reply@greenhouse.io") && !looks_personal("careers@maplebank.com") && !looks_personal("jane@hire.lever.co"));
        assert!(!looks_personal("talent+ca@maplebank.com") && !looks_personal("notifications@myworkday.com"));
        assert_eq!(sender("\"Jane Smith\" <Jane.Smith@MapleBank.com>"), ("Jane Smith".into(), "jane.smith@maplebank.com".into()));
        assert_eq!(company_key("Maple Bank of Canada Inc."), "maple bank");
        let r = |c: &str, kind: &str, at: &str| Recruiter { email: format!("{c}@x.com"), company: c.into(), kind: kind.into(), last_at: at.into(), ..Default::default() };
        let list = vec![r("Maple Bank", "in-house", "2026-03-01"), r("Robert Half", "agency", "2026-09-01"), r("Acme", "in-house", "2026-01-01")];
        assert_eq!(for_company(&list, "Maple Bank of Canada").unwrap().company, "Maple Bank");
        assert_eq!(for_company(&list, "MAPLE BANK Ltd").unwrap().company, "Maple Bank");
        assert!(for_company(&list, "Maple Leaf Foods").is_none() && for_company(&list, "Acmeville").is_none());
        assert_eq!(slugs("Maple Bank Inc."), vec!["maplebank".to_string(), "maple-bank".into(), "maple".into()]);
    }
}
