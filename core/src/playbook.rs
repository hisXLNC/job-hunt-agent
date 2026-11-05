//! Reaching out to recruiters: who's worth a message, when, and how often. One short, specific
//! message helps more often than it annoys; repeated chasing doesn't.
//!
//! - Private sector, in-house recruiter: a LinkedIn note or email within 1 to 3 days of applying.
//! - Staffing agency (Robert Half, Hays…): yes, strongly; they want candidates they can place.
//! - Government of Canada (GC Jobs): formal and merit-based, so outreach rarely helps; the
//!   screening questions are what gets scored. Only email the listed contact with a real question.
//! - Provincial or municipal government: a light touch, one clarifying question at most.
//! - No reply to a message: one follow-up 7 to 10 days later, then stop. Never more than twice.

use crate::db::Job;
use once_cell::sync::Lazy;
use regex::Regex;

/// The kinds of employer, as the playbook treats them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Private,
    Agency,
    Federal,
    Public,
}

impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Private => "private",
            Kind::Agency => "agency",
            Kind::Federal => "federal",
            Kind::Public => "public",
        }
    }

    /// Whether messaging a recruiter after applying is worth it: private employers and agencies.
    pub fn reach_out(self) -> bool {
        matches!(self, Kind::Private | Kind::Agency)
    }

    /// The employer, as a message writer should know it.
    pub fn describe(self) -> &'static str {
        match self {
            Kind::Agency => "a staffing agency (they want candidates they can place)",
            Kind::Federal => "the Government of Canada (a formal, merit-based process: only a genuine question, briefly)",
            Kind::Public => "a provincial or municipal government (a light touch: one clarifying question at most)",
            Kind::Private => "a private employer",
        }
    }

    /// The advice for this kind, in a sentence or two.
    pub fn advice(self) -> &'static str {
        match self {
            Kind::Private => "Message the recruiter within 1 to 3 days of applying: one short LinkedIn note or email. If there's no reply, one follow-up 7 to 10 days later, then stop.",
            Kind::Agency => "A staffing agency: message or call the recruiter, the sooner the better. They want candidates they can place, so say you're open to similar roles they're filling.",
            Kind::Federal => "Government of Canada hiring is formal and merit-based, so outreach rarely helps. Put the effort into the screening questions, since they're what gets scored; only email the listed contact with a genuine question.",
            Kind::Public => "Provincial or municipal government: keep it light. One clarifying question to the listed contact at most.",
        }
    }
}

/// Recruitment agencies by name, beyond the ones Job Hunt searches.
const AGENCIES: &[&str] = &["robert half", "hays", "randstad", "adecco", "michael page", "page group", "pagegroup", "aerotek", "altis",
    "kelly services", "manpower", "experis", "teksystems", "procom", "s.i. systems", "si systems", "modis", "akkodis", "lannick",
    "korn ferry", "spencer stuart", "people first hr", "tech talent canada", "goodman group", "ian martin", "insight global",
    "beacon hill", "allegis", "hire velocity", "nesc staffing", "hunt personnel", "drake international", "spherion", "staffing",
    "recruitment", "recruiting", "talent solutions", "personnel"];

static FEDERAL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(government of canada|gouvernement du canada|canada revenue agency|employment and social development canada|statistics canada|health canada|transport canada|public services and procurement canada|treasury board|shared services canada|immigration, refugees and citizenship canada|national defence|royal canadian mounted police|canada border services agency|public health agency of canada|global affairs canada|innovation, science and economic development|environment and climate change canada|fisheries and oceans canada|natural resources canada|indigenous services canada|parks canada|canadian heritage|veterans affairs canada|agriculture and agri-food canada|public safety canada|correctional service canada|department of justice canada|privy council office|finance canada|canadian food inspection agency|public service commission)\b").unwrap());
static FEDERAL_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(emploisfp-psjobs\.cfp-psc\.gc\.ca|psjobs-emploisfp|jobs-emplois\.gc\.ca|\.gc\.ca/)").unwrap());
static PUBLIC: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(ontario public service|government of (ontario|alberta|british columbia|manitoba|saskatchewan|quebec|québec|nova scotia|new brunswick|newfoundland|prince edward island|yukon|nunavut|the northwest territories)|province of|city of|town of|township of|county of|region of|regional municipality|municipality of|district of|ville de|bc public service|alberta public service)\b").unwrap());
static PUBLIC_LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(gojobs\.gov\.on\.ca|ontario\.ca/|\.gov\.on\.ca|bcpublicservice|gov\.bc\.ca|alberta\.ca/|jobs\.alberta\.ca|toronto\.ca|ottawa\.ca|mississauga\.ca|brampton\.ca|oakville\.ca|vaughan\.ca|markham\.ca|calgary\.ca|edmonton\.ca|vancouver\.ca|montreal\.ca|winnipeg\.ca)").unwrap());

