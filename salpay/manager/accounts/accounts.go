package accounts

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

var (
	ErrEmailTaken     = errors.New("email already registered")
	ErrBadCredentials = errors.New("bad credentials")
	ErrUnauthorized   = errors.New("unauthorized")
	ErrInvalid        = errors.New("invalid input")
)

const schema = `
create table if not exists users (
	id integer primary key,
	email text not null unique,
	password_hash text not null,
	created_at integer not null
);
create table if not exists sessions (
	token text primary key,
	user_id integer not null,
	created_at integer not null,
	expires_at integer not null
);
create index if not exists sessions_user on sessions (user_id);
`

type User struct {
	ID        int64
	Email     string
	CreatedAt time.Time
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
}

type Accounts struct {
	db  *sql.DB
	ttl time.Duration
}

func New(db *sql.DB, sessionTTL time.Duration) (*Accounts, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &Accounts{db: db, ttl: sessionTTL}, nil
}

func (a *Accounts) Register(ctx context.Context, email, password string) (User, error) {
	email = normalizeEmail(email)
	if !strings.Contains(email, "@") || len(email) < 3 || len(email) > 254 {
		return User{}, fmt.Errorf("%w: email", ErrInvalid)
	}
	if len(password) < 10 {
		return User{}, fmt.Errorf("%w: password under 10 characters", ErrInvalid)
	}

	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}

	now := time.Now().UTC()
	res, err := a.db.ExecContext(ctx,
		`insert into users (email, password_hash, created_at) values (?, ?, ?)`,
		email, hash, now.UnixNano())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrEmailTaken
		}
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	return User{ID: id, Email: email, CreatedAt: now}, nil
}

func (a *Accounts) Login(ctx context.Context, email, password string) (Session, error) {
	email = normalizeEmail(email)

	var id int64
	var hash string
	err := a.db.QueryRowContext(ctx,
		`select id, password_hash from users where email = ?`, email).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		// Burn the same hashing cost for unknown emails, keeps timing level.
		verifyPassword(dummyHash, password)
		return Session{}, ErrBadCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !verifyPassword(hash, password) {
		return Session{}, ErrBadCredentials
	}

	token := newToken()
	now := time.Now().UTC()
	expires := now.Add(a.ttl)
	if _, err := a.db.ExecContext(ctx,
		`insert into sessions (token, user_id, created_at, expires_at) values (?, ?, ?, ?)`,
		token, id, now.UnixNano(), expires.UnixNano()); err != nil {
		return Session{}, err
	}
	return Session{Token: token, UserID: id, ExpiresAt: expires}, nil
}

func (a *Accounts) Logout(ctx context.Context, token string) error {
	_, err := a.db.ExecContext(ctx, `delete from sessions where token = ?`, token)
	return err
}

func (a *Accounts) UserByToken(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthorized
	}
	var u User
	var created int64
	err := a.db.QueryRowContext(ctx,
		`select u.id, u.email, u.created_at from sessions s join users u on u.id = s.user_id
		 where s.token = ? and s.expires_at > ?`, token, time.Now().UTC().UnixNano()).
		Scan(&u.ID, &u.Email, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, err
	}
	u.CreatedAt = time.Unix(0, created).UTC()
	return u, nil
}

func (a *Accounts) PruneSessions(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx,
		`delete from sessions where expires_at <= ?`, time.Now().UTC().UnixNano())
	return err
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
)

var dummyHash, _ = hashPassword("timing-equalizer-dummy")

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("argon2id$19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[2], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[3])
	if err != nil {
		return false
	}
	want, err := enc.DecodeString(parts[4])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
