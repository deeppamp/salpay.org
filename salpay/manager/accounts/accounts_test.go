package accounts

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/otp"
)

func testAccounts(t *testing.T, ttl, idle time.Duration) *Accounts {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	a, err := New(db, ttl, idle)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestRegisterLoginSession(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	user, err := a.Register(ctx, " Alice.9 ", "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if user.Username != "alice.9" {
		t.Fatalf("username not normalized: %q", user.Username)
	}

	sess, err := a.Login(ctx, "alice.9", "correct horse battery", "")
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

func TestRegisterValidation(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	if _, err := a.Register(ctx, "bob", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Register(ctx, "BOB", "long enough pass"); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("want ErrUsernameTaken, got %v", err)
	}
	for _, bad := range []string{"ab", "has space", "wüt"} {
		if _, err := a.Register(ctx, bad, "long enough pass"); !errors.Is(err, ErrInvalid) {
			t.Fatalf("username %q: want ErrInvalid, got %v", bad, err)
		}
	}
	for _, bad := range []string{
		"short",
		"has my name bob in it",
		"aaaaaaaaaaaaaaaa",
		"Correct Horse Battery Staple",
	} {
		if _, err := a.Register(ctx, "carol", strings.Replace(bad, "name bob", "name carol", 1)); !errors.Is(err, ErrInvalid) {
			t.Fatalf("password %q: want ErrInvalid, got %v", bad, err)
		}
	}
	if _, err := a.Login(ctx, "nobody", "long enough pass", ""); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("want ErrBadCredentials for unknown username, got %v", err)
	}
	if _, err := a.Login(ctx, "bob", "wrong password!", ""); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("want ErrBadCredentials, got %v", err)
	}
}

