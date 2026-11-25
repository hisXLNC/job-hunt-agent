package office

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"
)

func signaturePNG(t *testing.T) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, 300, 100))
	for x := 20; x < 280; x++ {
		img.Set(x, 50+x%20, color.NRGBA{0, 0, 80, 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// A signature picture sits between the closing and the name, in Word and in PDF.
func TestLetterWithSignaturePicture(t *testing.T) {
	if _, err := ReadPicture([]byte("not a picture")); err == nil {
		t.Fatal("text must be refused")
	}
	pic, err := ReadPicture(signaturePNG(t))
	if err != nil || pic.W != 300 || pic.H != 100 || pic.Ext != "png" {
		t.Fatalf("pic = %+v, %v", pic, err)
	}
	l := Letter{Name: "Sam Rivera", Body: "Dear team,\n\nHello.", Signature: []string{"Kind regards,", "Sam Rivera"}, Picture: &pic}

	data, err := RenderLetter(l)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		files[f.Name] = string(b)
	}
	if files["word/media/signature.png"] == "" || !strings.Contains(files["word/_rels/document.xml.rels"], "media/signature.png") || !strings.Contains(files["[Content_Types].xml"], `Extension="png"`) {
		t.Fatal("the picture is not in the Word file")
	}
	doc := files["word/document.xml"]
	closing, drawing, name := strings.Index(doc, "Kind regards,"), strings.Index(doc, `r:embed="rId9"`), strings.LastIndex(doc, "Sam Rivera")
	if !(closing < drawing && drawing < name) {
		t.Fatalf("order: closing %d, picture %d, name %d", closing, drawing, name)
	}
	if text, err := ExtractText("l.docx", data); err != nil || !strings.Contains(text, "Kind regards") {
		t.Fatalf("the Word file must still read: %v", err)
	}

	p, err := RenderLetterPDF(l)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(p, []byte("/XObject << /Im1")) || !bytes.Contains(p, []byte("/Subtype /Image /Width 300 /Height 100")) {
		t.Fatal("the picture is not in the PDF")
	}
	// Without a picture nothing changes.
	l.Picture = nil
	plain, _ := RenderLetterPDF(l)
	if bytes.Contains(plain, []byte("XObject")) {
		t.Fatal("no picture, no image")
	}
}
