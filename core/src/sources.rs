//! Job sources: Adzuna search and the public job boards of chosen companies (Greenhouse, Lever,
//! Ashby, Workday, SmartRecruiters and Workable). One board failing never stops the others.

use crate::db::Job;
use crate::profile::Profile;
use crate::util::{html_to_text, unescape};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Posting {
    pub source: String,
    pub external_id: String,
    pub company: String,
    pub title: String,
    pub location: String,
    pub url: String,
    pub description: String,
    pub posted_at: Option<String>,
    pub salary: Option<String>,
    pub salary_max: Option<f64>,
    pub remote: bool,
    pub apply_email: Option<String>,
    /// The company's own application page, when the source gives it (Google for Jobs' direct
    /// option, LinkedIn's "Apply on company website").
    pub apply_url: Option<String>,
}

/// Job boards and aggregators: a link to one of these isn't the company's own application page.
pub fn is_job_board(url: &str) -> bool {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default();
    ["linkedin.", "indeed.", "glassdoor.", "ziprecruiter.", "jooble.", "adzuna.", "google.", "monster.", "simplyhired.",
     "talent.com", "workopolis.", "jobbank.gc.ca", "guichetemplois.", "eluta.", "bayt.", "naukri", "gulftalent.", "careerbuilder.",
     "jobs.ca", "dice.com", "wellfound.", "builtin.", "lensa.", "jobrapido.", "careerjet.", "neuvoo.", "seek.", "reed.co.uk", "totaljobs."]
        .iter().any(|b| host.contains(b))
}

impl Posting {
    pub fn id(&self) -> String {
        format!("{}:{}", self.source, self.external_id)
    }

    pub fn to_job(&self) -> Job {
        Job {
            id: self.id(),
            source: self.source.clone(),
            company: self.company.clone(),
            title: self.title.clone(),
            location: self.location.clone(),
            url: self.url.clone(),
            apply_email: self.apply_email.clone(),
            description: self.description.clone(),
            salary: self.salary.clone(),
            posted_at: self.posted_at.clone(),
            // A company's own board (Greenhouse, Workday...) is the application page itself.
            apply_url: self.apply_url.clone().or_else(|| Some(self.url.clone()).filter(|u| u.starts_with("http") && !is_job_board(u))),
            ..Job::default()
        }
    }
}

/// An address the posting asks applications to be sent to, if it names one.
pub fn find_apply_email(text: &str) -> Option<String> {
    static HINT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(send|email|submit)[^.]{0,80}(resume|cv|application)").unwrap());
    static EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\w.+-]+@[\w-]+\.[\w.-]+").unwrap());
    for m in HINT.find_iter(text) {
        let lo = text.floor_char_boundary(m.start().saturating_sub(200));
        let hi = text.ceil_char_boundary((m.end() + 200).min(text.len()));
        if let Some(e) = EMAIL.find(&text[lo..hi]) {
            return Some(e.as_str().trim_end_matches('.').to_string());
        }
    }
    None
}

pub(crate) fn is_remote(parts: &[&str]) -> bool {
    parts.iter().any(|p| p.to_lowercase().contains("remote"))
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn id_str(v: &Value) -> String {
    match v.get("id") {
        Some(Value::String(x)) => x.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

pub fn fmt_salary(lo: Option<f64>, hi: Option<f64>, cur: &str) -> Option<String> {
    let f = |x: f64| {
        let n = x.round() as i64;
        let s = n.abs().to_string();
        let mut out = String::new();
        for (i, c) in s.chars().enumerate() {
            if i > 0 && (s.len() - i) % 3 == 0 {
                out.push(',');
            }
            out.push(c);
        }
        out
    };
    match (lo.filter(|x| *x > 0.0), hi.filter(|x| *x > 0.0)) {
        (Some(a), Some(b)) if a != b => Some(format!("{cur} {}–{}", f(a), f(b)).trim().to_string()),
        (Some(a), _) | (None, Some(a)) => Some(format!("{cur} {}", f(a)).trim().to_string()),
        _ => None,
    }
}

/// The pay a posting states in its text, e.g. "$110,000 – $135,000 per year" or "CA$95K–120K":
/// (what to show, the yearly maximum when it's a yearly range). Ontario and several other places
/// require advertised jobs to state pay, so many postings without a salary field have one here.
pub fn salary_from_text(text: &str) -> Option<(String, Option<f64>)> {
    static RANGE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)(?:CA\$|C\$|CAD\s*\$?|US\$|USD\s*\$?|\$)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?(?:\s*(?:CAD|USD))?\s*(?:-|–|—|to)\s*(?:CA\$|C\$|CAD\s*\$?|US\$|USD\s*\$?|\$)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?(?:\s*(?:CAD|USD))?([^.\n]{0,40})").unwrap()
    });
    let num = |n: &str, k: bool| n.replace(',', "").parse::<f64>().ok().map(|v| if k { v * 1000.0 } else { v });
    for c in RANGE.captures_iter(text) {
        let k_hi = c.get(4).is_some();
        let k_lo = c.get(2).is_some() || (k_hi && !c[1].contains(','));
        let (Some(lo), Some(hi)) = (num(&c[1], k_lo), num(&c[3], k_hi)) else { continue };
        if hi < lo {
            continue;
        }
        let after = c.get(5).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
        let fmt = |x: f64| fmt_salary(Some(x), None, "").unwrap_or_default();
        if hi >= 20_000.0 && hi <= 2_000_000.0 && lo >= 10_000.0 {
            return Some((format!("${}–${}", fmt(lo), fmt(hi)), Some(hi)));
        }
        if hi < 500.0 && (after.contains("hour") || after.contains("/hr") || after.contains("hr")) {
            return Some((format!("${}–${}/hour", lo, hi), None));
        }
    }
    other_currency(text)
}

/// Pay in other currencies, before or after the numbers: "KWD 800 – 1,200 per month", "£45,000 - £55,000",
/// "AED 15k-20k monthly". Monthly pay counts twelve times for the yearly maximum.
fn other_currency(text: &str) -> Option<(String, Option<f64>)> {
    const CUR: &str = r"(KWD|KD|AED|SAR|QAR|BHD|OMR|EGP|JOD|GBP|EUR|CHF|AUD|NZD|SGD|INR|ZAR|£|€)";
    static RANGE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(r"(?i)(?:{CUR}\s?)?(\d{{1,3}}(?:,\d{{3}})+|\d+(?:\.\d+)?)\s?(k)?\s*(?:-|–|—|to)\s*(?:{CUR}\s?)?(\d{{1,3}}(?:,\d{{3}})+|\d+(?:\.\d+)?)\s?(k)?\s*{CUR}?([^.\n]{{0,30}})")).unwrap()
    });
    let num = |n: &str, k: bool| n.replace(',', "").parse::<f64>().ok().map(|v| if k { v * 1000.0 } else { v });
    for c in RANGE.captures_iter(text) {
        let Some(cur) = c.get(1).or(c.get(4)).or(c.get(7)).map(|m| m.as_str().to_uppercase()) else { continue };
        let cur = match cur.as_str() { "KD" => "KWD".to_string(), _ => cur };
        let (k_lo, k_hi) = (c.get(3).is_some() || c.get(6).is_some(), c.get(6).is_some());
        let (Some(lo), Some(hi)) = (num(&c[2], k_lo), num(&c[5], k_hi)) else { continue };
        if hi < lo || hi < 100.0 {
            continue;
        }
        let after = c.get(8).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
        let monthly = after.contains("month") || after.contains("/mo") || after.contains("p.m");
        let fmt = |x: f64| fmt_salary(Some(x), None, "").unwrap_or_default();
        let shown = if cur.chars().count() == 1 { format!("{cur}{}–{cur}{}", fmt(lo), fmt(hi)) } else { format!("{cur} {}–{}", fmt(lo), fmt(hi)) };
        if monthly {
            return Some((format!("{shown}/month"), Some(hi * 12.0)));
        }
        if hi >= 10_000.0 {
            return Some((shown, Some(hi)));
        }
    }
    None
}

/// A yearly pay range from a salary as shown ("$110,000–$135,000", "CAD 120K–150K", "$95,000"),
/// or None for hourly rates and text without a yearly amount.
pub fn salary_range(text: &str) -> Option<(f64, f64)> {
    static NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?\b").unwrap());
    let t = text.to_lowercase();
    if t.contains("hour") || t.contains("/hr") || t.contains(" hr") {
        return None;
    }
    let k_all = t.contains('k') && !t.contains(',');
    let nums: Vec<f64> = NUM.captures_iter(&t)
        .filter_map(|c| {
            let v = c[1].replace(',', "").parse::<f64>().ok()?;
            Some(if c.get(2).is_some() || (k_all && v < 1000.0) { v * 1000.0 } else { v })
        })
        .filter(|v| (10_000.0..=2_000_000.0).contains(v))
        .take(2)
        .collect();
    match nums.as_slice() {
        [a] => Some((*a, *a)),
        [a, b] => Some((a.min(*b), a.max(*b))),
        _ => None,
    }
}

/// The last day to apply, when the posting says so ("Apply by October 31, 2026", "Closing date:
/// 2026-10-31", "Applications close 31 Oct"). Dates without a year are this year or next; only
/// dates from a week ago to a year ahead count.
pub fn deadline_from_text(text: &str, today: chrono::NaiveDate) -> Option<chrono::NaiveDate> {
    use chrono::{Datelike, NaiveDate};
    static KEY: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)(apply by|apply before|applications? (?:close|due|deadline)|closing date|closes on|close date|posting (?:end|close)s?(?: date)?|deadline(?: to apply| for applications)?|accepting applications until|open until)").unwrap()
    });
    static ISO: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(20\d\d)-(\d{1,2})-(\d{1,2})\b").unwrap());
    static MDY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?").unwrap());
    static DMY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?(?:\s+(20\d\d))?").unwrap());
    let month = |m: &str| ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].iter().position(|x| m.to_lowercase().starts_with(x)).map(|i| i as u32 + 1);
    let fits = |d: NaiveDate| d >= today - chrono::Duration::days(7) && d <= today + chrono::Duration::days(365);
    let with_year = |y: Option<i32>, m: u32, d: u32| -> Option<NaiveDate> {
        match y {
            Some(y) => NaiveDate::from_ymd_opt(y, m, d),
            None => {
                let this = NaiveDate::from_ymd_opt(today.year(), m, d)?;
                if this < today - chrono::Duration::days(30) { NaiveDate::from_ymd_opt(today.year() + 1, m, d) } else { Some(this) }
            }
        }
    };
    for k in KEY.find_iter(text) {
        let hi = text.ceil_char_boundary((k.end() + 60).min(text.len()));
        let near = &text[k.end()..hi];
        let found = ISO.captures(near).and_then(|c| NaiveDate::from_ymd_opt(c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?))
            .or_else(|| MDY.captures(near).and_then(|c| with_year(c.get(3).and_then(|y| y.as_str().parse().ok()), month(&c[1])?, c[2].parse().ok()?)))
            .or_else(|| DMY.captures(near).and_then(|c| with_year(c.get(3).and_then(|y| y.as_str().parse().ok()), month(&c[2])?, c[1].parse().ok()?)));
        if let Some(d) = found.filter(|d| fits(*d)) {
            return Some(d);
        }
    }
    None
}

// --- parsers (pure, tested with sample responses) -------------------------------------------

/// https://developers.greenhouse.io/job-board.html
pub fn parse_greenhouse(token: &str, body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("jobs").and_then(|x| x.as_array()).into_iter().flatten() {
        let desc = html_to_text(&s(j, "content"));
        let loc = j.get("location").map(|l| s(l, "name")).unwrap_or_default();
        let company = s(j, "company_name");
        out.push(Posting {
            source: "greenhouse".into(),
            external_id: format!("{token}-{}", id_str(j)),
            company: if company.is_empty() { token.to_string() } else { company },
            title: s(j, "title").trim().to_string(),
            remote: is_remote(&[&loc]),
            location: loc,
            url: s(j, "absolute_url"),
            apply_email: find_apply_email(&desc),
            description: desc,
            posted_at: Some(s(j, "updated_at")).filter(|x| !x.is_empty()),
            ..Posting::default()
        });
    }
    out
}

