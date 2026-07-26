package pin

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMockDeterministicCID(t *testing.T) {
	m := NewMock()
	a, err := m.Pin(context.Background(), "x", []byte("payload"))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := m.Pin(context.Background(), "y", []byte("payload"))
	if a != b || !strings.HasPrefix(a, "bafkmock") {
		t.Fatalf("cids %q %q", a, b)
	}
	if string(m.Blobs[a]) != "payload" {
		t.Fatal("blob not stored")
	}
}

func TestLighthousePin(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key1" {
			t.Errorf("auth header %q", r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			t.Errorf("file field: %v", err)
		} else {
			b, _ := io.ReadAll(f)
			if string(b) != "imagebytes" {
				t.Errorf("payload %q", b)
			}
		}
		w.Write([]byte(`{"Name":"alice","Hash":"bafyreal","Size":"10"}`))
	}))
	defer srv.Close()

	l := NewLighthouse("key1")
	l.base = srv.URL
	cid, err := l.Pin(context.Background(), "alice", []byte("imagebytes"))
	if err != nil {
		t.Fatal(err)
	}
	if cid != "bafyreal" {
		t.Fatalf("cid %q", cid)
	}
}
