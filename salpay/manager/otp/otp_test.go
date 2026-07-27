package otp

import (
	"strings"
	"testing"
	"time"
)

// rfc 6238 appendix B sha1 vectors, truncated to 6 digits.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestRFCVectors(t *testing.T) {
	cases := map[int64]string{
		59:          "287082",
		1111111109:  "081804",
		1111111111:  "050471",
		1234567890:  "005924",
		2000000000:  "279037",
		20000000000: "353130",
	}
	for unix, want := range cases {
		got, err := Code(rfcSecret, time.Unix(unix, 0))
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("t=%d: got %s want %s", unix, got, want)
		}
	}
}

func TestValidateWindow(t *testing.T) {
	now := time.Unix(1111111111, 0)
	for _, unix := range []int64{1111111111 - Period, 1111111111, 1111111111 + Period} {
		code, _ := Code(rfcSecret, time.Unix(unix, 0))
		step, ok := Validate(rfcSecret, code, now)
		if !ok || step != unix/Period {
			t.Errorf("code for t=%d: ok=%v step=%d", unix, ok, step)
		}
	}
	if _, ok := Validate(rfcSecret, "000000", now); ok {
		t.Error("accepted wrong code")
	}
	old, _ := Code(rfcSecret, now.Add(-2*Period*time.Second))
	if _, ok := Validate(rfcSecret, old, now); ok {
		t.Error("accepted code two steps old")
	}
}

func TestSecretAndURI(t *testing.T) {
	s := NewSecret()
	if s == NewSecret() {
		t.Fatal("secrets repeat")
	}
	if _, err := Code(s, time.Now()); err != nil {
		t.Fatal(err)
	}
	uri := URI("sal.cash", "alice", s)
	if !strings.HasPrefix(uri, "otpauth://totp/sal.cash:alice?") || !strings.Contains(uri, "secret="+s) {
		t.Fatalf("uri: %s", uri)
	}
	if _, err := Code("not base32!", time.Now()); err == nil {
		t.Fatal("bad secret accepted")
	}
}
