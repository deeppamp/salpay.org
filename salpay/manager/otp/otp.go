// Package otp implements rfc 6238 totp with sha1, 6 digits, 30 second steps.
package otp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	Digits = 6
	Period = 30

	secretBytes = 20
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func NewSecret() string {
	b := make([]byte, secretBytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b32.EncodeToString(b)
}

// URI renders the otpauth uri that enrollment qr codes encode.
func URI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{"secret": {secret}, "issuer": {issuer}}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

func Code(secret string, t time.Time) (string, error) {
	return hotp(secret, t.Unix()/Period)
}

// Validate accepts one step of clock drift either side and returns the
// matched step so callers can reject replays within the window.
func Validate(secret, code string, t time.Time) (int64, bool) {
	now := t.Unix() / Period
	for _, step := range []int64{now, now - 1, now + 1} {
		want, err := hotp(secret, step)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

func hotp(secret string, step int64) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", fmt.Errorf("bad secret: %w", err)
	}
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0xf
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000), nil
}
