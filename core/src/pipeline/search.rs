//! A search: what the sources send, filtering, scoring, and adding a posting yourself.

use super::*;

impl Agent {
    // --- search -----------------------------------------------------------------------------

    /// Postings from Indeed for your CVs' job titles, through the Indeed connector (Claude Code only).
    pub(super) fn indeed_postings(&self, profile: &Profile) -> R<Vec<Posting>> {
        if !profile.sources.indeed {
            return Ok(vec![]);
        }
        let mut titles: Vec<String> = vec![];
        for t in profile.tracks.iter().flat_map(|t| t.titles.iter()) {
            if !t.trim().is_empty() && !titles.iter().any(|x| x.eq_ignore_ascii_case(t.trim())) {
                titles.push(t.trim().to_string());
            }
        }
        if titles.is_empty() {
            return Ok(vec![]);
        }
        if self.engine_name() != "code" {
            return err("searching Indeed needs Claude Code on this PC. Choose it in Settings → Accounts, or turn Indeed off in Settings → Job search.");
        }
        // Your titles across all your places (each title in every place before the next).
        let mut searches = crate::sources::searches(profile, 8);
        if profile.remote_ok {
            searches.extend(titles.iter().take(2).map(|t| (t.clone(), "remote".to_string())));
        }
        let details = profile.max_scored_per_run.clamp(5, 25);
        let found = self.llm().indeed(&searches, &profile.sources.adzuna_country.to_uppercase(), details)?;
        Ok(found.into_iter().map(indeed_posting).collect())
    }

    /// Search every source (or score the given postings), score what's new and tailor the best.
    pub fn search(&self, postings: Option<Vec<Posting>>) -> R<Report> {
        self.search_with(postings, false, None)
    }

    /// A search that also re-checks postings filtered out earlier, against your current CVs and settings.
    pub fn force_search(&self) -> R<Report> {
        self.search_with(None, true, None)
    }

    /// Postings a search found but couldn't score yet (see hold), waiting for the next one.
    pub fn held_count(&self) -> usize {
        serde_json::from_str::<Vec<Value>>(&self.secret("search.held")).map(|l| l.len()).unwrap_or(0)
    }

    /// Score a small batch of the postings the last search couldn't get to: a quarter of your
    /// per-search limit (5 to 15), so a big search is scored through the day, a little at a time,
    /// rather than all at once against your Claude plan's limit, or not until tomorrow's search.
    /// It doesn't count as a search: your last search and its report stay as they are.
    pub fn score_held(&self) -> R<Report> {
        let batch = (self.profile().max_scored_per_run / 2).clamp(10, 30);
        self.search_with(Some(vec![]), false, Some(batch))
    }

