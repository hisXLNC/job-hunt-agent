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

    if let (Some(min), Some(max)) = (profile.min_salary, p.salary_max) {
        if max < min {
            return Some(format!("salary up to {max:.0}, below your minimum"));
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
    // Whole words: Milton isn't in "Hamilton", nor York in "New York".
    if places.iter().any(|l| has_words(&loc, l)) {
        return None;
    }
    let country = &profile.sources.adzuna_country;
    let in_country = crate::profile::country_names(country).iter().any(|c| has_words(&loc, c));
    // In a small country (Qatar, Bahrain, Singapore...) anywhere in it is within reach.
    if in_country && crate::profile::small_country(country) {
        return None;
    }
    // A location like "Remote - Canada" counts as remote even when the source doesn't flag it.
    let remote = p.remote || loc.contains("remote");
    if remote && profile.remote_ok && in_country {
        return None;
    }
    Some(format!("location “{}”", p.location))
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
        // A GTA city brings in the GTA, the same as Toronto; Milton doesn't match "Hamilton".
        let oakville = Profile { locations: vec!["Oakville".into()], include_metro: true, ..profile() };
        for (l, ok) in [("Mississauga, ON", true), ("Toronto, Ontario, Canada", true), ("Oakville, ON", true), ("Hamilton, ON", false), ("Guelph, ON", false)] {
            assert_eq!(prefilter(&Posting { location: l.into(), ..far.clone() }, &oakville).is_none(), ok, "{l}");
        }
        let alone = Profile { include_metro: false, ..oakville.clone() };
        assert!(prefilter(&Posting { location: "Mississauga, ON".into(), ..far.clone() }, &alone).is_some());
        assert_eq!(alone.search_places(), vec!["Oakville"], "on its own: searched around itself");
        assert_eq!(oakville.search_places(), vec!["Toronto, ON"], "the GTA: searched around Toronto");
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
