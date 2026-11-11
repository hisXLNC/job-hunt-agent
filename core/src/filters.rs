//! Cheap rule-based filtering, run before anything is sent to Claude.

use crate::profile::Profile;
use crate::sources::Posting;

/// Words of a title, lowercased, with common abbreviations spelled out.
fn title_words(t: &str) -> Vec<String> {
    t.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| match w {
            "sr" => "senior",
            "jr" => "junior",
            "mgr" => "manager",
            "pm" => "manager",
            "tpm" => "manager",
            "mngr" => "manager",
            "dir" => "director",
            "eng" => "engineering",
            "tech" => "technical",
            "programme" => "program",
            w => w,
        })
        .map(String::from)
        .collect()
}

/// Seniority and filler words that don't change what a role is.
const LOOSE: &[&str] = &["senior", "lead", "principal", "staff", "head", "chief", "associate", "of", "the", "and", "for", "a", "i", "ii", "iii", "iv", "1", "2", "3"];

/// Whether a posting title is the same kind of role as a target title: every meaningful word of the
/// target appears in the posting, in any order. "Senior Program Manager" matches "Sr. Program Manager,
/// Payments" and "Program Manager II"; "Program Manager" doesn't match "Product Manager".
pub fn title_matches(posting: &str, target: &str) -> bool {
    let have = title_words(posting);
    let need: Vec<String> = title_words(target).into_iter().filter(|w| !LOOSE.contains(&w.as_str())).collect();
    !need.is_empty() && need.iter().all(|w| have.contains(w))
}

/// When a posting went up, as a date: "2026-10-14", "2026-10-14T09:00:00Z" or a timestamp in
/// seconds or milliseconds. None when it can't tell.
pub fn posted_date(posted: &str) -> Option<chrono::NaiveDate> {
    let t = posted.trim();
    if let Ok(n) = t.parse::<i64>() {
        let secs = if n > 100_000_000_000 { n / 1000 } else { n };
        return chrono::DateTime::from_timestamp(secs, 0).map(|d| d.date_naive());
    }
    chrono::NaiveDate::parse_from_str(t.get(..10)?, "%Y-%m-%d").ok()
}

/// Days since a posting went up (see posted_date).
pub fn days_since(posted: &str) -> Option<i64> {
    posted_date(posted).map(|d| (chrono::Utc::now().date_naive() - d).num_days())
}

/// Why a posting should be skipped, or None if it is worth scoring.
pub fn prefilter(p: &Posting, profile: &Profile) -> Option<String> {
    let title = p.title.to_lowercase();
    let company = p.company.to_lowercase();

    if profile.exclude_companies.iter().any(|c| c.trim().to_lowercase() == company) {
        return Some("excluded company".into());
    }
    for kw in &profile.exclude_title_keywords {
        if !kw.trim().is_empty() && title.contains(&kw.trim().to_lowercase()) {
            return Some(format!("title contains “{}”", kw.trim()));
        }
    }

    if let Some(why) = outside_locations(p, profile) {
        return Some(why);
    }

    // Too old to be worth scoring (an open role's first weeks are when it's filled).
    if profile.max_age_days > 0 {
        if let Some(days) = p.posted_at.as_deref().and_then(days_since) {
            if days > profile.max_age_days as i64 {
                return Some(format!("posted {days} days ago, older than your cutoff of {} days", profile.max_age_days));
            }
        }
    }

    // The most it pays: the source's figure, else its salary text or its own description (hourly
    // rates as a year of 2,080 hours), so a low-paid job isn't scored just because the job site
    // didn't fill in the salary field.
    if let Some(min) = profile.min_salary {
        let max = p.salary_max
            .or_else(|| p.salary.as_deref().and_then(crate::sources::pay_max_in))
            .or_else(|| crate::sources::pay_max_in(&p.description.chars().take(20000).collect::<String>()));
        if let Some(max) = max.filter(|m| *m < min) {
            return Some(format!("salary up to {max:.0} a year, below your minimum of {min:.0}"));
        }
    }

    let head: String = p.description.chars().take(3000).collect::<String>().to_lowercase();
    let text = format!("{title}\n{head}");
    for t in &profile.tracks {
        if t.titles.iter().any(|x| title_matches(&p.title, x)) {
            return None;
        }
        if t.keywords.iter().any(|k| !k.trim().is_empty() && text.contains(&k.trim().to_lowercase())) {
            return None;
        }
    }
    Some(NO_TITLE_MATCH.into())
}

