//! Who to write to at a company, found the way address finders do it: the addresses the company
//! shows in public, the pattern its people's addresses follow (first.last@, flast@…), and that
//! pattern applied to the name of the person to reach. An address worked out this way is a likely
//! one, and always said to be.

/// The ways companies write a person's address, commonest first.
pub const PATTERNS: &[&str] = &["first.last", "flast", "first", "firstlast", "first_last", "f.last", "firstl", "last", "first-last", "lastf", "last.first"];

/// A person's first and last name as addresses write them: letters only, lower case, without what
/// follows a comma ("Jane Doe, CPHR") or sits in brackets. None for a single name.
fn parts(name: &str) -> Option<(String, String)> {
    let name = name.split([',', '(', '|']).next().unwrap_or("");
    let words: Vec<String> = name.split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphabetic()).flat_map(|c| c.to_lowercase()).filter(|c| c.is_ascii_alphabetic()).collect::<String>())
        .filter(|w| !w.is_empty()).collect();
    (words.len() >= 2).then(|| (words[0].clone(), words[words.len() - 1].clone()))
}

/// The part before the @ for `name`, written as `pattern`.
pub fn local(pattern: &str, name: &str) -> Option<String> {
    let (first, last) = parts(name)?;
    let (f, l) = (&first[..1], &last[..1]);
    Some(match pattern {
        "first.last" => format!("{first}.{last}"),
        "flast" => format!("{f}{last}"),
        "first" => first.clone(),
        "firstlast" => format!("{first}{last}"),
        "first_last" => format!("{first}_{last}"),
        "f.last" => format!("{f}.{last}"),
        "firstl" => format!("{first}{l}"),
        "last" => last.clone(),
        "first-last" => format!("{first}-{last}"),
        "lastf" => format!("{last}{f}"),
        "last.first" => format!("{last}.{first}"),
        _ => return None,
    })
}

/// A shared mailbox, not a person's: nothing to learn a pattern from.
fn shared(local: &str) -> bool {
    is_hr(local) || ["info", "hello", "contact", "support", "sales", "press", "media", "admin", "office", "help", "team", "privacy", "legal", "marketing", "billing", "accounts",
        "enquiries", "inquiries", "service", "customerservice", "webmaster", "news", "investors", "ir", "security", "abuse", "feedback", "general", "reception"].contains(&local)
}

/// A mailbox for hiring or HR: where a note about an application belongs when there's no person.
pub fn is_hr(local: &str) -> bool {
    let l: String = local.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    ["career", "job", "recruit", "talent", "hiring", "humanresources", "resume", "staffing", "peopleteam", "peopleops", "peopleandculture", "employment", "applications", "apply"].iter().any(|w| l.contains(w))
        || ["hr", "ta", "people", "join", "work", "rh"].contains(&l.as_str())
}

