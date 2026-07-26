package img

import (
	"bytes"
	"context"
	"database/sql"
	stdimage "image"
	_ "image/png"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/dns"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/pin"
	"github.com/deeppamp/salpay.org/salpay/manager/registry"
	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

const testAddress = "SC1" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn"

func TestQRPNG(t *testing.T) {
	png, err := QRPNG(testAddress)
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := stdimage.DecodeConfig(bytes.NewReader(png))
	if err != nil || format != "png" {
		t.Fatalf("decode: format=%q err=%v", format, err)
	}
	if cfg.Width != qrSize || cfg.Height != qrSize {
		t.Fatalf("size %dx%d want %dx%d", cfg.Width, cfg.Height, qrSize, qrSize)
	}
}

func TestHandlerServesQRAndMisses(t *testing.T) {
	ctx := context.Background()
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
	reg, err := registry.New(db, mgr, dns.NewMock(), pin.NewMock(), "salpay.org", "https://img.salpay.org")
	if err != nil {
		t.Fatal(err)
	}

	res, err := reg.Reserve(ctx, 1, "alice", testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	h := NewHandler(reg)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/img/alice.png", nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("status %d type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if _, format, err := stdimage.DecodeConfig(bytes.NewReader(rec.Body.Bytes())); err != nil || format != "png" {
		t.Fatalf("body not png: %v", err)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/img/ghost.png", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown name: status %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/img/alice.gif", nil))
	if rec.Code != 404 {
		t.Fatalf("non png path: status %d", rec.Code)
	}
}
