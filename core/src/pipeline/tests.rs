//! The engine's tests.

use super::*;
use crate::testkit::*;
use chrono::TimeZone;

#[test]
fn you_pick_the_roles_to_tailor_and_see_the_fit_before_and_after() {
    let s = setup();
    let mut p = s.agent.profile();
    p.auto_tailor = false;
    s.agent.save_profile(&p).unwrap();
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    assert_eq!((r.scored, r.tailored, r.to_pick), (2, 0, 2));
    assert!(!s.llm.calls.lock().unwrap().contains(&"tailor".to_string()), "nothing tailored before you pick");
    assert_eq!(s.agent.overview().unwrap()["to_tailor"].as_array().unwrap().len(), 2);
    assert!(s.notes.lock().unwrap().iter().any(|n| n.contains("worth applying")));
    assert!(s.agent.tailor_picked(&[]).is_err());
    assert_eq!(s.agent.tailor_picked(&["test:1".to_string()]).unwrap(), 1);
    for _ in 0..1000 {
        if s.agent.running().is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let one = s.agent.db().job("test:1").unwrap().unwrap();
    let two = s.agent.db().job("test:2").unwrap().unwrap();
    assert_eq!((one.status.as_str(), one.score, one.score_after), ("ready", Some(85), Some(92)));
    assert_eq!(two.status, "queued", "not picked");
    // Your CV is picked by itself: the one the scorer matched.
    assert_eq!(one.track.as_deref(), Some("program"));
}

#[test]
fn you_can_edit_the_tailored_cv_or_use_your_own_files() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let job = s.agent.db().job("test:1").unwrap().unwrap();
    let change = job.cv_changes[0].clone();
    // Your own wording, even with a figure Claude couldn't add.
    let mine = "Led vendor management of 2 system integrators through UAT and release, cutting defects 40%.";
    let job = s.agent.edit_cv_paragraph("test:1", &change.after, mine).unwrap();
    assert_eq!(job.cv_changes[0].after, mine);
    let text = cv::open(Path::new(job.cv_path.as_ref().unwrap())).unwrap().plain_text();
    assert!(text.contains("cutting defects 40%"));
    assert!(s.agent.can_undo("test:1", "cv"));
    // Put back: the line from your CV, and the change is gone from the list.
    let job = s.agent.edit_cv_paragraph("test:1", mine, &change.before).unwrap();
    assert!(job.cv_changes.is_empty());
    assert!(s.agent.edit_cv_paragraph("test:1", "No such paragraph", "x").is_err());

    // Your own files: a Word CV and a PDF letter; Claude leaves them alone; switch back.
    let tailored = job.cv_path.clone();
    assert!(s.agent.use_own_file("test:1", "cv", "mine.txt", b"hello").is_err());
    assert!(s.agent.use_own_file("test:1", "letter", "letter.pdf", b"not a pdf").is_err());
    let job = s.agent.use_own_file("test:1", "cv", "My CV for Acme.docx", &cv::sample_docx()).unwrap();
    assert!(job.cv_path.as_deref().unwrap().ends_with("(yours).docx") && s.agent.own_file("test:1", "cv"));
    let job = s.agent.use_own_file("test:1", "letter", "Letter.pdf", b"%PDF-1.4 test").unwrap();
    assert!(job.letter_path.as_deref().unwrap().ends_with("(yours).pdf"));
    assert!(job.cover_letter.unwrap().contains("attached"), "the email body for a PDF letter");
    assert!(s.agent.revise("test:1", "cv", "Make it shorter").is_err());
    assert!(s.agent.save_cover_letter("test:1", "New text").is_err());
    s.agent.drop_own_file("test:1", "cv").unwrap();
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().cv_path, tailored);
    assert!(!s.agent.own_file("test:1", "cv") && s.agent.own_file("test:1", "letter"));
}

#[test]
fn connections_show_their_status_and_test_one_at_a_time() {
    let s = setup();
    s.agent.db().set("claude.engine", "code").unwrap();
    let rows = s.agent.connections().unwrap();
    let ids: Vec<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
    for id in ["claude", "google", "jsearch", "indeed", "boards", "alerts", "phone", "sync", "backup"] {
        assert!(ids.contains(&id), "{id} in {ids:?}");
    }
    let indeed = |s: &crate::testkit::Setup| s.agent.connections().unwrap().into_iter().find(|r| r["id"] == "indeed").unwrap();
    assert_eq!(indeed(&s)["status"], "unknown");
    // A failing Indeed says how to fix it; testing it alone leaves the other rows be.
    s.agent.db().set("sources.test", &json!({ "results": [
        { "name": "Indeed “PM” in Toronto", "kind": "search", "ok": false, "error": "The Indeed connector isn't connected.", "hint": "" },
        { "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No Jooble key." }] }).to_string()).unwrap();
    let row = indeed(&s);
    assert_eq!(row["status"], "problem");
    // The error explains itself (Claude Code's own diagnosis); the row offers the claude.ai connectors page.
    assert_eq!(row["detail"], "The Indeed connector isn't connected.", "{row}");
    assert!(row["actions"].as_array().unwrap().iter().any(|a| a.as_str().unwrap_or("").starts_with("link:https://claude.ai")), "{row}");
    s.agent.test_sources_only(Some("indeed")).unwrap();
    let t: Value = serde_json::from_str(&s.agent.secret("sources.test")).unwrap();
    let names: Vec<&str> = t["results"].as_array().unwrap().iter().filter_map(|r| r["name"].as_str()).collect();
    assert!(names.contains(&"Jooble") && names.iter().filter(|n| n.starts_with("Indeed")).count() == 1, "{names:?}");
    assert_eq!(indeed(&s)["status"], "ok");
    // A search 7 hours ago where Indeed failed doesn't outweigh the test that just worked:
    // Connections and the Overview agree.
    let report = json!({ "source_problems": ["Indeed: the Indeed connector isn't available to Claude Code."] }).to_string();
    s.agent.db().set("last.report", &report).unwrap();
    s.agent.db().set("last.search", &(Utc::now() - Duration::hours(7)).to_rfc3339()).unwrap();
    assert_eq!(indeed(&s)["status"], "ok");
    assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Indeed")));
    // A later search that failed does.
    s.agent.db().set("last.search", &(Utc::now() + Duration::minutes(1)).to_rfc3339()).unwrap();
    assert_eq!(indeed(&s)["status"], "problem");
    let h = s.agent.health();
    assert!(h.iter().any(|h| h["text"] == "Indeed (through your Claude account) isn't working. See why and fix it in Search \u{2192} Set up sources."), "{h:?}");
    // Turned off.
    let mut p = s.agent.profile();
    p.sources.indeed = false;
    s.agent.save_profile(&p).unwrap();
    assert_eq!(indeed(&s)["status"], "off");
}

#[test]
fn quiet_applications_can_be_closed() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    for id in ["test:1", "test:2"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
    }
    let old = (Utc::now() - Duration::days(50)).to_rfc3339();
    s.agent.db().update_job("test:1", &[("applied_at", old.into())]).unwrap();
    let quiet = s.agent.quiet_applications().unwrap();
    assert_eq!(quiet.iter().map(|j| j.id.as_str()).collect::<Vec<_>>(), vec!["test:1"], "only the old one");
    assert_eq!(s.agent.overview().unwrap()["quiet"].as_array().unwrap().len(), 1);
    s.agent.db().set_status("test:1", "no_response", "quiet for 7 weeks").unwrap();
    assert!(s.agent.quiet_applications().unwrap().is_empty());
    let row = s.agent.tracker(Some("test:1")).unwrap().pop().unwrap();
    assert_eq!(row["who"], "done");
}

#[test]
fn interviews_added_by_hand_and_the_calendar() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None; // without Google: Job Hunt keeps them itself
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let when = (Utc::now() + Duration::days(3)).to_rfc3339();
    assert!(s.agent.add_interview("test:1", "not a date", 60, "", "").is_err());
    let made = s.agent.add_interview("test:1", &when, 45, "https://meet.example/x", "Panel of three").unwrap();
    assert!(made.len() >= 2 && made.iter().all(|id| id.starts_with("local:")), "{made:?}");
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "interviewing");
    assert!(s.agent.add_interview("test:1", &when, 45, "", "").is_err(), "not twice");
    // An application waiting on a reply shows when its follow-up is due.
    s.agent.search(Some(vec![posting("Senior Program Manager", "2")])).unwrap();
    s.agent.db().set_status("test:2", "applied", "").unwrap();
    let items = s.agent.calendar(1, 30).unwrap();
    assert!(items.iter().any(|i| i["kind"] == "follow-up" && i["job_id"] == "test:2"));
    let kinds: Vec<&str> = items.iter().filter_map(|i| i["kind"].as_str()).collect();
    assert!(kinds.contains(&"interview") && kinds.contains(&"prep") && kinds.contains(&"reminder"), "{kinds:?}");
    let ics = s.agent.calendar_ics().unwrap();
    assert!(ics.starts_with("BEGIN:VCALENDAR") && ics.contains("SUMMARY:Interview: Acme"));
    let interview = items.iter().find(|i| i["kind"] == "interview").unwrap()["id"].as_str().unwrap().to_string();
    assert!(s.agent.db().delete_calendar_event(&interview).unwrap() >= 2, "prep and reminders go with it");
    assert!(!s.agent.calendar(1, 30).unwrap().iter().any(|i| i["kind"] == "interview"));
}

#[test]
fn filling_in_an_application_form() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let fields = vec![
        json!({ "key": "f0", "type": "text", "label": "First Name", "required": true, "value": "" }),
        json!({ "key": "f1", "type": "email", "label": "Email", "required": true, "value": "" }),
        json!({ "key": "g2", "type": "radio", "label": "Are you legally able to work in Canada?", "options": ["Yes", "No"], "value": "" }),
        json!({ "key": "f3", "type": "file", "label": "Resume/CV", "value": "" }),
        json!({ "key": "f4", "type": "text", "label": "Favourite colour", "value": "" }),
    ];
    let a = crate::fill::answers(&s.agent, "test:1", &fields).unwrap();
    assert_eq!(a["values"]["f1"], "me@example.com");
    assert_eq!(a["values"]["g2"], "Yes");
    assert!(a["values"].get("f4").is_none(), "nothing to say: left for you");
    // The tailored CV, for the upload field (as Word here: no PDF converter on the test machine).
    let cv = &a["files"]["f3"];
    assert!(cv["name"].as_str().unwrap().contains("CV") && !cv["b64"].as_str().unwrap().is_empty(), "{cv}");
    assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("fill:")));
    crate::fill::submitted(&s.agent, "test:1", "https://boards.greenhouse.io/acme/jobs/1", true).unwrap();
    let j = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(j.status, "applied");
}

#[test]
fn recruiters_and_job_sites_status() {
    let s = setup();
    let row = |s: &crate::testkit::Setup| s.agent.connections().unwrap().into_iter().find(|r| r["id"] == "agencies").unwrap();
    assert_eq!(row(&s)["status"], "setup", "none chosen yet");
    let mut p = s.agent.profile();
    p.sources.sites = vec!["michaelpage".into(), "hays".into(), "lro".into()];
    s.agent.save_profile(&p).unwrap();
    // The last search: Michael Page found postings, Hays turned it away, LRO's page had none.
    let report = json!({ "by_source": [
        { "name": "Michael Page", "searches": 2, "found": 14, "failed": 0 },
        { "name": "Hays", "searches": 2, "found": 0, "failed": 2 },
        { "name": "LRO Staffing", "searches": 1, "found": 0, "failed": 0 } ],
        "source_problems": ["Hays \u{201c}Tax Manager\u{201d}: the site turned the request away (it may block automated reading)"] });
    s.agent.db().set("last.report", &report.to_string()).unwrap();
    s.agent.db().set("last.search", &now()).unwrap();
    let st = s.agent.site_status();
    let by = |id: &str| st.iter().find(|x| x["id"] == id).unwrap().clone();
    assert_eq!((by("michaelpage")["state"].as_str(), by("hays")["state"].as_str(), by("lro")["state"].as_str()), (Some("ok"), Some("problem"), Some("quiet")));
    assert!(by("hays")["detail"].as_str().unwrap().contains("turned the request away"));
    let r = row(&s);
    // Some working and some not: "partial", never Working over a site that fails, with the
    // ones to turn off.
    assert_eq!(r["status"], "partial", "{r}");
    assert_eq!(r["data"], json!(["hays"]));
    assert!(r["detail"].as_str().unwrap().contains("couldn't read Hays") && r["detail"].as_str().unwrap().contains("no postings from LRO Staffing"), "{r}");
    assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Recruiters")), "not a problem to fix");
    // None working: then it is.
    let report = json!({ "by_source": [{ "name": "Michael Page", "searches": 2, "found": 0, "failed": 2 }, { "name": "Hays", "searches": 2, "found": 0, "failed": 2 }, { "name": "LRO Staffing", "searches": 1, "found": 0, "failed": 1 }] });
    s.agent.db().set("last.report", &report.to_string()).unwrap();
    assert_eq!(row(&s)["status"], "problem");
    // A site of your own, by its search address.
    let mut p = s.agent.profile();
    p.sources.custom_sites = vec![crate::sites::CustomSite { name: "Eluta".into(), url: "https://www.eluta.ca/search?q={title}&l={place}".into() }];
    s.agent.save_profile(&p).unwrap();
    assert!(s.agent.site_status().iter().any(|x| x["name"] == "Eluta" && x["template"] == "https://www.eluta.ca/search?q={q}&l={l}"));
}

#[test]
fn connections_turn_off_one_by_one() {
    let s = setup();
    s.agent.db().set("jooble.key", "k").unwrap();
    let mut p = s.agent.profile();
    p.sources.greenhouse = vec!["acme".into()];
    p.sources.set_on("jooble", false);
    p.sources.set_on("boards", false);
    s.agent.save_profile(&p).unwrap();
    let p = s.agent.profile();
    assert!(p.sources.is_off("jooble") && p.sources.is_off("boards") && !p.sources.is_off("adzuna"));
    // Not searched: no request to either.
    let f = crate::sources::fetch_all(&p, &s.agent.search_keys(), &|_, _, _| true);
    assert!(f.by_source.iter().all(|b| b.0 != "Jooble" && b.0 != "Company job boards"), "{:?}", f.by_source);
    let rows = s.agent.connections().unwrap();
    let row = |id: &str| rows.iter().find(|r| r["id"] == id).unwrap().clone();
    assert_eq!((row("jooble")["status"].as_str(), row("jooble")["actions"][0].as_str()), (Some("off"), Some("on")));
    assert_eq!(row("boards")["status"], "off");
    assert!(row("alerts")["actions"].as_array().unwrap().contains(&json!("off")), "the others can be turned off");
    // Back on: as before, key and boards still there.
    let mut p = s.agent.profile();
    p.sources.set_on("jooble", true);
    s.agent.save_profile(&p).unwrap();
    let rows = s.agent.connections().unwrap();
    assert_ne!(rows.iter().find(|r| r["id"] == "jooble").unwrap()["status"], "off");
    assert_eq!(s.agent.profile().sources.greenhouse, vec!["acme".to_string()]);
}

