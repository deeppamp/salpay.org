package pin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"sync"
	"time"
)

// Pinner stores image bytes on ipfs and returns the cid. Uploads always pass
// through the service, provider keys never reach a browser.
type Pinner interface {
	Pin(ctx context.Context, name string, data []byte) (cid string, err error)
}

type Lighthouse struct {
	key  string
	base string
	hc   *http.Client
}

func NewLighthouse(key string) *Lighthouse {
	return &Lighthouse{
		key:  key,
		base: "https://node.lighthouse.storage",
		hc:   &http.Client{Timeout: 60 * time.Second},
	}
}

func (l *Lighthouse) Pin(ctx context.Context, name string, data []byte) (string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(data); err != nil {
		return "", err
	}
	if err := mw.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.base+"/api/v0/add", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+l.key)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := l.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("lighthouse: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("lighthouse: http %d", resp.StatusCode)
	}

	var out struct {
		Hash string `json:"Hash"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("lighthouse: %w", err)
	}
	if out.Hash == "" {
		return "", fmt.Errorf("lighthouse: empty cid")
	}
	return out.Hash, nil
}

// Mock implements Pinner in memory for tests and local runs.
type Mock struct {
	mu    sync.Mutex
	Blobs map[string][]byte
}

func NewMock() *Mock {
	return &Mock{Blobs: map[string][]byte{}}
}

func (m *Mock) Pin(_ context.Context, _ string, data []byte) (string, error) {
	sum := sha256.Sum256(data)
	cid := "bafkmock" + hex.EncodeToString(sum[:8])
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Blobs[cid] = append([]byte(nil), data...)
	return cid, nil
}
