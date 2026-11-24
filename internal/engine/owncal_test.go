package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const sampleCal = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
	"BEGIN:VEVENT\r\nDTSTART;TZID=America/Toronto:20261201T100000\r\nDTEND;TZID=America/Toronto:20261201T110000\r\nSUMMARY:Dentist\\, downtown\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261203\r\nDTEND;VALUE=DATE:20261204\r\nSUMMARY:Birthday\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20261116T140000Z\r\nDTEND:20261116T150000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE:20261202T140000Z\r\nSUMMARY:Stand\r\n -up\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20261201T180000Z\r\nDTEND:20261201T190000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20250101T090000Z\r\nDTEND:20250101T100000Z\r\nSUMMARY:Long ago\r\nEND:VEVENT\r\n" +
	"END:VCALENDAR\r\n"

func TestACalendarFileIsRead(t *testing.T) {
	from := time.Date(2026, 11, 30, 0, 0, 0, 0, time.UTC)
	got, err := ParseCalendar([]byte(sampleCal), from, from.AddDate(0, 0, 7), time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	var seen []string
	for _, ev := range got {
		seen = append(seen, time.Unix(ev.Start, 0).UTC().Format("02 15:04 ")+ev.Title)
	}
	want := []string{"30 14:00 Stand-up", "01 15:00 Dentist, downtown", "03 00:00 Birthday"}
	if strings.Join(seen, "|") != strings.Join(want, "|") {
		t.Fatalf("got %v\nwant %v", seen, want)
	}
	if !got[2].AllDay || !got[2].Free || got[1].Free {
		t.Fatalf("all-day and free marks: %+v", got)
	}
	if _, err := ParseCalendar([]byte("<html>Sign in</html>"), from, from.AddDate(0, 0, 7), time.UTC); err == nil {
		t.Fatal("a web page was taken for a calendar")
	}
}

func TestFreeTimesAndClashesComeFromThePersonsCalendar(t *testing.T) {
	e, w := newEngine(t)
	_ = w
	now := time.Date(2026, 11, 30, 8, 0, 0, 0, time.UTC) // a Monday
	e.Now = func() time.Time { return now }
	e.OwnCalFetch = func(string) ([]byte, error) { return []byte(sampleCal), nil }
	if got := e.FreeTimes(5); len(got) != 0 {
		t.Fatal("times were offered with no calendar connected")
	}
	if _, err := e.SetOwnCal(t.Context(), "webcal://calendar.google.com/calendar/ical/me/private-x/basic.ics"); err != nil {
		t.Fatal(err)
	}
	if c := e.OwnCal(); !c.On || !strings.HasPrefix(c.URL, "https://") || c.Count == 0 {
		t.Fatalf("%+v", c)
	}
	// Tuesday 1 Dec: the dentist is 15:00 to 16:00 UTC.
	dentist := time.Date(2026, 12, 1, 15, 30, 0, 0, time.UTC).Unix()
	if c := e.Clash(dentist, 30); c == nil || c.Title != "Dentist, downtown" {
		t.Fatalf("clash: %+v", c)
	}
	if c := e.Clash(time.Date(2026, 12, 3, 10, 0, 0, 0, time.UTC).Unix(), 30); c != nil {
		t.Fatalf("an entry marked free blocked the time: %+v", c)
	}
	free := e.FreeTimes(5)
	if len(free) != 5 {
		t.Fatalf("offered %d times", len(free))
	}
	for _, s := range free {
		a := time.Unix(s.Start, 0).UTC()
		if a.Weekday() == time.Saturday || a.Weekday() == time.Sunday || a.Hour() < 9 || time.Unix(s.End, 0).UTC().Hour() > 17 {
			t.Errorf("outside working hours: %v", a)
		}
		if e.Clash(s.Start, 60) != nil {
			t.Errorf("offered a busy time: %v", a)
		}
	}
	if err := e.ForgetOwnCal(); err != nil || e.OwnCal().URL != "" || len(e.OwnEvents(0, 1<<40)) != 0 {
		t.Fatal("disconnecting left something behind")
	}
	for _, bad := range []string{"", "http://calendar.google.com/x.ics", "https://localhost/x.ics", "https://192.168.1.4/x.ics", "https://calendar.google.com/calendar/embed?src=me"} {
		if _, err := calendarAddress(bad); err == nil {
			t.Errorf("%q was accepted", bad)
		}
	}
}

func TestCopiesCanBeKeptInACloudDrive(t *testing.T) {
	e, _ := newEngine(t)
	drive := t.TempDir()
	e.CloudRoots = func() [][2]string { return [][2]string{{"Google Drive", drive}, {"OneDrive", filepath.Join(drive, "missing")}} }
	found := e.CloudFolders()
	if len(found) != 1 || found[0].Name != "Google Drive" || found[0].Used {
		t.Fatalf("%+v", found)
	}
	if err := e.KeepCopiesIn(t.TempDir()); err == nil {
		t.Fatal("a folder that is no cloud drive was accepted")
	}
	if err := e.KeepCopiesIn(found[0].Dir); err != nil {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(found[0].Dir)
	if len(files) != 1 || !e.CloudFolders()[0].Used {
		t.Fatalf("no copy was saved there: %v", files)
	}
}
