package office

import "testing"

// A letter's bullets start with a bold theme, written **like this**.
func TestLetterBoldTheme(t *testing.T) {
	d := letterDoc(Letter{Name: "Sam", Body: "Lead-in:\n- **Tax technology:** Ran the move at Acme.\n- A plain one with a lone ** mark"})
	var got []run
	for _, p := range d.paras {
		if p.style == "ListParagraph" {
			got = append(got, p.runs...)
		}
	}
	if len(got) != 3 || !got[0].bold || got[0].text != "Tax technology:" || got[1].bold || got[2].text != "A plain one with a lone  mark" {
		t.Fatalf("runs: %+v", got)
	}
}
