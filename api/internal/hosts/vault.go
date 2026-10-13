// Package hosts keeps a member's connected account on another host (FFPC
// first): what the host handed back at sign-in, encrypted at rest, opened
// only by the sync worker that reads the host as the member.
package hosts

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
)

// Envelope encryption: each connection has its own random data key; the
// secret is sealed under it with AES-256-GCM, and the data key is sealed
// under the key-encryption key from Secret Manager (HOST_CREDENTIALS_KEY).
// Both seals bind the account and host as associated data, so a sealed
// row moved to another account or host does not open. Rotating the
// key-encryption key re-wraps data keys only.

// ErrSealed is a row that does not open: another key, another account,
// tampered.
var ErrSealed = errors.New("hosts: credential does not open")

// ErrNoKey is a process with no HOST_CREDENTIALS_KEY: connecting answers
// that it is not set up here.
var ErrNoKey = errors.New("hosts: no credentials key")

// KeyVersion names the key-encryption key a row was wrapped under.
const KeyVersion = 1

// Secret is what a connection keeps: the host's session cookies and, only
// because the host offers no other way to renew a session, the sign-in.
// It never reaches a log or a response: its String and LogValue say only
// that it is redacted, and it is marshalled only to be sealed.
type Secret struct {
	Username string
	Password string
	Cookies  map[string]string
}

// wire is a secret as it is sealed, the only form that is marshalled.
type wire struct {
	Username string            `json:"u"`
	Password string            `json:"p"`
	Cookies  map[string]string `json:"c"`
}

// MarshalJSON keeps a secret out of any JSON but its own seal.
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

const redacted = "[redacted]"

func (Secret) String() string { return redacted }

// GoString keeps %#v from printing it.
func (Secret) GoString() string { return redacted }

// LogValue keeps slog from printing it.
func (Secret) LogValue() slog.Value { return slog.StringValue(redacted) }

// Sealed is a secret as a row keeps it.
type Sealed struct {
	WrappedKey []byte
	Ciphertext []byte
	KeyVersion int
}

// Vault seals and opens secrets under the key-encryption key.
type Vault struct{ kek cipher.AEAD }

// NewVault takes the 32-byte key-encryption key. A nil key makes a vault
// that refuses every seal and open with ErrNoKey.
func NewVault(kek []byte) (*Vault, error) {
	if kek == nil {
		return &Vault{}, nil
	}
	aead, err := gcm(kek)
	if err != nil {
		return nil, err
	}
	return &Vault{kek: aead}, nil
}

// Ready reports whether the vault has its key.
func (v *Vault) Ready() bool { return v != nil && v.kek != nil }

func gcm(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("hosts: key of %d bytes", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("hosts: cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

func seal(aead cipher.AEAD, plain, ad []byte) []byte {
	nonce := make([]byte, aead.NonceSize())
	_, _ = rand.Read(nonce)
	return aead.Seal(nonce, nonce, plain, ad)
}

func open(aead cipher.AEAD, sealed, ad []byte) ([]byte, error) {
	n := aead.NonceSize()
	if len(sealed) < n {
		return nil, ErrSealed
	}
	plain, err := aead.Open(nil, sealed[:n], sealed[n:], ad)
	if err != nil {
		return nil, ErrSealed
	}
	return plain, nil
}

// associated binds a seal to its account and host.
func associated(accountID, host string) []byte {
	return []byte("commish host credential v1|" + accountID + "|" + host)
}

// Seal encrypts a secret for one account's connection to one host.
func (v *Vault) Seal(accountID, host string, s Secret) (Sealed, error) {
	if !v.Ready() {
		return Sealed{}, ErrNoKey
	}
	plain, err := json.Marshal(wire(s))
	if err != nil {
		return Sealed{}, fmt.Errorf("hosts: encode secret: %w", err)
	}
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return Sealed{}, fmt.Errorf("hosts: data key: %w", err)
	}
	data, err := gcm(dek)
	if err != nil {
		return Sealed{}, err
	}
	ad := associated(accountID, host)
	return Sealed{WrappedKey: seal(v.kek, dek, ad), Ciphertext: seal(data, plain, ad), KeyVersion: KeyVersion}, nil
}

// Open decrypts a connection's secret. Only the sync worker calls it.
func (v *Vault) Open(accountID, host string, s Sealed) (Secret, error) {
	if !v.Ready() {
		return Secret{}, ErrNoKey
	}
	if s.KeyVersion != KeyVersion {
		return Secret{}, ErrSealed
	}
	ad := associated(accountID, host)
	dek, err := open(v.kek, s.WrappedKey, ad)
	if err != nil {
		return Secret{}, err
	}
	data, err := gcm(dek)
	if err != nil {
		return Secret{}, ErrSealed
	}
	plain, err := open(data, s.Ciphertext, ad)
	if err != nil {
		return Secret{}, err
	}
	var out wire
	if err := json.Unmarshal(plain, &out); err != nil {
		return Secret{}, ErrSealed
	}
	return Secret(out), nil
}
