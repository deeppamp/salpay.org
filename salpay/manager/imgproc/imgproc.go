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

// svgElements is the element allowlist. Anything else loses its whole
// subtree: script, foreignObject, style, image, filter, and the SMIL
// animation family (which can rewrite href to javascript:) all fall out
// here rather than by name.
var svgElements = map[string]bool{
	"svg": true, "g": true, "defs": true, "symbol": true, "use": true,
	"title": true, "desc": true, "a": true,
	"path": true, "rect": true, "circle": true, "ellipse": true, "line": true,
	"polyline": true, "polygon": true, "text": true, "tspan": true, "textpath": true,
	"lineargradient": true, "radialgradient": true, "stop": true,
	"clippath": true, "mask": true, "pattern": true, "marker": true,
}

// svgAttrs is the attribute allowlist, lowercase local names. Values still
// pass safeValue, and href is handled separately.
var svgAttrs = map[string]bool{
	"id": true, "class": true, "lang": true, "space": true, "style": true,
	"version": true, "baseprofile": true,
	"x": true, "y": true, "x1": true, "y1": true, "x2": true, "y2": true,
	"cx": true, "cy": true, "r": true, "rx": true, "ry": true,
	"dx": true, "dy": true, "d": true, "points": true,
	"width": true, "height": true, "viewbox": true, "preserveaspectratio": true,
	"transform": true, "gradienttransform": true, "gradientunits": true,
	"patterntransform": true, "patternunits": true, "patterncontentunits": true,
	"spreadmethod": true, "offset": true, "rotate": true,
	"lengthadjust": true, "textlength": true,
	"clippathunits": true, "maskunits": true, "maskcontentunits": true,
	"markerunits": true, "markerwidth": true, "markerheight": true,
	"refx": true, "refy": true, "orient": true,
	"fill": true, "fill-opacity": true, "fill-rule": true,
	"stroke": true, "stroke-width": true, "stroke-linecap": true,
	"stroke-linejoin": true, "stroke-miterlimit": true, "stroke-dasharray": true,
	"stroke-dashoffset": true, "stroke-opacity": true,
	"opacity": true, "color": true, "stop-color": true, "stop-opacity": true,
	"display": true, "visibility": true, "overflow": true,
	"clip-path": true, "clip-rule": true, "mask": true,
	"marker-start": true, "marker-mid": true, "marker-end": true,
	"font-family": true, "font-size": true, "font-weight": true,
	"font-style": true, "font-variant": true, "font-stretch": true,
	"letter-spacing": true, "word-spacing": true, "text-anchor": true,
	"text-decoration": true, "dominant-baseline": true,
	"alignment-baseline": true, "baseline-shift": true,
}

// sanitizeSVG rebuilds the document keeping only allowlisted elements and
// attributes, so new attack surface is excluded by default instead of
// enumerated. Comments, directives, and processing instructions never
// reach the encoder; the root must be svg.
func sanitizeSVG(data []byte) ([]byte, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	var buf bytes.Buffer
	enc := xml.NewEncoder(&buf)

	skip := 0
	seenRoot := false
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
			if !seenRoot {
				if local != "svg" {
					return nil, fmt.Errorf("%w: root element %s", ErrFormat, local)
				}
				seenRoot = true
			}
			if !svgElements[local] {
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
	if !seenRoot || buf.Len() == 0 {
		return nil, ErrFormat
	}
	if buf.Len() > MaxBytes {
		return nil, ErrTooLarge
	}
	return buf.Bytes(), nil
}

func filterAttrs(attrs []xml.Attr) []xml.Attr {
	out := make([]xml.Attr, 0, len(attrs))
	for _, a := range attrs {
		local := strings.ToLower(a.Name.Local)
		switch {
		case a.Name.Space == "xmlns" || local == "xmlns":
			// dropped: the encoder re-emits namespaces from element names,
			// keeping the attr would duplicate xmlns and break strict parsers
			continue
		case local == "href":
			if !strings.HasPrefix(strings.TrimSpace(a.Value), "#") {
				continue
			}
		default:
			if !svgAttrs[local] || !safeValue(a.Value) {
				continue
			}
		}
		out = append(out, a)
	}
	return out
}

// safeValue rejects attribute values that reach outside the document.
// Backslashes and comment openers are banned outright: css escaping and
// token splitting are how "url(" scanners get evaded.
func safeValue(v string) bool {
	c := strings.ToLower(v)
	for _, bad := range []string{"javascript:", "data:", "@import", "expression(", "behavior:", "-moz-binding", `\`, "/*", "&{"} {
		if strings.Contains(c, bad) {
			return false
		}
	}
	rest := c
	for {
		i := strings.Index(rest, "url(")
		if i < 0 {
			return true
		}
		rest = strings.TrimLeft(rest[i+len("url("):], ` '"`)
		if !strings.HasPrefix(rest, "#") {
			return false
		}
	}
}
