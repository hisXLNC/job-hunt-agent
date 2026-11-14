//! Fakes for Claude, Gmail and Calendar, and a ready agent with a sample CV, shared by tests.
#![cfg(test)]

use crate::claude::*;
use crate::cv;
use crate::db::{Db, Job};
use crate::google::{Cal, Email, Mail, NewEvent};
use crate::pipeline::Agent;
use crate::profile::{Profile, Sources, Track};
use crate::sources::Posting;
use crate::R;
use chrono::{DateTime, Utc};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use crate::slots::Busy;

use std::sync::Mutex as M;

#[derive(Default)]
pub struct FakeLlm {
    pub scores: M<BTreeMap<String, i64>>,
    /// Postings per scoring request (0 or 1: each its own); and titles `score_many` leaves out.
    pub batch: M<usize>,
    pub left_out: M<Vec<String>>,
    pub triages: M<Vec<Triage>>,
    pub calls: M<Vec<String>>,
    pub accepted: M<Option<Option<TimeSlot>>>,
    pub indeed: M<Vec<FoundJob>>,
    pub alerts: M<Vec<FoundJob>>,
    pub stories_seen: M<String>,
    pub indeed_searches: M<Vec<(String, String)>>,
}

impl Llm for FakeLlm {
    fn salaries(&self, postings: &[String]) -> R<Vec<(usize, String)>> {
        self.calls.lock().unwrap().push(format!("salaries:{}", postings.len()));
        Ok(postings.iter().enumerate().filter_map(|(i, t)| t.lines().find_map(|l| l.strip_prefix("Salary note: ")).map(|s| (i, s.replace('~', " to ")))).collect())
    }
    fn pick_titles(&self, _targets: &str, titles: &[String]) -> R<Vec<usize>> {
        self.calls.lock().unwrap().push("pick_titles".into());
        Ok(titles.iter().enumerate().filter(|(_, t)| t.contains("Transformation")).map(|(i, _)| i).collect())
    }
    fn alert_jobs(&self, _email: &EmailIn) -> R<Vec<FoundJob>> {
        Ok(self.alerts.lock().unwrap().clone())
    }
    fn revise_cv(&self, _c: &str, numbered: &str, _job: &Job, note: &str) -> R<Vec<ParagraphEdit>> {
        self.calls.lock().unwrap().push(format!("revise_cv:{note}"));
        let line = numbered.lines().find(|l| l.contains("vendor management")).unwrap();
        let index: usize = line[1..line.find('|').unwrap()].parse().unwrap();
        Ok(vec![ParagraphEdit { index, text: "Led **vendor management** of contracted teams and integrators through UAT and release.".into(), keywords_added: vec![] }])
    }
    fn revise_letter(&self, _c: &str, _cv: &str, letter: &str, _job: &Job, note: &str, _s: &str) -> R<String> {
        self.calls.lock().unwrap().push(format!("revise_letter:{note}"));
        Ok(format!("{letter}\n\nP.S. Shorter now."))
    }
    fn answer_questions(&self, _c: &str, _cv: &str, _job: &Job, questions: &str, facts: &str, _s: &str) -> R<Vec<Answer>> {
        self.calls.lock().unwrap().push(format!("answers:{facts}"));
        let qs: Vec<&str> = if questions.trim().is_empty() { vec!["Why this role?"] } else { questions.lines().filter(|l| !l.trim().is_empty()).collect() };
        Ok(qs.into_iter().map(|q| Answer { question: q.into(), answer: format!("Answer to {q}") }).collect())
    }
    fn recruiters(&self, _c: &str, senders: &str) -> R<Vec<RecruiterIdea>> {
        self.calls.lock().unwrap().push("recruiters".into());
        // A sender whose name says "Recruiter" is one, at the company in their address.
        Ok(senders.split("\n\n").filter(|b| b.contains("Recruiter")).filter_map(|b| {
            let email = b.lines().next()?.split('<').nth(1)?.split('>').next()?.trim().to_string();
            let company = email.split('@').nth(1)?.split('.').next()?.to_string();
            Some(RecruiterIdea { name: b.lines().next()?.split('<').next()?.trim().into(), email, company: company[..1].to_uppercase() + &company[1..], kind: "in-house".into(), roles: vec!["Tax Manager".into()], stage: "interview".into() })
        }).collect())
    }
    fn fill_form(&self, c: &str, _cv: &str, _job: &Job, fields: &str, facts: &str, _s: &str) -> R<Vec<FieldValue>> {
        self.calls.lock().unwrap().push(format!("fill:{facts}"));
        // Names and emails by label, one choice from each list: enough to see the values land.
        Ok(fields.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).filter_map(|f| {
            let label = f["label"].as_str().unwrap_or("").to_lowercase();
            let value = if label.contains("first name") { c.split(' ').next().unwrap_or("").to_string() }
                else if label.contains("email") { "me@example.com".to_string() }
                // One job at a time (a profile): the one the facts ask for, of a CV with two.
                else if label.contains("job title") {
                    let n = facts.split("with number ").nth(1).and_then(|x| x.split(' ').next()).and_then(|x| x.parse::<u32>().ok()).unwrap_or(0);
                    if n == 0 || n > 2 { return None; }
                    format!("Role {n}")
                }
                else {
                    let o = f["options"].as_array().and_then(|o| o.first())?; o.as_str().unwrap_or("").to_string() };
            Some(FieldValue { key: f["key"].as_str().unwrap_or("").into(), value })
        }).collect())
    }
    fn offer_advice(&self, _c: &str, job: &Job, offer: &str, context: &str) -> R<String> {
        Ok(format!("## The offer in brief\n{offer} at {}\n\n{context}", job.company))
    }
    fn outreach(&self, c: &str, _cv: &str, job: &Job, contact: &str, brief: &str) -> R<String> {
        Ok(format!("Hi {}, I applied for {}. {c}\n[{brief}]", contact.lines().next().unwrap_or(""), job.title))
    }
    fn size_up_leads(&self, _c: &str, _cv: &str, _wants: &str, leads: &str) -> R<Vec<crate::claude::LeadView>> {
        // Each "### n" block: hiring unless it says NOT-HIRING; the company from its Company line.
        Ok(leads.split("### ").skip(1).map(|b| {
            let n = b.lines().next().and_then(|x| x.trim().parse().ok()).unwrap_or(0);
            let company = b.lines().find_map(|l| l.strip_prefix("Company: ")).map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).unwrap_or_else(|| "Northwind".into());
            crate::claude::LeadView { n, hiring: !b.contains("NOT-HIRING"), company, about: "Workflow software for clinics".into(), role: "Senior Program Manager".into(), site: String::new(), fit: 82,
                help: vec!["Their platform rebuild is the kind of programme you ran at the bank.".into(), "You've managed two system integrators; they're about to hire their first.".into()],
                points: vec!["Moved 30 services online in 14 months.".into(), "Ran a 40-person programme across three vendors.".into()] }
        }).collect())
    }
    fn find_leads(&self, _c: &str, _cv: &str, _wants: &str, skip: &str) -> R<Vec<crate::claude::FoundLead>> {
        self.calls.lock().unwrap().push(format!("find_leads:{skip}"));
        let person = |name: &str, role: &str| crate::claude::LeadPerson { name: name.into(), role: role.into(), linkedin: format!("https://www.linkedin.com/in/{}", name.to_lowercase().replace(' ', "-")) };
        let all = vec![
            crate::claude::FoundLead { kind: "funding".into(), company: "Northwind Robotics".into(), about: "Warehouse robots for mid-sized retailers".into(), detail: "Raised a $6M seed round, announced November 3".into(),
                role: String::new(), url: "https://news.example/northwind-seed".into(), site: "northwind.example".into(), people: vec![person("Maya Chen", "Co-founder and CEO"), person("Omar Haddad", "Co-founder and CTO")],
                fit: 78, help: vec!["They're going from pilots to rollouts: the delivery work you led for 40 stores.".into()], points: vec!["Rolled out to 40 sites in a year.".into(), "Managed two hardware vendors.".into()] },
            crate::claude::FoundLead { kind: "post".into(), company: "Ledgerline".into(), about: "Accounting tools for freelancers".into(), detail: "Their COO wrote that they're hiring a programme lead for a banking integration".into(),
                role: "Programme Lead".into(), url: "https://blog.example/ledgerline-hiring".into(), site: "ledgerline.example".into(), people: vec![person("Priya Nair", "COO")],
                fit: 86, help: vec!["A banking integration: you've delivered two under regulation.".into()], points: vec!["Delivered a payments integration with two banks.".into()] },
        ];
        Ok(all.into_iter().filter(|l| !skip.contains(&l.company)).collect())
    }
    fn find_recruiters(&self, job: &Job) -> R<Vec<crate::claude::FoundPerson>> {
        Ok(vec![crate::claude::FoundPerson { name: "Priya Shah".into(), title: format!("Talent Acquisition Partner at {}", job.company), linkedin: "https://www.linkedin.com/in/priya-shah-ta".into(), why: "hires for PMO roles in Toronto".into() }])
    }
    fn assist(&self, a: &crate::claude::Asked) -> R<crate::claude::Assisted> {
        if a.message.contains("fail") {
            return Err(crate::Error("Claude is busy.".into()));
        }
        // Asked to do something: it offers, with one offer Job Hunt doesn't know (dropped).
        let actions = if a.message.contains("work in") {
            vec![crate::claude::Offer { kind: "add_keywords".into(), label: "Work in Snowflake".into(), keywords: vec!["Snowflake".into()], ..Default::default() },
                crate::claude::Offer { kind: "delete_everything".into(), label: "No".into(), ..Default::default() }]
        } else if a.message.contains("set aside many") {
            vec![crate::claude::Offer { kind: "set_aside_many".into(), label: "Set aside the weakest".into(), jobs: vec!["test:1".into(), "test:nope".into()], ..Default::default() }]
        } else { vec![] };
        let knows = if a.facts.contains("[test:1]") { " knows [test:1]" } else { "" };
        Ok(crate::claude::Assisted { reply: format!("On {} about {} ({} before, quote: {}){knows}: {}\n\nSee [All jobs](#applications).", a.place, a.job.map_or("no job", |j| j.title.as_str()), a.history.len(), a.quote, a.message), actions })
    }
    fn insights(&self, _c: &str, results: &str, _apps: &str) -> R<String> {
        Ok(format!("## What's working\n{}", results.len()))
    }
    fn coach(&self, _c: &str, _cvs: &str, evidence: &str) -> R<crate::claude::CoachPlan> {
        self.calls.lock().unwrap().push(format!("coach:{evidence}"));
        Ok(crate::claude::CoachPlan { advice: "Show your Kubernetes work.".into(),
            skills: vec![crate::claude::SkillAdvice { skill: "Kubernetes".into(), kind: "learn".into(), why: "Asked for often.".into(), how: "CKA".into(), time: "6 weeks".into() }],
            titles: vec![crate::claude::TitleIdea { title: "Delivery Lead".into(), cv: "Program delivery".into(), why: "Same work.".into() }] })
    }
    fn career_paths(&self, _c: &str, cvs: &str, _evidence: &str) -> R<crate::claude::CareerPlan> {
        Ok(crate::claude::CareerPlan { advice: "Lead with delivery.".into(), paths: vec![crate::claude::CareerPath { title: "Data Engineering Manager".into(), kind: "now".into(), fit: 80, pay: "$110k–135k".into(),
            pay_min: Some(110000.0), pay_max: Some(135000.0), currency: "CAD".into(), pros: vec!["Steady demand".into()], cons: vec!["Narrow field".into()],
            titles: vec!["Data Engineering Manager".into(), "Data Systems Lead".into()], why: format!("{} chars of CV", cvs.len()),
            hours: Some(45.0), balance: "mixed".into(), balance_note: "Release weeks run late; mostly hybrid.".into(),
            recommended: true, recommended_why: "Your replies come from this kind of role.".into(), ..Default::default() }] })
    }
    fn read_posting(&self, url: &str, page: &str) -> R<FoundJob> {
        self.calls.lock().unwrap().push(format!("read_posting:{url}"));
        if !page.contains("Program Manager") {
            return Ok(FoundJob::default());
        }
        Ok(FoundJob { title: "Senior Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(),
            description: "Lead program delivery across finance systems, UAT and vendor management.".into(), ..Default::default() })
    }
    fn company_rating(&self, company: &str, _location: &str) -> R<crate::claude::CompanyRating> {
        self.calls.lock().unwrap().push(format!("company_rating:{company}"));
        if company.contains("Unknown") {
            return Ok(Default::default());
        }
        Ok(crate::claude::CompanyRating { found: true, rating: Some(4.1), reviews: Some(1234), source: "Glassdoor".into(), url: "https://www.glassdoor.example/acme".into(),
            work_life: Some(3.8), recommend: Some(78), pros: vec!["Good people".into()], cons: vec!["Slow promotions".into()], summary: "Liked overall.".into(), others: vec![] })
    }
    fn shorten_reasons(&self, reasons: &[String]) -> R<Vec<String>> {
        Ok(reasons.iter().map(|r| r.split_whitespace().take(6).collect::<Vec<_>>().join(" ")).collect())
    }
    fn company_apply(&self, job: &Job) -> R<Option<String>> {
        self.calls.lock().unwrap().push(format!("company_apply:{}", job.id));
        let n = job.id.rsplit(':').next().unwrap_or("");
        Ok(Some(format!("https://careers.example.com/jobs/{n}")).filter(|_| n != "2"))
    }
    fn follow_up(&self, c: &str, job: &Job, applied_on: &str) -> R<FollowUp> {
        self.calls.lock().unwrap().push("follow_up".into());
        Ok(FollowUp { subject: format!("Following up: {} application", job.title), body: format!("Hello, I applied on {applied_on}. {c}") })
    }
    fn email_reply(&self, c: &str, email: &crate::claude::EmailIn, about: &str) -> R<String> {
        self.calls.lock().unwrap().push("email_reply".into());
        Ok(format!("Thanks for writing about {about}. Re: {}. {c}", email.subject))
    }
    fn rejection_reply(&self, c: &str, job: &Job, their_email: &str, interviewed: bool) -> R<FollowUp> {
        self.calls.lock().unwrap().push("rejection_reply".into());
        Ok(FollowUp { subject: format!("Thank you: {}", job.title), body: format!("Thank you for letting me know.{} They wrote: {their_email}. {c}", if interviewed { " Any feedback?" } else { "" }) })
    }
    fn criteria_review(&self, _job: &Job, cv: &str) -> R<crate::claude::CriteriaReview> {
        use crate::claude::{CriteriaReview, Criterion};
        self.calls.lock().unwrap().push("criteria_review".into());
        // Clear once the CV has been sharpened (see revise_cv); never clear on Kubernetes.
        let clear = cv.contains("contracted teams and integrators");
        Ok(CriteriaReview { note: "Reads well.".into(), criteria: vec![
            Criterion { criterion: "Has managed vendors or system integrators".into(), verdict: if clear { "meets" } else { "undecided" }.into(), evidence: "Led vendor management".into(), fix: if clear { "" } else { "Name the vendors as system integrators in that line" }.into() },
            Criterion { criterion: "Kubernetes in production".into(), verdict: "not".into(), evidence: String::new(), fix: String::new() },
        ] })
    }
    fn rejection_lessons(&self, _c: &str, rejections: &str) -> R<crate::claude::Lessons> {
        self.calls.lock().unwrap().push("rejection_lessons".into());
        let n = rejections.lines().filter(|l| l.starts_with("- ")).count() as u32;
        Ok(crate::claude::Lessons { said: vec![crate::claude::SaidReason { reason: "No reason given".into(), count: n }], patterns: vec![format!("{n} rejections, none after an interview")],
            lessons: vec!["State years of programme delivery outright in the summary".into()], note: rejections.to_string() })
    }
    fn thank_you(&self, c: &str, job: &Job, _interview: &str) -> R<FollowUp> {
        self.calls.lock().unwrap().push("thank_you".into());
        Ok(FollowUp { subject: format!("Thank you: {} interview", job.title), body: format!("Thank you for your time. {c}") })
    }
    fn interview_prep(&self, _c: &str, _cv: &str, job: &Job) -> R<String> {
        Ok(format!("## The role in brief\n- {} at {}", job.title, job.company))
    }
    fn indeed(&self, searches: &[(String, String)], _country: &str, _details: usize) -> R<Vec<FoundJob>> {
        *self.indeed_searches.lock().unwrap() = searches.to_vec();
        Ok(self.indeed.lock().unwrap().clone())
    }

    fn cv_profile(&self, _cv_text: &str) -> R<CvProfile> {
        self.calls.lock().unwrap().push("cv_profile".into());
        Ok(CvProfile {
            label: "Data analysis".into(),
            areas: vec!["Forecasting: demand models for 40 stores".into()],
            name: "Alex Morgan".into(),
            email: "alex@example.com".into(),
            titles: vec!["Senior Data Analyst".into(), "Analytics Manager".into()],
            keywords: vec!["forecasting".into(), "power bi".into()],
        })
    }

    fn convert_cv(&self, cv: &CvSource) -> R<StructuredCv> {
        self.calls.lock().unwrap().push(match cv { CvSource::Pdf(_) => "convert_pdf".into(), CvSource::Text(_) => "convert_text".into() });
        Ok(StructuredCv {
            name: "Alex Morgan".into(),
            headline: "Senior Data Analyst · Retail and Logistics".into(),
            contact: vec!["alex@example.com · +1 416 555 0100".into()],
            sections: vec![
                CvSection { heading: "Summary".into(), items: vec![CvItem { text: "Analyst with eight years building forecasting models and dashboards.".into(), ..CvItem::default() }] },
                CvSection { heading: "Experience".into(), items: vec![CvItem {
                    title: "Data Analyst".into(), subtitle: "Freight Co".into(), dates: "2019 – Present".into(),
                    bullets: vec!["Managed contracted development teams and system integrators through UAT and release.".into()], ..CvItem::default() }] },
            ],
        })
    }

    fn score_batch(&self) -> usize {
        (*self.batch.lock().unwrap()).max(1)
    }
    fn score_many(&self, cvs: &[(String, String)], guidance: &str, jobs: &[Job]) -> R<Vec<Option<JobScore>>> {
        self.calls.lock().unwrap().push(format!("score_many:{}", jobs.len()));
        let out = self.left_out.lock().unwrap().clone();
        jobs.iter().map(|j| if out.contains(&j.title) { Ok(None) } else { self.score(cvs, guidance, j).map(Some) }).collect()
    }
    fn score(&self, cvs: &[(String, String)], guidance: &str, job: &Job) -> R<JobScore> {
        self.calls.lock().unwrap().push("score".into());
        // A tailored CV (see tailor below) fits a little better.
        let tailored = cvs.iter().any(|c| c.1.contains("Led vendor management"));
        Ok(JobScore {
            score: *self.scores.lock().unwrap().get(&job.title).unwrap_or(&85) + if tailored { 7 } else { 0 },
            // One of the CVs it was given, as the real scorer makes sure of.
            track: cvs.iter().find(|c| c.0 == "program").or(cvs.first()).map(|c| c.0.clone()).unwrap_or_else(|| "program".into()),
            reasoning: "Strong delivery match.".into(),
            // With a career path set, a role is read against it (here, by its title).
            red_flags: if !guidance.contains("career path they're building") { vec![] } else if job.title.contains("Program") { vec!["Career path: toward. Program delivery in finance.".into()] } else { vec!["Career path: away. A different kind of work.".into()] },
            keywords: vec!["Technical Program Manager".into(), "UAT".into(), "vendor management".into(), "Kubernetes".into()],
            deadline: if job.description.contains("apply by Halloween") { "2099-10-31".into() } else { String::new() },
            potential: Some(92),
            // As Claude reads pay the patterns miss: a "Salary note:" line, as written.
            // ("$80K~$90K": the search's patterns can't read it; Claude gives it back as a range.)
            salary: job.description.lines().find_map(|l| l.strip_prefix("Salary note: ")).unwrap_or("").replace('~', " to "),
        })
    }
    fn tailor(&self, _c: &str, numbered: &str, _job: &Job, _k: &[String], stories: &str, _style: &str, consistency: &str, _guidance: &str) -> R<Tailored> {
        *self.stories_seen.lock().unwrap() = stories.to_string();
        if !consistency.is_empty() {
            self.calls.lock().unwrap().push(format!("tailor-consistent:{}", consistency.lines().next().unwrap_or("")));
        }
        self.calls.lock().unwrap().push("tailor".into());
        let line = numbered.lines().find(|l| l.contains("] Managed contracted")).unwrap();
        let index: usize = line[1..line.find('|').unwrap()].parse().unwrap();
        Ok(Tailored {
            edits: vec![ParagraphEdit {
                index,
                text: "Led **vendor management** of contracted development teams and system integrators through UAT and release.".into(),
                keywords_added: vec!["vendor management".into()],
            }],
            keyword_gaps: vec!["Kubernetes".into()],
            cover_letter: "Dear Hiring Manager,\n\nI led delivery.\n\nJane".into(),
            email_subject: "Application: TPM - Jane".into(),
        })
    }
    fn triage(&self, _c: &str, _tz: &str, _e: &EmailIn, _a: &[(String, String, String, String)]) -> R<Triage> {
        self.calls.lock().unwrap().push("triage".into());
        Ok(self.triages.lock().unwrap().remove(0))
    }
    fn scheduling_reply(&self, _c: &str, _tz: &str, _e: &EmailIn, accept: Option<&TimeSlot>, _f: &[TimeSlot]) -> R<String> {
        *self.accepted.lock().unwrap() = Some(accept.cloned());
        Ok("Tuesday works, thanks. Jane".into())
    }
}

