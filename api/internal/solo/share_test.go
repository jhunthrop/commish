package solo

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

const (
	testSecret    = "share-test-secret-0123456789abcdef-current"
	testOldSecret = "share-test-secret-0123456789abcdef-previous"
)

func testShare() share {
	preset := apitypes.ScoringPresetPpr
	return share{
		V: shareVersion, Seed: 2026, Picks: []string{"a", "b", "c"}, ForYou: []int{1, 2}, Sharer: "jpk88",
		Settings: apitypes.LeagueSettings{
			BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: apitypes.LineupStandard,
			Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
			Scoring: apitypes.Scoring{Preset: &preset}, Teams: 12,
		},
	}
}

func signer(t *testing.T, secrets ...string) *ShareSigner {
	t.Helper()
	s, err := NewShareSigner(secrets)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// pack is a payload as encodeShare writes it, for tests that forge one.
func pack(t *testing.T, s share) string {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	w, _ := flate.NewWriter(&buf, flate.BestCompression)
	_, _ = w.Write(raw)
	_ = w.Close()
	return base64.RawURLEncoding.EncodeToString(buf.Bytes())
}

// A signed link round-trips its picks, marks and handle.
func TestShareRoundTrip(t *testing.T) {
	keys := signer(t, testSecret)
	code, err := encodeShare(testShare(), keys)
	if err != nil {
		t.Fatal(err)
	}
	out, err := decodeShare(code, keys)
	if err != nil {
		t.Fatal(err)
	}
	if out.Sharer != "jpk88" || len(out.ForYou) != 2 || out.ForYou[1] != 2 || len(out.Picks) != 3 {
		t.Fatalf("decoded %+v", out)
	}
}

// Nobody can put a handle, or anything else, on a link this server did not
// sign: an unsigned code, a re-signed forgery, a changed payload and a
// stolen signature on another payload are all refused.
func TestShareRefusesUnsignedAndAltered(t *testing.T) {
	keys := signer(t, testSecret)
	code, err := encodeShare(testShare(), keys)
	if err != nil {
		t.Fatal(err)
	}
	payload, sig, _ := strings.Cut(code, shareSeparator)
	forged := testShare()
	forged.Sharer = "famous_drafter"
	forgedPayload := pack(t, forged)
	otherKeys := signer(t, "someone-else-secret-0123456789abcdef-xx")
	otherCode, err := encodeShare(forged, otherKeys)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"unsigned":                  payload,
		"unsigned forgery":          forgedPayload,
		"signature on another body": forgedPayload + shareSeparator + sig,
		"signed by another key":     otherCode,
		"truncated signature":       payload + shareSeparator + sig[:len(sig)/2],
		"empty signature":           payload + shareSeparator,
		"not base64":                payload + shareSeparator + "!!!",
	}
	for name, c := range cases {
		if _, err := decodeShare(c, keys); !errors.Is(err, errBadCode) {
			t.Errorf("%s: got %v, want errBadCode", name, err)
		}
	}
}

// A key rotates without breaking links: the new key signs, the old one
// still verifies, and a link signed under the new key is refused by a
// server that only holds the old one.
func TestShareKeyRotation(t *testing.T) {
	old := signer(t, testOldSecret)
	rotated := signer(t, testSecret, testOldSecret)
	oldCode, err := encodeShare(testShare(), old)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeShare(oldCode, rotated); err != nil {
		t.Fatalf("a link signed before the rotation stopped opening: %v", err)
	}
	newCode, err := encodeShare(testShare(), rotated)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeShare(newCode, old); !errors.Is(err, errBadCode) {
		t.Fatal("the rotated key did not sign the new link")
	}
}

func TestNewShareSignerNeedsAKey(t *testing.T) {
	if _, err := NewShareSigner(nil); err == nil {
		t.Fatal("a signer with no key was made")
	}
}
