package invoice

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

func testManager(t *testing.T, minConf uint64, ttl time.Duration) (*Manager, *walletrpc.Mock) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	mock := walletrpc.NewMock()
	m, err := New(db, mock, minConf, ttl)
	if err != nil {
		t.Fatal(err)
	}
	return m, mock
}

func TestPaidInvoiceConfirmsAndFulfills(t *testing.T) {
	ctx := context.Background()
	m, mock := testManager(t, 1, time.Hour)

	var fulfilled []Invoice
	m.Register(NamePurchase, func(_ context.Context, inv Invoice) error {
		fulfilled = append(fulfilled, inv)
		return nil
	})

	inv, err := m.Create(ctx, NamePurchase, "alice", 50*walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	if inv.Subaddress == "" || inv.SubaddrIndex == 0 {
		t.Fatalf("invoice missing subaddress: %+v", inv)
	}

	mock.Pay(inv.SubaddrIndex, 50*walletrpc.AtomicUnits, 3)
	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	got, err := m.Get(ctx, inv.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != Confirmed || got.FulfilledAt == nil {
		t.Fatalf("want confirmed and fulfilled, got %+v", got)
	}
	if len(fulfilled) != 1 || fulfilled[0].ID != inv.ID {
		t.Fatalf("fulfiller calls: %+v", fulfilled)
	}
}

func TestPartialPaymentStaysPending(t *testing.T) {
	ctx := context.Background()
	m, mock := testManager(t, 1, time.Hour)

	inv, err := m.Create(ctx, NamePurchase, "bob", 100*walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}

	mock.Pay(inv.SubaddrIndex, 40*walletrpc.AtomicUnits, 3)
	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := m.Get(ctx, inv.ID)
	if got.Status != Pending || got.ReceivedAtomic != 40*walletrpc.AtomicUnits {
		t.Fatalf("want pending with partial amount, got %+v", got)
	}

	mock.Pay(inv.SubaddrIndex, 60*walletrpc.AtomicUnits, 3)
	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ = m.Get(ctx, inv.ID)
	if got.Status != Confirmed {
		t.Fatalf("want confirmed after second payment, got %+v", got)
	}
}

func TestUnconfirmedTransferIgnored(t *testing.T) {
	ctx := context.Background()
	m, mock := testManager(t, 2, time.Hour)

	inv, err := m.Create(ctx, ImageSlots, "alice:slots", 10*walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}

	mock.Pay(inv.SubaddrIndex, 10*walletrpc.AtomicUnits, 1)
	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := m.Get(ctx, inv.ID)
	if got.Status != Pending {
		t.Fatalf("want pending below min confirmations, got %+v", got)
	}
}

func TestExpiry(t *testing.T) {
	ctx := context.Background()
	m, _ := testManager(t, 1, -time.Second)

	inv, err := m.Create(ctx, NamePurchase, "carol", walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	got, _ := m.Get(ctx, inv.ID)
	if got.Status != Expired {
		t.Fatalf("want expired, got %+v", got)
	}
}

func TestFulfillmentRetries(t *testing.T) {
	ctx := context.Background()
	m, mock := testManager(t, 1, time.Hour)

	calls := 0
	m.Register(NamePurchase, func(context.Context, Invoice) error {
		calls++
		if calls == 1 {
			return errors.New("dns write failed")
		}
		return nil
	})

	inv, err := m.Create(ctx, NamePurchase, "dave", walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	mock.Pay(inv.SubaddrIndex, walletrpc.AtomicUnits, 3)

	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ := m.Get(ctx, inv.ID)
	if got.Status != Confirmed || got.FulfilledAt != nil {
		t.Fatalf("want confirmed but unfulfilled after failure, got %+v", got)
	}

	if err := m.Settle(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ = m.Get(ctx, inv.ID)
	if got.FulfilledAt == nil || calls != 2 {
		t.Fatalf("want fulfilled on retry, got %+v calls=%d", got, calls)
	}
}