#[test]
fn no_job_alert_emails_is_not_a_problem() {
    let s = setup();
    assert!(s.agent.mail.read().unwrap().is_some(), "Gmail connected");
    // A test saved by an older version: no alerts this week, marked as failing.
    let old = json!({ "started": now(), "finished": now(), "results": [{ "id": "alerts", "name": "Job-alert emails (LinkedIn, Indeed, Glassdoor, Job Bank)", "kind": "email",
        "ok": false, "found": 0, "unit": "emails this week", "hint": "None this week. On LinkedIn, Indeed, Glassdoor and Job Bank, set up job alerts.", "at": now() }] });
    s.agent.db().set("sources.test", &old.to_string()).unwrap();
    let rows = s.agent.connections().unwrap();
    let alerts = rows.iter().find(|r| r["id"] == "alerts").unwrap();
    assert_eq!(alerts["status"], "ok", "{alerts}");
    assert!(alerts["detail"].as_str().unwrap().starts_with("0 emails this week. None this week"), "{alerts}");
    assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Job-alert")), "nothing to fix");
    // A real error still is one.
    let broken = json!({ "finished": now(), "results": [{ "id": "alerts", "name": "Job-alert emails", "kind": "email", "ok": false, "error": "Google said 401", "hint": "Reconnect Google.", "at": now() }] });
    s.agent.db().set("sources.test", &broken.to_string()).unwrap();
    assert_eq!(s.agent.connections().unwrap().iter().find(|r| r["id"] == "alerts").unwrap()["status"], "problem");
}

#[test]
fn emailing_the_recruiter_when_you_apply() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    crate::recruiters::edit(&s.agent, &json!({ "email": "jane@acme.example", "name": "Jane Smith", "company": "Acme" })).unwrap();
    // Draft (the default): in Gmail drafts, once.
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let v = crate::recruiters::on_applied(&s.agent, "test:1").unwrap().unwrap();
    assert_eq!((v["to"].as_str(), v["drafted"].as_bool(), v["sent"].as_bool()), (Some("jane@acme.example"), Some(true), Some(false)));
    assert!(s.mail.drafts.lock().unwrap().iter().any(|(to, _)| to == "to:jane@acme.example"));
    assert!(crate::recruiters::on_applied(&s.agent, "test:1").unwrap().is_none(), "not twice for one application");
    // Another application the same week: not again to her.
    s.agent.db().set_status("test:2", "applied", "").unwrap();
    assert!(crate::recruiters::on_applied(&s.agent, "test:2").unwrap().is_none(), "once a week at most");
    assert!(crate::recruiters::for_job(&s.agent, "test:1").iter().any(|l| l["email"] == "jane@acme.example"), "saved with the application");
    // Off: nothing.
    s.agent.db().set("apply.recruiter", "off").unwrap();
    crate::recruiters::set_hidden(&s.agent, "jane@acme.example", true).unwrap();
    assert!(crate::recruiters::on_applied(&s.agent, "test:2").unwrap().is_none());
}

#[test]
fn emailing_the_person_named_in_the_posting() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    let p = Posting { description: "Apply through our site. Questions? careers@acme.example, or Maria Lopez (maria.lopez@acme.example), Talent Acquisition.".into(), ..posting("Technical Program Manager", "1") };
    s.agent.search(Some(vec![p])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let job = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(crate::recruiters::contact_for(&s.agent, &job), Some(("maria.lopez@acme.example".into(), String::new(), false)), "not the careers@ inbox");
    // Sent, with the CV, when you chose that.
    s.agent.db().set("apply.recruiter", "send").unwrap();
    s.agent.db().set("apply.recruiter_cv", "1").unwrap();
    let v = crate::recruiters::on_applied(&s.agent, "test:1").unwrap().unwrap();
    assert_eq!(v["sent"], true);
    let sent = s.mail.sent.lock().unwrap();
    assert_eq!(sent[0].0, "maria.lopez@acme.example");
    assert_eq!(sent[0].1.len(), if job.cv_path.is_some() { 1 } else { 0 }, "the tailored CV attached");
}

#[test]
fn recruiters_saved_with_their_applications() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    // A list kept before the database had a table: moved over.
    s.agent.db().set("recruiters", &json!([{ "email": "old@globex.example", "name": "Olga", "company": "Globex", "stage": "screen" }]).to_string()).unwrap();
    assert_eq!(crate::recruiters::list(&s.agent)[0].company, "Globex");
    assert!(s.agent.secret("recruiters").is_empty());
    // You applied; the recruiter writes about it.
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    s.mail.messages.lock().unwrap().insert("m9".into(), crate::google::Email { id: "m9".into(), thread_id: "t9".into(), from: "Priya Shah <priya.shah@acme.example>".into(),
        subject: "Your application: Technical Program Manager".into(), received_at: "2026-10-01T14:00:00Z".into(),
        body: "Hi, thanks for applying. Are you free for a call this week?\n\nPriya Shah\nTalent Acquisition, Acme\n(416) 555-0199\nlinkedin.com/in/priyashah\n\nOn Mon, Sam wrote:\n> my old email 647-555-0000".into(), ..Default::default() });
    s.llm.triages.lock().unwrap().push(triage("interview_request", Some("test:1")));
    s.agent.process_inbox(50).unwrap();
    let here = crate::recruiters::for_job(&s.agent, "test:1");
    assert_eq!(here.len(), 1, "{here:?}");
    assert_eq!((here[0]["email"].as_str(), here[0]["stage"].as_str(), here[0]["name"].as_str()), (Some("priya.shah@acme.example"), Some("interview"), Some("Priya Shah")));
    let r = crate::recruiters::list(&s.agent).into_iter().find(|r| r.email == "priya.shah@acme.example").unwrap();
    assert_eq!((r.phone.as_str(), r.linkedin.as_str()), ("(416) 555-0199", "https://linkedin.com/in/priyashah"), "from her signature, not the quoted email");
    assert!(s.agent.contacts("test:1").iter().any(|c| c["email"] == "priya.shah@acme.example"), "on the application's People list");
    // Added by you, to the same application; and all of it as a spreadsheet.
    crate::recruiters::edit(&s.agent, &json!({ "email": "Sam@Acme.example", "name": "Sam Lee", "company": "Acme", "notes": "Met at a meetup", "job_id": "test:1" })).unwrap();
    assert_eq!(crate::recruiters::for_job(&s.agent, "test:1").len(), 2);
    assert!(crate::recruiters::edit(&s.agent, &json!({ "email": "nobody" })).is_err());
    let csv = crate::recruiters::csv(&s.agent);
    assert!(csv.contains("\"Priya Shah\",\"Acme\"") && csv.contains("Technical Program Manager (interviewing)") && csv.contains("Met at a meetup"), "{csv}");
    // An application deleted: its links go too.
    s.agent.db().delete_job("test:1").unwrap();
    assert!(crate::recruiters::for_job(&s.agent, "test:1").is_empty());
}

#[test]
fn recruiters_linked_from_emails_already_read() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().record_email("old1", "t", Some("test:1"), "Dana Wu <dana@acme.example>", "Re: your interview", "interview_confirmed", "s", None, "2026-05-02T10:00:00Z").unwrap();
    s.agent.db().record_email("old2", "t", Some("test:1"), "Acme <no-reply@greenhouse.io>", "Thanks for applying", "application_received", "s", None, "2026-05-01T10:00:00Z").unwrap();
    assert_eq!(crate::recruiters::backfill(&s.agent).unwrap(), 1, "the person, not the automated email");
    assert_eq!(crate::recruiters::backfill(&s.agent).unwrap(), 0, "once");
    let here = crate::recruiters::for_job(&s.agent, "test:1");
    assert_eq!((here[0]["email"].as_str(), here[0]["stage"].as_str()), (Some("dana@acme.example"), Some("interview")));
}

#[test]
fn recruiters_you_know_and_asking_them() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    let mail = |id: &str, from: &str, subject: &str| crate::google::Email { id: id.into(), thread_id: id.into(), from: from.into(), subject: subject.into(),
        body: "Thanks for your time on the call. Unfortunately we've moved forward with another candidate.".into(), received_at: "2026-04-10T15:00:00Z".into(), ..Default::default() };
    {
        let mut m = s.mail.messages.lock().unwrap();
        m.insert("r1".into(), mail("r1", "Jane Recruiter <jane@acme.example>", "Tax Manager: next steps"));
        m.insert("r2".into(), mail("r2", "Jane Recruiter <jane@acme.example>", "Re: Tax Manager interview"));
        m.insert("r3".into(), mail("r3", "Acme Careers <no-reply@greenhouse.io>", "Thank you for applying"));
        m.insert("r4".into(), mail("r4", "Acme Careers <careers@acme.example>", "Your application"));
    }
    let v = crate::recruiters::scan(&s.agent).unwrap();
    assert_eq!((v["found"].as_u64(), v["new"].as_u64()), (Some(1), Some(1)), "{v}");
    let list = crate::recruiters::list(&s.agent);
    assert_eq!((list[0].email.as_str(), list[0].company.as_str(), list[0].emails), ("jane@acme.example", "Acme", 2));
    assert!(s.mail.labels.lock().unwrap().iter().filter(|(_, l)| l == crate::recruiters::LABEL).count() == 2, "her emails in one Gmail label");
    // A posting at Acme: she's named on it, and asking her drafts the email in Gmail.
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let ov = s.agent.overview().unwrap();
    let named = ov["to_tailor"].as_array().unwrap().iter().chain(ov["ready"].as_array().unwrap()).any(|j| j["recruiter"] == "Jane Recruiter");
    assert!(named, "{}", ov["to_tailor"]);
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    assert_eq!(s.agent.overview().unwrap()["recruiter_asks"].as_array().unwrap().len(), 1, "a reminder to ask her");
    let a = crate::recruiters::ask(&s.agent, "test:1").unwrap();
    assert_eq!((a["to"].as_str(), a["drafted"].as_bool()), (Some("jane@acme.example"), Some(true)));
    assert!(s.mail.drafts.lock().unwrap().iter().any(|(to, _)| to == "to:jane@acme.example"));
    assert!(s.agent.overview().unwrap()["recruiter_asks"].as_array().unwrap().is_empty(), "asked: not reminded again");
    assert!(s.agent.contacts("test:1").iter().any(|c| c["email"] == "jane@acme.example"));
    // Hidden: not used.
    crate::recruiters::set_hidden(&s.agent, "jane@acme.example", true).unwrap();
    assert!(crate::recruiters::ask(&s.agent, "test:1").is_err());
}

#[test]
fn next_wake_for_the_daily_search() {
    let s = setup();
    assert!(s.agent.next_wake().is_none(), "off until turned on");
    s.agent.db().set("app.wake", "1").unwrap();
    let tz = s.agent.profile().tz();
    let w = s.agent.next_wake().unwrap().with_timezone(&tz);
    let now = Utc::now();
    assert!(w > now && w <= now + Duration::days(1) + Duration::hours(2), "{w}");
    use chrono::Timelike;
    let hours = [s.agent.profile().search_hour, 18];
    assert!(hours.contains(&w.hour()) && w.minute() == 1, "{w}");
}

#[test]
fn budget_night_urgent_notices_and_held_batches() {
    assert!(is_night(23, 22) && is_night(3, 22) && !is_night(12, 22));
    assert!(is_night(2, 2) && is_night(5, 2) && !is_night(1, 2) && !is_night(14, 2), "an hour after midnight");
    assert!(is_urgent("Interview tomorrow at 10:00 AM: Acme") && is_urgent("Reply from Acme"));
    assert!(!is_urgent("Interview prep didn't finish") && !is_urgent("Your week in Job Hunt"));
    let s = setup();
    s.agent.defer(json!({ "kind": "rescore", "group": "skipped" })).unwrap();
    s.agent.defer(json!({ "kind": "rescore", "group": "dismissed" })).unwrap();
    s.agent.defer(json!({ "kind": "rescore", "group": "skipped" })).unwrap();
    s.agent.defer(json!({ "kind": "tailor", "ids": ["a", "b"] })).unwrap();
    s.agent.defer(json!({ "kind": "tailor", "ids": ["b", "c"] })).unwrap();
    let held = s.agent.deferred();
    assert_eq!(held.iter().filter(|w| w["kind"] == "rescore").count(), 2, "one per group: {held:?}");
    assert_eq!(held.iter().find(|w| w["kind"] == "tailor").unwrap()["ids"], json!(["a", "b", "c"]));
}

#[test]
fn all_day_google_events_stay_on_their_day() {
    let s = setup();
    let day = (Utc::now() + Duration::days(3)).date_naive();
    let cache = json!({ "at": now(), "events": [{ "id": "g1", "title": "Offsite", "start": format!("{day}T00:00:00+00:00"), "all_day": true, "suggest": null }] });
    s.agent.db().set("gcal.cache", &cache.to_string()).unwrap();
    let item = s.agent.calendar(1, 30).unwrap().into_iter().find(|i| i["id"] == "g1").unwrap();
    let at = chrono::DateTime::parse_from_rfc3339(item["at"].as_str().unwrap()).unwrap().with_timezone(&s.agent.profile().tz());
    assert_eq!(at.date_naive(), day, "noon where you are, not midnight UTC (the evening before in Toronto)");
    assert!(s.agent.link_calendar_event("g1", "test:1").unwrap_err().0.contains("all-day"));
}

#[test]
fn morning_digest_with_an_interview_tomorrow() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    s.agent.add_interview("test:1", &(Utc::now() + Duration::hours(20)).to_rfc3339(), 60, "", "").unwrap();
    // Used to hang: the time zone was read while the interview list held the database.
    let text = s.agent.morning_digest().unwrap().unwrap();
    assert!(text.starts_with("Interview: Acme"), "{text}");
}

#[test]
fn interview_eve_and_thank_you() {
    let s = setup();
    // Claude counts as set up whether or not Claude Code is installed on this machine.
    s.agent.db().set("claude.engine", "api").unwrap();
    s.agent.db().set("claude.key", "test").unwrap();
    *s.agent.cal.write().unwrap() = None;
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    for id in ["test:1", "test:2"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
    }
    s.agent.add_interview("test:1", &(Utc::now() + Duration::hours(3)).to_rfc3339(), 60, "", "").unwrap();
    s.agent.add_interview("test:2", &(Utc::now() - Duration::hours(2)).to_rfc3339(), 60, "", "").unwrap();
    let done = s.agent.interview_care().unwrap();
    assert_eq!(done, vec!["thanks:test:2".to_string(), "eve:test:1".to_string()]);
    assert!(s.agent.prep("test:1").is_some(), "prep written for the eve");
    let notes = s.notes.lock().unwrap().clone();
    assert!(notes.iter().any(|n| n.starts_with("Interview today at") || n.starts_with("Interview tomorrow at")), "{notes:?}");
    assert!(notes.contains(&"Thank-you note for Acme".to_string()));
    let t = s.agent.thank_you("test:2").unwrap();
    assert!(t["subject"].as_str().unwrap().starts_with("Thank you") && t["draft"].is_string(), "{t}");
    assert!(s.agent.interview_care().unwrap().is_empty(), "once each");
}

#[test]
fn results_by_title_and_pay_and_career_paths() {
    let s = setup();
    let paid = |t: &str, ext: &str, pay: &str| Posting { salary: Some(pay.into()), ..posting(t, ext) };
    s.agent.search(Some(vec![
        paid("Senior Technical Program Manager", "1", "$120,000 - $140,000"), paid("Technical Program Manager II", "2", "$90,000 - $100,000"),
        posting("Program Manager, Delivery", "3"),
    ])).unwrap();
    for id in ["test:1", "test:2", "test:3"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
    }
    s.agent.db().set_status("test:1", "interviewing", "").unwrap();
    let r = s.agent.results().unwrap();
    let tpm = r["by_title"].as_array().unwrap().iter().find(|g| g["name"] == "Technical Program Manager").unwrap();
    assert_eq!((tpm["sent"].as_u64(), tpm["interviews"].as_u64()), (Some(2), Some(1)), "{}", r["by_title"]);
    let bands: Vec<&str> = r["by_pay"].as_array().unwrap().iter().filter_map(|g| g["name"].as_str()).collect();
    assert_eq!(bands, vec!["$80k–100k", "$120k–140k", "Not stated"]);
    assert_eq!(r["market_pay"][0]["postings"].as_u64(), Some(2));
    let c = s.agent.write_career_paths().unwrap();
    assert_eq!(c["paths"][0]["title"], "Data Engineering Manager");
    assert!(s.agent.results().unwrap()["career"]["paths"].is_array());
    let track = s.agent.profile().tracks[0].name.clone();
    assert_eq!(s.agent.add_titles(&track, &["Data Systems Lead".into(), "data systems lead".into()]).unwrap(), 1);
    assert!(s.agent.profile().tracks[0].titles.contains(&"Data Systems Lead".to_string()));
}

