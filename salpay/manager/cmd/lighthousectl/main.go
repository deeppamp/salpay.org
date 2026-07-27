// lighthousectl inspects the Lighthouse storage account behind
// LIGHTHOUSE_API_KEY: balance, uploads, account address, top up info.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"
)

const defaultAPI = "https://api.lighthouse.storage"

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
	}
	c := client{
		base: getenv("LIGHTHOUSE_API_URL", defaultAPI),
		key:  os.Getenv("LIGHTHOUSE_API_KEY"),
		http: &http.Client{Timeout: 15 * time.Second},
	}
	if c.key == "" && os.Args[1] != "topup" {
		log.Fatal("LIGHTHOUSE_API_KEY not set")
	}

	var err error
	switch os.Args[1] {
	case "balance":
		err = c.balance(os.Stdout)
	case "uploads":
		err = c.uploads(os.Stdout)
	case "address":
		err = c.address(os.Stdout)
	case "topup":
		topup(os.Stdout)
	default:
		usage()
	}
	if err != nil {
		log.Fatal(err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage: lighthousectl <command>

  balance   data used and remaining per storage tier
  uploads   list pinned files with cid, size, and date
  address   wallet address behind the api key
  topup     how to add credit to the account`)
	os.Exit(2)
}

type client struct {
	base string
	key  string
	http *http.Client
}

// get unwraps the optional {"data": ...} envelope some responses use.
func (c *client) get(path string, out any) error {
	req, err := http.NewRequest("GET", c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("lighthouse %s: %s: %.200s", path, resp.Status, body)
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && len(envelope.Data) > 0 {
		body = envelope.Data
	}
	return json.Unmarshal(body, out)
}

type dataUsage struct {
	DataLimit          float64 `json:"dataLimit"`
	DataUsed           float64 `json:"dataUsed"`
	DataLimitPermanent float64 `json:"dataLimitPermanent"`
	DataUsedPermanent  float64 `json:"dataUsedPermanent"`
	WalrusDataLimit    float64 `json:"walrusDataLimit"`
	WalrusDataUsed     float64 `json:"walrusDataUsed"`
}

func (c *client) balance(w io.Writer) error {
	var u dataUsage
	if err := c.get("/api/user/user_data_usage", &u); err != nil {
		return err
	}
	tier := func(name string, used, limit float64) {
		fmt.Fprintf(w, "%-10s %10s used of %10s, %s free\n",
			name, size(used), size(limit), size(limit-used))
	}
	tier("standard", u.DataUsed, u.DataLimit)
	tier("permanent", u.DataUsedPermanent, u.DataLimitPermanent)
	if u.WalrusDataLimit > 0 {
		tier("walrus", u.WalrusDataUsed, u.WalrusDataLimit)
	}
	return nil
}

type file struct {
	FileName        string `json:"fileName"`
	CID             string `json:"cid"`
	PublicKey       string `json:"publicKey"`
	FileSizeInBytes string `json:"fileSizeInBytes"`
	CreatedAt       int64  `json:"createdAt"`
	ID              string `json:"id"`
}

type uploadsPage struct {
	FileList   []file `json:"fileList"`
	TotalFiles int    `json:"totalFiles"`
}

func (c *client) pages(each func(uploadsPage) bool) error {
	lastKey := "null"
	for range [100]struct{}{} {
		var page uploadsPage
		path := "/api/user/files_uploaded?lastKey=" + url.QueryEscape(lastKey) + "&fileType=all"
		if err := c.get(path, &page); err != nil {
			return err
		}
		if len(page.FileList) == 0 || !each(page) {
			return nil
		}
		lastKey = page.FileList[len(page.FileList)-1].ID
	}
	return nil
}

func (c *client) uploads(w io.Writer) error {
	total, shown := 0, 0
	err := c.pages(func(p uploadsPage) bool {
		total = p.TotalFiles
		for _, f := range p.FileList {
			fmt.Fprintf(w, "%s  %10s  %s  %s\n",
				f.CID, sizeStr(f.FileSizeInBytes),
				time.UnixMilli(f.CreatedAt).UTC().Format("2006-01-02"), f.FileName)
			shown++
		}
		return true
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "%d files (%d reported by api)\n", shown, total)
	return nil
}

func (c *client) address(w io.Writer) error {
	found := ""
	err := c.pages(func(p uploadsPage) bool {
		for _, f := range p.FileList {
			if f.PublicKey != "" {
				found = f.PublicKey
				return false
			}
		}
		return true
	})
	if err != nil {
		return err
	}
	if found == "" {
		return fmt.Errorf("no uploads yet, address unknown to the api; check the dashboard at https://files.lighthouse.storage")
	}
	fmt.Fprintln(w, found)
	return nil
}

// contract addresses from the lighthouse-web3/lighthouse-package config
func topup(w io.Writer) {
	fmt.Fprint(w, `add credit to the lighthouse account:

1. dashboard (card or crypto): https://files.lighthouse.storage
2. their cli signs an on-chain deposit: npx lighthouse-web3 top-up
3. direct deposit contracts (usdt, usdc, dai, or native):
   polygon   0xaD13C488b01DbcE976B67e552Bd352e824E53E1D
   bsc       0x340ff23c060626644e55fc10298c5e995b1f41c1
   fantom    0xf468602B34C482f34ca498D9a0DE7957539961d3

deposits credit the wallet shown by: lighthousectl address
`)
}

func size(b float64) string {
	const gib = 1 << 30
	const mib = 1 << 20
	switch {
	case b >= gib || b <= -gib:
		return fmt.Sprintf("%.2f GiB", b/gib)
	case b >= mib || b <= -mib:
		return fmt.Sprintf("%.2f MiB", b/mib)
	default:
		return fmt.Sprintf("%.0f B", b)
	}
}

func sizeStr(s string) string {
	var f float64
	fmt.Sscanf(s, "%g", &f)
	return size(f)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
