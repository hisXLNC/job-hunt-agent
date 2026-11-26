package engine

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"time"

	"jobhunt/internal/store"
)

// Files the person asks to have handed to them: a copy in a folder they can
// open, or by e-mail to their own address. The address is always the one
// the inbox is connected with; nothing here can write to anyone else.

// Handout names one file of the person's: one of their CVs, or a role's
// tailored CV, letter, or both.
type Handout struct {
	What   string `json:"what"`   // "cv" | "role_cv" | "role_letter" | "role_both"
	ID     int64  `json:"id"`     // the CV's or the role's number
	Format string `json:"format"` // "docx" (the usual) | "pdf", for a role's files
}

// handoutFiles makes the files a handout names, and says what they are.
func (e *Engine) handoutFiles(h Handout) (files []File, what string, err error) {
	pdf := strings.EqualFold(h.Format, "pdf")
	one := func(f File, ferr error, label string) ([]File, string, error) {
		if ferr != nil {
			return nil, "", ferr
		}
		return []File{f}, label, nil
	}
	roleLabel := func() (string, error) {
		r, rerr := e.S.Role(h.ID)
		if rerr != nil {
			return "", rerr
		}
		return r.Title + " at " + r.Company, nil
	}
	switch h.What {
	case "cv":
		c, cerr := e.S.CV(h.ID)
		if cerr != nil {
			return nil, "", cerr
		}
		f, ferr := e.BaseCVFile(h.ID)
		return one(f, ferr, "your CV “"+c.Name+"”")
	case "role_cv", "role_letter", "role_both":
		label, lerr := roleLabel()
		if lerr != nil {
			return nil, "", lerr
		}
		var cv, letter File
		var cerr, terr error
		if pdf {
			cv, cerr = e.CVPDF(h.ID)
			letter, terr = e.LetterPDF(h.ID)
		} else {
			cv, cerr = e.CVFile(h.ID)
			letter, terr = e.LetterFile(h.ID)
		}
		switch h.What {
		case "role_cv":
			return one(cv, cerr, "the CV for "+label)
		case "role_letter":
			return one(letter, terr, "the letter for "+label)
		}
		if cerr != nil {
			return nil, "", cerr
		}
		files = []File{cv}
		if terr == nil {
			files = append(files, letter)
		}
		return files, "the CV and letter for " + label, nil
	}
	return nil, "", errors.New("say which file: one of your CVs, or a role's CV or letter")
}

// SaveHandout writes the files into the files folder (in "CVs" for a CV of
// the person's own) and returns the folder and each file's whole path.
func (e *Engine) SaveHandout(h Handout) (dir string, paths []string, err error) {
	files, _, err := e.handoutFiles(h)
	if err != nil {
		return "", nil, err
	}
	_, home := e.Files()
	if home == "" {
		home = e.FilesHome
	}
	if home == "" {
		// No Documents folder known here: beside Job Hunt's own data.
		home = filepath.Join(e.Dir, "files")
	}
	dir = filepath.Join(home, "CVs")
	if h.What != "cv" {
		if r, rerr := e.S.Role(h.ID); rerr == nil {
			dir = filepath.Join(home, roleFolder(r))
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("Job Hunt couldn't make the folder %s: %v", dir, err)
	}
	for _, f := range files {
		p := filepath.Join(dir, filepath.Base(f.Name))
		if err := os.WriteFile(p, f.Data, 0o644); err != nil {
			return "", nil, fmt.Errorf("Job Hunt couldn't write %s: %v", p, err)
		}
		paths = append(paths, p)
	}
	return dir, paths, nil
}

// MailHandout sends the files to the person's own address, the one the
// inbox is connected with, and says where it went and what was sent.
func (e *Engine) MailHandout(ctx context.Context, h Handout) (to, what string, err error) {
	set := e.MailSet()
	if !set.On || set.User == "" {
		return "", "", errors.New("your inbox isn't connected, so Job Hunt has nothing to send from. Connect it under Settings, Connections")
	}
	files, what, err := e.handoutFiles(h)
	if err != nil {
		return "", "", err
	}
	msg, err := e.messageWithFiles(set, set.User, "From Job Hunt: "+what, "Here is "+what+", as you asked.\n\nSent to you by Job Hunt on your own computer.", files)
	if err != nil {
		return "", "", err
	}
	if err := e.smtpSend(ctx, set, set.User, msg); err != nil {
		return "", "", err
	}
	e.S.Log(store.Activity{Kind: "mail", Text: "Job Hunt e-mailed you " + what})
	return set.User, what, nil
}

// messageWithFiles is a plain message with files attached.
func (e *Engine) messageWithFiles(set MailSet, to, subject, body string, files []File) ([]byte, error) {
	if len(files) == 0 {
		return nil, errors.New("there is no file to send")
	}
	total := 0
	for _, f := range files {
		total += len(f.Data)
	}
	if total > 18<<20 {
		return nil, errors.New("those files are too large to e-mail")
	}
	var b bytes.Buffer
	boundary := fmt.Sprintf("jobhunt-%x", time.Now().UnixNano())
	from := mail.Address{Name: oneLine(e.S.Profile().Name), Address: set.User}
	fmt.Fprintf(&b, "From: %s\r\nTo: %s\r\n", from.String(), (&mail.Address{Address: to}).String())
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", oneLine(subject)))
	fmt.Fprintf(&b, "Date: %s\r\n", e.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=%q\r\n\r\n", boundary)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n", boundary)
	wrap64(&b, []byte(body+"\n"))
	for _, f := range files {
		name := filepath.Base(f.Name)
		kind := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		switch strings.ToLower(filepath.Ext(name)) {
		case ".docx":
			kind = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		case ".pdf":
			kind = "application/pdf"
		}
		if kind == "" {
			kind = "application/octet-stream"
		}
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: %s\r\n\r\n",
			boundary, kind, mime.FormatMediaType("attachment", map[string]string{"filename": name}))
		wrap64(&b, f.Data)
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

func wrap64(b *bytes.Buffer, data []byte) {
	s := base64.StdEncoding.EncodeToString(data)
	for len(s) > 76 {
		b.WriteString(s[:76] + "\r\n")
		s = s[76:]
	}
	b.WriteString(s + "\r\n")
}