#[test]
fn the_career_coach_finds_missing_skills_and_suggests_titles() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Program Manager, Delivery", "2")])).unwrap();
    let g = s.agent.skill_gaps().unwrap();
    assert_eq!(g["postings"].as_u64(), Some(2), "{g}");
    let skills: Vec<&str> = g["skills"].as_array().unwrap().iter().filter_map(|x| x["skill"].as_str()).collect();
    assert_eq!(skills.first(), Some(&"Kubernetes"), "missing from the CV in both: {skills:?}");
    assert!(!skills.contains(&"UAT"), "the CV shows UAT: {skills:?}");
    assert_eq!(g["skills"][0]["missing"].as_u64(), Some(2));
    let c = s.agent.write_coach().unwrap();
    assert_eq!(c["skills"][0]["skill"], "Kubernetes");
    assert!(s.llm.calls.lock().unwrap().iter().any(|x| x.starts_with("coach:") && x.contains("Kubernetes: asked for in 2 postings")), "the gaps go to Claude");
    // The suggested title waits on the Overview until it's added or dismissed.
    assert_eq!(s.agent.title_ideas()[0]["title"], "Delivery Lead");
    s.agent.title_idea_done("Delivery Lead", true).unwrap();
    assert!(s.agent.title_ideas().is_empty());
    assert!(s.agent.profile().tracks.iter().any(|t| t.titles.contains(&"Delivery Lead".to_string())));
    // Searched already: not suggested again.
    s.agent.write_coach().unwrap();
    assert!(s.agent.title_ideas().is_empty());
}

#[test]
fn warnings_about_postings() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let old = (Utc::now() - Duration::days(50)).to_rfc3339();
    s.agent.db().backdate("test:1", &old).unwrap();
    // The same role on another site, undated: likely the same posting, not a repost.
    s.agent.search(Some(vec![Posting { url: "https://acme.example/jobs/98".into(), ..posting("Technical Program Manager", "3") }])).unwrap();
    assert!(s.agent.db().reposts().unwrap().is_empty());
    // The same role, as a new listing dated weeks after it was first found: a repost.
    let yesterday = (Utc::now() - Duration::days(1)).format("%Y-%m-%d").to_string();
    s.agent.search(Some(vec![Posting { url: "https://acme.example/jobs/99".into(), posted_at: Some(yesterday), ..posting("Technical Program Manager", "2") }])).unwrap();
    let reposts = s.agent.db().reposts().unwrap();
    assert_eq!(reposts.get("test:1"), Some(&1));
    let j = s.agent.db().job("test:1").unwrap().unwrap();
    let w = posting_warnings(&j, 1, Utc::now());
    assert!(w.iter().any(|x| x.contains("Posted again")) && w.iter().any(|x| x.contains("50 days")), "{w:?}");
    let pool = Job { description: "Join our talent community for future opportunities.".into(), found_at: Utc::now().to_rfc3339(), ..j.clone() };
    assert!(posting_warnings(&pool, 0, Utc::now())[0].contains("Not an open role"));
    let agency = Job { company: "Northstar Staffing Inc.".into(), description: "Our client, a leading bank, is hiring.".into(), found_at: Utc::now().to_rfc3339(), ..j.clone() };
    assert_eq!(posting_warnings(&agency, 0, Utc::now()), vec!["A recruiting agency, for a client it doesn't name.".to_string()]);
    let fine = Job { found_at: Utc::now().to_rfc3339(), ..j };
    assert!(posting_warnings(&fine, 0, Utc::now()).is_empty());
    assert_eq!(posted_date("1760000000").unwrap().timestamp(), 1760000000);
    assert!(posted_date("jsearch|2026-10-01").is_some() && posted_date("3 days ago").is_none());
}

#[test]
fn two_way_google_calendar_sync() {
    use crate::google::CalItem;
    let s = setup();
    *s.agent.cal.write().unwrap() = None; // kept locally first
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let when = (Utc::now() + Duration::days(3)).to_rfc3339();
    s.agent.add_interview("test:1", &when, 60, "", "").unwrap();
    s.agent.search(Some(vec![Posting { company: "Globex".into(), url: "https://globex.example/9".into(), ..posting("Senior Program Manager", "2") }])).unwrap();
    s.agent.db().set_status("test:2", "applied", "").unwrap();
    // Google connected: local entries are copied there.
    *s.agent.cal.write().unwrap() = Some(s.cal.clone());
    let r = s.agent.sync_calendar().unwrap();
    assert!(r["pushed"].as_i64().unwrap() >= 2, "{r}");
    assert!(s.agent.db().calendar_ids().unwrap().iter().all(|e| !e.event_id.starts_with("local:")));
    let interview = s.agent.db().calendar_ids().unwrap().into_iter().find(|e| e.kind == "interview").unwrap();
    // In Google: the interview is moved, a reminder deleted, and a new event looks like a Globex interview.
    let later = (Utc::now() + Duration::days(4)).to_rfc3339();
    let other = s.agent.db().calendar_ids().unwrap().into_iter().find(|e| e.kind != "interview").unwrap();
    let start = (Utc::now() + Duration::days(5)).to_rfc3339();
    *s.cal.items.lock().unwrap() = vec![
        CalItem { id: interview.event_id.clone(), summary: interview.title.clone(), start: later.clone(), ..Default::default() },
        CalItem { id: other.event_id.clone(), cancelled: true, ..Default::default() },
        CalItem { id: "g1".into(), summary: "Interview - Globex".into(), start: start.clone(), ..Default::default() },
        CalItem { id: "g2".into(), summary: "Dentist".into(), start: start.clone(), ..Default::default() },
    ];
    let r = s.agent.sync_calendar().unwrap();
    assert_eq!((r["moved"].as_i64(), r["removed"].as_i64(), r["others"].as_i64()), (Some(1), Some(1), Some(2)), "{r}");
    let ids = s.agent.db().calendar_ids().unwrap();
    assert_eq!(ids.iter().find(|e| e.event_id == interview.event_id).unwrap().start, later);
    assert!(!ids.iter().any(|e| e.event_id == other.event_id));
    let items = s.agent.calendar(1, 30).unwrap();
    let g1 = items.iter().find(|i| i["id"] == "g1").unwrap();
    assert_eq!((g1["kind"].as_str(), g1["suggest"]["job_id"].as_str()), (Some("google"), Some("test:2")));
    assert!(items.iter().find(|i| i["id"] == "g2").unwrap()["suggest"].is_null());
    // Linking it makes it that application's interview.
    s.agent.link_calendar_event("g1", "test:2").unwrap();
    assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().status, "interviewing");
    let items = s.agent.calendar(1, 30).unwrap();
    assert!(items.iter().any(|i| i["id"] == "g1" && i["kind"] == "interview" && i["job_id"] == "test:2"));
    s.agent.db().set("cal.show_google", "0").unwrap();
    assert!(!s.agent.calendar(1, 30).unwrap().iter().any(|i| i["kind"] == "google"));
}

#[test]
fn the_same_posting_by_link_counts_once() {
    let s = setup();
    let a = Posting { url: "https://acme.example/jobs/77?utm_source=jsearch".into(), ..posting("Technical Program Manager", "1") };
    let b = Posting { source: "jsearch".into(), company: "Acme Inc. (Canada)".into(), title: "Technical Program Manager - Payments".into(), url: "https://www.acme.example/en-US/jobs/77/apply".into(), ..posting("x", "2") };
    let r = s.agent.search(Some(vec![a, b.clone()])).unwrap();
    assert_eq!(r.new, 1, "one search, two sources");
    let r = s.agent.search(Some(vec![Posting { external_id: "3".into(), ..b }])).unwrap();
    assert_eq!((r.new, r.known), (0, 1), "a later search");
}

#[test]
fn tailor_anyway_rescore_and_purge() {
    let s = setup();
    s.llm.scores.lock().unwrap().insert("Weak Program Manager".into(), 40);
    let far = Posting { location: "Vancouver, BC".into(), ..posting("Program Manager", "3") };
    s.agent.search(Some(vec![posting("Weak Program Manager", "2"), far])).unwrap();
    // Tailor anyway: a low score, and one the filters left out (never scored, outside your places).
    let low = s.agent.tailor_anyway("test:2", None).unwrap();
    assert_eq!((low.status.as_str(), low.score), ("ready", Some(40)));
    let out = s.agent.tailor_anyway("test:3", None).unwrap();
    assert_eq!(out.status, "ready");
    assert!(out.score.is_some(), "scored first");
    s.agent.drop_outside_locations().unwrap();
    assert_eq!(s.agent.db().job("test:3").unwrap().unwrap().status, "ready", "you chose it: kept");

    // Rescore: a skipped posting that now clears the bar.
    s.agent.search(Some(vec![posting("Weak Program Manager", "5")])).unwrap_or_default();
    let mut job = posting("Senior Program Manager", "6").to_job();
    (job.status, job.score) = ("skipped".into(), Some(30));
    s.agent.db().insert_job(&job).unwrap();
    let plan = s.agent.rescore_plan("skipped").unwrap();
    assert!(plan["to_score"].as_u64().unwrap() >= 1);
    let r = s.agent.rescore("skipped").unwrap();
    assert!(r["cleared"].as_u64().unwrap() >= 1);
    assert_eq!(s.agent.db().job("test:6").unwrap().unwrap().status, "queued");
    assert!(s.agent.rescore_plan("everything").is_err());

    // Purge: old skipped postings go and are remembered; tailored ones stay.
    let mut old = posting("Barista", "9").to_job();
    old.status = "skipped".into();
    s.agent.db().insert_job(&old).unwrap();
    s.agent.db().con.execute("UPDATE jobs SET updated_at = '2020-01-01T00:00:00Z' WHERE id IN ('test:9', 'test:2')", []).unwrap();
    assert_eq!(s.agent.db().purge_older_than(0).unwrap(), 0, "off");
    assert_eq!(s.agent.db().purge_older_than(30).unwrap(), 1);
    assert!(s.agent.db().job("test:9").unwrap().is_none() && s.agent.db().job("test:2").unwrap().is_some());
    assert!(s.agent.db().job_exists("test:9", "Co", "Barista").unwrap(), "not new if found again");
}

#[test]
fn the_tracker_shows_steps_and_whats_next() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let row = s.agent.tracker(Some("test:1")).unwrap().pop().unwrap();
    assert_eq!((row["who"].as_str(), row["last_step"].as_str()), (Some("you"), Some("Tailored")));
    // The morning summary mentions it, once a day.
    let digest = s.agent.morning_digest().unwrap().unwrap();
    assert!(digest.contains("1 application to review"), "{digest}");
    assert!(s.notes.lock().unwrap().contains(&"Today in Job Hunt".to_string()));
    assert!(!due_tasks(&s.agent).contains(&"digest"), "done for today");
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let rows = s.agent.tracker(None).unwrap();
    let row = rows.iter().find(|r| r["id"] == "test:1").unwrap();
    assert_eq!((row["who"].as_str(), row["last_step"].as_str()), (Some("them"), Some("Applied")));
    assert!(row["next"].as_str().unwrap().starts_with("Waiting for a reply"));
    assert!(row["steps"][3]["at"].is_null(), "no reply yet");
}

#[test]
fn search_scores_filters_and_tailors() {
    let s = setup();
    s.llm.scores.lock().unwrap().insert("Weak Program Manager".into(), 40);
    let far = Posting { location: "Vancouver, BC".into(), ..posting("Program Manager", "3") };
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Weak Program Manager", "2"), far, posting("Technical Program Manager", "4")])).unwrap();
    assert_eq!((r.new, r.filtered, r.scored, r.tailored), (3, 1, 2, 1));
    let job = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(job.status, "ready");
    assert!(job.coverage_after.unwrap() > job.coverage_before.unwrap());
    assert!(job.keyword_gaps.contains(&"Kubernetes".to_string()));
    assert!(job.cv_changes[0].before.starts_with("Managed contracted"));
    let tailored = cv::open(Path::new(job.cv_path.as_ref().unwrap())).unwrap();
    assert!(tailored.plain_text().contains("Led vendor management of contracted"));
    assert!(Path::new(job.letter_path.as_ref().unwrap()).exists());
    assert!(job.cv_path.unwrap().ends_with("Jane Candidate - Acme.docx"));
    assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().status, "skipped");
    assert!(s.agent.db().job("test:3").unwrap().unwrap().reasoning.unwrap().starts_with("Filtered out: location"));
    assert_eq!(*s.notes.lock().unwrap(), vec!["1 application ready"]);
    // Again: nothing new, nothing re-scored.
    let calls = s.llm.calls.lock().unwrap().len();
    assert_eq!(s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap().new, 0);
    assert_eq!(s.llm.calls.lock().unwrap().len(), calls);
}

#[test]
fn daily_cap_queues_the_rest() {
    let s = setup();
    let mut p = s.agent.profile();
    p.max_per_run = 1;
    s.agent.db().save_profile(&p).unwrap();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    let counts = s.agent.db().counts().unwrap();
    assert_eq!((counts["ready"].as_i64(), counts["queued"].as_i64()), (Some(1), Some(1)));
    drop(counts);
    s.agent.search(Some(vec![])).unwrap();
    assert_eq!(s.agent.db().counts().unwrap()["ready"].as_i64(), Some(2));
}

#[test]
fn no_cv_no_search() {
    let s = setup();
    std::fs::remove_file(s.agent.cv_path("program")).unwrap();
    assert!(s.agent.search(Some(vec![])).unwrap_err().0.contains("No CV"));
}

#[test]
fn a_posting_sent_twice_points_at_the_one_there() {
    let s = setup();
    let clip = json!({"url": "https://careers.acme.example/1", "title": "Data Lead", "company": "Acme", "location": "Toronto, ON", "structured": true,
        "text": "Lead the data platform team and its roadmap, with stakeholders across the bank."});
    let first = s.agent.add_clip(&clip).unwrap();
    let e = s.agent.add_clip(&clip).unwrap_err();
    assert!(e.0.contains("is already in Job Hunt."));
    let h = s.agent.db().history(&first.id).unwrap();
    assert!(h.iter().any(|x| x.kind == "added-again"), "noted on that job, so Recent activity links to it");
}

#[test]
fn looks_up_each_company_once() {
    let s = setup();
    s.agent.search(Some(vec![
        Posting { company: "Acme Inc.".into(), ..posting("Technical Program Manager", "1") },
        Posting { company: "Acme".into(), ..posting("Senior Program Manager", "2") },
        Posting { company: "Unknown Co".into(), ..posting("Program Manager", "3") },
    ])).unwrap();
    assert_eq!(s.agent.companies_to_rate().len(), 2, "Acme Inc. and Acme are one employer");
    assert_eq!(s.agent.rate_companies(5), 2);
    assert!(s.agent.companies_to_rate().is_empty(), "kept for 60 days (7 when none was found)");
    let r = s.agent.db().rating("ACME Inc").unwrap();
    assert_eq!((r["rating"].as_f64(), r["reviews"].as_i64(), r["source"].as_str()), (Some(4.1), Some(1234), Some("Glassdoor")));
    assert_eq!(s.agent.db().rating("Unknown Co").unwrap()["found"], false);
    assert_eq!(s.llm.calls.lock().unwrap().iter().filter(|c| c.starts_with("company_rating")).count(), 2);
}