/// Whether `hay` has `words` as whole words: "uk" is in "London, UK" but not in "Milwaukee".
pub fn has_words(hay: &str, words: &str) -> bool {
    let w = |c: char| c.is_alphanumeric();
    hay.match_indices(words).any(|(i, _)| {
        !hay[..i].chars().next_back().is_some_and(w) && !hay[i + words.len()..].chars().next().is_some_and(w)
    })
}

/// Why a posting isn't in one of your places, or None when it is. A remote role counts only when
/// it's based in one of your places or open across your country ("Remote - Canada"); a posting
/// that doesn't say where it is is left out too.
pub fn outside_locations(p: &Posting, profile: &Profile) -> Option<String> {
    let places = profile.place_names();
    if places.is_empty() {
        return None; // no locations set: anywhere
    }
    let loc = p.location.to_lowercase();
    if loc.trim().is_empty() {
        return Some("location not given".into());
    }
    let country = &profile.sources.adzuna_country;
    let in_country = crate::profile::country_names(country).iter().any(|c| has_words(&loc, c));
    // Whole words: Milton isn't in "Hamilton", nor York in "New York". A place of the same name in
    // another country ("London, United Kingdom" when you're in London, Ontario) doesn't count.
    if places.iter().any(|l| has_words(&loc, l)) && (in_country || !in_other_country(&loc, country)) {
        return None;
    }
    // In a small country (Qatar, Bahrain, Singapore...) anywhere in it is within reach.
    if in_country && crate::profile::small_country(country) {
        return None;
    }
    // A location like "Remote - Canada" counts as remote even when the source doesn't flag it; a
    // hybrid one ("Hybrid remote in Ottawa, ON") doesn't.
    let remote = (p.remote || loc.contains("remote")) && !loc.contains("hybrid");
    // A remote role based in another city ("Ottawa, ON (Remote)") is fine when it's fully remote,
    // and out when its text ties you to that city: hybrid, office days, living there.
    let tied = names_other_city(&loc, profile) && tied_to_its_city(&p.description);
    if remote && profile.remote_ok && in_country && !tied {
        return None;
    }
    // "Remote - Ontario", or remote and based elsewhere in your province: open to you.
    let in_province = profile.home_provinces().iter().any(|full| {
        has_words(&loc, &full.to_lowercase())
            || crate::profile::PROVINCES.iter().any(|(c, short, f)| f == full && c.eq_ignore_ascii_case(&profile.sources.adzuna_country) && has_words(&loc, &short.to_lowercase()))
    });
    if remote && profile.remote_ok && !tied && in_province {
        return None;
    }
    Some(format!("location “{}”", p.location))
}

/// Whether a remote posting's text ties you to its city after all: hybrid work, days in the office or
/// on site, commuting, or having to live in or near it. A posting without its text yet (LinkedIn's
/// lists) isn't tied; it's checked again once its text is read.
fn tied_to_its_city(description: &str) -> bool {
    static TIED: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(
        r"(?i)\bhybrid\b|\b(in[- ]office|on[- ]?site|in[- ]person) (days?|work|presence|attendance|requirement)|\b(\d|one|two|three|four)\s*(\+\s*)?days?\s*(a|per|each|/)\s*week\s*(in|at)\s*(the|our)?\s*(office|site)|\boffice days?\b|\bcommut(e|ing)\b|\bmust (reside|live|be (located|based)) (in|within|near)\b|\b(located|reside|live) within \d+\s*(km|kilomet|miles?)|\bwithin commuting distance\b|\breport(ing)? to (the|our) office\b"
    ).unwrap());
    let head: String = description.chars().take(12000).collect();
    TIED.is_match(&head)
}

