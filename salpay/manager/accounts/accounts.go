package accounts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"github.com/deeppamp/salpay.org/salpay/manager/otp"
)

var (
	ErrUsernameTaken  = errors.New("username taken")
	ErrBadCredentials = errors.New("bad credentials")
	ErrTOTPRequired   = errors.New("totp code required")
	ErrBadCode        = errors.New("bad code")
	ErrUnauthorized   = errors.New("unauthorized")
	ErrInvalid        = errors.New("invalid input")
)

const schema = `
create table if not exists users (
	id integer primary key,
	username text not null unique,
	password_hash text not null,
	totp_secret text not null default '',
	totp_enabled integer not null default 0,
	totp_last_step integer not null default 0,
	support_phrase_hash text not null default '',
	created_at integer not null
);
create table if not exists sessions (
	token text primary key,
	user_id integer not null,
	created_at integer not null,
	last_seen integer not null,
	expires_at integer not null
);
create index if not exists sessions_user on sessions (user_id);
create table if not exists recovery_codes (
	code_hash text primary key,
	user_id integer not null,
	used_at integer not null default 0
);
create index if not exists recovery_user on recovery_codes (user_id);
`

type User struct {
	ID               int64
	Username         string
	TOTPEnabled      bool
	HasSupportPhrase bool
	CreatedAt        time.Time
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
}

type Accounts struct {
	db   *sql.DB
	ttl  time.Duration
	idle time.Duration
}

// New creates the store. A session dies at sessionTTL from login or after
// idleTTL without a request, whichever comes first, so a browser left open
// on a shared machine goes stale on its own.
func New(db *sql.DB, sessionTTL, idleTTL time.Duration) (*Accounts, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	if idleTTL <= 0 || idleTTL > sessionTTL {
		idleTTL = sessionTTL
	}
	return &Accounts{db: db, ttl: sessionTTL, idle: idleTTL}, nil
}

const usernameChars = "abcdefghijklmnopqrstuvwxyz0123456789._-"

func normalizeUsername(username string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(username))
	if len(u) < 3 || len(u) > 32 {
		return "", fmt.Errorf("%w: username must be 3 to 32 characters", ErrInvalid)
	}
	for _, c := range u {
		if !strings.ContainsRune(usernameChars, c) {
			return "", fmt.Errorf("%w: username may use a-z, 0-9, dot, dash, underscore", ErrInvalid)
		}
	}
	return u, nil
}

// validatePassword is length-first per nist 800-63b: no composition rules,
// spaces welcome, so a few random words is the easy way to pass.
func validatePassword(username, password string) error {
	n := utf8.RuneCountInString(password)
	if n < 12 {
		return fmt.Errorf("%w: password under 12 characters, a few random words work well", ErrInvalid)
	}
	if n > 128 {
		return fmt.Errorf("%w: password over 128 characters", ErrInvalid)
	}
	lower := strings.ToLower(password)
	if username != "" && strings.Contains(lower, username) {
		return fmt.Errorf("%w: password contains your username", ErrInvalid)
	}
	if strings.Count(lower, lower[:1]) == len(lower) {
		return fmt.Errorf("%w: password is one repeated character", ErrInvalid)
	}
	squashed := strings.Join(strings.Fields(lower), "")
	for _, bad := range knownBadPasswords {
		if squashed == bad {
			return fmt.Errorf("%w: that password is on every cracking list", ErrInvalid)
		}
	}
	return nil
}

// long enough to clear the length check, famous enough to be in wordlists
var knownBadPasswords = []string{
	"correcthorsebatterystaple",
	"password1234", "password12345", "password123456",
	"123456789012", "123456789012345",
	"qwertyuiop12", "qwertyuiopasdfgh",
	"letmeinletmein", "adminadminadmin",
	"iloveyouiloveyou", "trustno1trustno1",
}

