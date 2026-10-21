//! Developer preview: the app's screens in a browser, with sample data and a stand-in for Claude.
//!
//!     cargo run --example dev_server -- <data-folder> [cv.docx ...]
//!
//! Serves http://127.0.0.1:8790 using the same API code as the app window. Nothing here is shipped.

use jobhunt_core::api::{handle, Host, Req};
use jobhunt_core::claude::{CvItem, CvProfile, CvSection, CvSource, EmailIn, JobScore, Llm, ParagraphEdit, StructuredCv, Tailored, TimeSlot, Triage};
use jobhunt_core::db::{Db, Job};
use jobhunt_core::pipeline::Agent;
use jobhunt_core::sources::Posting;
use jobhunt_core::R;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct DemoLlm;

impl Llm for DemoLlm {
    fn career_paths(&self, _c: &str, _cvs: &str, _e: &str) -> R<jobhunt_core::claude::CareerPlan> {
        let p = |title: &str, kind: &str, fit: i64, pay: (f64, f64), gaps: &[&str], titles: &[&str], step: &str, pros: &[&str], cons: &[&str]| jobhunt_core::claude::CareerPath {
            title: title.into(), kind: kind.into(), fit, pay: format!("${}k–{}k", pay.0 / 1000.0, pay.1 / 1000.0), pay_min: Some(pay.0), pay_max: Some(pay.1), currency: "CAD".into(),
            why: "Your twelve years running regulated platform delivery map straight onto this, and your applications for it have had the most replies.".into(),
            gaps: gaps.iter().map(|g| g.to_string()).collect(), titles: titles.iter().map(|t| t.to_string()).collect(), first_step: step.into(),
            pros: pros.iter().map(|g| g.to_string()).collect(), cons: cons.iter().map(|g| g.to_string()).collect(),
            ladder: ["Now", "In 3 years", "In 5 years", "In 10 years"].iter().enumerate().map(|(i, w)| jobhunt_core::claude::CareerStep {
                when: w.to_string(), title: [title.to_string(), format!("Senior {title}"), format!("Lead {title}"), format!("Head of {}", title.split(' ').last().unwrap_or(""))][i].clone(),
                pay_min: Some(pay.0 * (1.0 + 0.18 * i as f64)), pay_max: Some(pay.1 * (1.0 + 0.2 * i as f64)) }).collect(),
            ceiling_title: format!("Director, {title}"), ceiling_pay: Some(pay.1 * 1.9),
            hours: Some([45.0, 50.0, 40.0][fit as usize % 3]), balance: ["mixed", "demanding", "good"][fit as usize % 3].into(),
            balance_note: ["Go-live weeks run late; mostly hybrid.", "Year-end and audits mean long weeks.", "Steady hours, often remote."][fit as usize % 3].into(),
        };
        Ok(jobhunt_core::claude::CareerPlan { advice: "Your strongest case is regulated delivery: lead with it. Digital transformation pays about the same and grows faster, but asks you to show adoption, not just delivery. A move into process improvement pays less at first; keep it as a second string.".into(), paths: vec![
            p("Senior Technical Program Manager", "now", 86, (125000.0, 150000.0), &[], &["Senior Technical Program Manager", "Program Manager, Payments"], "Apply to five bank programmes this week.", &["Many openings in banks", "Your record fits as it is"], &["Long hiring loops", "Pay tops out without a Director title"]),
            p("Digital Transformation Manager", "now", 80, (115000.0, 140000.0), &["A change-management example on your CV"], &["Digital Transformation Manager", "Transformation Lead", "Head of Digital Transformation"], "Rewrite one bullet around adoption, not delivery.", &["Fast-growing field", "Builds on your online-services work"], &["More competition from consultants"]),
            p("Business Process Improvement Lead", "switch", 62, (100000.0, 125000.0), &["Lean Six Sigma Green Belt", "A process-mapping case study"], &["Process Improvement Lead", "Business Process Analyst"], "Book the Green Belt exam.", &["Works in any sector"], &["Pays less at first", "Needs a certification"]),
        ] })
    }
    fn cv_profile(&self, text: &str) -> R<CvProfile> {
        let tax = text.contains("Snowflake") && text.contains("Data Engineering");
        Ok(CvProfile {
            label: if tax { "Data engineering".into() } else { "Program delivery".into() },
            name: "Sam Rivera".into(),
            email: "sam@example.com".into(),
            titles: if tax { vec!["Data Engineering Manager".into(), "Data Transformation Manager".into()] } else { vec!["Technical Program Manager".into(), "Senior Program Manager".into(), "Delivery Lead".into()] },
            keywords: vec!["program manager".into(), "delivery lead".into(), "data engineering".into()],
            areas: vec!["Program delivery: regulated platforms, tender to release".into(), "Digital transformation: services moved online".into(), "Vendor management: two system integrators".into()],
        })
    }

