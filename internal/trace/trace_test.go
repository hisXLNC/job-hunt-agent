package trace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheRecordKeepsNoAddressesOrKeys(t *testing.T) {
	dir := t.TempDir()
	if err := Open(dir); err != nil {
		t.Fatal(err)
	}
	defer Close()
	Log("fetch", "GET https://example.com/jobs?api_key=abcdef123456&q=tax 200")
	Log("problem", "couldn't write to someone@example.com\nBearer abcdefghijklmnop sk-ant-abcdefgh12345678 gsk_abcdefgh12345678 xai-abcdefgh12345678")
	got := strings.Join(Tail(2), "\n")
	for _, bad := range []string{"someone@example.com", "abcdef123456", "abcdefghijklmnop", "sk-ant-abcdefgh12345678", "gsk_abcdefgh12345678", "xai-abcdefgh12345678"} {
		if strings.Contains(got, bad) {
			t.Errorf("the record kept %q:\n%s", bad, got)
		}
	}
	if !strings.Contains(got, "q=tax") || !strings.Contains(got, "[e-mail]") || len(Tail(2)) != 2 {
		t.Errorf("the record lost too much or broke a line:\n%s", got)
	}
	b, err := os.ReadFile(filepath.Join(dir, "debug.log"))
	if err != nil || !strings.Contains(string(b), "q=tax") || strings.Contains(string(b), "someone@") {
		t.Errorf("the file: %v\n%s", err, b)
	}
}

func TestGoogleSignInLeavesNoTokens(t *testing.T) {
	for _, bad := range []string{"ya29.a0Abc-def_123", "1//0gFakeRefresh-Token_9", "GOCSPX-FakeSecret_123"} {
		if got := Clean("google said something about " + bad); strings.Contains(got, bad) {
			t.Errorf("kept %q: %s", bad, got)
		}
	}
	if got := Clean("GET /?state=x&code=4/0AFakeCode&scope=y"); strings.Contains(got, "4/0AFakeCode") {
		t.Errorf("kept the sign-in code: %s", got)
	}
	if got := Clean("GET /search?postcode=M5V&countryCode=CA"); !strings.Contains(got, "postcode=M5V") || !strings.Contains(got, "countryCode=CA") {
		t.Errorf("took out more than the sign-in code: %s", got)
	}
}
