package registry

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAddressChangeWindow(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)
	mint(t, r, mgr, wallet, "alice")
	recordBefore := writer.Records["alice.sal.cash"]

	change, err := r.RequestAddressChange(ctx, 1, "alice", testAddress2, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if change.OldAddress != testAddress || change.NewAddress != testAddress2 {
		t.Fatalf("change: %+v", change)
	}

	// nothing moves until the window passes
	name, _ := r.Lookup(ctx, "alice")
	if name.Address != testAddress || name.Seq != 1 {
		t.Fatalf("address moved early: %+v", name)
	}
	if writer.Records["alice.sal.cash"] != recordBefore {
		t.Fatal("record moved early")
	}
	if err := r.ApplyDueAddressChanges(ctx); err != nil {
		t.Fatal(err)
	}
	if name, _ := r.Lookup(ctx, "alice"); name.Address != testAddress {
		t.Fatal("future change applied")
	}

	pending, ok, err := r.PendingAddressChange(ctx, 1, "alice")
	if err != nil || !ok || pending.ID != change.ID {
		t.Fatalf("pending: %+v ok=%v err=%v", pending, ok, err)
	}

	// the request is public in the log immediately
	entries, err := r.LogEntries(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	last := entries[len(entries)-1]
	if last.Event != "address_change_request" || !strings.Contains(string(last.Detail), "apply_at") {
		t.Fatalf("log tail: %+v", last)
	}

	// a newer request replaces the pending one
	replacement, err := r.RequestAddressChange(ctx, 1, "alice", testAddress3, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	pending, ok, _ = r.PendingAddressChange(ctx, 1, "alice")
	if !ok || pending.ID != replacement.ID || pending.NewAddress != testAddress3 {
		t.Fatalf("replacement not pending: %+v", pending)
	}

	if err := r.CancelAddressChange(ctx, 1, "alice"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.PendingAddressChange(ctx, 1, "alice"); ok {
		t.Fatal("cancel left a pending change")
	}
	if err := r.CancelAddressChange(ctx, 1, "alice"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second cancel: %v", err)
	}
}

func TestAddressChangeApplies(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)
	mint(t, r, mgr, wallet, "bob")

	if _, err := r.RequestAddressChange(ctx, 1, "bob", testAddress2, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := r.ApplyDueAddressChanges(ctx); err != nil {
		t.Fatal(err)
	}

	name, _ := r.Lookup(ctx, "bob")
	if name.Address != testAddress2 || name.Seq != 2 {
		t.Fatalf("not applied: %+v", name)
	}
	record := writer.Records["bob.sal.cash"]
	if !strings.Contains(record, "addr="+testAddress2) || !strings.Contains(record, "seq=2") {
		t.Fatalf("record not republished: %q", record)
	}
	if _, ok, _ := r.PendingAddressChange(ctx, 1, "bob"); ok {
		t.Fatal("applied change still pending")
	}

	// retry is idempotent
	if err := r.ApplyDueAddressChanges(ctx); err != nil {
		t.Fatal(err)
	}
	if name, _ := r.Lookup(ctx, "bob"); name.Seq != 2 {
		t.Fatalf("double applied: %+v", name)
	}
}

func TestInstantUpdateSupersedesPending(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "carol")

	if _, err := r.RequestAddressChange(ctx, 1, "carol", testAddress2, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := r.UpdateAddress(ctx, 1, "carol", testAddress3); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.PendingAddressChange(ctx, 1, "carol"); ok {
		t.Fatal("instant update left stale pending change")
	}
	// the stale change must never fire later
	if err := r.ApplyDueAddressChanges(ctx); err != nil {
		t.Fatal(err)
	}
	if name, _ := r.Lookup(ctx, "carol"); name.Address != testAddress3 {
		t.Fatalf("stale change fired: %+v", name)
	}
}

func TestAddressChangeValidation(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "dave")

	if _, err := r.RequestAddressChange(ctx, 2, "dave", testAddress2, time.Now()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign request: %v", err)
	}
	if _, err := r.RequestAddressChange(ctx, 1, "dave", "junk", time.Now()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad address: %v", err)
	}
	if _, err := r.RequestAddressChange(ctx, 1, "dave", testAddress, time.Now()); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unchanged address: %v", err)
	}
	if err := r.CancelAddressChange(ctx, 2, "dave"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign cancel: %v", err)
	}
}