/// Whether a (lowercased) location starts with a city that isn't one of yours: "ottawa, on (remote)"
/// does, "remote - ontario", "ontario, canada (remote)" and "canada" don't.
fn names_other_city(loc: &str, profile: &Profile) -> bool {
    let first = loc.split([',', '(', '|', '·', '/']).next().unwrap_or("").replace("remote", "").replace(" in ", " ").replace(['-', '–'], " ");
    let first = first.trim();
    if first.is_empty() || ["hybrid", "remote", "anywhere", "work from home", "wfh"].contains(&first) {
        return false;
    }
    let country = &profile.sources.adzuna_country;
    let region = crate::profile::country_names(country).iter().any(|c| first == c.as_str())
        || crate::profile::PROVINCES.iter().any(|(_, full, short)| first == full.to_lowercase() || first == short.to_lowercase());
    !region && !profile.place_names().iter().any(|l| has_words(first, l) || has_words(l, first))
}

/// Whether a (lowercased) location names a country other than yours.
fn in_other_country(loc: &str, yours: &str) -> bool {
    crate::profile::COUNTRIES.iter().filter(|c| !c.0.eq_ignore_ascii_case(yours))
        .any(|c| std::iter::once(c.1).chain(c.2.iter().copied()).any(|n| has_words(loc, &n.to_lowercase())))
}

