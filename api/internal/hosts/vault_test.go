package hosts

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func key(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return k
}

func TestVaultSealsPerAccountAndHost(t *testing.T) {
	v, err := NewVault(key(t))
	if err != nil {
		t.Fatal(err)
	}
	secret := Secret{Username: "member@example.invalid", Password: "not-a-real-password", Cookies: map[string]string{"BGSLMSession": "x"}}
	sealed, err := v.Seal("account-a", "ffpc", secret)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed.Ciphertext, []byte("not-a-real-password")) || bytes.Contains(sealed.WrappedKey, []byte("member@")) {
		t.Fatal("the sealed row holds the secret in the clear")
	}
	got, err := v.Open("account-a", "ffpc", sealed)
	if err != nil || got.Password != secret.Password || got.Cookies["BGSLMSession"] != "x" {
		t.Fatalf("open: %v", err)
	}
	if _, err := v.Open("account-b", "ffpc", sealed); !errors.Is(err, ErrSealed) {
		t.Fatalf("another account opened it: %v", err)
	}
	other, _ := NewVault(key(t))
	if _, err := other.Open("account-a", "ffpc", sealed); !errors.Is(err, ErrSealed) {
		t.Fatalf("another key opened it: %v", err)
	}
	tampered := sealed
	tampered.Ciphertext = append([]byte(nil), sealed.Ciphertext...)
	tampered.Ciphertext[len(tampered.Ciphertext)-1] ^= 1
	if _, err := v.Open("account-a", "ffpc", tampered); !errors.Is(err, ErrSealed) {
		t.Fatalf("a tampered row opened: %v", err)
	}
}

func TestSecretNeverPrints(t *testing.T) {
	s := Secret{Username: "member@example.invalid", Password: "not-a-real-password"}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("x", "secret", s)
	for _, out := range []string{fmt.Sprint(s), fmt.Sprintf("%v %+v %#v", s, s, s), buf.String()} {
		if strings.Contains(out, "not-a-real-password") || strings.Contains(out, "member@") {
			t.Fatalf("printed: %s", out)
		}
	}
}

func TestVaultWithoutKey(t *testing.T) {
	v, err := NewVault(nil)
	if err != nil || v.Ready() {
		t.Fatalf("a keyless vault: %v", err)
	}
	if _, err := v.Seal("a", "ffpc", Secret{}); !errors.Is(err, ErrNoKey) {
		t.Fatalf("seal without a key: %v", err)
	}
}
