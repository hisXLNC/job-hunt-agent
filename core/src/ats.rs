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
/// quoted as the evidence. A requirement the CV only implies comes back "undecided".
pub fn tailoring(ats: &str) -> &'static str {
    match ats {
        "ashby" => "This employer takes applications through Ashby. Its reviewers can have each CV checked against a short list of criteria written for the role: for each one the CV is marked as meeting it, not meeting it, or undecided, and the lines of the CV that show it are quoted back to the reviewer. So, for each requirement the posting states as required: where the CV has the evidence, say it outright in one self-contained line a reviewer could quote (the skill, tool or kind of work named the way the posting names it, with the years or the scale where the CV gives them), instead of leaving it to be inferred from a job title or spread across several bullets. One clear line per requirement is what counts; repeating a keyword adds nothing. Where the CV has no evidence for a requirement, leave it out.",
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
            t("Your CV is checked requirement by requirement", "Each requirement for the role is marked met, not met or undecided, with the lines of your CV that show it. Something your CV only implies comes back undecided, so Job Hunt's tailoring states each requirement you meet in one clear line."),
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
        assert!(tailoring("ashby").contains("undecided") && tips("ashby").len() == 6 && tips("other").is_empty() && tailoring("other").is_empty());
    }
}
