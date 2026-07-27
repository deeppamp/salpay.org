package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const logSchema = `
create table if not exists audit_log (
	id integer primary key,
	at integer not null,
	event text not null,
	label text not null,
	owner_id integer not null,
	detail text not null,
	prev_hash text not null,
	hash text not null
);
`

// LogEntry is public transparency data. Owner ids stay in the db, publishing
// them would link names across one account.
type LogEntry struct {
	ID       int64           `json:"id"`
	At       time.Time       `json:"at"`
	Event    string          `json:"event"`
	Label    string          `json:"label"`
	Detail   json.RawMessage `json:"detail"`
	PrevHash string          `json:"prev_hash"`
	Hash     string          `json:"hash"`
}

// logEvent appends to the tamper evident log. Each hash covers the previous
// one, so rewriting any entry breaks every hash after it and mirrors detect
// the rewrite.
func (r *Registry) logEvent(ctx context.Context, event, label string, ownerID int64, detail map[string]any) error {
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lastID int64
	var lastHash string
	err = tx.QueryRowContext(ctx, `select id, hash from audit_log order by id desc limit 1`).Scan(&lastID, &lastHash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	id := lastID + 1
	at := time.Now().UTC().UnixNano()
	hash := chainHash(lastHash, id, at, event, label, raw)
	if _, err := tx.ExecContext(ctx,
		`insert into audit_log (id, at, event, label, owner_id, detail, prev_hash, hash) values (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, at, event, label, ownerID, string(raw), lastHash, hash); err != nil {
		return err
	}
	return tx.Commit()
}

func chainHash(prevHash string, id, at int64, event, label string, detail []byte) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%s|%s|%s", prevHash, id, at, event, label, detail)))
	return hex.EncodeToString(sum[:])
}

func (r *Registry) LogEntries(ctx context.Context, sinceID int64, limit int) ([]LogEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	rows, err := r.db.QueryContext(ctx,
		`select id, at, event, label, detail, prev_hash, hash from audit_log where id > ? order by id limit ?`,
		sinceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LogEntry
	for rows.Next() {
		var e LogEntry
		var at int64
		var detail string
		if err := rows.Scan(&e.ID, &at, &e.Event, &e.Label, &detail, &e.PrevHash, &e.Hash); err != nil {
			return nil, err
		}
		e.At = time.Unix(0, at).UTC()
		e.Detail = json.RawMessage(detail)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Registry) LogHead(ctx context.Context) (id int64, hash string, err error) {
	err = r.db.QueryRowContext(ctx, `select id, hash from audit_log order by id desc limit 1`).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", nil
	}
	return id, hash, err
}
