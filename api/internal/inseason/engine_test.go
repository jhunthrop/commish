package inseason

import (
	"fmt"
	"sort"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// twelveTeamPPR is the first fixture league: 12 teams, PPR, QB, 2 RB,
// 3 WR, TE, one flex, K, DEF, six on the bench, no superflex.
func twelveTeamPPR(t *testing.T) []draft.SlotConfig {
	t.Helper()
	return slotsOf(t, apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard,
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1, Bench: 6}})
}

// tenTeamHalfSuperflex is the second: 10 teams, half PPR, QB, 2 RB,
// 2 WR, TE, a flex and a superflex, K, DEF, six on the bench.
func tenTeamHalfSuperflex(t *testing.T) []draft.SlotConfig {
	t.Helper()
	return slotsOf(t, apitypes.LeagueSettings{Teams: 10, Lineup: apitypes.LineupSuperflex,
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6}})
}

func slotsOf(t *testing.T, s apitypes.LeagueSettings) []draft.SlotConfig {
	t.Helper()
	config, err := mock.SlotConfig(s)
	if err != nil {
		t.Fatal(err)
	}
	return config
}

// player is a fixture candidate: position, rank and season points over
// replacement (a week's is a seventeenth).
func player(id string, p draft.Position, rank int, value float64) Candidate {
	return Candidate{ID: id, Position: p, Rank: rank, Value: value, HasValue: true}
}

func withTier(c Candidate, tier Tier) Candidate { c.Tier = tier; return c }

func locked(c Candidate) Candidate { c.Locked = true; return c }

// pprRoster is a 15-man roster for the PPR league, starters first.
func pprRoster() []Candidate {
	return []Candidate{
		player("qb1", draft.QB, 4, 80), player("rb1", draft.RB, 6, 120), player("rb2", draft.RB, 20, 50),
		player("wr1", draft.WR, 3, 140), player("wr2", draft.WR, 15, 70), player("wr3", draft.WR, 30, 30),
		player("te1", draft.TE, 8, 20), player("rb3", draft.RB, 28, 25), player("k1", draft.K, 5, 0),
		player("def1", draft.DEF, 7, 0), player("qb2", draft.QB, 20, 5), player("rb4", draft.RB, 40, 5),
		player("wr4", draft.WR, 35, 20), player("te2", draft.TE, 20, 2), player("wr5", draft.WR, 60, 1),
	}
}

func pprHost() []string {
	return []string{"qb1", "rb1", "rb2", "wr1", "wr2", "wr3", "te1", "rb3", "k1", "def1"}
}

// lineupWords is the lineup as "SLOT:ours<host*" lines, * marking a change.
func lineupWords(rows []Row, roster []Candidate) []string {
	name := func(p int) string {
		if p < 0 {
			return "-"
		}
		return roster[p].ID
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		mark := ""
		if r.Changed {
			mark = "*"
		}
		out = append(out, fmt.Sprintf("%s%d:%s<%s%s", r.Slot.Type, r.Slot.Index, name(r.Ours), name(r.Host), mark))
	}
	return out
}

func changes(rows []Row, roster []Candidate) []string {
	var out []string
	for _, r := range rows {
		if r.Changed {
			host := "-"
			if r.Host >= 0 {
				host = roster[r.Host].ID
			}
			out = append(out, roster[r.Ours].ID+" over "+host)
		}
	}
	sort.Strings(out)
	return out
}

