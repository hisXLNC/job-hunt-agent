package engine

import (
	"fmt"
	"testing"
	"time"

	"jobhunt/internal/store"
)

func TestSearchTimesFromPostings(t *testing.T) {
	day := time.Date(2026, 11, 2, 0, 0, 0, 0, time.Local)
	var at []time.Time
	add := func(h, m, n int) {
		for i := 0; i < n; i++ {
			at = append(at, day.AddDate(0, 0, i%5).Add(time.Duration(h)*time.Hour+time.Duration(m+i)*time.Minute))
		}
	}
	// Too few: nothing suggested yet.
	add(9, 5, 5)
	if sg := suggestFrom(at); sg.Ready || sg.Seen != 5 || len(sg.Full) != 0 || len(sg.Hours) != 24 {
		t.Fatalf("five postings: %+v", sg)
	}
	add(9, 10, 10) // 15 at nine
	add(10, 3, 4)  // next to it: no peak of its own
	add(14, 0, 8)  // the afternoon
	add(16, 20, 5) // late afternoon
	add(3, 30, 1)  // one in the night
	sg := suggestFrom(at)
	if !sg.Ready || sg.Seen != 33 {
		t.Fatalf("enough postings: %+v", sg)
	}
	// 16 is two hours from 14, too near to be a peak of its own.
	want := map[int]bool{9: true, 14: true}
	for _, p := range sg.Peaks {
		if p == 10 || p == 15 || p == 16 || p == 13 {
			t.Errorf("a peak next to another: %v", sg.Peaks)
		}
		delete(want, p)
	}
	if len(want) != 0 {
		t.Fatalf("peaks = %v", sg.Peaks)
	}
	if sg.Full[0] != 9*60+40 {
		t.Errorf("full searches = %v", sg.Full)
	}
	// Quick checks cover nine in ten, with an hour either side.
	if sg.From != 8 || sg.To != 18 {
		t.Errorf("quick checks %d to %d", sg.From, sg.To)
	}
}

func TestSearchTimesSuggestedFromRolesFound(t *testing.T) {
	e, _ := newEngine(t)
	acme := setUp(t, e)
	now := time.Now()
	e.Now = func() time.Time { return now }
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -3)
	add := func(key string, posted time.Time, closed string) {
		if _, err := e.S.AddRole(store.Role{CompanyID: acme.ID, Key: key, Title: "Tax Technology Manager", PostedAt: posted.Unix(), Closed: closed, Applicants: -1}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 25; i++ {
		add(fmt.Sprint("t:", i), day.Add(11*time.Hour+time.Duration(i)*time.Minute), "")
		// A date alone says nothing about the hour; nor does a posting the rules set aside.
		add(fmt.Sprint("d:", i), time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC), "")
		add(fmt.Sprint("s:", i), day.Add(4*time.Hour+time.Duration(i)*time.Minute), "screened")
	}
	sg := e.SuggestTimes()
	if !sg.Ready || sg.Seen != 25 || len(sg.Peaks) != 1 || sg.Peaks[0] != 11 || sg.Full[0] != 11*60+40 {
		t.Fatalf("suggestion: %+v", sg)
	}
	if sg.Same {
		t.Fatal("the usual schedule is not the suggested one")
	}
	// Taken up through the usual schedule setting, it says so.
	if err := e.SetSchedule(Schedule{Full: sg.Full, FastMinutes: 20, From: sg.From, To: sg.To}); err != nil {
		t.Fatal(err)
	}
	if !e.SuggestTimes().Same {
		t.Fatal("the schedule follows the suggestion, but it does not say so")
	}
}
