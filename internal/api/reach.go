package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"rsc.io/qr"

	"jobhunt/internal/trace"
)

// Reaching Job Hunt from the person's phone, and reading their own calendar.
//
// The phone does not come in through the door the pages use: that one
// answers only this computer (see guard). Phone access is a second door,
// shut unless the person opens it, on its own port. Through it a phone that
// was paired by scanning a code shown on this computer can see a small page
// and make only the calls in phoneCalls. A phone proves itself with a key
// made here at pairing and kept in a cookie; only the key's hash is stored.
// None of these routes is on the assistant's list.

// PhoneDevice is one paired phone.
type PhoneDevice struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Hash  string `json:"hash,omitempty"`
	Added int64  `json:"added"`
	Seen  int64  `json:"seen"`
}

// PhoneAccess is the setting.
type PhoneAccess struct {
	On      bool          `json:"on"`
	Devices []PhoneDevice `json:"devices"`
}

type phoneState struct {
	mu     sync.Mutex
	ln     net.Listener
	err    string
	code   string
	codeAt time.Time
	misses int
}

const (
	phoneCookie  = "jhphone"
	phoneCodeFor = 10 * time.Minute
	phoneMost    = 5
)

func (s *Server) phoneAccess() PhoneAccess {
	var p PhoneAccess
	s.S.Get("phoneaccess", &p)
	return p
}

// PhonePort is the port the phone's door is on: the one after the pages'.
func (s *Server) PhonePort() int { return s.Port + 1 }

// phoneCalls is everything a paired phone may ask for. Looking, the role
// actions the person takes on the move (the letter and the CV's changes,
// follow-ups, their notes), people and the notes to them, adding a posting
// from a link, searching now, and the finished documents. No settings,
// keys, connections, saved copies, updates or the assistant; nothing that
// removes, closes or reopens.
var phoneCalls = []*regexp.Regexp{
	regexp.MustCompile(`^GET /api/today$`),
	regexp.MustCompile(`^GET /api/roles/\d+$`),
	regexp.MustCompile(`^POST /api/roles/\d+/(applied|no|later|unapply|prepare)$`),
	regexp.MustCompile(`^POST /api/roles/\d+/(letter|askletter|askcv|undoletter|undocv|change|notes|chase|chasesave|chasesent|chasedrop)$`),
	regexp.MustCompile(`^POST /api/roles/(link|chaseall)$`),
	regexp.MustCompile(`^POST /api/search$`),
	regexp.MustCompile(`^GET /api/people$`),
	regexp.MustCompile(`^GET /api/people/\d+$`),
	regexp.MustCompile(`^POST /api/people/\d+/note$`),
	regexp.MustCompile(`^PUT /api/notes/\d+$`),
	regexp.MustCompile(`^POST /api/notes/\d+/(sent|replied|quiet|later)$`),
	regexp.MustCompile(`^GET /api/roles/\d+/(cv|letter|both)\.pdf$`),
	regexp.MustCompile(`^GET /api/mail$`),
	regexp.MustCompile(`^GET /api/mail/\d+$`),
	regexp.MustCompile(`^GET /api/talks$`),
	regexp.MustCompile(`^GET /api/talks/\d+$`),
	regexp.MustCompile(`^GET /api/companies/\d+/logo$`),
}

func phoneMay(method, path string) bool {
	for _, re := range phoneCalls {
		if re.MatchString(method + " " + path) {
			return true
		}
	}
	return false
}

// lanAddresses are this computer's addresses a phone could reach it at.
// "home" is the local network; "anywhere" is a Tailscale address, which
// works from outside too when the phone runs Tailscale.
func lanAddresses() []map[string]string {
	out := []map[string]string{}
	addrs, _ := net.InterfaceAddrs()
	_, tail, _ := net.ParseCIDR("100.64.0.0/10")
	for _, a := range addrs {
		ipn, ok := a.(*net.IPNet)
		if !ok {
			continue
		}
		ip := ipn.IP.To4()
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		switch {
		case tail.Contains(ip):
			out = append(out, map[string]string{"ip": ip.String(), "kind": "anywhere"})
		default:
			// Nearly always a private address on the home network; a few
			// networks hand out other ones, and those work the same.
			out = append(out, map[string]string{"ip": ip.String(), "kind": "home"})
		}
	}
	return out
}

func (s *Server) phoneBase(kind string) string {
	list := lanAddresses()
	for _, a := range list {
		if a["kind"] == kind {
			return fmt.Sprintf("http://%s:%d", a["ip"], s.PhonePort())
		}
	}
	if kind == "" && len(list) > 0 {
		return fmt.Sprintf("http://%s:%d", list[0]["ip"], s.PhonePort())
	}
	return ""
}