#[test]
fn keeps_the_predicted_fit_after_tailoring() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let j = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!((j.score, j.score_potential), (Some(85), Some(92)));
    assert_eq!(j.brief()["score_potential"], 92);
}

#[test]
fn finds_the_company_posting_once() {
    let s = setup();
    let board = |t: &str, id: &str| Posting { url: format!("https://www.linkedin.com/jobs/view/{id}/"), ..posting(t, id) };
    s.agent.search(Some(vec![board("Technical Program Manager", "1"), board("Senior Program Manager", "2")])).unwrap();
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().apply_url, None, "a job board isn't the company's site");
    assert_eq!(s.agent.find_company_apply("test:1").unwrap().as_deref(), Some("https://careers.example.com/jobs/1"));
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().apply_url.as_deref(), Some("https://careers.example.com/jobs/1"));
    assert_eq!(s.agent.find_company_apply("test:1").unwrap().as_deref(), Some("https://careers.example.com/jobs/1"), "kept, not asked again");
    assert_eq!(s.agent.find_company_apply("test:2").unwrap(), None);
    assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().apply_url, None);
}

#[test]
fn your_files_move_to_the_folder_you_choose() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let job = s.agent.tailor("test:1", None).unwrap();
    let cv = PathBuf::from(job.cv_path.unwrap());
    assert!(cv.starts_with(s.agent.data.join("applications")), "at first, in the data folder");
    let backup = crate::backup::create(&s.agent).unwrap();
    assert!(backup.starts_with(s.agent.data.join("backups")));
    let docs = tempfile::tempdir().unwrap();
    let dest = docs.path().join("Job Hunt");
    s.agent.set_files_folder(&dest.to_string_lossy()).unwrap();
    assert!(dest.join("backups").join(backup.file_name().unwrap()).is_file() && !backup.exists(), "backups moved too");
    assert!(crate::backup::create(&s.agent).unwrap().starts_with(dest.join("backups")), "and new ones go there");
    assert_eq!(s.agent.files(), dest);
    let moved = PathBuf::from(s.agent.db().job("test:1").unwrap().unwrap().cv_path.unwrap());
    assert!(moved.starts_with(dest.join("applications")) && moved.is_file(), "{moved:?}");
    assert!(!cv.exists() && s.agent.cv_path(&s.agent.profile().tracks[0].name).is_file(), "CVs moved too");
    // A path saved on another computer is found here.
    s.agent.db().update_job("test:1", &[("cv_path", format!("C:\\Users\\someone\\AppData\\Local\\Job Hunt\\data\\applications\\{}", moved.strip_prefix(dest.join("applications")).unwrap().to_string_lossy().replace('/', "\\")).into())]).unwrap();
    assert_eq!(s.agent.fix_file_paths(), 1);
    assert_eq!(PathBuf::from(s.agent.db().job("test:1").unwrap().unwrap().cv_path.unwrap()), moved);
}

#[test]
fn job_bank_is_turned_on_once_in_canada() {
    let s = setup();
    assert!(!s.agent.profile().sources.jobbank);
    s.agent.jobbank_on_once();
    assert!(s.agent.profile().sources.jobbank, "the sample profile searches Canada");
    let mut p = s.agent.profile();
    p.sources.jobbank = false;
    s.agent.save_profile(&p).unwrap();
    s.agent.jobbank_on_once();
    assert!(!s.agent.profile().sources.jobbank, "turned off by you: stays off");
}

#[test]
fn canadas_big_employers_are_added_once() {
    let s = setup();
    s.agent.canada_employers_once();
    assert_eq!(s.agent.profile().sources.workday.len(), CANADA_EMPLOYERS.len());
    s.agent.remove_boards(&[json!({ "source": "workday", "name": CANADA_EMPLOYERS[4].1 })]).unwrap();
    s.agent.canada_employers_once();
    assert_eq!(s.agent.profile().sources.workday.len(), CANADA_EMPLOYERS.len() - 1, "removed by you: stays removed");
    assert!(CANADA_EMPLOYERS.iter().all(|(_, l)| crate::sources::workday_board(l).is_some()));
}

#[test]
fn chatting_about_a_job_keeps_the_conversation() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    assert!(s.agent.chat_send("test:1", "  ").is_err());
    let r = s.agent.chat_send("test:1", "How do I answer the salary question?").unwrap();
    assert!(r.contains("(0 before)"), "{r}");
    let r = s.agent.chat_send("test:1", "Shorter please").unwrap();
    assert!(r.contains("(2 before)"), "the earlier turns go along: {r}");
    assert_eq!(s.agent.chat("test:1").len(), 4);
    assert_eq!(s.agent.chat("test:1")[1]["who"], "claude");
    s.agent.chat_clear("test:1").unwrap();
    assert!(s.agent.chat("test:1").is_empty());
}

#[test]
fn applying_yourself_is_picked_up_and_your_own_cv_is_used() {
    let s = setup();
    *s.agent.cal.write().unwrap() = None;
    // A confirmation (archived or not) for a job Job Hunt never found: it joins your applications.
    s.mail.messages.lock().unwrap().insert("c1".into(), crate::google::Email { id: "c1".into(), thread_id: "tc1".into(), from: "Globex Careers <no-reply@globex.example>".into(),
        subject: "Thank you for applying: Regulatory Change Program Manager".into(), received_at: "2026-10-27T14:00:00Z".into(),
        body: "We received your application for Regulatory Change Program Manager.".into(), ..Default::default() });
    s.llm.triages.lock().unwrap().push(Triage { company: Some("Globex".into()), role: Some("Regulatory Change Program Manager".into()), ..triage("application_received", None) });
    s.agent.process_inbox(50).unwrap();
    let mine = s.agent.db().jobs(Some("applied"), 10).unwrap();
    assert_eq!(mine.len(), 1, "added as applied");
    assert_eq!((mine[0].company.as_str(), mine[0].title.as_str(), mine[0].source.as_str()), ("Globex", "Regulatory Change Program Manager", "email"));
    assert!(mine[0].applied_at.is_some());
    assert!(s.mail.labels.lock().unwrap().iter().any(|(id, l)| id == "c1" && l == "Applied"), "labelled JobHunt/Applied in Gmail");
    // Your own tailored CV, on a role not tailored yet: it's ready to approve, and it's the one used.
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "queued", "").unwrap();
    let job = s.agent.use_own_file("test:1", "cv", "My CV.docx", &cv::sample_docx()).unwrap();
    assert_eq!(job.status, "ready");
    assert!(job.cv_path.as_deref().unwrap().ends_with("(yours).docx"));
}

#[test]
fn companies_rated_below_your_minimum_are_skipped() {
    let s = setup();
    let mut p = s.agent.profile();
    p.min_rating = Some(4.5);
    s.agent.save_profile(&p).unwrap();
    // Already rated below the minimum: set aside when found.
    let low = crate::claude::CompanyRating { found: true, rating: Some(3.2), ..Default::default() };
    let company = posting("Technical Program Manager", "1").company;
    s.agent.db().set_rating(&company, &low).unwrap();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let j = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(j.status, "skipped");
    assert!(j.reasoning.unwrap_or_default().contains("below your minimum of 4.5"));
    // Rated after it was found (4.1 from the fake reviews): roles waiting there are set aside.
    let other = Posting { company: "Globex".into(), ..posting("Senior Program Manager", "2") };
    s.agent.search(Some(vec![other])).unwrap();
    assert!(["queued", "ready"].contains(&s.agent.db().job("test:2").unwrap().unwrap().status.as_str()));
    s.agent.rate_company("Globex", "Toronto").unwrap();
    assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().status, "skipped");
}

#[test]
fn long_fit_reasons_are_made_one_line() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let long = "Your strongest match is that you have led platform delivery from start to finish across requirements, design, testing and release, for a large public program. Your biggest gap is the posting's cloud certification.";
    s.agent.db().update_job("test:1", &[("reasoning", long.into())]).unwrap();
    assert_eq!(s.agent.long_reasons().len(), 1);
    assert_eq!(s.agent.shorten_old_reasons(10), 1);
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().reasoning.as_deref(), Some("Your strongest match is that you"));
    assert!(s.agent.long_reasons().is_empty(), "done once");
}

#[test]
fn tailored_job_board_postings_are_looked_up_on_the_company_site() {
    let s = setup();
    let board = |t: &str, id: &str| Posting { url: format!("https://www.linkedin.com/jobs/view/{id}/"), ..posting(t, id) };
    s.agent.search(Some(vec![board("Technical Program Manager", "1"), board("Senior Program Manager", "2")])).unwrap();
    for id in ["test:1", "test:2"] {
        s.agent.db().set_status(id, "ready", "").unwrap();
    }
    assert_eq!(s.agent.without_apply_link().len(), 2);
    assert_eq!(s.agent.find_apply_links(5), 1, "one is on its company's site");
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().apply_url.as_deref(), Some("https://careers.example.com/jobs/1"));
    assert!(s.agent.without_apply_link().is_empty(), "each is looked for once a week at most");
}

#[test]
fn approve_sends_email_applications_or_waits() {
    let s = setup();
    s.agent.search(Some(vec![Posting { apply_email: Some("jobs@acme.example".into()), ..posting("Technical Program Manager", "1") }, posting("Senior Program Manager", "2")])).unwrap();
    assert_eq!(s.agent.approve("test:1").unwrap(), "applied");
    let sent = s.mail.sent.lock().unwrap().clone();
    assert_eq!(sent[0].0, "jobs@acme.example");
    assert_eq!(sent[0].1.len(), 2);
    assert!(s.agent.db().job("test:1").unwrap().unwrap().applied_at.is_some());
    assert_eq!(s.agent.approve("test:2").unwrap(), "approved");
    assert!(s.agent.approve("test:2").is_err(), "only ready jobs");
}

#[test]
fn inbox_updates_tracker_and_labels() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    s.mail.messages.lock().unwrap().insert("m1".into(), email("m1"));
    s.llm.triages.lock().unwrap().push(triage("rejection", Some("test:1")));
    let stats = s.agent.process_inbox(50).unwrap();
    assert_eq!(stats.get("rejection"), Some(&1));
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "rejected");
    // Labelled as a rejection, and (from a person at the company) as a recruiter you know.
    assert_eq!(*s.mail.labels.lock().unwrap(), vec![("m1".to_string(), "Rejected".to_string()), ("m1".to_string(), "Recruiters".to_string())]);
    assert_eq!(crate::recruiters::list(&s.agent)[0].email, "r@acme.example");
    assert!(s.mail.drafts.lock().unwrap().is_empty());
    assert!(s.agent.process_inbox(50).unwrap().is_empty(), "already processed");
}

#[test]
fn inbox_skips_mail_not_about_jobs_and_waits_out_the_limit() {
    let s = setup();
    let mut alert = email("m1");
    (alert.from, alert.subject, alert.body) = ("Power Co <billing@power.example>".into(), "Your electricity bill is ready".into(), "Your bill for this month is ready to view.".into());
    s.mail.messages.lock().unwrap().insert("m1".into(), alert);
    let stats = s.agent.process_inbox(50).unwrap();
    assert_eq!(stats.get("skipped"), Some(&1));
    assert!(!s.llm.calls.lock().unwrap().contains(&"triage".to_string()), "not sent to Claude");
    assert!(s.agent.db().emails(10).unwrap().is_empty(), "not listed in the Inbox");
    // While the usage limit lasts, nothing is read (and nothing reported as an email problem).
    s.agent.usage.lock().unwrap().limited_until = Some(Utc::now().timestamp() + 600);
    s.mail.messages.lock().unwrap().insert("m2".into(), email("m2"));
    assert!(s.agent.process_inbox(50).unwrap().is_empty());
    assert!(!s.agent.db().email_seen("m2").unwrap(), "read after the reset");
    assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap_or("").contains("Email check")));
}

#[test]
fn confirmed_interview_books_calendar_once() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.db().set_status("test:1", "applied", "").unwrap();
    let tz = chrono_tz::America::Toronto;
    let start = tz.with_ymd_and_hms(2026, 10, 21, 14, 0, 0).unwrap(); // a Wednesday
    let slot = TimeSlot { start: start.to_rfc3339(), end: (start + Duration::hours(1)).to_rfc3339() };
    for id in ["m1", "m2"] {
        s.mail.messages.lock().unwrap().insert(id.into(), email(id));
        s.llm.triages.lock().unwrap().push(Triage { confirmed_time: Some(slot.clone()), meeting_link: Some("https://meet.example/x".into()), ..triage("interview_confirmed", Some("test:1")) });
    }
    s.agent.process_inbox(50).unwrap();
    let created = s.cal.created.lock().unwrap().clone();
    let kinds: Vec<&str> = created.iter().map(|e| e.summary.split(':').next().unwrap()).collect();
    assert_eq!(kinds, vec!["Interview", "Prep", "Send thank-you note", "Follow up if no reply"]);
    assert_eq!(created[0].start, start.with_timezone(&Utc));
    assert_eq!(created[0].location.as_deref(), Some("https://meet.example/x"));
    assert_eq!(created[1].end, start.with_timezone(&Utc));
    assert_eq!(created[2].start, tz.with_ymd_and_hms(2026, 10, 22, 9, 0, 0).unwrap().with_timezone(&Utc));
    assert_eq!(created[3].start, tz.with_ymd_and_hms(2026, 10, 28, 9, 0, 0).unwrap().with_timezone(&Utc));
    assert_eq!(created.len(), 4, "the duplicate confirmation added nothing");
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "interviewing");
    assert!(s.notes.lock().unwrap().contains(&"Interview booked".to_string()));
}

#[test]
fn interview_request_drafts_reply_accepting_a_free_slot() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let future = Utc::now() + Duration::days(3);
    let busy_slot = TimeSlot { start: future.to_rfc3339(), end: (future + Duration::hours(1)).to_rfc3339() };
    let free_slot = TimeSlot { start: (future + Duration::days(1)).to_rfc3339(), end: (future + Duration::days(1) + Duration::hours(1)).to_rfc3339() };
    *s.cal.busy.lock().unwrap() = vec![(future, future + Duration::hours(1))];
    s.mail.messages.lock().unwrap().insert("m1".into(), email("m1"));
    s.llm.triages.lock().unwrap().push(Triage { offered_times: vec![busy_slot, free_slot.clone()], ..triage("interview_request", Some("test:1")) });
    s.agent.process_inbox(50).unwrap();
    assert_eq!(*s.llm.accepted.lock().unwrap(), Some(Some(free_slot)));
    assert_eq!(*s.mail.drafts.lock().unwrap(), vec![("m1".to_string(), "Tuesday works, thanks. Jane".to_string())]);
    assert!(s.cal.created.lock().unwrap().is_empty());
}

