// Package web holds the pages, built into the program.
package web

import "embed"

//go:embed *.html *.css *.js *.svg pages/*.js
var FS embed.FS
