package accounts

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testAccounts(t *testing.T, ttl time.Duration) *Accounts {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	a, err := New(db, ttl)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestRegisterLoginSession(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour)

	user, err := a.Register(ctx, " Alice@Example.COM ", "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "alice@example.com" {
		t.Fatalf("email not normalized: %q", user.Email)
	}

	sess, err := a.Login(ctx, "alice@example.com", "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}

	got, err := a.UserByToken(ctx, sess.Token)
	if err != nil || got.ID != user.ID {
		t.Fatalf("user by token: %+v err %v", got, err)
	}

	if err := a.Logout(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UserByToken(ctx, sess.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized after logout, got %v", err)
	}
}

func TestRegisterRejectsDuplicateAndWeakInput(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour)

	if _, err := a.Register(ctx, "bob@example.com", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Register(ctx, "BOB@example.com", "long enough pass"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("want ErrEmailTaken, got %v", err)
	}
	if _, err := a.Register(ctx, "not-an-email", "long enough pass"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid email, got %v", err)
	}
	if _, err := a.Register(ctx, "carol@example.com", "short"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid password, got %v", err)
	}
}

func TestLoginRejectsWrongAndUnknown(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour)

	if _, err := a.Register(ctx, "dave@example.com", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Login(ctx, "dave@example.com", "wrong password!"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("want ErrBadCredentials, got %v", err)
	}
	if _, err := a.Login(ctx, "ghost@example.com", "whatever pass"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("want ErrBadCredentials for unknown email, got %v", err)
	}
}

func TestSessionExpiry(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, -time.Second)

	if _, err := a.Register(ctx, "eve@example.com", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	sess, err := a.Login(ctx, "eve@example.com", "long enough pass")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.UserByToken(ctx, sess.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for expired session, got %v", err)
	}
	if err := a.PruneSessions(ctx); err != nil {
		t.Fatal(err)
	}
}
