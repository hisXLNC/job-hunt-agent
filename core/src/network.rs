//! People you know: your LinkedIn connections (from LinkedIn's own data export), matched to the
//! companies you're applying to, so you can ask one of them for a referral.

use crate::pipeline::Agent;
use crate::recruiters::company_key;
use crate::{err, R};
use serde_json::{json, Value};

const KEY: &str = "network";

/// One connection: name, company, position, email (LinkedIn only shares it when they allowed it), profile link.
pub fn list(agent: &Agent) -> Vec<Value> {
    serde_json::from_str(&agent.secret(KEY)).unwrap_or_default()
}

/// The fields of one CSV line, with quoted fields (commas and doubled quotes inside).
fn fields(line: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted, mut chars) = (vec![], String::new(), false, line.chars().peekable());
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out.into_iter().map(|f| f.trim().to_string()).collect()
}

/// LinkedIn's Connections.csv: a few lines of notes, then "First Name,Last Name,URL,Email Address,
/// Company,Position,Connected On". Only people with a company are kept.
pub fn parse(csv: &str) -> R<Vec<Value>> {
    let csv = csv.trim_start_matches('\u{feff}');
    let mut lines = csv.lines().skip_while(|l| !l.to_lowercase().contains("first name"));
    let Some(head) = lines.next() else {
        return err("That isn't LinkedIn's Connections.csv: it has no \"First Name\" column. In LinkedIn: Me \u{2192} Settings \u{2192} Data privacy \u{2192} Get a copy of your data \u{2192} Connections.");
    };
    let head: Vec<String> = fields(head).iter().map(|h| h.to_lowercase()).collect();
    let col = |name: &str| head.iter().position(|h| h == name);
    let (first, last, url, email, company, position) = (col("first name"), col("last name"), col("url"), col("email address"), col("company"), col("position"));
    let Some(company) = company else { return err("That file has no Company column.") };
    let mut out = vec![];
    for l in lines.filter(|l| !l.trim().is_empty()) {
        let f = fields(l);
        let get = |i: Option<usize>| i.and_then(|i| f.get(i)).cloned().unwrap_or_default();
        let name = format!("{} {}", get(first), get(last)).trim().to_string();
        if name.is_empty() || get(Some(company)).is_empty() {
            continue;
        }
        out.push(json!({ "name": name, "company": get(Some(company)), "position": get(position), "email": get(email), "link": get(url) }));
    }
    Ok(out)
}

/// Replace your connections with this export. Returns how many were kept.
pub fn import(agent: &Agent, csv: &str) -> R<usize> {
    let list = parse(csv)?;
    if list.is_empty() {
        return err("No connections with a company in that file.");
    }
    agent.db().set(KEY, &json!(list).to_string())?;
    agent.db().set("network.at", &chrono::Utc::now().to_rfc3339())?;
    Ok(list.len())
}

pub fn forget(agent: &Agent) -> R<()> {
    agent.db().set(KEY, "")?;
    agent.db().set("network.at", "")
}

/// The people in `list` who work at `company` ("Acme" matches "Acme Canada Inc.").
pub fn at_company(list: &[Value], company: &str) -> Vec<Value> {
    let k = company_key(company);
    if k.len() < 3 {
        return vec![];
    }
    list.iter().filter(|p| {
        let pk = company_key(p["company"].as_str().unwrap_or(""));
        pk.len() >= 3 && (pk == k || (pk.len() >= 5 && k.starts_with(&format!("{pk} "))) || (k.len() >= 5 && pk.starts_with(&format!("{k} "))))
    }).take(10).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_linkedin_connections_and_matches_companies() {
        let csv = "\u{feff}Notes:\n\"When exporting your connection data, you may notice...\"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n\
            Sam,Lee,https://www.linkedin.com/in/samlee,,\"Acme Canada, Inc.\",Finance Manager,01 Jan 2024\n\
            Ana,Diaz,https://www.linkedin.com/in/ana,ana@x.example,Beta Bank,\"Director, \"\"Tax\"\"\",02 Feb 2023\n\
            No,Company,https://www.linkedin.com/in/nc,,,,03 Mar 2022\n";
        let list = parse(csv).unwrap();
        assert_eq!(list.len(), 2, "people without a company are left out");
        assert_eq!(list[1]["position"], "Director, \"Tax\"");
        assert_eq!(at_company(&list, "Acme Inc.")[0]["name"], "Sam Lee");
        assert!(at_company(&list, "Acmeco").is_empty());
        assert_eq!(at_company(&list, "Beta Bank of Canada").len(), 1);
        assert!(parse("Name,Email\nx,y").is_err());
    }
}
