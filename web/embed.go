// Package web holds the pages, built into the program.
package web

import "embed"

//go:embed *.html *.css *.js pages/*.js
var FS embed.FS
