package sources

// KnownSite is a recruiter or job site Job Hunt can be told to search with
// one click. They are suggestions: none is searched until the person turns
// it on, and any other site can be added by its address.
type KnownSite struct {
	Site
	Kind    string // "Recruiter" or "Job site"
	Country string // two letters: whose jobs it lists
	About   string
}

// Known lists them. The addresses are each site's own search page, with the
// job title and the place filled in.
var Known = []KnownSite{
	{Site{ID: "roberthalf", Name: "Robert Half", URL: "https://www.roberthalf.com/ca/en/jobs/{title-}/{place-}", Link: `/ca/en/job/`, Browser: true}, "Recruiter", "CA", "Accounting, finance, technology, marketing and administrative roles."},
	{Site{ID: "michaelpage", Name: "Michael Page", URL: "https://www.michaelpage.ca/jobs/{title-}/{place-}", Link: `/job-detail/`}, "Recruiter", "CA", "Professional and management roles."},
	{Site{ID: "randstad", Name: "Randstad", URL: "https://www.randstad.ca/jobs/q-{title-}/l-{place-}/", Link: `/jobs/[a-z0-9-]+_[a-z0-9-]+_\d+`, Browser: true}, "Recruiter", "CA", "Office, customer service, industrial and professional roles."},
	{Site{ID: "adecco", Name: "Adecco", URL: "https://www.adecco.com/en-ca/job-search?k={title}&l={place}", Link: `/job-search/[a-z0-9-]+/ca_en_[0-9_]+`, Browser: true}, "Recruiter", "CA", "Temporary and permanent jobs across industries."},
	{Site{ID: "hays", Name: "Hays", URL: "https://www.hays.ca/job-search/{title-}-jobs-in-{place-}", Link: `/job-detail/|/jobs?/[^?#]*\d{5,}`, Browser: true}, "Recruiter", "CA", "Specialist roles in technology, construction, finance and more."},
	{Site{ID: "aplin", Name: "Aplin", URL: "https://www.aplin.com/jobs/?search={title}"}, "Recruiter", "CA", "Professional, contract and permanent roles across Canada."},
	{Site{ID: "altis", Name: "Altis Recruitment", URL: "https://jobportal.altis.com/?keyword={title}", Link: `/jobs/\d+/[a-z0-9-]+`, Browser: true}, "Recruiter", "CA", "Administrative, finance, marketing and project roles."},
	{Site{ID: "lro", Name: "LRO Staffing", URL: "https://jobs.lrostaffing.com/job-listings/", Link: `/job-post/`}, "Recruiter", "CA", "Professional, administrative and government-related roles."},
	{Site{ID: "locksearch", Name: "Lock Search Group", URL: "https://www.locksearchgroup.com/opportunities/", Link: `/(?:job|opportunit(?:y|ies))/[a-z0-9-]{8,}`}, "Recruiter", "CA", "Specialised professional and senior roles."},
	{Site{ID: "jobsca", Name: "Jobs.ca", URL: "https://www.jobs.ca/jobs?q={title}&l={place}", Browser: true}, "Job site", "CA", "The Jobs.ca network, which also covers techjobs.ca and itjobs.ca."},
	{Site{ID: "techtalent", Name: "Tech Talent Canada", URL: "https://jobs.techtalent.ca/?q={title}", Link: `/j/[a-z0-9-]+-[0-9a-f]{8,}`, Browser: true}, "Job site", "CA", "Canadian technology roles."},
}

// KnownByID finds a suggested site.
func KnownByID(id string) (KnownSite, bool) {
	for _, k := range Known {
		if k.ID == id {
			return k, true
		}
	}
	return KnownSite{}, false
}
