// Package extension holds the browser side panel, so that the program can
// hand it to the person as a download.
package extension

import "embed"

//go:embed manifest.json *.js *.html *.css icons/*.png
var FS embed.FS
