package web

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// hostGet requests a path with a spoofed Host header against the fixture.
func hostGet(t *testing.T, f fixture, host, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("GET", f.srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = host
	resp, err := f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestNameHostServesImgAndAddress(t *testing.T) {
	ctx := context.Background()
	f := setup(t)

	f.postForm(t, "/signup", url.Values{"username": {"nina"}, "password": {"long enough pass"}}).Body.Close()
	resp := f.postForm(t, "/buy", url.Values{"name": {"nina"}, "address": {testAddress}})
	invoiceID := strings.TrimPrefix(resp.Request.URL.Path, "/invoice/")
	resp.Body.Close()
	inv, err := f.mgr.Get(ctx, invoiceID)
	if err != nil {
		t.Fatal(err)
	}
	f.wallet.Pay(inv.SubaddrIndex, inv.AmountAtomic, 3)
	if err := f.mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	r := hostGet(t, f, "nina.sal.cash", "/address")
	if got := body(t, r); strings.TrimSpace(got) != testAddress {
		t.Fatalf("address body %q", got)
	}
	if r.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("address missing cors header")
	}

	r = hostGet(t, f, "nina.sal.cash", "/img")
	if r.Header.Get("Content-Type") != "image/png" || r.StatusCode != 200 {
		t.Fatalf("img: %d %s", r.StatusCode, r.Header.Get("Content-Type"))
	}
	r.Body.Close()

	// unknown name 404s, unknown path 404s, root redirects home
	r = hostGet(t, f, "ghost.sal.cash", "/address")
	if r.StatusCode != http.StatusNotFound {
		t.Fatalf("ghost: %d", r.StatusCode)
	}
	r.Body.Close()
	r = hostGet(t, f, "nina.sal.cash", "/wat")
	if r.StatusCode != http.StatusNotFound {
		t.Fatalf("wat: %d", r.StatusCode)
	}
	r.Body.Close()

	// the app still answers on the bare zone and www
	for _, host := range []string{"sal.cash", "www.sal.cash"} {
		r = hostGet(t, f, host, "/")
		if got := body(t, r); !strings.Contains(got, "sal alias") {
			t.Fatalf("%s did not serve the app: %.200s", host, got)
		}
	}
}