/// How a company writes its people's addresses, from the ones known: `known` is (whose, address),
/// the name empty when a page gave the address alone. With names, the pattern most of them follow.
/// Without, only what two or more addresses of one shape show (jane.doe@ and sam.lee@: first.last).
/// Some((pattern, how many addresses showed it)).
pub fn pattern_of(known: &[(String, String)]) -> Option<(&'static str, usize)> {
    let mut votes: Vec<(&'static str, usize)> = vec![];
    for (name, email) in known {
        let l = email.split('@').next().unwrap_or("").to_lowercase();
        if let Some(p) = PATTERNS.iter().find(|p| local(p, name).is_some_and(|x| x == l)) {
            match votes.iter_mut().find(|v| v.0 == *p) { Some(v) => v.1 += 1, None => votes.push((p, 1)) }
        }
    }
    // (The commonest pattern wins a tie: PATTERNS is in that order.)
    if let Some(best) = votes.iter().max_by_key(|v| (v.1, std::cmp::Reverse(PATTERNS.iter().position(|p| *p == v.0)))) {
        return Some(*best);
    }
    let shape = |sep: char| known.iter().filter(|(_, e)| {
        let l = e.split('@').next().unwrap_or("").to_lowercase();
        let bits: Vec<&str> = l.split(sep).collect();
        !shared(&l) && bits.len() == 2 && bits.iter().all(|b| b.len() >= 2 && b.chars().all(|c| c.is_ascii_alphabetic()))
    }).count();
    [("first.last", '.'), ("first_last", '_'), ("first-last", '-')].into_iter().map(|(p, sep)| (p, shape(sep))).filter(|x| x.1 >= 2).max_by_key(|x| x.1)
}

/// Whether a domain takes mail at all (it has MX records), asked of a public DNS service. None
/// when that couldn't be asked.
pub fn has_mail(http: &reqwest::blocking::Client, domain: &str) -> Option<bool> {
    let v: serde_json::Value = http.get("https://dns.google/resolve").query(&[("name", domain), ("type", "MX")]).timeout(std::time::Duration::from_secs(8)).send().ok()?.json().ok()?;
    match v["Status"].as_i64()? {
        0 => Some(v["Answer"].as_array().is_some_and(|a| a.iter().any(|r| r["type"] == 15))),
        3 => Some(false),
        _ => None,
    }
}

/// Who a note about an application goes to, from what's known of the company's addresses:
/// (address, how it was found). `people`: who to reach, best first, by name. `known`: (whose,
/// address) pairs at `domain`. A person's likely address when the pattern is known, else the
/// company's hiring mailbox when it shows one, else nothing.
pub fn choose(company: &str, domain: &str, people: &[String], known: &[(String, String)]) -> Option<(String, String)> {
    let at_domain: Vec<(String, String)> = known.iter().filter(|(_, e)| e.to_lowercase().ends_with(&format!("@{domain}"))).cloned().collect();
    if let Some((pattern, n)) = pattern_of(&at_domain) {
        if let Some((name, l)) = people.iter().find_map(|p| local(pattern, p).map(|l| (p, l))) {
            return Some((format!("{l}@{domain}"), format!("A likely address for {name}, not a confirmed one: {company} writes its people's addresses as {pattern}@{domain} ({n} address{} it shows in public follow that). Check it before you send.", if n == 1 { "" } else { "es" })));
        }
    }
    at_domain.iter().map(|(_, e)| e.to_lowercase()).find(|e| is_hr(e.split('@').next().unwrap_or("")))
        .map(|e| (e, format!("{company}'s own hiring address, as it shows it in public.")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_companys_address_pattern_gives_a_persons_likely_address() {
        let k = |n: &str, e: &str| (n.to_string(), e.to_string());
        assert_eq!(local("first.last", "Priya Shah, CPHR").as_deref(), Some("priya.shah"));
        assert_eq!(local("flast", "Jean-Luc van der Berg (he/him)").as_deref(), Some("jberg"));
        assert_eq!(local("first.last", "Priya"), None);
        // From named addresses: what most of them follow.
        let known = vec![k("Dana Lee", "dlee@acme.com"), k("Sam Roy", "sroy@acme.com"), k("Ann Poe", "ann.poe@acme.com"), k("", "careers@acme.com")];
        assert_eq!(pattern_of(&known), Some(("flast", 2)));
        let (to, how) = choose("Acme", "acme.com", &["Priya Shah".into()], &known).unwrap();
        assert_eq!(to, "pshah@acme.com");
        assert!(how.contains("likely") && how.contains("flast@acme.com"), "{how}");
        // From addresses alone: only a shape two of them share; a shared mailbox says nothing.
        assert_eq!(pattern_of(&[k("", "jane.doe@acme.com"), k("", "sam.lee@acme.com"), k("", "info@acme.com")]), Some(("first.last", 2)));
        assert_eq!(pattern_of(&[k("", "jane.doe@acme.com"), k("", "press.office@acme.com").clone()]).map(|p| p.0), Some("first.last"));
        assert_eq!(pattern_of(&[k("", "jdoe@acme.com"), k("", "info@acme.com")]), None);
        // Nobody to name, or no pattern: the hiring mailbox, when there is one; addresses elsewhere don't count.
        assert_eq!(choose("Acme", "acme.com", &[], &known).unwrap().0, "careers@acme.com");
        assert_eq!(choose("Acme", "acme.com", &["Priya Shah".into()], &[k("", "talent.acquisition@acme.com")]).unwrap().0, "talent.acquisition@acme.com");
        assert!(choose("Acme", "acme.com", &["Priya Shah".into()], &[k("Dana Lee", "dlee@other.com"), k("", "info@acme.com")]).is_none());
        assert!(is_hr("HR") && is_hr("talent-acquisition") && is_hr("careers.ca") && !is_hr("chris") && !is_hr("info"));
    }
}
