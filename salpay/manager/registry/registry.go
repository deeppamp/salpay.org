package registry

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/deeppamp/salpay.org/salpay/manager/dns"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/pin"
)

var (
	ErrNotFound  = errors.New("name not found")
	ErrTaken     = errors.New("name taken")
	ErrReserved  = errors.New("name reserved")
	ErrInvalid   = errors.New("invalid input")
	ErrForbidden = errors.New("not the owner")
	ErrNoSlots   = errors.New("image slots full")
)

// reservedLabels can never be minted: <label>.<zone> shares a namespace
// with infrastructure hostnames, a minted www or api would hijack them.
var reservedLabels = map[string]bool{
	"www": true, "api": true, "img": true, "app": true, "cdn": true,
	"mail": true, "smtp": true, "imap": true, "pop": true, "mx": true,
	"webmail": true, "autoconfig": true, "autodiscover": true,
	"ns": true, "ns1": true, "ns2": true, "dns": true,
	"ftp": true, "static": true, "assets": true, "gateway": true,
	"admin": true, "administrator": true, "root": true, "sys": true,
	"support": true, "help": true, "abuse": true, "security": true,
	"status": true, "blog": true, "docs": true, "wiki": true,
	"dev": true, "test": true, "staging": true, "demo": true,
	"wallet": true, "pay": true, "checkout": true, "invoice": true,
	"login": true, "signup": true, "account": true, "dashboard": true,
	"treasury": true, "explorer": true, "faucet": true, "bridge": true,
	"salpay": true, "salvium": true, "localhost": true,
}

// SlotPack is how many image slots one image_slots invoice adds.
const SlotPack = 5

var (
	labelPattern   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	addressPattern = regexp.MustCompile(`^[A-Za-z0-9]{40,220}$`)
)

const schema = `
create table if not exists reservations (
	id text primary key,
	label text not null,
	address text not null,
	owner_id integer not null,
	invoice_id text not null,
	created_at integer not null
);
create index if not exists reservations_label on reservations (label);
create table if not exists names (
	label text primary key,
	address text not null,
	owner_id integer not null,
	seq integer not null default 1,
	published_seq integer not null default 0,
	source_ref text not null,
	active_image_id integer,
	image_slots integer not null default 5,
	created_at integer not null,
	updated_at integer not null
);
create index if not exists names_owner on names (owner_id);
create table if not exists images (
	id integer primary key,
	label text not null,
	hash text not null,
	content_type text not null,
	size_bytes integer not null,
	data blob not null,
	created_at integer not null
);
create index if not exists images_label on images (label);
create table if not exists image_slot_orders (
	id text primary key,
	label text not null,
	owner_id integer not null,
	qty integer not null,
	invoice_id text not null,
	applied_at integer,
	created_at integer not null
);
`

// PublishedSeq trails Seq while a dns write is pending or failed. OwnerID is
// an opaque accounts user id, this package does not verify it exists.
type Name struct {
	Label        string
	Address      string
	OwnerID      int64
	Seq          uint64
	PublishedSeq uint64
	ImageSlots   int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Reservation struct {
	ID      string
	Label   string
	Address string
	OwnerID int64
	Invoice invoice.Invoice
}

// Registry owns reservations and minted names and fulfills paid name
// purchases by publishing the sal_alias1 record. Shares one db with the
// invoice manager, availability checks join on its invoices table.
type Registry struct {
	db     *sql.DB
	mgr    *invoice.Manager
	writer dns.Writer
	pinner pin.Pinner
	zone   string
}

func New(db *sql.DB, mgr *invoice.Manager, writer dns.Writer, pinner pin.Pinner, zone string) (*Registry, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	if _, err := db.Exec(logSchema); err != nil {
		return nil, err
	}
	r := &Registry{db: db, mgr: mgr, writer: writer, pinner: pinner, zone: zone}
	mgr.Register(invoice.NamePurchase, r.fulfill)
	mgr.Register(invoice.ImageSlots, r.fulfillSlots)
	return r, nil
}

// NormalizeLabel lowercases, trims, and strips an optional .sal suffix.
func NormalizeLabel(input string) (string, error) {
	label := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(input)), ".sal")
	if !labelPattern.MatchString(label) {
		return "", ErrInvalid
	}
	return label, nil
}