#[derive(Default)]
pub struct FakeMail {
    pub messages: M<BTreeMap<String, Email>>,
    pub labels: M<Vec<(String, String)>>,
    pub drafts: M<Vec<(String, String)>>,
    pub sent: M<Vec<(String, Vec<PathBuf>)>>,
}

impl Mail for FakeMail {
    fn recent(&self, q: &str, _l: usize) -> R<Vec<String>> {
        // Like Gmail: the job-alert query only finds mail from the job sites.
        let alerts = q == crate::pipeline::ALERTS_QUERY;
        let site = |e: &Email| ["linkedin", "indeed", "glassdoor", "jobbank.gc.ca"].iter().any(|d| e.from.to_lowercase().contains(d));
        Ok(self.messages.lock().unwrap().iter().filter(|(_, e)| !alerts || site(e)).map(|(k, _)| k.clone()).collect())
    }
    fn get(&self, id: &str) -> R<Email> {
        Ok(self.messages.lock().unwrap()[id].clone())
    }
    fn label(&self, id: &str, name: &str) -> R<()> {
        self.labels.lock().unwrap().push((id.into(), name.into()));
        Ok(())
    }
    fn draft_reply(&self, o: &Email, body: &str) -> R<String> {
        self.drafts.lock().unwrap().push((o.id.clone(), body.into()));
        Ok("draft-1".into())
    }
    fn draft(&self, to: &str, _s: &str, body: &str) -> R<String> {
        self.drafts.lock().unwrap().push((format!("to:{to}"), body.into()));
        Ok("draft-new".into())
    }
    fn send(&self, to: &str, _s: &str, _b: &str, a: &[PathBuf]) -> R<String> {
        self.sent.lock().unwrap().push((to.into(), a.to_vec()));
        Ok("sent-1".into())
    }
}

