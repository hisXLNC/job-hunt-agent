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
    ("RBC", &["https://jobs.rbc.com/ca/en", "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1"]),
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
    // FreeHire's job search for agents, and Hiring Cafe's search page (without a browser).
    for url in ["https://freehire.me/api/v1/agent/jobs/search?q=Accountant&countries=CA&limit=20&description_format=markdown&sort=posted_at&order=desc",
        "https://freehire.me/api/v1/agent/jobs/search?q=Accountant&countries=CA&cities=Halifax&limit=20"] {
        match c.get(url).header("Accept", "application/json").send() {
            Ok(r) => {
                let status = r.status().as_u16();
                let body = r.text().unwrap_or_default();
                println!("FreeHire {status} {} chars  {url}", body.len());
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    println!("    meta {}", v["meta"]);
                    for j in v["data"].as_array().into_iter().flatten().take(4) {
                        println!("    {} | {} | {} | {} | desc {} chars | keys {:?}", j["title"], j["company"], j["location"], j["url"], j["description"].as_str().map(|d| d.len()).unwrap_or(0),
                            j.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
                    }
                } else {
                    println!("    not json: {:?}", body.chars().take(300).collect::<String>());
                }
            }
            Err(e) => println!("FreeHire FAILED {e}"),
        }
    }
    let hc = "https://hiringcafe.com/?searchState=%7B%22searchQuery%22%3A%22Accountant%22%2C%22locations%22%3A%5B%7B%22formatted_address%22%3A%22Canada%22%2C%22types%22%3A%5B%22country%22%5D%2C%22id%22%3A%22user_country%22%2C%22address_components%22%3A%5B%7B%22long_name%22%3A%22Canada%22%2C%22short_name%22%3A%22CA%22%2C%22types%22%3A%5B%22country%22%5D%7D%5D%2C%22options%22%3A%7B%22flexible_regions%22%3A%5B%22anywhere_in_continent%22%2C%22anywhere_in_world%22%5D%7D%7D%5D%2C%22dateFetchedPastNDays%22%3A14%7D";
    match c.get(hc).header("Accept", "text/html").send() {
        Ok(r) => {
            let status = r.status().as_u16();
            let body = r.text().unwrap_or_default();
            let links: Vec<&str> = Regex::new(r#"/job/[A-Za-z0-9_-]{6,}"#).unwrap().find_iter(&body).map(|m| m.as_str()).take(5).collect();
            println!("Hiring Cafe {status} {} chars, next data {}, bot check {}, job links {links:?}", body.len(), body.contains("__NEXT_DATA__"),
                ["challenge-platform", "cf-browser-verification", "vercel security checkpoint", "just a moment"].iter().any(|w| body.to_lowercase().contains(w)));
        }
        Err(e) => println!("Hiring Cafe FAILED {e}"),
    }
    // A BambooHR careers site, read the way a search reads it.
    match sources::bamboohr(&c, "ashteadtechnology", &|_| true) {
        Ok(list) => {
            println!("BambooHR ashteadtechnology: {} postings, {} with full text", list.len(), list.iter().filter(|p| !p.description.ends_with("full description.)")).count());
            for p in list.iter().take(2) {
                println!("    {} | {} | {} | {} chars", p.title, p.location, p.url, p.description.len());
            }
        }
        Err(e) => println!("BambooHR ashteadtechnology FAILED: {e}"),
    }
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
