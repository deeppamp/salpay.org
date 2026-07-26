package imgproc

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"strings"

	"encoding/xml"

	"golang.org/x/image/webp"
)

const (
	MaxBytes     = 512 * 1024
	maxDimension = 4096
)

var (
	ErrTooLarge = errors.New("image too large")
	ErrFormat   = errors.New("unsupported image format")
)

// Normalize validates an upload and returns clean bytes plus content type.
// Raster formats are decoded and encoded again, which strips metadata and
// polyglot payloads and preserves gif animation. svg goes through the xml
// sanitizer. webp comes back as png, Go has no webp encoder.
func Normalize(data []byte) ([]byte, string, error) {
	if len(data) > MaxBytes {
		return nil, "", ErrTooLarge
	}
	if len(data) < 8 {
		return nil, "", ErrFormat
	}

	switch {
	case bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G'}):
		img, err := decodeRaster(data, png.Decode)
		if err != nil {
			return nil, "", err
		}
		return encode(img, "image/png", func(w io.Writer, m image.Image) error { return png.Encode(w, m) })

	case bytes.HasPrefix(data, []byte{0xff, 0xd8}):
		img, err := decodeRaster(data, jpeg.Decode)
		if err != nil {
			return nil, "", err
		}
		return encode(img, "image/jpeg", func(w io.Writer, m image.Image) error {
			return jpeg.Encode(w, m, &jpeg.Options{Quality: 85})
		})

	case bytes.HasPrefix(data, []byte("GIF8")):
		return normalizeGIF(data)

	case len(data) > 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		img, err := decodeRaster(data, webp.Decode)
		if err != nil {
			return nil, "", err
		}
		return encode(img, "image/png", func(w io.Writer, m image.Image) error { return png.Encode(w, m) })

	case looksLikeSVG(data):
		clean, err := sanitizeSVG(data)
		if err != nil {
			return nil, "", err
		}
		return clean, "image/svg+xml", nil
	}

	return nil, "", ErrFormat
}

func decodeRaster(data []byte, decode func(io.Reader) (image.Image, error)) (image.Image, error) {
	img, err := decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFormat, err)
	}
	b := img.Bounds()
	if b.Dx() > maxDimension || b.Dy() > maxDimension {
		return nil, ErrTooLarge
	}
	return img, nil
}

func encode(img image.Image, contentType string, enc func(io.Writer, image.Image) error) ([]byte, string, error) {
	var buf bytes.Buffer
	if err := enc(&buf, img); err != nil {
		return nil, "", err
	}
	if buf.Len() > MaxBytes {
		return nil, "", ErrTooLarge
	}
	return buf.Bytes(), contentType, nil
}

func normalizeGIF(data []byte) ([]byte, string, error) {
	g, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrFormat, err)
	}
	if g.Config.Width > maxDimension || g.Config.Height > maxDimension {
		return nil, "", ErrTooLarge
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		return nil, "", err
	}
	if buf.Len() > MaxBytes {
		return nil, "", ErrTooLarge
	}
	return buf.Bytes(), "image/gif", nil
}

func looksLikeSVG(data []byte) bool {
	head := strings.ToLower(string(data[:min(len(data), 512)]))
	return strings.Contains(head, "<svg")
}

// sanitizeSVG drops scripts, event attributes, external references, and
// foreignObject. Comments, directives, and processing instructions are
// dropped as metadata. Namespace round tripping in encoding/xml is imperfect,
// harden with a dedicated sanitizer before production.
func sanitizeSVG(data []byte) ([]byte, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	var buf bytes.Buffer
	enc := xml.NewEncoder(&buf)

	skip := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrFormat, err)
		}

		switch t := tok.(type) {
		case xml.StartElement:
			if skip > 0 {
				skip++
				continue
			}
			local := strings.ToLower(t.Name.Local)
			if local == "script" || local == "foreignobject" {
				skip = 1
				continue
			}
			if err := enc.EncodeToken(xml.StartElement{Name: t.Name, Attr: filterAttrs(t.Attr)}); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			if err := enc.EncodeToken(t); err != nil {
				return nil, err
			}
		case xml.CharData:
			if skip > 0 {
				continue
			}
			if err := enc.EncodeToken(t); err != nil {
				return nil, err
			}
		}
	}

	if err := enc.Flush(); err != nil {
		return nil, err
	}
	if buf.Len() == 0 {
		return nil, ErrFormat
	}
	return buf.Bytes(), nil
}

func filterAttrs(attrs []xml.Attr) []xml.Attr {
	out := make([]xml.Attr, 0, len(attrs))
	for _, a := range attrs {
		local := strings.ToLower(a.Name.Local)
		if strings.HasPrefix(local, "on") {
			continue
		}
		if local == "href" && !strings.HasPrefix(strings.TrimSpace(a.Value), "#") {
			continue
		}
		out = append(out, a)
	}
	return out
}
