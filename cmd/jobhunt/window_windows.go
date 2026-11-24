package main

import (
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"jobhunt/internal/trace"
)

// Job Hunt's own window: a Windows window with the pages inside it (the
// WebView2 part of Windows draws them). It is not a browser window, so it
// has no address bar, none of the browser's extensions and none of their
// banners, and it comes back where and how big the person left it.

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	pGetWindowPlacement  = user32.NewProc("GetWindowPlacement")
	pSetWindowPlacement  = user32.NewProc("SetWindowPlacement")
	pMonitorFromRect     = user32.NewProc("MonitorFromRect")
	pIsWindow            = user32.NewProc("IsWindow")
	pIsIconic            = user32.NewProc("IsIconic")
	pShowWindow          = user32.NewProc("ShowWindow")
	pSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	pGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	pGetDpiForSystem     = user32.NewProc("GetDpiForSystem")
	pSetDpiAwarenessCtx  = user32.NewProc("SetProcessDpiAwarenessContext")
	pFindWindowW         = user32.NewProc("FindWindowW")
	pDestroyWindow       = user32.NewProc("DestroyWindow")
)

type winPoint struct{ X, Y int32 }
type winRect struct{ L, T, R, B int32 }
type winPlacement struct {
	Length, Flags, ShowCmd uint32
	Min, Max               winPoint
	Normal                 winRect
}

// windowState is what is remembered between runs.
type windowState struct {
	L, T, R, B int32
	Max        bool
}

type nativeWindow struct {
	url, dir string
	ask      chan string
	mu       sync.Mutex
	w        webview2.WebView
	hwnd     uintptr
	broken   bool // this computer can't show the window; a browser is used instead
}

var win *nativeWindow

// sharpOnEveryScreen tells Windows this program draws at the screen's own
// scale. Without it the window is drawn small and stretched, and looks soft.
func sharpOnEveryScreen() {
	if pSetDpiAwarenessCtx.Find() == nil {
		pSetDpiAwarenessCtx.Call(^uintptr(3)) // per monitor, version 2
	}
}