#[test]
fn cvs_can_be_added_in_any_format_and_removed() {
    let s = setup();
    // A Word CV: used as is, named and set up by Claude.
    let t = s.agent.add_cv("Alex_CV.docx", &cv::sample_docx(), false).unwrap();
    assert_eq!((t.name.as_str(), t.label.as_str(), t.kind.as_str()), ("data-analysis", "Data analysis", "docx"));
    assert_eq!(t.titles, vec!["Senior Data Analyst", "Analytics Manager"]);
    assert_eq!(std::fs::read(s.agent.cv_path("data-analysis")).unwrap(), cv::sample_docx());
    // A PDF: converted to an editable Word copy; the original is kept.
    let pdf = s.agent.add_cv("resume.pdf", b"%PDF-1.7 fake", false).unwrap();
    assert_eq!((pdf.name.as_str(), pdf.kind.as_str()), ("data-analysis-2", "pdf"));
    let doc = cv::open(&s.agent.cv_path(&pdf.name)).unwrap();
    assert!(doc.paras.iter().filter(|p| p.editable).count() >= 3);
    assert!(s.agent.data.join("cv/originals/data-analysis-2.pdf").exists());
    assert!(s.llm.calls.lock().unwrap().contains(&"convert_pdf".to_string()));
    // Plain text works the same way; an old .doc is refused with a clear message.
    let long = "Alex Morgan\nData analyst\n".repeat(20);
    assert_eq!(s.agent.add_cv("cv.txt", long.as_bytes(), false).unwrap().kind, "text");
    assert!(s.agent.add_cv("cv.doc", &[0xD0, 0xCF, 0x11, 0xE0, 0, 0], false).unwrap_err().0.contains(".docx"));
    assert_eq!(s.agent.profile().tracks.len(), 2 + 3);
    // Any track can be removed; searching scores against every remaining CV.
    s.agent.remove_cv("program").unwrap();
    assert!(!s.agent.cv_path("program").exists());
    assert!(s.agent.profile().tracks.iter().all(|t| t.name != "program"));
    assert!(s.agent.remove_cv("program").is_err());
    let conv = s.agent.convert_existing_cv("data-analysis").unwrap();
    assert_eq!(conv.kind, "docx-converted");
}

#[test]
fn first_cv_fills_in_name_and_email() {
    let s = setup();
    let mut p = Profile::default();
    p.name.clear();
    s.agent.save_profile(&p).unwrap();
    s.agent.add_cv("cv.docx", &cv::sample_docx(), false).unwrap();
    let p = s.agent.profile();
    assert_eq!((p.name.as_str(), p.email.as_str()), ("Alex Morgan", "alex@example.com"));
}

#[test]
fn a_saved_api_key_keeps_the_api_engine() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::memory().unwrap();
    db.set("claude.key", "sk-old").unwrap();
    let agent = Agent::new(dir.path(), db, Box::new(|_, _| {}));
    assert_eq!(agent.engine_name(), "api", "a key saved before Claude Code became the default stays in use");
    // Choosing Claude Code explicitly wins over the saved key.
    agent.db().set("claude.engine", "code").unwrap();
    assert_eq!(agent.engine_name(), "code");
    // A new install starts empty, with Claude Code.
    let fresh = Agent::new(dir.path(), Db::memory().unwrap(), Box::new(|_, _| {}));
    let p = fresh.profile();
    assert!(p.locations.is_empty() && p.tracks.is_empty() && p.name.is_empty());
    assert_eq!(fresh.engine_name(), "code");
}

#[test]
fn a_skipped_posting_can_be_scored_anyway() {
    let s = setup();
    let mut p = s.agent.profile();
    p.locations = vec!["Ottawa".into()];
    p.remote_ok = false;
    s.agent.save_profile(&p).unwrap();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().status, "skipped");
    let job = s.agent.score_anyway("test:1").unwrap();
    assert_eq!((job.status.as_str(), job.score), ("ready", Some(85)), "scored, cleared the bar, tailored");
}

#[test]
fn progress_moves_through_the_stages() {
    let s = setup();
    assert!(s.agent.progress().is_none(), "no search, no progress");
    // Searching is most of the bar now that scoring runs alongside it.
    s.agent.step("Searching job sites", 1, 2, "x");
    assert_eq!(s.agent.progress.lock().unwrap().percent, 35);
    s.agent.step("Scoring postings", 1, 2, "x");
    assert_eq!(s.agent.progress.lock().unwrap().percent, 88);
    s.agent.step("Searching job sites", 0, 4, "y");
    assert_eq!(s.agent.progress.lock().unwrap().percent, 0);
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let o = s.agent.overview().unwrap();
    assert_eq!(o["last_report"]["scored"], 1);
    assert!(o["progress"].is_null());
}

#[test]
fn near_miss_titles_get_a_second_look() {
    let s = setup();
    let r = s.agent.search(Some(vec![
        posting("Transformation Lead, Finance Systems", "1"),
        posting("Registered Nurse", "2"),
    ])).unwrap();
    assert_eq!((r.scored, r.filtered), (1, 1), "{r}");
    assert!(s.llm.calls.lock().unwrap().contains(&"pick_titles".to_string()));
    let nurse = s.agent.db().jobs(Some("skipped"), 10).unwrap();
    assert!(nurse.iter().any(|j| j.title == "Registered Nurse" && j.reasoning.as_deref().unwrap_or("").contains(NO_TITLE_MATCH)));
}

#[test]
fn job_alert_emails_become_postings() {
    let s = setup();
    *s.llm.alerts.lock().unwrap() = vec![crate::claude::FoundJob {
        title: "Technical Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(),
        url: "https://www.linkedin.com/jobs/view/1".into(), ..Default::default()
    }];
    s.mail.messages.lock().unwrap().insert("a1".into(), Email {
        id: "a1".into(), thread_id: "t1".into(), from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>".into(),
        subject: "1 new job for Technical Program Manager".into(), body: "Technical Program Manager · Maple Bank · Toronto".into(), ..Email::default()
    });
    let stats = s.agent.process_inbox(50).unwrap();
    assert_eq!(stats.get("job_alert_postings"), Some(&1));
    let jobs = s.agent.db().jobs(None, 10).unwrap();
    let j = jobs.iter().find(|j| j.company == "Maple Bank").expect("the alert's posting was scored");
    assert_eq!(j.source, "linkedin");
    assert!(s.agent.process_inbox(50).unwrap().get("job_alert_postings").is_none(), "each alert is read once");
}

#[test]
fn decisions_teach_the_scorer_and_interviews_get_prep() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let id = s.agent.db().jobs(None, 1).unwrap()[0].id.clone();
    s.agent.after_stage(&id, "dismissed", "too junior", true);
    let g = s.agent.scoring_guidance(&s.agent.profile());
    assert!(g.contains("Not interested: Technical Program Manager at Acme (too junior)"), "{g}");
    // Stories reach the cover letter writer.
    let mut p = s.agent.profile();
    p.stories = "Shipped urgent medical supplies to Iraq.".into();
    s.agent.save_profile(&p).unwrap();
    s.agent.tailor(&id, None).unwrap();
    assert!(s.llm.stories_seen.lock().unwrap().contains("Iraq"));
    // Interview prep is written and kept.
    assert!(s.agent.make_prep(&id).unwrap().contains("The role in brief"));
    assert!(s.agent.prep(&id).is_some());
}

#[test]
fn one_source_searched_on_its_own_shows_each_posting() {
    let s = setup();
    let mut p = s.agent.profile();
    p.locations = vec!["Toronto".into()];
    p.remote_ok = false;
    s.agent.save_profile(&p).unwrap();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let searched = s.agent.secret("last.search");
    let mut far = posting("Senior Technical Program Manager", "3");
    far.location = "Vancouver, BC".into();
    let found = vec![posting("Technical Program Manager", "1"), posting("Program Manager", "2"), far];
    let r = s.agent.search_in(Some(found), false, None, Some("linkedin")).unwrap();
    assert_eq!((r.known, r.new), (1, 2));
    let res = &s.agent.source_results()["linkedin"];
    assert_eq!((res["name"].as_str(), res["running"].as_bool()), (Some("LinkedIn"), Some(false)));
    let list = res["postings"].as_array().unwrap();
    let of = |t: &str| list.iter().find(|x| x["title"] == t).unwrap_or_else(|| panic!("{t} in {list:?}"));
    assert_eq!(of("Technical Program Manager")["outcome"], "known");
    assert!(["match", "low"].contains(&of("Program Manager")["outcome"].as_str().unwrap()), "scored: {list:?}");
    assert!(of("Program Manager")["score"].is_number() && of("Program Manager")["job"].is_string());
    assert_eq!(of("Senior Technical Program Manager")["outcome"], "filtered");
    assert!(of("Senior Technical Program Manager")["detail"].as_str().unwrap().starts_with("location"), "{list:?}");
    assert_eq!(s.agent.secret("last.search"), searched, "the daily search's time stays as it was");
    // A full search keeps what it found source by source; a source searched with nothing found says so.
    let from = |src: &str, t: &str, ext: &str| { let mut p = posting(t, ext); p.source = src.into(); p };
    let found = vec![from("greenhouse", "Program Manager", "g1"), from("randstad", "Project Manager", "r1"), from("jobbank", "PMO Lead", "j1")];
    let report = Report { by_source: vec![json!({ "name": "FreeHire", "searches": 3, "found": 0, "failed": 0 }), json!({ "name": "Randstad", "searches": 1, "found": 1, "failed": 0 })],
        source_problems: vec!["Adecco “Program Manager”: timed out".into()], ..Report::default() };
    s.agent.keep_found(None, &found, &HashSet::new(), &report);
    let res = s.agent.source_results();
    assert_eq!((res["boards"]["counts"]["found"].as_u64(), res["jobbank"]["counts"]["found"].as_u64(), res["freehire"]["counts"]["found"].as_u64()), (Some(1), Some(1), Some(0)), "{res}");
    assert_eq!((res["agencies"]["via"].as_str(), res["agencies"]["name"].as_str()), (Some("search"), Some("Recruiters and job sites")));
    assert_eq!(res["agencies"]["report"]["source_problems"][0], "Adecco “Program Manager”: timed out");
    assert_eq!(res["linkedin"]["via"], "own", "the source searched on its own keeps its own results");
    // One site searched on its own replaces that site's postings, and keeps the other sites'.
    let found = vec![from("adecco", "Program Director", "a1")];
    s.agent.keep_found(Some("site:adecco"), &found, &HashSet::new(), &Report::default());
    let ag = &s.agent.source_results()["agencies"];
    let srcs: Vec<&str> = ag["postings"].as_array().unwrap().iter().map(|p| p["source"].as_str().unwrap()).collect();
    assert!(srcs.contains(&"randstad") && srcs.contains(&"adecco") && ag["via"] == "own", "{ag}");
    // Names and ids it knows; off sources and unknown ones aren't searched.
    assert_eq!(s.agent.source_name("jobbank").as_deref(), Some("Job Bank"));
    assert!(s.agent.source_name("nowhere").is_none() && s.agent.search_source("nowhere").is_err());
    let mut p = s.agent.profile();
    p.sources.linkedin = false;
    s.agent.save_profile(&p).unwrap();
    assert!(s.agent.search_source("linkedin").unwrap_err().0.contains("turned off"));
}

#[test]
fn force_search_rechecks_filtered_postings() {
    let s = setup();
    let mut p = s.agent.profile();
    p.locations = vec!["Ottawa".into()];
    p.remote_ok = false;
    s.agent.save_profile(&p).unwrap();
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    assert_eq!(r.filtered, 1, "Toronto is filtered out while looking in Ottawa");
    // Widen the search and force: the filtered posting is checked again and scored.
    p.locations = vec!["Toronto".into()];
    s.agent.save_profile(&p).unwrap();
    assert_eq!(s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap().new, 0, "a normal search skips it");
    let r = s.agent.search_with(Some(vec![posting("Technical Program Manager", "1")]), true, None).unwrap();
    assert_eq!((r.rechecked, r.new, r.scored), (1, 1, 1));
    // Scored or tailored postings are never re-checked.
    assert_eq!(s.agent.search_with(Some(vec![posting("Technical Program Manager", "1")]), true, None).unwrap().rechecked, 0);
}

#[test]
fn indeed_postings_join_the_search() {
    let s = setup();
    *s.llm.indeed.lock().unwrap() = vec![crate::claude::FoundJob {
        title: "Senior Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(),
        url: "https://to.indeed.com/x".into(), description: "Lead program delivery, UAT, vendor management.".into(),
        posted: "October 13, 2026".into(), salary: "N/A".into(),
    }];
    s.agent.db().set("claude.engine", "code").unwrap();
    let found = s.agent.indeed_postings(&s.agent.profile()).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!((found[0].source.as_str(), found[0].salary.as_deref()), ("indeed", None));
    let searches = s.llm.indeed_searches.lock().unwrap().clone();
    assert!(searches.iter().all(|(_, place)| place == "Toronto, ON" || place == "remote"), "{searches:?}");
    assert!(searches.len() <= 10);

    // Off, or using an API key: no Indeed calls.
    s.agent.db().set("claude.engine", "api").unwrap();
    assert!(s.agent.indeed_postings(&s.agent.profile()).is_err());
    let mut p = s.agent.profile();
    p.sources.indeed = false;
    s.agent.save_profile(&p).unwrap();
    assert!(s.agent.indeed_postings(&p).unwrap().is_empty());
}

#[test]
fn signature_is_stored_and_checked() {
    let s = setup();
    assert!(s.agent.signature().is_none());
    assert!(s.agent.set_signature(b"not a picture").is_err());
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend(300u32.to_be_bytes());
    png.extend(80u32.to_be_bytes());
    png.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
    s.agent.set_signature(&png).unwrap();
    assert_eq!(s.agent.signature().unwrap(), png);
    s.agent.remove_signature().unwrap();
    assert!(s.agent.signature().is_none());
}

#[test]
fn scoring_is_capped_per_search() {
    let s = setup();
    let mut p = s.agent.profile();
    p.max_scored_per_run = 1;
    s.agent.save_profile(&p).unwrap();
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    assert_eq!((r.scored, r.deferred), (1, 1));
    assert!(r.to_string().contains("1 left for the next search"));
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    assert_eq!((r.new, r.scored), (1, 1), "the deferred one is scored next time");
}

#[test]
fn closed_postings_are_noted() {
    let s = setup();
    let mut p = s.agent.profile();
    p.sources.greenhouse = vec!["acme".into(), "acme-corp".into()];
    s.agent.save_profile(&p).unwrap();
    let gone = Posting { source: "greenhouse".into(), external_id: "acme-1".into(), ..posting("Technical Program Manager", "a1") };
    let other = Posting { source: "greenhouse".into(), external_id: "acme-corp-2".into(), title: "Senior Program Manager".into(), ..posting("x", "a2") };
    let kept = Posting { source: "greenhouse".into(), external_id: "acme-3".into(), title: "Delivery Manager".into(), ..posting("x", "a3") };
    s.agent.search(Some(vec![gone, other, kept])).unwrap();
    // Acme's board was listed in full and no longer has acme-1; acme-corp's board wasn't listed.
    let ids: HashSet<String> = ["greenhouse:acme-3".to_string()].into();
    let n = s.agent.close_missing(&s.agent.profile(), &["greenhouse:acme-".into()], &ids).unwrap();
    assert_eq!(n, 1);
    let j = s.agent.db().job("greenhouse:acme-1").unwrap().unwrap();
    assert!(j.closed_at.is_some() && j.status == "ready", "a tailored one stays put, marked closed");
    assert!(s.agent.db().job("greenhouse:acme-corp-2").unwrap().unwrap().closed_at.is_none(), "acme-corp is a different board");
    assert!(s.agent.db().job("greenhouse:acme-3").unwrap().unwrap().closed_at.is_none());
    // Waiting to be tailored: skipped instead.
    s.agent.db().update_job("greenhouse:acme-3", &[("status", "queued".into())]).unwrap();
    let queued = s.agent.db().job("greenhouse:acme-3").unwrap().unwrap();
    s.agent.mark_closed(&queued, "test").unwrap();
    assert_eq!(s.agent.db().job("greenhouse:acme-3").unwrap().unwrap().status, "skipped");
}

