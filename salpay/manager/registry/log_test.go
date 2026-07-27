package registry

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

func verifyChain(t *testing.T, entries []LogEntry) {
	t.Helper()
	prev := ""
	for _, e := range entries {
		if e.PrevHash != prev {
			t.Fatalf("entry %d prev_hash %q want %q", e.ID, e.PrevHash, prev)
		}
		want := chainHash(prev, e.ID, e.At.UnixNano(), e.Event, e.Label, e.Detail)
		if e.Hash != want {
			t.Fatalf("entry %d hash %q want %q", e.ID, e.Hash, want)
		}
		prev = e.Hash
	}
}

func TestLogChainsMutations(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "alice")

	if _, err := r.UpdateAddress(ctx, 1, "alice", testAddress2); err != nil {
		t.Fatal(err)
	}
	img, err := r.AddImage(ctx, 1, "alice", tinyPNG(t, 7))
	if err != nil {
		t.Fatal(err)
	}
	if err := r.ResetImage(ctx, 1, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteImage(ctx, 1, "alice", img.ID); err != nil {
		t.Fatal(err)
	}

	entries, err := r.LogEntries(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"register", "update_address", "image_add", "image_activate", "image_reset", "image_delete"}
	if len(entries) != len(want) {
		t.Fatalf("entries %d want %d: %+v", len(entries), len(want), entries)
	}
	for i, e := range entries {
		if e.Event != want[i] {
			t.Fatalf("event %d = %q want %q", i, e.Event, want[i])
		}
		if e.Label != "alice" {
			t.Fatalf("label %q", e.Label)
		}
	}
	verifyChain(t, entries)

	var detail struct {
		OldAddress string `json:"old_address"`
		NewAddress string `json:"new_address"`
		Seq        uint64 `json:"seq"`
	}
	if err := json.Unmarshal(entries[1].Detail, &detail); err != nil {
		t.Fatal(err)
	}
	if detail.OldAddress != testAddress || detail.NewAddress != testAddress2 || detail.Seq != 2 {
		t.Fatalf("update detail: %+v", detail)
	}

	id, hash, err := r.LogHead(ctx)
	if err != nil || id != entries[len(entries)-1].ID || hash != entries[len(entries)-1].Hash {
		t.Fatalf("head %d %q err %v", id, hash, err)
	}
}

func TestLogPagingAndSince(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "bob")
	mint(t, r, mgr, wallet, "carol")
	mint(t, r, mgr, wallet, "dave")

	page, err := r.LogEntries(ctx, 0, 2)
	if err != nil || len(page) != 2 {
		t.Fatalf("page %+v err %v", page, err)
	}
	rest, err := r.LogEntries(ctx, page[1].ID, 100)
	if err != nil || len(rest) != 1 || rest[0].Label != "dave" {
		t.Fatalf("rest %+v err %v", rest, err)
	}
}

func TestPublishRetryDoesNotDuplicateRegister(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)

	res, err := r.Reserve(ctx, 1, "eve", testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)

	writer.FailNext(errors.New("cloudflare down"))
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	entries, err := r.LogEntries(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	registers := 0
	for _, e := range entries {
		if e.Event == "register" {
			registers++
		}
	}
	if registers != 1 {
		t.Fatalf("register entries %d want 1", registers)
	}
	if writer.Records["eve.sal.cash"] == "" {
		t.Fatal("record must publish on retry")
	}
}
