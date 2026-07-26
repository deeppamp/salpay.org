package web

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/accounts"
	"github.com/deeppamp/salpay.org/salpay/manager/dns"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/pin"
	"github.com/deeppamp/salpay.org/salpay/manager/registry"
	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

const (
	testAddress  = "SC1" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn"
	testAddress2 = "SC2" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn"
)

type fixture struct {
	srv    *httptest.Server
	client *http.Client
	mgr    *invoice.Manager
	wallet *walletrpc.Mock
	writer *dns.Mock
}

func setup(t *testing.T) fixture {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	wallet := walletrpc.NewMock()
	mgr, err := invoice.New(db, wallet, 1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	writer := dns.NewMock()
	reg, err := registry.New(db, mgr, writer, pin.NewMock(), "salpay.org", "")
	if err != nil {
		t.Fatal(err)
	}
	acc, err := accounts.New(db, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{
		Zone:     "salpay.org",
		FeeShort: 2000 * walletrpc.AtomicUnits,
		FeeMid:   500 * walletrpc.AtomicUnits,
		FeeLong:  100 * walletrpc.AtomicUnits,
		FeeSlots: 20 * walletrpc.AtomicUnits,
	}, acc, reg, mgr)
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	return fixture{srv: srv, client: &http.Client{Jar: jar}, mgr: mgr, wallet: wallet, writer: writer}
}

func (f fixture) postForm(t *testing.T, path string, form url.Values) *http.Response {
	t.Helper()
	resp, err := f.client.PostForm(f.srv.URL+path, form)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func body(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSignupBuyPayManage(t *testing.T) {
	ctx := context.Background()
	f := setup(t)

	resp := f.postForm(t, "/signup", url.Values{"email": {"alice@example.com"}, "password": {"long enough pass"}})
	if got := body(t, resp); !strings.Contains(got, "alice@example.com") {
		t.Fatalf("signup did not land on account page: %.200s", got)
	}

	resp = f.postForm(t, "/buy", url.Values{"name": {"alice"}, "address": {testAddress}})
	if !strings.HasPrefix(resp.Request.URL.Path, "/invoice/") {
		t.Fatalf("buy did not redirect to invoice: %s", resp.Request.URL.Path)
	}
	invoiceID := strings.TrimPrefix(resp.Request.URL.Path, "/invoice/")
	if got := body(t, resp); !strings.Contains(got, "SCmock") {
		t.Fatalf("invoice page missing subaddress: %.200s", got)
	}

	var status struct {
		Status    string `json:"status"`
		Fulfilled bool   `json:"fulfilled"`
		Label     string `json:"label"`
	}
	get := func() {
		r, err := f.client.Get(f.srv.URL + "/api/invoice/" + invoiceID)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&status); err != nil {
			t.Fatal(err)
		}
	}
	get()
	if status.Status != "pending" {
		t.Fatalf("want pending, got %+v", status)
	}

	inv, err := f.mgr.Get(ctx, invoiceID)
	if err != nil {
		t.Fatal(err)
	}
	f.wallet.Pay(inv.SubaddrIndex, inv.AmountAtomic, 3)
	if err := f.mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	get()
	if !status.Fulfilled || status.Label != "alice" {
		t.Fatalf("want fulfilled alice, got %+v", status)
	}
	if !strings.Contains(f.writer.Records["alice.salpay.org"], "addr="+testAddress) {
		t.Fatalf("record not published: %q", f.writer.Records["alice.salpay.org"])
	}

	r, err := f.client.Get(f.srv.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	if got := body(t, r); !strings.Contains(got, "alice.sal") {
		t.Fatalf("account page missing name: %.200s", got)
	}

	resp = f.postForm(t, "/name/alice/address", url.Values{"address": {testAddress2}})
	if got := body(t, resp); !strings.Contains(got, "address updated") {
		t.Fatalf("update did not confirm: %.200s", got)
	}
	record := f.writer.Records["alice.salpay.org"]
	if !strings.Contains(record, "addr="+testAddress2) || !strings.Contains(record, "seq=2") {
		t.Fatalf("record not republished: %q", record)
	}
}

func TestImageUploadAndSlotPurchase(t *testing.T) {
	ctx := context.Background()
	f := setup(t)

	f.postForm(t, "/signup", url.Values{"email": {"bob@example.com"}, "password": {"long enough pass"}}).Body.Close()
	resp := f.postForm(t, "/buy", url.Values{"name": {"bob"}, "address": {testAddress}})
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

	m := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, m); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("image", "avatar.png")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(pngBuf.Bytes())
	mw.Close()

	req, err := http.NewRequest("POST", f.srv.URL+"/name/bob/images", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err = f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	page := body(t, resp)
	if !strings.Contains(page, "image added") || !strings.Contains(page, "1 of 5 slots used") {
		t.Fatalf("upload page: %.300s", page)
	}
	if !strings.Contains(f.writer.Records["bob.salpay.org"], "cid=") {
		t.Fatalf("record missing cid: %q", f.writer.Records["bob.salpay.org"])
	}

	resp = f.postForm(t, "/name/bob/slots", url.Values{})
	if !strings.HasPrefix(resp.Request.URL.Path, "/invoice/") {
		t.Fatalf("slots did not redirect to invoice: %s", resp.Request.URL.Path)
	}
	if got := body(t, resp); !strings.Contains(got, "image slots") {
		t.Fatalf("slot invoice page: %.300s", got)
	}
}

func TestAvailabilityAPI(t *testing.T) {
	f := setup(t)

	var d map[string]any
	get := func(name string) {
		r, err := f.client.Get(f.srv.URL + "/api/availability?name=" + url.QueryEscape(name))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
			t.Fatal(err)
		}
	}

	get("-bad-")
	if d["valid"] != false {
		t.Fatalf("want invalid: %v", d)
	}
	get("Alice.sal")
	if d["valid"] != true || d["available"] != true || d["label"] != "alice" || d["fee_sal"] != "500" {
		t.Fatalf("free name: %v", d)
	}
	get("anna")
	if d["fee_sal"] != "2000" {
		t.Fatalf("short tier fee: %v", d)
	}
	get("longername")
	if d["fee_sal"] != "100" {
		t.Fatalf("long tier fee: %v", d)
	}
}

func TestAuthGating(t *testing.T) {
	f := setup(t)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}

	r, err := client.Get(f.srv.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusFound || r.Header.Get("Location") != "/login" {
		t.Fatalf("want redirect to login, got %d %s", r.StatusCode, r.Header.Get("Location"))
	}

	r, err = client.Get(f.srv.URL + "/api/invoice/ghost")
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", r.StatusCode)
	}
}

func TestFormatSAL(t *testing.T) {
	cases := map[uint64]string{
		2000 * walletrpc.AtomicUnits: "2000",
		walletrpc.AtomicUnits / 2:    "0.5",
		1:                            "0.00000001",
		150_000_000:                  "1.5",
	}
	for atomic, want := range cases {
		if got := FormatSAL(atomic); got != want {
			t.Errorf("FormatSAL(%d) = %q want %q", atomic, got, want)
		}
	}
}
