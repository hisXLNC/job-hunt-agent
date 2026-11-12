//! What Job Hunt knows about the application systems employers use, and what follows from it: how to
//! tailor a CV for one, and what to watch for when you apply. Only Ashby so far. Everything here
//! comes from the vendor's own published help pages and product notes, not from guesswork about
//! hidden scoring; where those pages don't say, neither does this.
use crate::db::Job;
use serde_json::{json, Value};

/// The application system behind a job, when it can be told from where the job came from or where
/// its form is: "ashby".
pub fn of(job: &Job) -> Option<&'static str> {
    let at = |u: &str| u.to_lowercase().contains("ashbyhq.com");
    (job.source == "ashby" || at(&job.url) || job.apply_url.as_deref().is_some_and(at)).then_some("ashby")
}

pub fn name(ats: &str) -> &'static str {
    match ats {
        "ashby" => "Ashby",
        _ => "",
    }
}

/// How to tailor a CV for this system. Ashby's reviewers can have every CV checked against a few
/// criteria written for the role: each is marked met, not met or undecided, with the CV's own lines
/// quoted as the evidence; the reviewer then works through applications grouped by what was met.
pub fn tailoring(ats: &str) -> &'static str {
    match ats {
        "ashby" => "This employer takes applications through Ashby. Its reviewers can have each CV checked by AI against a short list of criteria written for the role, usually the posting's stated requirements: for each one the CV is marked as meeting it, not meeting it, or undecided, and the lines of the CV that show it are quoted to the reviewer, who goes through applications in batches, a few seconds each. Only the CV is read for this, not the cover letter. So:\n\
- For each requirement the posting states as required, where the CV has the evidence, say it outright in one self-contained line a reviewer could quote: the skill, tool or kind of work named the way the posting names it, in a line about work actually done. One requirement per line beats several packed into one.\n\
- A requirement that appears only in a skills list, or only as a job title, reads as undecided: show it in a line of the experience that used it.\n\
- Where the posting asks for a number of years and the CV's own dated roles plainly add up to it, state the total in the summary (for example \"eight years of ...\"). Never round up, and never state years the dates don't support.\n\
- The summary at the top should state the two or three most important requirements the CV meets, in the posting's words, because that is what a reviewer sees in the seconds they have.\n\
- Every requirement the CV meets must be shown in the CV itself; the cover letter can add why, but must not be the only place a requirement is evidenced.\n\
- Repeating a keyword adds nothing: one clear line per requirement is what counts. Where the CV has no evidence for a requirement, leave it out.",
        _ => "",
    }
}

/// What whoever writes the form's answers is told for this system.
pub fn answers(ats: &str) -> &'static str {
    match ats {
        "ashby" => "This employer's application system (Ashby) can compare the answers on the form with the CV, and rules on the answers can reject an application the moment it is submitted. Keep every number of years, job title, employer, date and place exactly as the CV states them; never round years up; answer yes/no and choice questions literally.",
        _ => "",
    }
}

/// What to know before applying through this system: [{title, text}].
pub fn tips(ats: &str) -> Vec<Value> {
    let t = |title: &str, text: &str| json!({ "title": title, "text": text });
    match ats {
        "ashby" => vec![
            t("The form's questions can reject you by themselves", "Employers can set rules on the application's questions (right to work, location, years of experience and the like). A rule rejects the moment you submit, and the email can be held back for some days, so it reads like a considered no. Read each question twice and answer exactly and truthfully."),
            t("Your answers are compared with your CV", "Reviewers can have what you typed checked against your CV. Make sure they agree: years, job titles, where you live."),
            t("Your CV is checked requirement by requirement", "Each requirement for the role is marked met, not met or undecided, with the lines of your CV that show it. Something your CV only implies, or only lists as a skill, comes back undecided. Job Hunt tailors for this and runs the same kind of check on your tailored CV, above."),
            t("The check reads your CV, not your cover letter", "Ashby describes the check as reading the CV. Anything that matters has to be in the CV itself; the letter is for the person who opens your application afterwards."),
            t("Applying to many roles here can work against you", "Employers can block repeat applications: the same role again after a no, or more than a set number in a period. Choose your best one or two roles at this company."),
            t("A link from someone inside skips the automatic rules", "An application through a link a recruiter or an employee sends you is not put through the automatic rejection rules or the limits. If you know someone here, ask for one before you apply."),
            t("Apply as yourself, from your usual connection", "Applications can be flagged by device, network, email and phone, and by a location that doesn't match. Use your own computer without a VPN, and the same email and phone number you use everywhere."),
        ],
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn told_from_where_the_job_is() {
        let job = |source: &str, url: &str, apply: Option<&str>| Job { source: source.into(), url: url.into(), apply_url: apply.map(String::from), ..Default::default() };
        assert_eq!(of(&job("ashby", "https://example.com/1", None)), Some("ashby"));
        assert_eq!(of(&job("linkedin", "https://www.linkedin.com/jobs/view/1", Some("https://jobs.ashbyhq.com/ramp/abc/application"))), Some("ashby"));
        assert_eq!(of(&job("greenhouse", "https://boards.greenhouse.io/acme/jobs/1", None)), None);
        assert!(tailoring("ashby").contains("undecided") && tips("ashby").len() == 7 && !answers("ashby").is_empty() && tips("other").is_empty() && tailoring("other").is_empty());
    }
}