/// https://github.com/lever/postings-api
pub fn parse_lever(company: &str, body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.as_array().into_iter().flatten() {
        let cats = j.get("categories").cloned().unwrap_or(Value::Null);
        let mut loc = s(&cats, "location");
        if loc.is_empty() {
            loc = cats.get("allLocations").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        }
        let sections: Vec<String> = j.get("lists").and_then(|x| x.as_array()).into_iter().flatten()
            .map(|l| format!("{}\n{}", s(l, "text"), html_to_text(&s(l, "content"))))
            .collect();
        let desc = [s(j, "descriptionPlain"), sections.join("\n\n"), s(j, "additionalPlain")]
            .into_iter().filter(|x| !x.trim().is_empty()).collect::<Vec<_>>().join("\n\n");
        let sal = j.get("salaryRange").cloned().unwrap_or(Value::Null);
        let (lo, hi) = (sal.get("min").and_then(|x| x.as_f64()), sal.get("max").and_then(|x| x.as_f64()));
        let created = j.get("createdAt").and_then(|x| x.as_i64())
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        out.push(Posting {
            apply_url: None,
            source: "lever".into(),
            external_id: format!("{company}-{}", id_str(j)),
            company: company.to_string(),
            title: s(j, "text").trim().to_string(),
            remote: s(j, "workplaceType") == "remote" || is_remote(&[&loc]),
            location: loc,
            url: s(j, "hostedUrl"),
            apply_email: find_apply_email(&desc),
            description: desc.trim().to_string(),
            posted_at: created,
            salary: fmt_salary(lo, hi, &s(&sal, "currency")),
            salary_max: hi,
        });
    }
    out
}

/// https://developers.ashbyhq.com/docs/public-job-posting-api
pub fn parse_ashby(board: &str, body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("jobs").and_then(|x| x.as_array()).into_iter().flatten() {
        if j.get("isListed") == Some(&Value::Bool(false)) {
            continue;
        }
        let mut desc = s(j, "descriptionPlain");
        if desc.is_empty() {
            desc = html_to_text(&s(j, "descriptionHtml"));
        }
        let loc = s(j, "location");
        let url = Some(s(j, "jobUrl")).filter(|x| !x.is_empty()).unwrap_or_else(|| s(j, "applyUrl"));
        out.push(Posting {
            apply_url: None,
            source: "ashby".into(),
            external_id: format!("{board}-{}", id_str(j)),
            company: board.to_string(),
            title: s(j, "title").trim().to_string(),
            remote: j.get("isRemote") == Some(&Value::Bool(true)) || s(j, "workplaceType") == "Remote" || is_remote(&[&loc]),
            location: loc,
            url,
            apply_email: find_apply_email(&desc),
            description: desc,
            posted_at: Some(s(j, "publishedAt")).filter(|x| !x.is_empty()),
            salary: j.get("compensation").map(|c| s(c, "compensationTierSummary")).filter(|x| !x.is_empty()),
            salary_max: None,
        });
    }
    out
}

/// https://developer.adzuna.com/docs/search
pub fn parse_adzuna(body: &Value, currency: &str) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("results").and_then(|x| x.as_array()).into_iter().flatten() {
        let loc = j.get("location").map(|l| s(l, "display_name")).unwrap_or_default();
        let desc = html_to_text(&s(j, "description"));
        let title = html_to_text(&s(j, "title"));
        let (lo, hi) = (j.get("salary_min").and_then(|x| x.as_f64()), j.get("salary_max").and_then(|x| x.as_f64()));
        let company = j.get("company").map(|c| s(c, "display_name")).filter(|x| !x.is_empty()).unwrap_or_else(|| "Unknown".into());
        let head: String = desc.chars().take(300).collect();
        out.push(Posting {
            apply_url: None,
            source: "adzuna".into(),
            external_id: id_str(j).trim_matches('"').to_string(),
            company: unescape(&company),
            remote: is_remote(&[&loc, &title, &head]),
            title,
            location: loc,
            url: s(j, "redirect_url"),
            apply_email: find_apply_email(&desc),
            description: desc,
            posted_at: Some(s(j, "created")).filter(|x| !x.is_empty()),
            salary: fmt_salary(lo, hi, currency),
            salary_max: hi,
        });
    }
    out
}

/// A Workday careers site, from its link: https://<tenant>.wd3.myworkdayjobs.com/<locale>/<site>.
#[derive(Clone, Debug, PartialEq)]
pub struct WorkdayBoard {
    pub host: String,
    pub tenant: String,
    pub site: String,
}

impl WorkdayBoard {
    fn api(&self) -> String {
        format!("https://{}/wday/cxs/{}/{}", self.host, self.tenant, self.site)
    }
}

pub fn workday_board(link: &str) -> Option<WorkdayBoard> {
    let s = link.trim();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let (host, path) = s.split_once('/')?;
    let host = host.to_lowercase();
    if !host.ends_with(".myworkdayjobs.com") {
        return None;
    }
    let locale = |x: &str| x.len() == 5 && x.as_bytes()[2] == b'-' && x.chars().filter(|c| *c != '-').all(|c| c.is_ascii_alphabetic());
    let site = path.split(['/', '?', '#']).find(|x| !x.is_empty() && !locale(x))?.to_string();
    let tenant = host.split('.').next()?.to_string();
    Some(WorkdayBoard { host, tenant, site })
}

/// A Workday search page: (title, path of the job, locations) per posting, and the total.
pub fn parse_workday_list(body: &Value) -> (Vec<(String, String, String)>, u64) {
    let list = body.get("jobPostings").and_then(|x| x.as_array()).into_iter().flatten()
        .map(|j| (s(j, "title").trim().to_string(), s(j, "externalPath"), s(j, "locationsText")))
        .filter(|(t, p, _)| !t.is_empty() && !p.is_empty())
        .collect();
    (list, body.get("total").and_then(|x| x.as_u64()).unwrap_or(0))
}

fn workday_posting(b: &WorkdayBoard, path: &str, title: &str, location: &str) -> Posting {
    let tail = path.rsplit('/').next().unwrap_or(path);
    Posting {
        source: "workday".into(),
        external_id: format!("{}-{}", b.tenant, tail),
        company: b.tenant.clone(),
        title: title.to_string(),
        remote: is_remote(&[location]),
        location: location.to_string(),
        url: format!("https://{}/{}{}", b.host, b.site, path),
        description: format!("{title}. (Open the posting for the full description.)"),
        ..Posting::default()
    }
}

/// A company name without the internal code some Workday sites put first ("USA018 Thomson
/// Reuters Holdings Inc." is "Thomson Reuters Holdings Inc.").
pub fn tidy_company(name: &str) -> String {
    let name = name.trim();
    match name.split_once(' ') {
        Some((code, rest)) if crate::db::is_company_code(code) && !rest.trim().is_empty() => rest.trim().to_string(),
        _ => name.to_string(),
    }
}

/// One Workday posting in full.
pub fn parse_workday_job(b: &WorkdayBoard, path: &str, body: &Value) -> Option<Posting> {
    let info = body.get("jobPostingInfo")?;
    let title = s(info, "title").trim().to_string();
    if title.is_empty() {
        return None;
    }
    let mut places = vec![s(info, "location")];
    places.extend(info.get("additionalLocations").and_then(|x| x.as_array()).into_iter().flatten().filter_map(|x| x.as_str()).map(String::from));
    let location = places.into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("; ");
    let desc = html_to_text(&s(info, "jobDescription"));
    let company = body.get("hiringOrganization").map(|o| s(o, "name")).filter(|x| !x.is_empty()).map(|n| tidy_company(&n)).unwrap_or_else(|| b.tenant.clone());
    let mut p = workday_posting(b, path, &title, &location);
    p.company = company;
    p.remote = is_remote(&[&location, &s(info, "remoteType")]);
    if let Some(u) = Some(s(info, "externalUrl")).filter(|u| u.starts_with("http")) {
        p.url = u;
    }
    p.posted_at = Some(s(info, "startDate")).filter(|x| !x.is_empty()).or_else(|| Some(s(info, "postedOn")).filter(|x| !x.is_empty()));
    p.apply_email = find_apply_email(&desc);
    p.description = desc;
    Some(p)
}

/// https://dev.smartrecruiters.com/customer-api/posting-api/ — the list (no descriptions).
pub fn parse_smartrecruiters(company: &str, body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("content").and_then(|x| x.as_array()).into_iter().flatten() {
        let loc = j.get("location").cloned().unwrap_or(Value::Null);
        let mut place = s(&loc, "fullLocation");
        if place.is_empty() {
            place = [s(&loc, "city"), s(&loc, "region"), s(&loc, "country").to_uppercase()].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ");
        }
        let id = id_str(j);
        let title = s(j, "name").trim().to_string();
        let name = j.get("company").map(|c| s(c, "name")).filter(|x| !x.is_empty()).unwrap_or_else(|| company.to_string());
        out.push(Posting {
            source: "smartrecruiters".into(),
            external_id: format!("{company}-{id}"),
            company: name,
            remote: loc.get("remote") == Some(&Value::Bool(true)) || is_remote(&[&place]),
            location: place,
            url: format!("https://jobs.smartrecruiters.com/{company}/{id}"),
            description: format!("{title}. (Open the posting for the full description.)"),
            title,
            posted_at: Some(s(j, "releasedDate")).filter(|x| !x.is_empty()),
            ..Posting::default()
        });
    }
    out
}

/// A SmartRecruiters posting's full text and its public link.
pub fn smartrecruiters_details(body: &Value) -> (String, Option<String>) {
    let sections = body.pointer("/jobAd/sections").cloned().unwrap_or(Value::Null);
    let text = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"].iter()
        .filter_map(|k| sections.get(*k))
        .map(|sec| format!("{}\n{}", s(sec, "title"), html_to_text(&s(sec, "text"))).trim().to_string())
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    (text, Some(s(body, "postingUrl")).filter(|u| u.starts_with("http")))
}

/// https://help.workable.com/hc/en-us/articles/115012771647 — the account's public jobs widget.
pub fn parse_workable(account: &str, body: &Value) -> Vec<Posting> {
    let company = Some(s(body, "name")).filter(|x| !x.is_empty()).unwrap_or_else(|| account.to_string());
    let mut out = vec![];
    for j in body.get("jobs").and_then(|x| x.as_array()).into_iter().flatten() {
        let place = [s(j, "city"), s(j, "state"), s(j, "country")].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ");
        let desc = html_to_text(&[s(j, "description"), s(j, "requirements"), s(j, "benefits")].join("\n"));
        let code = Some(s(j, "shortcode")).filter(|x| !x.is_empty()).unwrap_or_else(|| id_str(j));
        out.push(Posting {
            source: "workable".into(),
            external_id: format!("{account}-{code}"),
            company: company.clone(),
            title: s(j, "title").trim().to_string(),
            remote: j.get("telecommuting") == Some(&Value::Bool(true)) || is_remote(&[&place]),
            location: place,
            url: Some(s(j, "url")).filter(|u| u.starts_with("http")).unwrap_or_else(|| format!("https://apply.workable.com/{account}/j/{code}/")),
            apply_email: find_apply_email(&desc),
            description: desc.trim().to_string(),
            posted_at: Some(s(j, "published_on")).filter(|x| !x.is_empty()),
            ..Posting::default()
        });
    }
    out
}

/// Whether a posting title is one of your CVs' kinds of role: a target title or a keyword in it.
pub fn wanted(p: &Profile, title: &str) -> bool {
    let t = title.to_lowercase();
    p.tracks.iter().any(|tr| {
        tr.titles.iter().any(|x| crate::filters::title_matches(title, x))
            || tr.keywords.iter().any(|k| !k.trim().is_empty() && t.contains(&k.trim().to_lowercase()))
    })
}

// --- is the posting still open? -----------------------------------------------------------------

/// Words job sites show on a posting that has closed.
const CLOSED: &[&str] = &[
    "no longer accepting applications",
    "this job has expired",
    "job posting has expired",
    "this job is no longer available",
    "job is no longer available",
    "this position has been filled",
    "position is no longer available",
    "this position is no longer open",
    "this posting has closed",
    "this job posting has closed",
    "the job you are looking for is no longer",
    "the job you're looking for is no longer",
    "this job is closed",
    "this job has been closed",
    "job no longer exists",
    "no longer open for applications",
    "this requisition is no longer",
];

/// What a posting's page says: Some(true) closed, Some(false) open, None can't tell (blocked, down).
pub fn closed_by_page(status: u16, final_url: &str, body: &str) -> Option<bool> {
    match status {
        404 | 410 => return Some(true),
        200..=299 => {}
        _ => return None,
    }
    // Greenhouse sends the link of a closed job back to the company's board.
    if final_url.contains("error=true") {
        return Some(true);
    }
    let low: String = body.chars().take(800_000).collect::<String>().to_lowercase();
    Some(CLOSED.iter().any(|p| low.contains(p)))
}

