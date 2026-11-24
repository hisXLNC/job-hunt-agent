package api

import (
	"encoding/json"
	"testing"
	"time"
)

func TestListsAreNeverNull(t *testing.T) {
	type inner struct {
		Tags []string        `json:"tags"`
		Raw  json.RawMessage `json:"raw"`
		At   time.Time       `json:"at"`
		Ptr  *inner          `json:"ptr"`
	}
	type outer struct {
		Rows  []inner        `json:"rows"`
		More  []inner        `json:"more"`
		ByKey map[string]int `json:"by_key"`
		Any   any            `json:"any"`
		Data  []byte         `json:"data"`
	}
	in := outer{Rows: []inner{{}}, Any: map[string]any{"list": []int(nil)}}
	b, err := json.Marshal(lists(in))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"rows":[{"tags":[],"raw":null,"at":"0001-01-01T00:00:00Z","ptr":null}],"more":[],"by_key":{},"any":{"list":[]},"data":null}`
	if string(b) != want {
		t.Fatalf("got  %s\nwant %s", b, want)
	}
	if in.More != nil || in.Rows[0].Tags != nil {
		t.Fatal("the original was changed")
	}
	if got, _ := json.Marshal(lists(nil)); string(got) != "null" {
		t.Fatalf("nil: %s", got)
	}
}
