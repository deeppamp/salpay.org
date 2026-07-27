package pin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestR2PinSignsAndStores(t *testing.T) {
	data := []byte("avatar bytes")
	sum := sha256.Sum256(data)
	wantHash := hex.EncodeToString(sum[:])

	var got *http.Request
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(context.Background())
		body, _ = io.ReadAll(r.Body)
	}))
	defer srv.Close()

	r2 := &R2{
		base:   srv.URL + "/bucket",
		keyID:  "AKIDEXAMPLE",
		secret: "secret",
		hc:     srv.Client(),
		now:    func() time.Time { return time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC) },
	}
	hash, err := r2.Pin(context.Background(), "alice", data)
	if err != nil {
		t.Fatal(err)
	}
	if hash != wantHash {
		t.Fatalf("hash %s want %s", hash, wantHash)
	}
	if got.Method != http.MethodPut || got.URL.Path != "/bucket/"+wantHash {
		t.Fatalf("request %s %s", got.Method, got.URL.Path)
	}
	if string(body) != string(data) {
		t.Fatalf("body %q", body)
	}
	if got.Header.Get("X-Amz-Content-Sha256") != wantHash || got.Header.Get("X-Amz-Date") != "20260727T120000Z" {
		t.Fatalf("amz headers: %v", got.Header)
	}
	auth := got.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260727/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=") {
		t.Fatalf("auth: %s", auth)
	}
	if len(auth) != len(auth[:strings.Index(auth, "Signature=")])+len("Signature=")+64 {
		t.Fatalf("signature not 64 hex chars: %s", auth)
	}
}

func TestR2PinErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "denied", http.StatusForbidden)
	}))
	defer srv.Close()
	r2 := &R2{base: srv.URL + "/b", keyID: "k", secret: "s", hc: srv.Client(), now: time.Now}
	if _, err := r2.Pin(context.Background(), "x", []byte("d")); err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("want 403 error, got %v", err)
	}
}

func TestMockContentAddressing(t *testing.T) {
	m := NewMock()
	h1, err := m.Pin(context.Background(), "a", []byte("same"))
	if err != nil {
		t.Fatal(err)
	}
	h2, _ := m.Pin(context.Background(), "b", []byte("same"))
	if h1 != h2 {
		t.Fatal("same bytes, different hash")
	}
	if len(h1) != 64 {
		t.Fatalf("not sha256 hex: %s", h1)
	}
	if string(m.Blobs[h1]) != "same" {
		t.Fatal("blob not stored")
	}
}
