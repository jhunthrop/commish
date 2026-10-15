package hostmoves

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// PurposeConfirm scopes the key derived for confirm tokens.
const PurposeConfirm = "commish host move confirm v1"

// ConfirmFor is how long a plan's token makes its move.
const ConfirmFor = 10 * time.Minute

const (
	expiryBytes = 8
	macBytes    = 32
)

// The ways a token does not make a move.
var (
	ErrTokenOther   = errors.New("hostmoves: the token is for another account, league or move")
	ErrTokenExpired = errors.New("hostmoves: the token expired")
)

// Signer makes and checks confirm tokens: an expiry and an HMAC over the
// account, the league, the move's content and the expiry. A token is
// stateless until it is used; its digest is kept with the move it made,
// so it makes one.
type Signer struct{ Key []byte }

// digest is the move's content: kind, week and every change in order.
func digest(mv apitypes.HostMoveInput) ([]byte, error) {
	b, err := json.Marshal(mv)
	if err != nil {
		return nil, fmt.Errorf("hostmoves: digest: %w", err)
	}
	sum := sha256.Sum256(b)
	return sum[:], nil
}

func (s Signer) mac(account, link uuid.UUID, content []byte, exp int64) []byte {
	h := hmac.New(sha256.New, s.Key)
	h.Write(account[:])
	h.Write(link[:])
	h.Write(content)
	var e [expiryBytes]byte
	binary.BigEndian.PutUint64(e[:], uint64(exp))
	h.Write(e[:])
	return h.Sum(nil)
}

// Sign is the token for the move, good until expires.
func (s Signer) Sign(account, link uuid.UUID, mv apitypes.HostMoveInput, expires time.Time) (string, error) {
	content, err := digest(mv)
	if err != nil {
		return "", err
	}
	exp := expires.Unix()
	buf := make([]byte, expiryBytes, expiryBytes+macBytes)
	binary.BigEndian.PutUint64(buf, uint64(exp))
	return base64.RawURLEncoding.EncodeToString(append(buf, s.mac(account, link, content, exp)...)), nil
}

// Verify checks the token makes this move for this account on this
// league now, and answers its digest, which the move keeps.
func (s Signer) Verify(token string, account, link uuid.UUID, mv apitypes.HostMoveInput, now time.Time) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != expiryBytes+macBytes {
		return nil, ErrTokenOther
	}
	content, err := digest(mv)
	if err != nil {
		return nil, err
	}
	exp := int64(binary.BigEndian.Uint64(raw[:expiryBytes]))
	if !hmac.Equal(raw[expiryBytes:], s.mac(account, link, content, exp)) {
		return nil, ErrTokenOther
	}
	if !now.Before(time.Unix(exp, 0)) {
		return nil, ErrTokenExpired
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}
