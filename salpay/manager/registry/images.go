package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/deeppamp/salpay.org/salpay/manager/imgproc"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
)

type Image struct {
	ID          int64
	Label       string
	CID         string
	ContentType string
	SizeBytes   int64
	Active      bool
	CreatedAt   time.Time
}

// AddImage normalizes an upload, pins it, and stores it in the name's
// library. The first image auto activates. The db blob is the serving copy,
// ipfs is the durable public one.
func (r *Registry) AddImage(ctx context.Context, ownerID int64, labelInput string, data []byte) (Image, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return Image{}, err
	}

	var count, slots int
	if err := r.db.QueryRowContext(ctx,
		`select count(*), (select image_slots from names where label = ?) from images where label = ?`,
		name.Label, name.Label).Scan(&count, &slots); err != nil {
		return Image{}, err
	}
	if count >= slots {
		return Image{}, ErrNoSlots
	}

	clean, contentType, err := imgproc.Normalize(data)
	if err != nil {
		return Image{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	cid, err := r.pinner.Pin(ctx, name.Label, clean)
	if err != nil {
		return Image{}, fmt.Errorf("pin: %w", err)
	}

	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`insert into images (label, cid, content_type, size_bytes, data, created_at) values (?, ?, ?, ?, ?, ?)`,
		name.Label, cid, contentType, len(clean), clean, now.UnixNano())
	if err != nil {
		return Image{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Image{}, err
	}

	img := Image{ID: id, Label: name.Label, CID: cid, ContentType: contentType, SizeBytes: int64(len(clean)), CreatedAt: now}
	var active sql.NullInt64
	if err := r.db.QueryRowContext(ctx,
		`select active_image_id from names where label = ?`, name.Label).Scan(&active); err != nil {
		return Image{}, err
	}
	if !active.Valid {
		if err := r.setActive(ctx, name.Label, &id); err != nil {
			return Image{}, err
		}
		img.Active = true
	}
	return img, nil
}

func (r *Registry) Images(ctx context.Context, ownerID int64, labelInput string) ([]Image, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx,
		`select i.id, i.cid, i.content_type, i.size_bytes, i.created_at,
		        i.id = coalesce(n.active_image_id, 0)
		 from images i join names n on n.label = i.label
		 where i.label = ? order by i.id`, name.Label)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Image
	for rows.Next() {
		var img Image
		var created int64
		if err := rows.Scan(&img.ID, &img.CID, &img.ContentType, &img.SizeBytes, &created, &img.Active); err != nil {
			return nil, err
		}
		img.Label = name.Label
		img.CreatedAt = time.Unix(0, created).UTC()
		out = append(out, img)
	}
	return out, rows.Err()
}

func (r *Registry) ActivateImage(ctx context.Context, ownerID int64, labelInput string, imageID int64) error {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return err
	}
	var exists bool
	if err := r.db.QueryRowContext(ctx,
		`select exists(select 1 from images where id = ? and label = ?)`, imageID, name.Label).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return r.setActive(ctx, name.Label, &imageID)
}

// ResetImage returns the name to the generated qr default.
func (r *Registry) ResetImage(ctx context.Context, ownerID int64, labelInput string) error {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return err
	}
	return r.setActive(ctx, name.Label, nil)
}

func (r *Registry) DeleteImage(ctx context.Context, ownerID int64, labelInput string, imageID int64) error {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return err
	}

	var active sql.NullInt64
	if err := r.db.QueryRowContext(ctx,
		`select active_image_id from names where label = ?`, name.Label).Scan(&active); err != nil {
		return err
	}
	if active.Valid && active.Int64 == imageID {
		if err := r.setActive(ctx, name.Label, nil); err != nil {
			return err
		}
	}

	res, err := r.db.ExecContext(ctx, `delete from images where id = ? and label = ?`, imageID, name.Label)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// setActive changes the published record (cid key), so seq bumps and the
// record republishes, deferred on dns failure like address updates.
func (r *Registry) setActive(ctx context.Context, label string, imageID *int64) error {
	now := time.Now().UTC().UnixNano()
	var id any
	if imageID != nil {
		id = *imageID
	}
	if _, err := r.db.ExecContext(ctx,
		`update names set active_image_id = ?, seq = seq + 1, updated_at = ? where label = ?`,
		id, now, label); err != nil {
		return err
	}

	name, err := r.Lookup(ctx, label)
	if err != nil {
		return err
	}
	if err := r.publish(ctx, label, name.Address, name.Seq); err != nil {
		log.Printf("republish %s deferred: %v", label, err)
	}
	return nil
}

// ActiveImage is ungated, it backs the public image url.
func (r *Registry) ActiveImage(ctx context.Context, labelInput string) (data []byte, contentType string, ok bool, err error) {
	label, err := NormalizeLabel(labelInput)
	if err != nil {
		return nil, "", false, err
	}
	err = r.db.QueryRowContext(ctx,
		`select i.data, i.content_type from names n join images i on i.id = n.active_image_id where n.label = ?`, label).
		Scan(&data, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, err
	}
	return data, contentType, true, nil
}

// ImageData serves owner previews of any library image.
func (r *Registry) ImageData(ctx context.Context, ownerID int64, labelInput string, imageID int64) ([]byte, string, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return nil, "", err
	}
	var data []byte
	var contentType string
	err = r.db.QueryRowContext(ctx,
		`select data, content_type from images where id = ? and label = ?`, imageID, name.Label).
		Scan(&data, &contentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return data, contentType, nil
}

// BuySlots invoices one slot pack for a name.
func (r *Registry) BuySlots(ctx context.Context, ownerID int64, labelInput string, amountAtomic uint64) (invoice.Invoice, error) {
	name, err := r.ownedName(ctx, ownerID, labelInput)
	if err != nil {
		return invoice.Invoice{}, err
	}

	id := newID()
	inv, err := r.mgr.Create(ctx, invoice.ImageSlots, id, amountAtomic)
	if err != nil {
		return invoice.Invoice{}, err
	}
	_, err = r.db.ExecContext(ctx,
		`insert into image_slot_orders (id, label, owner_id, qty, invoice_id, created_at) values (?, ?, ?, ?, ?, ?)`,
		id, name.Label, ownerID, SlotPack, inv.ID, time.Now().UTC().UnixNano())
	if err != nil {
		return invoice.Invoice{}, err
	}
	return inv, nil
}

// fulfillSlots applies a paid slot order once, in a transaction so a retry
// after a crash cannot double add.
func (r *Registry) fulfillSlots(ctx context.Context, inv invoice.Invoice) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`update image_slot_orders set applied_at = ? where id = ? and applied_at is null`,
		time.Now().UTC().UnixNano(), inv.Ref)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return tx.Commit()
	}

	if _, err := tx.ExecContext(ctx,
		`update names set image_slots = image_slots + (select qty from image_slot_orders where id = ?)
		 where label = (select label from image_slot_orders where id = ?)`,
		inv.Ref, inv.Ref); err != nil {
		return err
	}
	return tx.Commit()
}
