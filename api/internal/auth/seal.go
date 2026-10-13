// Package auth is sign-in through WorkOS AuthKit and the session that
// follows it (spec §2.6, auth-is-workos): the sealed cookie on the apex
// domain, the CSRF token bound to it, the middleware that resolves the
// account on every request, and the /auth and /me routes.
package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

// ErrUnsealable is any cookie that does not open: tampered, truncated,
// sealed under another key, or not ours at all.
var ErrUnsealable = errors.New("auth: cookie does not open")

// Sealer encrypts and authenticates small cookie payloads with
// AES-256-GCM under a key derived from WORKOS_COOKIE_PASSWORD. Each
// purpose derives its own key, so a sealed state cookie can never be
// replayed as a session cookie.
type Sealer struct {
	aead    cipher.AEAD
	purpose []byte
}

// Purposes, one key each.
const (
	purposeSession = "commish session v1"
	purposeState   = "commish auth state v1"
	purposeCSRF    = "commish csrf v1"
)

func deriveKey(password, purpose string) ([]byte, error) {
	key, err := hkdf.Key(sha256.New, []byte(password), nil, purpose, 32)
	if err != nil {
		return nil, fmt.Errorf("auth: derive %s key: %w", purpose, err)
	}
	return key, nil
}

// NewSealer derives the purpose's key from password.
func NewSealer(password, purpose string) (*Sealer, error) {
	key, err := deriveKey(password, purpose)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("auth: cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("auth: gcm: %w", err)
	}
	return &Sealer{aead: aead, purpose: []byte(purpose)}, nil
}

// Seal returns base64url(nonce || ciphertext).
func (s *Sealer) Seal(plain []byte) string {
	nonce := make([]byte, s.aead.NonceSize())
	_, _ = rand.Read(nonce)
	out := s.aead.Seal(nonce, nonce, plain, s.purpose)
	return base64.RawURLEncoding.EncodeToString(out)
}

// Open reverses Seal.
func (s *Sealer) Open(sealed string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(sealed)
	if err != nil || len(raw) < s.aead.NonceSize() {
		return nil, ErrUnsealable
	}
	n := s.aead.NonceSize()
	plain, err := s.aead.Open(nil, raw[:n], raw[n:], s.purpose)
	if err != nil {
		return nil, ErrUnsealable
	}
	return plain, nil
}

// CSRFSigner derives the CSRF token from the session it protects:
// HMAC(key, session token hash). Nothing is stored, and a cookie planted
// by anyone else cannot match, because they do not hold the session.
type CSRFSigner struct{ key []byte }

// NewCSRFSigner derives its key from password.
func NewCSRFSigner(password string) (*CSRFSigner, error) {
	key, err := deriveKey(password, purposeCSRF)
	if err != nil {
		return nil, err
	}
	return &CSRFSigner{key: key}, nil
}

// Token is the CSRF token for a session's token hash.
func (c *CSRFSigner) Token(tokenHash []byte) string {
	m := hmac.New(sha256.New, c.key)
	m.Write(tokenHash)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// Valid reports whether got is the token for tokenHash, in constant
// time.
func (c *CSRFSigner) Valid(tokenHash []byte, got string) bool {
	return hmac.Equal([]byte(c.Token(tokenHash)), []byte(got))
}

// newToken is 32 random bytes and their sha256, the pair a session is
// made of: the cookie carries the token sealed, the table the hash.
func newToken() (token, hash []byte) {
	token = make([]byte, 32)
	_, _ = rand.Read(token)
	sum := sha256.Sum256(token)
	return token, sum[:]
}

func hashToken(token []byte) []byte {
	sum := sha256.Sum256(token)
	return sum[:]
}
