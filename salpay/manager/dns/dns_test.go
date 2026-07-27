package dns

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecord(t *testing.T) {
	got := Record("SC1abc", 3)
	want := "v=sal_alias1; addr=SC1abc; seq=3"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}

}

func TestQuoteTXT(t *testing.T) {
	short := strings.Repeat("a", 255)
	if quoteTXT(short) != short {
		t.Fatal("short content must pass through unquoted")
	}

	long := strings.Repeat("a", 300)
	got := quoteTXT(long)
	want := `"` + strings.Repeat("a", 255) + `" "` + strings.Repeat("a", 45) + `"`
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestCloudflareUpsertCreatesThenUpdates(t *testing.T) {
	var created, updated bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet:
			result := `[]`
			if created {
				result = `[{"id":"rec1"}]`
			}
			w.Write([]byte(`{"success":true,"result":` + result + `}`))
		case r.Method == http.MethodPost:
			var payload map[string]any
			json.NewDecoder(r.Body).Decode(&payload)
			if payload["type"] != "TXT" || payload["name"] != "alice.example.org" {
				t.Errorf("unexpected create payload: %v", payload)
			}
			created = true
			w.Write([]byte(`{"success":true,"result":{"id":"rec1"}}`))
		case r.Method == http.MethodPut:
			if !strings.HasSuffix(r.URL.Path, "/dns_records/rec1") {
				t.Errorf("unexpected update path: %s", r.URL.Path)
			}
			updated = true
			w.Write([]byte(`{"success":true,"result":{"id":"rec1"}}`))
		}
	}))
	defer srv.Close()

	c := NewCloudflare("token", "zone1")
	c.base = srv.URL

	ctx := context.Background()
	if err := c.UpsertTXT(ctx, "alice.example.org", "v=sal_alias1; addr=SC1abc; seq=1"); err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("expected create")
	}
	if err := c.UpsertTXT(ctx, "alice.example.org", "v=sal_alias1; addr=SC1abc; seq=2"); err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("expected update")
	}
}
