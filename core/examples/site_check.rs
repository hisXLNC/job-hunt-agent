//! Developer check: read every recruiter and job site the way a search does (without a browser).
//!   cargo run --example site_check -- ["Tax Manager"] ["Toronto, ON"]
//! Run on GitHub (Actions → Checks → "sites") when sites stop working: the cloud sessions can't reach them.
use jobhunt_core::{sites, sources};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let title = args.get(1).cloned().unwrap_or_else(|| "Tax Manager".into());
    let place = args.get(2).cloned().unwrap_or_else(|| "Toronto, ON".into());
    let c = sources::http();
    let ids: Vec<String> = sites::SITES.iter().map(|s| s.id.to_string()).collect();
    for t in sites::targets(&ids, &[]) {
        let (q, w) = sites::searches_for(&t, &[(title.clone(), place.clone())]).into_iter().next().unwrap_or_default();
        let started = std::time::Instant::now();
        let r = sites::search(&c, &t, &q, &w);
        let secs = started.elapsed().as_secs_f32();
        match r {
            Ok(mut list) => {
                println!("{:<20} ok, {} postings in {secs:.1}s  {}", t.name, list.len(), sites::search_url(&t, &q, &w));
                for p in list.iter().take(3) {
                    println!("    {} | {} | {}", p.title, p.location, p.url);
                }
                let mut thin: Vec<&mut sources::Posting> = list.iter_mut().filter(|p| p.description.is_empty()).take(2).collect();
                if !thin.is_empty() {
                    let n = sites::details(&c, &mut thin, 2);
                    println!("    details read for {n} of {}", thin.len());
                }
            }
            Err(e) => {
                let url = sites::search_url(&t, &q, &w);
                println!("{:<20} FAILED in {secs:.1}s: {e}  {url}", t.name);
                // The whole error, for connection problems (TLS and the like).
                if let Err(e) = c.get(&url).send() {
                    let mut src: Option<&dyn std::error::Error> = Some(&e);
                    while let Some(x) = src {
                        println!("    because: {x}");
                        src = x.source();
                    }
                }
            }
        }
    }
}