func (a *Accounts) Register(ctx context.Context, username, password string) (User, error) {
	name, err := normalizeUsername(username)
	if err != nil {
		return User{}, err
	}
	if err := validatePassword(name, password); err != nil {
		return User{}, err
	}

	hash, err := hashPassword(password)
	if err != nil {
		return User{}, err
	}

	now := time.Now().UTC()
	res, err := a.db.ExecContext(ctx,
		`insert into users (username, password_hash, created_at) values (?, ?, ?)`,
		name, hash, now.UnixNano())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrUsernameTaken
		}
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	return User{ID: id, Username: name, CreatedAt: now}, nil
}

// Login checks the password and, when totp is enabled, a second factor:
// a current totp code or an unused recovery code.
func (a *Accounts) Login(ctx context.Context, username, password, code string) (Session, error) {
	name, err := normalizeUsername(username)
	if err != nil {
		return Session{}, ErrBadCredentials
	}

	var id, lastStep int64
	var hash, secret string
	var enabled bool
	err = a.db.QueryRowContext(ctx,
		`select id, password_hash, totp_secret, totp_enabled, totp_last_step from users where username = ?`, name).
		Scan(&id, &hash, &secret, &enabled, &lastStep)
	if errors.Is(err, sql.ErrNoRows) {
		// Burn the same hashing cost for unknown usernames, keeps timing level.
		verifyPassword(dummyHash, password)
		return Session{}, ErrBadCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !verifyPassword(hash, password) {
		return Session{}, ErrBadCredentials
	}

	if enabled {
		if strings.TrimSpace(code) == "" {
			return Session{}, ErrTOTPRequired
		}
		if err := a.checkSecondFactor(ctx, id, secret, lastStep, code); err != nil {
			return Session{}, err
		}
	}
	return a.newSession(ctx, id)
}

// Recover consumes a recovery code to set a new password, revoking every
// existing session. It is the only path in when the password is gone.
func (a *Accounts) Recover(ctx context.Context, username, code, newPassword string) (Session, error) {
	name, err := normalizeUsername(username)
	if err != nil {
		return Session{}, ErrBadCredentials
	}
	if err := validatePassword(name, newPassword); err != nil {
		return Session{}, err
	}

	var id int64
	err = a.db.QueryRowContext(ctx, `select id from users where username = ?`, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrBadCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if err := a.consumeRecoveryCode(ctx, id, code); err != nil {
		return Session{}, ErrBadCredentials
	}

	hash, err := hashPassword(newPassword)
	if err != nil {
		return Session{}, err
	}
	if _, err := a.db.ExecContext(ctx, `update users set password_hash = ? where id = ?`, hash, id); err != nil {
		return Session{}, err
	}
	if _, err := a.db.ExecContext(ctx, `delete from sessions where user_id = ?`, id); err != nil {
		return Session{}, err
	}
	return a.newSession(ctx, id)
}

func (a *Accounts) VerifyPassword(ctx context.Context, userID int64, password string) error {
	var hash string
	err := a.db.QueryRowContext(ctx, `select password_hash from users where id = ?`, userID).Scan(&hash)
	if err != nil {
		return err
	}
	if !verifyPassword(hash, password) {
		return ErrBadCredentials
	}
	return nil
}

const (
	recoveryCodeCount = 10
	recoveryCodeLen   = 16
	// no i, l, o, u, 0, 1: unambiguous when written down
	recoveryAlphabet = "abcdefghjkmnpqrstvwxyz23456789"
)

// GenerateRecoveryCodes replaces any unused codes and returns the new set,
// the only time the plaintext exists.
func (a *Accounts) GenerateRecoveryCodes(ctx context.Context, userID int64) ([]string, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`delete from recovery_codes where user_id = ? and used_at = 0`, userID); err != nil {
		return nil, err
	}
	codes := make([]string, recoveryCodeCount)
	for i := range codes {
		code, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		codes[i] = code
		if _, err := tx.ExecContext(ctx,
			`insert into recovery_codes (code_hash, user_id) values (?, ?)`,
			hashRecoveryCode(code), userID); err != nil {
			return nil, err
		}
	}
	return codes, tx.Commit()
}

func newRecoveryCode() (string, error) {
	raw := make([]byte, recoveryCodeLen)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	var b strings.Builder
	for i, c := range raw {
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(recoveryAlphabet[int(c)%len(recoveryAlphabet)])
	}
	return b.String(), nil
}

func hashRecoveryCode(code string) string {
	norm := strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:])
}

