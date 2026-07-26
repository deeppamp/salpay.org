package img

import (
	"errors"
	"net/http"
	"path"
	"strings"

	qrcode "github.com/skip2/go-qrcode"

	"github.com/deeppamp/salpay.org/salpay/manager/registry"
)

const qrSize = 512

// QRPNG renders a qr code of a bare address, the free default image.
func QRPNG(address string) ([]byte, error) {
	return qrcode.Encode(address, qrcode.Medium, qrSize)
}

// Handler serves GET <base>/<label>.png. Today that is always the qr code of
// the name's current address; custom library images take precedence later.
type Handler struct {
	reg *registry.Registry
}

func NewHandler(reg *registry.Registry) *Handler {
	return &Handler{reg: reg}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	file := path.Base(r.URL.Path)
	label, ok := strings.CutSuffix(file, ".png")
	if !ok {
		http.NotFound(w, r)
		return
	}

	name, err := h.reg.Lookup(r.Context(), label)
	if errors.Is(err, registry.ErrNotFound) || errors.Is(err, registry.ErrInvalid) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	data, contentType, ok, err := h.reg.ActiveImage(r.Context(), name.Label)
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	if !ok {
		data, err = QRPNG(name.Address)
		if err != nil {
			http.Error(w, "image generation failed", http.StatusInternalServerError)
			return
		}
		contentType = "image/png"
	}

	WriteImage(w, data, contentType)
}

// WriteImage serves image bytes with the standard headers. Cache ttl matches
// the dns record ttl so image switches and address changes propagate on the
// same clock. svg gets a no execution csp.
func WriteImage(w http.ResponseWriter, data []byte, contentType string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if contentType == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	}
	w.Write(data)
}
