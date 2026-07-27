package registry

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/dns"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/pin"
	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

const (
	testAddress  = "SC1" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn"
	testAddress2 = "SC2" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn"
)

func mint(t *testing.T, r *Registry, mgr *invoice.Manager, wallet *walletrpc.Mock, label string) {
	t.Helper()
	res, err := r.Reserve(context.Background(), 1, label, testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func testRegistry(t *testing.T) (*Registry, *invoice.Manager, *walletrpc.Mock, *dns.Mock) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	wallet := walletrpc.NewMock()
	mgr, err := invoice.New(db, wallet, 1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	writer := dns.NewMock()
	r, err := New(db, mgr, writer, pin.NewMock(), "sal.cash", "")
	if err != nil {
		t.Fatal(err)
	}
	return r, mgr, wallet, writer
}

func TestPublishIncludesImageURL(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	wallet := walletrpc.NewMock()
	mgr, err := invoice.New(db, wallet, 1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	writer := dns.NewMock()
	r, err := New(db, mgr, writer, pin.NewMock(), "sal.cash", "https://img.sal.cash/")
	if err != nil {
		t.Fatal(err)
	}

	res, err := r.Reserve(ctx, 1, "eve", testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	want := "v=sal_alias1; addr=" + testAddress + "; seq=1; img=https://img.sal.cash/eve.png"
	if writer.Records["eve.sal.cash"] != want {
		t.Fatalf("record %q want %q", writer.Records["eve.sal.cash"], want)
	}
}

func TestPurchasePublishesRecord(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)

	res, err := r.Reserve(ctx, 1, "Alice.sal", testAddress, 50*walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	if res.Label != "alice" {
		t.Fatalf("label not normalized: %q", res.Label)
	}

	wallet.Pay(res.Invoice.SubaddrIndex, 50*walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	record := writer.Records["alice.sal.cash"]
	want := "v=sal_alias1; addr=" + testAddress + "; seq=1"
	if record != want {
		t.Fatalf("record %q want %q", record, want)
	}

	name, err := r.Lookup(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if name.Address != testAddress || name.Seq != 1 {
		t.Fatalf("lookup: %+v", name)
	}
}

func TestReserveBlocksPendingAndMinted(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)

	res, err := r.Reserve(ctx, 1, "bob", testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := r.Reserve(ctx, 1, "bob.sal", testAddress, walletrpc.AtomicUnits); !errors.Is(err, ErrTaken) {
		t.Fatalf("want ErrTaken while reserved, got %v", err)
	}

	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := r.Reserve(ctx, 1, "bob", testAddress, walletrpc.AtomicUnits); !errors.Is(err, ErrTaken) {
		t.Fatalf("want ErrTaken after mint, got %v", err)
	}
}

func TestReserveValidatesInput(t *testing.T) {
	ctx := context.Background()
	r, _, _, _ := testRegistry(t)

	if _, err := r.Reserve(ctx, 1, "-bad-", testAddress, walletrpc.AtomicUnits); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid for label, got %v", err)
	}
	if _, err := r.Reserve(ctx, 1, "carol", "tooshort", walletrpc.AtomicUnits); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid for address, got %v", err)
	}
	if _, err := r.Reserve(ctx, 1, strings.Repeat("a", 64), testAddress, walletrpc.AtomicUnits); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid for long label, got %v", err)
	}
}

func TestUpdateAddressBumpsSeqAndRepublishes(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)
	mint(t, r, mgr, wallet, "alice")

	name, err := r.UpdateAddress(ctx, 1, "Alice.sal", testAddress2)
	if err != nil {
		t.Fatal(err)
	}
	if name.Address != testAddress2 || name.Seq != 2 || name.PublishedSeq != 2 {
		t.Fatalf("update: %+v", name)
	}

	want := "v=sal_alias1; addr=" + testAddress2 + "; seq=2"
	if writer.Records["alice.sal.cash"] != want {
		t.Fatalf("record %q want %q", writer.Records["alice.sal.cash"], want)
	}
}

func TestUpdateAddressSameAddressKeepsSeq(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "bob")

	name, err := r.UpdateAddress(ctx, 1, "bob", testAddress)
	if err != nil {
		t.Fatal(err)
	}
	if name.Seq != 1 {
		t.Fatalf("same address must not bump seq: %+v", name)
	}
}

func TestUpdateAddressRequiresOwner(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "frank")

	if _, err := r.UpdateAddress(ctx, 2, "frank", testAddress2); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden for non owner, got %v", err)
	}
	name, _ := r.Lookup(ctx, "frank")
	if name.Address != testAddress || name.Seq != 1 {
		t.Fatalf("record must be unchanged: %+v", name)
	}
}

func TestNamesByOwner(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "gina")
	mint(t, r, mgr, wallet, "hank")

	res, err := r.Reserve(ctx, 2, "iris", testAddress2, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	mine, err := r.NamesByOwner(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 2 || mine[0].Label != "gina" || mine[1].Label != "hank" {
		t.Fatalf("owner 1 names: %+v", mine)
	}
	theirs, err := r.NamesByOwner(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(theirs) != 1 || theirs[0].Label != "iris" || theirs[0].OwnerID != 2 {
		t.Fatalf("owner 2 names: %+v", theirs)
	}
}

func TestUpdateAddressUnknownName(t *testing.T) {
	r, _, _, _ := testRegistry(t)
	if _, err := r.UpdateAddress(context.Background(), 1, "ghost", testAddress2); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestUpdatePublishFailureDefersAndRepublishes(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)
	mint(t, r, mgr, wallet, "carol")
	recordBefore := writer.Records["carol.sal.cash"]

	writer.FailNext(errors.New("cloudflare down"))
	name, err := r.UpdateAddress(ctx, 1, "carol", testAddress2)
	if err != nil {
		t.Fatal(err)
	}
	if name.Seq != 2 || name.PublishedSeq != 1 {
		t.Fatalf("want seq 2 published 1, got %+v", name)
	}
	if writer.Records["carol.sal.cash"] != recordBefore {
		t.Fatal("record must be unchanged while dns write fails")
	}

	if err := r.RepublishPending(ctx); err != nil {
		t.Fatal(err)
	}
	want := "v=sal_alias1; addr=" + testAddress2 + "; seq=2"
	if writer.Records["carol.sal.cash"] != want {
		t.Fatalf("record %q want %q", writer.Records["carol.sal.cash"], want)
	}
	name, _ = r.Lookup(ctx, "carol")
	if name.PublishedSeq != 2 {
		t.Fatalf("published seq not advanced: %+v", name)
	}
}

func TestPublishRetriesAfterDNSFailure(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)

	res, err := r.Reserve(ctx, 1, "dave", testAddress, walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	wallet.Pay(res.Invoice.SubaddrIndex, walletrpc.AtomicUnits, 3)

	writer.FailNext(errors.New("cloudflare down"))
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok := writer.Records["dave.sal.cash"]; ok {
		t.Fatal("record must not publish while dns write fails")
	}
	inv, _ := mgr.Get(ctx, res.Invoice.ID)
	if inv.Status != invoice.Confirmed || inv.FulfilledAt != nil {
		t.Fatalf("want confirmed unfulfilled, got %+v", inv)
	}

	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	if writer.Records["dave.sal.cash"] == "" {
		t.Fatal("record must publish on retry")
	}
	name, err := r.Lookup(ctx, "dave")
	if err != nil || name.Seq != 1 {
		t.Fatalf("lookup after retry: %+v err %v", name, err)
	}
}