#[derive(Default)]
pub struct FakeCal {
    pub busy: M<Busy>,
    pub created: M<Vec<NewEvent>>,
    pub items: M<Vec<crate::google::CalItem>>,
}

impl Cal for FakeCal {
    fn busy(&self, _s: DateTime<Utc>, _e: DateTime<Utc>) -> R<Busy> {
        Ok(self.busy.lock().unwrap().clone())
    }
    fn create(&self, e: &NewEvent) -> R<String> {
        let mut c = self.created.lock().unwrap();
        c.push(e.clone());
        Ok(format!("evt-{}", c.len()))
    }
    fn events(&self, _s: DateTime<Utc>, _e: DateTime<Utc>) -> R<Vec<crate::google::CalItem>> {
        Ok(self.items.lock().unwrap().clone())
    }
}

pub struct Setup {
    pub agent: Arc<Agent>,
    pub llm: Arc<FakeLlm>,
    pub mail: Arc<FakeMail>,
    pub cal: Arc<FakeCal>,
    pub notes: Arc<M<Vec<String>>>,
    pub _dir: tempfile::TempDir,
}

pub fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    let mut p = sample_profile();
    p.name = "Jane Candidate".into();
    p.email = "jane@example.com".into();
    p.locations = vec!["Toronto".into()];
    p.auto_tailor = true;
    p.sources.indeed = true; // off for new users; the tests cover it on
    db.save_profile(&p).unwrap();
    let notes = Arc::new(M::new(vec![]));
    let n2 = notes.clone();
    let agent = Agent::new(dir.path(), db, Box::new(move |t, _| n2.lock().unwrap().push(t.to_string())));
    std::fs::create_dir_all(dir.path().join("cv")).unwrap();
    std::fs::write(agent.cv_path("program"), cv::sample_docx()).unwrap();
    let (llm, mail, cal) = (Arc::new(FakeLlm::default()), Arc::new(FakeMail::default()), Arc::new(FakeCal::default()));
    *agent.llm.write().unwrap() = llm.clone();
    *agent.mail.write().unwrap() = Some(mail.clone());
    *agent.cal.write().unwrap() = Some(cal.clone());
    Setup { agent: Arc::new(agent), llm, mail, cal, notes, _dir: dir }
}