func (r *Registry) Reserve(ctx context.Context, ownerID int64, labelInput, address string, amountAtomic uint64) (Reservation, error) {
	label, err := NormalizeLabel(labelInput)
	if err != nil {
		return Reservation{}, err
	}
	if reservedLabels[label] {
		return Reservation{}, ErrReserved
	}
	if !addressPattern.MatchString(address) {
		return Reservation{}, fmt.Errorf("%w: address", ErrInvalid)
	}

	taken, err := r.taken(ctx, label)
	if err != nil {
		return Reservation{}, err
	}
	if taken {
		return Reservation{}, ErrTaken
	}

	id := newID()
	inv, err := r.mgr.Create(ctx, invoice.NamePurchase, id, amountAtomic)
	if err != nil {
		return Reservation{}, err
	}

	_, err = r.db.ExecContext(ctx,
		`insert into reservations (id, label, address, owner_id, invoice_id, created_at) values (?, ?, ?, ?, ?, ?)`,
		id, label, address, ownerID, inv.ID, time.Now().UTC().UnixNano())
	if err != nil {
		return Reservation{}, err
	}

	return Reservation{ID: id, Label: label, Address: address, OwnerID: ownerID, Invoice: inv}, nil
}

func (r *Registry) Lookup(ctx context.Context, labelInput string) (Name, error) {
	label, err := NormalizeLabel(labelInput)
	if err != nil {
		return Name{}, err
	}

	var n Name
	var created, updated int64
	err = r.db.QueryRowContext(ctx,
		`select label, address, owner_id, seq, published_seq, image_slots, created_at, updated_at from names where label = ?`, label).
		Scan(&n.Label, &n.Address, &n.OwnerID, &n.Seq, &n.PublishedSeq, &n.ImageSlots, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Name{}, ErrNotFound
	}
	if err != nil {
		return Name{}, err
	}
	n.CreatedAt = time.Unix(0, created).UTC()
	n.UpdatedAt = time.Unix(0, updated).UTC()
	return n, nil
}

