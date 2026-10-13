package solo

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jhunthrop/commish/api/internal/auth"
)

// A share link is signed, so only this server writes one: the drafter's
// handle on a link, and the picks beside it, are what his own mock held.
const (
	// purposeShare scopes the keys derived for share links.
	purposeShare = "commish share link v2"
	// shareMACBytes is the signature's length on the link: 128 bits.
	shareMACBytes = 16
)

// ShareSigner signs a link's payload with the newest key and accepts any
// key it holds, so a key can rotate without breaking the links already
// passed around: put the new secret first and keep the old ones after it
// until their links no longer matter.
type ShareSigner struct {
	keys [][]byte
}

// NewShareSigner derives one key per secret, newest first. At least one
// secret is required.
func NewShareSigner(secrets []string) (*ShareSigner, error) {
	if len(secrets) == 0 {
		return nil, errors.New("solo: share links need a signing secret")
	}
	keys := make([][]byte, 0, len(secrets))
	for i, secret := range secrets {
		key, err := auth.DeriveKey(secret, purposeShare)
		if err != nil {
			return nil, fmt.Errorf("solo: share key %d: %w", i+1, err)
		}
		keys = append(keys, key)
	}
	return &ShareSigner{keys: keys}, nil
}

func mac(key, payload []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(payload)
	return h.Sum(nil)[:shareMACBytes]
}

// Sign is the payload's signature under the newest key.
func (s *ShareSigner) Sign(payload []byte) []byte { return mac(s.keys[0], payload) }

// Verify reports whether sig signs payload under any key held.
func (s *ShareSigner) Verify(payload, sig []byte) bool {
	for _, key := range s.keys {
		if hmac.Equal(mac(key, payload), sig) {
			return true
		}
	}
	return false
}
