package api

import (
	"encoding/csv"
	"strings"
	"testing"

	"jobhunt/internal/engine"
	"jobhunt/internal/store"
)

// A phone can do none of the mail writing. The assistant can write a draft
// and save it when asked, but a message to someone goes only when the
// person presses the button under its reply.
func TestMailWritingIsOnlyForThePersonsOwnPress(t *testing.T) {
	routes := [][2]string{{"POST", "/api/mail/send"}, {"POST", "/api/mail/draft"}, {"POST", "/api/mail/recruiters"}, {"POST", "/api/mail/1/reply"}, {"GET", "/api/recruiters.csv"}}
	if tl, _ := findTool("POST", "/api/mail/send"); tl == nil || tl.Class != mustAsk {
		t.Errorf("sending an e-mail is not held for the person's button: %+v", tl)
	}
	// E-mailing a file goes to the person's own address: the call takes no address.
	if tl, _ := findTool("POST", "/api/handout/mail"); tl == nil || strings.Contains(tl.Help, `"to"`) {
		t.Errorf("e-mailing a file to yourself: %+v", tl)
	}
	for _, r := range routes {
		if phoneMay(r[0], r[1]) {
			t.Errorf("a phone may make %s %s", r[0], r[1])
		}
	}

	s, h := newServer(t)
	if st := s.state(); st.MailCan["send"] || st.MailCan["drafts"] || st.MailCan["recruiters"] {
		t.Errorf("a mail switch starts on: %v", st.MailCan)
	}
	for _, path := range []string{"/api/mail/send", "/api/mail/draft"} {
		w := do(h, call{method: "POST", path: path, marker: true, body: `{"kind":"chase","id":1,"to":"dana@example.com","subject":"Hi","body":"Hello"}`})
		if w.Code == 200 {
			t.Errorf("%s worked with the switch off", path)
		}
	}
	s.S.Set("mail", engine.MailSet{On: true, User: "me@example.com", Pass: "x", Send: true})
	if !s.state().MailCan["send"] {
		t.Error("the send switch doesn't reach the pages")
	}
}

func TestRecruitersSpreadsheet(t *testing.T) {
	s, h := newServer(t)
	c, _, _ := s.S.UpsertCompany(store.Company{Name: "Harbour Trust", State: "following"})
	s.S.AddPerson(store.Person{CompanyID: c.ID, Name: "Priya Shah", Kind: "recruiter", Email: "priya@example.com", Phone: "+1 416 555 0199", URL: "https://www.linkedin.com/in/priya-example", Source: "mail"})
	s.S.AddPerson(store.Person{CompanyID: c.ID, Name: "=HYPERLINK(\"https://evil.example\")", Kind: "manager", Title: "+Head of Tax"})
	s.S.AddPerson(store.Person{CompanyID: c.ID, Name: "Ana Lopez", Kind: "same_craft"})
	w := do(h, call{path: "/api/recruiters.csv"})
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), "\xEF\xBB\xBF") {
		t.Fatalf("code %d", w.Code)
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(w.Body.String(), "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("want the two hiring people only: %v", rows)
	}
	all := w.Body.String()
	if strings.Contains(all, "Ana Lopez") || !strings.Contains(all, "+1 416 555 0199") || !strings.Contains(all, "'=HYPERLINK") || !strings.Contains(all, "'+Head of Tax") {
		t.Errorf("the spreadsheet:\n%s", all)
	}
}