/// The reason given when a posting's title and text match none of your CVs' titles or keywords.
pub const NO_TITLE_MATCH: &str = "no title or keyword match";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::Track;

    fn profile() -> Profile {
        Profile {
            locations: vec!["Toronto".into()],
            exclude_title_keywords: vec!["intern".into()],
            min_salary: Some(120000.0),
            tracks: vec![Track { name: "p".into(), titles: vec!["Program Manager".into()], keywords: vec!["snowflake".into()], ..Track::default() }],
            ..Profile::default()
        }
    }

    #[test]
    fn remote_roles_tied_to_another_city() {
        let mut p = Profile { locations: vec!["Oakville".into(), "Toronto".into()], remote_ok: true, ..Profile::default() };
        p.sources.adzuna_country = "ca".into();
        let out = |loc: &str| outside_locations(&Posting { location: loc.into(), ..Posting::default() }, &p).is_some();
        let out_with = |loc: &str, text: &str| outside_locations(&Posting { location: loc.into(), description: text.into(), ..Posting::default() }, &p).is_some();
        // Based in Ottawa but fully remote: you can work from Toronto.
        assert!(!out("Ottawa, Ontario (Remote)") && !out("Ottawa, ON, Canada (Remote)"), "remote, nothing tying it to Ottawa");
        assert!(!out_with("Ottawa, ON (Remote)", "This is a fully remote role open to candidates anywhere in Canada."));
        // Remote in name, tied to Ottawa in the text: out.
        assert!(out_with("Ottawa, ON (Remote)", "Hybrid: 2 days a week in the office."));
        assert!(out_with("Ottawa, Ontario (Remote)", "Candidates must reside in the National Capital Region."));
        assert!(out_with("Ottawa, ON (Remote)", "Remote with occasional commuting to our Ottawa office."));
        assert!(!out_with("Toronto, ON (Remote)", "Hybrid, 3 days a week in the office."), "your own city: hybrid is fine");
        assert!(!out("Remote - Ontario"), "open across your province");
        assert!(!out("Remote, Canada") && !out("Canada (Remote)") && !out("Ontario, Canada (Remote)"));
        assert!(!out("Toronto, ON (Remote)") && !out("Ottawa or Toronto, ON") && !out("Oakville, ON"));
        assert!(out("Ottawa, ON") && out("Hybrid remote in Ottawa, ON"));
    }

    fn posting(title: &str) -> Posting {
        Posting { source: "t".into(), external_id: "1".into(), company: "Co".into(), title: title.into(), location: "Toronto, ON".into(), ..Posting::default() }
    }

    #[test]
    fn titles_match_loosely() {
        assert!(title_matches("Sr. Program Manager, Payments", "Senior Program Manager"));
        assert!(title_matches("Program Manager II - Technology", "Senior Program Manager"));
        assert!(title_matches("Lead, Digital Transformation (Manager)", "Digital Transformation Manager"));
        assert!(title_matches("Technical Program Manager", "Program Manager"));
        assert!(title_matches("Programme Manager", "Program Manager"));
        assert!(!title_matches("Product Manager", "Program Manager"));
        assert!(!title_matches("Software Engineer", "Technical Program Manager"));
        assert!(!title_matches("Anything", "Senior"), "a target of only filler words matches nothing");
        for t in ["Senior Business Analyst", "Sr. Business Analyst", "Lead Business Analyst", "Business Analyst II", "Principal Business Analyst"] {
            assert!(title_matches(t, "Business Analyst"), "{t}");
        }
    }

    #[test]
    fn rules() {
        let p = profile();
        assert_eq!(prefilter(&posting("Program Manager"), &p), None);
        assert_eq!(prefilter(&posting("Program Manager Intern"), &p).unwrap(), "title contains “intern”");
        let far = Posting { location: "Vancouver, BC".into(), ..posting("Program Manager") };
        assert!(prefilter(&far, &p).unwrap().starts_with("location"));
        assert!(prefilter(&Posting { remote: true, ..far.clone() }, &p).is_some(), "remote, but based outside your places");
        assert_eq!(prefilter(&Posting { location: "Remote - Canada".into(), ..far.clone() }, &p), None, "remote across your country");
        assert!(prefilter(&Posting { location: "Remote Wilmington (DE)".into(), remote: true, ..far.clone() }, &p).is_some(), "remote in the US");
        assert!(prefilter(&Posting { location: "United States of America, New York, New York".into(), ..far.clone() }, &p).is_some());
        assert_eq!(prefilter(&Posting { location: "United States of America, Frisco, Texas; Canada, Toronto, Ontario".into(), ..far.clone() }, &p), None, "one of its places is yours");
        assert_eq!(prefilter(&Posting { location: "Remote - Toronto".into(), remote: true, ..far.clone() }, &p), None);
        assert!(prefilter(&Posting { location: String::new(), ..far.clone() }, &p).is_some(), "no location given");
        let gta = Profile { locations: vec!["GTA".into()], ..profile() };
        assert_eq!(prefilter(&Posting { location: "Mississauga, ON".into(), ..far.clone() }, &gta), None);
        let no_remote = Profile { remote_ok: false, ..profile() };
        assert!(prefilter(&Posting { location: "Remote - Canada".into(), ..far.clone() }, &no_remote).is_some());
        assert!(prefilter(&Posting { salary_max: Some(90000.0), ..posting("Program Manager") }, &p).unwrap().starts_with("salary"));
        assert_eq!(prefilter(&Posting { description: "Implement Snowflake rules".into(), ..posting("Tax Analyst") }, &p), None);
        assert_eq!(prefilter(&posting("Barista"), &p).unwrap(), "no title or keyword match");
        // Too old: set aside before scoring (30 days by default); no date, or 0 days, keeps it.
        let old = (chrono::Utc::now() - chrono::Duration::days(45)).format("%Y-%m-%d").to_string();
        let fresh = (chrono::Utc::now() - chrono::Duration::days(3)).to_rfc3339();
        assert!(prefilter(&Posting { posted_at: Some(old.clone()), ..posting("Program Manager") }, &p).unwrap().starts_with("posted 45 days ago"));
        assert_eq!(prefilter(&Posting { posted_at: Some(fresh), ..posting("Program Manager") }, &p), None);
        assert_eq!(prefilter(&Posting { posted_at: Some(old.clone()), ..posting("Program Manager") }, &Profile { max_age_days: 0, ..p.clone() }), None);
        assert_eq!(days_since(&(chrono::Utc::now() - chrono::Duration::days(10)).timestamp_millis().to_string()), Some(10));
        // A GTA city brings in the GTA, the same as Toronto; Milton doesn't match "Hamilton".
        let oakville = Profile { locations: vec!["Oakville".into()], include_metro: true, ..profile() };
        for (l, ok) in [("Mississauga, ON", true), ("Toronto, Ontario, Canada", true), ("Oakville, ON", true), ("Hamilton, ON", false), ("Guelph, ON", false)] {
            assert_eq!(prefilter(&Posting { location: l.into(), ..far.clone() }, &oakville).is_none(), ok, "{l}");
        }
        let alone = Profile { include_metro: false, ..oakville.clone() };
        assert!(prefilter(&Posting { location: "Mississauga, ON".into(), ..far.clone() }, &alone).is_some());
        assert_eq!(alone.search_places(), vec!["Oakville"], "on its own: searched around itself");
        assert_eq!(oakville.search_places(), vec!["Oakville, ON", "Toronto, ON"], "the GTA: around Oakville and around Toronto");
        // Written with its province, the way people type it, Oakville still brings in the GTA.
        for written in ["Oakville, ON", "Oakville, Ontario", "Oakville, ON, Canada", "oakville"] {
            let o = Profile { locations: vec![written.into()], ..oakville.clone() };
            for (l, ok) in [("Oakville, Ontario, Canada", true), ("Mississauga, ON", true), ("Burlington, ON", true), ("Meadowvale, ON", true),
                ("Toronto, ON", true), ("Peel Region, ON", true), ("GTA", true), ("Hamilton, ON", false), ("Vancouver, BC", false)] {
                assert_eq!(prefilter(&Posting { location: l.into(), ..far.clone() }, &o).is_none(), ok, "{written}: {l}");
            }
            assert_eq!(o.search_places().last().unwrap(), "Toronto, ON", "{written}");
        }
        let gta_only = Profile { locations: vec!["GTA".into()], ..profile() };
        assert_eq!(gta_only.search_places(), vec!["Toronto, ON"], "the area itself: one search around its centre");
        let gta_on = Profile { locations: vec!["Greater Toronto Area, ON".into()], include_metro: false, ..profile() };
        assert_eq!(prefilter(&Posting { location: "Oakville, ON".into(), ..far.clone() }, &gta_on), None);
        // Remote across your province, but not someone else's.
        assert_eq!(prefilter(&Posting { location: "Remote - Ontario".into(), ..far.clone() }, &oakville), None);
        assert!(prefilter(&Posting { location: "Remote - Alberta".into(), ..far.clone() }, &oakville).is_some());
        // London, Ontario isn't London, England.
        let ldn = Profile { locations: vec!["London, ON".into()], ..profile() };
        assert_eq!(prefilter(&Posting { location: "London, Ontario".into(), ..far.clone() }, &ldn), None);
        assert!(prefilter(&Posting { location: "London, England, United Kingdom".into(), ..far.clone() }, &ldn).is_some());
        // Qatar: a small country, so anywhere in it is in reach of Doha.
        let mut kw = Profile { locations: vec!["Doha".into()], remote_ok: false, ..profile() };
        kw.sources.adzuna_country = "qa".into();
        assert_eq!(prefilter(&Posting { location: "Al Rayyan, Qatar".into(), ..far.clone() }, &kw), None);
        assert!(prefilter(&Posting { location: "Riyadh, Saudi Arabia".into(), ..far.clone() }, &kw).is_some());
        let mut uk = Profile { locations: vec!["London".into()], ..profile() };
        uk.sources.adzuna_country = "gb".into();
        assert_eq!(prefilter(&Posting { location: "Remote, UK".into(), ..far.clone() }, &uk), None);
        assert!(prefilter(&Posting { location: "Remote - Milwaukee".into(), ..far.clone() }, &uk).is_some(), "\"uk\" only as a word");
        let anywhere = Profile { locations: vec![], ..profile() };
        assert_eq!(prefilter(&Posting { location: "Berlin".into(), ..posting("Program Manager") }, &anywhere), None);
        let ex = Profile { exclude_companies: vec!["co".into()], ..profile() };
        assert_eq!(prefilter(&posting("Barista"), &ex).unwrap(), "excluded company");
    }
}