#[test]
fn cv_and_letter_can_be_revised_and_put_back() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let before = s.agent.db().job("test:1").unwrap().unwrap();
    assert!(s.agent.revise("test:1", "cv", "").is_err(), "needs a request");
    let j = s.agent.revise("test:1", "cv", "shorter bullets").unwrap();
    assert!(s.llm.calls.lock().unwrap().contains(&"revise_cv:shorter bullets".to_string()));
    let text = cv::open(Path::new(j.cv_path.as_ref().unwrap())).unwrap().plain_text();
    assert!(text.contains("Led vendor management of contracted teams and integrators"));
    // Still one change against your own CV, now with the revised wording.
    assert_eq!(j.cv_changes.len(), 1);
    assert!(j.cv_changes[0].before.starts_with("Managed contracted") && j.cv_changes[0].after.contains("teams and integrators"));
    // What this revision changed, against the version just before it (not your own CV), for the page to highlight.
    let r = s.agent.last_revision("test:1").unwrap();
    assert_eq!((r["what"].as_str(), r["note"].as_str()), (Some("cv"), Some("shorter bullets")));
    assert!(r["changes"][0]["before"].as_str().unwrap().contains("contracted development teams") && r["changes"][0]["after"].as_str().unwrap().contains("teams and integrators"), "{r}");
    assert!(s.agent.can_undo("test:1", "cv"));
    s.agent.undo_revision("test:1", "cv").unwrap();
    let back = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(back.cv_changes, before.cv_changes);
    assert!(cv::open(Path::new(back.cv_path.as_ref().unwrap())).unwrap().plain_text().contains("Led vendor management of contracted development teams"));
    assert!(!s.agent.can_undo("test:1", "cv"));

    let j = s.agent.revise("test:1", "letter", "make it shorter").unwrap();
    assert!(j.cover_letter.unwrap().ends_with("Shorter now."));
    let r = s.agent.last_revision("test:1").unwrap();
    assert_eq!(r["what"], "letter");
    assert_eq!(r["changes"], json!([{ "before": "", "after": "P.S. Shorter now." }]), "only the paragraph that changed");
    s.agent.revision_seen("test:1").unwrap();
    assert!(s.agent.last_revision("test:1").is_none(), "seen: no more highlights");
    s.agent.undo_revision("test:1", "letter").unwrap();
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().cover_letter, before.cover_letter);
    assert_eq!(s.agent.db().history("test:1").unwrap()[0].kind, "revised");
}

#[test]
fn quiet_applications_get_a_follow_up_draft() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), Posting { company: "Beta".into(), ..posting("Delivery Manager", "3") }])).unwrap();
    let ten_days_ago = (Utc::now() - Duration::days(10)).to_rfc3339();
    for id in ["test:1", "test:2", "test:3"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
        s.agent.db().update_job(id, &[("applied_at", ten_days_ago.clone().into())]).unwrap();
    }
    s.agent.db().update_job("test:1", &[("apply_email", "jobs@acme.example".into())]).unwrap();
    // test:2 had only the automatic acknowledgement; test:3 had a real reply.
    s.agent.db().record_email("e1", "t", Some("test:2"), "Acme <no-reply@acme.example>", "Thanks", "application_received", "", None, &now()).unwrap();
    s.agent.db().record_email("e2", "t", Some("test:3"), "Sam <sam@beta.example>", "Quick question", "other_job_related", "", None, &now()).unwrap();
    let due: Vec<String> = s.agent.follow_ups_due().unwrap().into_iter().map(|j| j.id).collect();
    assert_eq!(due, vec!["test:1", "test:2"]);
    assert_eq!(s.agent.overview().unwrap()["follow_ups"].as_array().unwrap().len(), 2);
    // The email check drafts them in Gmail, once.
    s.agent.process_inbox(50).unwrap();
    let drafts = s.mail.drafts.lock().unwrap().clone();
    assert!(drafts.contains(&("to:jobs@acme.example".to_string(), "Hello, I applied on ".to_string() + &drafts[0].1["Hello, I applied on ".len()..])));
    assert!(drafts.iter().any(|(to, _)| to == "to:"), "no address for test:2: the draft has no recipient yet");
    assert!(s.agent.follow_up("test:1").unwrap()["draft"].is_string());
    assert!(s.agent.follow_ups_due().unwrap().is_empty());
    assert!(s.notes.lock().unwrap().contains(&"2 follow-ups ready".to_string()));
    // Off means off.
    let mut p = s.agent.profile();
    p.follow_up_after = 0;
    s.agent.save_profile(&p).unwrap();
    assert!(s.agent.follow_ups_due().unwrap().is_empty());
}

#[test]
fn results_count_replies_and_interviews() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), posting("Delivery Manager", "3")])).unwrap();
    for id in ["test:1", "test:2"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
    }
    s.agent.db().set_status("test:1", "interviewing", "").unwrap();
    s.agent.db().set_status("test:1", "rejected", "").unwrap();
    let r = s.agent.results().unwrap();
    assert_eq!(r["funnel"]["found"], 3);
    assert_eq!((r["funnel"]["sent"].as_u64(), r["funnel"]["replied"].as_u64(), r["funnel"]["interviews"].as_u64()), (Some(2), Some(1), Some(1)));
    assert_eq!(r["by_cv"][0]["name"], "Program delivery");
    assert_eq!(r["by_source"][0]["name"], "test");
    assert_eq!(r["by_fit"][0]["name"], "80–89");
}

#[test]
fn sources_can_be_tested() {
    let s = setup();
    let mut p = s.agent.profile();
    p.sources.greenhouse.clear();
    p.sources.lever.clear();
    p.sources.ashby.clear();
    s.agent.save_profile(&p).unwrap();
    s.agent.db().set("claude.engine", "code").unwrap();
    *s.llm.indeed.lock().unwrap() = vec![crate::claude::FoundJob { title: "Senior Program Manager".into(), company: "Maple Bank".into(), location: "Toronto, ON".into(), ..Default::default() }];
    let v = s.agent.test_sources().unwrap();
    let r = v["results"].as_array().unwrap();
    let by = |n: &str| r.iter().find(|x| x["name"].as_str().unwrap().starts_with(n)).unwrap().clone();
    assert_eq!(by("Adzuna")["skipped"], true);
    assert_eq!((by("Indeed")["ok"].as_bool(), by("Indeed")["found"].as_u64(), by("Indeed")["matching"].as_u64()), (Some(true), Some(1), Some(1)));
    assert_eq!((by("Job-alert")["found"].as_u64(), by("Job-alert")["ok"].as_bool()), (Some(0), Some(true)), "no alerts this week isn't broken");
    assert!(by("Job-alert")["hint"].as_str().unwrap().contains("job alerts"));
    assert!(v["finished"].is_string());
    assert_eq!(serde_json::from_str::<Value>(&s.agent.secret("sources.test")).unwrap(), v);
}

#[test]
fn deadlines_answers_offers_and_contacts() {
    let s = setup();
    let soon = (Utc::now() + Duration::days(1)).date_naive();
    s.agent.search(Some(vec![
        Posting { description: format!("Lead program delivery, UAT. Apply by {}.", soon.format("%B %-d, %Y")), ..posting("Technical Program Manager", "1") },
        Posting { description: "Lead program delivery, UAT, vendor management; apply by Halloween.".into(), ..posting("Senior Program Manager", "2") },
    ])).unwrap();
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().deadline, Some(soon.to_string()), "read from the text");
    assert!(s.agent.db().job("test:2").unwrap().unwrap().deadline.is_none(), "Claude's date is too far off to trust");
    assert_eq!(s.agent.closing_soon(7).unwrap().len(), 1);
    assert_eq!(s.agent.overview().unwrap()["closing_soon"].as_array().unwrap().len(), 1);
    s.agent.remind_deadlines();
    s.agent.remind_deadlines();
    assert_eq!(s.notes.lock().unwrap().iter().filter(|n| n.starts_with("Closes")).count(), 1, "told once");

    // Application questions, with the facts you gave for forms.
    let mut p = s.agent.profile();
    p.application_facts = "Canadian citizen; two weeks' notice".into();
    s.agent.save_profile(&p).unwrap();
    let a = s.agent.answer_questions("test:1", "Why us?\nNotice period?").unwrap();
    assert_eq!(a.as_array().unwrap().len(), 2);
    assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("answers:Canadian citizen")));
    assert_eq!(s.agent.answers("test:1").unwrap(), a);

    // An offer, weighed against your minimum.
    assert!(s.agent.offer_advice("test:1", "").is_err());
    let o = s.agent.offer_advice("test:1", "Base 135,000, 10% bonus, start Nov 3").unwrap();
    assert!(o["advice"].as_str().unwrap().contains("Base 135,000"));

    // Contacts and a message to one.
    s.agent.save_contacts("test:1", &[json!({ "name": "Sam Lee", "role": "Hiring manager" }), json!({ "name": " " })]).unwrap();
    assert_eq!(s.agent.contacts("test:1").len(), 1, "blank rows dropped");
    let m = s.agent.write_outreach("test:1", 0).unwrap();
    assert!(m.contains("Technical Program Manager"));
    assert!(m.contains("Employer: a private employer") && m.contains("Message: the first one") && m.contains("two weeks' notice"), "the playbook's brief: {m}");
    assert_eq!(s.agent.contacts("test:1")[0]["message"], json!(m));
    // Sent: no second message for a week; then the one follow-up; then no more.
    s.agent.contact_sent("test:1", 0).unwrap();
    assert!(s.agent.write_outreach("test:1", 0).unwrap_err().0.contains("Give them a week"));
    let mut list = s.agent.contacts("test:1");
    list[0]["sent_at"] = json!((Utc::now() - chrono::Duration::days(8)).to_rfc3339());
    s.agent.save_contacts("test:1", &list).unwrap();
    assert!(s.agent.write_outreach("test:1", 0).unwrap().contains("Message: the one follow-up"));
    s.agent.contact_sent("test:1", 0).unwrap();
    assert!(s.agent.contacts("test:1")[0]["followed_at"].as_str().is_some_and(|t| !t.is_empty()));
    assert!(s.agent.write_outreach("test:1", 0).unwrap_err().0.contains("enough"));
    // Who you've messaged at the company, for its other jobs.
    assert_eq!(s.agent.messaged_at("Acme").len(), 1);
    let job = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(s.agent.playbook(&job)["kind"], "private");
}

#[test]
fn salary_read_by_claude_and_found_later() {
    let s = setup();
    assert_eq!(salary_parts("$95K–$110K a year"), Some(("$95,000–$110,000".to_string(), Some(110000.0))));
    assert_eq!(salary_parts("Up to $120,000 annually").map(|x| x.1), Some(Some(120000.0)));
    assert!(salary_parts("  ").is_none());
    let mut p = s.agent.profile();
    p.min_salary = Some(100000.0);
    s.agent.save_profile(&p).unwrap();
    // Pay in the description below your minimum: set aside before scoring, without Claude (it
    // used to be scored, and set aside only once Claude had read the pay).
    let mut low = posting("Technical Program Manager", "1");
    low.description.push_str("\nSalary note: $80K~$90K a year");
    let mut fine = posting("Senior Program Manager", "2");
    fine.description.push_str("\nSalary note: $110K~$130K a year");
    s.agent.search(Some(vec![low, fine])).unwrap();
    let j1 = s.agent.db().job("test:1").unwrap().unwrap();
    assert_eq!(j1.status, "skipped", "below your minimum: set aside before scoring");
    assert_eq!(j1.score, None, "not scored: no Claude usage on it");
    assert_ne!(s.agent.db().job("test:2").unwrap().unwrap().status, "skipped", "above your minimum: kept");
    // Found later (the company's own posting, the Apply window) for a job you approved: flagged, and you're told.
    let mut third = posting("Delivery Manager", "3");
    third.description = "Lead delivery.".into();
    s.agent.search(Some(vec![third])).unwrap();
    s.agent.db().set_status("test:3", "approved", "").unwrap();
    assert!(s.agent.found_salary("test:3", "Salary range: $70,000 - $85,000 per year", "on the company's page").unwrap());
    let j3 = s.agent.db().job("test:3").unwrap().unwrap();
    assert_eq!(j3.salary.as_deref(), Some("$70,000–$85,000"));
    assert!(j3.red_flags.iter().any(|f| f.starts_with("Pays up to $85,000")));
    assert!(!s.agent.found_salary("test:3", "$60,000 - $65,000", "again").unwrap(), "known already: kept as it was");
}

#[test]
fn rescan_finds_missing_salaries() {
    let s = setup();
    let mut a = posting("Technical Program Manager", "1");
    a.description.push_str("\nThe base pay for this role is $98,000 - $112,000 per year.");
    let mut b = posting("Senior Program Manager", "2");
    b.description.push_str("\nSalary note: $80K~$90K a year");
    let c = posting("Delivery Manager", "3");
    s.agent.search(Some(vec![a, b, c])).unwrap();
    // As found before this version: no salary kept, and set aside so their pages aren't fetched here.
    for id in ["test:1", "test:2", "test:3"] {
        s.agent.db().update_job(id, &[("salary", serde_json::Value::Null), ("status", "skipped".into())]).unwrap();
    }
    s.agent.db().set("claude.engine", "api").unwrap();
    s.agent.db().set("claude.key", "sk-test").unwrap();
    let (checked, found, _) = s.agent.rescan_salaries().unwrap();
    assert_eq!((checked, found), (3, 2));
    assert_eq!(s.agent.db().job("test:1").unwrap().unwrap().salary.as_deref(), Some("$98,000–$112,000"), "from the text");
    assert_eq!(s.agent.db().job("test:2").unwrap().unwrap().salary.as_deref(), Some("$80,000–$90,000"), "read by Claude");
    assert!(s.agent.db().job("test:3").unwrap().unwrap().salary.is_none(), "states no pay: none made up");
    assert_eq!(s.llm.calls.lock().unwrap().iter().filter(|c| c.starts_with("salaries:")).count(), 1, "one request, only for the posting with pay lines");
}

#[test]
fn paragraphs_that_changed() {
    let old = "Dear Ms. Lee,\n\nI led a $40M program.\n\nI'd welcome a chat.\n\nSincerely,\nSam";
    let new = "Dear Ms. Lee,\n\nI led a $40M program across three banks.\n\nI'd welcome a chat.\n\nThank you for your time.\n\nSincerely,\nSam";
    assert_eq!(paragraph_changes(old, new), vec![
        ("I led a $40M program.".to_string(), "I led a $40M program across three banks.".to_string()),
        (String::new(), "Thank you for your time.".to_string()),
    ]);
    assert!(paragraph_changes(old, old).is_empty());
}

