package pin

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Pinner keeps the durable public copy of image bytes and returns the
// sha256 hex key it stored under. Uploads always pass through the service,
// provider keys never reach a browser. The db blob stays the master copy.
type Pinner interface {
	Pin(ctx context.Context, name string, data []byte) (hash string, err error)
}

// R2 stores objects content-addressed by sha256 in a Cloudflare R2 bucket,
// signed with sigv4. The bucket's public hostname serves them through the
// sal.cash zone.
type R2 struct {
	base   string // https://<account>.r2.cloudflarestorage.com/<bucket>
	keyID  string
	secret string
	hc     *http.Client
	now    func() time.Time
}

func NewR2(accountID, keyID, secret, bucket string) *R2 {
	return &R2{
		base:   "https://" + accountID + ".r2.cloudflarestorage.com/" + bucket,
		keyID:  keyID,
		secret: secret,
		hc:     &http.Client{Timeout: 60 * time.Second},
		now:    time.Now,
	}
}

func (r *R2) Pin(ctx context.Context, name string, data []byte) (string, error) {
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, r.base+"/"+hash, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	r.sign(req, hash)

	resp, err := r.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("r2: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("r2: http %d", resp.StatusCode)
	}
	return hash, nil
}

// sign implements aws sigv4 for region auto, service s3. payloadHash is the
// hex sha256 of the body, which for content-addressed keys is the key.
func (r *R2) sign(req *http.Request, payloadHash string) {
	t := r.now().UTC()
	amzDate := t.Format("20060102T150405Z")
	date := t.Format("20060102")
	scope := date + "/auto/s3/aws4_request"

	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	canonical := req.Method + "\n" +
		req.URL.EscapedPath() + "\n" +
		"\n" +
		"host:" + req.URL.Host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n" +
		"\n" +
		"host;x-amz-content-sha256;x-amz-date\n" +
		payloadHash
	canonicalHash := sha256.Sum256([]byte(canonical))

	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])

	key := hmacSHA256([]byte("AWS4"+r.secret), date)
	key = hmacSHA256(key, "auto")
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	sig := hex.EncodeToString(hmacSHA256(key, toSign))

	req.Header.Set("Authorization",
		"AWS4-HMAC-SHA256 Credential="+r.keyID+"/"+scope+
			", SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature="+sig)
}

func hmacSHA256(key []byte, msg string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(msg))
	return h.Sum(nil)
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
	hash := hex.EncodeToString(sum[:])
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Blobs[hash] = append([]byte(nil), data...)
	return hash, nil
}
