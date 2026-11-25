package office

import (
	"bytes"
	"compress/zlib"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	_ "image/png"
)

// Picture is the person's signature, written by hand, placed in a letter
// between the closing and their name. Letters only: a CV stays text.
type Picture struct {
	Data []byte
	Ext  string // "png" or "jpeg"
	W, H int    // in pixels
}

// ReadPicture checks a PNG or JPEG file and reads its size.
func ReadPicture(data []byte) (Picture, error) {
	if len(data) > 3<<20 {
		return Picture{}, errors.New("the picture is over 3 MB")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return Picture{}, errors.New("use a PNG or JPEG picture")
	}
	if cfg.Width < 10 || cfg.Height < 5 || cfg.Width > 4000 || cfg.Height > 4000 {
		return Picture{}, errors.New("the picture is too small or too large")
	}
	return Picture{Data: data, Ext: format, W: cfg.Width, H: cfg.Height}, nil
}

// size is the picture's size on the page, in points: half an inch high,
// at most two and a half inches wide.
func (p *Picture) size() (w, h float64) {
	h = 36
	w = h * float64(p.W) / float64(p.H)
	if w > 180 {
		w, h = 180, 180*float64(p.H)/float64(p.W)
	}
	return
}

// drawingXML is the picture as a Word inline drawing, in its own paragraph.
func (p *Picture) drawingXML() string {
	w, h := p.size()
	cx, cy := int(w*12700), int(h*12700)
	return fmt.Sprintf(`<w:p><w:pPr><w:pStyle w:val="LetterLine"/><w:spacing w:before="80" w:after="40"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/><wp:docPr id="1" name="Signature"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="signature.%s"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
		cx, cy, p.mediaExt(), cx, cy)
}

func (p *Picture) mediaExt() string {
	if p.Ext == "jpeg" {
		return "jpeg"
	}
	return "png"
}

// pdfImage is the picture as a PDF image object: RGB, flattened onto white
// (a PDF reader shows white where a PNG was see-through), at most 1200
// pixels across.
func (p *Picture) pdfImage() ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(p.Data))
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	step := 1
	for w/step > 1200 {
		step++
	}
	ow, oh := w/step, h/step
	raw := make([]byte, 0, ow*oh*3)
	for y := 0; y < oh; y++ {
		for x := 0; x < ow; x++ {
			c := color.NRGBAModel.Convert(img.At(b.Min.X+x*step, b.Min.Y+y*step)).(color.NRGBA)
			a := int(c.A)
			blend := func(v uint8) byte { return byte((int(v)*a + 255*(255-a)) / 255) }
			raw = append(raw, blend(c.R), blend(c.G), blend(c.B))
		}
	}
	var z bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&z, zlib.BestCompression)
	zw.Write(raw)
	zw.Close()
	var out bytes.Buffer
	fmt.Fprintf(&out, "<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n", ow, oh, z.Len())
	out.Write(z.Bytes())
	out.WriteString("\nendstream")
	return out.Bytes(), nil
}
