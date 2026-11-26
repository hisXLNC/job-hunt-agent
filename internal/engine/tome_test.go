package engine

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A file e-mailed to the person is a message a mail program can open: the
// words, then each file whole, addressed to the inbox's own address.
func TestAFileMailedToThePersonArrivesWhole(t *testing.T) {
	e, _ := newEngine(t)
	doc := bytes.Repeat([]byte{0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f}, 5000)
	set := MailSet{On: true, User: "me@example.test"}
	raw, err := e.messageWithFiles(set, set.User, "From Job Hunt: your CV “Finance & ops”", "Here is your CV.", []File{{Name: "Finance & ops.docx", Data: doc}, {Name: "Letter.pdf", Data: []byte("%PDF-1.4 x")}})
	if err != nil {
		t.Fatal(err)
	}
	m, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if to, _ := m.Header.AddressList("To"); len(to) != 1 || to[0].Address != set.User {
		t.Fatalf("to: %v", to)
	}
	if subj, _ := new(mime.WordDecoder).DecodeHeader(m.Header.Get("Subject")); !strings.Contains(subj, "Finance & ops") {
		t.Fatalf("subject: %q", subj)
	}
	kind, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil || kind != "multipart/mixed" {
		t.Fatalf("content type %q: %v", kind, err)
	}
	mr := multipart.NewReader(m.Body, params["boundary"])
	var names []string
	for i := 0; ; i++ {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		enc, _ := io.ReadAll(part)
		got, derr := base64.StdEncoding.DecodeString(strings.NewReplacer("\r", "", "\n", "").Replace(string(enc)))
		if derr != nil {
			t.Fatalf("part %d: %v", i, derr)
		}
		switch i {
		case 0:
			if !strings.Contains(string(got), "Here is your CV.") {
				t.Errorf("the words: %q", got)
			}
		case 1:
			if !bytes.Equal(got, doc) {
				t.Errorf("the Word file came back changed: %d bytes of %d", len(got), len(doc))
			}
		}
		names = append(names, part.FileName())
	}
	if len(names) != 3 || names[1] != "Finance & ops.docx" || names[2] != "Letter.pdf" {
		t.Fatalf("attachments: %q", names)
	}
}

// With no inbox connected there is nothing to send from, and it says so;
// a copy in the folder still works and gives the whole path.
func TestHandingOverACV(t *testing.T) {
	e, _ := newEngine(t)
	setUp(t, e)
	e.FilesHome = t.TempDir()
	cvs, _ := e.S.CVs()
	if len(cvs) == 0 {
		t.Fatal("no CV to hand over")
	}
	h := Handout{What: "cv", ID: cvs[0].ID}
	if _, _, err := e.MailHandout(t.Context(), h); err == nil || !strings.Contains(err.Error(), "inbox isn't connected") {
		t.Fatalf("mailing with no inbox: %v", err)
	}
	dir, paths, err := e.SaveHandout(h)
	if err != nil || len(paths) != 1 || filepath.Dir(paths[0]) != dir || !filepath.IsAbs(paths[0]) {
		t.Fatalf("saving: %q %q %v", dir, paths, err)
	}
	if st, err := os.Stat(paths[0]); err != nil || st.Size() == 0 {
		t.Fatalf("the copy: %v", err)
	}
	if _, _, err := e.SaveHandout(Handout{What: "role_cv", ID: 99999}); err == nil {
		t.Fatal("a role that isn't there was handed over")
	}
}
