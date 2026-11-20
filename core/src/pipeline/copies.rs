//! The same job listed more than once: on the company's own site and on job boards, or posted
//! again later. The first listing found is the job; the others are kept beside it, you're told
//! when one turns up for a job you're still deciding on or have applied to, and the job's page
//! sets them side by side with what differs (pay, place, title, dates, the text).

use super::*;

/// Where a listing is, as you'd say it: the site's name without "www.".
fn site(url: &str) -> String {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_lowercase())).unwrap_or_default()
}

/// A posting's text as the sentences and bullet lines that say something (30 letters or more),
/// each with the form it's compared in: lower case, letters and digits only.
fn lines(text: &str) -> Vec<(String, String)> {
    text.split(['\n', '\r']).flat_map(|l| l.split(". ")).filter_map(|l| {
        let shown = l.trim().trim_start_matches(['-', '•', '*', '·', '–']).trim();
        let key: String = shown.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
        (key.chars().count() >= 30).then(|| (shown.to_string(), key))
    }).collect()
}

/// The amounts of money a pay line names, to tell "$120,000 - $150,000" from "$120k-150k" (the
/// same) and from "$110,000 - $140,000" (not).
fn amounts(pay: &str) -> Vec<i64> {
    static N: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?i)(\d[\d,]*(?:\.\d+)?)\s*(k\b)?").unwrap());
    let mut out: Vec<i64> = N.captures_iter(pay).filter_map(|c| {
        let n: f64 = c[1].replace(',', "").parse().ok()?;
        let n = if c.get(2).is_some() { n * 1000.0 } else { n };
        (n >= 10.0).then_some(n.round() as i64)
    }).collect();
    out.sort();
    out.dedup();
    out
}

/// A job board as people call it, from its address: "ca.indeed.com" is Indeed.
fn board_name(site: &str) -> Option<String> {
    let parts: Vec<&str> = site.split('.').collect();
    // The name before the ending ("indeed" in ca.indeed.com, "jobbank" in jobbank.gc.ca).
    let ending = if parts.len() >= 3 && ["co", "com", "gc", "org", "net"].contains(&parts[parts.len() - 2]) && parts[parts.len() - 1].len() == 2 { 2 } else { 1 };
    let name = parts.len().checked_sub(ending + 1).and_then(|i| parts.get(i))?;
    Some(match *name {
        "linkedin" => "LinkedIn".into(),
        "ziprecruiter" => "ZipRecruiter".into(),
        "simplyhired" => "SimplyHired".into(),
        "google" => "Google for Jobs".into(),
        n => { let mut c = n.chars(); c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str())? }
    })
}

/// One listing as the page shows it.
struct Listing {
    posting_id: String,
    source: String,
    url: String,
    title: String,
    location: String,
    salary: Option<String>,
    posted_at: Option<String>,
    found_at: String,
    last_at: Option<String>,
    description: String,
}

impl Listing {
    /// How the comparison names it: the company's own site, or the site it's on.
    fn name(&self) -> String {
        if self.url.starts_with("http") && !crate::sources::is_job_board(&self.url) {
            "the company's site".into()
        } else {
            board_name(&site(&self.url)).unwrap_or_else(|| self.source.clone())
        }
    }
}

