package walletrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Salvium displays 8 decimals, not Monero's 12.
const AtomicUnits uint64 = 100_000_000

type Transfer struct {
	TxID          string
	Address       string
	SubaddrIndex  uint32
	AmountAtomic  uint64
	Confirmations uint64
	Pool          bool
}

// Wallet is the subset of wallet rpc the manager needs, account 0 throughout.
// One subaddress per invoice is the payment matching mechanism.
type Wallet interface {
	CreateSubaddress(ctx context.Context, label string) (address string, index uint32, err error)
	IncomingTransfers(ctx context.Context) ([]Transfer, error)
}

type Client struct {
	url string
	hc  *http.Client
}

func New(url string) *Client {
	return &Client{url: url, hc: &http.Client{Timeout: 15 * time.Second}}
}

func (c *Client) call(ctx context.Context, method string, params, result any) error {
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      "0",
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", method, err)
	}
	defer resp.Body.Close()

	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("%s: %w", method, err)
	}
	if envelope.Error != nil {
		return fmt.Errorf("%s: %s", method, envelope.Error.Message)
	}
	if result != nil && envelope.Result != nil {
		return json.Unmarshal(envelope.Result, result)
	}
	return nil
}

func (c *Client) CreateSubaddress(ctx context.Context, label string) (string, uint32, error) {
	var res struct {
		Address      string `json:"address"`
		AddressIndex uint32 `json:"address_index"`
	}
	if err := c.call(ctx, "create_address", map[string]any{"account_index": 0, "label": label}, &res); err != nil {
		return "", 0, err
	}
	if res.Address == "" {
		return "", 0, fmt.Errorf("create_address: empty address")
	}
	return res.Address, res.AddressIndex, nil
}

type rpcTransfer struct {
	TxID          string `json:"txid"`
	Address       string `json:"address"`
	Amount        uint64 `json:"amount"`
	Confirmations uint64 `json:"confirmations"`
	SubaddrIndex  struct {
		Major uint32 `json:"major"`
		Minor uint32 `json:"minor"`
	} `json:"subaddr_index"`
}

func (c *Client) IncomingTransfers(ctx context.Context) ([]Transfer, error) {
	var res struct {
		In   []rpcTransfer `json:"in"`
		Pool []rpcTransfer `json:"pool"`
	}
	params := map[string]any{"account_index": 0, "in": true, "pool": true}
	if err := c.call(ctx, "get_transfers", params, &res); err != nil {
		return nil, err
	}

	out := make([]Transfer, 0, len(res.In)+len(res.Pool))
	for _, t := range res.In {
		if t.SubaddrIndex.Major != 0 {
			continue
		}
		out = append(out, Transfer{
			TxID:          t.TxID,
			Address:       t.Address,
			SubaddrIndex:  t.SubaddrIndex.Minor,
			AmountAtomic:  t.Amount,
			Confirmations: t.Confirmations,
		})
	}
	for _, t := range res.Pool {
		if t.SubaddrIndex.Major != 0 {
			continue
		}
		out = append(out, Transfer{
			TxID:         t.TxID,
			Address:      t.Address,
			SubaddrIndex: t.SubaddrIndex.Minor,
			AmountAtomic: t.Amount,
			Pool:         true,
		})
	}
	return out, nil
}
