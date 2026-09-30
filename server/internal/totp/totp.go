// Package totp implements RFC 6238 time-based one-time passwords (HMAC-SHA1,
// 30-second steps, 6 digits), the parameters every authenticator app uses.
package totp

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
	// Period is the length of one time step.
	Period = 30 * time.Second
	// Digits is the length of a code.
	Digits = 6
	// Skew is how many steps before or after the current one are accepted,
	// to absorb clock drift between the phone and the server.
	Skew = 1
)

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewSecret returns a random 160-bit secret, base32-encoded without padding.
func NewSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return encoding.EncodeToString(raw), nil
}

// Step returns the time step counter for t.
func Step(t time.Time) int64 { return t.Unix() / int64(Period/time.Second) }

// Code returns the code for a secret at a given step.
func Code(secret string, step int64) (string, error) {
	key, err := decodeSecret(secret)
	if err != nil {
		return "", err
	}
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1_000_000), nil
}

// Verify checks code against the steps around now. It returns the matched
// step so the caller can refuse any step at or before the last accepted one
// (a code is single-use). afterStep is that last accepted step.
func Verify(secret, code string, now time.Time, afterStep int64) (int64, bool) {
	code = Normalize(code)
	if len(code) != Digits {
		return 0, false
	}
	current := Step(now)
	for delta := int64(-Skew); delta <= Skew; delta++ {
		step := current + delta
		if step <= afterStep {
			continue
		}
		expected, err := Code(secret, step)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

// Normalize removes the spaces and dashes people type between digit groups.
func Normalize(code string) string {
	return strings.NewReplacer(" ", "", "-", "", " ", "").Replace(strings.TrimSpace(code))
}

// URI is the otpauth:// URI encoded in the QR code.
func URI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	values := url.Values{}
	values.Set("secret", secret)
	values.Set("issuer", issuer)
	values.Set("algorithm", "SHA1")
	values.Set("digits", fmt.Sprint(Digits))
	values.Set("period", fmt.Sprint(int(Period/time.Second)))
	return "otpauth://totp/" + label + "?" + values.Encode()
}

func decodeSecret(secret string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	cleaned = strings.TrimRight(cleaned, "=")
	key, err := encoding.DecodeString(cleaned)
	if err != nil || len(key) == 0 {
		return nil, fmt.Errorf("invalid TOTP secret")
	}
	return key, nil
}