    /// Score every posting waiting, now: batches of 25 one after another, until none are left, you
    /// press Stop, or Claude's usage limit is reached (the rest then wait for the usual batches).
    /// Returns how many were scored.
    pub fn score_all_held(&self) -> R<usize> {
        let mut scored = 0;
        *self.scoring_all.lock().unwrap() = Some((0, self.held_count()));
        struct Done<'a>(&'a Mutex<Option<(usize, usize)>>);
        impl Drop for Done<'_> { fn drop(&mut self) { *self.0.lock().unwrap() = None; } }
        let _done = Done(&self.scoring_all);
        for _ in 0..200 {
            if self.held_count() == 0 || self.stopping() || self.limited().is_some() {
                break;
            }
            let r = self.search_with(Some(vec![]), false, Some(25))?;
            scored += r.scored;
            if let Some(x) = self.scoring_all.lock().unwrap().as_mut() { x.0 = scored; }
            if r.scored == 0 {
                break; // nothing more it can score now
            }
        }
        Ok(scored)
    }

    /// `batch`: only score held postings, at most this many, quietly (see score_held).
    pub(super) fn search_with(&self, postings: Option<Vec<Posting>>, force: bool, batch: Option<usize>) -> R<Report> {
        self.search_in(postings, force, batch, None)
    }

    /// Search one source only (an id from sources::SEARCHABLE, or "site:<id>" for one recruiter or
    /// job site), and score and file what's new like any search. What it found, posting by posting,
    /// and what became of each, is kept for the Search page (see source_results). It leaves the
    /// daily search alone: its time, its report and the postings it held over.
    pub fn search_source(&self, only: &str) -> R<Report> {
        let name = self.source_name(only).ok_or_else(|| Error("Job Hunt doesn't know that source.".into()))?;
        let p = self.profile();
        let off = match only.strip_prefix("site:") {
            Some(_) => p.sources.is_off("agencies"),
            None => p.sources.is_off(only),
        };
        if off {
            return err(format!("{name} is turned off. Turn it on first (Settings \u{2192} Job search)."));
        }
        if self.is_running("search") {
            return err("A search is running. Wait for it to finish, or stop it, then search this one.");
        }
        self.save_source_result(only, json!({ "running": true, "started": now(), "searching": name, "error": null }));
        let r = self.search_in(None, false, None, Some(only));
        if let Err(e) = &r {
            self.save_source_result(only, json!({ "running": false, "finished": now(), "error": e.0 }));
        }
        r
    }

    /// A source's name, for an id search_source takes.
    pub fn source_name(&self, only: &str) -> Option<String> {
        match only.strip_prefix("site:") {
            Some(id) => {
                let p = self.profile();
                crate::sites::targets(&p.sources.sites, &p.sources.custom_sites).into_iter().find(|t| t.id == id).map(|t| t.name)
            }
            None => crate::sources::SEARCHABLE.iter().find(|s| s.0 == only).map(|s| s.1.to_string()),
        }
    }

    /// The latest results of each source, from its own search or the last full one: {id: {id, name,
    /// started, finished, running, searching (what's being searched now), via ("own": searched on its
    /// own; "search": the full search), error, report (own searches), counts {found, new, fits, known,
    /// filtered}, postings: [{title, company, location, url, source, job, score, status, outcome,
    /// detail}]}}. Recruiters and job sites are one entry ("agencies"); a site searched on its own
    /// replaces that site's postings in it.
    pub fn source_results(&self) -> Value {
        let mut all: Value = serde_json::from_str(&self.secret("source.searches")).unwrap_or(json!({}));
        // One left "running" by a search that ended without saying (Job Hunt closed mid-search).
        let running = self.is_running("search");
        if let Some(o) = all.as_object_mut() {
            for v in o.values_mut().filter(|v| v["running"] == true && !running) {
                v["running"] = json!(false);
                v["error"] = json!("Stopped before it finished.");
            }
        }
        all
    }

    /// Where a search of `only` keeps its results: a single site's go with the other sites'.
    pub(super) fn results_key(only: &str) -> &str {
        if only.starts_with("site:") { "agencies" } else { only }
    }

    /// Merge `patch` into the results kept for `only` (see source_results).
    pub(super) fn save_source_result(&self, only: &str, patch: Value) {
        let mut all: Value = serde_json::from_str(&self.secret("source.searches")).unwrap_or(json!({}));
        if !all.is_object() {
            all = json!({});
        }
        let key = Self::results_key(only);
        if !all[key].is_object() {
            let name = self.source_name(key).unwrap_or_else(|| key.to_string());
            all[key] = json!({ "id": key, "name": name });
        }
        if let (Some(o), Some(p)) = (all[key].as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                o.insert(k.clone(), v.clone());
            }
        }
        let _ = self.db().set("source.searches", &all.to_string());
    }

    /// Which source a posting came from, as the Search page groups them (see sources::SEARCHABLE).
    pub(super) fn source_group(source: &str) -> String {
        if ["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable", "bamboohr"].contains(&source) {
            "boards".into()
        } else if crate::sites::is_site_source(source) {
            "agencies".into()
        } else {
            source.to_string()
        }
    }

    /// Keep what a search found for the Search page. `only`: the one source searched; None: a full
    /// search, kept source by source.
    pub(super) fn keep_found(&self, only: Option<&str>, found: &[Posting], known: &HashSet<String>, report: &Report) {
        // A source's list is kept to its best few hundred; filtered-out postings go first.
        const MAX: usize = 600;
        let count = |list: &[Value]| {
            let n = |o: &str| list.iter().filter(|p| p["outcome"] == o).count();
            json!({ "found": list.len(), "new": n("match") + n("new") + n("low") + n("waiting"), "fits": n("match"), "known": n("known"), "filtered": n("filtered") })
        };
        let finished = now();
        match only {
            Some(o) => {
                let mut list = self.posting_outcomes(found, known);
                if let Some(site) = o.strip_prefix("site:") {
                    // The other sites' postings from before stay.
                    let before = self.source_results()["agencies"]["postings"].as_array().cloned().unwrap_or_default();
                    list.extend(before.into_iter().filter(|p| p["source"] != site));
                    sort_outcomes(&mut list);
                }
                list.truncate(MAX);
                self.save_source_result(o, json!({ "running": false, "finished": finished, "error": null, "via": "own",
                    "report": report, "counts": count(&list), "postings": list }));
            }
            None => {
                let mut groups: BTreeMap<String, Vec<Posting>> = BTreeMap::new();
                for p in found {
                    groups.entry(Self::source_group(&p.source)).or_default().push(p.clone());
                }
                // Which source a line of the search's report is about: by its name, or else a recruiter or job site.
                let group_of = |line: &str| -> String {
                    if line.contains(" board ") { return "boards".into() }
                    crate::sources::SEARCHABLE.iter().find(|s| line.starts_with(s.1)).map(|s| s.0.to_string()).unwrap_or_else(|| "agencies".into())
                };
                // A source that was searched and found nothing says so too.
                for b in report.by_source.iter().filter_map(|b| b["name"].as_str()) {
                    groups.entry(group_of(b)).or_default();
                }
                for (id, list) in groups {
                    let mut list = self.posting_outcomes(&list, known);
                    list.truncate(MAX);
                    let problems: Vec<&String> = report.source_problems.iter().filter(|x| group_of(x) == id).collect();
                    self.save_source_result(&id, json!({ "running": false, "finished": finished, "error": null, "via": "search",
                        "report": { "source_problems": problems }, "counts": count(&list), "postings": list }));
                }
            }
        }
    }

    /// What became of each posting a search found, read back from what's stored now.
    /// `known`: ids of the postings Job Hunt had before this search. outcome: "match" (scored at or
    /// above your fit score), "low" (scored below it), "new" (stored, not scored), "filtered" (detail
    /// says why), "known" (found before) or "waiting" (scored with a later search).
    pub(super) fn posting_outcomes(&self, found: &[Posting], known: &HashSet<String>) -> Vec<Value> {
        let mut out = vec![];
        let mut seen: HashSet<String> = HashSet::new();
        for p in found {
            let job = {
                let db = self.db();
                db.existing_job(&p.id(), &p.company, &p.title).and_then(|id| db.job(&id).ok().flatten())
            };
            // Two listings of one role: shown once.
            if !seen.insert(job.as_ref().map(|j| j.id.clone()).unwrap_or_else(|| p.id())) {
                continue;
            }
            let (outcome, detail) = match &job {
                _ if known.contains(&p.id()) => ("known", String::new()),
                None => ("waiting", String::new()),
                Some(j) => match j.reasoning.as_deref().and_then(|r| r.strip_prefix("Filtered out: ")) {
                    Some(why) if j.score.is_none() => ("filtered", why.to_string()),
                    _ if j.score.is_none() => ("new", String::new()),
                    _ if j.status == "skipped" => ("low", String::new()),
                    _ => ("match", String::new()),
                },
            };
            out.push(json!({ "title": p.title, "company": p.company, "location": p.location, "url": p.url, "remote": p.remote,
                "source": p.source, "posted": p.posted_at, "job": job.as_ref().map(|j| j.id.clone()), "score": job.as_ref().and_then(|j| j.score),
                "status": job.as_ref().map(|j| j.status.clone()), "closed_at": job.as_ref().and_then(|j| j.closed_at.clone()),
                "deadline": job.as_ref().and_then(|j| j.deadline.clone()), "outcome": outcome, "detail": detail }));
        }
        sort_outcomes(&mut out);
        out
    }

    pub(super) fn search_in(&self, postings: Option<Vec<Posting>>, force: bool, batch: Option<usize>, only: Option<&str>) -> R<Report> {
        if self.is_running("update") {
            return err("Job Hunt is about to restart for an update; it searches again after.");
        }
        let _guard = self.claim("search")?;
        self.stop.store(false, std::sync::atomic::Ordering::SeqCst);
        // A pause belongs to this search only: cleared when it ends, however it ends.
        struct Unhold<'a>(&'a std::sync::atomic::AtomicBool);
        impl Drop for Unhold<'_> {
            fn drop(&mut self) {
                self.0.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let _unhold = Unhold(&self.hold);
        let held = self.hold.load(std::sync::atomic::Ordering::SeqCst);
        *self.progress.lock().unwrap() = Progress { paused: held, ..Progress::default() };
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & Career.");
        }
        let mut report = Report::default();
        let mut cap = batch.unwrap_or(profile.max_scored_per_run).max(1);
        // More waiting to be picked than you'll get through: a scheduled search scores half as
        // many (the newest first; the rest are held), so usage goes on what you'll apply to.
        if batch.is_none() && self.db().jobs(Some("queued"), BACKLOG + 1)?.len() > BACKLOG {
            cap = cap.min((cap / 2).max(10));
        }
        self.drop_outside_locations()?;
        let set_aside = self.db().archive_unpicked(UNPICKED_DAYS)?;
        if set_aside > 0 {
            self.db().log(None, "archive", &format!("set aside {set_aside} match{} not picked in {UNPICKED_DAYS} days (in All jobs under Not interested)", if set_aside == 1 { "" } else { "es" }))?;
        }
        let purged = self.db().purge_older_than(profile.purge_after_days)?;
        if purged > 0 {
            self.db().log(None, "purge", &format!("removed {purged} old posting{} you never acted on", if purged == 1 { "" } else { "s" }))?;
        }
        let searched = postings.is_none() && batch.is_none();
        let keep_found = only.is_some() || searched;
        let guidance = self.scoring_guidance(&profile);
        let mut run = SearchRun { cap, ..SearchRun::default() };
        let ctx = SearchCtx { profile: &profile, cvs: &cvs, guidance: &guidance, force, keep_found };
        match postings {
            // Postings handed in (added by you, or held ones): one batch.
            Some(list) => {
                let mut list = list;
                let held = self.take_held();
                report.held = held.len();
                let mut first = held;
                first.retain(|h| !list.iter().any(|a| a.id() == h.id()));
                first.append(&mut list);
                self.take_in(first, &mut run, &mut report, &ctx)?;
            }
            // A search: the sources are searched in the background while what they find is scored
            // here as it comes in, so matches show up from the first minutes, not at the end.
            None => {
                let keys = self.search_keys();
                let (tx, rx) = std::sync::mpsc::channel::<Vec<Posting>>();
                let fetched = std::thread::scope(|scope| -> R<crate::sources::Fetched> {
                    let profile_ref = &profile;
                    let fetcher = scope.spawn(move || {
                        if only == Some("indeed") {
                            return crate::sources::Fetched::default();
                        }
                        let send = |batch: &[Posting]| { let _ = tx.send(batch.to_vec()); };
                        crate::sources::fetch_streaming(profile_ref, &keys, only, &|i, n, name| { self.step("Searching job sites", i, n, name); !self.stopping() }, &send)
                    });
                    // What the last search left: first, while the sources are being searched.
                    if only.is_none() {
                        let held = self.take_held();
                        report.held = held.len();
                        if !held.is_empty() {
                            self.take_in(held, &mut run, &mut report, &ctx)?;
                        }
                    }
                    // Each source's postings as they arrive, a few batches at a time.
                    for batch in rx.iter() {
                        let mut batch = batch;
                        while let Ok(more) = rx.try_recv() {
                            batch.extend(more);
                        }
                        self.take_in(batch, &mut run, &mut report, &ctx)?;
                    }
                    Ok(fetcher.join().unwrap_or_default())
                })?;
                report.source_problems = fetched.problems;
                report.by_source = fetched.by_source.iter().map(|(n, k, p, e)| json!({ "name": n, "searches": k, "found": p, "failed": e })).collect();
                report.broken_boards = fetched.failed.iter().map(|(s, n)| json!({ "source": s, "name": n })).collect();
                if profile.sources.auto_boards {
                    let dropped = self.drop_dead_boards(&fetched.failed);
                    report.broken_boards.retain(|b| !dropped.contains(b));
                }
                report.closed += self.close_missing(&profile, &fetched.complete, &run.all_ids)?;
                // Indeed (through Claude), and job-alert emails that arrived meanwhile.
                let indeed_on = profile.sources.indeed && only.is_none_or(|o| o == "indeed");
                if indeed_on && !self.stopping() {
                    self.step("Searching Indeed", 0, 0, "through the Indeed connector");
                    let indeed = self.indeed_postings(&profile);
                    let (found, failed) = match &indeed { Ok(f) => (f.len(), 0), Err(_) => (0, 1) };
                    report.by_source.push(json!({ "name": "Indeed", "searches": 1, "found": found, "failed": failed }));
                    match indeed {
                        Ok(found) => self.take_in(found, &mut run, &mut report, &ctx)?,
                        Err(e) => report.source_problems.push(format!("Indeed: {}", e.0)),
                    }
                }
                if only.is_none() {
                    let alerts = self.take_pending_alerts();
                    if !alerts.is_empty() {
                        self.take_in(alerts, &mut run, &mut report, &ctx)?;
                    }
                }
            }
        }
        // Titles a word match missed: one request for them all, then scored like the rest.
        let mut near = std::mem::take(&mut run.near);
        if !near.is_empty() && !self.stopping() {
            let take: Vec<Posting> = near.drain(..near.len().min(NEAR_MISS_BATCH)).collect();
            self.step("Checking near-miss titles", 0, 1, &format!("{} titles", take.len()));
            let titles: Vec<String> = take.iter().map(|p| format!("{} ({})", p.title, p.company)).collect();
            match self.llm().pick_titles(&targets(&profile), &titles) {
                Ok(keep) => {
                    let mut picked = vec![];
                    for (i, p) in take.into_iter().enumerate() {
                        if keep.contains(&i) {
                            picked.push(p);
                        } else {
                            self.skip(&p, NO_TITLE_MATCH, &mut report)?;
                        }
                    }
                    self.score_these(picked, &mut run, &mut report, &ctx)?;
                }
                Err(e) => {
                    report.errors.push(format!("checking near-miss titles: {e}"));
                    report.deferred += take.len();
                    near.extend(take);
                }
            }
            report.deferred += near.len(); // over the batch size: next search
        }
        // Held for the next search, which looks at them first.
        self.hold(near);
        let found_here = std::mem::take(&mut run.found_here);
        let known_before = std::mem::take(&mut run.known_before);
        // Unless tailoring is automatic, roles that cleared the bar wait for you to pick them. A batch
        // of held postings leaves tailoring to the next search.
        let queued = if batch.is_none() { self.to_tailor_by_itself(&profile)? } else { vec![] };
        if !profile.auto_tailor {
            report.to_pick = self.db().jobs(Some("queued"), 500)?.len();
        }
        let n = queued.len();
        for (i, job) in queued.into_iter().enumerate() {
            if self.stopping() {
                break;
            }
            self.step("Tailoring applications", i, n, &format!("{} at {}", job.title, job.company));
            // Postings can sit in the queue for days: don't tailor one that has closed.
            if crate::sources::posting_closed(&job.url) == Some(true) {
                self.mark_closed(&job, "the posting says it's closed")?;
                report.closed += 1;
                continue;
            }
            match self.tailor(&job.id, None) {
                Ok(_) => report.tailored += 1,
                Err(e) => report.errors.push(format!("tailoring {} / {}: {e}", job.company, job.title)),
            }
            self.tally(&report);
        }
        self.step("Tailoring applications", 1, 1, "done");
        if self.stopping() {
            report.errors.push("Stopped: you stopped this search; what it found so far is kept".into());
        }
        if batch.is_some() {
            let waiting = self.held_count(); // before taking the database: it reads it too
            let db = self.db();
            db.log(None, "held", &format!("scored {} of the postings the last search left, {} cleared your fit score; {waiting} still waiting", report.scored, report.to_pick))?;
            db.set("last.held", &crate::util::now())?;
            return Ok(report);
        }
        if let Some(o) = only {
            let name = self.source_name(o).unwrap_or_else(|| o.to_string());
            self.db().log(None, "search", &format!("{name} only: {report}"))?;
            self.keep_found(only, &found_here, &known_before, &report);
            return Ok(report);
        }
        if searched {
            self.keep_found(None, &found_here, &known_before, &report);
        }
        {
            let db = self.db();
            db.log(None, "search", &report.to_string())?;
            db.set("last.search", &crate::util::now())?;
            db.set("last.report", &serde_json::to_string(&report).unwrap_or_default())?;
        }
        if report.tailored > 0 {
            let n = report.tailored;
            self.note(
                &format!("{n} application{} ready", if n == 1 { "" } else { "s" }),
                "Your CV and a cover letter are tailored. Review and approve them in Job Hunt.",
            );
        } else if report.to_pick > 0 && report.scored > 0 {
            let n = report.to_pick;
            self.note(
                &format!("{n} role{} worth applying to", if n == 1 { "" } else { "s" }),
                "They're in your Queue in Job Hunt: pick the ones to tailor your CV for.",
            );
        }
        Ok(report)
    }

    /// Pay found for a job that didn't show one: as Claude read it in the posting, on the company's own
    /// posting, or on a page in the Apply window (`from` says which, for the history). Below your
    /// minimum: a red flag, and a notice when you've already tailored or approved it. Returns whether
    /// it was new.
    pub fn found_salary(&self, job_id: &str, stated: &str, from: &str) -> R<bool> {
        self.found_salary_as(job_id, stated, from, true)
    }

    /// found_salary; `tell`: whether a salary below your minimum on a role you've tailored or approved
    /// sends a notice (a rescan sums them up in one instead).
    pub(super) fn found_salary_as(&self, job_id: &str, stated: &str, from: &str, tell: bool) -> R<bool> {
        let Some((text, max)) = salary_parts(stated) else { return Ok(false) };
        let Some(job) = self.db().job(job_id)? else { return Ok(false) };
        // Known already (and with a yearly figure, when this has one too): nothing new.
        let known_max = job.salary.as_deref().and_then(crate::sources::salary_max_of);
        if job.salary.as_deref().is_some_and(|s| !s.is_empty()) && (known_max.is_some() || max.is_none()) {
            return Ok(false);
        }
        let profile = self.profile();
        let mut flags = job.red_flags.clone();
        let low = below_minimum(&profile, max);
        if let Some(f) = &low {
            if !flags.iter().any(|x| x.starts_with("Pays up to")) {
                flags.insert(0, f.clone());
            }
        }
        {
            let db = self.db();
            db.update_job(job_id, &[("salary", text.clone().into()), ("red_flags", json!(job.flags_to_store(flags.clone())))])?;
            db.log(Some(job_id), "salary", &format!("{text}, {from}"))?;
        }
        if let (Some(f), true) = (low, tell && ["ready", "approved"].contains(&job.status.as_str())) {
            self.note(&format!("{} at {}: below your minimum", job.title, job.company), &format!("{f}. If it's not worth it, mark it Not interested."));
        }
        Ok(true)
    }

    /// Find the pay of every posting that doesn't show one: from its own text (the patterns),
    /// from its page and the company's own posting (their listed salary or text), then by Claude,
    /// which reads only the lines that mention pay, many postings at a time. Returns (checked,
    /// found, below your minimum among the ones you're working on).
    pub fn rescan_salaries(&self) -> R<(usize, usize, usize)> {
        let _g = self.claim("salaries")?;
        let jobs: Vec<Job> = self.db().jobs(None, 5000)?.into_iter().filter(|j| j.salary.as_deref().is_none_or(|s| s.trim().is_empty())).collect();
        let checked = jobs.len();
        let mut found = 0;
        let mut left: Vec<Job> = vec![];
        // 1. The posting's own text.
        for j in jobs {
            match crate::sources::salary_from_text(&j.description) {
                Some((text, _)) if self.found_salary_as(&j.id, &text, "in the posting", false)? => found += 1,
                _ => left.push(j),
            }
        }
        // 2. The page, and the company's own posting, for roles still in play (a few seconds each, so at most 60).
        let live = ["queued", "ready", "approved", "saved", "applied", "interviewing"];
        let c = crate::sources::http();
        let mut fetched = 0;
        let mut still: Vec<Job> = vec![];
        for j in left {
            let mut got = false;
            if live.contains(&j.status.as_str()) && j.closed_at.is_none() && fetched < 60 {
                for link in [j.apply_url.clone().unwrap_or_default(), j.url.clone()].into_iter().filter(|l| l.starts_with("http")) {
                    fetched += 1;
                    if let Some(text) = crate::sites::read_posting_link(&c, &link).ok().and_then(|p| p.salary) {
                        let from = if Some(&link) == j.apply_url.as_ref() { "on the company's own posting" } else { "on the posting's page" };
                        if self.found_salary_as(&j.id, &text, from, false)? {
                            found += 1;
                            got = true;
                            break;
                        }
                    }
                }
            }
            if !got {
                still.push(j);
            }
        }
        // 3. Claude, for pay written in ways the patterns miss: only the lines that mention pay.
        static PAYLINE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?i)(\$|salary|salaries|pay\b|compensation|wage|per hour|hourly|/hr|annual|a year|per year|cad|k\b)").unwrap());
        let mut asks: Vec<(String, String)> = vec![];
        for j in &still {
            let lines: Vec<&str> = j.description.lines().map(str::trim).filter(|l| l.chars().any(|c| c.is_ascii_digit()) && PAYLINE.is_match(l)).collect();
            if !lines.is_empty() {
                let text: String = lines.join("\n").chars().take(500).collect();
                asks.push((j.id.clone(), text));
            }
        }
        if !asks.is_empty() && self.claude_ready() {
            for batch in asks.chunks(20) {
                if self.limited().is_some() {
                    break;
                }
                let texts: Vec<String> = batch.iter().map(|(_, t)| t.clone()).collect();
                match self.llm().salaries(&texts) {
                    Ok(list) => {
                        for (i, pay) in list {
                            if self.found_salary_as(&batch[i].0, &pay, "in the posting (read by Claude)", false)? {
                                found += 1;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = self.db().log(None, "salaries:error", &e.0);
                        break;
                    }
                }
            }
        }
        // Below your minimum among the roles you're working on: one notice for all of them.
        let profile = self.profile();
        let low: Vec<Job> = ["queued", "ready", "approved"].iter().flat_map(|s| self.db().jobs(Some(s), 500).unwrap_or_default())
            .filter(|j| below_minimum(&profile, j.salary.as_deref().and_then(crate::sources::salary_max_of)).is_some()).collect();
        let _ = self.db().set("last.salaries", &now());
        self.db().log(None, "salaries", &format!("looked for the pay of {checked} postings without one: found {found}"))?;
        if found > 0 || checked > 0 {
            let more = if low.is_empty() { String::new() } else {
                format!(" {} of the roles you're working on pay below your minimum: {}. They're tagged Below your minimum.", low.len(),
                    low.iter().take(4).map(|j| format!("{} at {}", j.title, j.company)).collect::<Vec<_>>().join(", "))
            };
            self.note(&format!("Salaries found for {found} postings"), &format!("Looked at the {checked} postings without a salary: their text, their pages and the companies' own postings.{more}"));
        }
        Ok((checked, found, low.len()))
    }

    /// One batch of postings in a search: dedupe against the rest of the search, file what's known
    /// or filtered out, keep near-miss titles for the end, and score the rest (see score_these).
    pub(super) fn take_in(&self, postings: Vec<Posting>, run: &mut SearchRun, report: &mut Report, ctx: &SearchCtx) -> R<()> {
        if postings.is_empty() {
            return Ok(());
        }
        let profile = ctx.profile;
        run.all_ids.extend(postings.iter().map(|p| p.id()));
        if ctx.keep_found {
            for p in &postings {
                let known = {
                    let db = self.db();
                    db.job_exists(&p.id(), &p.company, &p.title).unwrap_or(false) || db.url_exists(&p.url).unwrap_or(false)
                };
                if known {
                    run.known_before.insert(p.id());
                }
            }
            run.found_here.extend(postings.iter().cloned());
        }
        report.found += postings.len();
        // Every source's listings, before copies are dropped, for how much the sources overlap.
        let seen: Vec<(String, String, String)> = postings.iter().map(|p| (p.source.clone(), p.company.clone(), p.title.clone())).collect();
        self.db().record_sightings(&seen)?;
        let mut candidates: Vec<Posting> = vec![];
        // Copies on the company's own site first, so a job board's copy of the same role is the one dropped.
        let mut postings = postings;
        postings.sort_by_key(|p| crate::sources::is_job_board(&p.url));
        for mut p in postings {
            if p.salary.is_none() {
                if let Some((text, max)) = crate::sources::salary_from_text(&p.description) {
                    p.salary = Some(text);
                    p.salary_max = p.salary_max.or(max);
                }
            }
            // The same role listed twice in one search (two sources, or twice on one board).
            let link = crate::db::url_key(&p.url);
            if !run.seen.insert(crate::db::dupe_key(&p.company, &p.title)) || (!link.is_empty() && !run.seen.insert(format!("url:{link}"))) {
                continue;
            }
            if ctx.force {
                let filtered = self.db().filtered_out(&p.id(), &p.company, &p.title)?;
                if let Some(old) = filtered {
                    self.db().delete_job(&old)?;
                    report.rechecked += 1;
                }
            }
            let known = self.db().job_exists(&p.id(), &p.company, &p.title)? || self.db().url_exists(&p.url)?;
            if known {
                // Found on the company's site this time: apply there rather than on the job board.
                let existing = self.db().existing_job(&p.id(), &p.company, &p.title);
                if let Some(id) = existing {
                    if self.db().prefer_company_link(&id, &p.url)? {
                        self.db().log(Some(&id), "company-site", &format!("found on the company's site: {}", p.url))?;
                    }
                }
                let posted = p.posted_at.as_deref().and_then(posted_date);
                self.db().record_repost(&p.id(), &p.company, &p.title, &p.url, posted)?;
                report.known += 1;
                continue;
            }
            report.new += 1;
            // A company you've set a minimum employee rating for, already rated below it.
            let low = profile.min_rating.and_then(|min| {
                let r = self.db().rating(&p.company)?;
                let got = r["rating"].as_f64().filter(|_| r["found"] == true)?;
                (got < min).then(|| format!("rated {got:.1} by employees, below your minimum of {min:.1}"))
            });
            match low.or_else(|| prefilter(&p, profile)) {
                None => candidates.push(p),
                Some(why) if why == NO_TITLE_MATCH => run.near.push(p),
                Some(why) => self.skip(&p, &why, report)?,
            }
        }
        self.tally(report);
        self.score_these(candidates, run, report, ctx)
    }

    /// Score new postings that passed the filters, as many as this search still has room for (the
    /// rest are held for the next one). Postings listed without their text (LinkedIn, Job Bank, job
    /// sites) are read first, and checked against the filters again.
    pub(super) fn score_these(&self, candidates: Vec<Posting>, run: &mut SearchRun, report: &mut Report, ctx: &SearchCtx) -> R<()> {
        let profile = ctx.profile;
        let mut candidates = candidates;
        // Best first, so the scoring cap leaves out the weakest: titles that match one of yours first.
        let wanted_title = |p: &Posting| profile.tracks.iter().flat_map(|t| t.titles.iter()).any(|t| crate::filters::title_matches(&p.title, t));
        // Newest first (what's just been posted is what's worth applying to now), then titles of yours.
        let day = |p: &Posting| p.posted_at.as_deref().and_then(crate::filters::posted_date).unwrap_or(chrono::NaiveDate::MIN);
        candidates.sort_by_key(|p| (std::cmp::Reverse(day(p)), !wanted_title(p)));
        let room = run.cap.saturating_sub(run.scored);
        if run.halted || room == 0 || self.stopping() {
            report.deferred += candidates.len();
            self.hold(candidates);
            return Ok(());
        }
        let thin_source = |s: &str| s == "linkedin" || s == "jobbank" || crate::sites::is_site_source(s);
        for (src, name, max) in [("linkedin", "LinkedIn", 30), ("jobbank", "Job Bank", 20)] {
            let mut thin: Vec<&mut Posting> = candidates.iter_mut().take(room).filter(|p| p.source == src && p.description.trim().is_empty()).collect();
            if thin.is_empty() || self.stopping() {
                continue;
            }
            self.also(&format!("reading {} {name} postings", thin.len()));
            let total = thin.len();
            let c = crate::sources::http();
            let read = if src == "linkedin" { crate::sources::linkedin_details(&c, &mut thin, max) } else { crate::sources::jobbank_details(&c, &mut thin, max) };
            if read < total {
                report.errors.push(format!("{name}: read {read} of {total} new postings; the rest wait for the next search"));
            }
        }
        let mut thin: Vec<&mut Posting> = candidates.iter_mut().take(room).filter(|p| crate::sites::is_site_source(&p.source) && p.description.trim().is_empty()).collect();
        if !thin.is_empty() && !self.stopping() {
            self.also(&format!("reading {} job sites' postings", thin.len()));
            let total = thin.len();
            let read = crate::sites::details(&crate::sources::http(), &mut thin, 30);
            if read < total {
                report.errors.push(format!("Job sites: read {read} of {total} new postings; the rest wait for the next search"));
            }
        }
        // Not read: held for the next search. Read: their pay, and the filters again.
        let (unread, read): (Vec<Posting>, Vec<Posting>) = candidates.into_iter().partition(|p| thin_source(&p.source) && p.description.trim().is_empty());
        report.deferred += unread.len();
        self.hold(unread);
        let mut kept = vec![];
        for mut p in read {
            if p.salary.is_none() && thin_source(&p.source) {
                if let Some((text, max)) = crate::sources::salary_from_text(&p.description) {
                    p.salary = Some(text);
                    p.salary_max = p.salary_max.or(max);
                }
            }
            match thin_source(&p.source).then(|| prefilter(&p, profile)).flatten() {
                Some(why) => self.skip(&p, &why, report)?,
                None => kept.push(p),
            }
        }
        let llm = self.llm();
        let size = llm.score_batch().max(1);
        let mut left: std::collections::VecDeque<Posting> = kept.into();
        let stops_all = |e: &Error| e.0.contains("API key") || e.0.contains("usage limit") || e.0.contains("signed in") || e.0.contains("wasn't found") || e.0.contains("isn't set up") || e.0.contains("key was rejected");
        while !left.is_empty() {
            if self.stopping() || run.halted || run.scored >= run.cap {
                report.deferred += left.len();
                self.hold(left.drain(..).collect());
                break;
            }
            self.wait_while_held();
            let n = size.min(run.cap - run.scored).min(left.len());
            let group: Vec<Posting> = left.drain(..n).collect();
            self.also(&if n == 1 { format!("scoring {} at {}", group[0].title, group[0].company) } else { format!("scoring {n} postings: {} at {} and {} more", group[0].title, group[0].company, n - 1) });
            let jobs: Vec<Job> = group.iter().map(|p| p.to_job()).collect();
            // Several in one request. One the answer left out, or a request that failed for a
            // reason of its own, is scored by itself; a failure that would stop every request
            // (no key, the usage limit) stops here.
            let mut answers: Vec<Option<R<crate::claude::JobScore>>> = if n > 1 {
                match llm.score_many(ctx.cvs, ctx.guidance, &jobs) {
                    Ok(v) => v.into_iter().map(|s| s.map(Ok)).collect(),
                    Err(e) if stops_all(&e) => jobs.iter().map(|_| Some(Err(Error(e.0.clone())))).collect(),
                    Err(_) => vec![],
                }
            } else {
                vec![]
            };
            answers.resize_with(n, || None);
            for ((p, mut job), answer) in group.into_iter().zip(jobs).zip(answers) {
            if run.halted {
                report.deferred += 1;
                self.hold(vec![p]);
                continue;
            }
            run.scored += 1;
            match answer.unwrap_or_else(|| llm.score(ctx.cvs, ctx.guidance, &job)) {
                Ok(s) => {
                    report.scored += 1;
                    job.status = if s.score >= profile.score_threshold { "queued" } else { "skipped" }.into();
                    job.score = Some(s.score);
                    job.score_potential = s.potential;
                    job.track = Some(s.track.clone());
                    job.reasoning = Some(s.reasoning);
                    job.red_flags = s.red_flags;
                    job.keywords = s.keywords;
                    job.deadline = deadline_of(&s.deadline, &job.description);
                    // Pay the search's patterns missed, as Claude read it; below your minimum, set aside like the filter would.
                    if job.salary.is_none() {
                        if let Some((text, max)) = salary_parts(&s.salary) {
                            job.salary = Some(text);
                            if let Some(flag) = below_minimum(profile, max) {
                                job.status = "skipped".into();
                                job.red_flags.insert(0, flag);
                            }
                        }
                    }
                    let db = self.db();
                    db.insert_job(&job)?;
                    db.log(Some(&job.id), "scored", &format!("{} on the {} track", s.score, s.track))?;
                }
                // Held, so the next search retries it.
                Err(e) => {
                    run.scored -= 1;
                    report.errors.push(format!("scoring {} / {}: {e}", p.company, p.title));
                    // Every other posting would fail the same way: stop scoring (they're held).
                    if stops_all(&e) {
                        run.halted = true;
                    }
                    self.hold(vec![p]);
                }
            }
            self.tally(report);
            }
        }
        self.also("");
        Ok(())
    }

    /// Score a posting that was skipped (filtered out or scored low) now; tailor it if it clears your bar.
    pub fn score_anyway(&self, job_id: &str) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & Career.");
        }
        let s = self.llm().score(&cvs, &self.scoring_guidance(&profile), &job)?;
        // One you saved (added without Claude, say) stays saved when it scores below your bar.
        // One you chose (sent from the browser, say) stays where it is, and so does one you saved.
        let status = if s.score >= profile.score_threshold { "queued" } else if job.status == "saved" { "saved" } else if self.chosen(job_id) && job.status == "queued" { "queued" } else { "skipped" };
        {
            let db = self.db();
            db.update_job(job_id, &[
                ("status", status.into()),
                ("score", s.score.into()), ("score_potential", json!(s.potential)),
                ("track", s.track.clone().into()),
                ("reasoning", s.reasoning.into()),
                ("red_flags", json!(s.red_flags)),
                ("keywords", json!(s.keywords)),
            ])?;
            db.log(Some(job_id), "scored", &format!("{} on the {} track (scored on request)", s.score, s.track))?;
        }
        let _ = self.found_salary(job_id, &s.salary, "in the posting");
        if status == "queued" && (profile.auto_tailor || (profile.auto_tailor_min > 0 && s.score >= profile.auto_tailor_min)) {
            return self.tailor(job_id, None);
        }
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// The roles a search tailors without being asked, best fit first, at most `max_per_run`:
    /// every one that cleared your fit score when tailoring is automatic; else, when you chose a
    /// score for it, only the strong fits found in the last two weeks (an old match isn't worth the
    /// usage until you say so). None otherwise.
    pub(super) fn to_tailor_by_itself(&self, profile: &Profile) -> R<Vec<Job>> {
        let from = if profile.auto_tailor { profile.score_threshold } else if profile.auto_tailor_min > 0 { profile.auto_tailor_min.max(profile.score_threshold) } else { return Ok(vec![]) };
        let recent = (chrono::Utc::now() - chrono::Duration::days(14)).to_rfc3339();
        let mut list: Vec<Job> = self.db().jobs(Some("queued"), 500)?.into_iter()
            .filter(|j| j.score.unwrap_or(0) >= from && (profile.auto_tailor || j.found_at >= recent)).collect();
        list.sort_by_key(|j| std::cmp::Reverse(j.score.unwrap_or(0)));
        list.truncate(profile.max_per_run);
        Ok(list)
    }

    /// Store a posting as skipped before scoring, with the reason.
    pub(super) fn skip(&self, p: &Posting, why: &str, report: &mut Report) -> R<()> {
        report.filtered += 1;
        let kind = if why.starts_with("location") {
            "outside your locations"
        } else if why == NO_TITLE_MATCH {
            "title doesn't match your CVs"
        } else if why.starts_with("title contains") {
            "a title word you skip"
        } else if why.starts_with("salary") {
            "salary below your minimum"
        } else if why.starts_with("excluded") {
            "a company you skip"
        } else if why.starts_with("rated") {
            "company rated below your minimum"
        } else {
            "other"
        };
        *report.why_filtered.entry(kind.to_string()).or_insert(0) += 1;
        let mut job = p.to_job();
        job.status = "skipped".into();
        job.reasoning = Some(format!("Filtered out: {why}"));
        self.db().insert_job(&job)
    }

    /// A job you found yourself (LinkedIn, referral), scored and tailored like any other. With
    /// `use_claude` off (or Claude out of reach) it's saved as it is, for you to tailor later.
    pub fn add_manual(&self, company: &str, title: &str, url: &str, location: &str, description: &str, use_claude: bool) -> R<String> {
        self.add_found("manual", company, title, url, location, description, use_claude, true)
    }

    /// The notice after adding a posting: tailored, scored, or saved without Claude.
    pub fn added_notice(&self, id: &str) -> (String, String) {
        let Ok(Some(j)) = self.db().job(id) else { return ("Added to Job Hunt".into(), String::new()) };
        match (j.status.as_str(), j.score) {
            ("ready", s) => ("Application ready".into(), format!("{} at {} (fit {}) has a tailored CV and cover letter waiting for your approval.", j.title, j.company, s.unwrap_or(0))),
            ("queued", Some(s)) => ("Added to Job Hunt".into(), format!("{} at {}: fit {s}. It's in your Queue, for you to tailor when you choose.", j.title, j.company)),
            (_, Some(s)) => ("Added to Job Hunt".into(), format!("{} at {}: fit {s}.", j.title, j.company)),
            _ => ("Saved to Job Hunt".into(), format!("{} at {} is saved in All jobs. Use Tailor anyway when you want a tailored CV and cover letter.", j.title, j.company)),
        }
    }

    /// A posting read from its link without Claude: LinkedIn's signed-out page, or the page's own
    /// job data. For filling in the Add a job form.
    pub fn read_link(&self, url: &str) -> R<Posting> {
        let url = url.trim();
        if !url.starts_with("http") {
            return err("Paste the posting's full link, starting with https://");
        }
        let c = crate::sources::http();
        let p = match crate::sources::linkedin_job_id(url) {
            Some(id) => crate::sources::linkedin_posting(&c, &id),
            None => crate::sites::read_posting_link(&c, url),
        };
        p.map_err(|e| Error(format!("Couldn't read that posting ({e}). Paste its details instead.")))
    }

    /// A posting sent from your browser with the Send to Job Hunt button: {url, title, company,
    /// location, text, structured}. When the page didn't describe the job in a standard way, its
    /// own page is read for the job data, and only then does Claude read the page to find it.
    pub fn add_clip(&self, clip: &Value) -> R<Job> {
        let team = clip["people"].as_array().is_some_and(|a| !a.is_empty());
        match self.add_clip_job(clip) {
            Ok(job) => {
                if team {
                    let _ = self.add_hiring_team(&job.id, &clip["people"]);
                }
                Ok(job)
            }
            // Already here (found by a search, say): the hiring team is still news. Sending the
            // posting from LinkedIn is how you get it onto a job Job Hunt found by itself.
            Err(e) if team && e.0.contains("is already in Job Hunt.") => {
                let names = self.job_for_clip(clip).and_then(|id| self.add_hiring_team(&id, &clip["people"]).ok()).unwrap_or_default();
                if names.is_empty() {
                    return Err(e);
                }
                Err(Error(format!("{} Its hiring team from LinkedIn is now on the job, under People: {}.", e.0, names.join(", "))))
            }
            Err(e) => Err(e),
        }
    }

    /// The job a posting sent from the browser is about, when it's here already: by its LinkedIn
    /// number, else by company and title.
    pub(super) fn job_for_clip(&self, clip: &Value) -> Option<String> {
        let f = |k: &str| clip[k].as_str().unwrap_or("").trim().to_string();
        let db = self.db();
        if let Some(n) = crate::sources::linkedin_job_id(&f("url")) {
            let found = db.jobs(None, 5000).ok()?.into_iter().find(|j| crate::sources::linkedin_job_id(&j.url).as_deref() == Some(n.as_str()));
            if let Some(j) = found {
                return Some(j.id);
            }
        }
        let url = f("url");
        let same_link = |j: &Job| !url.is_empty() && j.url.trim_end_matches('/') == url.trim_end_matches('/');
        if let Some(j) = db.jobs(None, 5000).ok()?.into_iter().find(same_link) {
            return Some(j.id);
        }
        if f("company").is_empty() || f("title").is_empty() { None } else { db.existing_job("", &f("company"), &f("title")) }
    }

    /// The people LinkedIn lists as a posting's hiring team (read from the page in your own
    /// browser, signed in as you): kept with the job's people, at most four, each with their
    /// profile link. For a job you're already going for, the note to the first is written now.
    /// Returns the names added.
    pub fn add_hiring_team(&self, job_id: &str, people: &Value) -> R<Vec<String>> {
        let mut list = self.contacts(job_id);
        let mut added = vec![];
        let mut first = None;
        for p in people.as_array().into_iter().flatten().take(4) {
            let f = |k: &str| p[k].as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ");
            let (name, role, link) = (f("name"), f("role"), f("link").trim_end_matches('/').to_string());
            if name.is_empty() || name.chars().count() > 80 || !link.starts_with("https://www.linkedin.com/in/") {
                continue;
            }
            let same = |c: &Value| c["link"].as_str().is_some_and(|l| l.trim_end_matches('/') == link) || c["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(&name));
            if let Some(i) = list.iter().position(same) {
                first.get_or_insert(i);
                continue;
            }
            list.push(json!({ "name": name, "role": role.chars().take(160).collect::<String>(), "link": link, "email": "",
                "note": "LinkedIn lists them on the posting as its hiring team. The candidate doesn't know them: a first, cold message." }));
            first.get_or_insert(list.len() - 1);
            added.push(name);
        }
        if added.is_empty() {
            return Ok(added);
        }
        list.retain(|c| !(c["name"] == "Recruiter" && c["link"].as_str().unwrap_or("").is_empty() && c["message"].as_str().unwrap_or("").is_empty() && c["sent_at"].as_str().unwrap_or("").is_empty()));
        self.save_contacts(job_id, &list)?;
        self.db().log(Some(job_id), "contact", &format!("the hiring team from the LinkedIn posting: {}", added.join(", ")))?;
        // Going for it already: the note to the first of them, ready to send from their profile.
        let going = self.db().job(job_id)?.is_some_and(|j| ["ready", "approved", "applied", "interviewing"].contains(&j.status.as_str()));
        let list = self.contacts(job_id);
        let best = list.iter().position(|c| c["name"].as_str() == Some(added[0].as_str()));
        if let Some(i) = best.filter(|i| going && self.claude_ready() && self.limited().is_none() && list[*i]["sent_at"].as_str().unwrap_or("").is_empty()) {
            let _ = self.write_outreach(job_id, i);
        }
        Ok(added)
    }

    pub(super) fn add_clip_job(&self, clip: &Value) -> R<Job> {
        let f = |k: &str| clip[k].as_str().unwrap_or("").trim().to_string();
        let use_claude = clip["claude"].as_bool().unwrap_or(true);
        // A LinkedIn job: read it as LinkedIn shows it signed out, which is far cleaner than the
        // signed-in page (a list of other jobs, the feed, messages).
        if let Some(id) = crate::sources::linkedin_job_id(&f("url")).filter(|_| !cfg!(test)) {
            if let Ok(p) = crate::sources::linkedin_posting(&crate::sources::http(), &id) {
                if !p.title.is_empty() && !p.company.is_empty() {
                    let jid = self.add_found("linkedin", &p.company, &p.title, &p.url, &p.location, &p.description, use_claude, false)?;
                    let mut set: Vec<(&str, Value)> = vec![];
                    if let Some(u) = p.apply_url { set.push(("apply_url", u.into())); }
                    if let Some(e) = p.apply_email { set.push(("apply_email", e.into())); }
                    if let Some(t) = p.salary { set.push(("salary", t.into())); }
                    if !set.is_empty() {
                        self.db().update_job(&jid, &set)?;
                    }
                    return self.db().job(&jid)?.ok_or_else(|| Error("That job no longer exists.".into()));
                }
            }
        }
        let (url, text) = (f("url"), f("text"));
        let (mut title, mut company, mut location, mut description) = (f("title"), f("company"), f("location"), text.clone());
        if text.chars().count() < 40 {
            return err("That page had no posting text. Select the job description on the page and click the button again.");
        }
        if clip["structured"].as_bool() != Some(true) || title.is_empty() || company.is_empty() {
            // The page's own job data first: it costs no Claude usage.
            let page = if cfg!(test) || !url.starts_with("http") { None } else {
                crate::sites::read_posting_link(&crate::sources::http(), &url).ok()
                    .filter(|p| !p.title.is_empty() && !p.company.is_empty() && p.description.chars().count() >= 200)
            };
            let read = match page {
                Some(p) => Some(crate::claude::FoundJob { title: p.title, company: p.company, location: p.location, description: p.description, ..Default::default() }),
                None if use_claude && self.limited().is_none() => match self.llm().read_posting(&url, &text) {
                    Ok(j) if j.title.trim().is_empty() || j.description.trim().chars().count() < 40 => {
                        return err("That page doesn't look like a job posting. Open the posting itself, then click the button.");
                    }
                    Ok(j) => Some(j),
                    // Claude out of reach: the page as you sent it.
                    Err(_) => None,
                },
                None => None,
            };
            if let Some(j) = read {
                title = j.title.trim().to_string();
                if !j.company.trim().is_empty() {
                    company = j.company.trim().to_string();
                }
                if !j.location.trim().is_empty() {
                    location = j.location.trim().to_string();
                }
                description = j.description;
            } else if title.is_empty() {
                title = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(120).collect();
            }
        }
        if company.is_empty() {
            company = crate::logos::name_from_site(&url).unwrap_or_else(|| "Unknown".into());
        }
        let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default();
        let source = ["linkedin", "indeed", "glassdoor", "jobbank", "workopolis", "eluta", "ziprecruiter", "monster"].iter()
            .find(|s| host.contains(*s)).map(|s| s.to_string()).unwrap_or_else(|| "browser".into());
        let id = self.add_found(&source, &company, &title, &url, &location, &description, use_claude, false)?;
        self.db().job(&id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Add a posting you found. With Claude it's scored and tailored; without (you said so, it isn't
    /// connected, there's no CV yet, or it's at its usage limit) it's saved for later as it is, and
    /// Tailor anyway scores and tailors it whenever you like.
    /// `tailor`: tailor it right away (Add a job's "Score it and tailor"); otherwise it waits on the
    /// Overview to be picked, whatever its score (the browser button: you chose it, so it's shown).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn add_found(&self, source: &str, company: &str, title: &str, url: &str, location: &str, description: &str, use_claude: bool, tailor: bool) -> R<String> {
        if company.trim().is_empty() || title.trim().is_empty() {
            return err("Add the company and the title.");
        }
        if use_claude && description.trim().len() < 40 {
            return err("Add the company, the title and the full job description.");
        }
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        let p = Posting {
            source: source.into(),
            external_id: short_hash(&format!("{company}|{title}|{url}")),
            company: company.trim().into(),
            title: title.trim().into(),
            location: location.trim().into(),
            url: url.trim().into(),
            description: description.trim().into(),
            ..Posting::default()
        };
        if self.db().job_exists(&p.id(), &p.company, &p.title)? {
            let known = self.db().job(&p.id())?.map(|j| j.status).unwrap_or_default();
            if known != "skipped" {
                // Sent again: note it on the job that's there, so it's one click away.
                // Read first: an `if let` on self.db() would hold the lock through the log below.
                let existing = self.db().existing_job(&p.id(), &p.company, &p.title);
                let mut earlier = String::new();
                if let Some(id) = existing {
                    self.db().log(Some(&id), "added-again", "you sent this posting again; it's already in Job Hunt")?;
                    // Not scored (added without Claude, or its CV was removed): score it now.
                    let unscored = self.db().job(&id)?.is_some_and(|j| j.score.is_none());
                    if unscored && use_claude && !cvs.is_empty() && self.score_anyway(&id).is_ok() {
                        return Ok(id);
                    }
                    // Its fit is the one worked out when it was first found, against your CVs as they were then.
                    let old = self.db().job(&id)?;
                    if let Some((score, found)) = old.and_then(|j| j.score.map(|s| (s, j.found_at))) {
                        let day = found.get(..10).unwrap_or("").to_string();
                        earlier = format!(" Its fit of {score} was scored{} against your CVs as they were then; it isn't scored again.", if day.is_empty() { String::new() } else { format!(" on {day}") });
                    }
                }
                return err(format!("{} at {} is already in Job Hunt.{earlier}", p.title, p.company));
            }
            // Filtered out or scored low before: you want it, so look again.
            self.db().delete_job(&p.id())?;
        }
        let mut job = p.to_job();
        let how = if source == "manual" { "added by hand" } else { "sent from the browser" };
        // Why it's saved without Claude, if it is.
        let without = if !use_claude {
            Some("you added it without Claude".to_string())
        } else if cvs.is_empty() {
            Some("no CV uploaded yet".to_string())
        } else if self.limited().is_some() {
            Some("Claude is at its usage limit".to_string())
        } else {
            match self.llm().score(&cvs, &self.scoring_guidance(&profile), &job) {
                Ok(s) => {
                    job.score = Some(s.score);
                    job.score_potential = s.potential;
                    job.track = Some(s.track);
                    job.reasoning = Some(s.reasoning);
                    job.red_flags = s.red_flags;
                    job.keywords = s.keywords;
                    job.deadline = deadline_of(&s.deadline, &job.description);
                    if job.salary.is_none() {
                        if let Some((text, max)) = salary_parts(&s.salary) {
                            job.salary = Some(text);
                            if let Some(flag) = below_minimum(&profile, max) {
                                job.red_flags.insert(0, flag);
                            }
                        }
                    }
                    None
                }
                // Not connected, signed out, or any other failure: saved, not lost.
                Err(e) => Some(format!("Claude couldn't score it ({e})")),
            }
        };
        if let Some(why) = without {
            job.status = "saved".into();
            job.reasoning = Some(format!("Saved without scoring: {why}. Use Tailor anyway when you want a tailored CV and cover letter."));
            job.deadline = deadline_of("", &job.description);
            let db = self.db();
            db.insert_job(&job)?;
            db.log(Some(&job.id), "added", &format!("{how}; saved without Claude: {why}"))?;
            return Ok(job.id);
        }
        job.status = "queued".into();
        {
            let db = self.db();
            db.insert_job(&job)?;
            db.log(Some(&job.id), "added", how)?;
            if !tailor {
                // Yours to pick on the Overview, kept there whatever the filters say.
                db.log(Some(&job.id), "chosen", "you sent it to Job Hunt")?;
            }
        }
        // Scored and kept even if tailoring fails now (a usage limit, say): it waits to be picked.
        if tailor {
            if let Err(e) = self.tailor(&job.id, None) {
                self.db().log(Some(&job.id), "tailor:error", &e.0)?;
            }
        }
        Ok(job.id)
    }
}