// NamesByOwner lists an account's names for the dashboard.
func (r *Registry) NamesByOwner(ctx context.Context, ownerID int64) ([]Name, error) {
	rows, err := r.db.QueryContext(ctx,
		`select label, address, owner_id, seq, published_seq, image_slots, created_at, updated_at
		 from names where owner_id = ? order by label`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Name
	for rows.Next() {
		var n Name
		var created, updated int64
		if err := rows.Scan(&n.Label, &n.Address, &n.OwnerID, &n.Seq, &n.PublishedSeq, &n.ImageSlots, &created, &updated); err != nil {
			return nil, err
		}
		n.CreatedAt = time.Unix(0, created).UTC()
		n.UpdatedAt = time.Unix(0, updated).UTC()
		out = append(out, n)
	}
	return out, rows.Err()
}

// Available reports whether a label is free to reserve.
func (r *Registry) Available(ctx context.Context, labelInput string) (bool, error) {
	label, err := NormalizeLabel(labelInput)
	if err != nil {
		return false, err
	}
	if reservedLabels[label] {
		return false, nil
	}
	taken, err := r.taken(ctx, label)
	return !taken, err
}

// InvoiceContext resolves what a payment invoice is for and who owns it,
// covering name purchases and image slot orders.
type InvoiceContext struct {
	Label   string
	OwnerID int64
	Kind    invoice.Kind
}

func (r *Registry) InvoiceContext(ctx context.Context, invoiceID string) (InvoiceContext, error) {
	var ic InvoiceContext
	err := r.db.QueryRowContext(ctx,
		`select label, owner_id from reservations where invoice_id = ?`, invoiceID).
		Scan(&ic.Label, &ic.OwnerID)
	if err == nil {
		ic.Kind = invoice.NamePurchase
		return ic, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return InvoiceContext{}, err
	}

	err = r.db.QueryRowContext(ctx,
		`select label, owner_id from image_slot_orders where invoice_id = ?`, invoiceID).
		Scan(&ic.Label, &ic.OwnerID)
	if errors.Is(err, sql.ErrNoRows) {
		return InvoiceContext{}, ErrNotFound
	}
	if err != nil {
		return InvoiceContext{}, err
	}
	ic.Kind = invoice.ImageSlots
	return ic, nil
}

func (r *Registry) ownedName(ctx context.Context, ownerID int64, labelInput string) (Name, error) {
	n, err := r.Lookup(ctx, labelInput)
	if err != nil {
		return Name{}, err
	}
	if n.OwnerID != ownerID {
		return Name{}, ErrForbidden
	}
	return n, nil
}

func (r *Registry) taken(ctx context.Context, label string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from names where label = ?)`, label).Scan(&exists)
	if err != nil || exists {
		return exists, err
	}
	err = r.db.QueryRowContext(ctx,
		`select exists(select 1 from reservations r join invoices i on i.id = r.invoice_id
		 where r.label = ? and i.status = 'pending')`, label).Scan(&exists)
	return exists, err
}

// fulfill is idempotent: the insert is a no-op on retry and ownership is
// checked via source_ref, so a failed dns write retries the publish alone.
func (r *Registry) fulfill(ctx context.Context, inv invoice.Invoice) error {
	var label, address string
	var ownerID int64
	err := r.db.QueryRowContext(ctx,
		`select label, address, owner_id from reservations where id = ?`, inv.Ref).Scan(&label, &address, &ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("reservation %s missing", inv.Ref)
	}
	if err != nil {
		return err
	}

	now := time.Now().UTC().UnixNano()
	res, err := r.db.ExecContext(ctx,
		`insert into names (label, address, owner_id, seq, source_ref, created_at, updated_at)
		 values (?, ?, ?, 1, ?, ?, ?) on conflict(label) do nothing`,
		label, address, ownerID, inv.Ref, now, now)
	if err != nil {
		return err
	}
	inserted, err := res.RowsAffected()
	if err != nil {
		return err
	}

	var owner string
	var seq uint64
	if err := r.db.QueryRowContext(ctx,
		`select source_ref, address, seq from names where label = ?`, label).
		Scan(&owner, &address, &seq); err != nil {
		return err
	}
	if owner != inv.Ref {
		return fmt.Errorf("label %s already owned by another reservation", label)
	}

	if inserted > 0 {
		if err := r.logEvent(ctx, "register", label, ownerID, map[string]any{
			"address":    address,
			"seq":        seq,
			"invoice_id": inv.ID,
		}); err != nil {
			return err
		}
	}

	return r.publish(ctx, label, address, seq)
}

func (r *Registry) publish(ctx context.Context, label, address string, seq uint64) error {
	if err := r.writer.UpsertTXT(ctx, label+"."+r.zone, dns.Record(address, seq)); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`update names set published_seq = ? where label = ? and published_seq < ?`, seq, label, seq)
	return err
}

// UpdateAddress records the change durably, bumps seq, and attempts an
// immediate republish. A failed dns write is retried by RepublishPending,
// visible to callers as PublishedSeq trailing Seq.
func (r *Registry) UpdateAddress(ctx context.Context, ownerID int64, labelInput, newAddress string) (Name, error) {
	label, err := NormalizeLabel(labelInput)
	if err != nil {
		return Name{}, err
	}
	if !addressPattern.MatchString(newAddress) {
		return Name{}, fmt.Errorf("%w: address", ErrInvalid)
	}

	current, err := r.Lookup(ctx, label)
	if err != nil {
		return Name{}, err
	}
	if current.OwnerID != ownerID {
		return Name{}, ErrForbidden
	}
	if current.Address == newAddress {
		return current, nil
	}

	now := time.Now().UTC().UnixNano()
	if _, err := r.db.ExecContext(ctx,
		`update names set address = ?, seq = seq + 1, updated_at = ? where label = ?`,
		newAddress, now, label); err != nil {
		return Name{}, err
	}

	name, err := r.Lookup(ctx, label)
	if err != nil {
		return Name{}, err
	}
	if err := r.logEvent(ctx, "update_address", label, ownerID, map[string]any{
		"old_address": current.Address,
		"new_address": newAddress,
		"seq":         name.Seq,
	}); err != nil {
		return Name{}, err
	}
	if err := r.publish(ctx, label, name.Address, name.Seq); err != nil {
		log.Printf("republish %s deferred: %v", label, err)
		return name, nil
	}
	name.PublishedSeq = name.Seq
	return name, nil
}

// RepublishPending pushes every record whose zone state trails the db.
func (r *Registry) RepublishPending(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx,
		`select label, address, seq from names where published_seq < seq`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pending struct {
		label, address string
		seq            uint64
	}
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.label, &p.address, &p.seq); err != nil {
			return err
		}
		todo = append(todo, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	var errs []error
	for _, p := range todo {
		if err := r.publish(ctx, p.label, p.address, p.seq); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", p.label, err))
		}
	}
	return errors.Join(errs...)
}

// Run retries pending republishes on an interval until the context is cancelled.
func (r *Registry) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.RepublishPending(ctx); err != nil {
				log.Printf("republish pending: %v", err)
			}
		}
	}
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