    fn convert_cv(&self, _cv: &CvSource) -> R<StructuredCv> {
        Ok(StructuredCv {
            name: "Alex Morgan".into(),
            headline: "Senior Data Analyst · Retail and Logistics".into(),
            contact: vec!["Toronto, ON · alex@example.com · +1 416 555 0100".into()],
            sections: vec![
                CvSection { heading: "Summary".into(), items: vec![CvItem { text: "Analyst with eight years building forecasting models and dashboards for retail and logistics teams.".into(), ..CvItem::default() }] },
                CvSection { heading: "Skills".into(), items: vec![CvItem { text: "Tools: SQL, Python, Power BI, Excel\nMethods: forecasting, A/B testing, segmentation".into(), ..CvItem::default() }] },
                CvSection { heading: "Experience".into(), items: vec![CvItem { title: "Data Analyst".into(), subtitle: "Freight Co, Toronto".into(), dates: "2019 – Present".into(),
                    bullets: vec!["Built a demand forecast that cut stock-outs across 40 stores.".into(), "Automated weekly reporting in SQL and Power BI for the operations team.".into()], ..CvItem::default() }] },
                CvSection { heading: "Education".into(), items: vec![CvItem { title: "BSc Statistics".into(), subtitle: "University of Toronto".into(), dates: "2015".into(), ..CvItem::default() }] },
            ],
        })
    }

    fn score(&self, _cvs: &[(String, String)], _guidance: &str, job: &Job) -> R<JobScore> {
        let score = 50 + (job.title.len() as i64 * 7 + job.company.len() as i64 * 3) % 48;
        Ok(JobScore {
            score,
            track: if job.title.contains("Data") { "data-engineering".into() } else { "program-delivery".into() },
            reasoning: format!("Strong match on regulated financial-platform delivery for {}. The biggest gap is direct experience with the company's own stack.", job.company),
            red_flags: if score < 60 { vec!["Asks for 5+ years of hands-on Java development".into()] } else { vec![] },
            keywords: vec!["Technical Program Management".into(), "Stakeholder Management".into(), "UAT".into(), "vendor management".into(), "Agile".into(), "Kubernetes".into(), "Release Management".into(), "PMP".into()],
            deadline: String::new(),
        })
    }
    fn tailor(&self, _c: &str, numbered: &str, _job: &Job, _k: &[String], _stories: &str, _style: &str) -> R<Tailored> {
        let mut edits = vec![];
        for line in numbered.lines() {
            let Some(close) = line.find(']') else { continue };
            let tag = &line[1..close];
            let text = line[close + 1..].trim();
            let Some((idx, kind)) = tag.split_once('|') else { continue };
            if kind != "edit" {
                continue;
            }
            let index: usize = idx.parse().unwrap_or(0);
            if text.starts_with("Expanded the platform") {
                edits.push(ParagraphEdit { index, text: text.replace("Expanded the platform through hybrid agile and waterfall delivery", "Led Agile and waterfall delivery to expand the platform"), keywords_added: vec!["Agile".into()] });
            }
            if text.starts_with("Managed two system integrators") {
                edits.push(ParagraphEdit { index, text: "Led vendor management of two system integrators through UAT and release.".into(), keywords_added: vec!["vendor management".into()] });
            }
            if text.starts_with("Served as subject-matter expert") {
                edits.push(ParagraphEdit { index, text: text.replace("Served as subject-matter expert (SME) on the steering committee", "Provided stakeholder management as subject-matter expert (SME) on the steering committee"), keywords_added: vec!["Stakeholder Management".into()] });
            }
        }
        Ok(Tailored {
            edits,
            keyword_gaps: vec!["Kubernetes".into()],
            cover_letter: "October 14, 2026\nATTN: Northbank Hiring Team\nNorthbank\n\n**Subject: Application for Senior Technical Program Manager (R-20417)**\n\nDear Hiring Team,\n\nThe Senior Technical Program Manager role at Northbank asks for someone who can \"own program governance across vendor and internal teams\". For twelve years at a national payments agency I have done exactly that on regulated financial platforms, from tender to release.\n\nThree results show how I would approach Northbank's payments modernization:\n- **Regulated delivery:** Delivered a national payments platform and filing services in eight months, on schedule for the legal deadline.\n- **Vendor management:** Ran the build of the in-house payments system that now handles billions a year, managing two system integrators through UAT and release.\n- **Governance:** Reported monthly to the steering committee and kept a single risk and decision log across 40+ stakeholders.\n\nThe posting lists PMP. I don't hold it yet; my delivery record covers the same ground, and I am open to earning it.\n\nI would welcome the chance to discuss how this experience fits Northbank's roadmap. Thank you for your time.\n\nAll the best,\nSam Rivera".into(),
            email_subject: "Application: Technical Program Manager - Sam Rivera".into(),
        })
    }
    fn triage(&self, _c: &str, _tz: &str, _e: &EmailIn, _a: &[(String, String, String, String)]) -> R<Triage> {
        Err(jobhunt_core::Error("demo".into()))
    }
    fn scheduling_reply(&self, _c: &str, _tz: &str, _e: &EmailIn, _a: Option<&TimeSlot>, _f: &[TimeSlot]) -> R<String> {
        Ok(String::new())
    }
}

