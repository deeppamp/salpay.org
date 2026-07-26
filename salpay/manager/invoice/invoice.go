package invoice

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

type Kind string

const (
	NamePurchase Kind = "name_purchase"
	ImageSlots   Kind = "image_slots"
)

type Status string

const (
	Pending   Status = "pending"
	Confirmed Status = "confirmed"
	Expired   Status = "expired"
)

var ErrNotFound = errors.New("invoice not found")

type Invoice struct {
	ID             string
	Kind           Kind
	Ref            string
	AmountAtomic   uint64
	ReceivedAtomic uint64
	Subaddress     string
	SubaddrIndex   uint32
	Status         Status
	CreatedAt      time.Time
	ExpiresAt      time.Time
	ConfirmedAt    *time.Time
	FulfilledAt    *time.Time
}

// Fulfiller runs the side effects of a paid invoice. Confirmed and fulfilled
// are separate states so a failed fulfiller retries on the next settle pass.
type Fulfiller func(context.Context, Invoice) error

type Manager struct {
	db      *sql.DB
	wallet  walletrpc.Wallet
	minConf uint64
	ttl     time.Duration

	mu         sync.Mutex
	fulfillers map[Kind]Fulfiller
}

const schema = `
create table if not exists invoices (
	id text primary key,
	kind text not null,
	ref text not null default '',
	amount_atomic integer not null,
	received_atomic integer not null default 0,
	subaddress text not null,
	subaddr_index integer not null,
	status text not null default 'pending',
	created_at integer not null,
	expires_at integer not null,
	confirmed_at integer,
	fulfilled_at integer
);
create index if not exists invoices_status on invoices (status);
`

func New(db *sql.DB, wallet walletrpc.Wallet, minConf uint64, ttl time.Duration) (*Manager, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &Manager{
		db:         db,
		wallet:     wallet,
		minConf:    minConf,
		ttl:        ttl,
		fulfillers: map[Kind]Fulfiller{},
	}, nil
}

func (m *Manager) Register(kind Kind, f Fulfiller) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fulfillers[kind] = f
}

func (m *Manager) Create(ctx context.Context, kind Kind, ref string, amountAtomic uint64) (Invoice, error) {
	if amountAtomic == 0 {
		return Invoice{}, errors.New("amount must be positive")
	}

	address, index, err := m.wallet.CreateSubaddress(ctx, string(kind)+":"+ref)
	if err != nil {
		return Invoice{}, fmt.Errorf("create subaddress: %w", err)
	}

	now := time.Now().UTC()
	inv := Invoice{
		ID:           newID(),
		Kind:         kind,
		Ref:          ref,
		AmountAtomic: amountAtomic,
		Subaddress:   address,
		SubaddrIndex: index,
		Status:       Pending,
		CreatedAt:    now,
		ExpiresAt:    now.Add(m.ttl),
	}

	_, err = m.db.ExecContext(ctx,
		`insert into invoices (id, kind, ref, amount_atomic, subaddress, subaddr_index, status, created_at, expires_at)
		 values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		inv.ID, inv.Kind, inv.Ref, inv.AmountAtomic, inv.Subaddress, inv.SubaddrIndex, inv.Status,
		inv.CreatedAt.UnixNano(), inv.ExpiresAt.UnixNano())
	if err != nil {
		return Invoice{}, err
	}
	return inv, nil
}

func (m *Manager) Get(ctx context.Context, id string) (Invoice, error) {
	rows, err := m.query(ctx, `where id = ?`, id)
	if err != nil {
		return Invoice{}, err
	}
	if len(rows) == 0 {
		return Invoice{}, ErrNotFound
	}
	return rows[0], nil
}

// Settle expires stale invoices, matches confirmed transfers to pending
// invoices by subaddress index, and runs fulfillment for anything paid.
func (m *Manager) Settle(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if _, err := m.db.ExecContext(ctx,
		`update invoices set status = ? where status = ? and expires_at < ?`,
		Expired, Pending, now.UnixNano()); err != nil {
		return err
	}

	pending, err := m.query(ctx, `where status = ?`, Pending)
	if err != nil {
		return err
	}

	if len(pending) > 0 {
		transfers, err := m.wallet.IncomingTransfers(ctx)
		if err != nil {
			return fmt.Errorf("incoming transfers: %w", err)
		}

		received := map[uint32]uint64{}
		for _, t := range transfers {
			if t.Pool || t.Confirmations < m.minConf {
				continue
			}
			received[t.SubaddrIndex] += t.AmountAtomic
		}

		for _, inv := range pending {
			got := received[inv.SubaddrIndex]
			if got >= inv.AmountAtomic {
				if _, err := m.db.ExecContext(ctx,
					`update invoices set status = ?, received_atomic = ?, confirmed_at = ? where id = ?`,
					Confirmed, got, now.UnixNano(), inv.ID); err != nil {
					return err
				}
			} else if got != inv.ReceivedAtomic {
				if _, err := m.db.ExecContext(ctx,
					`update invoices set received_atomic = ? where id = ?`, got, inv.ID); err != nil {
					return err
				}
			}
		}
	}

	unfulfilled, err := m.query(ctx, `where status = ? and fulfilled_at is null`, Confirmed)
	if err != nil {
		return err
	}
	for _, inv := range unfulfilled {
		f := m.fulfillers[inv.Kind]
		if f == nil {
			continue
		}
		if err := f(ctx, inv); err != nil {
			log.Printf("invoice %s (%s) fulfillment failed: %v", inv.ID, inv.Kind, err)
			continue
		}
		if _, err := m.db.ExecContext(ctx,
			`update invoices set fulfilled_at = ? where id = ?`, now.UnixNano(), inv.ID); err != nil {
			return err
		}
	}
	return nil
}

// Run settles on an interval until the context is cancelled.
func (m *Manager) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.Settle(ctx); err != nil {
				log.Printf("invoice settle: %v", err)
			}
		}
	}
}

func (m *Manager) query(ctx context.Context, where string, args ...any) ([]Invoice, error) {
	rows, err := m.db.QueryContext(ctx,
		`select id, kind, ref, amount_atomic, received_atomic, subaddress, subaddr_index, status,
		        created_at, expires_at, confirmed_at, fulfilled_at
		 from invoices `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Invoice
	for rows.Next() {
		var inv Invoice
		var created, expires int64
		var confirmed, fulfilled sql.NullInt64
		if err := rows.Scan(&inv.ID, &inv.Kind, &inv.Ref, &inv.AmountAtomic, &inv.ReceivedAtomic,
			&inv.Subaddress, &inv.SubaddrIndex, &inv.Status, &created, &expires, &confirmed, &fulfilled); err != nil {
			return nil, err
		}
		inv.CreatedAt = time.Unix(0, created).UTC()
		inv.ExpiresAt = time.Unix(0, expires).UTC()
		if confirmed.Valid {
			t := time.Unix(0, confirmed.Int64).UTC()
			inv.ConfirmedAt = &t
		}
		if fulfilled.Valid {
			t := time.Unix(0, fulfilled.Int64).UTC()
			inv.FulfilledAt = &t
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
