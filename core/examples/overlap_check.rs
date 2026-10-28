//! Developer check: search every source that needs no key, for a few titles and places, and say
//! how much each overlaps the others and how many roles only it found.
//!   cargo run --example overlap_check -- "Tax Manager|Senior Accountant|Program Manager" "Toronto, ON|Halifax, NS"
//! Run on GitHub (Actions → Checks → "sites"): the cloud sessions can't reach the sites. Sources
//! with keys (Adzuna, Google for Jobs, Jooble, Indeed through Claude) aren't included.
use jobhunt_core::{db, filters, pipeline, profile, sources};
use std::collections::{BTreeMap, BTreeSet};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let titles: Vec<String> = args.get(1).map(|s| s.as_str()).unwrap_or("Tax Manager|Senior Accountant|Program Manager").split('|').map(String::from).collect();
    let places: Vec<String> = args.get(2).map(|s| s.as_str()).unwrap_or("Toronto, ON|Halifax, NS").split('|').map(String::from).collect();
    let mut p = profile::Profile::default();
    p.tracks = vec![profile::Track { titles: titles.clone(), ..Default::default() }];
    p.locations = places.clone();
    p.sources.adzuna_country = "ca".into();
    p.sources.jobbank = true;
    p.sources.linkedin = true;
    p.sources.sites = jobhunt_core::sites::SITES.iter().filter(|s| s.country == "ca").map(|s| s.id.to_string()).collect();
    p.sources.workday = pipeline::CANADA_EMPLOYERS.iter().map(|(_, l)| l.to_string()).collect();
    println!("Titles {titles:?}, places {places:?}\n");
    let f = sources::fetch_all(&p, &sources::Keys::default(), &|i, n, name| { eprintln!("[{i}/{n}] {name}"); true });
    for (name, req, found, failed) in &f.by_source {
        println!("{name:<28} {req:>3} searches, {found:>4} postings, {failed} failed");
    }
    for e in f.problems.iter().take(30) {
        println!("  problem: {e}");
    }
    let label = |s: &str| match s {
        "workday" => "Company sites (Workday)".to_string(),
        "linkedin" => "LinkedIn".into(),
        "jobbank" => "Job Bank".into(),
        other => jobhunt_core::sites::SITES.iter().find(|x| x.id == other).map(|x| x.name.to_string()).unwrap_or_else(|| other.to_string()),
    };
    // Two counts: everything found, and what Job Hunt keeps (title and place match).
    for (what, keep_only) in [("Everything found", false), ("Kept by Job Hunt's title and place filters", true)] {
        let mut roles: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for x in &f.postings {
            if keep_only && filters::prefilter(x, &p).is_some() {
                continue;
            }
            roles.entry(db::dupe_key(&x.company, &x.title)).or_default().insert(label(&x.source));
        }
        let mut per: BTreeMap<String, (usize, usize, BTreeMap<String, usize>)> = BTreeMap::new();
        for s in roles.values() {
            for a in s {
                let e = per.entry(a.clone()).or_default();
                e.0 += 1;
                if s.len() == 1 {
                    e.1 += 1;
                }
                for b in s.iter().filter(|b| *b != a) {
                    *e.2.entry(b.clone()).or_default() += 1;
                }
            }
        }
        let mut rows: Vec<_> = per.into_iter().collect();
        rows.sort_by_key(|(_, (n, _, _))| std::cmp::Reverse(*n));
        println!("\n## {what}: {} distinct roles\n", roles.len());
        println!("| Source | Roles | Only here | Also on |");
        println!("|---|---:|---:|---|");
        for (name, (n, only, also)) in rows {
            let mut also: Vec<_> = also.into_iter().collect();
            also.sort_by_key(|(_, k)| std::cmp::Reverse(*k));
            let also = if also.is_empty() { "none".to_string() } else { also.iter().map(|(b, k)| format!("{b} {k} ({}%)", k * 100 / n.max(1))).collect::<Vec<_>>().join(", ") };
            println!("| {name} | {n} | {only} ({}%) | {also} |", only * 100 / n.max(1));
        }
    }
}