/// The Workday data address of a Workday posting link, to ask it directly.
fn workday_job_api(url: &str) -> Option<String> {
    let b = workday_board(url)?;
    let path = url.split_once("/job/").map(|(_, rest)| format!("/job/{rest}"))?;
    Some(format!("{}{}", b.api(), path.split(['?', '#']).next().unwrap_or("")))
}

/// Whether a posting has closed, by looking at it. None when it can't be told.
pub fn posting_closed(url: &str) -> Option<bool> {
    if cfg!(test) || !url.starts_with("http") {
        return None;
    }
    let c = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
        .build()
        .ok()?;
    if let Some(api) = workday_job_api(url) {
        let r = c.get(&api).header("Accept", "application/json").send().ok()?;
        return match r.status().as_u16() {
            404 | 410 => Some(true),
            200 => {
                let v: Value = r.json().ok()?;
                let info = v.get("jobPostingInfo")?;
                Some(info.get("canApply") == Some(&Value::Bool(false)))
            }
            _ => None,
        };
    }
    let r = c.get(url).send().ok()?;
    let status = r.status().as_u16();
    let final_url = r.url().to_string();
    let body = if (200..300).contains(&status) { r.text().unwrap_or_default() } else { String::new() };
    closed_by_page(status, &final_url, &body)
}

// --- fetching -----------------------------------------------------------------------------------

pub fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("JobHunt/1.0 (personal job search assistant)")
        .build()
        .expect("http client")
}