func set(roster []Candidate, id string, f func(Candidate) Candidate) []Candidate {
	out := append([]Candidate(nil), roster...)
	for i := range out {
		if out[i].ID == id {
			out[i] = f(out[i])
		}
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestLineupKeys(t *testing.T) {
	cases := []struct {
		name   string
		config func(*testing.T) []draft.SlotConfig
		roster []Candidate
		host   []string
		want   []string
	}{
		{"the host's lineup is the order's: set", twelveTeamPPR, pprRoster(), pprHost(), nil},
		{"a back on bye sits: the flex back moves up and the next receiver takes the flex", twelveTeamPPR,
			set(pprRoster(), "rb1", func(c Candidate) Candidate { return withTier(c, Out) }), pprHost(),
			[]string{"wr4 over rb1"}},
		{"an out receiver sits for the best receiver left", twelveTeamPPR,
			set(pprRoster(), "wr2", func(c Candidate) Candidate { return withTier(c, Out) }), pprHost(),
			[]string{"wr4 over wr2"}},
		{"doubtful sits when an eligible player is available", twelveTeamPPR,
			set(pprRoster(), "te1", func(c Candidate) Candidate { return withTier(c, Doubtful) }), pprHost(),
			[]string{"te2 over te1"}},
		{"doubtful starts when nobody eligible is better", twelveTeamPPR,
			set(set(pprRoster(), "te1", func(c Candidate) Candidate { return withTier(c, Doubtful) }),
				"te2", func(c Candidate) Candidate { return withTier(c, Out) }), pprHost(), nil},
		{"a better bench player starts in the flex", twelveTeamPPR,
			pprRoster(), []string{"qb1", "rb1", "rb2", "wr1", "wr2", "wr3", "te1", "wr5", "k1", "def1"},
			[]string{"rb3 over wr5"}},
		{"a host starter whose game has kicked off stays", twelveTeamPPR,
			set(pprRoster(), "wr5", locked), []string{"qb1", "rb1", "rb2", "wr1", "wr2", "wr3", "te1", "wr5", "k1", "def1"}, nil},
		{"a benched player whose game has kicked off stays benched", twelveTeamPPR,
			set(set(pprRoster(), "wr3", func(c Candidate) Candidate { return withTier(c, Out) }), "wr4", locked), pprHost(),
			[]string{"wr5 over wr3"}},
		{"an empty host spot is filled", twelveTeamPPR, pprRoster(),
			[]string{"qb1", "rb1", "rb2", "wr1", "wr2", "wr3", "te1", "rb3", "k1"}, []string{"def1 over -"}},
		{"the superflex takes the quarterback with more points over replacement", tenTeamHalfSuperflex, pprRoster(),
			[]string{"qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "rb3", "k1", "def1"}, nil},
		{"a second quarterback ahead of a back starts in the superflex", tenTeamHalfSuperflex,
			set(pprRoster(), "qb2", func(c Candidate) Candidate { c.Value = 60; return c }),
			[]string{"qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "rb3", "k1", "def1"},
			[]string{"qb2 over rb3"}},
		{"an out quarterback in the superflex sits for a back", tenTeamHalfSuperflex,
			set(set(pprRoster(), "qb2", func(c Candidate) Candidate { c.Value = 60; return c }),
				"qb2", func(c Candidate) Candidate { return withTier(c, Out) }),
			[]string{"qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "qb2", "k1", "def1"},
			[]string{"rb3 over qb2"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rows := Lineup(c.config(t), c.roster, c.host)
			if got := changes(rows, c.roster); !equal(got, c.want) {
				t.Fatalf("changes %v, want %v\n%v", got, c.want, lineupWords(rows, c.roster))
			}
		})
	}
}

// A flex back the host lists in the flex keeps the flex row when a
// receiver comes in, so the change reads receiver for receiver.
func TestLineupKeepsTheHostsSpots(t *testing.T) {
	roster := set(pprRoster(), "wr2", func(c Candidate) Candidate { return withTier(c, Out) })
	rows := Lineup(twelveTeamPPR(t), roster, pprHost())
	got := lineupWords(rows, roster)
	want := []string{"QB0:qb1<qb1", "RB0:rb1<rb1", "RB1:rb2<rb2", "WR0:wr1<wr1", "WR1:wr4<wr2*", "WR2:wr3<wr3",
		"TE0:te1<te1", "FLEX0:rb3<rb3", "K0:k1<k1", "DEF0:def1<def1"}
	if !equal(got, want) {
		t.Fatalf("rows %v\nwant %v", got, want)
	}
	// A back on bye: the flex back takes his spot, the new receiver the flex.
	roster = set(pprRoster(), "rb1", func(c Candidate) Candidate { return withTier(c, Out) })
	rows = Lineup(twelveTeamPPR(t), roster, pprHost())
	got = lineupWords(rows, roster)
	want = []string{"QB0:qb1<qb1", "RB0:rb3<rb3", "RB1:rb2<rb2", "WR0:wr1<wr1", "WR1:wr2<wr2", "WR2:wr3<wr3",
		"TE0:te1<te1", "FLEX0:wr4<rb1*", "K0:k1<k1", "DEF0:def1<def1"}
	if !equal(got, want) {
		t.Fatalf("rows %v\nwant %v", got, want)
	}
}

// An out player starts only where the roster holds nobody else for the
// slot: the slot is never left empty while he is rostered.
func TestLineupOutOnlyWithNoAlternative(t *testing.T) {
	roster := set(pprRoster(), "k1", func(c Candidate) Candidate { return withTier(c, Out) })
	rows := Lineup(twelveTeamPPR(t), roster, pprHost())
	if c := changes(rows, roster); c != nil {
		t.Fatalf("changes %v, want the out kicker kept with no other kicker", c)
	}
}
