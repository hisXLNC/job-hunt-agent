// Package web holds the pages, built into the program.
package web

import "embed"

//go:embed *.html *.css *.js *.svg pages/*.js phone/*
var FS embed.FS