impl Agent {
    /// A job with its other listings, and what differs between them. Null when it has none.
    /// {listings: [{posting_id, source, site, company_site, url, title, location, salary,
    /// posted_at, found_at, last_at, first, words, same (share of this listing's text that the
    /// first one has too, 0 to 100), only_here: [lines the first listing doesn't have]}],
    /// differences: [what to know], apply_at: the listing on the company's own site, if any}
    pub fn copies_view(&self, job: &Job) -> Value {
        let copies = self.db().copies_of(&job.id).unwrap_or_default();
        if copies.is_empty() {
            return Value::Null;
        }
        let first = Listing { posting_id: job.id.clone(), source: job.source.clone(), url: job.url.clone(), title: job.title.clone(), location: job.location.clone(),
            salary: job.salary.clone(), posted_at: job.posted_at.clone(), found_at: job.found_at.clone(), last_at: None, description: job.description.clone() };
        let mut all = vec![first];
        all.extend(copies.into_iter().map(|(first_at, last_at, p): (String, String, Posting)| Listing { posting_id: p.id(), source: p.source, url: p.url, title: p.title, location: p.location,
            salary: p.salary, posted_at: p.posted_at, found_at: first_at, last_at: Some(last_at), description: p.description }));
        let base = lines(&all[0].description);
        let base_keys: HashSet<&str> = base.iter().map(|(_, k)| k.as_str()).collect();
        let mut differences: Vec<String> = vec![];

        // Pay: shown on one and not another, or two different ranges.
        let paid: Vec<(String, String, Vec<i64>)> = all.iter().filter_map(|l| { let s = l.salary.clone().filter(|s| !s.trim().is_empty())?; Some((l.name(), s.clone(), amounts(&s))) }).collect();
        if !paid.is_empty() && paid.len() < all.len() {
            let without: Vec<String> = all.iter().filter(|l| l.salary.as_deref().is_none_or(|s| s.trim().is_empty())).map(|l| l.name()).collect();
            differences.push(format!("Pay is shown on {} ({}) but not on {}.", paid[0].0, paid[0].1, list(&without)));
        }
        if let Some(other) = paid.iter().skip(1).find(|p| !p.2.is_empty() && !paid[0].2.is_empty() && p.2 != paid[0].2) {
            differences.push(format!("The pay differs: {} on {}, {} on {}.", paid[0].1, paid[0].0, other.1, other.0));
        }
        // Place and title, said differently.
        let plain = |s: &str| s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
        if let Some(other) = all.iter().skip(1).find(|l| !l.location.trim().is_empty() && !all[0].location.trim().is_empty() && plain(&l.location) != plain(&all[0].location)) {
            differences.push(format!("The place differs: {} on {}, {} on {}.", all[0].location, all[0].name(), other.location, other.name()));
        }
        if let Some(other) = all.iter().skip(1).find(|l| plain(&l.title) != plain(&all[0].title)) {
            differences.push(format!("The title differs: \u{201c}{}\u{201d} on {}, \u{201c}{}\u{201d} on {}.", all[0].title, all[0].name(), other.title, other.name()));
        }
        // Posted weeks apart: listed again.
        let dated: Vec<(chrono::DateTime<Utc>, String)> = all.iter().filter_map(|l| Some((posted_date(l.posted_at.as_deref()?)?, l.name()))).collect();
        if let (Some(early), Some(late)) = (dated.iter().min_by_key(|d| d.0), dated.iter().max_by_key(|d| d.0)) {
            let days = (late.0 - early.0).num_days();
            if days >= 14 {
                differences.push(format!("Posted {days} days apart: {} on {}, {} on {}. It has been open a while, or was listed again.", early.0.format("%b %-d"), early.1, late.0.format("%b %-d"), late.1));
            }
        }

        let mut apply_at = Value::Null;
        let listings: Vec<Value> = all.iter().enumerate().map(|(i, l)| {
            let mine = lines(&l.description);
            let only: Vec<&str> = if i == 0 { vec![] } else { mine.iter().filter(|(_, k)| !base_keys.contains(k.as_str())).map(|(s, _)| s.as_str()).collect() };
            let same = if i == 0 || mine.is_empty() { Value::Null } else { json!(((mine.len() - only.len()) * 100) / mine.len()) };
            let company_site = l.url.starts_with("http") && !crate::sources::is_job_board(&l.url);
            if company_site && apply_at.is_null() {
                apply_at = json!(l.url);
            }
            if i > 0 && !mine.is_empty() && !base.is_empty() && only.len() * 3 >= mine.len() && only.len() >= 3 {
                differences.push(format!("The text on {} says things the first listing doesn't ({} of its {} lines): read both before you tailor.", l.name(), only.len(), mine.len()));
            }
            json!({ "posting_id": l.posting_id, "source": l.source, "site": site(&l.url), "company_site": company_site, "url": l.url, "title": l.title, "location": l.location,
                "salary": l.salary, "posted_at": l.posted_at, "found_at": l.found_at, "last_at": l.last_at, "first": i == 0,
                "words": l.description.split_whitespace().count(), "same": same,
                "only_here": only.iter().take(8).map(|s| s.chars().take(260).collect::<String>()).collect::<Vec<_>>(), "only_count": only.len() })
        }).collect();
        if differences.is_empty() {
            differences.push("They say the same: the same pay, place and title, and the same text.".into());
        }
        json!({ "listings": listings, "differences": differences, "apply_at": apply_at })
    }