func (a *Accounts) consumeRecoveryCode(ctx context.Context, userID int64, code string) error {
	res, err := a.db.ExecContext(ctx,
		`update recovery_codes set used_at = ? where code_hash = ? and user_id = ? and used_at = 0`,
		time.Now().UTC().UnixNano(), hashRecoveryCode(code), userID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrBadCode
	}
	return nil
}

// BeginTOTP returns the pending secret for enrollment, creating one if
// needed. Refreshing the page must not rotate a secret already shown.
func (a *Accounts) BeginTOTP(ctx context.Context, userID int64) (string, error) {
	secret, enabled, err := a.totpState(ctx, userID)
	if err != nil {
		return "", err
	}
	if enabled {
		return "", fmt.Errorf("%w: totp already enabled", ErrInvalid)
	}
	if secret != "" {
		return secret, nil
	}
	secret = otp.NewSecret()
	if _, err := a.db.ExecContext(ctx,
		`update users set totp_secret = ? where id = ?`, secret, userID); err != nil {
		return "", err
	}
	return secret, nil
}

// PendingTOTPSecret returns the not-yet-confirmed secret, empty when
// enrollment is not in progress.
func (a *Accounts) PendingTOTPSecret(ctx context.Context, userID int64) (string, error) {
	secret, enabled, err := a.totpState(ctx, userID)
	if err != nil || enabled {
		return "", err
	}
	return secret, nil
}

// ConfirmTOTP proves the authenticator works before the account depends
// on it.
func (a *Accounts) ConfirmTOTP(ctx context.Context, userID int64, code string) error {
	secret, enabled, err := a.totpState(ctx, userID)
	if err != nil {
		return err
	}
	if enabled || secret == "" {
		return fmt.Errorf("%w: no enrollment in progress", ErrInvalid)
	}
	step, ok := otp.Validate(secret, strings.TrimSpace(code), time.Now())
	if !ok {
		return ErrBadCode
	}
	_, err = a.db.ExecContext(ctx,
		`update users set totp_enabled = 1, totp_last_step = ? where id = ?`, step, userID)
	return err
}

func (a *Accounts) DisableTOTP(ctx context.Context, userID int64, password, code string) error {
	if err := a.VerifyPassword(ctx, userID, password); err != nil {
		return err
	}
	var lastStep int64
	var secret string
	var enabled bool
	err := a.db.QueryRowContext(ctx,
		`select totp_secret, totp_enabled, totp_last_step from users where id = ?`, userID).
		Scan(&secret, &enabled, &lastStep)
	if err != nil {
		return err
	}
	if !enabled {
		return fmt.Errorf("%w: totp not enabled", ErrInvalid)
	}
	if err := a.checkSecondFactor(ctx, userID, secret, lastStep, code); err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx,
		`update users set totp_secret = '', totp_enabled = 0, totp_last_step = 0 where id = ?`, userID)
	return err
}

// VerifyCode is the step-up check for sensitive operations: a current totp
// code or an unused recovery code, only for accounts with totp on.
func (a *Accounts) VerifyCode(ctx context.Context, userID int64, code string) error {
	var lastStep int64
	var secret string
	var enabled bool
	err := a.db.QueryRowContext(ctx,
		`select totp_secret, totp_enabled, totp_last_step from users where id = ?`, userID).
		Scan(&secret, &enabled, &lastStep)
	if err != nil {
		return err
	}
	if !enabled {
		return fmt.Errorf("%w: totp not enabled", ErrInvalid)
	}
	return a.checkSecondFactor(ctx, userID, secret, lastStep, code)
}

func (a *Accounts) totpState(ctx context.Context, userID int64) (secret string, enabled bool, err error) {
	err = a.db.QueryRowContext(ctx,
		`select totp_secret, totp_enabled from users where id = ?`, userID).Scan(&secret, &enabled)
	return secret, enabled, err
}