// hasWebView2 says whether the part of Windows that draws the pages is
// installed. It is on Windows 11 and on every Windows 10 that has Edge.
func hasWebView2() bool {
	const id = `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
	for _, at := range []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\` + id},
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\EdgeUpdate\Clients\` + id},
		{registry.CURRENT_USER, `Software\Microsoft\EdgeUpdate\Clients\` + id},
	} {
		k, err := registry.OpenKey(at.root, at.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		v, _, err := k.GetStringValue("pv")
		k.Close()
		if err == nil && v != "" && v != "0.0.0.0" {
			return true
		}
	}
	return false
}

func startWindow(url, dir string) {
	sharpOnEveryScreen()
	win = &nativeWindow{url: url, dir: dir, ask: make(chan string, 4), broken: !hasWebView2()}
	go win.loop()
}

// showWindow opens Job Hunt's window, or brings it to the front, on the
// page given ("" or "#/roles/5").
func showWindow(page string) {
	n := win
	if n == nil {
		return
	}
	n.mu.Lock()
	w, hwnd, broken := n.w, n.hwnd, n.broken
	n.mu.Unlock()
	switch {
	case broken:
		openWindow(n.url+page, n.dir)
	case w != nil:
		if r, _, _ := pIsIconic.Call(hwnd); r != 0 {
			pShowWindow.Call(hwnd, 9) // restore
		}
		pSetForegroundWindow.Call(hwnd)
		if page != "" {
			js, _ := json.Marshal(page)
			w.Dispatch(func() { w.Eval("location.hash = " + string(js)) })
		}
	default:
		select {
		case n.ask <- page:
		default:
		}
	}
}

func windowOpen() bool {
	n := win
	if n == nil {
		return false
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.w != nil
}

func closeWindow() {
	n := win
	if n == nil {
		return
	}
	n.mu.Lock()
	w := n.w
	n.mu.Unlock()
	if w != nil {
		w.Destroy()
		time.Sleep(300 * time.Millisecond) // long enough for where it was to be written down
	}
}

// loop owns the window. Windows wants a window made, run and closed on one
// thread, so this goroutine keeps its thread for good.
func (n *nativeWindow) loop() {
	runtime.LockOSThread()
	for page := range n.ask {
		if !n.open(page) {
			n.mu.Lock()
			n.broken = true
			n.mu.Unlock()
			openWindow(n.url+page, n.dir)
		}
	}
}

func (n *nativeWindow) stateFile() string { return filepath.Join(n.dir, "window.json") }

func (n *nativeWindow) open(page string) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			trace.Log("window", "the window could not be made: %v", r)
			ok = false
		}
	}()
	// The first time: a comfortable size for this screen, in the middle.
	scale := 1.0
	if pGetDpiForSystem.Find() == nil {
		if dpi, _, _ := pGetDpiForSystem.Call(); dpi >= 96 {
			scale = float64(dpi) / 96
		}
	}
	sw, _, _ := pGetSystemMetrics.Call(0)
	sh, _, _ := pGetSystemMetrics.Call(1)
	width, height := int(1440*scale), int(940*scale)
	if sw > 200 && width > int(sw)-40 {
		width = int(sw) - 40
	}
	if sh > 200 && height > int(sh)-80 {
		height = int(sh) - 80
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:         true, // keeps the right-click menu (copy, paste)
		AutoFocus:     true,
		DataPath:      filepath.Join(n.dir, "webview"),
		WindowOptions: webview2.WindowOptions{Title: "Job Hunt", Width: uint(width), Height: uint(height), IconId: 1, Center: true},
	})
	if w == nil {
		trace.Log("window", "Windows would not draw the pages in Job Hunt's own window; using the browser")
		// The frame was made before the inside failed: take it away.
		class, _ := windows.UTF16PtrFromString("webview")
		title, _ := windows.UTF16PtrFromString("Job Hunt")
		if h, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title))); h != 0 {
			pDestroyWindow.Call(h)
		}
		return false
	}
	hwnd := uintptr(w.Window())
	last, had := n.restore(hwnd)
	// A posting, LinkedIn, a download page: those open in the person's own
	// browser, where the side panel is. Only Job Hunt's pages live here.
	w.Bind("jhOpen", func(link string) {
		if u, err := url.Parse(link); err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
			exec.Command("rundll32", "url.dll,FileProtocolHandler", u.String()).Start()
		}
	})
	w.Bind("jhShown", func(page string) {
		if len(page) > 80 {
			page = page[:80]
		}
		trace.Log("window", "showing %q", page)
	})
	w.Init("window.jhNative = true; addEventListener('load', function () { if (window.jhShown) window.jhShown(location.hash); });")
	w.Navigate(n.url + page)
	n.mu.Lock()
	n.w, n.hwnd = w, hwnd
	n.mu.Unlock()

	done := make(chan struct{})
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if st, ok := placementOf(hwnd); ok && (!had || st != last) {
					last, had = st, true
					if b, err := json.Marshal(st); err == nil {
						os.WriteFile(n.stateFile(), b, 0o600)
					}
				}
			}
		}
	}()
	w.Run()
	close(done)
	n.mu.Lock()
	n.w, n.hwnd = nil, 0
	n.mu.Unlock()
	return true
}

func placementOf(hwnd uintptr) (windowState, bool) {
	if r, _, _ := pIsWindow.Call(hwnd); r == 0 {
		return windowState{}, false
	}
	p := winPlacement{Length: uint32(unsafe.Sizeof(winPlacement{}))}
	if r, _, _ := pGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&p))); r == 0 {
		return windowState{}, false
	}
	if p.Normal.R-p.Normal.L < 200 || p.Normal.B-p.Normal.T < 150 {
		return windowState{}, false
	}
	return windowState{L: p.Normal.L, T: p.Normal.T, R: p.Normal.R, B: p.Normal.B, Max: p.ShowCmd == 3}, true
}

// restore puts the window back where it was, if that place is still on a
// screen (a second monitor may have been unplugged since).
func (n *nativeWindow) restore(hwnd uintptr) (windowState, bool) {
	var st windowState
	b, err := os.ReadFile(n.stateFile())
	if err != nil || json.Unmarshal(b, &st) != nil || st.R-st.L < 200 || st.B-st.T < 150 {
		return st, false
	}
	r := winRect{st.L, st.T, st.R, st.B}
	if m, _, _ := pMonitorFromRect.Call(uintptr(unsafe.Pointer(&r)), 0); m == 0 {
		return st, false
	}
	p := winPlacement{Length: uint32(unsafe.Sizeof(winPlacement{})), ShowCmd: 1, Normal: r}
	if st.Max {
		p.ShowCmd = 3
	}
	pSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&p)))
	return st, true
}

// appLink turns one of Job Hunt's own page addresses into a link Windows
// hands back to Job Hunt (set up by the installer), so a click on a
// notification opens the page in Job Hunt's window, not in a browser.
func appLink(link string) string {
	_, page, ok := strings.Cut(link, "#/")
	if !ok || !pageOK("#/"+page) {
		return link
	}
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\jobhunt3\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return link
	}
	k.Close()
	return "jobhunt3://open/" + page
}
