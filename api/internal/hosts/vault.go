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
	"strconv"
)

// Envelope encryption: each connection has its own random data key. Two
// ciphertexts sit under it, AES-256-GCM: the session (the host's cookies,
// opened for every read) and the sign-in (opened only to renew a session).
// The data key is wrapped under the key-encryption key of the row's key
// version (HOST_CREDENTIALS_KEY in Secret Manager). Every seal binds the
// account, the host and what the ciphertext is, so a row moved to another
// account does not open and a session never opens as a sign-in.
// Rotation re-wraps data keys only (Rewrap, the re-encrypt job).

// ErrSealed is a row that does not open: another key, another account,
// tampered.
var ErrSealed = errors.New("hosts: credential does not open")

// ErrNoKey is a process with no HOST_CREDENTIALS_KEY: connecting answers
// that it is not set up here.
var ErrNoKey = errors.New("hosts: no credentials key")

// Session is what every read opens: the host's cookies by name.
type Session map[string]string

// SignIn is what only a renewal opens: the member's own sign-in. It never
// reaches a log or a response: String, GoString, LogValue and MarshalJSON
// all say it is redacted, and it is marshalled only through its wire form
// to be sealed.
type SignIn struct {
	Username string
	Password string
}

type signInWire struct {
	Username string `json:"u"`
	Password string `json:"p"`
}

const redacted = "[redacted]"

func (SignIn) String() string   { return redacted }
func (SignIn) GoString() string { return redacted }

// LogValue keeps slog from printing it.
func (SignIn) LogValue() slog.Value { return slog.StringValue(redacted) }

// MarshalJSON keeps a sign-in out of any JSON but its own seal.
func (SignIn) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// Sealed is a connection's secrets as a row keeps them.
type Sealed struct {
	WrappedKey []byte
	SessionCT  []byte
	SignInCT   []byte
	KeyVersion int
}

// Vault seals and opens secrets: the current key seals, every key in the
// ring opens the rows wrapped under its version.
type Vault struct {
	current int
	ring    map[int]cipher.AEAD
}

// Keys is the key ring: the current key's version and every key by
// version (the current one and, during a rotation, the previous one).
type Keys struct {
	Current int
	ByVer   map[int][]byte
}

// NewVault takes the key ring. An empty ring makes a vault that refuses
// every seal and open with ErrNoKey.
func NewVault(keys Keys) (*Vault, error) {
	v := &Vault{current: keys.Current, ring: map[int]cipher.AEAD{}}
	for ver, key := range keys.ByVer {
		if key == nil {
			continue
		}
		aead, err := gcm(key)
		if err != nil {
			return nil, fmt.Errorf("hosts: key version %d: %w", ver, err)
		}
		v.ring[ver] = aead
	}
	if len(v.ring) > 0 {
		if _, ok := v.ring[keys.Current]; !ok {
			return nil, fmt.Errorf("hosts: no key for the current version %d", keys.Current)
		}
	}
	return v, nil
}

// OneKey is a ring of one key at version 1, for tests and a first key.
func OneKey(key []byte) Keys { return Keys{Current: 1, ByVer: map[int][]byte{1: key}} }

// Ready reports whether the vault has its current key.
func (v *Vault) Ready() bool { return v != nil && v.ring[v.current] != nil }

// Current is the version new rows are wrapped under.
func (v *Vault) Current() int { return v.current }

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

// associated binds a seal to its account, host and part.
func associated(accountID, host, part string) []byte {
	return []byte("commish host credential v2|" + accountID + "|" + host + "|" + part)
}

const (
	partKey     = "key"
	partSession = "session"
	partSignIn  = "signin"
)