/// What kind of employer a job is with: a Government of Canada department, another government, a
/// staffing agency, or (the rest) a private employer.
pub fn kind(job: &Job) -> Kind {
    let links = format!("{} {}", job.url, job.apply_url.as_deref().unwrap_or(""));
    let company = job.company.to_lowercase();
    if FEDERAL.is_match(&job.company) || FEDERAL_LINK.is_match(&links) {
        return Kind::Federal;
    }
    if PUBLIC.is_match(&job.company) || PUBLIC_LINK.is_match(&links) {
        return Kind::Public;
    }
    // Whole words: "Hays", not "Shays".
    let words = format!(" {} ", company.split(|c: char| !c.is_alphanumeric() && c != '.').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    let agency_site = crate::sites::SITES.iter().any(|s| s.kind == "Agency" && (s.id == job.source || words.contains(&format!(" {} ", s.name.to_lowercase()))));
    if agency_site || AGENCIES.iter().any(|a| words.contains(&format!(" {a} "))) {
        return Kind::Agency;
    }
    Kind::Private
}

/// How many messages to one person, at most: the first and one follow-up.
pub const MAX_MESSAGES: usize = 2;
/// Days to wait for a reply before the one follow-up (7 to 10).
pub const FOLLOW_UP_AFTER: i64 = 7;
pub const FOLLOW_UP_BY: i64 = 10;
/// Days after applying when a first message to the recruiter still lands well (1 to 3).
pub const REACH_OUT_WITHIN: i64 = 3;

#[cfg(test)]
mod tests {
    use super::*;

    fn job(company: &str, url: &str, source: &str) -> Job {
        Job { company: company.into(), url: url.into(), source: source.into(), ..Job::default() }
    }

    #[test]
    fn kinds_of_employer() {
        assert_eq!(kind(&job("Canada Revenue Agency", "https://example.com/x", "jobbank")), Kind::Federal);
        assert_eq!(kind(&job("Some Department", "https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800?poster=1", "manual")), Kind::Federal);
        assert_eq!(kind(&job("Ontario Public Service", "https://www.gojobs.gov.on.ca/Preview.aspx?Language=English&JobID=1", "manual")), Kind::Public);
        assert_eq!(kind(&job("City of Toronto", "https://jobs.toronto.ca/x", "linkedin")), Kind::Public);
        assert_eq!(kind(&job("Robert Half", "https://www.roberthalf.com/ca/en/job/x", "roberthalf")), Kind::Agency);
        assert_eq!(kind(&job("Hays Specialist Recruitment", "https://example.com", "linkedin")), Kind::Agency);
        assert_eq!(kind(&job("Northwind Staffing Inc.", "https://example.com", "linkedin")), Kind::Agency);
        assert_eq!(kind(&job("Maple Bank", "https://boards.greenhouse.io/maple/jobs/1", "greenhouse")), Kind::Private);
        assert_eq!(kind(&job("Shopify", "https://www.shopify.com/careers/x", "manual")), Kind::Private);
        assert_eq!(kind(&job("Shays Logistics", "https://example.com", "manual")), Kind::Private, "not Hays");
        assert!(Kind::Private.reach_out() && Kind::Agency.reach_out() && !Kind::Federal.reach_out() && !Kind::Public.reach_out());
    }
}
