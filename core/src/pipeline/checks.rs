//! Checking your sources: each one tried, and what it found.

use super::*;

impl Agent {
    // --- checking your sources ------------------------------------------------------------------

    /// Try every source once and say what each one finds, or why it finds nothing. Saved as it
    /// goes, so the screen can show results while the rest run.
    pub fn test_sources(&self) -> R<Value> {
        self.test_sources_only(None)
    }

    /// What the sidebar shows under the menu: when the next search is, sync and backup, and how
    /// many connections need attention.
    pub fn side_status(&self) -> Value {
        let p = self.profile();
        let tz = p.tz();
        let local = Utc::now().with_timezone(&tz);
        let last = chrono::DateTime::parse_from_rfc3339(&self.secret("last.search")).ok().map(|t| t.with_timezone(&tz).naive_local());
        // The next search by itself (one a day, or two): None when it's due now and runs within a minute.
        let next = p.next_search(local.naive_local(), last).and_then(|t| t.and_local_timezone(tz).earliest()).map(|t| t.to_rfc3339());
        let problems = self.connections().map(|c| c.iter().filter(|r| r["status"] == "problem").count()).unwrap_or(0);
        let paused = self.search_paused();
        json!({
            "next_search": if paused.is_empty() { next } else { None },
            "paused": paused,
            "sync_on": crate::sync::enabled(self),
            "last_sync": Some(self.secret("last.sync")).filter(|x| !x.is_empty()),
            "sync_error": Some(self.secret("sync.error")).filter(|x| !x.is_empty() && crate::sync::enabled(self)),
            "syncing": self.is_running("sync"),
            "sync_where": if crate::sync::on_drive(self) { "drive" } else { "folder" },
            "last_backup": Some(self.secret("last.backup")).filter(|x| !x.is_empty()),
            "conn_problems": problems,
            "claude_limited_until": self.limited().map(|t| t.to_rfc3339()),
            "deferred": self.deferred().len(),
        })
    }

