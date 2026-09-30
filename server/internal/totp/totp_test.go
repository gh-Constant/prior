package totp

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B vectors (SHA-1, 8 digits) truncated to 6 digits.
func TestRFC6238Vectors(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	cases := map[int64]string{
		59:          "287082",
		1111111109:  "081804",
		1111111111:  "050471",
		1234567890:  "005924",
		2000000000:  "279037",
		20000000000: "353130",
	}
	for unix, want := range cases {
		got, err := Code(secret, Step(time.Unix(unix, 0)))
		if err != nil || got != want {
			t.Fatalf("code at %d = %q, %v; want %q", unix, got, err, want)
		}
	}
}

func TestVerifySkewAndReplay(t *testing.T) {
	secret, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	previous, _ := Code(secret, Step(now)-1)
	next, _ := Code(secret, Step(now)+1)
	far, _ := Code(secret, Step(now)+2)
	if step, ok := Verify(secret, previous, now, 0); !ok || step != Step(now)-1 {
		t.Fatal("previous step must be accepted")
	}
	if _, ok := Verify(secret, next[:3]+" "+next[3:], now, 0); !ok {
		t.Fatal("spaced next-step code must be accepted")
	}
	if _, ok := Verify(secret, far, now, 0); ok {
		t.Fatal("two steps ahead must be refused")
	}
	if _, ok := Verify(secret, previous, now, Step(now)-1); ok {
		t.Fatal("a used step must be refused")
	}
	if _, ok := Verify(secret, "12345", now, 0); ok {
		t.Fatal("short code must be refused")
	}
}

func TestURI(t *testing.T) {
	uri := URI("Prior", "ada@example.com", "JBSWY3DPEHPK3PXP")
	if !strings.HasPrefix(uri, "otpauth://totp/Prior:ada@example.com?") || !strings.Contains(uri, "secret=JBSWY3DPEHPK3PXP") || !strings.Contains(uri, "issuer=Prior") {
		t.Fatalf("uri = %s", uri)
	}
}
