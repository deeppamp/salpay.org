package dns

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const RecordTTL = 300

// Record builds the sal_alias1 TXT value. The avatar and address urls are
// derived from the record's own fqdn (<label>.<zone>/img and /address), so
// only the address and replay counter are published.
func Record(addr string, seq uint64) string {
	return strings.Join([]string{"v=sal_alias1", "addr=" + addr, fmt.Sprintf("seq=%d", seq)}, "; ")
}

type Writer interface {
	UpsertTXT(ctx context.Context, fqdn, content string) error
}

type Cloudflare struct {
	token  string
	zoneID string
	base   string
	hc     *http.Client
}

func NewCloudflare(token, zoneID string) *Cloudflare {
	return &Cloudflare{
		token:  token,
		zoneID: zoneID,
		base:   "https://api.cloudflare.com/client/v4",
		hc:     &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Cloudflare) UpsertTXT(ctx context.Context, fqdn, content string) error {
	content = quoteTXT(content)

	var existing []struct {
		ID string `json:"id"`
	}
	query := url.Values{"type": {"TXT"}, "name": {fqdn}}.Encode()
	if err := c.do(ctx, http.MethodGet, "/zones/"+c.zoneID+"/dns_records?"+query, nil, &existing); err != nil {
		return err
	}

	payload := map[string]any{"type": "TXT", "name": fqdn, "content": content, "ttl": RecordTTL}
	if len(existing) > 0 {
		return c.do(ctx, http.MethodPut, "/zones/"+c.zoneID+"/dns_records/"+existing[0].ID, payload, nil)
	}
	return c.do(ctx, http.MethodPost, "/zones/"+c.zoneID+"/dns_records", payload, nil)
}

func (c *Cloudflare) do(ctx context.Context, method, path string, body, out any) error {
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("cloudflare %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	var envelope struct {
		Success bool `json:"success"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("cloudflare %s %s: %w", method, path, err)
	}
	if !envelope.Success {
		messages := make([]string, 0, len(envelope.Errors))
		for _, e := range envelope.Errors {
			messages = append(messages, e.Message)
		}
		return fmt.Errorf("cloudflare %s %s: %s", method, path, strings.Join(messages, "; "))
	}
	if out != nil && envelope.Result != nil {
		return json.Unmarshal(envelope.Result, out)
	}
	return nil
}

// TXT strings cap at 255 bytes; longer content must ship as quoted chunks
// inside the one record, which resolvers concatenate.
func quoteTXT(s string) string {
	if len(s) <= 255 {
		return s
	}
	var chunks []string
	for len(s) > 0 {
		n := min(len(s), 255)
		chunks = append(chunks, `"`+s[:n]+`"`)
		s = s[n:]
	}
	return strings.Join(chunks, " ")
}

// Mock implements Writer in memory for tests and local runs.
type Mock struct {
	mu      sync.Mutex
	nextErr error
	Records map[string]string
}

func NewMock() *Mock {
	return &Mock{Records: map[string]string{}}
}

// FailNext makes the next upsert return err.
func (m *Mock) FailNext(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextErr = err
}

func (m *Mock) UpsertTXT(_ context.Context, fqdn, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.nextErr != nil {
		err := m.nextErr
		m.nextErr = nil
		return err
	}
	m.Records[fqdn] = content
	return nil
}
