//go:build !windows

package main

// Only Windows has Job Hunt's own window; elsewhere the pages open in a browser.
var otherURL, otherDir string

func startWindow(url, dir string) { otherURL, otherDir = url, dir }
func showWindow(page string)      { openWindow(otherURL+page, otherDir) }
func windowOpen() bool            { return false }
func closeWindow()                {}
func appLink(link string) string  { return link }
