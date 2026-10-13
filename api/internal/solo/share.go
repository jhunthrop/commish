package solo

import (
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// shareVersion is the code's format; a code of another version is refused.
// Version 2 is signed: the payload, a dot, and its signature (sign.go).
// Version 1 links were unsigned and no longer open.
const shareVersion = 2

// shareSeparator splits a code into its payload and signature.
const shareSeparator = "."

// maxShareBytes bounds what a code may inflate to: settings with every
// keeper and 25 picks are a few kilobytes.
const maxShareBytes = 16 << 10

// errBadCode is a code that does not decode to a draft.
var errBadCode = errors.New("solo: that link does not hold a draft")

// share is what a link carries: the mock is a function of its settings,
// its seed and the drafter's picks, so these three replay it exactly.
// ForYou is the places in Picks a stand-in made, and Sharer the drafter's
// handle when he has one. The whole payload is signed, so neither a name
// nor a pick can be put on a link this server did not write.
type share struct {
	V        int                     `json:"v"`
	Settings apitypes.LeagueSettings `json:"s"`
	Seed     int64                   `json:"seed"`
	Picks    []string                `json:"p"`
	ForYou   []int                   `json:"a,omitempty"`
	Sharer   string                  `json:"n,omitempty"`
}

// encodeShare is a link's code: the payload, a dot, and its signature.
func encodeShare(s share, signer *ShareSigner) (string, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("solo: encode share: %w", err)
	}
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.BestCompression)
	if err != nil {
		return "", fmt.Errorf("solo: deflate share: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return "", fmt.Errorf("solo: deflate share: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("solo: deflate share: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(buf.Bytes())
	sig := base64.RawURLEncoding.EncodeToString(signer.Sign([]byte(payload)))
	return payload + shareSeparator + sig, nil
}

// shareKey names a shared draft by what it is: its settings, seed and
// picks, canonically encoded and hashed.
func shareKey(s share) (string, error) {
	s.Settings = leagues.Normalize(s.Settings)
	raw, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("solo: share key: %w", err)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// decodeShare is a link's draft, refusing a code with no signature, a
// signature no key held makes, or a payload changed after signing.
func decodeShare(code string, signer *ShareSigner) (share, error) {
	payload, sig64, found := strings.Cut(code, shareSeparator)
	if !found {
		return share{}, errBadCode
	}
	sig, err := base64.RawURLEncoding.DecodeString(sig64)
	if err != nil || !signer.Verify([]byte(payload), sig) {
		return share{}, errBadCode
	}
	packed, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return share{}, errBadCode
	}
	raw, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(packed)), maxShareBytes+1))
	if err != nil || len(raw) > maxShareBytes {
		return share{}, errBadCode
	}
	var s share
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil || s.V != shareVersion || s.Seed < 0 || s.Seed > maxSeed {
		return share{}, errBadCode
	}
	return s, nil
}
