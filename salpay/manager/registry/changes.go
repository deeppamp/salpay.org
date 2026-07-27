package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const changesSchema = `
create table if not exists address_changes (
	id integer primary key,
	label text not null,
	owner_id integer not null,
	old_address text not null,
	new_address text not null,
	created_at integer not null,
	apply_at integer not null,
	applied_at integer,
	canceled_at integer
);
create index if not exists address_changes_label on address_changes (label);
`

// AddressChange is a scheduled redirect of a name's payments. It sits in
// the public log for the whole window, which is the notification channel:
// no email, anyone can watch their own name.
type AddressChange struct {
	ID         int64
	Label      string
	OldAddress string
	NewAddress string
	CreatedAt  time.Time
	ApplyAt    time.Time
}

// RequestAddressChange schedules a change, replacing any pending one.
func (r *Registry) RequestAddressChange(ctx context.Context, ownerID int64, labelInput, newAddress string, applyAt time.Time) (AddressChange, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return AddressChange{}, err
	}
	if !addressPattern.MatchString(newAddress) {
		return AddressChange{}, fmt.Errorf("%w: address", ErrInvalid)
	}
	if name.Address == newAddress {
		return AddressChange{}, fmt.Errorf("%w: address unchanged", ErrInvalid)
	}

	if _, err := r.cancelPending(ctx, name.Label, ownerID, true); err != nil {
		return AddressChange{}, err
	}

	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`insert into address_changes (label, owner_id, old_address, new_address, created_at, apply_at)
		 values (?, ?, ?, ?, ?, ?)`,
		name.Label, ownerID, name.Address, newAddress, now.UnixNano(), applyAt.UTC().UnixNano())
	if err != nil {
		return AddressChange{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return AddressChange{}, err
	}
	if err := r.logEvent(ctx, "address_change_request", name.Label, ownerID, map[string]any{
		"old_address": name.Address,
		"new_address": newAddress,
		"apply_at":    applyAt.UTC().UnixNano(),
	}); err != nil {
		return AddressChange{}, err
	}
	return AddressChange{
		ID: id, Label: name.Label, OldAddress: name.Address, NewAddress: newAddress,
		CreatedAt: now, ApplyAt: applyAt.UTC(),
	}, nil
}

// PendingAddressChange returns the owner's scheduled change, ok false when
// none is pending.
func (r *Registry) PendingAddressChange(ctx context.Context, ownerID int64, labelInput string) (AddressChange, bool, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return AddressChange{}, false, err
	}
	var c AddressChange
	var created, applyAt int64
	err = r.db.QueryRowContext(ctx,
		`select id, old_address, new_address, created_at, apply_at from address_changes
		 where label = ? and applied_at is null and canceled_at is null`, name.Label).
		Scan(&c.ID, &c.OldAddress, &c.NewAddress, &created, &applyAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AddressChange{}, false, nil
	}
	if err != nil {
		return AddressChange{}, false, err
	}
	c.Label = name.Label
	c.CreatedAt = time.Unix(0, created).UTC()
	c.ApplyAt = time.Unix(0, applyAt).UTC()
	return c, true, nil
}

func (r *Registry) CancelAddressChange(ctx context.Context, ownerID int64, labelInput string) error {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return err
	}
	canceled, err := r.cancelPending(ctx, name.Label, ownerID, false)
	if err != nil {
		return err
	}
	if !canceled {
		return ErrNotFound
	}
	return nil
}

// cancelPending voids the pending change if one exists and logs it, with
// replaced marking cancels caused by a newer request or an instant change.
func (r *Registry) cancelPending(ctx context.Context, label string, ownerID int64, replaced bool) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`update address_changes set canceled_at = ? where label = ? and applied_at is null and canceled_at is null`,
		time.Now().UTC().UnixNano(), label)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil
	}
	return true, r.logEvent(ctx, "address_change_cancel", label, ownerID, map[string]any{
		"replaced": replaced,
	})
}

// ApplyDueAddressChanges flips due changes live. The applied_at guard makes
// a crash retry idempotent, same pattern as invoice fulfillment.
func (r *Registry) ApplyDueAddressChanges(ctx context.Context) error {
	rows, err := r.db.QueryContext(ctx,
		`select id, label, owner_id, new_address from address_changes
		 where applied_at is null and canceled_at is null and apply_at <= ?`,
		time.Now().UTC().UnixNano())
	if err != nil {
		return err
	}
	type due struct {
		id      int64
		label   string
		ownerID int64
		address string
	}
	var todo []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.label, &d.ownerID, &d.address); err != nil {
			rows.Close()
			return err
		}
		todo = append(todo, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, d := range todo {
		res, err := r.db.ExecContext(ctx,
			`update address_changes set applied_at = ? where id = ? and applied_at is null and canceled_at is null`,
			time.Now().UTC().UnixNano(), d.id)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil || n == 0 {
			if err != nil {
				return err
			}
			continue
		}
		if _, err := r.applyAddress(ctx, d.ownerID, d.label, d.address); err != nil {
			return err
		}
	}
	return nil
}
