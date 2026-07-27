package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testClient(t *testing.T, handler http.HandlerFunc) *client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &client{base: srv.URL, key: "test-key", http: &http.Client{Timeout: time.Second}}
}

func TestBalanceFlatAndWrapped(t *testing.T) {
	payloads := map[string]string{
		"flat":    `{"dataLimit":1073741824,"dataUsed":536870912,"dataLimitPermanent":5368709120,"dataUsedPermanent":0}`,
		"wrapped": `{"data":{"dataLimit":1073741824,"dataUsed":536870912,"dataLimitPermanent":5368709120,"dataUsedPermanent":0}}`,
	}
	for name, payload := range payloads {
		c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/user/user_data_usage" || r.Header.Get("Authorization") != "Bearer test-key" {
				t.Errorf("bad request: %s %s", r.URL.Path, r.Header.Get("Authorization"))
			}
			w.Write([]byte(payload))
		})
		var out strings.Builder
		if err := c.balance(&out); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !strings.Contains(out.String(), "512.00 MiB used of   1.00 GiB") {
			t.Fatalf("%s: %q", name, out.String())
		}
	}
}

func TestUploadsPaginationAndAddress(t *testing.T) {
	page := func(files ...file) string {
		b, _ := json.Marshal(uploadsPage{FileList: files, TotalFiles: 3})
		return string(b)
	}
	calls := 0
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch r.URL.Query().Get("lastKey") {
		case "null":
			w.Write([]byte(page(
				file{FileName: "a.png", CID: "bafy1", PublicKey: "0xabc", FileSizeInBytes: "1048576", ID: "id1"},
				file{FileName: "b.svg", CID: "bafy2", PublicKey: "0xabc", FileSizeInBytes: "2048", ID: "id2"},
			)))
		case "id2":
			w.Write([]byte(page(file{FileName: "c.gif", CID: "bafy3", FileSizeInBytes: "10", ID: "id3"})))
		default:
			w.Write([]byte(page()))
		}
	})

	var out strings.Builder
	if err := c.uploads(&out); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	for _, want := range []string{"bafy1", "bafy2", "bafy3", "1.00 MiB", "3 files"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %q", want, got)
		}
	}
	if calls != 3 {
		t.Fatalf("expected 3 page fetches, got %d", calls)
	}

	out.Reset()
	if err := c.address(&out); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(out.String()) != "0xabc" {
		t.Fatalf("address: %q", out.String())
	}
}

func TestErrorSurfacing(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad api key", http.StatusUnauthorized)
	})
	var out strings.Builder
	err := c.balance(&out)
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("want 401 error, got %v", err)
	}
}