// StartPhone opens or shuts the phone's door to match the setting. main
// calls it once at the start; saving the setting calls it again.
func (s *Server) StartPhone() {
	on := s.phoneAccess().On
	s.phone.mu.Lock()
	defer s.phone.mu.Unlock()
	if s.E.PhoneLink == nil {
		s.E.PhoneLink = func(page string) string {
			p := s.phoneAccess()
			if !p.On || len(p.Devices) == 0 {
				return ""
			}
			// A notice is read wherever the person is, so the address that
			// works away from home is preferred when there is one.
			base := s.phoneBase("anywhere")
			if base == "" {
				base = s.phoneBase("home")
			}
			if base == "" {
				return ""
			}
			return base + "/" + page
		}
	}
	if !on {
		if s.phone.ln != nil {
			s.phone.ln.Close()
			s.phone.ln = nil
		}
		s.phone.err, s.phone.code = "", ""
		return
	}
	if s.phone.ln != nil {
		return
	}
	ln, err := net.Listen("tcp4", fmt.Sprintf(":%d", s.PhonePort()))
	if err != nil {
		s.phone.err = fmt.Sprintf("Port %d on this computer is in use by another program, so a phone can't connect.", s.PhonePort())
		trace.Log("phone", "couldn't open the phone's door: %v", err)
		return
	}
	s.phone.ln, s.phone.err = ln, ""
	hs := &http.Server{Handler: s.phoneHandler(), ReadHeaderTimeout: 10 * time.Second}
	go hs.Serve(ln)
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func phoneName(ua string) string {
	switch {
	case strings.Contains(ua, "iPhone"):
		return "iPhone"
	case strings.Contains(ua, "iPad"):
		return "iPad"
	case strings.Contains(ua, "Android"):
		return "Android phone"
	}
	return "Phone or tablet"
}

func (s *Server) phoneDevice(r *http.Request) *PhoneDevice {
	c, err := r.Cookie(phoneCookie)
	if err != nil || !validKey(c.Value) {
		return nil
	}
	hash := hashKey(c.Value)
	p := s.phoneAccess()
	for i := range p.Devices {
		if subtle.ConstantTimeCompare([]byte(p.Devices[i].Hash), []byte(hash)) == 1 {
			d := p.Devices[i]
			if now := s.E.Now().Unix(); now-d.Seen > 600 {
				p.Devices[i].Seen = now
				s.S.Set("phoneaccess", p)
			}
			return &d
		}
	}
	return nil
}

func (s *Server) phoneHandler() http.Handler {
	sub, _ := fs.Sub(s.Web, "phone")
	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		if !s.phoneAccess().On {
			http.Error(w, "not here", http.StatusForbidden)
			return
		}
		switch {
		case r.URL.Path == "/pair" && r.Method == http.MethodGet:
			s.phonePair(w, r)
		case r.URL.Path == "/api/phone/me" && r.Method == http.MethodGet:
			d := s.phoneDevice(r)
			if d == nil {
				writeJSON(w, 401, map[string]string{"error": "This phone isn't paired with Job Hunt. On your computer open You, Connections, Phone access and scan the code."})
				return
			}
			writeJSON(w, 200, map[string]any{"name": d.Name, "version": Version, "now": s.E.Now().Unix()})
		case strings.HasPrefix(r.URL.Path, "/api/"):
			if s.phoneDevice(r) == nil {
				writeJSON(w, 401, map[string]string{"error": "This phone isn't paired with Job Hunt."})
				return
			}
			// A page on another site can make a phone's browser send a
			// form here, but not this header.
			if r.Method != http.MethodGet && r.Header.Get("X-JobHunt") != "1" {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				http.Error(w, "not allowed", http.StatusForbidden)
				return
			}
			if !phoneMay(r.Method, r.URL.Path) {
				writeJSON(w, 403, map[string]string{"error": "That can only be done on your computer."})
				return
			}
			s.mux.ServeHTTP(w, r)
		case r.Method == http.MethodGet:
			w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
			files.ServeHTTP(w, r)
		default:
			http.Error(w, "not allowed", http.StatusForbidden)
		}
	})
}