func TestSessionExpiry(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, -time.Second, time.Hour)

	if _, err := a.Register(ctx, "eve", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	sess, err := a.Login(ctx, "eve", "long enough pass", "")
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

func TestIdleTimeout(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, 50*time.Millisecond)

	if _, err := a.Register(ctx, "dave", "long enough pass"); err != nil {
		t.Fatal(err)
	}
	sess, err := a.Login(ctx, "dave", "long enough pass", "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := a.UserByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	time.Sleep(80 * time.Millisecond)
	if _, err := a.UserByToken(ctx, sess.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized after idle, got %v", err)
	}

	// activity slides the window
	sess, err = a.Login(ctx, "dave", "long enough pass", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		time.Sleep(30 * time.Millisecond)
		if _, err := a.UserByToken(ctx, sess.Token); err != nil {
			t.Fatalf("touch %d: %v", i, err)
		}
	}
}

func TestRecoveryCodes(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	u, err := a.Register(ctx, "erin", "long enough pass")
	if err != nil {
		t.Fatal(err)
	}
	codes, err := a.GenerateRecoveryCodes(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != recoveryCodeCount {
		t.Fatalf("got %d codes", len(codes))
	}

	sess, err := a.Recover(ctx, "erin", codes[0], "brand new password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.UserByToken(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Login(ctx, "erin", "long enough pass", ""); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("old password still works: %v", err)
	}
	if _, err := a.Login(ctx, "erin", "brand new password", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Recover(ctx, "erin", codes[0], "third password!!"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("used code accepted: %v", err)
	}
	// codes survive spacing and case differences
	if _, err := a.Recover(ctx, "erin", "  "+strings.ToUpper(codes[1])+" ", "third password!!"); err != nil {
		t.Fatal(err)
	}

	// regeneration invalidates unused codes
	fresh, err := a.GenerateRecoveryCodes(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Recover(ctx, "erin", codes[2], "fourth password!"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("stale code accepted: %v", err)
	}
	if _, err := a.Recover(ctx, "erin", fresh[0], "fourth password!"); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverRevokesSessions(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	u, _ := a.Register(ctx, "frank", "long enough pass")
	codes, _ := a.GenerateRecoveryCodes(ctx, u.ID)
	old, err := a.Login(ctx, "frank", "long enough pass", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Recover(ctx, "frank", codes[0], "brand new password"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UserByToken(ctx, old.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("old session survived recovery: %v", err)
	}
}

func TestTOTPLifecycle(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	u, _ := a.Register(ctx, "grace", "long enough pass")

	secret, err := a.BeginTOTP(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.BeginTOTP(ctx, u.ID)
	if err != nil || again != secret {
		t.Fatalf("pending secret rotated on refresh: %v", err)
	}
	pending, err := a.PendingTOTPSecret(ctx, u.ID)
	if err != nil || pending != secret {
		t.Fatalf("pending secret: %q %v", pending, err)
	}

	if err := a.ConfirmTOTP(ctx, u.ID, "000000"); !errors.Is(err, ErrBadCode) {
		t.Fatalf("bad confirm accepted: %v", err)
	}
	code, _ := otp.Code(secret, time.Now())
	if err := a.ConfirmTOTP(ctx, u.ID, code); err != nil {
		t.Fatal(err)
	}
	if _, err := a.BeginTOTP(ctx, u.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("re-enroll while enabled: %v", err)
	}
	if pending, _ := a.PendingTOTPSecret(ctx, u.ID); pending != "" {
		t.Fatal("enabled secret leaked as pending")
	}

	// password alone no longer logs in
	if _, err := a.Login(ctx, "grace", "long enough pass", ""); !errors.Is(err, ErrTOTPRequired) {
		t.Fatalf("want ErrTOTPRequired, got %v", err)
	}
	// the confirm consumed this step, so the same code replays
	if _, err := a.Login(ctx, "grace", "long enough pass", code); !errors.Is(err, ErrBadCode) {
		t.Fatalf("replayed code accepted: %v", err)
	}

	// a recovery code stands in for totp
	codes, _ := a.GenerateRecoveryCodes(ctx, u.ID)
	if _, err := a.Login(ctx, "grace", "long enough pass", codes[0]); err != nil {
		t.Fatal(err)
	}

	if err := a.DisableTOTP(ctx, u.ID, "wrong password!", codes[1]); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("disable with wrong password: %v", err)
	}
	if err := a.DisableTOTP(ctx, u.ID, "long enough pass", codes[1]); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Login(ctx, "grace", "long enough pass", ""); err != nil {
		t.Fatalf("login after disable: %v", err)
	}
}

func TestSupportPhrase(t *testing.T) {
	ctx := context.Background()
	a := testAccounts(t, time.Hour, time.Hour)

	u, _ := a.Register(ctx, "heidi", "long enough pass")

	ok, err := a.CheckSupportPhrase(ctx, "heidi", "purple monkey dishwasher")
	if err != nil || ok {
		t.Fatalf("unset phrase verified: %v %v", ok, err)
	}
	if err := a.SetSupportPhrase(ctx, u.ID, "wrong password!", "purple monkey dishwasher"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("set with wrong password: %v", err)
	}
	if err := a.SetSupportPhrase(ctx, u.ID, "long enough pass", "short"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("short phrase accepted: %v", err)
	}
	if err := a.SetSupportPhrase(ctx, u.ID, "long enough pass", "Purple Monkey  Dishwasher"); err != nil {
		t.Fatal(err)
	}

	ok, err = a.CheckSupportPhrase(ctx, "heidi", "purple monkey dishwasher")
	if err != nil || !ok {
		t.Fatalf("phrase does not verify: %v %v", ok, err)
	}
	ok, _ = a.CheckSupportPhrase(ctx, "heidi", "wrong phrase entirely")
	if ok {
		t.Fatal("wrong phrase verified")
	}
	ok, _ = a.CheckSupportPhrase(ctx, "nobody", "purple monkey dishwasher")
	if ok {
		t.Fatal("unknown user verified")
	}

	sess, _ := a.Login(ctx, "heidi", "long enough pass", "")
	got, err := a.UserByToken(ctx, sess.Token)
	if err != nil || !got.HasSupportPhrase {
		t.Fatalf("HasSupportPhrase not surfaced: %+v %v", got, err)
	}
}
