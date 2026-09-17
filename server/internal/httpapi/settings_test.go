package httpapi

import (
	"strings"
	"testing"
)

func testSealingKey(t *testing.T) string {
	t.Helper()
	// Fixed 32-byte test key, hex-encoded. Never used outside tests.
	return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

func TestSealOpenSettingsRoundtrip(t *testing.T) {
	key := testSealingKey(t)
	sealed, err := sealSettingsValue(key, "sk-or-v1-test-key")
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if sealed == "sk-or-v1-test-key" || !strings.HasPrefix(sealed, settingsSealPrefix) {
		t.Fatalf("expected sealed value, got %q", sealed)
	}
	opened, err := openSettingsValue(key, sealed)
	if err != nil {
		t.Fatalf("open failed: %v", err)
	}
	if opened != "sk-or-v1-test-key" {
		t.Fatalf("roundtrip mismatch, got %q", opened)
	}
}

func TestSealSettingsNonceRandomness(t *testing.T) {
	key := testSealingKey(t)
	first, err := sealSettingsValue(key, "same-key")
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	second, err := sealSettingsValue(key, "same-key")
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if first == second {
		t.Fatal("expected randomized nonces to differ")
	}
}

func TestOpenSettingsRejectsWrongKey(t *testing.T) {
	sealed, err := sealSettingsValue(testSealingKey(t), "sk-or-v1-test-key")
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	wrong := "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if _, err := openSettingsValue(wrong, sealed); err == nil {
		t.Fatal("expected authentication failure with the wrong key")
	}
}

func TestSettingsSealingKeyValidation(t *testing.T) {
	if _, err := settingsSealingKey(""); err == nil {
		t.Fatal("expected empty key to be rejected")
	}
	if _, err := settingsSealingKey("not-hex"); err == nil {
		t.Fatal("expected non-hex key to be rejected")
	}
	if _, err := settingsSealingKey("abcd"); err == nil {
		t.Fatal("expected short key to be rejected")
	}
}

func TestSettingsPassthroughWithoutKey(t *testing.T) {
	sealed, err := sealSettingsValue("", "sk-or-v1-test-key")
	if err != nil {
		t.Fatalf("seal failed: %v", err)
	}
	if sealed != "sk-or-v1-test-key" {
		t.Fatalf("expected passthrough without a key, got %q", sealed)
	}
	opened, err := openSettingsValue("", sealed)
	if err != nil || opened != "sk-or-v1-test-key" {
		t.Fatalf("expected passthrough open, got %q / %v", opened, err)
	}
	if opened, err := openSettingsValue("", ""); err != nil || opened != "" {
		t.Fatalf("expected empty passthrough, got %q / %v", opened, err)
	}
}