// phonePair turns the code a phone scanned into that phone's own key. A
// code works once, for ten minutes.
func (s *Server) phonePair(w http.ResponseWriter, r *http.Request) {
	got := r.URL.Query().Get("c")
	s.phone.mu.Lock()
	code, fresh := s.phone.code, time.Since(s.phone.codeAt) < phoneCodeFor
	ok := code != "" && fresh && subtle.ConstantTimeCompare([]byte(code), []byte(got)) == 1
	if ok {
		s.phone.code, s.phone.misses = "", 0
	} else if s.phone.misses++; s.phone.misses >= 10 {
		s.phone.code = "" // someone is guessing: the code is withdrawn
	}
	s.phone.mu.Unlock()
	if !ok {
		http.Redirect(w, r, "/#old", http.StatusSeeOther)
		return
	}
	key := randomHex(32)
	now := s.E.Now().Unix()
	p := s.phoneAccess()
	p.Devices = append(p.Devices, PhoneDevice{ID: randomHex(6), Name: phoneName(r.UserAgent()), Hash: hashKey(key), Added: now, Seen: now})
	if len(p.Devices) > phoneMost {
		p.Devices = p.Devices[len(p.Devices)-phoneMost:]
	}
	s.S.Set("phoneaccess", p)
	s.S.Changed("connections")
	http.SetCookie(w, &http.Cookie{Name: phoneCookie, Value: key, Path: "/", MaxAge: 400 * 86400, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// qrSVG draws text as a code a phone's camera reads.
func qrSVG(text string) string {
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		return ""
	}
	n := code.Size
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges"><rect width="100%%" height="100%%" fill="#fff"/><path fill="#000" d="`, n+8, n+8)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			if code.Black(x, y) {
				fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+4, y+4)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	return b.String()
}

func (s *Server) reachRoutes(h func(string, handler)) {
	e := s.E
	view := func() map[string]any {
		p := s.phoneAccess()
		devices := []PhoneDevice{}
		for _, d := range p.Devices {
			d.Hash = ""
			devices = append(devices, d)
		}
		s.phone.mu.Lock()
		problem := s.phone.err
		s.phone.mu.Unlock()
		return map[string]any{"on": p.On, "port": s.PhonePort(), "devices": devices, "problem": problem, "addresses": lanAddresses()}
	}
	h("GET /api/phoneaccess", func(w http.ResponseWriter, r *http.Request) (any, error) { return view(), nil })
	h("PUT /api/phoneaccess", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			On bool `json:"on"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		p := s.phoneAccess()
		p.On = in.On
		if err := s.S.Set("phoneaccess", p); err != nil {
			return nil, err
		}
		s.StartPhone()
		s.S.Changed("connections")
		return view(), nil
	})
	// The code a phone scans. kind is "home" (the same Wi-Fi) or "anywhere"
	// (a Tailscale address).
	h("POST /api/phoneaccess/code", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Kind string `json:"kind"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if !s.phoneAccess().On {
			return nil, bad("Turn phone access on first.")
		}
		if in.Kind != "anywhere" {
			in.Kind = "home"
		}
		base := s.phoneBase(in.Kind)
		if base == "" {
			if in.Kind == "anywhere" {
				return nil, bad("Tailscale isn't running on this computer.")
			}
			return nil, bad("This computer isn't on a network a phone could reach. Connect it to your Wi-Fi first.")
		}
		s.phone.mu.Lock()
		s.phone.code, s.phone.codeAt, s.phone.misses = randomHex(16), time.Now(), 0
		link := base + "/pair?c=" + s.phone.code
		s.phone.mu.Unlock()
		return map[string]any{"qr": qrSVG(link), "link": link, "address": base, "minutes": int(phoneCodeFor / time.Minute)}, nil
	})
	h("DELETE /api/phoneaccess/devices/{id}", func(w http.ResponseWriter, r *http.Request) (any, error) {
		p := s.phoneAccess()
		kept := []PhoneDevice{}
		for _, d := range p.Devices {
			if d.ID != r.PathValue("id") {
				kept = append(kept, d)
			}
		}
		p.Devices = kept
		if err := s.S.Set("phoneaccess", p); err != nil {
			return nil, err
		}
		s.S.Changed("connections")
		return view(), nil
	})
	// ---- the person's own calendar ---------------------------------------------------
	own := func() map[string]any {
		c := e.OwnCal()
		return map[string]any{"on": c.On, "known": e.CalendarKnown(), "has_url": c.URL != "", "at": c.At, "note": c.Note, "count": c.Count, "free": e.FreeTimes(max(5, e.TalkSet().Offer)), "talkset": e.TalkSet()}
	}
	h("GET /api/owncal", func(w http.ResponseWriter, r *http.Request) (any, error) {
		out := own()
		from, to := int64(qInt(r, "from", 0)), int64(qInt(r, "to", 0))
		if from > 0 && to > from && to-from <= 100*86400 {
			out["events"] = e.OwnEvents(from, to)
		}
		return out, nil
	})
	h("PUT /api/talkset", func(w http.ResponseWriter, r *http.Request) (any, error) {
		set := e.TalkSet()
		if err := read(r, &set); err != nil {
			return nil, err
		}
		if err := e.SetTalkSet(set); err != nil {
			return nil, bad(capitalise(err.Error()) + ".")
		}
		return nil, nil
	})
	h("PUT /api/owncal", func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			URL string `json:"url"`
		}
		if err := read(r, &in); err != nil {
			return nil, err
		}
		if _, err := e.SetOwnCal(r.Context(), in.URL); err != nil {
			return nil, bad(err.Error())
		}
		return own(), nil
	})
	h("DELETE /api/owncal", func(w http.ResponseWriter, r *http.Request) (any, error) { return own(), e.ForgetOwnCal() })
}
