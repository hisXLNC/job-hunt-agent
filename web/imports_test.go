package web

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// A page that calls one of app.js's helpers without importing it breaks only
// when that part of the page is drawn ("ago is not defined"). This catches it
// before a release.
func TestPagesImportTheHelpersTheyUse(t *testing.T) {
	app, err := os.ReadFile("app.js")
	if err != nil {
		t.Fatal(err)
	}
	var helpers []string
	for _, m := range regexp.MustCompile(`export (?:async )?(?:function|const|let|class) (\w+)`).FindAllStringSubmatch(string(app), -1) {
		helpers = append(helpers, m[1])
	}
	importRe := regexp.MustCompile(`import\s*\{([^}]*)\}`)
	files, _ := filepath.Glob("*.js")
	more, _ := filepath.Glob("pages/*.js")
	phone, _ := filepath.Glob("phone/*.js")
	files = append(append(files, more...), phone...)
	for _, f := range files {
		if f == "app.js" {
			continue
		}
		b, _ := os.ReadFile(f)
		s := string(b)
		have := map[string]bool{}
		for _, m := range importRe.FindAllStringSubmatch(s, -1) {
			for _, x := range strings.Split(m[1], ",") {
				p := strings.Fields(x)
				if len(p) > 0 {
					have[p[len(p)-1]] = true
				}
			}
		}
		for _, h := range helpers {
			if have[h] {
				continue
			}
			q := regexp.QuoteMeta(h)
			// Defined here (a function, a variable, a parameter list) or only a method name.
			if regexp.MustCompile(`(?:function|const|let|var)\s+` + q + `\b|[,(]\s*` + q + `\s*(?:=[^=]|[,)])`).MatchString(s) {
				continue
			}
			for _, m := range regexp.MustCompile(`(^|[^\w.$])` + q + `\(([^)]*)\)\s*(\{)?`).FindAllStringSubmatchIndex(s, -1) {
				if m[6] >= 0 { // name(...) { ... } is a method being defined
					continue
				}
				line := strings.Count(s[:m[0]], "\n") + 1
				t.Errorf("%s:%d calls %s() from app.js without importing it", f, line, h)
				break
			}
		}
	}
}