    /// Every connection and how it's doing, for Settings → Accounts: {id, name, group, status
    /// ("ok", "problem", "off" or "setup"), detail, at (when last checked), actions}. Status comes
    /// from the connection itself, the last source test, or the last search, whichever is newest.
    /// How each recruiter or job site you turned on is doing: from its last test or the last
    /// search, whichever is newer. state: "ok" (postings found), "quiet" (read, but no postings:
    /// the site may list them in a way Job Hunt can't read), "problem" (an error), "unknown".
    pub fn site_status(&self) -> Vec<Value> {
        let p = self.profile();
        let tests: Vec<Value> = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default();
        let report: Value = serde_json::from_str(&self.secret("last.report")).unwrap_or(Value::Null);
        let searched = self.secret("last.search");
        let problems: Vec<String> = report["source_problems"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        crate::sites::targets(&p.sources.sites, &p.sources.custom_sites).into_iter().map(|t| {
            let test = tests.iter().find(|r| r["site"] == t.id.as_str()).map(|r| {
                let found = r["found"].as_u64().unwrap_or(0);
                let (state, detail) = match r["error"].as_str().filter(|e| !e.is_empty()) {
                    Some(e) => ("problem", e.to_string()),
                    None if found == 0 => ("quiet", "Read the page, but found no postings on it.".to_string()),
                    None => ("ok", format!("{found} postings found{}", r["matching"].as_u64().map(|m| format!(", {m} match your CVs")).unwrap_or_default())),
                };
                (state, detail, r["at"].as_str().unwrap_or("").to_string())
            });
            let search = report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"] == t.name.as_str())).map(|b| {
                let (n, found, failed) = (b["searches"].as_u64().unwrap_or(0), b["found"].as_u64().unwrap_or(0), b["failed"].as_u64().unwrap_or(0));
                let err = problems.iter().find(|x| x.starts_with(&format!("{} ", t.name))).and_then(|x| x.split_once(": ")).map(|x| x.1.to_string());
                if failed >= n.max(1) {
                    ("problem", err.unwrap_or_else(|| "The last search couldn't read it.".into()), searched.clone())
                } else if found == 0 {
                    ("quiet", "Read the page in the last search, but found no postings on it.".into(), searched.clone())
                } else {
                    ("ok", format!("{found} postings in the last search"), searched.clone())
                }
            });
            let (state, detail, at) = match (test, search) {
                (Some(a), Some(b)) => if b.2 > a.2 { b } else { a },
                (Some(a), None) | (None, Some(a)) => a,
                (None, None) => ("unknown", "Not searched yet.".to_string(), String::new()),
            };
            json!({ "id": t.id, "name": t.name, "state": state, "detail": detail, "at": at, "template": t.search })
        }).collect()
    }

    pub fn connections(&self) -> R<Vec<Value>> {
        let p = self.profile();
        let tested: Vec<Value> = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default();
        let report: Value = serde_json::from_str(&self.secret("last.report")).unwrap_or(Value::Null);
        let searched = self.secret("last.search");
        let problems: Vec<String> = report["source_problems"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let keys = self.search_keys();
        // Whichever is newer: the last test of a source, or what the last search said about it.
        let tested_at = serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
            .and_then(|v| v["finished"].as_str().or(v["started"].as_str()).map(String::from)).unwrap_or_default();
        let seen = |id: &str, search_prefix: &str| -> (Option<bool>, String, String) {
            let rows: Vec<&Value> = tested.iter().filter(|r| r["id"] == id || source_row_id(r) == id).collect();
            // Failed means an error came back. Nothing found isn't a failure (older tests saved it as one).
            let failed = |r: &Value| r["ok"] == false && r["skipped"] != true && r["error"].as_str().is_some_and(|e| !e.trim().is_empty());
            let test = rows.iter().find(|r| failed(r)).or(rows.first()).filter(|r| r["skipped"] != true).map(|r| {
                let detail = if !failed(r) {
                    let found = r["found"].as_u64().unwrap_or(0);
                    let hint = r["hint"].as_str().filter(|_| found == 0).map(|h| format!(". {h}")).unwrap_or_default();
                    format!("{found} {}{}{hint}", r["unit"].as_str().unwrap_or("found"), r["matching"].as_u64().map(|m| format!(", {m} match your CVs")).unwrap_or_default())
                } else {
                    format!("{} {}", r["error"].as_str().unwrap_or(""), r["hint"].as_str().unwrap_or("")).trim().to_string()
                };
                (Some(!failed(r)), detail, r["at"].as_str().map(String::from).unwrap_or_else(|| tested_at.clone()))
            });
            // A problem only when every search of that kind failed: one of several failing isn't.
            let tally = report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"].as_str().is_some_and(|n| n.starts_with(search_prefix))));
            let all_failed = tally.is_none_or(|b| b["failed"].as_u64().unwrap_or(0) >= b["searches"].as_u64().unwrap_or(0).max(1));
            let search = if let Some(pr) = problems.iter().find(|x| x.starts_with(search_prefix)).filter(|_| all_failed) {
                Some((Some(false), pr.clone(), searched.clone()))
            } else {
                report["by_source"].as_array().and_then(|a| a.iter().find(|b| b["name"].as_str().is_some_and(|n| n.starts_with(search_prefix))))
                    .map(|b| (Some(true), format!("{} postings in the last search", b["found"].as_u64().unwrap_or(0)), searched.clone()))
            };
            let latest = match (test, search) {
                (Some(t), Some(s)) => if s.2 > t.2 { s } else { t },
                (Some(t), None) => t,
                (None, Some(s)) => s,
                (None, None) => (None, String::new(), String::new()),
            };
            // Claude's usage limit isn't a fault of the source: it's tried again after the reset.
            if latest.0 == Some(false) && crate::claude_code::is_limit(&latest.1) {
                return (None, "Waiting: your Claude usage limit was reached during the last try. It's tried again after it resets.".into(), latest.2);
            }
            latest
        };
        let row = |id: &str, name: &str, group: &str, status: &str, detail: String, at: String, actions: Value| json!({ "id": id, "name": name, "group": group, "status": status, "detail": detail, "at": at, "actions": actions });
        let mut out = vec![];
        // Claude
        let ready = self.claude_ready();
        out.push(row("claude", "Claude", "Essentials", if ready { "ok" } else { "problem" },
            if ready { format!("Ready, through {}", if self.engine_name() == "api" { "your API key" } else { "Claude Code on this PC" }) } else { "Not ready: nothing can be scored or tailored.".into() },
            String::new(), json!(["checkClaude", "goto:claudeCard"])));
        // Google
        let mail = self.mail.read().unwrap().is_some();
        let client = !self.google_client().is_empty();
        out.push(row("google", "Gmail and Google Calendar", "Essentials", if mail { "ok" } else if client { "problem" } else { "setup" },
            if mail { "Connected: job email is read, replies drafted, interviews booked.".into() } else if client { "Disconnected. Connect again to keep reading job email.".into() } else { "Not connected (optional).".into() },
            self.secret("last.inbox"), json!(if client { json!(["google"]) } else { json!(["goto:googleCard"]) })));
        // Job-search services
        let not_here = |id: &str, name: &str| row(id, name, "Job listings", "na", format!("Doesn't search in {}.", p.country()), String::new(), json!([]));
        for (id, name, has, prefix) in [("jsearch", "Google for Jobs", keys.jsearch.is_some(), "Google for Jobs"), ("jooble", "Jooble", keys.jooble.is_some(), "Jooble"), ("adzuna", "Adzuna", keys.adzuna.is_some(), "Adzuna")] {
            if !p.sources.available(id) {
                out.push(not_here(id, name));
                continue;
            }
            if !has {
                out.push(row(id, name, "Job listings", "setup", "No key (optional).".into(), String::new(), json!(["goto:listingsCard"])));
                continue;
            }
            let (ok, detail, at) = seen(id, prefix);
            out.push(row(id, name, "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { "Key saved; not tested yet.".into() } else { detail }, at, json!(["test", "goto:listingsCard"])));
        }
        // Indeed, through the connector on your Claude account
        if !p.sources.indeed {
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on"])));
        } else if self.engine_name() != "code" {
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", "problem", "Needs Claude Code on this PC; it doesn't work with an API key.".into(), String::new(), json!(["off", "goto:claudeCard"])));
        } else {
            let (ok, detail, at) = seen("indeed", "Indeed");
            let fixing = ok == Some(false);
            out.push(row("indeed", "Indeed (through your Claude account)", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if fixing { detail.clone() } else if detail.is_empty() { "On; not tested yet.".into() } else { detail },
                at, json!(if fixing { json!(["test", "link:https://claude.ai/settings/connectors", "off"]) } else { json!(["test", "off"]) })));
        }
        // LinkedIn: its signed-out search, or a scraper on Apify
        if !p.sources.linkedin {
            out.push(row("linkedin", "LinkedIn", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on", "goto:listingsCard"])));
        } else {
            let (ok, detail, at) = seen("linkedin", "LinkedIn");
            let how = if keys.apify.is_some() { "Through Apify." } else { "LinkedIn's public job search, without signing in." };
            out.push(row("linkedin", "LinkedIn", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { format!("{how} Not tested yet.") } else { format!("{how} {detail}") }, at, json!(["test", "off", "goto:listingsCard"])));
        }
        // FreeHire: free, no key
        if p.sources.is_off("freehire") {
            out.push(row("freehire", "FreeHire", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on"])));
        } else {
            let (ok, detail, at) = seen("freehire", "FreeHire");
            out.push(row("freehire", "FreeHire", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { "Free job search, mostly linking to employers' own sites. Not tested yet.".into() } else { detail }, at, json!(["test", "off"])));
        }
        // Canada's Job Bank: its own search page
        if !p.sources.available("jobbank") {
            out.push(not_here("jobbank", "Job Bank (Canada)"));
        } else if !p.sources.jobbank {
            out.push(row("jobbank", "Job Bank (Canada)", "Job listings", "off", "Turned off.".into(), String::new(), json!(["on"])));
        } else {
            let (ok, detail, at) = seen("jobbank", "Job Bank");
            out.push(row("jobbank", "Job Bank (Canada)", "Job listings", match ok { Some(true) => "ok", Some(false) => "problem", None => "unknown" },
                if detail.is_empty() { "jobbank.gc.ca's search, a few searches a day. Not tested yet.".into() } else { detail }, at, json!(["test", "off"])));
        }
        // Recruiters' and job sites' own listings
        let sites = self.site_status();
        if sites.is_empty() {
            out.push(row("agencies", "Recruiters and job sites", "Job listings", "setup", "None turned on. Choose them in Settings \u{2192} Job search.".into(), String::new(), json!(["goto:sitesCard"])));
        } else {
            let of = |st: &str| sites.iter().filter(|x| x["state"] == st).map(|x| x["name"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>();
            let (ok, quiet, bad) = (of("ok"), of("quiet"), of("problem"));
            // A problem when none of them works; "partial" when some can't be read while others work,
            // so a row never says Working over sites that fail.
            let status = if !ok.is_empty() && !bad.is_empty() { "partial" } else if !ok.is_empty() { "ok" } else if !bad.is_empty() && quiet.is_empty() { "problem" } else { "unknown" };
            let bad_ids: Vec<Value> = sites.iter().filter(|x| x["state"] == "problem").map(|x| x["id"].clone()).collect();
            let mut parts = vec![format!("{} on", sites.len())];
            if !ok.is_empty() { parts.push(format!("{} found postings", ok.len())) }
            if !quiet.is_empty() { parts.push(format!("no postings from {}", quiet.join(", "))) }
            if !bad.is_empty() { parts.push(format!("couldn't read {}", bad.join(", "))) }
            let at = sites.iter().filter_map(|x| x["at"].as_str()).max().unwrap_or("").to_string();
            let actions = if bad_ids.is_empty() { json!(["test", "goto:sitesCard"]) } else { json!(["test", "sitesOff", "goto:sitesCard"]) };
            out.push(row("agencies", "Recruiters and job sites", "Job listings", status, format!("{}. Details in Settings \u{2192} Job search.", parts.join("; ")), at, actions)
                .as_object().cloned().map(|mut o| { o.insert("data".into(), json!(bad_ids)); Value::Object(o) }).unwrap());
        }
        // Company job boards
        let boards = crate::sources::boards(&p).len();
        let broken: Vec<Value> = report["broken_boards"].as_array().cloned().unwrap_or_default();
        let (bok, bdetail, bat) = seen("boards", "Company job boards");
        out.push(row("boards", "Company job boards", "Job listings",
            if boards == 0 { "setup" } else if !broken.is_empty() || bok == Some(false) { "problem" } else if bok.is_some() { "ok" } else { "unknown" },
            if boards == 0 { "None yet. Find employers near you in What to search for.".into() } else if !broken.is_empty() { format!("{boards} boards; {} no longer exist{}.", broken.len(), if broken.len() == 1 { "s" } else { "" }) } else if bdetail.is_empty() { format!("{boards} boards; not tested yet.") } else { format!("{boards} boards. {bdetail}") },
            bat, json!(if boards == 0 { json!(["goto:sources"]) } else if broken.is_empty() { json!(["test", "goto:sources"]) } else { json!(["test", "removeBroken", "goto:sources"]) })).as_object().cloned().map(|mut o| { o.insert("data".into(), json!(broken)); Value::Object(o) }).unwrap());
        // Job-alert emails
        let (aok, adetail, aat) = seen("alerts", "Job-alert");
        // A test from before you (re)connected Google says nothing about it now.
        let (aok, adetail) = if !aat.is_empty() && aat < self.secret("google.at") { (None, String::new()) } else { (aok, adetail) };
        out.push(row("alerts", "Job-alert emails", "Job listings", if !mail { "setup" } else { match aok { Some(true) => "ok", Some(false) => "problem", None => "unknown" } },
            if !mail { "Needs Gmail connected.".into() } else if adetail.is_empty() { "Read on every email check.".into() } else { adetail }, aat, json!(if mail { json!(["test"]) } else { json!(["goto:googleCard"]) })));
        // Phone, sync, backups
        let phone = !self.secret("phone.topic").is_empty();
        out.push(row("phone", "Phone notifications (ntfy)", "Other", if phone { "ok" } else { "setup" }, if phone { "On.".into() } else { "Off (optional).".into() }, String::new(), json!(if phone { json!(["phoneTest", "goto:calendar"]) } else { json!(["goto:calendar"]) })));
        let sync = crate::sync::enabled(self);
        let synced = self.secret("last.sync");
        let stale = |k: &str, days: i64| chrono::DateTime::parse_from_rfc3339(&self.secret(k)).map(|t| (Utc::now() - t.with_timezone(&Utc)).num_days() >= days).unwrap_or(true);
        out.push(row("sync", "Sync between computers", "Other", if !sync { "setup" } else if stale("last.sync", 2) { "problem" } else { "ok" },
            if !sync { "Off (optional).".into() } else if stale("last.sync", 2) { "Hasn't saved in two days. Check the Google Drive folder.".into() } else { "Up to date.".into() }, synced, json!(if sync { json!(["syncNow", "goto:sync"]) } else { json!(["goto:sync"]) })));
        let never = self.secret("last.backup").is_empty();
        out.push(row("backup", "Backups", "Other", if never { "unknown" } else if stale("last.backup", 3) { "problem" } else { "ok" },
            if self.secret("last.backup").is_empty() { "No backup yet.".into() } else if stale("last.backup", 3) { "No backup in three days.".into() } else { "Daily backups are running.".into() }, self.secret("last.backup"), json!(["backupNow", "goto:sync"])));
        // Sources you can switch off one by one: off ones say so and offer to come back on; the
        // rest offer to go off. Their keys and boards stay saved either way.
        for r in out.iter_mut().filter(|r| SWITCHABLE.contains(&r["id"].as_str().unwrap_or("")) && r["status"] != "setup" && r["status"] != "na") {
            let id = r["id"].as_str().unwrap_or("").to_string();
            let mut acts: Vec<Value> = r["actions"].as_array().cloned().unwrap_or_default();
            acts.retain(|a| a != "on" && a != "off");
            if p.sources.is_off(&id) {
                acts.retain(|a| a != "test" && a.as_str().is_none_or(|s| !s.starts_with("link:")));
                acts.insert(0, json!("on"));
                r["status"] = json!("off");
                r["detail"] = json!("Turned off: not searched. Its settings stay saved for when you turn it back on.");
            } else {
                acts.push(json!("off"));
            }
            r["actions"] = json!(acts);
        }
        Ok(out)
    }

    /// test_sources for one connection ("boards", "adzuna", "jsearch", "jooble", "indeed" or
    /// "alerts"), or all of them. The other rows of the last test stay as they were.
    pub fn test_sources_only(&self, only: Option<&str>) -> R<Value> {
        let _g = self.claim("test-sources")?;
        let p = self.profile();
        // A connection you turned off isn't tested.
        let want = |k: &str| only.is_none_or(|o| o == k) && !p.sources.is_off(k);
        let started = now();
        // Testing one: keep the other rows from the last test.
        let kept: Vec<Value> = match only {
            Some(o) => serde_json::from_str::<Value>(&self.secret("sources.test")).ok()
                .and_then(|v| v["results"].as_array().cloned()).unwrap_or_default()
                .into_iter().filter(|r| source_row_id(r) != o).collect(),
            None => vec![],
        };
        let mut results: Vec<Value> = vec![];
        // How many checks this test makes, for its progress bar.
        let singles = ["adzuna", "jsearch", "jooble", "indeed", "linkedin", "jobbank", "freehire", "alerts"].iter().filter(|k| want(k)).count();
        let total = singles
            + if want("boards") { crate::sources::boards(&p).len() } else { 0 }
            + if want("agencies") { crate::sites::targets(&p.sources.sites, &p.sources.custom_sites).len() } else { 0 };
        let save = |results: &Vec<Value>, done: bool| {
            let all: Vec<Value> = kept.iter().chain(results.iter()).cloned().map(|mut r| {
                r["id"] = json!(source_row_id(&r));
                if r.get("at").is_none() {
                    r["at"] = json!(now());
                }
                r
            }).collect();
            let v = json!({ "started": started, "finished": if done { Some(now()) } else { None }, "results": all,
                "only": only, "done": results.len(), "total": total.max(results.len()) });
            let _ = self.db().set("sources.test", &v.to_string());
            v
        };
        save(&results, false);
        let matching = |list: &[Posting]| list.iter().filter(|x| prefilter(x, &p).is_none()).count();
        let timed = |name: String, kind: &str, run: &dyn Fn() -> Result<Vec<Posting>, String>, hint: &str| {
            let t = std::time::Instant::now();
            let mut v = match run() {
                Ok(list) => json!({ "name": name, "kind": kind, "ok": true, "found": list.len(), "matching": matching(&list),
                    "hint": if list.is_empty() { "Nothing open there right now." } else if matching(&list) == 0 { "Nothing matches your CVs' job titles or keywords right now." } else { "" } }),
                Err(e) => json!({ "name": name, "kind": kind, "ok": false, "error": e, "hint": hint }),
            };
            v["seconds"] = json!(t.elapsed().as_secs());
            v
        };
        let c = crate::sources::http();
        for (src, name) in crate::sources::boards(&p).into_iter().filter(|_| want("boards")) {
            let hint = match src {
                "workday" => "Use the careers site's link as it appears in your browser, like https://company.wd3.myworkdayjobs.com/Careers.",
                "smartrecruiters" => "Use the name after jobs.smartrecruiters.com/ in the company's careers link (capitals matter).",
                "workable" => "Use the name after apply.workable.com/ in the company's careers link.",
                "bamboohr" => "Use the name before .bamboohr.com in the company's careers link.",
                _ => "Check the name: it's the part at the end of the company's careers link. Or remove it.",
            };
            let mut row = timed(crate::sources::board_label(src, &name), "board", &|| crate::sources::fetch_board(&c, &p, src, &name).map(|r| r.0), hint);
            row["source"] = json!(src);
            row["board"] = json!(name);
            results.push(row);
            save(&results, false);
        }
        let first_title = p.tracks.iter().flat_map(|t| t.titles.iter()).find(|t| !t.trim().is_empty()).cloned();
        let place = p.search_places().into_iter().next().unwrap_or_default();
        let (id, key) = (self.secret("adzuna.id"), self.secret("adzuna.key"));
        if want("adzuna") { results.push(match (&first_title, id.is_empty() || key.is_empty()) {
            (_, true) => json!({ "name": "Adzuna", "kind": "search", "ok": false, "skipped": true, "error": "No Adzuna key.", "hint": "Add an Adzuna key in Settings \u{2192} Job search to search thousands of listings for your titles." }),
            (None, _) => json!({ "name": "Adzuna", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." }),
            (Some(t), false) => timed(format!("Adzuna \u{201c}{t}\u{201d}{}", if place.is_empty() { String::new() } else { format!(" in {place}") }), "search",
                &|| crate::sources::adzuna(&c, &id, &key, &p.sources.adzuna_country, t, &place, p.sources.adzuna_days), "Check the Adzuna app ID and key in Settings \u{2192} Job search."),
        }); }
        save(&results, false);
        let keys = self.search_keys();
        let first = crate::sources::searches(&p, 1).into_iter().next();
        let country = p.sources.adzuna_country.clone();
        if want("jsearch") { results.push(match (&keys.jsearch, &first) {
            (None, _) => json!({ "name": "Google for Jobs", "kind": "search", "ok": false, "skipped": true, "error": "No JSearch key.", "hint": "Postings from LinkedIn, Indeed, Glassdoor and company sites, through Google for Jobs. Add a key in Settings \u{2192} Job search." }),
            (_, None) => json!({ "name": "Google for Jobs", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." }),
            (Some((provider, key)), Some((t, place))) => {
                let q = if place.is_empty() { t.clone() } else { format!("{t} in {place}") };
                timed(format!("Google for Jobs \u{201c}{q}\u{201d}"), "search", &|| crate::sources::jsearch(&c, provider, key, &q, &country), "Check the key and where it's from (OpenWeb Ninja or RapidAPI) in Settings \u{2192} Job search.")
            }
        }); }
        save(&results, false);
        if want("jooble") { results.push(match (&keys.jooble, &first) {
            (None, _) => json!({ "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No Jooble key.", "hint": "Listings gathered from many job sites. Add a key in Settings \u{2192} Job search." }),
            (_, None) => json!({ "name": "Jooble", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "" }),
            (Some(key), Some((t, place))) => timed(format!("Jooble \u{201c}{t}\u{201d}{}", if place.is_empty() { String::new() } else { format!(" in {place}") }), "search",
                &|| crate::sources::jooble(&c, key, t, place), "Check the Jooble key in Settings \u{2192} Job search."),
        }); }
        save(&results, false);
        if want("indeed") { results.push(if !p.sources.indeed {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Tick \u{201c}Search Indeed\u{201d} below to include it." })
        } else if self.engine_name() != "code" {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "error": "Needs Claude Code on this PC.", "hint": "Choose Claude Code in Settings \u{2192} Accounts, or turn Indeed off below." })
        } else if let Some(t) = &first_title {
            let at = if place.is_empty() { p.country() } else { place.clone() };
            timed(format!("Indeed \u{201c}{t}\u{201d} in {at}"), "search",
                &|| self.llm().indeed(&[(t.clone(), at.clone())], &p.sources.adzuna_country.to_uppercase(), 2).map(|l| l.into_iter().map(indeed_posting).collect()).map_err(|e| e.0),
                "")
        } else {
            json!({ "name": "Indeed", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." })
        }); }
        save(&results, false);
        if want("linkedin") { results.push(if !p.sources.linkedin {
            json!({ "name": "LinkedIn", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Turn LinkedIn on in Settings \u{2192} Job search to include it." })
        } else if let Some((t, w, r)) = crate::sources::linkedin_searches(&p, 1).into_iter().next() {
            match &keys.apify {
                Some((token, actor)) => timed(format!("LinkedIn (through Apify) \u{201c}{t}\u{201d} in {w}"), "search",
                    &|| crate::sources::apify_linkedin(&c, token, actor, &[(t.clone(), w.clone(), r)], 10),
                    "Check the Apify token and the scraper's name in Settings \u{2192} Job search, and that your Apify account has credit."),
                None => timed(format!("LinkedIn \u{201c}{t}\u{201d} in {w}"), "search", &|| crate::sources::linkedin(&c, &t, &w, r),
                    "LinkedIn may be turning away searches from this connection for now; it usually passes in a day. For steadier results, add an Apify token in Settings \u{2192} Job search."),
            }
        } else {
            json!({ "name": "LinkedIn", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." })
        }); }
        save(&results, false);
        if want("freehire") { results.push(if p.sources.is_off("freehire") {
            json!({ "name": "FreeHire", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Turn FreeHire on in Settings \u{2192} Job search to include it." })
        } else if let Some((t, _)) = crate::sources::searches(&p, 1).into_iter().next() {
            timed(format!("FreeHire \u{201c}{t}\u{201d}"), "search", &|| crate::sources::freehire(&c, &t, &p.sources.adzuna_country),
                "FreeHire didn't answer; it's a free service, so try again later.")
        } else {
            json!({ "name": "FreeHire", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." })
        }); }
        save(&results, false);
        if want("jobbank") || (only == Some("jobbank")) { results.push(if !p.sources.jobbank {
            json!({ "name": "Job Bank", "kind": "search", "ok": false, "skipped": true, "error": "Turned off.", "hint": "Turn Job Bank on in Settings \u{2192} Job search to include it." })
        } else if let Some((t, w)) = crate::sources::searches(&p, 1).into_iter().next() {
            timed(format!("Job Bank \u{201c}{t}\u{201d}{}", if w.is_empty() { String::new() } else { format!(" in {w}") }), "search", &|| crate::sources::jobbank(&c, &t, &w),
                "Job Bank may be limiting searches from this connection for now; it usually passes in a day.")
        } else {
            json!({ "name": "Job Bank", "kind": "search", "ok": false, "skipped": true, "error": "No job titles to search for.", "hint": "Add job titles to your CVs in CV & Career." })
        }); }
        save(&results, false);
        if want("agencies") {
            let tp = crate::sources::searches(&p, 1);
            for t in crate::sites::targets(&p.sources.sites, &p.sources.custom_sites) {
                let (title, w) = crate::sites::searches_for(&t, &tp).into_iter().next().unwrap_or_default();
                let label = if title.is_empty() { format!("{} (all jobs)", t.name) } else { format!("{} \u{201c}{title}\u{201d}", t.name) };
                let mut row = timed(label, "site", &|| crate::sites::search(&c, &t, &title, &w),
                    "Its search address may have changed, or it may block automated reading. Turn it off in Settings \u{2192} Job search if it keeps failing.");
                row["site"] = json!(t.id);
                if row["ok"] == true && row["found"] == 0 {
                    row["hint"] = json!("Read the page, but found no postings on it: the site may list them in a way Job Hunt can't read.");
                }
                results.push(row);
                save(&results, false);
            }
        }
        // The search services are tried with one search each, to spare your plans' requests.
        let titles = crate::sources::searches(&p, 1000);
        let n_titles = titles.iter().map(|t| t.0.to_lowercase()).collect::<HashSet<_>>().len();
        let n_places = p.search_places().len().max(1);
        if n_titles > 1 || n_places > 1 {
            let all = format!("A test with one search. Real searches also cover your other job titles{} ({n_titles} titles in all; Google for Jobs takes the first 6 searches, Jooble 8).", if n_places > 1 { " and places".to_string() } else { String::new() });
            for r in results.iter_mut().filter(|r| r["kind"] == "search" && r["ok"] == true) {
                let hint = r["hint"].as_str().unwrap_or("").to_string();
                r["hint"] = json!(if hint.is_empty() { all.clone() } else { format!("{hint} {all}") });
            }
        }
        save(&results, false);
        let mail = self.mail.read().unwrap().clone();
        if want("alerts") { results.push(match mail {
            None => json!({ "name": "Job-alert emails", "kind": "email", "ok": false, "skipped": true, "error": "Gmail isn't connected.", "hint": "Connect Google in Settings \u{2192} Accounts to read LinkedIn, Indeed and Glassdoor job alerts." }),
            Some(m) => match m.recent(ALERTS_QUERY, 50) {
                Ok(ids) => json!({ "name": "Job-alert emails (LinkedIn, Indeed, Glassdoor, Job Bank)", "kind": "email",
                    // Gmail answered: it works, whether or not any alerts came this week.
                    "ok": true, "found": ids.len(), "unit": "emails this week",
                    "hint": if ids.is_empty() { "None this week. On LinkedIn, Indeed, Glassdoor, Job Bank (jobbank.gc.ca) and recruiters like Randstad, Adecco and Hays, set up job alerts for your titles sent to this Gmail address; Job Hunt reads them on every email check." } else { "" } }),
                Err(e) => json!({ "name": "Job-alert emails", "kind": "email", "ok": false, "error": e.0, "hint": "Reconnect Google in Settings \u{2192} Accounts." }),
            },
        }); }
        Ok(save(&results, true))
    }
}
