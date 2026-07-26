package imgproc

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	m := image.NewRGBA(image.Rect(0, 0, 2, 2))
	m.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, m); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestNormalizePNG(t *testing.T) {
	out, ctype, err := Normalize(tinyPNG(t))
	if err != nil || ctype != "image/png" {
		t.Fatalf("ctype %q err %v", ctype, err)
	}
	if _, err := png.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("output not png: %v", err)
	}
}

func TestNormalizeJPEG(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4)), nil); err != nil {
		t.Fatal(err)
	}
	out, ctype, err := Normalize(buf.Bytes())
	if err != nil || ctype != "image/jpeg" {
		t.Fatalf("ctype %q err %v", ctype, err)
	}
	if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
		t.Fatalf("output not jpeg: %v", err)
	}
}

func TestNormalizeGIFKeepsFrames(t *testing.T) {
	palette := color.Palette{color.Black, color.White}
	frame := func() *image.Paletted { return image.NewPaletted(image.Rect(0, 0, 2, 2), palette) }
	var buf bytes.Buffer
	err := gif.EncodeAll(&buf, &gif.GIF{
		Image:  []*image.Paletted{frame(), frame()},
		Delay:  []int{10, 10},
		Config: image.Config{Width: 2, Height: 2},
	})
	if err != nil {
		t.Fatal(err)
	}

	out, ctype, err := Normalize(buf.Bytes())
	if err != nil || ctype != "image/gif" {
		t.Fatalf("ctype %q err %v", ctype, err)
	}
	g, err := gif.DecodeAll(bytes.NewReader(out))
	if err != nil || len(g.Image) != 2 {
		t.Fatalf("frames %d err %v", len(g.Image), err)
	}
}

func TestNormalizeSVGSanitizes(t *testing.T) {
	in := []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
<script>alert(2)</script>
<rect width="10" height="10" fill="red"/>
<use href="https://evil.example/x.svg#p"/>
<use href="#local"/>
<foreignObject><body>html</body></foreignObject>
</svg>`)

	out, ctype, err := Normalize(in)
	if err != nil || ctype != "image/svg+xml" {
		t.Fatalf("ctype %q err %v", ctype, err)
	}
	s := string(out)
	for _, banned := range []string{"script", "alert", "onload", "evil.example", "foreignObject", "body"} {
		if strings.Contains(s, banned) {
			t.Fatalf("sanitized svg still contains %q: %s", banned, s)
		}
	}
	if !strings.Contains(s, "rect") || !strings.Contains(s, "#local") {
		t.Fatalf("sanitized svg lost content: %s", s)
	}
}

func TestNormalizeRejects(t *testing.T) {
	if _, _, err := Normalize(make([]byte, MaxBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	if _, _, err := Normalize([]byte("plain text, not an image")); !errors.Is(err, ErrFormat) {
		t.Fatalf("want ErrFormat, got %v", err)
	}
	if _, _, err := Normalize([]byte{0x89, 'P', 'N', 'G', 0, 0, 0, 0}); !errors.Is(err, ErrFormat) {
		t.Fatalf("want ErrFormat for truncated png, got %v", err)
	}
}
