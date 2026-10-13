package solo

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// shareVersion is the code's format; a code of another version is refused.
const shareVersion = 1

// maxShareBytes bounds what a code may inflate to: settings with every
// keeper and 25 picks are a few kilobytes.
const maxShareBytes = 16 << 10

// errBadCode is a code that does not decode to a draft.
var errBadCode = errors.New("solo: that link does not hold a draft")

// share is what a link carries: the mock is a function of its settings,
// its seed and the drafter's picks, so these three replay it exactly.
type share struct {
	V        int                     `json:"v"`
	Settings apitypes.LeagueSettings `json:"s"`
	Seed     int64                   `json:"seed"`
	Picks    []string                `json:"p"`
}

func encodeShare(s share) (string, error) {
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
	return base64.RawURLEncoding.EncodeToString(buf.Bytes()), nil
}

func decodeShare(code string) (share, error) {
	packed, err := base64.RawURLEncoding.DecodeString(code)
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
