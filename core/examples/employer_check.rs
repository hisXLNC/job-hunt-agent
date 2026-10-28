//! Developer check: which careers system each employer uses, and whether Job Hunt can read it.
//!   cargo run --example employer_check -- ["Accountant"]
//! For each employer: its careers page, the job-system links found on it (Workday, Greenhouse,
//! Lever, SmartRecruiters, Workable, Ashby, Taleo, SuccessFactors, iCIMS, Phenom), then each Workday
//! link (found or guessed) read the way a search reads it. Run on GitHub (Actions → Checks →
//! "sites"): the cloud sessions can't reach these sites.
use jobhunt_core::sources;
use regex::Regex;

const EMPLOYERS: &[(&str, &[&str])] = &[
    ("CPP Investments", &["https://www.cppinvestments.com/careers/", "https://cppinvestments.wd10.myworkdayjobs.com/CPPInvestments", "https://cppib.wd3.myworkdayjobs.com/CPPIB"]),
    ("Ontario Teachers' (OTPP)", &["https://www.otpp.com/en-ca/careers/", "https://otppb.wd3.myworkdayjobs.com/OTPP"]),
    ("HOOPP", &["https://hoopp.com/careers", "https://hoopp.wd3.myworkdayjobs.com/HOOPP"]),
    ("OMERS", &["https://www.omers.com/careers", "https://omers.wd3.myworkdayjobs.com/OMERS_External"]),
    ("RBC", &["https://jobs.rbc.com/ca/en", "https://rbc.wd3.myworkdayjobs.com/RBC_Careers"]),
    ("TD", &["https://jobs.td.com/en-CA/", "https://td.wd3.myworkdayjobs.com/TD_Bank_Careers"]),
    ("CIBC", &["https://jobs.cibc.com/", "https://cibc.wd3.myworkdayjobs.com/search"]),
    ("BMO", &["https://jobs.bmo.com/ca/en", "https://bmo.wd3.myworkdayjobs.com/External"]),
    ("Scotiabank", &["https://jobs.scotiabank.com/", "https://scotiabank.wd3.myworkdayjobs.com/Scotiabank_Careers"]),
    ("Manulife", &["https://careers.manulife.com/", "https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs"]),
    ("Sun Life", &["https://www.sunlife.com/en/careers/", "https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs"]),
];

fn main() {
    let title = std::env::args().nth(1).unwrap_or_else(|| "Accountant".into());
    let c = sources::http();
    let wd = Regex::new(r#"https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?[A-Za-z0-9_-]+"#).unwrap();
    let other = Regex::new(r#"(?i)(boards\.greenhouse\.io/[a-z0-9]+|jobs\.lever\.co/[a-z0-9-]+|jobs\.smartrecruiters\.com/[A-Za-z0-9]+|apply\.workable\.com/[a-z0-9-]+|jobs\.ashbyhq\.com/[a-z0-9-]+|[a-z0-9.-]*taleo\.net|[a-z0-9.-]*successfactors\.(?:com|eu)|[a-z0-9.-]*icims\.com|phenompeople|eagerLoadRefineSearch|cdn\.phenompeople)"#).unwrap();
    for (name, links) in EMPLOYERS {
        println!("\n== {name}");
        let mut tries: Vec<String> = links.iter().skip(1).map(|s| s.to_string()).collect();
        match c.get(links[0]).send() {
            Ok(r) => {
                let (status, url) = (r.status().as_u16(), r.url().to_string());
                let body = r.text().unwrap_or_default();
                println!("  page {status} {} chars  {url}", body.len());
                let mut seen: Vec<String> = wd.find_iter(&body).map(|m| m.as_str().to_string()).collect();
                seen.sort();
                seen.dedup();
                let mut others: Vec<String> = other.find_iter(&body).map(|m| m.as_str().to_lowercase()).collect();
                others.sort();
                others.dedup();
                println!("  workday links: {seen:?}\n  other systems: {others:?}");
                for s in seen.into_iter().rev() {
                    if !tries.contains(&s) {
                        tries.insert(0, s);
                    }
                }
            }
            Err(e) => println!("  page FAILED {e}"),
        }
        for t in tries {
            match sources::workday(&c, &t, &[title.clone()], &|_| false) {
                Ok(list) => {
                    println!("  OK   {t}: {} postings for {title:?}", list.len());
                    for p in list.iter().take(2) {
                        println!("       {} | {}", p.title, p.location);
                    }
                }
                Err(e) => println!("  no   {t}: {e}"),
            }
        }
    }
}