struct DevHost {
    static_dir: PathBuf,
}

impl Host for DevHost {
    fn asset(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.static_dir.join(path)).ok()
    }
    fn open_url(&self, url: &str) -> R<()> {
        println!("open url: {url}");
        Ok(())
    }
    fn open_path(&self, path: &Path) -> R<()> {
        println!("open path: {}", path.display());
        Ok(())
    }
    fn autostart(&self) -> bool {
        false
    }
    fn set_autostart(&self, _on: bool) -> R<()> {
        Ok(())
    }
    fn version(&self) -> String {
        "1.0.0".into()
    }
    fn update_check(&self) -> serde_json::Value {
        serde_json::json!({"available": true, "current": "1.0.0", "version": "1.1.0", "notes": "Preview of the update note"})
    }
    fn update_install(&self) -> R<bool> {
        Ok(false)
    }
}

fn seed(agent: &Agent) {
    let jobs = [
        ("Senior Technical Program Manager", "Big Bank", "Toronto, ON", Some("CAD 140,000–165,000"), None),
        ("Data Engineering Manager, Snowflake", "Consultancy", "Toronto, ON", None, Some("careers@consultancy.example")),
        ("Program Manager, Payments", "Fintech Co", "Remote - Canada", Some("CAD 120,000–150,000"), None),
        ("Delivery Lead, Digital Government", "Ontario Digital Service", "Toronto, ON", None, None),
        ("Digital Transformation Manager", "Insurer", "Mississauga, ON", None, None),
        ("Product Manager, Tax Platform", "Tax Software Inc", "Toronto, ON", None, None),
        ("Business Systems Manager", "Utility", "Markham, ON", None, None),
    ];
    let postings: Vec<Posting> = jobs.iter().enumerate().map(|(i, (t, c, l, s, e))| Posting {
        source: "adzuna".into(), external_id: format!("demo{i}"), company: c.to_string(), title: t.to_string(), location: l.to_string(),
        url: format!("https://example.com/jobs/{i}"), salary: s.map(|x| x.to_string()), apply_email: e.map(|x| x.to_string()),
        description: "We're looking for a Technical Program Manager to lead delivery of regulated financial platforms.\n\nWhat you'll do\n- Own program governance, requirements, UAT and release management\n- Manage vendors and system integrators\n- Report to the steering committee\n\nWhat you bring\n- PMP\n- 8+ years delivering large platforms\n- Agile and waterfall experience".into(),
        ..Posting::default()
    }).collect();
    let r = agent.search(Some(postings)).unwrap();
    println!("seeded: {r}");
    let db = agent.db();
    let ids: Vec<String> = db.jobs(Some("ready"), 50).unwrap().iter().map(|j| j.id.clone()).collect();
    for (i, id) in ids.iter().enumerate() {
        match i {
            0 => { db.set_status(id, "applied", "submitted on the company site").unwrap(); }
            1 => { db.set_status(id, "interviewing", "from email: Interview invitation").unwrap(); }
            _ => {}
        }
    }
    if let Some(id) = ids.get(1) {
        let start = (chrono::Utc::now() + chrono::Duration::days(3)).to_rfc3339();
        db.record_calendar_event("evt1", Some(id), "interview", &start, "Interview").unwrap();
        db.record_email("m1", "t1", Some(id), "Recruiter <talent@insurer.example>", "Interview invitation – Digital Transformation Manager", "interview_request", "They'd like a 45-minute video interview next week and offered Tuesday or Wednesday afternoon.", Some("d1"), &chrono::Utc::now().to_rfc3339()).unwrap();
    }
    db.record_email("m2", "t2", None, "Jobs Digest <alerts@board.example>", "12 new jobs for Program Manager", "job_alert", "A job-board digest of program manager roles in Toronto.", None, &(chrono::Utc::now() - chrono::Duration::hours(5)).to_rfc3339()).unwrap();
    // Other Google Calendar events from a sync; one looks like an interview for the applied job.
    if let Some(j) = db.jobs(None, 1).unwrap().into_iter().next() {
        let (id, company) = (j.id, j.company);
        let at = |d: i64, h: u32| (chrono::Utc::now() + chrono::Duration::days(d)).date_naive().and_hms_opt(h, 0, 0).unwrap().and_utc().to_rfc3339();
        let events = serde_json::json!([
            { "id": "g1", "title": format!("Phone screen – {company}"), "start": at(5, 15), "end": at(5, 16), "all_day": false,
              "suggest": { "job_id": id, "company": company, "title": "" } },
            { "id": "g2", "title": "Dentist", "start": at(2, 18), "end": at(2, 19), "all_day": false, "suggest": null },
        ]);
        db.set("gcal.cache", &serde_json::json!({ "at": chrono::Utc::now().to_rfc3339(), "events": events }).to_string()).unwrap();
        db.set("last.calsync", &(chrono::Utc::now() - chrono::Duration::minutes(12)).to_rfc3339()).unwrap();
    }
    db.set("claude.key", "demo").unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let data = PathBuf::from(args.get(1).cloned().unwrap_or_else(|| "preview-data".into()));
    std::fs::create_dir_all(data.join("cv")).unwrap();
    let seed_cvs: Vec<String> = args.iter().skip(2).cloned().collect();
    let fresh = !data.join("jobhunt.db").exists();
    let db = Db::open(&data.join("jobhunt.db")).unwrap();
    let agent = Arc::new(Agent::new(&data, db, Box::new(|t, b| println!("notification: {t} – {b}"))));
    *agent.llm.write().unwrap() = Arc::new(jobhunt_core::usage::Metered { inner: Arc::new(DemoLlm), log: agent.usage.clone() });
    if fresh && !seed_cvs.is_empty() {
        for path in &seed_cvs {
            let name = Path::new(path).file_name().unwrap().to_string_lossy().to_string();
            let t = agent.add_cv(&name, &std::fs::read(path).unwrap(), false).unwrap();
            println!("added CV: {} ({})", t.label, t.name);
        }
        let mut p = agent.profile();
        p.locations = vec!["Toronto".into(), "Mississauga".into(), "Markham".into()];
        agent.save_profile(&p).unwrap();
        seed(&agent);
    }
    let host: Arc<dyn Host> = Arc::new(DevHost { static_dir: Path::new(env!("CARGO_MANIFEST_DIR")).join("../static") });
    let listener = TcpListener::bind("127.0.0.1:8790").unwrap();
    println!("preview on http://127.0.0.1:8790");
    for stream in listener.incoming().flatten() {
        let (agent, host) = (agent.clone(), host.clone());
        std::thread::spawn(move || {
            let mut stream = stream;
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                return;
            }
            let mut parts = line.split_whitespace();
            let (method, target) = (parts.next().unwrap_or("GET").to_string(), parts.next().unwrap_or("/").to_string());
            let mut len = 0usize;
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                    break;
                }
                if let Some(v) = h.to_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0u8; len];
            let _ = reader.read_exact(&mut body);
            let (path, query) = match target.split_once('?') {
                Some((p, q)) => (p.to_string(), url::form_urlencoded::parse(q.as_bytes()).into_owned().collect()),
                None => (target.clone(), HashMap::new()),
            };
            let path = url::form_urlencoded::parse(format!("x={}", path.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.to_string()).unwrap_or(path);
            let r = handle(&agent, &host, &Req { method, path, query, body, remote: false });
            let _ = write!(stream, "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", r.status, r.ctype, r.body.len());
            let _ = stream.write_all(&r.body);
        });
    }
}
