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

const (
	testUser = "member@example.invalid"
	testPass = "not-a-real-password"
)

func TestVaultSealsPerAccountAndHostAndPart(t *testing.T) {
	v, err := NewVault(OneKey(key(t)))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := v.Seal("account-a", "ffpc", Session{"BGSLMSession": "x"}, SignIn{Username: testUser, Password: testPass})
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range [][]byte{sealed.SessionCT, sealed.SignInCT, sealed.WrappedKey} {
		if bytes.Contains(part, []byte(testPass)) || bytes.Contains(part, []byte("member@")) {
			t.Fatal("the sealed row holds the secret in the clear")
		}
	}
	session, err := v.OpenSession("account-a", "ffpc", sealed)
	if err != nil || session["BGSLMSession"] != "x" {
		t.Fatalf("open session: %v", err)
	}
	in, err := v.OpenSignIn("account-a", "ffpc", sealed)
	if err != nil || in.Password != testPass {
		t.Fatalf("open sign-in: %v", err)
	}
	if _, err := v.OpenSession("account-b", "ffpc", sealed); !errors.Is(err, ErrSealed) {
		t.Fatalf("another account opened it: %v", err)
	}
	swapped := sealed
	swapped.SessionCT = sealed.SignInCT
	if _, err := v.OpenSession("account-a", "ffpc", swapped); !errors.Is(err, ErrSealed) {
		t.Fatalf("a sign-in opened as a session: %v", err)
	}
	other, _ := NewVault(OneKey(key(t)))
	if _, err := other.OpenSession("account-a", "ffpc", sealed); !errors.Is(err, ErrSealed) {
		t.Fatalf("another key opened it: %v", err)
	}
	resealed, err := v.Reseal("account-a", "ffpc", sealed, Session{"BGSLMSession": "y"})
	if err != nil || !bytes.Equal(resealed.SignInCT, sealed.SignInCT) {
		t.Fatalf("reseal changed the sign-in: %v", err)
	}
	if s, err := v.OpenSession("account-a", "ffpc", resealed); err != nil || s["BGSLMSession"] != "y" {
		t.Fatalf("resealed session: %v", err)
	}
}

// A row sealed under version 1 opens under version 2 once re-wrapped,
// with version 1 gone from the ring.
func TestRewrapStepsTheKeyVersion(t *testing.T) {
	k1, k2 := key(t), key(t)
	v1, _ := NewVault(OneKey(k1))
	sealed, err := v1.Seal("account-a", "ffpc", Session{"c": "1"}, SignIn{Username: testUser, Password: testPass})
	if err != nil {
		t.Fatal(err)
	}
	rotating, err := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2, 1: k1}})
	if err != nil {
		t.Fatal(err)
	}
	next, err := rotating.Rewrap("account-a", "ffpc", sealed)
	if err != nil || next.KeyVersion != 2 {
		t.Fatalf("rewrap: %v at %d", err, next.KeyVersion)
	}
	v2, _ := NewVault(Keys{Current: 2, ByVer: map[int][]byte{2: k2}})
	if in, err := v2.OpenSignIn("account-a", "ffpc", next); err != nil || in.Password != testPass {
		t.Fatalf("version 2 alone: %v", err)
	}
	if _, err := v2.OpenSession("account-a", "ffpc", sealed); !errors.Is(err, ErrSealed) {
		t.Fatalf("a version 1 row opened without version 1: %v", err)
	}
}

func TestSignInNeverPrints(t *testing.T) {
	s := SignIn{Username: testUser, Password: testPass}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("x", "signin", s)
	for _, out := range []string{fmt.Sprint(s), fmt.Sprintf("%v %+v %#v", s, s, s), buf.String()} {
		if strings.Contains(out, testPass) || strings.Contains(out, "member@") {
			t.Fatalf("printed: %s", out)
		}
	}
}

func TestVaultWithoutKey(t *testing.T) {
	v, err := NewVault(Keys{Current: 1})
	if err != nil || v.Ready() {
		t.Fatalf("a keyless vault: %v", err)
	}
	if _, err := v.Seal("a", "ffpc", nil, SignIn{}); !errors.Is(err, ErrNoKey) {
		t.Fatalf("seal without a key: %v", err)
	}
	if _, err := v.SealTokens("a", "yahoo", nil, nil); !errors.Is(err, ErrNoKey) {
		t.Fatalf("seal tokens without a key: %v", err)
	}
}

// A token-based connection: the renewal opens only as a renewal, never as
// a sign-in, a reseal keeps the data key, and a session never prints.
func TestVaultTokens(t *testing.T) {
	v, err := NewVault(OneKey(key(t)))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := v.SealTokens("acct", "yahoo", Session{"access": "a1"}, Session{"refresh": "r1"})
	if err != nil {
		t.Fatal(err)
	}
	if r, err := v.OpenRenewal("acct", "yahoo", sealed); err != nil || r["refresh"] != "r1" {
		t.Fatalf("renewal: %v", err)
	}
	if _, err := v.OpenSignIn("acct", "yahoo", sealed); err == nil {
		t.Fatal("a renewal opened as a sign-in")
	}
	if _, err := v.OpenRenewal("other", "yahoo", sealed); err == nil {
		t.Fatal("a renewal opened for another account")
	}
	next, err := v.ResealTokens("acct", "yahoo", sealed, Session{"access": "a2"}, Session{"refresh": "r2"})
	if err != nil || !bytes.Equal(next.WrappedKey, sealed.WrappedKey) {
		t.Fatalf("reseal: %v", err)
	}
	s, err := v.OpenSession("acct", "yahoo", next)
	if err != nil || s["access"] != "a2" {
		t.Fatalf("resealed session: %v", err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("session", "s", s)
	if printed := fmt.Sprintf("%v %+v %#v %s", s, s, s, buf.String()); strings.Contains(printed, "a2") {
		t.Fatalf("a session printed: %s", printed)
	}
}