    /// Jobs that got another listing in a search: said once each (three at most a search), for the
    /// ones you're deciding on or have applied to, and written in the job's history.
    pub(crate) fn note_copies(&self, ids: &[String]) {
        let mut told = 0;
        let mut seen: HashSet<&str> = HashSet::new();
        let mut more = 0;
        for id in ids {
            if !seen.insert(id.as_str()) {
                continue;
            }
            let Some(job) = self.db().job(id).ok().flatten() else { continue };
            let v = self.copies_view(&job);
            let Some(listings) = v["listings"].as_array() else { continue };
            let places: Vec<String> = listings.iter().skip(1).map(|l| if l["company_site"] == true { "the company's site".to_string() } else { l["site"].as_str().and_then(board_name).unwrap_or_else(|| "another site".into()) }).collect();
            let _ = self.db().log(Some(id), "copies", &format!("also listed on {}", list(&places)));
            if !["queued", "ready", "approved", "saved", "applied", "interviewing"].contains(&job.status.as_str()) {
                continue;
            }
            if told >= 3 {
                more += 1;
                continue;
            }
            told += 1;
            let differs = v["differences"].as_array().and_then(|d| d.first()).and_then(|d| d.as_str()).unwrap_or("");
            self.note(&format!("Same job, {} listings: {} at {}", listings.len(), job.title, job.company),
                &format!("Also on {}. {differs} Compare them on the job's page in Job Hunt.", list(&places)));
        }
        if more > 0 {
            self.note(&format!("{more} more job{} listed in several places", if more == 1 { " is" } else { "s are" }), "Each job's page compares its listings.");
        }
    }
}

/// "a", "a and b", "a, b and c".
fn list(items: &[String]) -> String {
    let mut seen: Vec<&str> = vec![];
    for i in items {
        if !seen.contains(&i.as_str()) {
            seen.push(i);
        }
    }
    match seen.len() {
        0 => String::new(),
        1 => seen[0].to_string(),
        n => format!("{} and {}", seen[..n - 1].join(", "), seen[n - 1]),
    }
}

impl Agent {
    /// Marked applied by Job Hunt itself (it read a page or an email as a confirmation), and still
    /// there: why, and the stage it was at before, so one press puts it back. Null otherwise.
    pub fn applied_by_itself(&self, job: &Job) -> Value {
        if job.status != "applied" {
            return Value::Null;
        }
        let stages: Vec<crate::db::Event> = self.db().events_of_job(&job.id).unwrap_or_default().into_iter().filter(|e| e.kind.starts_with("status:")).collect();
        let Some(last) = stages.last() else { return Value::Null };
        if last.kind != "status:applied" || last.by != "jobhunt" {
            return Value::Null;
        }
        let was = stages.iter().rev().skip(1).map(|e| e.kind[7..].to_string()).find(|k| k != "applied")
            .unwrap_or_else(|| if job.cv_path.is_some() { "ready".into() } else { "queued".into() });
        json!({ "why": last.detail, "at": last.created_at, "was": was })
    }

    /// "Not sent": back to the stage it was at, and no longer counted as an application.
    pub fn not_applied(&self, job_id: &str) -> R<String> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let v = self.applied_by_itself(&job);
        let Some(was) = v["was"].as_str() else { return err("This one wasn't marked as applied by Job Hunt itself. Use Change stage.") };
        let db = self.db();
        db.set_status(job_id, was, "you said it wasn't sent: Job Hunt had marked it applied by itself")?;
        db.update_job(job_id, &[("applied_at", Value::Null)])?;
        Ok(was.to_string())
    }
}