fn get_json(client: &reqwest::blocking::Client, url: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let r = client.get(url).query(query).send().map_err(|e| format!("couldn't connect ({e})"))?;
    let status = r.status();
    if status.as_u16() == 404 {
        return Err("not found (board name wrong or removed?)".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    r.json::<Value>().map_err(|e| format!("unexpected response ({e})"))
}

fn post_json(client: &reqwest::blocking::Client, url: &str, body: &Value) -> Result<Value, String> {
    let r = client.post(url).header("Accept", "application/json").json(body).send().map_err(|e| format!("couldn't connect ({e})"))?;
    let status = r.status();
    if status.as_u16() == 404 || status.as_u16() == 422 {
        return Err("not found (check the careers link)".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    r.json::<Value>().map_err(|e| format!("unexpected response ({e})"))
}

/// Postings read in full per board, at most; the rest keep a one-line description.
const DETAILS_PER_BOARD: usize = 40;

/// A Workday site, searched for each of your job titles (Workday has no list of everything).
pub fn workday(c: &reqwest::blocking::Client, link: &str, titles: &[String], wanted: &dyn Fn(&str) -> bool) -> Result<Vec<Posting>, String> {
    let b = workday_board(link).ok_or("isn't a Workday careers link like https://company.wd3.myworkdayjobs.com/Careers")?;
    let mut found: Vec<(String, String, String)> = vec![];
    let searches: Vec<&str> = if titles.is_empty() { vec![""] } else { titles.iter().take(8).map(|t| t.as_str()).collect() };
    for q in searches {
        for page in 0..2u64 {
            let body = serde_json::json!({ "appliedFacets": {}, "limit": 20, "offset": page * 20, "searchText": q });
            let (list, total) = parse_workday_list(&post_json(c, &format!("{}/jobs", b.api()), &body)?);
            let n = list.len();
            for item in list {
                if !found.iter().any(|f| f.1 == item.1) {
                    found.push(item);
                }
            }
            if n < 20 || (page + 1) * 20 >= total {
                break;
            }
        }
    }
    // Read the likeliest ones in full first.
    found.sort_by_key(|(t, _, _)| !wanted(t));
    let mut out = vec![];
    for (i, (title, path, loc)) in found.into_iter().enumerate() {
        let full = if i < DETAILS_PER_BOARD {
            get_json(c, &format!("{}{}", b.api(), path), &[]).ok().and_then(|v| parse_workday_job(&b, &path, &v))
        } else {
            None
        };
        out.push(full.unwrap_or_else(|| workday_posting(&b, &path, &title, &loc)));
    }
    Ok(out)
}

/// A SmartRecruiters company: every posting, with the matching ones read in full. The flag says
/// whether the list was complete.
pub fn smartrecruiters(c: &reqwest::blocking::Client, company: &str, wanted: &dyn Fn(&str) -> bool) -> Result<(Vec<Posting>, bool), String> {
    let base = format!("https://api.smartrecruiters.com/v1/companies/{company}/postings");
    let mut out: Vec<Posting> = vec![];
    let mut complete = false;
    for page in 0..5usize {
        let v = get_json(c, &base, &[("limit", "100".into()), ("offset", (page * 100).to_string())])?;
        let list = parse_smartrecruiters(company, &v);
        let total = v.get("totalFound").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
        let n = list.len();
        out.extend(list);
        if n < 100 || out.len() >= total {
            complete = true;
            break;
        }
    }
    let mut read = 0;
    for p in out.iter_mut() {
        if read >= DETAILS_PER_BOARD || !wanted(&p.title) {
            continue;
        }
        let id = p.external_id.trim_start_matches(&format!("{company}-")).to_string();
        if let Ok(v) = get_json(c, &format!("{base}/{id}"), &[]) {
            let (text, url) = smartrecruiters_details(&v);
            if !text.is_empty() {
                p.apply_email = find_apply_email(&text);
                p.description = text;
            }
            if let Some(u) = url {
                p.url = u;
            }
        }
        read += 1;
    }
    Ok((out, complete))
}

pub fn workable(c: &reqwest::blocking::Client, account: &str) -> Result<Vec<Posting>, String> {
    let v = get_json(c, &format!("https://apply.workable.com/api/v1/widget/accounts/{account}"), &[("details", "true".into())])?;
    Ok(parse_workable(account, &v))
}

pub fn greenhouse(c: &reqwest::blocking::Client, token: &str) -> Result<Vec<Posting>, String> {
    let v = get_json(c, &format!("https://boards-api.greenhouse.io/v1/boards/{token}/jobs"), &[("content", "true".into())])?;
    Ok(parse_greenhouse(token, &v))
}

pub fn lever(c: &reqwest::blocking::Client, company: &str) -> Result<Vec<Posting>, String> {
    let v = get_json(c, &format!("https://api.lever.co/v0/postings/{company}"), &[("mode", "json".into())])?;
    Ok(parse_lever(company, &v))
}

pub fn ashby(c: &reqwest::blocking::Client, board: &str) -> Result<Vec<Posting>, String> {
    let v = get_json(c, &format!("https://api.ashbyhq.com/posting-api/job-board/{board}"), &[("includeCompensation", "true".into())])?;
    Ok(parse_ashby(board, &v))
}

/// How far around a place the job-search services look, in km: enough to take in a city's suburbs
/// (Toronto's reaches Mississauga, Markham, Vaughan and Oakville).
pub const RADIUS_KM: u32 = 50;

/// The countries Adzuna covers, with their currency.
pub const ADZUNA_COUNTRIES: &[(&str, &str)] = &[
    ("at", "EUR"), ("au", "AUD"), ("be", "EUR"), ("br", "BRL"), ("ca", "CAD"), ("ch", "CHF"), ("de", "EUR"), ("es", "EUR"), ("fr", "EUR"),
    ("gb", "GBP"), ("in", "INR"), ("it", "EUR"), ("mx", "MXN"), ("nl", "EUR"), ("nz", "NZD"), ("pl", "PLN"), ("sg", "SGD"), ("us", "USD"), ("za", "ZAR"),
];

/// Adzuna's currency for a country it covers, or None where it doesn't search.
pub fn adzuna_currency(country: &str) -> Option<&'static str> {
    ADZUNA_COUNTRIES.iter().find(|c| c.0 == country.to_lowercase()).map(|c| c.1)
}

pub fn adzuna(c: &reqwest::blocking::Client, id: &str, key: &str, country: &str, what: &str, where_: &str, days: u32) -> Result<Vec<Posting>, String> {
    let currency = adzuna_currency(country).ok_or_else(|| format!("Adzuna doesn't search in {}", crate::profile::country_name(country)))?;
    let mut out = vec![];
    for page in 1..=2 {
        let mut params: Vec<(&str, String)> = vec![
            ("app_id", id.into()),
            ("app_key", key.into()),
            ("what_phrase", what.into()),
            ("max_days_old", days.to_string()),
            ("results_per_page", "50".into()),
            ("content-type", "application/json".into()),
        ];
        if !where_.is_empty() {
            // Adzuna's default is 5 km, which misses most of a city's suburbs.
            params.extend([("where", where_.to_string()), ("distance", RADIUS_KM.to_string())]);
        }
        let v = get_json(c, &format!("https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"), &params)?;
        let found = parse_adzuna(&v, currency);
        let n = found.len();
        out.extend(found);
        if n < 50 {
            break;
        }
    }
    Ok(out)
}

// --- JSearch (Google for Jobs) and Jooble ----------------------------------------------------------

/// Keys for the paid or keyed job-search services, from Settings > Connections.
#[derive(Clone, Debug, Default)]
pub struct Keys {
    /// Adzuna: (app id, key).
    pub adzuna: Option<(String, String)>,
    /// JSearch: (where the key is from: "openwebninja" or "rapidapi", key).
    pub jsearch: Option<(String, String)>,
    /// Jooble: key.
    pub jooble: Option<String>,
    /// Apify: (API token, the LinkedIn jobs scraper to run, as "user/actor").
    pub apify: Option<(String, String)>,
}

// --- LinkedIn ---------------------------------------------------------------------------------------

/// The scraper run on Apify when none is chosen. It takes LinkedIn job-search links.
pub const APIFY_ACTOR: &str = "curious_coder/linkedin-jobs-scraper";

/// LinkedIn's job search as anyone can see it without signing in: (title, place, remote only).
/// Your titles in your places, and with remote roles allowed, the first two titles across your country.
pub fn linkedin_searches(p: &Profile, max: usize) -> Vec<(String, String, bool)> {
    let mut out: Vec<(String, String, bool)> = searches(p, max).into_iter().map(|(t, w)| (t, w, false)).collect();
    if p.remote_ok {
        let titles: Vec<String> = out.iter().map(|x| x.0.clone()).fold(vec![], |mut v, t| { if !v.contains(&t) { v.push(t) } v });
        let country = p.country();
        out.extend(titles.into_iter().take(2).map(|t| (t, country.clone(), true)));
    }
    out
}

/// The address of a LinkedIn job search for the last week.
pub fn linkedin_search_url(title: &str, place: &str, remote: bool) -> String {
    let mut u = url::Url::parse("https://www.linkedin.com/jobs/search/").unwrap();
    u.query_pairs_mut().append_pair("keywords", title).append_pair("location", place).append_pair("f_TPR", "r604800");
    if remote {
        u.query_pairs_mut().append_pair("f_WT", "2");
    }
    u.to_string()
}

/// A browser's way of asking: LinkedIn turns away requests that don't look like one.
fn linkedin_get(c: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let r = c.get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en;q=0.9")
        .send().map_err(|e| format!("couldn't connect ({e})"))?;
    match r.status().as_u16() {
        200 => r.text().map_err(|e| format!("unreadable page ({e})")),
        429 | 999 => Err("LinkedIn is limiting requests from this connection for now; the next search tries again".into()),
        404 => Err("not found".into()),
        s => Err(format!("HTTP {s}")),
    }
}

fn first(re: &Regex, text: &str) -> String {
    re.captures(text).and_then(|c| c.get(1)).map(|m| html_to_text(m.as_str()).trim().to_string()).unwrap_or_default()
}

/// The postings in a page of LinkedIn's signed-out job search. Descriptions are filled in later,
/// only for postings that are new (see linkedin_details).
pub fn parse_linkedin_list(html: &str) -> Vec<Posting> {
    static CARD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<li[^>]*>(.*?)</li>").unwrap());
    static URN: Lazy<Regex> = Lazy::new(|| Regex::new(r"jobPosting:(\d{6,})").unwrap());
    static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<h3[^>]*base-search-card__title[^>]*>(.*?)</h3>"#).unwrap());
    static COMPANY: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<h4[^>]*base-search-card__subtitle[^>]*>(.*?)</h4>"#).unwrap());
    static PLACE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*job-search-card__location[^>]*>(.*?)</span>"#).unwrap());
    static DATE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<time[^>]*datetime="([0-9-]{10})""#).unwrap());
    static LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r#"href="(https://[a-z.]*linkedin\.com/jobs/view/[^"?]+)"#).unwrap());
    static PAY: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*job-search-card__salary-info[^>]*>(.*?)</span>"#).unwrap());
    static LINK_ID: Lazy<Regex> = Lazy::new(|| Regex::new(r"-(\d{6,})/?$").unwrap());
    let mut out = vec![];
    for c in CARD.captures_iter(html) {
        let card = &c[1];
        let title = first(&TITLE, card);
        let link = LINK.captures(card).map(|m| m[1].to_string()).unwrap_or_default();
        let id = URN.captures(card).map(|m| m[1].to_string())
            .or_else(|| LINK_ID.captures(&link).map(|m| m[1].to_string()))
            .unwrap_or_default();
        if title.is_empty() || id.is_empty() {
            continue;
        }
        let place = first(&PLACE, card);
        let salary = Some(first(&PAY, card)).filter(|x| !x.is_empty());
        out.push(Posting {
            source: "linkedin".into(),
            external_id: id.clone(),
            company: Some(first(&COMPANY, card)).filter(|x| !x.is_empty()).unwrap_or_else(|| "Unknown".into()),
            remote: is_remote(&[&place, &title]),
            title,
            location: place,
            url: format!("https://www.linkedin.com/jobs/view/{id}/"),
            posted_at: DATE.captures(card).map(|m| m[1].to_string()),
            salary_max: salary.as_deref().and_then(salary_range).map(|r| r.1),
            salary,
            ..Posting::default()
        });
    }
    out
}

/// A LinkedIn posting's full description, from its signed-out page.
pub fn parse_linkedin_posting(html: &str) -> Option<String> {
    static BODY: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<div[^>]*show-more-less-html__markup[^>]*>(.*?)</div>"#).unwrap());
    static CRIT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<h3[^>]*description__job-criteria-subheader[^>]*>(.*?)</h3>\s*<span[^>]*>(.*?)</span>"#).unwrap());
    let body = BODY.captures(html).map(|m| html_to_text(&m[1]).trim().to_string()).filter(|b| b.len() > 40)?;
    let crit: Vec<String> = CRIT.captures_iter(html)
        .map(|m| format!("{}: {}", html_to_text(&m[1]).trim(), html_to_text(&m[2]).trim()))
        .collect();
    Some(if crit.is_empty() { body } else { format!("{body}\n\n{}", crit.join("\n")) })
}

/// One search on LinkedIn's signed-out job search: the first page (up to 25 postings), newest first.
pub fn linkedin(c: &reqwest::blocking::Client, title: &str, place: &str, remote: bool) -> Result<Vec<Posting>, String> {
    // Spaced out, like someone paging through results.
    std::thread::sleep(Duration::from_millis(1500));
    let mut u = url::Url::parse("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search").unwrap();
    u.query_pairs_mut().append_pair("keywords", title).append_pair("location", place).append_pair("f_TPR", "r604800").append_pair("sortBy", "DD").append_pair("start", "0");
    if remote {
        u.query_pairs_mut().append_pair("f_WT", "2");
    }
    let html = linkedin_get(c, u.as_str())?;
    let mut list = parse_linkedin_list(&html);
    if list.is_empty() && (html.contains("authwall") || html.contains("challenge")) {
        return Err("LinkedIn is limiting requests from this connection for now (it asked to sign in); the next search tries again".into());
    }
    // A remote-only search: these are remote, though the card may just name the country.
    if remote {
        for p in &mut list {
            p.remote = true;
        }
    }
    Ok(list)
}

/// The company's own application page from a LinkedIn posting that says "Apply on company website":
/// LinkedIn keeps it, wrapped in its own redirect, in a hidden element.
pub fn linkedin_offsite_apply(html: &str) -> Option<String> {
    static APPLY: Lazy<Regex> = Lazy::new(|| Regex::new(r#"id="applyUrl"[^>]*>\s*<!--\s*"([^"]+)""#).unwrap());
    let raw = APPLY.captures(html)?.get(1)?.as_str().replace("&amp;", "&");
    let u = url::Url::parse(&raw).ok()?;
    let target = u.query_pairs().find(|(k, _)| k == "url").map(|(_, v)| v.to_string()).unwrap_or(raw);
    Some(target).filter(|t| t.starts_with("http") && !is_job_board(t))
}

/// A LinkedIn job's number from any link to it: /jobs/view/<id> (with or without a title in front),
/// or a search or collection page with currentJobId=<id>.
pub fn linkedin_job_id(link: &str) -> Option<String> {
    static VIEW: Lazy<Regex> = Lazy::new(|| Regex::new(r"/jobs/view/(?:[^/?#]*-)?(\d{6,})").unwrap());
    let u = url::Url::parse(link).ok()?;
    if !u.host_str()?.to_lowercase().contains("linkedin.") {
        return None;
    }
    u.query_pairs().find(|(k, _)| k == "currentJobId").map(|(_, v)| v.to_string()).filter(|v| v.len() >= 6 && v.chars().all(|c| c.is_ascii_digit()))
        .or_else(|| VIEW.captures(u.path()).map(|m| m[1].to_string()))
}

/// The title, company and place at the top of a signed-out LinkedIn posting.
pub fn parse_linkedin_top(html: &str) -> (String, String, String) {
    static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<h[12][^>]*top-card-layout__title[^>]*>(.*?)</h[12]>"#).unwrap());
    static ORG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<a[^>]*topcard__org-name-link[^>]*>(.*?)</a>"#).unwrap());
    static PLACE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*topcard__flavor--bullet[^>]*>(.*?)</span>"#).unwrap());
    let get = |r: &Regex| r.captures(html).map(|m| html_to_text(&m[1]).trim().to_string()).unwrap_or_default();
    (get(&TITLE), get(&ORG), get(&PLACE))
}

/// One LinkedIn posting by its number, read the way a signed-out visitor sees it.
pub fn linkedin_posting(c: &reqwest::blocking::Client, id: &str) -> Result<Posting, String> {
    let html = linkedin_get(c, &format!("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{id}"))?;
    let description = parse_linkedin_posting(&html).ok_or("no description on the page")?;
    let (title, company, location) = parse_linkedin_top(&html);
    let (salary, salary_max) = salary_from_text(&description).map(|(t, m)| (Some(t), m)).unwrap_or((None, None));
    Ok(Posting {
        source: "linkedin".into(), external_id: id.into(), url: format!("https://www.linkedin.com/jobs/view/{id}/"),
        title, company, location, apply_email: find_apply_email(&description), apply_url: linkedin_offsite_apply(&html),
        salary, salary_max, description, ..Posting::default()
    })
}

/// Fill in the descriptions of new LinkedIn postings, at most `max`, a couple of seconds apart.
/// Returns how many were read.
pub fn linkedin_details(c: &reqwest::blocking::Client, postings: &mut [&mut Posting], max: usize) -> usize {
    let mut n = 0;
    // Two minutes at most, so a slow or unreachable LinkedIn doesn't hold up the search.
    let until = std::time::Instant::now() + Duration::from_secs(120);
    for p in postings.iter_mut().take(max) {
        if std::time::Instant::now() > until {
            break;
        }
        let url = format!("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{}", p.external_id);
        match linkedin_get(c, &url) {
            Ok(html) => {
                if let Some(d) = parse_linkedin_posting(&html) {
                    if p.salary.is_none() {
                        if let Some((t, max)) = salary_from_text(&d) {
                            p.salary = Some(t);
                            p.salary_max = max;
                        }
                    }
                    p.apply_email = find_apply_email(&d);
                    p.description = d;
                    p.apply_url = linkedin_offsite_apply(&html).or(p.apply_url.take());
                    n += 1;
                }
            }
            // Taken down: skip it. Anything else (limited, offline, timing out): stop for now.
            Err(e) if e == "not found" => {}
            Err(_) => break,
        }
        std::thread::sleep(Duration::from_millis(2000));
    }
    n
}

// --- Canada's Job Bank (jobbank.gc.ca) ---------------------------------------------------------
//
// Its own search page, newest first: 25 postings a page, with title, employer, place, salary and
// date. The full posting is read only for the new ones. Job Bank asks automated readers to wait
// 5 seconds between requests, so every request here does.

/// The address of a Job Bank search: postings from the last 30 days, newest first.
pub fn jobbank_search_url(title: &str, place: &str) -> String {
    let mut u = url::Url::parse("https://www.jobbank.gc.ca/jobsearch/jobsearch").unwrap();
    u.query_pairs_mut().append_pair("searchstring", title).append_pair("locationstring", place).append_pair("sort", "D").append_pair("fage", "30");
    u.to_string()
}

fn jobbank_get(c: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    std::thread::sleep(Duration::from_secs(5));
    let r = c.get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en;q=0.9")
        .send().map_err(|e| format!("couldn't connect ({e})"))?;
    match r.status().as_u16() {
        200 => r.text().map_err(|e| format!("unreadable page ({e})")),
        404 | 410 => Err("not found".into()),
        403 | 429 | 503 => Err("Job Bank is limiting requests from this connection for now; the next search tries again".into()),
        s => Err(format!("Job Bank said {s}")),
    }
}

/// "Surrey (BC)" as "Surrey, BC", the way your locations are written.
fn jobbank_place(t: &str) -> String {
    static PROV: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(.*?)\s*\(([A-Z]{2})\)\s*$").unwrap());
    match PROV.captures(t.trim()) {
        Some(m) => format!("{}, {}", m[1].trim(), &m[2]),
        None => t.trim().to_string(),
    }
}

/// "July 09, 2025" as 2025-07-09.
fn jobbank_date(t: &str) -> Option<String> {
    let t = t.trim().trim_start_matches("Posted on").trim();
    chrono::NaiveDate::parse_from_str(t, "%B %d, %Y").ok().map(|d| d.to_string())
}

/// Text without the hidden screen-reader labels Job Bank puts in ("Location", "Salary:" …).
fn jobbank_text(html: &str) -> String {
    static HIDDEN: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*class="[^"]*wb-inv[^"]*"[^>]*>.*?</span>"#).unwrap());
    html_to_text(&HIDDEN.replace_all(html, "")).replace('\n', " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The postings on a page of Job Bank search results.
pub fn parse_jobbank_list(html: &str) -> Vec<Posting> {
    static CARD: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<article[^>]*id="article-(\d+)"[^>]*>(.*?)</article>"#).unwrap());
    static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*class="noctitle"[^>]*>(.*?)</span>"#).unwrap());
    static LI: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<li[^>]*class="(date|business|location|salary)"[^>]*>(.*?)</li>"#).unwrap());
    static WORK: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*class="telework"[^>]*>(.*?)</span>"#).unwrap());
    let mut out = vec![];
    for c in CARD.captures_iter(html) {
        let (id, card) = (c[1].to_string(), &c[2]);
        let title = TITLE.captures(card).map(|m| jobbank_text(&m[1])).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        let mut f = std::collections::HashMap::new();
        for m in LI.captures_iter(card) {
            f.insert(m[1].to_string(), jobbank_text(&m[2]));
        }
        let place = jobbank_place(f.get("location").map(String::as_str).unwrap_or(""));
        let salary = f.get("salary").map(|s| s.trim_start_matches("Salary:").trim().to_string()).filter(|s| !s.is_empty());
        let work = WORK.captures(card).map(|m| jobbank_text(&m[1])).unwrap_or_default();
        out.push(Posting {
            source: "jobbank".into(),
            external_id: id.clone(),
            company: f.get("business").cloned().filter(|x| !x.is_empty()).unwrap_or_else(|| "Unknown".into()),
            remote: work.to_lowercase().contains("remote") || is_remote(&[&place, &title]),
            title,
            location: place,
            url: format!("https://www.jobbank.gc.ca/jobsearch/jobposting/{id}"),
            posted_at: f.get("date").and_then(|d| jobbank_date(d)),
            salary_max: salary.as_deref().and_then(salary_range).map(|r| r.1),
            salary,
            ..Posting::default()
        });
    }
    out
}

/// A Job Bank posting's text: its requirements sections, or (for postings from partner sites) the
/// description it carries.
pub fn parse_jobbank_posting(html: &str) -> Option<String> {
    static REQ: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<div[^>]*class="[^"]*job-posting-detail-requirements[^"]*"[^>]*>(.*?)(?:<div[^>]*class="[^"]*(?:col-md-4|job-posting-details-sidebar)|<footer|</main>)"#).unwrap());
    static DESC: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<(?:span|div)[^>]*property="description"[^>]*>(.*?)</(?:span|div)>"#).unwrap());
    static HIDDEN: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)<span[^>]*class="[^"]*wb-inv[^"]*"[^>]*>.*?</span>"#).unwrap());
    let clean = |s: &str| html_to_text(&HIDDEN.replace_all(s, "")).trim().to_string();
    REQ.captures(html).map(|m| clean(&m[1])).filter(|t| t.len() > 60)
        .or_else(|| DESC.captures(html).map(|m| clean(&m[1])).filter(|t| t.len() > 60))
}

/// One Job Bank search: the newest 25 postings for a title near a place.
pub fn jobbank(c: &reqwest::blocking::Client, title: &str, place: &str) -> Result<Vec<Posting>, String> {
    let html = jobbank_get(c, &jobbank_search_url(title, place))?;
    let list = parse_jobbank_list(&html);
    if list.is_empty() && !html.contains("results-count") && !html.contains("noresult") {
        return Err("Job Bank's page didn't look like search results. It may have changed; the next search tries again".into());
    }
    Ok(list)
}

/// Fill in the text of new Job Bank postings, at most `max`, 5 seconds apart. Returns how many were read.
pub fn jobbank_details(c: &reqwest::blocking::Client, postings: &mut [&mut Posting], max: usize) -> usize {
    let mut n = 0;
    let until = std::time::Instant::now() + Duration::from_secs(180);
    for p in postings.iter_mut().take(max) {
        if std::time::Instant::now() > until {
            break;
        }
        match jobbank_get(c, &p.url) {
            Ok(html) => {
                if let Some(d) = parse_jobbank_posting(&html) {
                    if p.salary.is_none() {
                        if let Some((t, max)) = salary_from_text(&d) {
                            p.salary = Some(t);
                            p.salary_max = max;
                        }
                    }
                    p.apply_email = find_apply_email(&d);
                    p.description = d;
                    n += 1;
                }
            }
            Err(e) if e == "not found" => {}
            Err(_) => break,
        }
    }
    n
}

/// LinkedIn postings through a scraper on Apify (apify.com), paid per result after its free
/// monthly credit. One run covers every search; it returns full descriptions.
pub fn apify_linkedin(c: &reqwest::blocking::Client, token: &str, actor: &str, searches: &[(String, String, bool)], max: usize) -> Result<Vec<Posting>, String> {
    let actor = if actor.trim().is_empty() { APIFY_ACTOR } else { actor.trim() };
    let urls: Vec<String> = searches.iter().map(|(t, w, r)| linkedin_search_url(t, w, *r)).collect();
    // The inputs the common LinkedIn job scrapers take; each uses the ones it knows.
    let input = serde_json::json!({
        "urls": urls, "count": max, "scrapeCompany": false,
        "startUrls": urls.iter().map(|u| serde_json::json!({ "url": u })).collect::<Vec<_>>(),
        "title": searches.first().map(|s| s.0.clone()).unwrap_or_default(), "location": searches.first().map(|s| s.1.clone()).unwrap_or_default(),
        "rows": max, "maxItems": max, "publishedAt": "r604800",
    });
    let url = format!("https://api.apify.com/v2/acts/{}/run-sync-get-dataset-items", actor.replace('/', "~"));
    let r = reqwest::blocking::Client::builder().timeout(Duration::from_secs(320)).build().map_err(|e| e.to_string())?
        .post(url).query(&[("timeout", "300"), ("clean", "true")]).bearer_auth(token.trim()).json(&input)
        .send().map_err(|e| format!("couldn't connect ({e})"))?;
    let _ = c;
    match r.status().as_u16() {
        200 | 201 => {}
        401 | 403 => return Err("the Apify token was refused. Check it in Settings → Job sources".into()),
        402 => return Err("your Apify credit is used up for this month".into()),
        404 => return Err(format!("there's no Apify scraper called {actor}. Check its name in Settings → Job sources")),
        408 => return Err("the Apify scraper took too long; the next search tries again".into()),
        s => return Err(format!("Apify answered HTTP {s}")),
    }
    let v: Value = r.json().map_err(|e| format!("unexpected response ({e})"))?;
    let list = parse_apify_linkedin(&v);
    let items = v.as_array().map(|a| a.len()).unwrap_or(0);
    if list.is_empty() && items > 0 {
        return Err(format!("the scraper returned {items} results, but not in a form Job Hunt recognises. Try the default scraper, {APIFY_ACTOR}"));
    }
    Ok(list)
}

/// Postings from an Apify LinkedIn scraper. Each scraper names its fields a little differently.
pub fn parse_apify_linkedin(v: &Value) -> Vec<Posting> {
    let pick = |j: &Value, keys: &[&str]| -> String {
        keys.iter().find_map(|k| match j.get(*k) {
            Some(Value::String(x)) if !x.trim().is_empty() => Some(x.trim().to_string()),
            Some(Value::Number(n)) => Some(n.to_string()),
            Some(Value::Object(o)) => o.get("name").and_then(|x| x.as_str()).map(String::from),
            _ => None,
        }).unwrap_or_default()
    };
    static LINK_ID: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:jobs/view/(?:[^/?]*-)?|currentJobId=)(\d{6,})").unwrap());
    let mut out = vec![];
    for j in v.as_array().into_iter().flatten() {
        let title = pick(j, &["title", "jobTitle", "position", "name"]);
        let link = pick(j, &["link", "jobUrl", "url", "jobLink", "applyUrl"]);
        // LinkedIn's own job number, from the link when there is one, so it matches the same
        // posting found other ways.
        let id = LINK_ID.captures(&link).map(|m| m[1].to_string())
            .or_else(|| Some(pick(j, &["jobId", "id", "job_id"])).filter(|x| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit())))
            .unwrap_or_default();
        if title.is_empty() || id.is_empty() {
            continue;
        }
        let place = pick(j, &["location", "jobLocation", "place", "formattedLocation"]);
        let desc = pick(j, &["descriptionText", "description", "jobDescription", "descriptionHtml"]);
        let desc = if desc.contains('<') { html_to_text(&desc) } else { desc };
        let salary = Some(pick(j, &["salary", "salaryInfo", "salaryRange", "compensation"])).filter(|x| !x.is_empty())
            .or_else(|| salary_from_text(&desc).map(|s| s.0));
        let workplace = pick(j, &["workplaceType", "workType", "workplace", "remote"]).to_lowercase();
        let remote_flag = j.get("remoteAllowed").or(j.get("workRemoteAllowed")).and_then(|x| x.as_bool()).unwrap_or(false);
        out.push(Posting {
            apply_url: None,
            source: "linkedin".into(),
            external_id: id.clone(),
            company: Some(pick(j, &["companyName", "company", "company_name", "companyTitle"])).filter(|x| !x.is_empty()).unwrap_or_else(|| "Unknown".into()),
            remote: remote_flag || workplace.contains("remote") || workplace == "true" || is_remote(&[&place, &title]),
            title,
            location: place,
            url: format!("https://www.linkedin.com/jobs/view/{id}/"),
            apply_email: find_apply_email(&desc),
            posted_at: Some(pick(j, &["postedAt", "publishedAt", "postedDate", "listedAt", "datePosted", "postedTime"])).filter(|x| !x.is_empty()),
            salary_max: salary.as_deref().and_then(salary_range).map(|r| r.1),
            salary,
            description: desc,
        });
    }
    out
}

/// JSearch reads Google for Jobs, which gathers postings from LinkedIn, Indeed, Glassdoor,
/// ZipRecruiter, job boards and company sites. https://www.openwebninja.com/api/jsearch
pub fn parse_jsearch(body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("data").and_then(|x| x.as_array()).into_iter().flatten() {
        let place = [s(j, "job_city"), s(j, "job_state"), s(j, "job_country")].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(", ");
        let place = if place.is_empty() { s(j, "job_location") } else { place };
        let mut desc = s(j, "job_description");
        if let Some(h) = j.get("job_highlights").and_then(|h| h.as_object()) {
            if desc.chars().count() < 400 {
                for (k, v) in h {
                    let items: Vec<&str> = v.as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect();
                    if !items.is_empty() {
                        desc.push_str(&format!("\n\n{k}\n- {}", items.join("\n- ")));
                    }
                }
            }
        }
        let (lo, hi) = (j.get("job_min_salary").and_then(|x| x.as_f64()), j.get("job_max_salary").and_then(|x| x.as_f64()));
        let yearly = matches!(s(j, "job_salary_period").to_uppercase().as_str(), "YEAR" | "");
        let title = s(j, "job_title").trim().to_string();
        if title.is_empty() {
            continue;
        }
        // Google for Jobs lists where to apply, marking the employer's own page as direct.
        let direct = j.get("apply_options").and_then(|o| o.as_array()).into_iter().flatten()
            .filter(|o| o.get("is_direct").and_then(|d| d.as_bool()) == Some(true))
            .map(|o| s(o, "apply_link")).find(|l| l.starts_with("http") && !is_job_board(l))
            .or_else(|| Some(s(j, "job_apply_link")).filter(|l| l.starts_with("http") && !is_job_board(l) && j.get("job_apply_is_direct").and_then(|d| d.as_bool()) == Some(true)));
        out.push(Posting {
            apply_url: direct,
            source: "jsearch".into(),
            external_id: Some(s(j, "job_id")).filter(|x| !x.is_empty()).unwrap_or_else(|| crate::util::short_hash(&format!("{title}|{}", s(j, "employer_name")))),
            company: Some(s(j, "employer_name")).filter(|x| !x.is_empty()).unwrap_or_else(|| "Unknown".into()),
            title,
            remote: j.get("job_is_remote") == Some(&Value::Bool(true)) || is_remote(&[&place]),
            location: place,
            url: Some(s(j, "job_apply_link")).filter(|x| x.starts_with("http")).unwrap_or_else(|| s(j, "job_google_link")),
            apply_email: find_apply_email(&desc),
            description: desc,
            posted_at: Some(s(j, "job_posted_at_datetime_utc")).filter(|x| !x.is_empty()),
            salary: if yearly { fmt_salary(lo, hi, "") } else { fmt_salary(lo, hi, "").map(|t| format!("{t}/{}", s(j, "job_salary_period").to_lowercase())) },
            salary_max: if yearly { hi } else { None },
        });
    }
    out
}

pub fn jsearch(c: &reqwest::blocking::Client, provider: &str, key: &str, query: &str, country: &str) -> Result<Vec<Posting>, String> {
    let mut params = vec![("query", query.to_string()), ("page", "1".into()), ("num_pages", "1".into()), ("country", country.to_lowercase()), ("date_posted", "week".into())];
    if query.contains(" in ") {
        params.push(("radius", RADIUS_KM.to_string()));
    }
    let req = if provider == "rapidapi" {
        c.get("https://jsearch.p.rapidapi.com/search").header("x-rapidapi-key", key).header("x-rapidapi-host", "jsearch.p.rapidapi.com")
    } else {
        c.get("https://api.openwebninja.com/jsearch/search").header("x-api-key", key)
    };
    let r = req.query(&params).send().map_err(|e| format!("couldn't connect ({e})"))?;
    match r.status().as_u16() {
        200 => {}
        401 | 403 => return Err("the key was refused. Check it, and which site it's from, in Settings → Job sources".into()),
        429 => return Err("this month's requests are used up (your plan's limit), or too many at once".into()),
        s => return Err(format!("HTTP {s}")),
    }
    let v: Value = r.json().map_err(|e| format!("unexpected response ({e})"))?;
    Ok(parse_jsearch(&v))
}

/// Jooble gathers listings from many job sites; descriptions are short excerpts.
/// https://jooble.org/api/about
pub fn parse_jooble(body: &Value) -> Vec<Posting> {
    let mut out = vec![];
    for j in body.get("jobs").and_then(|x| x.as_array()).into_iter().flatten() {
        let title = html_to_text(&s(j, "title")).trim().to_string();
        if title.is_empty() {
            continue;
        }
        let snippet = html_to_text(&s(j, "snippet")).trim().to_string();
        let place = s(j, "location");
        let company = Some(s(j, "company")).filter(|x| !x.trim().is_empty()).unwrap_or_else(|| "Unknown".into());
        out.push(Posting {
            source: "jooble".into(),
            external_id: id_str(j).trim_matches('"').to_string(),
            remote: is_remote(&[&place, &title]),
            description: format!("{snippet}\n\n(From Jooble, which shows only part of the posting: open it for the full description.)"),
            company,
            title,
            location: place,
            url: s(j, "link"),
            posted_at: Some(s(j, "updated")).filter(|x| !x.is_empty()),
            salary: Some(s(j, "salary")).filter(|x| !x.trim().is_empty()),
            ..Posting::default()
        });
    }
    out
}

pub fn jooble(c: &reqwest::blocking::Client, key: &str, keywords: &str, location: &str) -> Result<Vec<Posting>, String> {
    let r = c.post(format!("https://jooble.org/api/{key}"))
        // Jooble takes a radius of 0, 8, 16, 24, 40 or 80 km.
        .json(&if location.is_empty() { serde_json::json!({ "keywords": keywords }) } else { serde_json::json!({ "keywords": keywords, "location": location, "radius": "40" }) })
        .send().map_err(|e| format!("couldn't connect ({e})"))?;
    match r.status().as_u16() {
        200 => {}
        401 | 403 | 404 => return Err("the key was refused. Check it in Settings → Job sources".into()),
        s => return Err(format!("HTTP {s}")),
    }
    let v: Value = r.json().map_err(|e| format!("unexpected response ({e})"))?;
    Ok(parse_jooble(&v))
}

/// The searches to run on a keyed service, at most `max`: every job title in your first place,
/// then in your other places (see Profile::search_places), or nationwide when you have none.
pub fn searches(p: &Profile, max: usize) -> Vec<(String, String)> {
    let mut titles: Vec<String> = vec![];
    for t in p.tracks.iter().flat_map(|t| t.titles.iter()) {
        if !t.trim().is_empty() && !titles.iter().any(|x| x.eq_ignore_ascii_case(t.trim())) {
            titles.push(t.trim().to_string());
        }
    }
    let mut places = p.search_places();
    if places.is_empty() {
        places.push(p.country()); // nowhere in particular: the whole country
    }
    // Searching "Business Analyst" finds senior ones too, but a page of results can be full before they
    // show; so where there's room, "Senior Business Analyst" is searched as well, after every title.
    const LEVELS: [&str; 8] = ["senior", "sr", "lead", "principal", "staff", "head", "chief", "director"];
    let senior: Vec<String> = titles.iter()
        .filter(|t| !t.to_lowercase().split(|c: char| !c.is_alphanumeric()).any(|w| LEVELS.contains(&w)))
        .map(|t| format!("Senior {t}"))
        .filter(|s| !titles.iter().any(|x| x.eq_ignore_ascii_case(s)))
        .collect();
    // Each title in every place before the next title, so a source that runs only a few searches
    // still looks in each of your places, not only the first.
    let mut out: Vec<(String, String)> = titles.iter().flat_map(|t| places.iter().map(move |w| (t.clone(), w.clone()))).collect();
    out.extend(senior.iter().flat_map(|t| places.iter().map(move |w| (t.clone(), w.clone()))));
    out.into_iter().take(max).collect()
}

pub struct Fetched {
    pub postings: Vec<Posting>,
    /// One line per source that failed, e.g. "greenhouse:acme: not found".
    pub problems: Vec<String>,
    /// The id prefix of every board listed in full this time (see board_prefix): a posting from one
    /// of them that's missing from the list has closed.
    pub complete: Vec<String>,
    /// Company boards that failed, as (kind, name), so they can be removed in one click.
    pub failed: Vec<(String, String)>,
    /// What each kind of source gave: (name, requests, postings, requests that failed).
    pub by_source: Vec<(String, usize, usize, usize)>,
}

/// How a board's posting ids start, e.g. "greenhouse:acme-".
pub fn board_prefix(source: &str, name: &str) -> String {
    match source {
        "workday" => format!("workday:{}-", workday_board(name).map(|b| b.tenant).unwrap_or_default()),
        _ => format!("{source}:{name}-"),
    }
}

/// Every company board you search, as (source, name).
pub fn boards(p: &Profile) -> Vec<(&'static str, String)> {
    let s = &p.sources;
    let mut out = vec![];
    for (src, list) in [("greenhouse", &s.greenhouse), ("lever", &s.lever), ("ashby", &s.ashby), ("workday", &s.workday), ("smartrecruiters", &s.smartrecruiters), ("workable", &s.workable)] {
        for name in list.iter().map(|x| x.trim()).filter(|x| !x.is_empty()) {
            out.push((src, name.to_string()));
        }
    }
    out
}

/// One board's postings, and whether that was all of them.
pub fn fetch_board(c: &reqwest::blocking::Client, p: &Profile, source: &str, name: &str) -> Result<(Vec<Posting>, bool), String> {
    let want = |t: &str| wanted(p, t);
    match source {
        "greenhouse" => greenhouse(c, name).map(|l| (l, true)),
        "lever" => lever(c, name).map(|l| (l, true)),
        "ashby" => ashby(c, name).map(|l| (l, true)),
        "workable" => workable(c, name).map(|l| (l, true)),
        "smartrecruiters" => smartrecruiters(c, name, &want),
        "workday" => {
            let mut titles: Vec<String> = p.tracks.iter().flat_map(|t| t.titles.clone()).collect();
            titles.dedup();
            workday(c, name, &titles, &want).map(|l| (l, false))
        }
        _ => Err("unknown kind of board".into()),
    }
}

pub fn board_label(source: &str, name: &str) -> String {
    let kind = match source {
        "greenhouse" => "Greenhouse",
        "lever" => "Lever",
        "ashby" => "Ashby",
        "workday" => "Workday",
        "smartrecruiters" => "SmartRecruiters",
        "workable" => "Workable",
        other => other,
    };
    let name = match source {
        "workday" => workday_board(name).map(|b| format!("{} ({})", b.tenant, b.site)).unwrap_or_else(|| name.to_string()),
        _ => name.to_string(),
    };
    format!("{kind} board {name}")
}

/// Every configured source, de-duplicated by posting id.
pub fn fetch_all(p: &Profile, keys: &Keys, on_step: &dyn Fn(usize, usize, &str)) -> Fetched {
    type Call<'a> = Box<dyn Fn() -> Result<(Vec<Posting>, bool), String> + 'a>;
    let c = http();
    // (what's being searched, the kind of source, the company board if it is one, the request)
    let mut calls: Vec<(String, String, Option<(String, String, String)>, Call)> = vec![];
    let off = |id: &str| p.sources.is_off(id);
    for (src, name) in boards(p).into_iter().filter(|_| !off("boards")) {
        let c = c.clone();
        let board = (board_prefix(src, &name), src.to_string(), name.clone());
        calls.push((board_label(src, &name), "Company job boards".into(), Some(board), Box::new(move || fetch_board(&c, p, src, &name))));
    }
    // Google for Jobs through JSearch: one request per job title, to stay within a small plan.
    if let Some((provider, key)) = keys.jsearch.as_ref().filter(|_| !off("jsearch")) {
        for (title, place) in searches(p, 6) {
            let (c, provider, key, country) = (c.clone(), provider.clone(), key.clone(), p.sources.adzuna_country.clone());
            let q = if place.is_empty() { title.clone() } else { format!("{title} in {place}") };
            calls.push((format!("Google for Jobs “{q}”"), "Google for Jobs".into(), None, Box::new(move || jsearch(&c, &provider, &key, &q, &country).map(|l| (l, false)))));
        }
    }
    if let Some(key) = keys.jooble.as_ref().filter(|_| !off("jooble")) {
        for (title, place) in searches(p, 8) {
            let (c, key) = (c.clone(), key.clone());
            let name = if place.is_empty() { format!("Jooble “{title}”") } else { format!("Jooble “{title}” in {place}") };
            calls.push((name, "Jooble".into(), None, Box::new(move || jooble(&c, &key, &title, &place).map(|l| (l, false)))));
        }
    }
    // LinkedIn: through Apify when there's a token, else its signed-out search, when it's on.
    if p.sources.linkedin {
        let list = linkedin_searches(p, 6);
        if let Some((token, actor)) = &keys.apify {
            let (c, token, actor) = (c.clone(), token.clone(), actor.clone());
            let max = (p.max_scored_per_run as usize).clamp(20, 100);
            calls.push(("LinkedIn (through Apify)".into(), "LinkedIn".into(), None, Box::new(move || apify_linkedin(&c, &token, &actor, &list, max).map(|l| (l, false)))));
        } else {
            // Once LinkedIn turns a search away, the rest wait for the next search.
            let refused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            for (title, w, remote) in list {
                let (c, refused) = (c.clone(), refused.clone());
                let name = if remote { format!("LinkedIn “{title}”, remote in {w}") } else { format!("LinkedIn “{title}” in {w}") };
                calls.push((name, "LinkedIn".into(), None, Box::new(move || {
                    use std::sync::atomic::Ordering::SeqCst;
                    if refused.load(SeqCst) {
                        return Ok((vec![], false));
                    }
                    let r = linkedin(&c, &title, &w, remote);
                    if r.as_ref().is_err_and(|e| e.contains("limiting")) {
                        refused.store(true, SeqCst);
                    }
                    r.map(|l| (l, false))
                })));
            }
        }
    }
    // Job Bank: a few searches, 5 seconds apart; once it turns one away, the rest wait.
    if !p.sources.is_off("jobbank") {
        let refused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        for (title, w) in searches(p, 6) {
            let (c, refused) = (c.clone(), refused.clone());
            let name = if w.is_empty() { format!("Job Bank “{title}”") } else { format!("Job Bank “{title}” in {w}") };
            calls.push((name, "Job Bank".into(), None, Box::new(move || {
                use std::sync::atomic::Ordering::SeqCst;
                if refused.load(SeqCst) {
                    return Ok((vec![], false));
                }
                let r = jobbank(&c, &title, &w);
                if r.as_ref().is_err_and(|e| e.contains("limiting")) {
                    refused.store(true, SeqCst);
                }
                r.map(|l| (l, false))
            })));
        }
    }
    // Recruiters' and job sites' own listings: each counted on its own, to see which work.
    if !off("agencies") {
        let tp = searches(p, 3);
        for t in crate::sites::targets(&p.sources.sites, &p.sources.custom_sites) {
            let t = std::sync::Arc::new(t);
            for (title, w) in crate::sites::searches_for(&t, &tp) {
                let (c, t2) = (c.clone(), t.clone());
                let name = if title.is_empty() { format!("{} (all jobs)", t.name) } else { format!("{} “{title}”", t.name) };
                calls.push((name, t.name.clone(), None, Box::new(move || crate::sites::search(&c, &t2, &title, &w).map(|l| (l, false)))));
            }
        }
    }
    if let Some((id, key)) = keys.adzuna.as_ref().filter(|_| !off("adzuna")).map(|(a, b)| (a.as_str(), b.as_str())) {
        for (title, w) in searches(p, 30) {
            let (c, id, key, country, days) = (c.clone(), id.to_string(), key.to_string(), p.sources.adzuna_country.clone(), p.sources.adzuna_days);
            let name = if w.is_empty() { format!("Adzuna “{title}”") } else { format!("Adzuna “{title}” in {w}") };
            calls.push((name, "Adzuna".into(), None, Box::new(move || adzuna(&c, &id, &key, &country, &title, &w, days).map(|l| (l, false)))));
        }
    }
    let mut found: BTreeMap<String, Posting> = BTreeMap::new();
    let mut problems = vec![];
    let mut complete = vec![];
    let mut failed = vec![];
    let mut by_source: Vec<(String, usize, usize, usize)> = vec![];
    let total = calls.len();
    for (i, (name, kind, board, call)) in calls.into_iter().enumerate() {
        on_step(i, total, &name);
        let res = call();
        if !by_source.iter().any(|t| t.0 == kind) {
            by_source.push((kind.clone(), 0, 0, 0));
        }
        let t = by_source.iter_mut().find(|t| t.0 == kind).unwrap();
        t.1 += 1;
        match &res {
            Ok((list, _)) => t.2 += list.len(),
            Err(_) => t.3 += 1,
        }
        match res {
            Ok((list, all)) => {
                if all {
                    complete.extend(board.map(|b| b.0));
                }
                for p in list {
                    found.entry(p.id()).or_insert(p);
                }
            }
            Err(e) => {
                // A board that isn't there (renamed or gone), as opposed to a network hiccup.
                if let Some((_, src, n)) = board.filter(|_| e.starts_with("not found")) {
                    failed.push((src, n));
                }
                problems.push(format!("{name}: {e}"));
            }
        }
    }
    Fetched { postings: found.into_values().collect(), problems, complete, failed, by_source }
}

#[cfg(test)]
mod tests {
    #[test]
    fn searches_look_in_your_country() {
        let mut p = crate::profile::Profile { remote_ok: true, ..Default::default() };
        p.tracks = vec![crate::profile::Track { name: "a".into(), titles: vec!["Program Manager".into()], ..Default::default() }];
        p.sources.adzuna_country = "qa".into();
        assert_eq!(searches(&p, 5), vec![("Program Manager".to_string(), "Qatar".to_string()), ("Senior Program Manager".to_string(), "Qatar".to_string())], "no places: the whole country; senior ones too");
        assert_eq!(searches(&p, 1).len(), 1, "senior searches only use room that's left");
        p.locations = vec!["Doha".into()];
        let l = linkedin_searches(&p, 5);
        assert!(l.contains(&("Program Manager".into(), "Doha".into(), false)) && l.contains(&("Program Manager".into(), "Qatar".into(), true)), "{l:?}");
        assert!(p.sources.is_off("jobbank") && p.sources.is_off("adzuna"), "Canada's Job Bank and Adzuna don't search Qatar");
        p.sources.adzuna_country = "gb".into();
        assert!(!p.sources.is_off("adzuna"));
    }

    #[test]
    fn salary_in_the_text() {
        let f = |t: &str| salary_from_text(t);
        assert_eq!(f("The base salary range is $110,000 - $135,000 per year."), Some(("$110,000–$135,000".into(), Some(135000.0))));
        assert_eq!(f("Pay: CA$95K–120K annually"), Some(("$95,000–$120,000".into(), Some(120000.0))));
        assert_eq!(f("Compensation: $95,000 to $120,000 CAD"), Some(("$95,000–$120,000".into(), Some(120000.0))));
        assert_eq!(f("Rate: $45 - $55 per hour"), Some(("$45–$55/hour".into(), None)));
        assert_eq!(f("Raised $50 - $80 million in funding"), None, "not pay");
        assert_eq!(f("No pay listed."), None);
        assert_eq!(f("Salary: QAR 8,000 - 12,000 per month plus benefits"), Some(("QAR 8,000–12,000/month".into(), Some(144000.0))));
        assert_eq!(f("£45,000 - £55,000 a year"), Some(("£45,000–£55,000".into(), Some(55000.0))));
        assert_eq!(f("AED 15k-20k monthly"), Some(("AED 15,000–20,000/month".into(), Some(240000.0))));
        assert_eq!(f("Founded 2010 - 2015 in Doha"), None, "years aren't pay");
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn greenhouse_lever_ashby_adzuna() {
        let g = parse_greenhouse("acme", &json!({"jobs": [{"id": 101, "title": " Senior TPM ", "absolute_url": "https://x/101",
            "location": {"name": "Toronto, ON"}, "company_name": "Acme", "updated_at": "2026-10-10",
            "content": "&lt;p&gt;Lead &lt;b&gt;delivery&lt;/b&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;UAT&lt;/li&gt;&lt;/ul&gt;"}]}));
        assert_eq!(g[0].id(), "greenhouse:acme-101");
        assert_eq!(g[0].title, "Senior TPM");
        assert!(g[0].description.contains("Lead delivery.") && g[0].description.contains("- UAT"));

        let l = parse_lever("koho", &json!([{"id": "abc", "text": "Program Manager", "hostedUrl": "https://l/abc",
            "categories": {"location": "Remote - Canada"}, "descriptionPlain": "Run programs.",
            "lists": [{"text": "Requirements", "content": "<li>PMP</li>"}], "createdAt": 1760000000000i64,
            "workplaceType": "remote", "salaryRange": {"min": 120000, "max": 150000, "currency": "CAD"}}]));
        assert!(l[0].remote && l[0].description.contains("PMP"));
        assert_eq!(l[0].salary.as_deref(), Some("CAD 120,000–150,000"));
        assert_eq!(l[0].salary_max, Some(150000.0));
        assert!(l[0].posted_at.as_deref().unwrap().starts_with("2025-10-09"));

        let a = parse_ashby("ws", &json!({"jobs": [
            {"id": "x1", "title": "Data Engineering Manager", "location": "Toronto", "jobUrl": "https://a/x1",
             "descriptionPlain": "Please email your resume to careers@ws.example.com.", "isListed": true},
            {"id": "x2", "title": "Hidden", "isListed": false}]}));
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].apply_email.as_deref(), Some("careers@ws.example.com"));

        let z = parse_adzuna(&json!({"results": [{"id": "555", "title": "<strong>Program</strong> Manager",
            "company": {"display_name": "Big Bank"}, "location": {"display_name": "Toronto, Ontario"},
            "redirect_url": "https://z/555", "description": "Deliver programs", "salary_min": 110000, "salary_max": 130000}]}), "CAD");
        assert_eq!((z[0].id().as_str(), z[0].title.as_str(), z[0].company.as_str()), ("adzuna:555", "Program Manager", "Big Bank"));
    }

    #[test]
    fn workday_smartrecruiters_workable() {
        let b = workday_board("https://rbc.wd3.myworkdayjobs.com/en-US/RBCGLOBAL1?q=x").unwrap();
        assert_eq!((b.host.as_str(), b.tenant.as_str(), b.site.as_str()), ("rbc.wd3.myworkdayjobs.com", "rbc", "RBCGLOBAL1"));
        assert_eq!(workday_board("rbc.wd3.myworkdayjobs.com/RBCGLOBAL1").unwrap().site, "RBCGLOBAL1");
        assert!(workday_board("https://example.com/careers").is_none());
        let (list, total) = parse_workday_list(&json!({"total": 31, "jobPostings": [
            {"title": "Senior Program Manager", "externalPath": "/job/Toronto-ON/Senior-Program-Manager_R-123", "locationsText": "Toronto, ON"},
            {"title": "", "externalPath": "/job/x"}]}));
        assert_eq!((list.len(), total), (1, 31));
        let j = parse_workday_job(&b, &list[0].1, &json!({"jobPostingInfo": {"title": "Senior Program Manager", "location": "Toronto, ON",
            "additionalLocations": ["Remote, Canada"], "jobDescription": "<p>Lead <b>delivery</b>.</p>", "startDate": "2026-10-01",
            "externalUrl": "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1/job/Toronto-ON/Senior-Program-Manager_R-123"},
            "hiringOrganization": {"name": "Royal Bank of Canada"}})).unwrap();
        assert_eq!(j.id(), "workday:rbc-Senior-Program-Manager_R-123");
        assert_eq!(j.company, "Royal Bank of Canada");
        assert!(j.remote && j.location.contains("Remote") && j.description.contains("Lead delivery."));
        assert!(j.id().starts_with(&board_prefix("workday", "https://rbc.wd3.myworkdayjobs.com/en-US/RBCGLOBAL1")));
        assert_eq!(workday_job_api(&j.url).unwrap(), "https://rbc.wd3.myworkdayjobs.com/wday/cxs/rbc/RBCGLOBAL1/job/Toronto-ON/Senior-Program-Manager_R-123");

        let sr = parse_smartrecruiters("Visa", &json!({"totalFound": 1, "content": [{"id": "7440001", "name": "Program Manager",
            "company": {"name": "Visa Inc."}, "releasedDate": "2026-10-01T12:00:00.000Z",
            "location": {"city": "Toronto", "region": "ON", "country": "ca", "remote": false}}]}));
        assert_eq!((sr[0].id().as_str(), sr[0].company.as_str(), sr[0].location.as_str()), ("smartrecruiters:Visa-7440001", "Visa Inc.", "Toronto, ON, CA"));
        let (text, url) = smartrecruiters_details(&json!({"postingUrl": "https://jobs.smartrecruiters.com/Visa/7440001-program-manager",
            "jobAd": {"sections": {"jobDescription": {"title": "Job Description", "text": "<p>Run the PMO.</p>"}, "qualifications": {"title": "Qualifications", "text": "<ul><li>PMP</li></ul>"}}}}));
        assert!(text.contains("Run the PMO.") && text.contains("PMP"));
        assert!(url.unwrap().ends_with("program-manager"));

        let w = parse_workable("koho", &json!({"name": "KOHO", "jobs": [{"title": "Delivery Lead", "shortcode": "AB12CD", "url": "https://apply.workable.com/j/AB12CD",
            "city": "Toronto", "state": "Ontario", "country": "Canada", "telecommuting": true, "published_on": "2026-10-02", "description": "<p>Lead delivery.</p>"}]}));
        assert_eq!((w[0].id().as_str(), w[0].company.as_str()), ("workable:koho-AB12CD", "KOHO"));
        assert!(w[0].remote && w[0].description.contains("Lead delivery."));
    }

    #[test]
    fn deadlines_in_the_text() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let d = |t: &str| deadline_from_text(t, today).map(|d| d.to_string());
        assert_eq!(d("Please apply by October 31, 2026."), Some("2026-10-31".into()));
        assert_eq!(d("Closing date: 2026-11-05"), Some("2026-11-05".into()));
        assert_eq!(d("Applications close 3rd Nov"), Some("2026-11-03".into()));
        assert_eq!(d("Posting end date: Jan 9"), Some("2027-01-09".into()), "no year, already past: next year");
        assert_eq!(d("Founded on October 31, 2001. We hire all year."), None, "not a deadline");
        assert_eq!(d("Deadline: March 1, 2020"), None, "long gone");
    }

    #[test]
    fn job_bank_search_and_posting() {
        // As Job Bank's results page marks them up (from saved pages).
        let list = r##"<span class="found" id="results-count">97</span>
<article id="article-44640615" class="action-buttons">
  <a href="/jobsearch/jobposting/44640615;jsessionid=ABC123?source=searchresults" class="resultJobItem">
    <h3 class="title">
      <span class="flag"><span class="telework">On site</span><span class="appmethod">Direct Apply</span><span class="postedonJB">Posted on Job Bank</span>
        <span class="job-source job-source-icon-16"><span class="wb-inv">Job Bank</span></span></span>
      <span class="noctitle"> tax manager </span>
    </h3>
    <ul class="list-unstyled">
      <li class="date">October 14, 2026</li>
      <li class="business">Maple Accounting &amp; Tax Ltd.</li>
      <li class="location"><span class="fas fa-map-marker-alt" aria-hidden="true"></span> <span class="wb-inv">Location</span>
        Toronto (ON)</li>
      <li class="salary"><span class="fa fa-dollar" aria-hidden="true"></span> Salary: $95,000.00 to $115,000.00 annually (to be negotiated)</li>
      <li class="source"><span class="job-source job-source-icon-16"></span> <span class="wb-inv">Job number:</span> 3345208</li>
    </ul>
  </a>
</article>
<article id="article-44650001"><a href="/jobsearch/jobposting/44650001?source=searchresults" class="resultJobItem">
  <h3 class="title"><span class="flag"><span class="telework">Remote work available</span></span><span class="noctitle">senior tax analyst</span></h3>
  <ul class="list-unstyled"><li class="date">October 10, 2026</li><li class="business">Northwind</li><li class="location"><span class="wb-inv">Location</span> Mississauga (ON)</li></ul>
</a></article>"##;
        let l = parse_jobbank_list(list);
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].id().as_str(), l[0].title.as_str(), l[0].company.as_str(), l[0].location.as_str()),
            ("jobbank:44640615", "tax manager", "Maple Accounting & Tax Ltd.", "Toronto, ON"));
        assert_eq!((l[0].posted_at.as_deref(), l[0].url.as_str()), (Some("2026-10-14"), "https://www.jobbank.gc.ca/jobsearch/jobposting/44640615"));
        assert_eq!((l[0].salary_max, l[0].remote), (Some(115000.0), false));
        assert!(l[1].remote && l[1].salary.is_none() && l[1].location == "Mississauga, ON");
        let page = r##"<div vocab="http://schema.org/" typeof="JobPosting"><h1 property="title">tax manager</h1>
          <div class="job-posting-detail-requirements">
            <h3>Overview</h3><p><strong>Education</strong></p><ul><li>Bachelor's degree</li></ul>
            <h3>Responsibilities</h3><ul><li>Prepare and review corporate tax returns (T2)</li><li>Advise clients on Snowflake</li></ul>
            <h3>Experience and specialization</h3><p>5 years or more. Apply by email: jobs@maple-tax.example</p>
          </div>
          <div class="col-md-4 job-posting-details-sidebar"><p>Advertised until 2026-11-13</p></div></div>"##;
        let d = parse_jobbank_posting(page).unwrap();
        assert!(d.contains("Prepare and review corporate tax returns") && d.contains("5 years") && !d.contains("Advertised until"), "{d}");
        // From a partner site: just the description.
        let partner = r#"<p>This job posting has been provided by a partner site</p><span class="hidden" property="description">We are hiring a Senior Tax Analyst to own indirect tax filings across Canada and the US.</span>"#;
        assert!(parse_jobbank_posting(partner).unwrap().starts_with("We are hiring"));
        assert!(parse_jobbank_posting("<html>Not found</html>").is_none());
        assert!(jobbank_search_url("Tax Manager", "Toronto, ON").contains("searchstring=Tax+Manager&locationstring=Toronto%2C+ON&sort=D&fage=30"));
    }

    #[test]
    fn linkedin_links_and_top_card() {
        assert_eq!(linkedin_job_id("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678&discover=x").as_deref(), Some("4012345678"));
        assert_eq!(linkedin_job_id("https://ca.linkedin.com/jobs/view/senior-tax-manager-at-maple-bank-4012345678?trk=x").as_deref(), Some("4012345678"));
        assert_eq!(linkedin_job_id("https://www.linkedin.com/jobs/view/4012345678/").as_deref(), Some("4012345678"));
        assert_eq!(linkedin_job_id("https://www.linkedin.com/feed/"), None);
        assert_eq!(linkedin_job_id("https://careers.acme.example/jobs/view/4012345678"), None);
        let html = r#"<h2 class="top-card-layout__title font-sans topcard__title">Senior Tax Manager</h2>
          <h4><a class="topcard__org-name-link topcard__flavor--black-link" href="x">
            Maple Bank
          </a><span class="topcard__flavor topcard__flavor--bullet">
            Toronto, Ontario, Canada
          </span></h4>"#;
        assert_eq!(parse_linkedin_top(html), ("Senior Tax Manager".into(), "Maple Bank".into(), "Toronto, Ontario, Canada".into()));
    }

    #[test]
    fn company_apply_links() {
        assert!(is_job_board("https://ca.linkedin.com/jobs/view/1"));
        assert!(is_job_board("https://ca.indeed.com/viewjob?jk=1"));
        assert!(!is_job_board("https://careers.acme.example/job/1"));
        assert!(!is_job_board("https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/1"));
        let page = r#"<code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/1?url=https%3A%2F%2Fcareers%2Eacme%2Eexample%2Fjob%2F1%3Fsrc%3Dli&amp;urlHash=x"--></code>"#;
        assert_eq!(linkedin_offsite_apply(page).as_deref(), Some("https://careers.acme.example/job/1?src=li"));
        assert_eq!(linkedin_offsite_apply("<html>Easy Apply</html>"), None);
        let body = serde_json::json!({"data": [{
            "job_id": "a1", "job_title": "Analyst", "employer_name": "Acme", "job_city": "Toronto",
            "job_apply_link": "https://ca.linkedin.com/jobs/view/1", "job_apply_is_direct": false,
            "apply_options": [{"publisher": "LinkedIn", "apply_link": "https://ca.linkedin.com/jobs/view/1", "is_direct": false},
                              {"publisher": "Acme", "apply_link": "https://careers.acme.example/job/1", "is_direct": true}]}]});
        let p = parse_jsearch(&body);
        assert_eq!(p[0].apply_url.as_deref(), Some("https://careers.acme.example/job/1"));
        assert_eq!(p[0].to_job().apply_url.as_deref(), Some("https://careers.acme.example/job/1"));
    }

    #[test]
    fn linkedin_signed_out_search_and_apify() {
        let list = r##"<li>
  <div class="base-card relative w-full hover:no-underline focus:no-underline base-card--link base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4012345678" data-impression-id="jobs-search-result-0">
    <a class="base-card__full-link absolute top-0 right-0 bottom-0 left-0 p-0 z-[2]" href="https://ca.linkedin.com/jobs/view/senior-tax-manager-at-maple-bank-4012345678?position=1&amp;pageNum=0&amp;refId=x&amp;trackingId=y" data-tracking-control-name="public_jobs_jserp-result_search-card">
      <span class="sr-only">Senior Tax Manager</span></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">
            Senior Tax Manager, Data Platform
      </h3>
      <h4 class="base-search-card__subtitle">
          <a class="hidden-nested-link" href="https://ca.linkedin.com/company/maple-bank?trk=x">Maple Bank</a>
      </h4>
      <div class="base-search-card__metadata">
          <span class="job-search-card__location">
            Toronto, Ontario, Canada
          </span>
          <span class="job-search-card__salary-info">CA$120,000.00 - CA$145,000.00</span>
          <time class="job-search-card__listdate--new" datetime="2026-10-19">1 day ago</time>
      </div>
    </div>
  </div>
</li>
<li>
  <div class="base-card job-search-card">
    <a class="base-card__full-link" href="https://ca.linkedin.com/jobs/view/tax-technology-lead-at-northwind-3998877665?position=2"></a>
    <h3 class="base-search-card__title">Data Engineering Lead</h3>
    <h4 class="base-search-card__subtitle"><a href="#">Northwind</a></h4>
    <span class="job-search-card__location">Mississauga, ON (Hybrid)</span>
    <time class="job-search-card__listdate" datetime="2026-10-14">6 days ago</time>
  </div>
</li>"##;
        let l = parse_linkedin_list(list);
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].id().as_str(), l[0].title.as_str(), l[0].company.as_str(), l[0].location.as_str()),
            ("linkedin:4012345678", "Senior Tax Manager, Data Platform", "Maple Bank", "Toronto, Ontario, Canada"));
        assert_eq!((l[0].posted_at.as_deref(), l[0].url.as_str()), (Some("2026-10-19"), "https://www.linkedin.com/jobs/view/4012345678/"));
        assert_eq!(l[0].salary_max, Some(145000.0));
        assert!(l[0].description.is_empty(), "read later, only when new");
        assert_eq!((l[1].external_id.as_str(), l[1].company.as_str()), ("3998877665", "Northwind"));
        let page = r#"<section class="description"><div class="description__text description__text--rich">
          <section class="show-more-less-html" data-max-lines="5"><div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative overflow-hidden">
            <p><strong>About the role</strong></p><ul><li>Lead Snowflake compliance for Canada.</li><li>Work with data engineering teams.</li></ul><p>Apply at careers@maple.example.</p>
          </div></section></div>
          <ul class="description__job-criteria-list"><li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3>
          <span class="description__job-criteria-text description__job-criteria-text--criteria">Mid-Senior level</span></li></ul></section>"#;
        let d = parse_linkedin_posting(page).unwrap();
        assert!(d.contains("Lead Snowflake compliance") && d.contains("Seniority level: Mid-Senior level"), "{d}");
        assert!(parse_linkedin_posting("<html>sign in</html>").is_none());
        let a = parse_apify_linkedin(&json!([
            { "id": "4012345678", "title": "Senior Tax Manager", "companyName": "Maple Bank", "location": "Toronto, Ontario, Canada",
              "link": "https://ca.linkedin.com/jobs/view/senior-tax-manager-at-maple-bank-4012345678", "descriptionText": "Lead Snowflake. Salary $120,000 - $145,000 per year.", "postedAt": "2026-10-19" },
            { "jobTitle": "Tax Analyst", "company": { "name": "Northwind" }, "jobUrl": "https://www.linkedin.com/jobs/view/3998877665/", "description": "<p>Hybrid role</p>" },
            { "title": "No id or link" }
        ]));
        assert_eq!(a.len(), 2);
        assert_eq!((a[0].id().as_str(), a[0].salary_max), ("linkedin:4012345678", Some(145000.0)));
        assert_eq!((a[1].external_id.as_str(), a[1].company.as_str(), a[1].description.trim()), ("3998877665", "Northwind", "Hybrid role"));
        assert!(linkedin_search_url("Tax Manager", "Toronto, ON", true).contains("keywords=Tax+Manager&location=Toronto%2C+ON&f_TPR=r604800&f_WT=2"));
    }

    #[test]
    fn jsearch_and_jooble() {
        let j = parse_jsearch(&json!({ "status": "OK", "data": [{ "job_id": "abc==", "employer_name": "Maple Bank", "job_title": "Senior Program Manager",
            "job_description": "Lead delivery of payments programs.", "job_apply_link": "https://careers.maplebank.example/1", "job_city": "Toronto",
            "job_state": "ON", "job_country": "CA", "job_is_remote": false, "job_posted_at_datetime_utc": "2026-10-14T12:00:00.000Z",
            "job_min_salary": 120000, "job_max_salary": 140000, "job_salary_period": "YEAR" },
            { "job_id": "x", "employer_name": "Shop", "job_title": "Delivery Lead", "job_description": "", "job_google_link": "https://g.example/x",
              "job_city": "", "job_state": "", "job_country": "CA", "job_is_remote": true, "job_min_salary": 50, "job_max_salary": 60, "job_salary_period": "HOUR",
              "job_highlights": { "Qualifications": ["PMP"] } }] }));
        assert_eq!((j[0].id().as_str(), j[0].location.as_str(), j[0].salary.as_deref(), j[0].salary_max), ("jsearch:abc==", "Toronto, ON, CA", Some("120,000–140,000"), Some(140000.0)));
        assert!(j[1].remote && j[1].url == "https://g.example/x" && j[1].description.contains("PMP"));
        assert_eq!((j[1].salary.as_deref(), j[1].salary_max), (Some("50–60/hour"), None));
        let o = parse_jooble(&json!({ "totalCount": 1, "jobs": [{ "title": "<b>Program</b> Manager", "location": "Toronto, ON", "snippet": "Lead programs&nbsp;...",
            "salary": "$110k", "source": "indeed.ca", "type": "Full-time", "link": "https://jooble.org/desc/1", "company": "Acme", "updated": "2026-10-14T00:00:00", "id": 123 }] }));
        assert_eq!((o[0].id().as_str(), o[0].title.as_str(), o[0].company.as_str()), ("jooble:123", "Program Manager", "Acme"));
        let p = crate::testkit::sample_profile();
        let q = searches(&p, 50);
        assert!(q.len() > 2 && q.len() < 50);
        // The GTA cities are one search around Toronto; each title is searched in every place before
        // the next. Senior versions come after every regular search.
        let first_senior = q.iter().position(|(t, _)| t.starts_with("Senior ") && !p.tracks.iter().any(|x| x.titles.contains(t))).unwrap();
        assert!(q[first_senior..].iter().all(|(t, _)| t.starts_with("Senior ")), "{q:?}");
        let places: Vec<&str> = q[..first_senior].iter().map(|(_, w)| w.as_str()).collect();
        assert_eq!(&places[..4], &["Toronto, ON", "Ontario", "Toronto, ON", "Ontario"], "{places:?}");
        assert_eq!(searches(&p, 3).len(), 3);
        // Two searches reach both places.
        assert_eq!(searches(&p, 2).iter().map(|(_, w)| w.as_str()).collect::<Vec<_>>(), vec!["Toronto, ON", "Ontario"]);
    }

    #[test]
    fn yearly_pay_ranges() {
        assert_eq!(salary_range("$110,000–$135,000"), Some((110000.0, 135000.0)));
        assert_eq!(salary_range("CAD 120K–150K"), Some((120000.0, 150000.0)));
        assert_eq!(salary_range("120,000–140,000"), Some((120000.0, 140000.0)));
        assert_eq!(salary_range("$95,000"), Some((95000.0, 95000.0)));
        assert_eq!(salary_range("$45–$55/hour"), None);
        assert_eq!(salary_range("Competitive"), None);
    }

    #[test]
    fn workday_company_codes_are_dropped() {
        assert_eq!(tidy_company("USA018 Thomson Reuters Holdings Inc."), "Thomson Reuters Holdings Inc.");
        assert_eq!(tidy_company("3M Canada"), "3M Canada");
        assert_eq!(tidy_company("TD Bank, N.A."), "TD Bank, N.A.");
    }

    #[test]
    fn closed_postings_are_recognised() {
        assert_eq!(closed_by_page(404, "https://x", ""), Some(true));
        assert_eq!(closed_by_page(200, "https://boards.greenhouse.io/acme?error=true", ""), Some(true));
        assert_eq!(closed_by_page(200, "https://x", "<h1>Program Manager</h1><p>No longer accepting applications</p>"), Some(true));
        assert_eq!(closed_by_page(200, "https://x", "<h1>Program Manager</h1><button>Apply</button>"), Some(false));
        assert_eq!(closed_by_page(403, "https://x", ""), None, "blocked: can't tell");
        let p = crate::testkit::sample_profile();
        assert!(wanted(&p, "Sr. Program Manager, Payments") && !wanted(&p, "Barista"));
        assert_eq!(board_prefix("greenhouse", "acme"), "greenhouse:acme-");
        assert_eq!(boards(&p).len(), 11);
    }

    #[test]
    fn apply_email_needs_a_hint() {
        assert_eq!(find_apply_email("Questions? Write to hr@x.com"), None);
        assert_eq!(find_apply_email("Send your CV to jobs@x.com."), Some("jobs@x.com".into()));
    }
}