// checkSecondFactor takes a totp code (6 digits, replay-protected by step)
// or falls back to consuming a recovery code.
func (a *Accounts) checkSecondFactor(ctx context.Context, userID int64, secret string, lastStep int64, code string) error {
	code = strings.TrimSpace(code)
	if isDigits(code) && len(code) == otp.Digits {
		step, ok := otp.Validate(secret, code, time.Now())
		if !ok || step <= lastStep {
			return ErrBadCode
		}
		_, err := a.db.ExecContext(ctx,
			`update users set totp_last_step = ? where id = ?`, step, userID)
		return err
	}
	return a.consumeRecoveryCode(ctx, userID, code)
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

func (a *Accounts) newSession(ctx context.Context, userID int64) (Session, error) {
	token := newToken()
	now := time.Now().UTC()
	expires := now.Add(a.ttl)
	if _, err := a.db.ExecContext(ctx,
		`insert into sessions (token, user_id, created_at, last_seen, expires_at) values (?, ?, ?, ?, ?)`,
		token, userID, now.UnixNano(), now.UnixNano(), expires.UnixNano()); err != nil {
		return Session{}, err
	}
	return Session{Token: token, UserID: userID, ExpiresAt: expires}, nil
}

func (a *Accounts) Logout(ctx context.Context, token string) error {
	_, err := a.db.ExecContext(ctx, `delete from sessions where token = ?`, token)
	return err
}

// UserByToken enforces the idle window and slides it forward on use.
func (a *Accounts) UserByToken(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthorized
	}
	now := time.Now().UTC()
	var u User
	var created int64
	err := a.db.QueryRowContext(ctx,
		`select u.id, u.username, u.totp_enabled, u.support_phrase_hash != '', u.created_at
		 from sessions s join users u on u.id = s.user_id
		 where s.token = ? and s.expires_at > ? and s.last_seen > ?`,
		token, now.UnixNano(), now.Add(-a.idle).UnixNano()).
		Scan(&u.ID, &u.Username, &u.TOTPEnabled, &u.HasSupportPhrase, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, err
	}
	if _, err := a.db.ExecContext(ctx,
		`update sessions set last_seen = ? where token = ?`, now.UnixNano(), token); err != nil {
		return User{}, err
	}
	u.CreatedAt = time.Unix(0, created).UTC()
	return u, nil
}

func (a *Accounts) PruneSessions(ctx context.Context) error {
	now := time.Now().UTC()
	_, err := a.db.ExecContext(ctx,
		`delete from sessions where expires_at <= ? or last_seen <= ?`,
		now.UnixNano(), now.Add(-a.idle).UnixNano())
	return err
}

// SetSupportPhrase stores a phrase the user can state to support later.
// Write only: it is never displayed back, and only a hash is kept.
func (a *Accounts) SetSupportPhrase(ctx context.Context, userID int64, password, phrase string) error {
	if err := a.VerifyPassword(ctx, userID, password); err != nil {
		return err
	}
	phrase = normalizePhrase(phrase)
	if len(phrase) < 8 {
		return fmt.Errorf("%w: support phrase under 8 characters", ErrInvalid)
	}
	hash, err := hashPassword(phrase)
	if err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx,
		`update users set support_phrase_hash = ? where id = ?`, hash, userID)
	return err
}

// CheckSupportPhrase is the operator-side verify for support requests.
func (a *Accounts) CheckSupportPhrase(ctx context.Context, username, phrase string) (bool, error) {
	name, err := normalizeUsername(username)
	if err != nil {
		return false, err
	}
	var hash string
	err = a.db.QueryRowContext(ctx,
		`select support_phrase_hash from users where username = ?`, name).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if hash == "" {
		return false, nil
	}
	return verifyPassword(hash, normalizePhrase(phrase)), nil
}

// normalizePhrase forgives case and spacing: the phrase gets spoken or
// typed to a human, not pasted.
func normalizePhrase(phrase string) string {
	return strings.Join(strings.Fields(strings.ToLower(phrase)), " ")
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