#[test]
fn companies_you_applied_to_before() {
    let s = setup();
    assert_eq!(email_letter("Nov 6, 2026\nATTN: Acme Hiring Team\nAcme\n\n**Subject: Application for PM**\n\nDear Hiring Team,\n\nHello.\n\nAll the best,\nSam"),
        "Dear Hiring Team,\n\nHello.\n\nAll the best,\nSam", "the email starts at the greeting");
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    // Both were tailored by the search (auto-tailor); you applied to the first.
    s.agent.db().update_job("test:1", &[("status", "applied".into()), ("applied_at", now().into())]).unwrap();
    let two = s.agent.db().job("test:2").unwrap().unwrap();
    assert_eq!(s.agent.company_history("Acme", "test:2").len(), 1);
    assert_eq!(s.agent.sent_before(&two).unwrap().id, "test:1");
    // Tailored again: the CV they have goes with it, and stays close.
    s.llm.calls.lock().unwrap().clear();
    s.agent.tailor("test:2", None).unwrap();
    assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("tailor-consistent:Sent to Acme")), "{:?}", s.llm.calls.lock().unwrap());
    assert!(s.agent.db().history("test:2").unwrap().iter().any(|e| e.detail.contains("kept close to the CV you sent Acme")));
    let two = s.agent.db().job("test:2").unwrap().unwrap();
    let cmp = s.agent.compare_with_sent(&two).unwrap();
    assert_eq!(cmp["job"]["id"], "test:1");
    assert_eq!(cmp["changes"].as_array().unwrap().len(), 0, "the same edits as before: nothing differs");
    // The same CV as before: their file, exactly.
    s.agent.db().set("tailor.repeat", "same").unwrap();
    s.agent.tailor("test:2", None).unwrap();
    let a = s.agent.db().job("test:1").unwrap().unwrap();
    let b = s.agent.db().job("test:2").unwrap().unwrap();
    assert_eq!(std::fs::read(a.cv_path.unwrap()).unwrap(), std::fs::read(b.cv_path.clone().unwrap()).unwrap());
    assert!(s.agent.reuse_sent_cv("test:2").is_ok() && s.agent.can_undo("test:2", "cv"));
    // Your notes, kept by company.
    s.agent.save_company_notes("ACME Inc.", "Wait six months.").unwrap();
    assert_eq!(s.agent.company_notes("Acme"), "Wait six months.");
    assert!(s.agent.company_history("Elsewhere", "").is_empty());
}

#[test]
fn postings_are_scored_several_to_a_request() {
    let s = setup();
    *s.llm.batch.lock().unwrap() = 4;
    *s.llm.left_out.lock().unwrap() = vec!["Senior Program Manager".into()];
    let profile = s.agent.profile();
    let cvs = s.agent.cv_texts(&profile);
    let guidance = s.agent.scoring_guidance(&profile);
    let ctx = SearchCtx { profile: &profile, cvs: &cvs, guidance: &guidance, force: false, keep_found: true };
    let mut run = SearchRun { cap: 5, ..SearchRun::default() };
    let mut report = Report::default();
    let list: Vec<Posting> = ["Technical Program Manager", "Senior Program Manager", "Program Manager, Payments", "Program Manager, Cloud", "Program Manager, Data", "Program Manager, Risk"]
        .iter().enumerate().map(|(i, t)| posting(t, &(i + 1).to_string())).collect();
    s.agent.take_in(list, &mut run, &mut report, &ctx).unwrap();
    // Five of the six fit this search: four in one request, the fifth by itself; the one the
    // answer left out is scored by itself too; the sixth waits.
    assert_eq!((report.scored, report.deferred), (5, 1));
    let calls = s.llm.calls.lock().unwrap().clone();
    assert_eq!(calls.iter().filter(|c| c.starts_with("score_many")).cloned().collect::<Vec<_>>(), vec!["score_many:4".to_string()]);
    // score_many's own three, the one it left out, and the fifth.
    assert_eq!(calls.iter().filter(|c| *c == "score").count(), 5);
    assert_eq!(s.agent.db().jobs(Some("queued"), 50).unwrap().len(), 5);
}

#[test]
fn batches_arriving_during_a_search_share_it() {
    let s = setup();
    let profile = s.agent.profile();
    let cvs = s.agent.cv_texts(&profile);
    let guidance = s.agent.scoring_guidance(&profile);
    let ctx = SearchCtx { profile: &profile, cvs: &cvs, guidance: &guidance, force: false, keep_found: true };
    let mut run = SearchRun { cap: 1, ..SearchRun::default() };
    let mut report = Report::default();
    // The first source's postings are scored as soon as they're in.
    s.agent.take_in(vec![posting("Technical Program Manager", "1")], &mut run, &mut report, &ctx).unwrap();
    assert_eq!(report.scored, 1);
    // The next source sends the same role again, and a new one: the copy is dropped, and the new one
    // waits for the next search (this one's cap is reached).
    s.agent.take_in(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")], &mut run, &mut report, &ctx).unwrap();
    assert_eq!((report.found, report.new, report.scored, report.deferred), (3, 2, 1, 1));
    assert_eq!(s.agent.held_count(), 1);
    assert_eq!(run.found_here.len(), 3);
}

#[test]
fn recruiter_playbook_nudges() {
    let s = setup();
    let mut gov = posting("Senior Program Manager", "3");
    gov.company = "Canada Revenue Agency".into();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), gov])).unwrap();
    let id = |company: &str, title: &str| s.agent.db().jobs(None, 10).unwrap().into_iter().find(|j| j.company == company && j.title == title).unwrap().id;
    let (new, old, gc) = (id("Acme", "Technical Program Manager"), id("Acme", "Senior Program Manager"), id("Canada Revenue Agency", "Senior Program Manager"));
    let at = |days: i64| (Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    for (id, days) in [(&new, 1), (&old, 12), (&gc, 1)] {
        s.agent.db().update_job(id, &[("status", "applied".into()), ("applied_at", at(days).into())]).unwrap();
    }
    // Just applied to a private employer: message the recruiter. Not the Government of Canada one.
    let due: Vec<String> = s.agent.reach_out_due().unwrap().into_iter().map(|j| j.id).collect();
    assert_eq!(due, vec![new.clone()], "only the private one applied to in the last 3 days");
    let fu: Vec<String> = s.agent.follow_ups_due().unwrap().into_iter().map(|j| j.id).collect();
    assert_eq!(fu, vec![old.clone()], "the older private one gets an application follow-up");
    // Someone at Acme messaged a week ago: no nudge for Acme's other job, the recruiter's follow-up instead of the application's.
    s.agent.save_contacts(&old, &[json!({ "name": "Sam Lee", "role": "Recruiter", "sent_at": at(8) })]).unwrap();
    assert!(s.agent.reach_out_due().unwrap().is_empty(), "someone at Acme has been messaged");
    assert!(s.agent.follow_ups_due().unwrap().is_empty(), "the recruiter is followed up instead: one channel, not two");
    let f = s.agent.contact_follow_ups_due().unwrap();
    assert_eq!((f.len(), f[0]["name"].as_str()), (1, Some("Sam Lee")));
    // And the Government of Canada one never gets an automatic follow-up.
    s.agent.db().update_job(&gc, &[("applied_at", at(12).into())]).unwrap();
    assert!(s.agent.follow_ups_due().unwrap().is_empty(), "no chasing a GC Jobs process");
}

#[test]
fn health_weekly_summary_and_insights() {
    let s = setup();
    s.agent.db().set("claude.engine", "api").unwrap();
    assert!(s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("No Claude API key")));
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2"), posting("Delivery Manager", "3")])).unwrap();
    s.agent.db().log(None, "inbox:error", "Gmail said 401").unwrap();
    assert!(s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Email check had a problem")));
    // Reconnecting Google (or a check that works) clears it.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    s.agent.db().set("google.at", &now()).unwrap();
    assert!(!s.agent.health().iter().any(|h| h["text"].as_str().unwrap().contains("Email check had a problem")));
    assert!(s.agent.write_insights().is_err(), "too few applications");
    for id in ["test:1", "test:2", "test:3"] {
        s.agent.db().set_status(id, "applied", "").unwrap();
    }
    assert!(s.agent.write_insights().unwrap()["text"].as_str().unwrap().contains("What's working"));
    assert!(s.agent.results().unwrap()["insights"].is_object());
    let words = s.agent.week_in_words().unwrap();
    assert!(words[0].starts_with("You "), "{words:?}");
    let w = s.agent.weekly_summary().unwrap();
    assert!(w.contains("your goal is 10"), "{w}");
    assert!(s.notes.lock().unwrap().contains(&"Your week in Job Hunt".to_string()));
    assert_eq!(s.mail.sent.lock().unwrap().last().map(|x| x.0.clone()), Some("jane@example.com".to_string()), "the review, emailed to you");
    assert!(!due_tasks(&s.agent).contains(&"weekly"), "once a week");
}

#[test]
fn boards_are_added_and_removed_in_one_click() {
    let s = setup();
    s.agent.db().set("last.report", &json!({ "broken_boards": [{ "source": "lever", "name": "koho" }], "source_problems": ["Lever board koho: not found (board name wrong or removed?)"] }).to_string()).unwrap();
    assert!(s.agent.health().iter().any(|h| h["action"] == "removeBroken"));
    assert_eq!(s.agent.remove_boards(&[json!({ "source": "lever", "name": "KOHO" })]).unwrap(), 1);
    assert!(!s.agent.profile().sources.lever.contains(&"koho".to_string()));
    assert!(!s.agent.health().iter().any(|h| h["action"] == "removeBroken"), "no longer flagged");
    let n = s.agent.add_boards(&[json!({ "board": "workday", "slug": "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1" }), json!({ "board": "ashby", "slug": "ramp" })]).unwrap();
    assert_eq!(n, 1, "ramp was there already");
    assert_eq!(s.agent.profile().sources.workday.len(), 1);
    // The search report says what was seen before and why the rest were filtered.
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let r = s.agent.search(Some(vec![posting("Technical Program Manager", "1"), Posting { location: "Vancouver, BC".into(), ..posting("Senior Program Manager", "2") }])).unwrap();
    assert_eq!((r.known, r.why_filtered.get("outside your locations").copied()), (1, Some(1)));
}

#[test]
fn a_settings_page_left_open_doesnt_bring_removed_boards_back() {
    let s = setup();
    let page = s.agent.profile(); // the settings page loads, with koho on Lever
    assert!(page.sources.lever.contains(&"koho".to_string()));
    s.agent.remove_boards(&[json!({ "source": "lever", "name": "koho" })]).unwrap();
    s.agent.add_boards(&[json!({ "board": "greenhouse", "slug": "found-by-itself" })]).unwrap();
    // The page saves an unrelated change, with its old board lists, plus one board typed in.
    let mut edited = page.clone();
    edited.weekly_goal = 3;
    edited.sources.ashby.push("typed".into());
    let saved = s.agent.save_settings(edited, Some(page.sources.clone())).unwrap();
    let src = &s.agent.profile().sources;
    assert_eq!(&saved.sources, src);
    assert!(!src.lever.contains(&"koho".to_string()), "removed stays removed");
    assert!(src.greenhouse.contains(&"found-by-itself".to_string()), "found elsewhere stays");
    assert!(src.ashby.contains(&"typed".to_string()) && s.agent.profile().weekly_goal == 3);
    // Deleting one on the page is remembered, so finding employers won't add it back.
    let mut page = s.agent.profile();
    let seen = page.sources.clone();
    page.sources.ashby.retain(|x| x != "typed");
    s.agent.save_settings(page, Some(seen)).unwrap();
    assert!(s.agent.removed_boards().contains("ashby:typed") && s.agent.removed_boards().contains("lever:koho"));
    s.agent.add_boards(&[json!({ "board": "lever", "slug": "koho" })]).unwrap();
    assert!(!s.agent.removed_boards().contains("lever:koho"), "added back by you: wanted again");
}

#[test]
fn searches_can_be_stopped_paused_and_turned_off() {
    let s = setup();
    s.agent.db().set("claude.engine", "api").unwrap();
    s.agent.db().set("claude.key", "sk-test").unwrap();
    let mut p = s.agent.profile();
    p.search_hour = 0;
    s.agent.save_profile(&p).unwrap();
    assert!(due_tasks(&s.agent).contains(&"search"));
    s.agent.pause_searches(Some(7)).unwrap();
    assert!(!s.agent.search_paused().is_empty() && !due_tasks(&s.agent).contains(&"search"), "paused for a week");
    assert!(s.agent.side_status()["next_search"].is_null());
    s.agent.pause_searches(None).unwrap();
    assert_eq!(s.agent.search_paused(), "off");
    assert!(!due_tasks(&s.agent).contains(&"search"), "off");
    // One you ask for still runs.
    s.agent.db().set("request.search", &now()).unwrap();
    assert!(due_tasks(&s.agent).contains(&"search"));
    s.agent.db().set("request.search", "").unwrap();
    s.agent.pause_searches(Some(0)).unwrap();
    assert!(s.agent.search_paused().is_empty() && due_tasks(&s.agent).contains(&"search"), "back on");
    // A pause that ran out is over.
    s.agent.db().set("search.paused", &(Utc::now() - Duration::hours(1)).to_rfc3339()).unwrap();
    assert!(s.agent.search_paused().is_empty());
    // Stop: only while one runs.
    assert!(!s.agent.stop_search() && !s.agent.stopping());
    let _g = s.agent.claim("search").unwrap();
    assert!(s.agent.stop_search() && s.agent.stopping());
}

#[test]
fn dead_boards_go_and_new_places_bring_a_look_for_employers() {
    let s = setup();
    let koho = vec![("lever".to_string(), "koho".to_string())];
    assert!(s.agent.drop_dead_boards(&koho).is_empty(), "one miss could be a blip");
    assert!(s.agent.drop_dead_boards(&[]).is_empty(), "it worked again: forgiven");
    assert!(s.agent.drop_dead_boards(&koho).is_empty());
    assert_eq!(s.agent.drop_dead_boards(&koho).len(), 1, "two in a row: dropped");
    assert!(!s.agent.profile().sources.lever.iter().any(|b| b == "koho"));
    // Changing your locations asks for a look for employers there.
    s.agent.db().set("claude.engine", "api").unwrap();
    s.agent.db().set("claude.key", "sk-test").unwrap();
    s.agent.db().set("last.discover", &now()).unwrap();
    assert!(!due_tasks(&s.agent).contains(&"discover"), "looked just now");
    s.agent.db().set("last.discover", &(Utc::now() - Duration::hours(1)).to_rfc3339()).unwrap();
    s.agent.db().set("discover.due", "1").unwrap();
    assert!(due_tasks(&s.agent).contains(&"discover"));
    let mut p = s.agent.profile();
    p.sources.auto_boards = false;
    s.agent.save_profile(&p).unwrap();
    assert!(!due_tasks(&s.agent).contains(&"discover"), "off means off");
}

#[test]
fn postings_sent_from_the_browser() {
    let s = setup();
    // A page that describes the job in the standard way: used as is.
    let j = s.agent.add_clip(&json!({ "url": "https://boards.greenhouse.io/acme/jobs/1", "title": "Technical Program Manager", "company": "Acme",
        "location": "Toronto, ON", "text": "Lead program delivery, UAT and vendor management across finance systems.", "structured": true })).unwrap();
    // Scored and put on the Overview to pick: not tailored until you choose.
    assert_eq!((j.source.as_str(), j.status.as_str()), ("browser", "queued"));
    assert!(j.score.is_some() && j.cv_path.is_none());
    assert!(!s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("read_posting")));
    // A LinkedIn page without that: Claude reads it.
    let j = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "title": "LinkedIn", "text": "Jobs you may like ... Senior Program Manager at Maple Bank ... Lead program delivery across finance systems." })).unwrap();
    assert_eq!((j.source.as_str(), j.company.as_str(), j.title.as_str()), ("linkedin", "Maple Bank", "Senior Program Manager"));
    // Twice is refused; a page with no posting is explained.
    let again = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "text": "Senior Program Manager at Maple Bank. Lead program delivery across finance systems." }));
    assert!(again.unwrap_err().0.contains("already in Job Hunt"));
    assert!(s.agent.add_clip(&json!({ "url": "https://example.com", "text": "A recipe for banana bread with walnuts and a little cinnamon." })).unwrap_err().0.contains("doesn't look like a job posting"));
    assert!(crate::api::parse_clip("JOBHUNT-CLIP:{\"url\":\"x\"}").is_some() && crate::api::parse_clip("hello").is_none());
    // Sent from LinkedIn with its hiring team: they're kept with the job; a link that isn't a
    // profile, and a second copy of the same person, are left out.
    let team = json!([{ "name": "Dana  Recruiter", "role": "Talent Acquisition Partner at Maple Bank", "link": "https://www.linkedin.com/in/dana-r/" },
        { "name": "Not A Profile", "role": "", "link": "https://example.com/in/x" }, { "name": "Dana Recruiter", "role": "", "link": "https://www.linkedin.com/in/dana-r" }]);
    let e = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "text": "Senior Program Manager at Maple Bank. Lead program delivery across finance systems, UAT and vendor management.", "people": team })).unwrap_err();
    assert!(e.0.contains("is already in Job Hunt.") && e.0.contains("hiring team from LinkedIn is now on the job") && e.0.contains("Dana Recruiter"), "{}", e.0);
    let people = s.agent.contacts(&j.id);
    assert_eq!(people.len(), 1);
    assert_eq!((people[0]["name"].as_str(), people[0]["link"].as_str()), (Some("Dana Recruiter"), Some("https://www.linkedin.com/in/dana-r")));
    assert!(people[0]["note"].as_str().unwrap().contains("hiring team"));
    // You sent Dana the note, and she wrote back on LinkedIn: no follow-up asked for, and it counts.
    s.agent.contact_sent(&j.id, 0).unwrap();
    s.agent.contact_replied(&j.id, 0).unwrap();
    assert_eq!(s.agent.outreach_stats().unwrap()["recruiter"], json!({ "sent": 1, "replied": 1 }));
    s.agent.contact_replied(&j.id, 0).unwrap();
    assert_eq!(s.agent.outreach_stats().unwrap()["recruiter"], json!({ "sent": 1, "replied": 0 }), "pressed again: not a reply after all");
    // Sent again: nobody new, so only that it's already here.
    let e = s.agent.add_clip(&json!({ "url": "https://www.linkedin.com/jobs/view/123", "text": "Senior Program Manager at Maple Bank. Lead program delivery across finance systems, UAT and vendor management.", "people": team })).unwrap_err();
    assert!(!e.0.contains("hiring team"), "{}", e.0);
}