// Seal encrypts a connection's session and sign-in under a new data key.
func (v *Vault) Seal(accountID, host string, session Session, in SignIn) (Sealed, error) {
	if !v.Ready() {
		return Sealed{}, ErrNoKey
	}
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return Sealed{}, fmt.Errorf("hosts: data key: %w", err)
	}
	data, err := gcm(dek)
	if err != nil {
		return Sealed{}, err
	}
	sessionPlain, err := json.Marshal(map[string]string(session))
	if err != nil {
		return Sealed{}, fmt.Errorf("hosts: encode session: %w", err)
	}
	signInPlain, err := json.Marshal(signInWire(in))
	if err != nil {
		return Sealed{}, fmt.Errorf("hosts: encode sign-in: %w", err)
	}
	return Sealed{
		WrappedKey: seal(v.ring[v.current], dek, associated(accountID, host, partKey+strconv.Itoa(v.current))),
		SessionCT:  seal(data, sessionPlain, associated(accountID, host, partSession)),
		SignInCT:   seal(data, signInPlain, associated(accountID, host, partSignIn)),
		KeyVersion: v.current,
	}, nil
}

// Reseal keeps a new session under the row's own data key: the sign-in's
// ciphertext is left as it is, never opened.
func (v *Vault) Reseal(accountID, host string, s Sealed, session Session) (Sealed, error) {
	data, err := v.dataKey(accountID, host, s)
	if err != nil {
		return Sealed{}, err
	}
	plain, err := json.Marshal(map[string]string(session))
	if err != nil {
		return Sealed{}, fmt.Errorf("hosts: encode session: %w", err)
	}
	s.SessionCT = seal(data, plain, associated(accountID, host, partSession))
	return s, nil
}

func (v *Vault) dataKey(accountID, host string, s Sealed) (cipher.AEAD, error) {
	if !v.Ready() {
		return nil, ErrNoKey
	}
	kek, ok := v.ring[s.KeyVersion]
	if !ok {
		return nil, ErrSealed
	}
	dek, err := open(kek, s.WrappedKey, associated(accountID, host, partKey+strconv.Itoa(s.KeyVersion)))
	if err != nil {
		return nil, err
	}
	data, err := gcm(dek)
	if err != nil {
		return nil, ErrSealed
	}
	return data, nil
}

// OpenSession decrypts a connection's session, for a read.
func (v *Vault) OpenSession(accountID, host string, s Sealed) (Session, error) {
	data, err := v.dataKey(accountID, host, s)
	if err != nil {
		return nil, err
	}
	plain, err := open(data, s.SessionCT, associated(accountID, host, partSession))
	if err != nil {
		return nil, err
	}
	var out map[string]string
	if err := json.Unmarshal(plain, &out); err != nil {
		return nil, ErrSealed
	}
	return out, nil
}

// OpenSignIn decrypts a connection's sign-in. Only a renewal calls it.
func (v *Vault) OpenSignIn(accountID, host string, s Sealed) (SignIn, error) {
	data, err := v.dataKey(accountID, host, s)
	if err != nil {
		return SignIn{}, err
	}
	plain, err := open(data, s.SignInCT, associated(accountID, host, partSignIn))
	if err != nil {
		return SignIn{}, err
	}
	var out signInWire
	if err := json.Unmarshal(plain, &out); err != nil {
		return SignIn{}, ErrSealed
	}
	return SignIn(out), nil
}

// Rewrap is a row's data key wrapped under the current key; the
// ciphertexts are untouched. A row already current comes back as it is.
func (v *Vault) Rewrap(accountID, host string, s Sealed) (Sealed, error) {
	if s.KeyVersion == v.current {
		return s, nil
	}
	kek, ok := v.ring[s.KeyVersion]
	if !ok || !v.Ready() {
		return Sealed{}, ErrSealed
	}
	dek, err := open(kek, s.WrappedKey, associated(accountID, host, partKey+strconv.Itoa(s.KeyVersion)))
	if err != nil {
		return Sealed{}, err
	}
	s.WrappedKey = seal(v.ring[v.current], dek, associated(accountID, host, partKey+strconv.Itoa(v.current)))
	s.KeyVersion = v.current
	return s, nil
}
