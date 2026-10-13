package solo

import (
	"errors"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/names"
)

func testShare() share {
	preset := apitypes.ScoringPresetPpr
	return share{
		V: shareVersion, Seed: 2026, Picks: []string{"a", "b", "c"},
		Settings: apitypes.LeagueSettings{
			BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: apitypes.LineupStandard,
			Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
			Scoring: apitypes.Scoring{Preset: &preset}, Teams: 12,
		},
	}
}

func testService(t *testing.T) *Service {
	t.Helper()
	filter, err := names.Default()
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Names: filter}
}

// A link carries which picks were made for the drafter and his handle,
// and a link written before either still opens.
func TestShareCarriesForYouAndSharer(t *testing.T) {
	s := testService(t)
	in := testShare()
	in.ForYou, in.Sharer = []int{1, 2}, "jpk88"
	code, err := encodeShare(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.decode(code)
	if err != nil {
		t.Fatal(err)
	}
	if out.Sharer != "jpk88" || len(out.ForYou) != 2 || out.ForYou[1] != 2 {
		t.Fatalf("decoded %+v", out)
	}

	plain, err := encodeShare(testShare())
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.decode(plain)
	if err != nil || old.Sharer != "" || old.ForYou != nil {
		t.Fatalf("an earlier link decoded to %+v, %v", old, err)
	}
}

// Anyone can write a link, so a sharer's name the account layer would
// refuse makes the link one that holds no draft.
func TestShareRefusesANameStrangersShouldNotSee(t *testing.T) {
	s := testService(t)
	for _, name := range []string{"a b", "<script>", "x"} {
		in := testShare()
		in.Sharer = name
		code, err := encodeShare(in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.decode(code); !errors.Is(err, errBadCode) {
			t.Errorf("sharer %q: got %v, want errBadCode", name, err)
		}
	}
}
