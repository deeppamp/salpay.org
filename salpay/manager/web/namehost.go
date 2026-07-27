package web

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/deeppamp/salpay.org/salpay/manager/img"
	"github.com/deeppamp/salpay.org/salpay/manager/registry"
)

// NameHost serves each name's public endpoints on its own hostname, the
// same fqdn that carries the TXT record: <label>.<zone>/img is the avatar,
// <label>.<zone>/address the current Salvium address. Everything else
// falls through to the app.
type NameHost struct {
	reg  *registry.Registry
	zone string
	app  http.Handler
}

func NewNameHost(reg *registry.Registry, zone string, app http.Handler) *NameHost {
	return &NameHost{reg: reg, zone: zone, app: app}
}

func (n *NameHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host := strings.ToLower(r.Host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	label, ok := strings.CutSuffix(host, "."+n.zone)
	if !ok || label == "" || label == "www" || strings.Contains(label, ".") {
		n.app.ServeHTTP(w, r)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name, err := n.reg.Lookup(r.Context(), label)
	if errors.Is(err, registry.ErrNotFound) || errors.Is(err, registry.ErrInvalid) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	// public data on a public host, browsers may fetch cross origin
	w.Header().Set("Access-Control-Allow-Origin", "*")

	switch r.URL.Path {
	case "/img":
		data, contentType, ok, err := n.reg.ActiveImage(r.Context(), name.Label)
		if err != nil {
			http.Error(w, "lookup failed", http.StatusInternalServerError)
			return
		}
		if !ok {
			data, err = img.QRPNG(name.Address)
			if err != nil {
				http.Error(w, "image generation failed", http.StatusInternalServerError)
				return
			}
			contentType = "image/png"
		}
		img.WriteImage(w, data, contentType)
	case "/address":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Write([]byte(name.Address + "\n"))
	case "/":
		http.Redirect(w, r, "https://"+n.zone+"/", http.StatusFound)
	default:
		http.NotFound(w, r)
	}
}
