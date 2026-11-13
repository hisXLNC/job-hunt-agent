//! Your CVs, and tailoring one and a cover letter to a posting.

use super::*;

impl Agent {
    // --- CVs ----------------------------------------------------------------------------------

    /// A CV as an editable Word file: Word files are used as they are (unless `convert`); PDFs and
    /// text are converted by Claude, word for word, into Job Hunt's clean template.
    pub(super) fn cv_bytes(&self, filename: &str, bytes: &[u8], convert: bool) -> R<(Vec<u8>, String)> {
        let lower = filename.to_lowercase();
        if bytes.starts_with(b"PK") {
            let doc = cv::from_bytes(bytes.to_vec())?;
            if !convert {
                return Ok((bytes.to_vec(), "docx".into()));
            }
            let structured = self.llm().convert_cv(&CvSource::Text(doc.plain_text()))?;
            return Ok((cv::build_docx(&structured)?, "docx-converted".into()));
        }
        if bytes.starts_with(b"%PDF") {
            let structured = self.llm().convert_cv(&CvSource::Pdf(bytes.to_vec()))?;
            return Ok((cv::build_docx(&structured)?, "pdf".into()));
        }
        if lower.ends_with(".doc") || bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
            return err("That's an old .doc Word file. Open it in Word and save it as .docx (or PDF), then upload that.");
        }
        let text = String::from_utf8(bytes.to_vec()).map_err(|_| Error("Job Hunt can read Word (.docx), PDF and plain-text CVs.".into()))?;
        if text.trim().len() < 200 {
            return err("That file has too little text to be a CV.");
        }
        let structured = self.llm().convert_cv(&CvSource::Text(text))?;
        Ok((cv::build_docx(&structured)?, "text".into()))
    }

    /// Add a CV as a new track. Claude names it and suggests titles and keywords to search for.
    pub fn add_cv(&self, filename: &str, bytes: &[u8], convert: bool) -> R<Track> {
        let (docx, kind) = self.cv_bytes(filename, bytes, convert)?;
        let doc = cv::from_bytes(docx.clone())?;
        let suggestion = self.llm().cv_profile(&doc.plain_text()).unwrap_or_default();
        let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "CV".into());
        let label = if suggestion.label.trim().is_empty() { stem.replace(['_', '-'], " ") } else { suggestion.label.trim().to_string() };
        let mut profile = self.profile();
        let id = profile.new_track_id(&label);
        std::fs::create_dir_all(self.files().join("cv").join("originals"))?;
        std::fs::write(self.cv_path(&id), &docx)?;
        let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "bin".into());
        std::fs::write(self.files().join("cv").join("originals").join(format!("{id}.{ext}")), bytes)?;
        let track = Track {
            name: id,
            label,
            titles: suggestion.titles,
            keywords: suggestion.keywords,
            kind,
            original: filename.to_string(),
            letter_style: "standard".into(),
            areas: suggestion.areas,
        };
        if profile.name.trim().is_empty() {
            profile.name = suggestion.name.trim().to_string();
        }
        if profile.email.trim().is_empty() {
            profile.email = suggestion.email.trim().to_string();
        }
        profile.tracks.push(track.clone());
        self.save_profile(&profile)?;
        self.db().log(None, "cv", &format!("added {} ({})", track.label, filename))?;
        Ok(track)
    }

    /// Replace a CV's file, keeping its name, titles and keywords.
    /// A new file for a CV. Fits worked out against the old one, and applications tailored from it
    /// that are waiting for your approval, are redone with the new one: see CvChange.
    pub fn replace_cv(&self, id: &str, filename: &str, bytes: &[u8], convert: bool) -> R<(Track, CvChange)> {
        let t = self.write_cv(id, filename, bytes, convert)?;
        let change = self.cv_changed(id, &t.label, false)?;
        Ok((t, change))
    }

    pub(super) fn write_cv(&self, id: &str, filename: &str, bytes: &[u8], convert: bool) -> R<Track> {
        let mut profile = self.profile();
        let Some(pos) = profile.tracks.iter().position(|t| t.name == id) else { return err("That CV no longer exists.") };
        let (docx, kind) = self.cv_bytes(filename, bytes, convert)?;
        std::fs::create_dir_all(self.files().join("cv").join("originals"))?;
        std::fs::write(self.cv_path(id), &docx)?;
        let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "bin".into());
        std::fs::write(self.files().join("cv").join("originals").join(format!("{id}.{ext}")), bytes)?;
        profile.tracks[pos].kind = kind;
        profile.tracks[pos].original = filename.to_string();
        let t = profile.tracks[pos].clone();
        self.save_profile(&profile)?;
        self.db().log(None, "cv", &format!("replaced {} ({})", t.label, filename))?;
        Ok(t)
    }

    /// Convert an existing Word CV to Job Hunt's editable template (for layouts it can't edit).
    pub fn convert_existing_cv(&self, id: &str) -> R<Track> {
        let bytes = std::fs::read(self.cv_path(id)).map_err(|_| Error("That CV's file is missing.".into()))?;
        let original = self.profile().tracks.iter().find(|t| t.name == id).map(|t| t.original.clone()).unwrap_or_else(|| format!("{id}.docx"));
        // Only the layout changes, not what the CV says: nothing to score or tailor again.
        self.write_cv(id, &original, &bytes, true)
    }

    /// Remove a CV. What it scored and tailored is redone with the CVs left: see CvChange.
    pub fn remove_cv(&self, id: &str) -> R<CvChange> {
        let mut profile = self.profile();
        let before = profile.tracks.len();
        let label = profile.tracks.iter().find(|t| t.name == id).map(|t| t.label.clone()).unwrap_or_else(|| id.to_string());
        profile.tracks.retain(|t| t.name != id);
        if profile.tracks.len() == before {
            return err("That CV no longer exists.");
        }
        self.save_profile(&profile)?;
        let _ = std::fs::remove_file(self.cv_path(id));
        let change = self.cv_changed(id, &label, true)?;
        self.db().log(None, "cv", &format!("removed {id}; {} fit{} to score again, {} application{} to tailor again",
            change.unscored.len(), if change.unscored.len() == 1 { "" } else { "s" }, change.retailor.len(), if change.retailor.len() == 1 { "" } else { "s" }))?;
        Ok(change)
    }

    /// Your CV `id` was replaced or removed. Fits it gave to jobs you haven't acted on are cleared
    /// (to score again: `unscored`). Applications tailored from it and waiting for your approval are
    /// to be tailored again from the CV as it is now (`retailor`), so the CV and cover letter you
    /// send use it; when it was removed, they're scored again first and tailored from the CV that
    /// fits best. Ones with your own file or your edits since tailoring keep them (`kept`, noted on
    /// each), as do ones you approved or sent: what's gone out stays as it went.
    pub(super) fn cv_changed(&self, id: &str, label: &str, removed: bool) -> R<CvChange> {
        let mut c = CvChange::default();
        let what = if removed { "was removed" } else { "was replaced" };
        // A new file for the CV: only the fits that cleared your bar are scored again (the roles
        // waiting for you to pick, and saved ones that did). What was set aside or scored below it
        // keeps its fit: scoring those again cost a request each for some 1,800 roles nobody was
        // waiting on. A CV that's gone leaves nothing to keep, so there everything it scored goes.
        let bar = self.profile().score_threshold;
        // (Removed, too: the roles set aside keep the fit they had, and only forget which CV gave it.
        // Clearing them all meant some 1,800 fits to score again each time a CV was taken away.)
        if removed {
            for st in ["skipped", "dismissed"] {
                let jobs = self.db().jobs(Some(st), 100_000)?;
                for j in jobs.into_iter().filter(|j| j.track.as_deref() == Some(id)) {
                    self.db().update_job(&j.id, &[("track", Value::Null)])?;
                }
            }
        }
        let statuses: &[&str] = &["queued", "saved"];
        for st in statuses {
            // Read first: the lock would otherwise be held through the loop, which takes it again.
            let jobs = self.db().jobs(Some(st), 100_000)?;
            for j in jobs {
                if j.track.as_deref() != Some(id) || j.score.is_none() {
                    continue;
                }
                if !removed && *st == "saved" && j.score.is_some_and(|s| s < bar) {
                    continue;
                }
                let db = self.db();
                db.update_job(&j.id, &[
                    ("score", Value::Null), ("score_potential", Value::Null), ("score_after", Value::Null),
                    ("track", if removed { Value::Null } else { id.into() }),
                    ("reasoning", format!("Not scored: the {label} CV it was scored against {what}.").into()),
                ])?;
                db.log(Some(&j.id), "unscored", &format!("its fit of {} was against the {label} CV, which {what}", j.score.unwrap_or(0)))?;
                c.unscored.push(j.id);
            }
        }
        let ready = self.db().jobs(Some("ready"), 100_000)?;
        for j in ready.into_iter().filter(|j| j.track.as_deref() == Some(id)) {
            let own = self.own_file(&j.id, "cv") || self.own_file(&j.id, "letter");
            // Newest first: a change of yours before the tailoring that made it is yours to keep.
            let edited = self.db().history(&j.id)?.iter().take_while(|e| e.kind != "tailored").any(|e| e.kind == "revised");
            if own || edited {
                self.db().log(Some(&j.id), "cv-changed", &format!("the {label} CV {what} after this was tailored; it keeps {}. Tailor it again to use your CVs as they are now",
                    if own { "your own file" } else { "your changes" }))?;
                c.kept += 1;
                continue;
            }
            // What you had, kept for Put back as it was (an edit from before edits were recorded
            // would otherwise be lost).
            self.keep_for_undo(&j)?;
            // Its fit was against the old CV too: scored again before it's tailored again.
            self.db().update_job(&j.id, &[("score", Value::Null), ("score_potential", Value::Null), ("track", if removed { Value::Null } else { id.into() })])?;
            self.db().log(Some(&j.id), "cv-changed", &format!("the {label} CV {what}: tailoring it again"))?;
            // Answers written for its form were from the old CV: written again when next asked for.
            let _ = self.db().delete(&format!("answers:{}", j.id));
            c.retailor.push(j.id);
        }
        if !removed {
            // Approved, not sent yet: what you'd submit would be from the old CV, so these are
            // tailored again as well and stay approved (see refresh_after_cv). Your own file or
            // edits are kept, as for the ones waiting for approval.
            let approved = self.db().jobs(Some("approved"), 100_000)?;
            for j in approved.into_iter().filter(|j| j.track.as_deref() == Some(id) && j.applied_at.is_none()) {
                let own = self.own_file(&j.id, "cv") || self.own_file(&j.id, "letter");
                let edited = self.db().history(&j.id)?.iter().take_while(|e| e.kind != "tailored").any(|e| e.kind == "revised");
                if own || edited {
                    self.db().log(Some(&j.id), "cv-changed", &format!("the {label} CV {what} after you approved this; it keeps {}. Tailor it again to use your CVs as they are now",
                        if own { "your own file" } else { "your changes" }))?;
                    c.kept += 1;
                    continue;
                }
                self.keep_for_undo(&j)?;
                self.db().update_job(&j.id, &[("score", Value::Null), ("score_potential", Value::Null)])?;
                self.db().log(Some(&j.id), "cv-changed", &format!("the {label} CV {what} after you approved this: tailoring it again, so what you submit is from the new CV"))?;
                let _ = self.db().delete(&format!("answers:{}", j.id));
                c.approved.push(j.id);
            }
            // With other CVs too: a role waiting for you that another CV scored best may now be a
            // better match for this one. Scored again against them all (it keeps its CV until then).
            if self.profile().tracks.len() > 1 {
                for st in ["queued", "saved"] {
                    let jobs = self.db().jobs(Some(st), 100_000)?;
                    for j in jobs.into_iter().filter(|j| j.score.is_some_and(|s| s >= bar) && j.track.as_deref().is_some_and(|t| t != id)) {
                        let db = self.db();
                        db.update_job(&j.id, &[("score", Value::Null), ("score_potential", Value::Null), ("score_after", Value::Null),
                            ("reasoning", format!("Not scored: your {label} CV changed and may now be the better match for this.").into())])?;
                        db.log(Some(&j.id), "unscored", &format!("its fit of {} was from before the {label} CV changed", j.score.unwrap_or(0)))?;
                        c.unscored.push(j.id);
                    }
                }
            }
        }
        Ok(c)
    }

    /// Keep an application's tailored CV and cover letter as they are, so Put back as it was can
    /// restore them after they're tailored again.
    pub(super) fn keep_for_undo(&self, j: &Job) -> R<()> {
        let db = self.db();
        if let Some(path) = j.cv_path.as_deref().filter(|p| Path::new(p).is_file()) {
            let backup = Path::new(path).with_extension("before-revision.docx");
            if std::fs::copy(path, &backup).is_ok() {
                db.set(&format!("undo:{}:cv", j.id), &json!({ "file": backup, "cv_changes": j.cv_changes, "coverage_after": j.coverage_after, "keyword_gaps": j.keyword_gaps }).to_string())?;
            }
        }
        if let Some(l) = j.cover_letter.as_deref().filter(|l| !l.trim().is_empty()) {
            db.set(&format!("undo:{}:letter", j.id), &json!({ "letter": l }).to_string())?;
        }
        Ok(())
    }

    /// Redo what a change of CV left to redo, in the background: fits first, then tailoring (three
    /// at a time, held for later if Claude reaches its usage limit). With no CV left, it waits for
    /// the next one you add (see after_cv_added).
    pub fn apply_cv_change(self: &Arc<Self>, c: CvChange) {
        if c.unscored.is_empty() && c.retailor.is_empty() {
            return;
        }
        if self.cv_texts(&self.profile()).is_empty() {
            let mut waiting: CvChange = serde_json::from_str(&self.secret("cv.waiting")).unwrap_or_default();
            for id in c.unscored {
                if !waiting.unscored.contains(&id) { waiting.unscored.push(id) }
            }
            for id in c.retailor {
                if !waiting.retailor.contains(&id) { waiting.retailor.push(id) }
            }
            let _ = self.db().set("cv.waiting", &serde_json::to_string(&waiting).unwrap_or_default());
            return;
        }
        // With a CV to do it with: everything that's waiting is done, this change's and any left from before.
        self.resume_cv_work();
    }

    /// Score these again until none is left without a fit. A round is the per-search cap; rounds go
    /// on past it only while the next in line is one you're waiting on (to pick, or saved): roles
    /// set aside get the one round. Stops at Claude's usage limit. Returns (scored, still unscored).
    pub fn rescore_through(&self, ids: &[String], mut each: impl FnMut(usize)) -> (usize, Vec<String>) {
        let unscored = |a: &Self, id: &String| a.db().job(id).ok().flatten().filter(|j| j.score.is_none());
        let mut left: Vec<String> = ids.iter().filter(|i| unscored(self, i).is_some()).cloned().collect();
        let mut scored = 0;
        while !left.is_empty() && self.limited().is_none() && !self.cv_update_stopped() {
            let n = self.rescore_jobs(&left).unwrap_or(0);
            scored += n;
            each(scored);
            left.retain(|i| unscored(self, i).is_some());
            let waiting = left.first().and_then(|i| unscored(self, i)).is_some_and(|j| j.status == "queued" || j.status == "saved");
            if n == 0 || !waiting {
                break;
            }
        }
        (scored, left)
    }

    /// You pressed Stop on the update after a new CV (or took the CV away, or gave it another file):
    /// it finishes the request it's on and starts nothing more.
    pub fn cv_update_stopped(&self) -> bool {
        self.secret("cv.stop") == "1" && self.is_running("cv-update")
    }

    /// Stop the update that's running, if one is; `forget` also takes its card off the CVs page.
    /// What it already did stays done. Fits it hadn't reached stay "Not scored" (Score it anyway
    /// on any of them, or update the CV again).
    pub fn stop_cv_update(&self, forget: bool) {
        if self.is_running("cv-update") {
            let _ = self.db().set("cv.stop", "1");
        }
        // Nothing held for later on its account either.
        let held: Vec<Value> = self.deferred().into_iter().filter(|w| w["kind"] != "cv").collect();
        let _ = if held.is_empty() { self.db().delete("deferred") } else { self.db().set("deferred", &Value::Array(held).to_string()) };
        if forget {
            let _ = self.db().delete("cv.update");
        } else if let Ok(mut v) = serde_json::from_str::<Value>(&self.secret("cv.update")) {
            v["running"] = json!(false);
            v["cancelled"] = json!(true);
            v["finished"] = json!(now());
            let _ = self.db().set("cv.update", &v.to_string());
        }
    }

    /// How far the update after a new CV has got (see refresh_after_cv), for the CVs page.
    pub fn cv_update(&self) -> Option<Value> {
        let mut v: Value = serde_json::from_str(&self.secret("cv.update")).ok()?;
        // The CV it was for is gone: nothing to show.
        if !self.profile().tracks.iter().any(|t| v["cv"] == t.label.as_str()) {
            return None;
        }
        // Job Hunt was closed part-way: not running any more, whatever was written down.
        if v["running"] == true && !self.is_running("cv-update") {
            v["running"] = json!(false);
            v["stopped"] = json!(true);
        }
        // Still winding down after Stop: said, so the card doesn't offer Stop again.
        if v["cancelled"] == true && self.is_running("cv-update") {
            v["stopping"] = json!(true);
        }
        // The applications being tailored again go on after the rest is done: counted as they are now
        // (one has its fit again once it's tailored).
        let ids: Vec<String> = serde_json::from_value(v["retailor"].clone()).unwrap_or_default();
        if !ids.is_empty() {
            let done = ids.iter().filter(|id| !self.is_running(&format!("tailor:{id}")) && self.db().job(id).ok().flatten().is_none_or(|j| j.score.is_some() || j.status != "ready")).count();
            v["tailored"] = json!(done);
            v["tailoring"] = json!(ids.iter().any(|id| self.is_running(&format!("tailor:{id}"))));
        }
        Some(v)
    }

    /// What a change of CVs has left to redo, read from the jobs themselves and not from a list kept
    /// at the time: roles waiting for you with no fit because their CV changed or went, applications
    /// waiting for approval that lost their fit (to tailor again), and approved ones not yet sent.
    /// A list was lost whenever its work couldn't be done there and then (the CV it was to use was
    /// removed in turn, Job Hunt was closed, Claude was at its limit), and those jobs stayed without
    /// a fit, and those applications stale, for good. This is always true to what's there.
    pub fn cv_work_pending(&self) -> CvChange {
        let mut c = CvChange::default();
        let jobs = |st: &str| self.db().jobs(Some(st), 100_000).unwrap_or_default();
        for st in ["queued", "saved"] {
            c.unscored.extend(jobs(st).into_iter().filter(|j| j.score.is_none() && j.reasoning.as_deref().is_some_and(|r| r.starts_with("Not scored: "))).map(|j| j.id));
        }
        c.retailor = jobs("ready").into_iter().filter(|j| j.score.is_none()).map(|j| j.id).collect();
        c.approved = jobs("approved").into_iter().filter(|j| j.score.is_none() && j.applied_at.is_none()).map(|j| j.id).collect();
        c
    }

    /// Do what a change of CVs left to redo (see cv_work_pending), if there is any and a CV to do
    /// it with: the same update a new file for a CV starts, with its card on the CVs page. Called
    /// when a CV is added or removed, and every so often by itself, so nothing stays undone.
    pub fn resume_cv_work(self: &Arc<Self>) -> CvChange {
        if self.cv_texts(&self.profile()).is_empty() {
            return CvChange::default();
        }
        let c = self.cv_work_pending();
        if !(c.unscored.is_empty() && c.retailor.is_empty() && c.approved.is_empty()) {
            self.refresh_after_cv("", c.clone());
        }
        c
    }

    /// Your CV `id` has a new file: everything worked out from the old one is redone, in the
    /// background, in this order. (1) Claude reads the new CV for job titles and keywords the old
    /// one didn't suggest (added to yours, never taken away) and the experience in it. (2) Fits
    /// against the old CV are scored again: all of the roles waiting for you, a round of the ones
    /// set aside. (3) Applications waiting for your approval are tailored again. (4) Your career
    /// paths, and the coach's advice if you have any, are written again. (5) Open leads are read
    /// against it again. How far it is: cv_update. Not redone, on purpose: what you approved or sent
    /// (offered for the approved ones), and what you typed yourself (titles, facts, saved answers).
    pub fn refresh_after_cv(self: &Arc<Self>, id: &str, c: CvChange) {
        // No one CV (work a removed CV left, picked up again): the card is headed by the first you have.
        let tracks = self.profile().tracks;
        let label = tracks.iter().find(|t| t.name == id).or(tracks.first()).map(|t| t.label.clone()).unwrap_or_else(|| id.to_string());
        let claude = self.claude_ready();
        let start = json!({ "at": now(), "cv": label, "running": true, "step": "titles", "claude": claude,
            "to_score": c.unscored.len(), "scored": 0, "to_tailor": c.retailor.len(), "kept": c.kept, "approved": c.approved.len(), "approved_done": 0, "retailor": c.retailor });
        // One at a time: an update already running (for an earlier file) is told to stop, and this
        // one starts when it has.
        let waiting = self.is_running("cv-update");
        if waiting {
            let _ = self.db().set("cv.stop", "1");
        }
        let _ = self.db().set("cv.update", &start.to_string());
        let (a, id) = (self.clone(), id.to_string());
        std::thread::spawn(move || {
            let mut tries = 0;
            let _g = loop {
                match a.claim("cv-update") {
                    Ok(g) => break g,
                    Err(_) if tries < 1200 => { tries += 1; std::thread::sleep(std::time::Duration::from_millis(500)); }
                    Err(_) => return,
                }
            };
            let _ = a.db().delete("cv.stop");
            if waiting {
                let _ = a.db().set("cv.update", &start.to_string());
            }
            let state = std::cell::RefCell::new(start);
            // Stopped by you: nothing more is written over what Stop left, and no step starts.
            let stopped = || a.cv_update_stopped();
            let put = |patch: Value| {
                if stopped() {
                    return;
                }
                let mut s = state.borrow_mut();
                for (k, v) in patch.as_object().into_iter().flatten() {
                    s[k.as_str()] = v.clone();
                }
                let _ = a.db().set("cv.update", &s.to_string());
            };
            // (1) Titles and keywords the new CV suggests.
            if claude && !stopped() && !id.is_empty() {
                let had = |a: &Agent| a.profile().tracks.iter().find(|t| t.name == id).map(|t| (t.titles.clone(), t.keywords.len())).unwrap_or_default();
                let (titles, keywords) = had(&a);
                match a.suggest_for_cv(&id) {
                    Ok(t) => put(json!({ "titles_added": t.titles.iter().filter(|x| !titles.contains(x)).collect::<Vec<_>>(), "keywords_added": t.keywords.len().saturating_sub(keywords) })),
                    Err(e) => { let _ = a.db().log(None, "cv:error", &format!("reading the new CV for titles: {}", e.0)); }
                }
            }
            // (2) Fits.
            put(json!({ "step": "scoring" }));
            let (scored, left) = a.rescore_through(&c.unscored, |n| put(json!({ "scored": n })));
            put(json!({ "scored": scored, "unscored_left": left.len() }));
            if scored > 0 {
                a.note("Scored again", &format!("{scored} job{} now {} a fit against your new CV.", if scored == 1 { "" } else { "s" }, if scored == 1 { "has" } else { "have" }));
            }
            // Stopped by Claude's usage limit with roles you're waiting on still unscored: held, and
            // scored when the limit resets.
            if !left.is_empty() && a.limited().is_some() {
                let _ = a.defer(json!({ "kind": "cv", "ids": left }));
                put(json!({ "held": true }));
            }
            // (3) Applications waiting for your approval.
            put(json!({ "step": "tailoring" }));
            // The ones you approved and haven't sent come first and are waited for: until each is
            // done, what's there to submit is from the old CV. They stay approved.
            let (mut redone, mut held) = (0, vec![]);
            for id in &c.approved {
                if stopped() { break; }
                let Ok(_t) = a.claim(&format!("tailor:{id}")) else { continue };
                match a.tailor_anyway(id, None) {
                    Ok(_) => {
                        let _ = a.db().set_status(id, "approved", "tailored again from your new CV; still approved, to submit on the company site");
                        redone += 1;
                        put(json!({ "approved_done": redone }));
                    }
                    Err(e) => {
                        let _ = a.db().log(Some(id), "tailor:error", &e.0);
                        if e.0.contains("usage limit") { held.push(id.clone()) }
                    }
                }
            }
            if redone < c.approved.len() {
                put(json!({ "approved_failed": c.approved.len() - redone }));
            }
            if stopped() {
                let _ = a.db().delete("cv.stop");
                return;
            }
            if !held.is_empty() {
                let _ = a.defer(json!({ "kind": "tailor", "ids": held }));
            }
            if !c.retailor.is_empty() {
                let _ = a.tailor_picked(&c.retailor);
            }
            // (4) Career paths and the coach.
            put(json!({ "step": "career" }));
            if claude && a.limited().is_none() && !stopped() {
                if let Ok(_c) = a.claim("career") {
                    match a.write_career_paths() {
                        Ok(_) => put(json!({ "career": true })),
                        Err(e) => { let _ = a.db().log(None, "career:error", &e.0); }
                    }
                }
                if !a.secret("coach").is_empty() {
                    if let Ok(_c) = a.claim("coach") {
                        if a.write_coach().is_ok() {
                            put(json!({ "coach": true }));
                        }
                    }
                }
            }
            // (5) Leads you haven't written to yet: read against the new CV.
            put(json!({ "step": "leads" }));
            if claude && a.limited().is_none() && !stopped() {
                match crate::leads::read_again(&a) {
                    Ok(n) => put(json!({ "leads": n })),
                    Err(e) => { let _ = a.db().log(None, "leads:error", &e.0); }
                }
            }
            if stopped() {
                let _ = a.db().delete("cv.stop");
                return;
            }
            put(json!({ "step": "done", "running": false, "finished": now() }));
            a.note("Job Hunt is up to date with your new CV", &format!("The {label} CV: fits scored again, applications waiting for you tailored again, and your career paths rewritten. See Me, CVs."));
        });
    }

    /// Once (2.62.0): updating a CV in 2.60 and 2.61 cleared the fit of every role it had scored,
    /// set-aside ones too, and scored only a few of those again. The ones still without a fit get
    /// back the one they had (it's in their history), so the lists and filters read as before.
    pub fn restore_cleared_fits_once(&self) {
        if !self.secret("cv.fits_restored").is_empty() {
            return;
        }
        let mut n = 0;
        for st in ["skipped", "dismissed"] {
            let jobs = self.db().jobs(Some(st), 100_000).unwrap_or_default();
            for j in jobs.into_iter().filter(|j| j.score.is_none() && j.reasoning.as_deref().is_some_and(|r| r.starts_with("Not scored: "))) {
                let was = self.db().history(&j.id).ok().and_then(|h| h.into_iter().find(|e| e.kind == "unscored"))
                    .and_then(|e| e.detail.strip_prefix("its fit of ").and_then(|d| d.split_whitespace().next().and_then(|x| x.parse::<i64>().ok())));
                if let Some(score) = was {
                    let db = self.db();
                    if db.update_job(&j.id, &[("score", score.into()), ("reasoning", format!("Fit of {score}, from before you updated your CV (roles set aside aren't scored again).").into())]).is_ok() {
                        let _ = db.log(Some(&j.id), "scored", &format!("{score}: the fit it had before your CV was updated, put back"));
                        n += 1;
                    }
                }
            }
        }
        let _ = self.db().set("cv.fits_restored", &format!("{n}|{}", now()));
    }

    /// A CV was added: what a removed CV left waiting (your only one, so nothing to redo it with)
    /// is scored and tailored now, from the new one. Returns what was started.
    pub fn after_cv_added(self: &Arc<Self>) -> CvChange {
        // (The list kept under cv.waiting is no longer what decides: the jobs themselves are read.)
        let _ = self.db().delete("cv.waiting");
        self.resume_cv_work()
    }

    /// Score these jobs against your CVs as they are now, up to the per-search cap (the rest can
    /// be scored with Score it anyway). A job found by a search goes on the Overview or is set
    /// aside by its new fit; one you saved or chose stays where it is. Returns how many were scored.
    pub fn rescore_jobs(&self, ids: &[String]) -> R<usize> {
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() || ids.is_empty() {
            return Ok(0);
        }
        let _g = self.claim("rescore")?;
        let guidance = self.scoring_guidance(&profile);
        let mut n = 0;
        for id in ids.iter().take(profile.max_scored_per_run.max(1)) {
            let Some(j) = self.db().job(id)? else { continue };
            if j.score.is_some() || self.limited().is_some() || self.cv_update_stopped() {
                continue;
            }
            let s = match self.llm().score(&cvs, &guidance, &j) {
                Ok(s) => s,
                Err(e) if e.0.contains("usage limit") || e.0.contains("signed in") || e.0.contains("API key") => break,
                Err(_) => continue,
            };
            let keep = j.status == "saved" || j.status == "dismissed" || self.chosen(id);
            let status = if keep { j.status.clone() } else if s.score >= profile.score_threshold { "queued".into() } else { "skipped".into() };
            // A known salary below your minimum stays flagged.
            let mut flags = s.red_flags.clone();
            if let Some(f) = below_minimum(&profile, j.salary.as_deref().and_then(crate::sources::salary_max_of)) {
                flags.insert(0, f);
            }
            {
                let db = self.db();
                db.update_job(id, &[
                    ("status", status.into()), ("score", s.score.into()), ("score_potential", json!(s.potential)), ("track", s.track.clone().into()),
                    ("reasoning", s.reasoning.clone().into()), ("red_flags", json!(flags)), ("keywords", json!(s.keywords)),
                ])?;
                db.log(Some(id), "scored", &format!("{} on the {} track (your CVs changed)", s.score, s.track))?;
            }
            let _ = self.found_salary(id, &s.salary, "in the posting");
            n += 1;
        }
        Ok(n)
    }

    /// Ask Claude again for this CV's titles and keywords.
    pub fn suggest_for_cv(&self, id: &str) -> R<Track> {
        let doc = cv::open(&self.cv_path(id))?;
        let s = self.llm().cv_profile(&doc.plain_text())?;
        let mut profile = self.profile();
        let Some(t) = profile.tracks.iter_mut().find(|t| t.name == id) else { return err("That CV no longer exists.") };
        // New ideas are added to yours: titles you typed or kept stay.
        for x in s.titles {
            if !t.titles.iter().any(|y| y.eq_ignore_ascii_case(&x)) {
                t.titles.push(x);
            }
        }
        for x in s.keywords {
            if !t.keywords.iter().any(|y| y.eq_ignore_ascii_case(&x)) {
                t.keywords.push(x);
            }
        }
        t.areas = s.areas;
        let t = t.clone();
        self.save_profile(&profile)?;
        Ok(t)
    }

    // --- tailoring ------------------------------------------------------------------------------

    pub fn application_dir(&self, job: &Job) -> PathBuf {
        self.files().join("applications").join(format!("{}-{}", slug(&format!("{} {}", job.company, job.title), 60), short_hash(&job.id)))
    }

    /// "Ibrahim Al-Taha - Acme.docx" and "Ibrahim Al-Taha - Acme - Cover Letter.docx": what an
    /// employer sees when they download them.
    pub(super) fn file_names(&self, job: &Job) -> (String, String) {
        let name = crate::util::file_words(&self.profile().name);
        let company = crate::util::file_words(&job.company);
        let base = match (name.is_empty(), company.is_empty()) {
            (false, false) => format!("{name} - {company}"),
            (false, true) => name,
            (true, false) => format!("CV - {company}"),
            (true, true) => "CV".into(),
        };
        (format!("{base}.docx"), format!("{base} - Cover Letter.docx"))
    }

    pub fn tailor(&self, job_id: &str, track: Option<&str>) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let profile = self.profile();
        let t = profile.track(track.or(job.track.as_deref())).cloned().ok_or_else(|| Error("No CV uploaded yet. Add one in CV & Career.".into()))?;
        let doc = cv::open(&self.cv_path(&t.name)).map_err(|_| Error(format!("No CV for the “{}” track yet. Upload it in CV & Career.", t.label)))?;
        // Applied to this company before: the CV they already have, and how close to stay to it.
        let prior = self.sent_before(&job);
        let mode = self.repeat_mode();
        let prior_doc = prior.as_ref().filter(|_| mode != "usual").and_then(|p| p.cv_path.as_deref()).and_then(|p| cv::open(Path::new(p)).ok());
        let consistency = match (&prior, &prior_doc) {
            (Some(p), Some(d)) => format!("Sent to {} on {} for \"{}\". Change at most {MAX_REPEAT_EDITS} paragraphs. That CV:\n{}",
                job.company, p.applied_at.as_deref().unwrap_or("").get(..10).unwrap_or(""), p.title, d.plain_text().chars().take(8000).collect::<String>()),
            _ => String::new(),
        };
        let mut result = self.llm().tailor(&profile.name, &doc.numbered(), &job, &job.keywords, &profile.stories, &t.letter_style, &consistency, &self.tailoring_guidance(&job))?;
        // Held to it, whatever came back: the headline as they saw it, and only the few edits that add most.
        if let Some(pd) = prior_doc.as_ref().filter(|_| mode == "light") {
            let headline = headline_indices(&doc);
            result.edits.retain(|e| !headline.contains(&e.index));
            result.edits.sort_by_key(|e| std::cmp::Reverse(e.keywords_added.len()));
            result.edits.truncate(MAX_REPEAT_EDITS);
            // The same document (same paragraphs): their headline goes back in, word for word.
            if pd.paras.len() == doc.paras.len() {
                for i in headline {
                    let (theirs, ours) = (pd.paras[i].plain(), doc.paras[i].plain());
                    if theirs.trim() != ours.trim() && !theirs.trim().is_empty() {
                        result.edits.push(crate::claude::ParagraphEdit { index: i, text: theirs, keywords_added: vec![] });
                    }
                }
            }
        }
        // Take out AI tells Claude slipped in (your CV's own style stays).
        let own = format!("{}\n{}", doc.plain_text(), profile.stories);
        result.cover_letter = cv::humanize(&result.cover_letter, &own);
        result.email_subject = cv::humanize(&result.email_subject, &own);

        let edits: BTreeMap<usize, String> = result.edits.iter().map(|e| (e.index, cv::humanize(&e.text, &own))).collect();
        let mut applied = cv::apply_edits(&doc, &edits)?;
        // Same CV as before: exactly the file that company has, with a new cover letter.
        if let (Some(p), true) = (&prior, mode == "same") {
            if let Some(bytes) = p.cv_path.as_deref().and_then(|x| std::fs::read(x).ok()) {
                applied.bytes = bytes;
                applied.changes = p.cv_changes.clone();
            }
        }
        let dir = self.application_dir(&job);
        std::fs::create_dir_all(&dir)?;
        let (cv_name, letter_name) = self.file_names(&job);
        let (cv_path, letter_path) = (dir.join(cv_name), dir.join(letter_name));
        // Web links that note when they're opened, when Job Hunt has a public address.
        std::fs::write(&cv_path, crate::links::track(self, job_id, &job.company, applied.bytes.clone()))?;
        std::fs::write(&letter_path, crate::links::track(self, job_id, &job.company, cv::cover_letter(&doc, &result.cover_letter, self.signature().as_deref())?))?;
        // Old PDF copies would show the previous version; new ones are made when you open them
        // (making them here took Word a while for every application).
        for p in [&cv_path, &letter_path] {
            let _ = std::fs::remove_file(p.with_extension("pdf"));
        }

        let tailored_text = cv::from_bytes(applied.bytes)?.plain_text();
        let (before, _) = cv::keyword_coverage(&doc.plain_text(), &job.keywords);
        let (after, missing) = cv::keyword_coverage(&tailored_text, &job.keywords);

        let mut gaps: Vec<String> = result.keyword_gaps.iter().chain(missing.iter()).cloned().collect();
        gaps.sort_by_key(|g| g.to_lowercase());
        gaps.dedup_by_key(|g| g.to_lowercase());

        let db = self.db();
        db.update_job(job_id, &[
            ("status", "ready".into()),
            ("track", t.name.clone().into()),
            ("cv_path", cv_path.to_string_lossy().to_string().into()),
            ("letter_path", letter_path.to_string_lossy().to_string().into()),
            ("cover_letter", result.cover_letter.clone().into()),
            ("email_subject", result.email_subject.clone().into()),
            ("coverage_before", before.into()),
            ("coverage_after", after.into()),
            ("keyword_gaps", json!(gaps)),
            ("cv_changes", json!(applied.changes)),
            ("score_after", Value::Null),
        ])?;
        let mut detail = format!("{} CV edits, keywords {:.0}% → {:.0}%", applied.changes.len(), before * 100.0, after * 100.0);
        if !applied.rejected.is_empty() {
            detail.push_str(&format!("; refused: {}", applied.rejected.join("; ")));
        }
        db.log(Some(job_id), "tailored", &detail)?;
        if let Some(p) = &prior {
            db.log(Some(job_id), "tailored", &match mode.as_str() {
                "same" => format!("the same CV as you sent {} for {}", job.company, p.title),
                "light" => format!("kept close to the CV you sent {} for {}: the same headline, at most {MAX_REPEAT_EDITS} paragraphs changed", job.company, p.title),
                _ => format!("tailored as usual, though you applied to {} before", job.company),
            })?;
        }
        drop(db);
        // The tailored CV scored the same way your CV was (one more request), once the
        // application is already waiting for you; on failure the page shows the score before.
        // Two scorings of the same experience differ by a few points by chance, so the scorer is told
        // the fit before, and a fit a little lower than it is taken as that chance, not a worse CV.
        let mut guidance = self.scoring_guidance(&profile);
        if let Some(a) = job.score {
            guidance.push_str(&format!("\n\nThis CV is the candidate's own, reworded for this posting. Before the rewording you scored it {a} for this same posting. Use the same scale: score it lower than {a} only if the rewording lost or hid something the posting asks for."));
        }
        if let Ok(s) = self.llm().score(&[(t.name.clone(), tailored_text)], &guidance, &job) {
            let after = match job.score {
                Some(a) if s.score < a && a - s.score <= RESCORE_NOISE => a,
                _ => s.score,
            };
            let db = self.db();
            db.update_job(job_id, &[("score_after", after.into())])?;
            if let Some(a) = job.score {
                db.log(Some(job_id), "rescored", &format!("fit {a} before tailoring, {after} after{}", if after != s.score { format!(" (scored {}: within the few points two scorings differ by)", s.score) } else { String::new() }))?;
            }
        }
        // An employer whose system checks CVs criterion by criterion: check this one the same way.
        self.review_after_tailoring(&job);
        self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Your applications to a company: every job there you sent a CV to (applied, or further), newest
    /// first, other than `except`.
    pub fn company_history(&self, company: &str, except: &str) -> Vec<Job> {
        let key = crate::db::company_key(company);
        if key.is_empty() {
            return vec![];
        }
        let mut out: Vec<Job> = SENT.iter().flat_map(|s| self.db().jobs(Some(s), 2000).unwrap_or_default())
            .filter(|j| j.id != except && crate::db::company_key(&j.company) == key).collect();
        out.sort_by(|a, b| b.applied_at.cmp(&a.applied_at));
        out
    }

    /// The last CV you sent this job's company (another job there, with its file still on disk).
    pub fn sent_before(&self, job: &Job) -> Option<Job> {
        self.company_history(&job.company, &job.id).into_iter().find(|j| j.cv_path.as_deref().is_some_and(|p| Path::new(p).is_file()))
    }

    /// How a company you've applied to before is tailored for: "light" (the same headline, a few
    /// paragraphs changed: the default), "same" (the CV you sent them) or "usual".
    pub fn repeat_mode(&self) -> String {
        match self.secret("tailor.repeat").as_str() {
            "same" => "same".into(),
            "usual" => "usual".into(),
            _ => "light".into(),
        }
    }

    /// Your own notes on a company ("the recruiter said to wait six months").
    pub fn company_notes(&self, company: &str) -> String {
        self.secret(&format!("company.notes:{}", crate::db::company_key(company)))
    }

    pub fn save_company_notes(&self, company: &str, notes: &str) -> R<()> {
        let key = crate::db::company_key(company);
        if key.is_empty() {
            return err("Which company?");
        }
        self.db().set(&format!("company.notes:{key}"), notes.trim())
    }

    /// This job's tailored CV beside the one you last sent its company: which paragraphs differ.
    /// {job: {id, title, status, applied_at}, changes: [{before, after}]}, or None (no CV sent
    /// there before, or not tailored yet).
    pub fn compare_with_sent(&self, job: &Job) -> Option<Value> {
        let prior = self.sent_before(job)?;
        let ours = cv::open(Path::new(job.cv_path.as_deref()?)).ok()?.plain_text();
        let theirs = cv::open(Path::new(prior.cv_path.as_deref()?)).ok()?.plain_text();
        let changes: Vec<Value> = paragraph_changes(&theirs, &ours).into_iter().map(|(b, a)| json!({ "before": b, "after": a })).collect();
        Some(json!({ "job": { "id": prior.id, "title": prior.title, "status": prior.status, "applied_at": prior.applied_at }, "changes": changes }))
    }

    /// Use exactly the CV you last sent this job's company (Put back as it was undoes it).
    pub fn reuse_sent_cv(&self, job_id: &str) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        let prior = self.sent_before(&job).ok_or_else(|| Error(format!("No CV sent to {} before.", job.company)))?;
        let path = job.cv_path.clone().ok_or_else(|| Error("Tailor this application first.".into()))?;
        let bytes = std::fs::read(prior.cv_path.as_deref().unwrap_or(""))?;
        let backup = Path::new(&path).with_extension("before-revision.docx");
        std::fs::copy(&path, &backup)?;
        std::fs::write(&path, &bytes)?;
        let _ = std::fs::remove_file(Path::new(&path).with_extension("pdf"));
        let db = self.db();
        db.set(&format!("undo:{job_id}:cv"), &json!({ "file": backup, "cv_changes": job.cv_changes, "coverage_after": job.coverage_after, "keyword_gaps": job.keyword_gaps }).to_string())?;
        db.update_job(job_id, &[("cv_changes", json!(prior.cv_changes))])?;
        db.log(Some(job_id), "revised", &format!("CV: the same one you sent {} for {}", job.company, prior.title))?;
        db.job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))
    }

    /// Take roles you haven't acted on yet (waiting to tailor, or ready to approve) out of your
    /// lists when they're outside your locations, e.g. after you change them. Returns how many.
    pub fn drop_outside_locations(&self) -> R<usize> {
        let profile = self.profile();
        let mut jobs = self.db().jobs(Some("queued"), 5000)?;
        jobs.extend(self.db().jobs(Some("ready"), 5000)?);
        let mut n = 0;
        for j in jobs {
            if self.chosen(&j.id) {
                continue; // you picked it yourself
            }
            let p = Posting { location: j.location.clone(), remote: j.location.to_lowercase().contains("remote"), ..Posting::default() };
            if let Some(why) = crate::filters::outside_locations(&p, &profile) {
                let db = self.db();
                db.update_job(&j.id, &[("status", "skipped".into()), ("reasoning", format!("Filtered out: {why}").into())])?;
                db.log(Some(&j.id), "skipped", &format!("outside your locations: {why}"))?;
                n += 1;
            }
        }
        Ok(n)
    }

    /// Where each application is: the steps it has reached with their dates, how long since the
    /// last one, and what happens next and who it's waiting on. `only` limits it to one job.
    pub fn tracker(&self, only: Option<&str>) -> R<Vec<Value>> {
        const TRACKED: [&str; 8] = ["ready", "approved", "applied", "interviewing", "offer", "rejected", "no_response", "saved"];
        let profile = self.profile();
        let jobs: Vec<Job> = match only {
            Some(id) => self.db().job(id)?.into_iter().collect(),
            None => {
                let mut v = vec![];
                for s in TRACKED {
                    v.extend(self.db().jobs(Some(s), 2000)?);
                }
                v
            }
        };
        let emails = self.db().job_emails()?;
        let interviews = self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 500)?;
        let due: HashSet<String> = self.follow_ups_due().unwrap_or_default().into_iter().map(|j| j.id).collect();
        let now = Utc::now();
        let days_since = |iso: &str| chrono::DateTime::parse_from_rfc3339(iso).ok().map(|t| (now - t.with_timezone(&Utc)).num_days());
        let mut out = vec![];
        for j in jobs {
            let history = self.db().history(&j.id)?; // newest first
            let first = |pred: &dyn Fn(&crate::db::Event) -> bool| history.iter().rev().find(|e| pred(e)).map(|e| e.created_at.clone());
            let reached = |st: &str| first(&|e| e.kind == format!("status:{st}"));
            let tailored = first(&|e| e.kind == "tailored");
            let applied = j.applied_at.clone().or_else(|| reached("applied"));
            let reply = emails.iter().find(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str())).map(|e| e.3.clone())
                .or_else(|| reached("interviewing")).or_else(|| reached("rejected")).or_else(|| reached("offer"));
            let interview = reached("interviewing");
            let outcome = reached("offer").map(|d| ("Offer", d)).or_else(|| reached("rejected").map(|d| ("Rejected", d)));
            let steps = json!([
                { "step": "Found", "at": j.found_at },
                { "step": "Tailored", "at": tailored },
                { "step": "Applied", "at": applied },
                { "step": "Reply", "at": reply },
                { "step": "Interview", "at": interview },
                { "step": outcome.as_ref().map(|o| o.0).unwrap_or("Offer"), "at": outcome.as_ref().map(|o| o.1.clone()), "bad": outcome.as_ref().is_some_and(|o| o.0 == "Rejected") },
            ]);
            // The latest step, and the latest thing that happened at all.
            let last_step = steps.as_array().unwrap().iter().rev().find(|s| s["at"].is_string()).map(|s| (s["step"].as_str().unwrap_or("").to_string(), s["at"].as_str().unwrap_or("").to_string()));
            let next_interview = interviews.iter().find(|i| i.job_id.as_deref() == Some(&j.id)).map(|i| i.start.clone());
            let wait = days_since(applied.as_deref().unwrap_or("")).unwrap_or(0);
            let (next, who) = match j.status.as_str() {
                "ready" => ("Check and approve the tailored CV and letter".to_string(), "you"),
                "approved" => ("Submit it on the company's site, then mark it applied".to_string(), "you"),
                "applied" if due.contains(&j.id) => (format!("No reply in {wait} days: send a follow-up"), "you"),
                "applied" if self.follow_up(&j.id).is_some() => ("Waiting for a reply (you followed up)".to_string(), "them"),
                "applied" => {
                    let left = profile.follow_up_after as i64 - wait;
                    (if profile.follow_up_after > 0 && left > 0 { format!("Waiting for a reply; follow up in {left} day{}", if left == 1 { "" } else { "s" }) } else { "Waiting for a reply".to_string() }, "them")
                }
                "interviewing" => match &next_interview {
                    Some(_) => ("Interview".to_string(), "you"), // the screen adds the date
                    None => ("Waiting to hear back after the interview".to_string(), "them"),
                },
                "offer" => ("Weigh the offer and reply".to_string(), "you"),
                "rejected" => ("Closed".to_string(), "done"),
                "no_response" => ("Closed: no reply".to_string(), "done"),
                "saved" => ("Saved for later".to_string(), "later"),
                _ => (String::new(), "done"),
            };
            out.push(json!({
                "id": j.id, "title": j.title, "company": j.company, "location": j.location, "status": j.status,
                "score": j.score, "score_after": j.score_after, "score_potential": j.score_potential, "deadline": j.deadline, "closed_at": j.closed_at, "url": j.url,
                "apply_email": j.apply_email,
                "steps": steps,
                "last_step": last_step.as_ref().map(|l| l.0.clone()),
                "last_at": last_step.as_ref().map(|l| l.1.clone()),
                "days_since": last_step.as_ref().and_then(|l| days_since(&l.1)),
                "next": next, "who": who, "next_interview": next_interview,
                "follow_up_due": due.contains(&j.id),
            }));
        }
        Ok(out)
    }

    /// The morning summary, once a day after the daily search: what's waiting for you today. Says
    /// nothing when nothing is.
    pub fn morning_digest(&self) -> R<Option<String>> {
        let _ = self.db().set("last.digest", &now());
        let c = self.db().counts()?;
        let n = |k: &str| c.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
        let tomorrow_end = Utc::now() + Duration::hours(36);
        // Bound first: the time zone comes from your profile, which needs the database too.
        let (tz, upcoming) = (self.profile().tz(), self.db().upcoming_interviews(&Utc::now().to_rfc3339(), 10)?);
        let interviews: Vec<String> = upcoming.into_iter()
            .filter(|i| chrono::DateTime::parse_from_rfc3339(&i.start).is_ok_and(|t| t.with_timezone(&Utc) < tomorrow_end))
            .map(|i| format!("{} {}", i.company.unwrap_or_else(|| i.title.clone()), chrono::DateTime::parse_from_rfc3339(&i.start).map(|t| t.with_timezone(&tz).format("%a %-I:%M %p").to_string()).unwrap_or_default()))
            .collect();
        let plural = |k: i64, one: &str, many: &str| format!("{k} {}", if k == 1 { one } else { many });
        let mut parts = vec![];
        if !interviews.is_empty() {
            parts.push(format!("Interview{}: {}", if interviews.len() == 1 { "" } else { "s" }, interviews.join(", ")));
        }
        if n("ready") > 0 {
            parts.push(plural(n("ready"), "application to review", "applications to review"));
        }
        if n("queued") > 0 {
            parts.push(plural(n("queued"), "new role to pick from", "new roles to pick from"));
        }
        if n("approved") > 0 {
            parts.push(plural(n("approved"), "to submit on the company's site", "to submit on company sites"));
        }
        let follow = self.follow_ups_due()?.len() as i64;
        if follow > 0 {
            parts.push(plural(follow, "follow-up due", "follow-ups due"));
        }
        let closing = self.closing_soon(3)?.len() as i64;
        if closing > 0 {
            parts.push(plural(closing, "posting closes in 3 days", "postings close in 3 days"));
        }
        if parts.is_empty() {
            return Ok(None);
        }
        let text = parts.join(" · ");
        self.note("Today in Job Hunt", &text);
        Ok(Some(text))
    }

    /// Applications that went quiet: applied 4+ weeks ago with no reply, and either followed up
    /// already, with follow-ups off, or 6+ weeks old. Worth closing as No response.
    pub fn quiet_applications(&self) -> R<Vec<Job>> {
        let profile = self.profile();
        let emails = self.db().job_emails()?;
        let applied = self.db().jobs(Some("applied"), 5000)?;
        let now = Utc::now();
        let mut out = vec![];
        for j in applied {
            let Some(at) = j.applied_at.as_deref().and_then(|a| chrono::DateTime::parse_from_rfc3339(a).ok()) else { continue };
            let age = (now - at.with_timezone(&Utc)).num_days();
            let heard = emails.iter().any(|(id, cat, _, _)| *id == j.id && !["application_received", "job_alert", "not_job"].contains(&cat.as_str()));
            if age >= 28 && !heard && (self.follow_up(&j.id).is_some() || profile.follow_up_after == 0 || age >= 42) {
                out.push(j);
            }
        }
        Ok(out)
    }

    /// Your own writing for a job (the CV it's tailored from, and your stories), so humanize leaves
    /// alone the style you chose yourself.
    pub(crate) fn own_words(&self, job: &Job, profile: &Profile) -> String {
        let cv = profile.track(job.track.as_deref()).and_then(|t| cv::open(&self.cv_path(&t.name)).ok()).map(|d| d.plain_text()).unwrap_or_default();
        format!("{cv}\n{}", profile.stories)
    }

    /// Whether you picked this posting yourself (Tailor anyway): filters then leave it alone.
    pub(super) fn chosen(&self, job_id: &str) -> bool {
        self.db().history(job_id).map(|h| h.iter().any(|e| e.kind == "chosen")).unwrap_or(false)
    }

    /// Tailor a posting whatever its score, location or stage: one you skipped, saved, said no to
    /// or that the filters left out. It's scored first if it never was (to pick your CV and the
    /// keywords), and kept from then on, whatever the filters say.
    pub fn tailor_anyway(&self, job_id: &str, track: Option<&str>) -> R<Job> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if ["skipped", "dismissed", "saved", "queued"].contains(&job.status.as_str()) && !self.chosen(job_id) {
            self.db().log(Some(job_id), "chosen", "you chose to tailor it")?;
        }
        if job.score.is_none() {
            let profile = self.profile();
            let cvs = self.cv_texts(&profile);
            if cvs.is_empty() {
                return err("No CV uploaded yet. Add one in CV & Career.");
            }
            let s = self.llm().score(&cvs, &self.scoring_guidance(&profile), &job)?;
            let db = self.db();
            db.update_job(job_id, &[
                ("score", s.score.into()), ("score_potential", json!(s.potential)), ("track", s.track.clone().into()), ("reasoning", s.reasoning.into()),
                ("red_flags", json!(s.red_flags)), ("keywords", json!(s.keywords)),
            ])?;
            db.log(Some(job_id), "scored", &format!("{} on the {} track (before tailoring it anyway)", s.score, s.track))?;
        }
        self.tailor(job_id, track)
    }

    /// The postings a rescore would look at again: "skipped" (filtered out or scored low) or
    /// "waiting" (cleared the bar, not tailored yet). Never anything you've acted on.
    pub(super) fn rescore_pool(&self, group: &str) -> R<Vec<Job>> {
        let status = match group {
            "waiting" => "queued",
            "skipped" => "skipped",
            _ => return err("Choose which postings to score again."),
        };
        let mut jobs = self.db().jobs(Some(status), 100_000)?;
        jobs.retain(|j| j.closed_at.is_none());
        jobs.sort_by(|a, b| b.found_at.cmp(&a.found_at)); // newest first
        Ok(jobs)
    }

    /// How a rescore would go, without running it: postings in the group, how many the filters
    /// now leave out (no Claude needed), how many Claude would score, and this run's cap.
    pub fn rescore_plan(&self, group: &str) -> R<Value> {
        let profile = self.profile();
        let pool = self.rescore_pool(group)?;
        let need = pool.iter().filter(|j| prefilter(&posting_of(j), &profile).is_none()).count();
        let cap = profile.max_scored_per_run.max(1);
        Ok(json!({ "postings": pool.len(), "filtered": pool.len() - need, "to_score": need, "this_run": need.min(cap), "cap": cap }))
    }

    /// Score postings found before again, against your CVs and settings as they are now, up to
    /// the per-search cap (newest first). Returns how it went.
    pub fn rescore(&self, group: &str) -> R<Value> {
        let _g = self.claim("rescore")?;
        let profile = self.profile();
        let cvs = self.cv_texts(&profile);
        if cvs.is_empty() {
            return err("No CV uploaded yet. Add one in CV & Career.");
        }
        let guidance = self.scoring_guidance(&profile);
        let cap = profile.max_scored_per_run.max(1);
        let (mut scored, mut cleared, mut filtered, mut failed) = (0, 0, 0, 0);
        for j in self.rescore_pool(group)? {
            if let Some(why) = prefilter(&posting_of(&j), &profile) {
                if j.status != "skipped" || j.reasoning.as_deref() != Some(&format!("Filtered out: {why}")) {
                    let db = self.db();
                    db.update_job(&j.id, &[("status", "skipped".into()), ("reasoning", format!("Filtered out: {why}").into())])?;
                    db.log(Some(&j.id), "skipped", &format!("rescored: {why}"))?;
                }
                filtered += 1;
                continue;
            }
            if scored + failed >= cap {
                break;
            }
            match self.llm().score(&cvs, &guidance, &j) {
                Ok(s) => {
                    scored += 1;
                    let status = if s.score >= profile.score_threshold { "queued" } else { "skipped" };
                    cleared += (status == "queued") as usize;
                    let db = self.db();
                    db.update_job(&j.id, &[
                        ("status", status.into()), ("score", s.score.into()), ("score_potential", json!(s.potential)), ("track", s.track.clone().into()),
                        ("reasoning", s.reasoning.into()), ("red_flags", json!(s.red_flags)), ("keywords", json!(s.keywords)),
                    ])?;
                    db.log(Some(&j.id), "scored", &format!("{} on the {} track (scored again)", s.score, s.track))?;
                }
                Err(e) => {
                    failed += 1;
                    if e.0.contains("API key") || e.0.contains("usage limit") || e.0.contains("signed in") {
                        return Err(e);
                    }
                }
            }
        }
        // Those scored now are out of the group only if they cleared the bar, so count what's left
        // by what was never scored again: everything past this run's cap.
        let r = json!({ "scored": scored, "cleared": cleared, "filtered": filtered, "failed": failed });
        self.db().log(None, "rescore", &format!("{scored} scored again, {cleared} now worth tailoring, {filtered} filtered out"))?;
        Ok(r)
    }

    /// Tailor the roles you picked, one after another, in the background. Returns how many started.
    pub fn tailor_picked(self: &Arc<Self>, ids: &[String]) -> R<usize> {
        let mut picked = vec![];
        for id in ids {
            let job = self.db().job(id)?;
            if let Some(j) = job {
                if !self.is_running(&format!("tailor:{}", j.id)) {
                    picked.push(j.id);
                }
            }
        }
        if picked.is_empty() {
            return err("Pick at least one role.");
        }
        // Claimed now, so each shows as being tailored until its turn comes.
        let claimed: Vec<(String, OwnedRunning)> = picked.into_iter().filter_map(|id| self.claim_owned(&format!("tailor:{id}")).map(|g| (id, g))).collect();
        let n = claimed.len();
        // Up to three at a time: each is mostly waiting on Claude.
        let queue = Arc::new(Mutex::new(claimed));
        let done = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let workers = Arc::new(std::sync::atomic::AtomicUsize::new(n.min(3)));
        for _ in 0..n.min(3) {
            let (a, queue, done, workers) = (self.clone(), queue.clone(), done.clone(), workers.clone());
            std::thread::spawn(move || {
                use std::sync::atomic::Ordering::SeqCst;
                loop {
                    let next = queue.lock().unwrap().pop();
                    let Some((id, g)) = next else { break };
                    // Scored first if it isn't (its CV was removed, say), so it's tailored from the CV that fits.
                    match a.tailor_anyway(&id, None) {
                        Ok(_) => {
                            done.fetch_add(1, SeqCst);
                        }
                        Err(e) if e.0.contains("usage limit") => {
                            // Held, to tailor once the limit resets.
                            let _ = a.db().log(Some(&id), "tailor:error", &e.0);
                            let _ = a.defer(json!({ "kind": "tailor", "ids": [id] }));
                        }
                        Err(e) => {
                            let _ = a.db().log(Some(&id), "tailor:error", &e.0);
                            a.note("Tailoring didn't finish", &e.0);
                        }
                    }
                    drop(g);
                }
                // The last one to finish says how many are ready.
                if workers.fetch_sub(1, SeqCst) == 1 {
                    let done = done.load(SeqCst);
                    if done > 0 {
                        a.note(&format!("{done} application{} ready", if done == 1 { "" } else { "s" }), "Your CV and a cover letter are tailored. Review and approve them in Job Hunt.");
                    }
                }
            });
        }
        Ok(n)
    }

    pub(super) fn signature_path(&self, ext: &str) -> PathBuf {
        self.data.join(format!("signature.{ext}"))
    }

    /// Your signature image (PNG or JPEG), placed above your name on every cover letter.
    pub fn signature(&self) -> Option<Vec<u8>> {
        ["png", "jpeg"].iter().find_map(|e| std::fs::read(self.signature_path(e)).ok())
    }

    pub fn set_signature(&self, bytes: &[u8]) -> R<()> {
        let Some((ext, _, _)) = cv::image_info(bytes) else {
            return err("Use a PNG or JPEG picture of your signature.");
        };
        if bytes.len() > 5_000_000 {
            return err("That picture is over 5 MB. Crop it or save it smaller.");
        }
        self.remove_signature()?;
        std::fs::write(self.signature_path(ext), bytes)?;
        Ok(())
    }

    pub fn remove_signature(&self) -> R<()> {
        for e in ["png", "jpeg"] {
            let p = self.signature_path(e);
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        Ok(())
    }

    pub fn save_cover_letter(&self, job_id: &str, text: &str) -> R<()> {
        let job = self.db().job(job_id)?.ok_or_else(|| Error("That job no longer exists.".into()))?;
        if self.own_file(job_id, "letter") {
            return err("You're using your own cover letter file for this role. Edit it in Word, or switch back to Job Hunt's letter.");
        }
        {
            let db = self.db();
            db.update_job(job_id, &[("cover_letter", text.into())])?;
            // So a later change of CV doesn't tailor it again over your words.
            db.log(Some(job_id), "revised", "cover letter: edited by you")?;
        }
        if let (Some(path), Some(track)) = (&job.letter_path, &job.track) {
            if let Ok(doc) = cv::open(&self.cv_path(track)) {
                std::fs::write(path, cv::cover_letter(&doc, text, self.signature().as_deref())?)?;
                let _ = crate::util::docx_to_pdf(Path::new(path));
            }
        }
        Ok(())
    }
}