#[test]
fn removing_a_cv_clears_the_fits_it_gave() {
    let s = setup();
    let mut p = s.agent.profile();
    p.auto_tailor = false;
    s.agent.save_profile(&p).unwrap();
    s.agent.search(Some(vec![posting("Program Manager", "1"), Posting { company: "Globex".into(), ..posting("Program Manager", "2") }])).unwrap();
    let ids: Vec<String> = s.agent.db().jobs(None, 100).unwrap().into_iter().filter(|j| j.score.is_some()).map(|j| j.id).collect();
    assert_eq!(ids.len(), 2);
    // One tailored (waiting for approval), one waiting to be picked: both lose the old fit.
    s.agent.tailor(&ids[0], None).unwrap();
    let track = s.agent.db().job(&ids[1]).unwrap().unwrap().track.unwrap();
    // Another CV to score against once this one is gone.
    s.agent.add_cv("other.txt", "Alex Morgan\nProgram manager\n".repeat(20).as_bytes(), false).unwrap();
    let change = s.agent.remove_cv(&track).unwrap();
    let cleared = change.unscored.clone();
    // The tailored one waiting for approval is tailored again from the CV left.
    assert_eq!(change.retailor, vec![ids[0].clone()]);
    assert!(cleared.contains(&ids[1]) && !cleared.contains(&ids[0]), "{cleared:?} {:?}", s.agent.db().jobs(None, 10).unwrap().iter().map(|j| (j.status.clone(), j.track.clone(), j.score)).collect::<Vec<_>>());
    let j = s.agent.db().job(&ids[1]).unwrap().unwrap();
    assert!(j.score.is_none() && j.reasoning.unwrap().contains("was removed"));
    // Against the CVs left: scored again, and the tailored one tailored again.
    let j = s.agent.tailor_anyway(&ids[0], None).unwrap();
    assert!(j.score.is_some() && j.track.as_deref() != Some(track.as_str()) && j.status == "ready");
    let n = s.agent.rescore_jobs(&cleared).unwrap();
    assert_eq!(n, 1);
    let j = s.agent.db().job(&ids[1]).unwrap().unwrap();
    assert!(j.score.is_some() && j.track.as_deref() != Some(track.as_str()));
}

#[test]
fn a_new_cv_is_used_for_applications_waiting_for_approval() {
    let s = setup();
    s.agent.search(Some(vec![posting("Program Manager", "1"), Posting { company: "Globex".into(), ..posting("Program Manager", "2") }, Posting { company: "Initech".into(), ..posting("Program Manager", "3") }])).unwrap();
    let ready: Vec<Job> = s.agent.db().jobs(Some("ready"), 10).unwrap();
    assert_eq!(ready.len(), 3);
    let track = ready[0].track.clone().unwrap();
    // One with your own cover letter words, one sent: both stay as they are.
    s.agent.save_cover_letter(&ready[1].id, "Dear team,\n\nMy own words.\n\nJane").unwrap();
    s.agent.db().set_status(&ready[2].id, "applied", "sent").unwrap();
    let bytes = std::fs::read(s.agent.cv_path(&track)).unwrap();
    let (_, change) = s.agent.replace_cv(&track, "new.docx", &bytes, false).unwrap();
    assert_eq!((change.retailor.clone(), change.kept), (vec![ready[0].id.clone()], 1));
    assert!(s.agent.db().history(&ready[1].id).unwrap().iter().any(|e| e.kind == "cv-changed"), "told why it was kept");
    // Tailored again: scored against the new CV first, then a fresh CV and cover letter.
    assert!(s.agent.db().job(&ready[0].id).unwrap().unwrap().score.is_none());
    let j = s.agent.tailor_anyway(&ready[0].id, None).unwrap();
    assert_eq!(j.status, "ready");
    assert!(j.score.is_some() && j.cover_letter.is_some());
    let h = s.agent.db().history(&ready[0].id).unwrap();
    assert!(h.iter().position(|e| e.kind == "tailored") < h.iter().position(|e| e.kind == "cv-changed"), "tailored after the change");
    assert_eq!(s.agent.db().job(&ready[1].id).unwrap().unwrap().cover_letter.as_deref(), Some("Dear team,\n\nMy own words.\n\nJane"));
}

#[test]
fn removing_your_only_cv_redoes_its_work_with_the_next() {
    let s = setup();
    s.agent.search(Some(vec![posting("Program Manager", "1")])).unwrap();
    let j = s.agent.db().jobs(Some("ready"), 10).unwrap().remove(0);
    // Every CV with a file goes, the tailored application's work with it.
    for t in s.agent.profile().tracks {
        let c = s.agent.remove_cv(&t.name).unwrap();
        s.agent.apply_cv_change(c);
    }
    assert!(s.agent.secret("cv.waiting").contains(&j.id), "waiting for a CV");
    // What it had can be put back once it's tailored again.
    assert!(s.agent.can_undo(&j.id, "letter") && s.agent.can_undo(&j.id, "cv"));
    // A new CV: the waiting work starts, with it.
    s.agent.add_cv("new.txt", "Alex Morgan\nProgram manager\n".repeat(20).as_bytes(), false).unwrap();
    let c = s.agent.after_cv_added();
    assert_eq!(c.retailor, vec![j.id.clone()]);
    assert!(s.agent.secret("cv.waiting").is_empty());
}

#[test]
fn a_search_pauses_and_resumes_where_it_was() {
    let s = setup();
    assert!(!s.agent.hold_search(true), "no search running");
    let a = s.agent.clone();
    let found: Vec<Posting> = (1..=4).map(|i| Posting { company: format!("Co {i}"), ..posting("Program Manager", &i.to_string()) }).collect();
    let _g = s.agent.claim("search").unwrap(); // a search "running", so it can be paused before it starts work
    assert!(s.agent.hold_search(true));
    drop(_g);
    let t = std::thread::spawn(move || a.search(Some(found)).unwrap());
    // It waits at its first step, having scored nothing.
    let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !s.agent.progress().is_some_and(|p| p.paused) && std::time::Instant::now() < until {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(s.agent.search_held() && s.agent.progress().unwrap().paused);
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert_eq!(s.agent.db().jobs(None, 100).unwrap().len(), 0, "nothing scored while paused");
    // Resumed: it carries on and finishes the same work.
    assert!(s.agent.hold_search(false));
    let r = t.join().unwrap();
    assert_eq!(r.scored, 4);
    assert!(!s.agent.search_held());
}

#[test]
fn postings_over_the_cap_are_scored_next_time() {
    let s = setup();
    let mut p = s.agent.profile();
    p.max_scored_per_run = 2;
    s.agent.save_profile(&p).unwrap();
    let found: Vec<Posting> = (1..=5).map(|i| posting("Program Manager", &i.to_string())).map(|p| Posting { company: format!("Co {}", p.external_id), ..p }).collect();
    let r = s.agent.search(Some(found)).unwrap();
    assert_eq!((r.scored, r.deferred), (2, 3));
    // The next search finds nothing new, yet the three left over are scored, two at a time.
    let r = s.agent.search(Some(vec![])).unwrap();
    assert_eq!((r.held, r.scored, r.deferred), (3, 2, 1));
    let r = s.agent.search(Some(vec![])).unwrap();
    assert_eq!((r.held, r.scored, r.deferred), (1, 1, 0));
    assert_eq!(s.agent.search(Some(vec![])).unwrap().held, 0);
    // Through the day: small batches of what's held, without counting as a search.
    let mut p = s.agent.profile();
    p.max_scored_per_run = 20; // batches of 10 (half, at least 10)
    s.agent.save_profile(&p).unwrap();
    let found: Vec<Posting> = (10..=24).map(|i| Posting { company: format!("Co {i}"), ..posting("Program Manager", &i.to_string()) }).collect();
    s.agent.hold(found);
    assert_eq!(s.agent.held_count(), 15);
    let last = s.agent.secret("last.search");
    // Claude "connected" whatever this machine has installed (an API key counts).
    s.agent.db().set("claude.engine", "api").unwrap();
    s.agent.db().set("claude.key", "sk-test").unwrap();
    assert!(due_tasks(&s.agent).contains(&"held"));
    let r = s.agent.score_held().unwrap();
    assert_eq!((r.scored, s.agent.held_count()), (10, 5));
    assert_eq!(s.agent.secret("last.search"), last, "not a search");
    assert!(!due_tasks(&s.agent).contains(&"held"), "not again for 45 minutes");
    // Score them all now: the rest, in one go.
    assert_eq!(s.agent.score_all_held().unwrap(), 5);
    assert_eq!(s.agent.held_count(), 0);
}

#[test]
fn postings_added_without_claude() {
    let s = setup();
    let before = s.llm.calls.lock().unwrap().len();
    // You said no Claude: saved as it is, no description needed, nothing asked of Claude.
    let id = s.agent.add_manual("Maple Bank", "Senior Business Analyst", "https://jobs.maple.example/9", "Oakville, ON", "", false).unwrap();
    let j = s.agent.db().job(&id).unwrap().unwrap();
    assert_eq!((j.status.as_str(), j.score), ("saved", None));
    assert!(j.reasoning.unwrap().contains("without Claude"));
    assert_eq!(s.llm.calls.lock().unwrap().len(), before, "no Claude usage");
    assert_eq!(s.agent.added_notice(&id).0, "Saved to Job Hunt");
    // From the browser without Claude: the page as sent, its first line as the title, the company named from the site.
    let j = s.agent.add_clip(&json!({ "url": "https://careers.globex.example/7", "claude": false,
        "text": "Delivery Lead\nGlobex is hiring a delivery lead to run release planning across its payments teams." })).unwrap();
    assert_eq!((j.title.as_str(), j.company.as_str(), j.status.as_str()), ("Delivery Lead", "Globex", "saved"));
    assert!(!s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("read_posting")));
    // Scoring it later is one click; one below your bar stays saved, not skipped.
    s.llm.scores.lock().unwrap().insert("Senior Business Analyst".into(), 30);
    assert_eq!(s.agent.score_anyway(&id).unwrap().status, "saved");
}

#[test]
fn phone_links_and_spreadsheet() {
    assert_eq!(phone_url("", "jh-abc", "2 applications ready"), "https://ntfy.sh/jh-abc?title=2+applications+ready&tags=briefcase");
    // Nothing personal by default: not the company, nor the role.
    let (t, b) = private_notice("Interview tomorrow at 10:00 AM: Maple Bank");
    assert!(t.contains("interview update") && !t.contains("Maple") && !b.contains("Maple"));
    assert!(phone_url("https://ntfy.mynas.ts.net/", "t", "x").starts_with("https://ntfy.mynas.ts.net/t?"));
    let s = setup();
    s.agent.search(Some(vec![Posting { company: "Acme, \"Inc\"".into(), ..posting("Technical Program Manager", "1") }])).unwrap();
    let csv = s.agent.export_csv().unwrap();
    assert!(csv.starts_with('\u{feff}'));
    let row = csv.lines().nth(1).unwrap();
    assert!(row.starts_with("\"Acme, \"\"Inc\"\"\",\"Technical Program Manager\",\"Ready to approve\",\"85\""), "{row}");
}

#[test]
fn finds_the_recruiter_on_linkedin_and_writes_the_note() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    s.agent.save_contacts("test:1", &[json!({ "name": "Recruiter", "role": "Recruiter" })]).unwrap();
    assert_eq!(s.agent.find_recruiter("test:1").unwrap(), 1);
    let c = s.agent.contacts("test:1");
    assert_eq!(c.len(), 1, "the unnamed placeholder gives way to the person found");
    assert_eq!(c[0]["name"], "Priya Shah");
    assert!(c[0]["link"].as_str().unwrap().contains("linkedin.com/in/"));
    assert!(c[0]["message"].as_str().unwrap().starts_with("Hi"), "the note is written to her");
    // Again: she isn't added twice.
    s.agent.find_recruiter("test:1").unwrap();
    assert_eq!(s.agent.contacts("test:1").len(), 1);
}

#[test]
fn overview_and_running_guard() {
    let s = setup();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1")])).unwrap();
    let o = s.agent.overview().unwrap();
    assert_eq!(o["counts"]["ready"], 1);
    assert_eq!(o["ready"][0]["title"], "Technical Program Manager");
    assert!(o["ready"][0].get("description").is_none());
    assert_eq!(o["weeks"].as_array().unwrap().len(), 8);
    assert_eq!(o["setup"]["cvs_missing"], json!(["Data engineering"]));
    assert_eq!(o["setup"]["engine"], "code");
    let g = s.agent.claim("search").unwrap();
    assert!(s.agent.search(Some(vec![])).unwrap_err().0.contains("already running"));
    drop(g);
    assert!(s.agent.search(Some(vec![])).is_ok());
}

#[test]
fn a_company_you_never_want_to_see() {
    let s = setup();
    let mut p = s.agent.profile();
    p.auto_tailor = false;
    s.agent.save_profile(&p).unwrap();
    s.agent.search(Some(vec![posting("Technical Program Manager", "1"), posting("Senior Program Manager", "2")])).unwrap();
    let picks = s.agent.db().jobs(Some("queued"), 10).unwrap();
    assert_eq!(picks.len(), 2);
    s.agent.db().set_status(&picks[0].id, "dismissed", "no").unwrap();
    // Its other posting goes too, and the company joins the ones to skip (once).
    assert_eq!(s.agent.block_company(&picks[0].id).unwrap(), 1);
    assert_eq!(s.agent.block_company(&picks[0].id).unwrap(), 0);
    assert!(s.agent.db().jobs(Some("queued"), 10).unwrap().is_empty());
    assert_eq!(s.agent.profile().exclude_companies, vec!["Acme".to_string()]);
    // And the next search leaves its postings out.
    let r = s.agent.search(Some(vec![posting("Program Director", "3")])).unwrap();
    assert_eq!(r.to_pick, 0);
}
