//! Developer check: the job-search APIs some sites are read through (Adecco, Altis, Randstad), and
//! each problem site searched the way a search does.
//!   cargo run --example site_api_check -- ["Program Manager"] ["Toronto, ON"]
//! Run on GitHub (Actions → Checks → "site-apis"): the cloud sessions can't reach these sites.
use jobhunt_core::{sites, sources};
use serde_json::{json, Value};

fn show(name: &str, r: reqwest::Result<reqwest::blocking::Response>) {
    match r {
        Err(e) => println!("{name}: FAILED {e}"),
        Ok(r) => {
            let status = r.status();
            let body = r.text().unwrap_or_default();
            println!("{name}: {status}, {} chars", body.len());
            match serde_json::from_str::<Value>(&body) {
                Ok(v) => {
                    let first = v["jobs"].get(0).or_else(|| v.get(0)).or_else(|| v["searchResults"]["hits"]["hits"].get(0)).cloned().unwrap_or(Value::Null);
                    println!("    top keys: {:?}", v.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
                    println!("    total: {}", v["searchResults"]["hits"]["total"]);
                    println!("    first: {}", first.to_string().chars().take(1800).collect::<String>());
                }
                Err(_) => println!("    not JSON: {}", body.chars().take(300).collect::<String>()),
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let title = args.get(1).cloned().unwrap_or_else(|| "Program Manager".into());
    let place = args.get(2).cloned().unwrap_or_else(|| "Toronto, ON".into());
    let c = sources::http();
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    let post = |url: &str, referer: &str, body: Value| c.post(url).header("User-Agent", ua).header("Accept", "application/json").header("Referer", referer).json(&body).send();
    show("Adecco API", post("https://www.adecco.com/api/data/jobs/summarized", "https://www.adecco.com/en-ca/job-search",
        json!({ "queryString": format!("&q={}&sort=PostedDate desc&rows=50", title.replace(' ', "+")), "filtersToDisplay": "", "range": 0, "siteName": "adecco", "brand": "adecco", "countryCode": "CA", "languageCode": "en-CA" })));
    show("Altis API", post("https://apis.altisexcel.com/Applicant/jobs/ads/Search", "https://jobportal.altis.com/",
        json!({ "keyword": title, "remoteWorkOptionId": null, "jobTypeIds": [], "industryIds": [], "specializations": [], "locations": [], "businessType": "" })));
    show("Randstad API (keyword)", post("https://www.randstad.ca/api/search/search-results", "https://www.randstad.ca/jobs/", sites::randstad_body(&title)));
    show("Randstad API (all)", post("https://www.randstad.ca/api/search/search-results", "https://www.randstad.ca/jobs/", sites::randstad_body("")));
    println!();
    let ids: Vec<String> = ["adecco", "altis", "randstad", "michaelpage", "aerotek", "peoplefirst", "jobsca", "techtalent"].iter().map(|s| s.to_string()).collect();
    for t in sites::targets(&ids, &[]) {
        for (q, w) in [(title.clone(), place.clone()), ("Accountant".to_string(), place.clone())] {
            match sites::search(&c, &t, &q, &w) {
                Ok(list) => {
                    println!("{:<20} “{q}”: {} postings  {}", t.name, list.len(), sites::search_url(&t, &q, &w));
                    for p in list.iter().take(3) {
                        println!("    {} | {} | {} | {} chars", p.title, p.location, p.url, p.description.len());
                    }
                }
                Err(e) => println!("{:<20} “{q}”: FAILED {e}  {}", t.name, sites::search_url(&t, &q, &w)),
            }
        }
    }
}
