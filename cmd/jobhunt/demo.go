package main

import (
	"context"
	"strings"
	"time"

	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

// Sample data for trying the interface without a Claude account. Every
// person and posting here is made up.

const demoCV = `Sam Rivera
Dubai, United Arab Emirates | sam.rivera@example.com | +971 50 000 0000 | linkedin.com/in/samrivera-example

Summary
Tax technology manager with ten years of experience implementing indirect tax engines and e-invoicing for multinational groups.

Experience

Tax Technology Manager
Northwind Group, Dubai
2019 - Present
- Led the implementation of a Vertex indirect tax engine across 14 countries on SAP S/4HANA
- Built e-invoicing integrations for Saudi Arabia and Egypt handling 2 million invoices a month
- Managed a team of six analysts and a vendor budget of USD 1.2 million
- Automated VAT return preparation with Alteryx, cutting the monthly close by four days

Senior Tax Analyst
Contoso Advisory, Dubai
2015 - 2019
- Prepared VAT and GST returns for clients in retail and logistics
- Designed tax determination logic in SAP for a regional retailer
- Trained finance teams on new VAT rules

Education
Bachelor of Commerce, Accounting
University of Jordan
2011 - 2015

Skills
SAP S/4HANA, Vertex, Alteryx, Power BI, SQL, e-invoicing, VAT, GST, indirect tax
`

type demoRole struct {
	company, title, location, workplace string
	minsAgo, applicants                 int
	bullets                             []string
}

var demoBullets = map[string][]string{
	"engine":  {"Implementation of a Vertex indirect tax engine on SAP S/4HANA", "Experience with e-invoicing integrations handling large invoice volumes", "Managed a team of analysts and a vendor budget", "Automated VAT and GST return preparation with Alteryx", "Designed tax determination logic in SAP"},
	"analyst": {"Prepared VAT and GST returns for clients in retail and logistics", "Trained finance teams on new tax rules", "Built dashboards in Power BI and SQL for indirect tax reporting", "Knowledge of Canadian HST and QST filing requirements", "CPA designation or working toward one"},
	"product": {"Own the roadmap for a tax determination product used by enterprise customers", "Experience with indirect tax engines such as Vertex", "Worked with engineering teams to ship integrations with SAP S/4HANA", "Five years of product management in a software company", "Run discovery interviews and write product requirements"},
	"finance": {"Lead finance systems projects across SAP S/4HANA", "Managed a team of analysts and vendor budgets", "Experience automating the monthly close", "Oracle Fusion and Workday Financials experience", "Treasury and consolidation reporting"},
}

func demoAd(kind, company, title string) string {
	return "About the role\n" + company + " is hiring a " + title + " in Toronto. You will join the Tax Technology team, eight people inside Group Finance who run the systems that work out, file and report tax for every part of the business, and you will report to the head of tax.\n\nWhat you bring\n- " +
		strings.Join(demoBullets[kind], "\n- ") + "\n\nWe offer a hybrid working model, a competitive salary and a defined contribution pension. We thank all applicants; only those selected for an interview will be contacted."
}

func seedDemo(e *engine.Engine) error {
	s := e.S
	if cvs, _ := s.CVs(); len(cvs) > 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := e.SetLLM(engine.LLMSettings{Engine: "demo"}); err != nil {
		return err
	}
	if _, _, err := e.AddCV(ctx, "Sam Rivera CV.txt", []byte(demoCV)); err != nil {
		return err
	}
	now := time.Now()
	p := s.Profile()
	p.City, p.Country, p.Home = "Toronto", "Canada", "Dubai, United Arab Emirates"
	p.ArriveOn = now.AddDate(0, 0, 44).Format("2006-01-02")
	p.Headline = "Tax technology manager"
	p.Titles = store.Titles{Level: []string{"Tax Technology Manager", "Senior Manager, Indirect Tax"}, StepUp: []string{"Director, Tax Technology", "Head of Tax Transformation"}, Sideways: []string{"Product Manager, Tax", "Finance Systems Manager"}}
	p.Domain = []string{"tax", "vat", "gst"}
	p.Strengths = []string{"Indirect tax engines", "SAP S/4HANA", "E-invoicing", "Automation"}
	p.Rare = "Has put a tax engine live in 14 countries, including two with mandatory e-invoicing."
	p.SetupDone = true
	if err := s.SaveProfile(p); err != nil {
		return err
	}
	s.Ask(store.Question{Key: "work_status", Text: "When you arrive in Canada, will you be allowed to work?", Why: "Recruiters ask this first. Job Hunt puts the answer where they look for it.", Options: []string{"Yes, as a permanent resident", "Yes, on a work permit", "Yes, as a citizen", "Not yet"}, Weight: 100})
	s.Ask(store.Question{Key: "pay_floor", Text: "What is the lowest yearly salary you would accept in Toronto?", Why: "Roles that state less are set aside.", Weight: 60})

	for _, c := range []store.Company{
		{Name: "Maple Ledger", About: "A Toronto software company of about 400 people that makes sales-tax and e-invoicing software used by mid-sized retailers and distributors across Canada and the United States.", Sector: "Tax software", Why: "Builds the kind of tax engine you have implemented", BoardKind: "greenhouse", BoardToken: "mapleledger"},
		{Name: "Harbourfront Bank", About: "One of the larger retail and commercial banks in Canada, based in Toronto, with about 30,000 staff and branches in every province.", Sector: "Banking", Why: "Large in-house tax technology team in Toronto", BoardKind: "workday", BoardToken: "harbourfront.wd3/careers"},
		{Name: "Northlight Retail", About: "A national chain of home and outdoor stores with about 250 shops and an online business, run from a head office in Mississauga.", Sector: "Retail", Why: "On SAP S/4HANA with stores in every province", BoardKind: "lever", BoardToken: "northlight"},
		{Name: "Cedar & Pine Advisory", About: "A mid-sized Canadian accounting and advisory firm with offices in Toronto, Calgary and Vancouver; its clients are mostly private companies and public bodies.", Sector: "Professional services", Why: "Indirect tax technology practice; hires from industry"},
		{Name: "Lakeshore Logistics", About: "A freight and customs broker that moves goods by road and rail between Canada and the United States, with about 1,200 staff.", Sector: "Logistics", Why: "Cross-border GST and HST at volume", BoardKind: "ashby", BoardToken: "lakeshore"},
		{Name: "Quill Payments", About: "A payments company whose software lets businesses send invoices and get paid online; about 600 people, founded in Toronto in 2015.", Sector: "Payments", Why: "Launching e-invoicing products", BoardKind: "greenhouse", BoardToken: "quill"},
	} {
		c.State, c.Source, c.AboutFrom = "following", "proposed", "claude"
		got, _, err := s.UpsertCompany(c)
		if err != nil {
			return err
		}
		got.BoardKind, got.BoardToken, got.BoardCheckedAt = c.BoardKind, c.BoardToken, now.Unix()
		if c.BoardKind == "" {
			got.BoardNote = "No public job board found; watched through LinkedIn"
		}
		s.SaveCompany(got)
	}

	roles := []demoRole{
		{"Maple Ledger", "Tax Technology Manager", "Toronto, ON", "hybrid", 22, 3, demoBullets["engine"]},
		{"Harbourfront Bank", "Director, Tax Technology", "Toronto, ON", "hybrid", 190, 7, demoBullets["engine"]},
		{"Quill Payments", "Product Manager, Tax", "Toronto, ON", "remote", 60 * 9, 24, demoBullets["product"]},
		{"Northlight Retail", "Senior Manager, Indirect Tax", "Mississauga, ON", "onsite", 60 * 26, 41, demoBullets["analyst"]},
		{"Lakeshore Logistics", "Finance Systems Manager", "Toronto, ON", "hybrid", 60 * 50, 58, demoBullets["finance"]},
		{"Cedar & Pine Advisory", "Senior Manager, Indirect Tax Technology", "Toronto, ON", "hybrid", 60 * 24 * 4, 80, demoBullets["engine"]},
		{"Harbourfront Bank", "Senior Manager, Indirect Tax", "Toronto, ON", "hybrid", 60 * 24 * 6, 120, demoBullets["analyst"]},
		{"Maple Ledger", "Tax Technology Intern", "Toronto, ON", "onsite", 300, 12, demoBullets["analyst"]},
		{"Northlight Retail", "Store Manager", "Toronto, ON", "onsite", 500, 30, demoBullets["finance"]},
		{"Quill Payments", "Tax Technology Manager", "Berlin, Germany", "onsite", 700, 15, demoBullets["engine"]},
	}
	var ids []int64
	for i, r := range roles {
		c, err := s.CompanyByName(r.company)
		if err != nil {
			return err
		}
		kind := "engine"
		for k, b := range demoBullets {
			if len(b) > 0 && len(r.bullets) > 0 && b[0] == r.bullets[0] {
				kind = k
			}
		}
		closed, why := "", ""
		switch {
		case strings.Contains(r.title, "Intern"):
			closed, why = "screened", "Student or entry-level role"
		case r.title == "Store Manager":
			closed, why = "screened", "Title isn't in your field"
		case strings.Contains(r.location, "Berlin"):
			closed, why = "screened", "Based somewhere else"
		}
		ad := demoAd(kind, r.company, r.title)
		// Two of the postings say when they stop taking applications.
		if i == 1 || i == 3 {
			ad += "\n\nClosing date: " + now.AddDate(0, 0, 4+3*i).Format("January 2, 2006") + "."
		}
		id, err := s.AddRole(store.Role{CompanyID: c.ID, Key: "demo:" + string(rune('a'+i)), Source: firstBoard(c), Title: r.title, Location: r.location, Workplace: r.workplace,
			URL: "https://example.com/jobs/" + string(rune('a'+i)), Description: ad, PostedAt: now.Add(-time.Duration(r.minsAgo) * time.Minute).Unix(),
			Applicants: r.applicants, Closed: closed, ClosedWhy: why})
		if err != nil {
			return err
		}
		if closed == "" {
			if _, _, err := e.ReadRole(ctx, id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
	}
	// Some history: two applied, one of them answered.
	if len(ids) >= 7 {
		e.MarkApplied(ids[5], "")
		e.MarkApplied(ids[6], "")
		e.PasteMail(ctx, "Priya Nair <priya.nair@cedarpine.example>", "Your application: Senior Manager, Indirect Tax Technology",
			"Hi Sam,\n\nThank you for applying to Cedar & Pine Advisory. Your background with Vertex on S/4HANA is very relevant. Do you have availability for a 30 minute call next week?\n\nPriya", ids[5])
	}

	// People: the five kinds who answer a newcomer.
	people := []struct{ name, title, company, kind, why string }{
		{"Daniel Okafor", "Partner, Indirect Tax Technology", "Cedar & Pine Advisory", "knows_work", "His firm advised Northwind on the Saudi e-invoicing rollout you led."},
		{"Leila Haddad", "Tax Technology Lead", "Harbourfront Bank", "made_move", "Moved from Dubai to Toronto in 2022 into the same kind of role."},
		{"Marcus Chen", "Director, Tax Transformation", "Northlight Retail", "same_craft", "Runs a Vertex on S/4HANA programme, the work you have done."},
		{"Rania Aziz", "Senior Manager, Finance Systems", "Lakeshore Logistics", "same_roots", "Also studied accounting at the University of Jordan."},
		{"Toronto Newcomer Mentoring", "Finance and accounting stream", "", "mentor", "Matches newcomers with a mentor in their field for three months."},
	}
	var pids []int64
	for _, x := range people {
		id, err := e.AddPerson(store.Person{Name: x.name, Title: x.title, Kind: x.kind, Why: x.why, URL: "https://www.linkedin.com/in/example-" + strings.ToLower(strings.Fields(x.name)[0]), Source: "proposed"}, x.company)
		if err != nil {
			return err
		}
		pids = append(pids, id)
	}
	if n, err := e.DraftNote(ctx, pids[0], "", "linkedin", 0); err == nil {
		_ = n
	}
	if n, err := e.DraftNote(ctx, pids[1], "", "linkedin", 0); err == nil {
		e.NoteSent(n.ID)
		e.NoteReplied(n.ID)
	}
	if n, err := e.DraftNote(ctx, pids[2], "", "linkedin", 0); err == nil {
		e.NoteSent(n.ID)
	}
	s.SaveDoc(0, "doors", engine.DoorsDoc{At: now.Unix(), Doors: []engine.Door{
		{Title: "Indirect tax technology manager", Company: "Any Big Four firm in Toronto", Kind: "knows_work", Why: "Advisers who worked alongside your past employers know the quality of that work.", Search: "indirect tax technology manager Toronto Vertex"},
		{Title: "Finance professional who moved from the Gulf", Company: "Toronto", Kind: "made_move", Why: "They remember what the first three months were like.", Search: "tax manager Toronto previously Dubai"},
	}})

	// A conversation coming up.
	if tid, err := s.AddTalk(store.Talk{PersonID: pids[1], Kind: "chat", Title: "Video call with Leila", At: now.Add(26 * time.Hour).Truncate(30 * time.Minute).Unix(), Minutes: 30, Link: "https://meet.example.com/abc"}); err == nil {
		e.PrepTalk(ctx, tid)
	}
	// And an interview next week for one of the roles applied to.
	if len(ids) >= 7 {
		at := time.Date(now.Year(), now.Month(), now.Day(), 14, 0, 0, 0, now.Location()).AddDate(0, 0, 6)
		s.AddTalk(store.Talk{RoleID: ids[5], Kind: "interview", Title: "First interview", At: at.Unix(), Minutes: 45, Link: "https://meet.example.com/xyz"})
	}
	e.BuildArriving(ctx)
	s.Log(store.Activity{Kind: "search", Text: "Searched 14 places: 212 postings, 10 new, 7 worth a look"})
	// Sample data only: searching the real sites stays off until the person turns it on.
	e.SetPaused(true)
	return nil
}

func firstBoard(c store.Company) string {
	if c.BoardKind != "" {
		return c.BoardKind
	}
	return "linkedin"
}