pub fn posting(title: &str, ext: &str) -> Posting {
    Posting {
        source: "test".into(),
        external_id: ext.into(),
        company: "Acme".into(),
        title: title.into(),
        location: "Toronto, ON".into(),
        url: format!("https://acme.example/jobs/{ext}"), // each posting its own page
        description: "Lead program delivery, UAT, vendor management.".into(),
        ..Posting::default()
    }
}

pub fn email(id: &str) -> Email {
    Email { id: id.into(), thread_id: "t1".into(), from: "Recruiter <r@acme.example>".into(), subject: "Re: your application".into(), body: "Hello".into(), ..Email::default() }
}

pub fn triage(category: &str, job: Option<&str>) -> Triage {
    Triage { category: category.into(), job_id: job.map(|s| s.into()), company: None, role: None, summary: "s".into(), offered_times: vec![],
             confirmed_time: None, meeting_link: None, interviewers: vec![], needs_reply: false, reply_draft: None }
}

/// A profile with two CVs for tests: program delivery and data engineering, around Toronto.
pub fn sample_profile() -> Profile {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    Profile {
                    tracks: vec![
            Track {
                name: "program".into(),
                label: "Program delivery".into(),
                kind: "docx".into(),
                original: "program.docx".into(),
                letter_style: "standard".into(),
                areas: vec![],
                titles: s(&[
                    "Technical Program Manager",
                    "Senior Program Manager",
                    "Program Manager",
                    "Digital Transformation Manager",
                    "Delivery Manager",
                    "Product Manager",
                    "Business Systems Manager",
                ]),
                keywords: s(&[
                    "program manager",
                    "program lead",
                    "delivery lead",
                    "delivery manager",
                    "financial systems",
                    "product owner",
                    "implementation manager",
                ]),
            },
            Track {
                name: "data".into(),
                label: "Data engineering".into(),
                kind: "docx".into(),
                original: "data.docx".into(),
                letter_style: "standard".into(),
                areas: vec![],
                titles: s(&[
                    "Data Engineering Manager",
                    "Senior Data Engineering Manager",
                    "Data Transformation Manager",
                    "Snowflake",
                    "Data Systems Manager",
                    "Data Platform Engineering",
                ]),
                keywords: s(&[
                    "data engineering",
                    "data transformation",
                    "data systems",
                    "data quality",
                    "snowflake",
                    "data warehouse",
                    "data governance",
                ]),
            },
        ],
        locations: s(&["Toronto", "GTA", "Mississauga", "Markham", "Vaughan", "Oakville", "Ontario"]),
        sources: Sources {
            adzuna_where: s(&["Toronto"]),
            greenhouse: s(&["wealthsimple", "stripe", "coinbase", "affirm", "d2l", "faire"]),
            lever: s(&["koho", "neofinancial"]),
            ashby: s(&["wealthsimple", "ramp", "cohere"]),
            ..Sources::default()
        },
        ..Profile::default()
    }
}
