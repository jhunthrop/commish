package leaguesync

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// readRecordedSleeper is the recorded Sleeper league as a read finds it.
func readRecordedSleeper(t *testing.T) Snapshot {
	t.Helper()
	now := func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }
	h, ref, err := replayHosts(now).Resolve("", "sleeper.com/leagues/"+ReplaySleeperLeague)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := h.Read(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	return snap
}

// The recorded Sleeper league's standings come out as Sleeper states
// them (Lane 66i): points against, the streak written "W5", FAAB left of
// the $1,000 budget, the waiver order and the member's avatar; a claim
// keeps its bid; the league's terms are FAAB, six playoff teams in weeks
// 15 to 17.
func TestRecordedSleeperStandingsAndTerms(t *testing.T) {
	snap := readRecordedSleeper(t)
	muttdogs, ok := snap.TeamByRoster(10)
	if !ok {
		t.Fatal("no roster 10")
	}
	if muttdogs.PointsAgainst == nil || *muttdogs.PointsAgainst != 659.06 || muttdogs.Streak != "W5" || muttdogs.WaiverOrder != 6 {
		t.Errorf("roster 10: against %v, streak %q, order %d", muttdogs.PointsAgainst, muttdogs.Streak, muttdogs.WaiverOrder)
	}
	if muttdogs.BudgetLeft == nil || *muttdogs.BudgetLeft != 675 {
		t.Errorf("roster 10 budget left %v, want 675", muttdogs.BudgetLeft)
	}
	if muttdogs.Avatar != "https://sleepercdn.com/avatars/thumbs/2aea7c4ff143abb0f01f2ddbec933afc" {
		t.Errorf("roster 10 avatar %q", muttdogs.Avatar)
	}
	bids := 0
	for _, m := range snap.Moves {
		if m.Bid != nil {
			bids++
			if m.Kind != MoveWaiver {
				t.Errorf("a %s move carries a bid", m.Kind)
			}
		}
	}
	if bids == 0 {
		t.Error("no claim kept its bid")
	}
	want := Terms{Waivers: WaiversBudget, Budget: 1000, PlayoffTeams: 6, PlayoffFirst: 15, PlayoffLast: 17, FinalWeeks: 1,
		DivisionsRead: true, StartWeek: 1}
	if !reflect.DeepEqual(snap.Terms, want) {
		t.Errorf("terms %+v, want %+v", snap.Terms, want)
	}
	got := terms(snap)
	if got.Scoring == nil || got.Scoring.PointsPerReception != 1 || got.Scoring.PointsPerFieldGoal4049 != 4 {
		t.Errorf("scoring %+v", got.Scoring)
	}
	if got.Roster.Flex != 2 || got.Roster.Wr != 3 || got.Roster.Bench != 10 || got.Roster.K != 0 {
		t.Errorf("roster %+v", got.Roster)
	}
	if len(got.ScoringExtra) == 0 || got.HostSettingsUrl == nil || *got.HostSettingsUrl != "https://sleeper.com/leagues/"+ReplaySleeperLeague {
		t.Errorf("extra %d, settings url %v", len(got.ScoringExtra), got.HostSettingsUrl)
	}
	if got.PlayoffWeeks == nil || got.PlayoffWeeks.First != 15 || got.PlayoffWeeks.Last != 17 || got.Waivers == nil ||
		*got.Waivers != apitypes.LeagueTermsWaiversBudget || got.WaiverBudget == nil || *got.WaiverBudget != 1000 {
		t.Errorf("terms view %+v", got)
	}
}

// The playoffs' weeks follow the bracket and the round type: six teams
// play three rounds, a two-week final adds one week, two weeks a round
// doubles them; a host that says nothing leaves them null.
func TestPlayoffWeeks(t *testing.T) {
	cases := []struct {
		teams, roundType, want int
	}{
		{2, 0, 1}, {4, 0, 2}, {6, 0, 3}, {8, 0, 3}, {10, 0, 4}, {6, 1, 4}, {6, 2, 6},
	}
	for _, c := range cases {
		if got := sleeperPlayoffWeeks(playoffRounds(c.teams), c.roundType); got != c.want {
			t.Errorf("%d teams, round type %d: %d weeks, want %d", c.teams, c.roundType, got, c.want)
		}
	}
	if got := terms(Snapshot{}); got.PlayoffWeeks != nil || got.Waivers != nil || got.PlayoffTeams != nil || got.HostSettingsUrl != nil {
		t.Errorf("an unstated league's terms %+v", got)
	}
	unset := sleeperTerms(sleeper.League{WaiverType: -1})
	if unset.Waivers != "" || unset.PlayoffLast != 0 || unset.FinalWeeks != 0 {
		t.Errorf("an unset Sleeper league's terms %+v", unset)
	}
	// The championship's own length (Lane 96, B25): two weeks under a
	// two-week final or two weeks a round.
	for roundType, want := range map[int]int{0: 1, 1: 2, 2: 2} {
		got := sleeperTerms(sleeper.League{PlayoffTeams: 6, PlayoffWeekStart: 15, PlayoffRoundType: roundType})
		if got.FinalWeeks != want {
			t.Errorf("round type %d: a %d-week final, want %d", roundType, got.FinalWeeks, want)
		}
	}
}

// ESPN's record carries points against, the streak and the waiver rank;
// a budget league's team has its budget less what it spent, and the
// playoffs run from their start to the season's final period.
func TestESPNStandingsAndTerms(t *testing.T) {
	spent := 120
	l := espn.FullLeague{
		ID: "48153503", Season: 2026, ScoringPeriod: 6, PlayoffTeams: 4, PlayoffStartWeek: 15, FinalScoringPeriod: 17,
		Acquisition: espn.Acquisition{Budget: true, Total: 500},
		Teams: []espn.Team{{ID: 3, Name: "My Ball Zach Ertz", Wins: 2, Losses: 3, PointsFor: 498.6, PointsAgainst: 541.24,
			Streak: "L2", WaiverRank: 3, BudgetSpent: &spent}},
	}
	snap := espnSnapshot(l, time.Now())
	team := snap.Teams[0]
	if team.PointsAgainst == nil || *team.PointsAgainst != 541.24 || team.Streak != "L2" || team.WaiverOrder != 3 ||
		team.BudgetLeft == nil || *team.BudgetLeft != 380 || team.Avatar != "" {
		t.Errorf("team %+v", team)
	}
	want := Terms{Waivers: WaiversBudget, Budget: 500, PlayoffTeams: 4, PlayoffFirst: 15, PlayoffLast: 17}
	if !reflect.DeepEqual(snap.Terms, want) {
		t.Errorf("terms %+v, want %+v", snap.Terms, want)
	}
	if url := hostSettingsURL(snap.Ref); url != "https://fantasy.espn.com/football/league/settings?leagueId=48153503" {
		t.Errorf("settings url %q", url)
	}
	two := l
	two.PlayoffStartWeek, two.FinalScoringPeriod, two.FinalRoundWeeks = 15, 18, 2
	if got := espnSnapshot(two, time.Now()).Terms; got.PlayoffLast != 18 || got.FinalWeeks != 2 {
		t.Errorf("a two-week final through week 18: %+v", got)
	}
	l.Acquisition = espn.Acquisition{}
	if got := espnSnapshot(l, time.Now()); got.Teams[0].BudgetLeft != nil || got.Terms.Waivers != WaiversOrder ||
		got.Terms.WaiverOrder != "" || got.Terms.Tiebreak != "" {
		t.Errorf("an order league stating no order type nor tiebreak: budget %v, terms %+v", got.Teams[0].BudgetLeft, got.Terms)
	}
}

// ESPN's waiverOrderReset names how an order league's order moves and its
// playoffSeedingRule the standings' tie rule (Lane 104, B48 and B55); a
// budget league has no order type, and a rule we do not know states none.
func TestESPNWaiverOrderAndTiebreak(t *testing.T) {
	reset, rolling := true, false
	cases := []struct {
		name        string
		acquisition espn.Acquisition
		rule        string
		order, tie  string
	}{
		{"rolling, points for", espn.Acquisition{OrderReset: &rolling}, "TOTAL_POINTS_SCORED", OrderRolling, TiebreakPointsFor},
		{"inverse standings, head to head", espn.Acquisition{OrderReset: &reset}, "H2H_RECORD", OrderInverseStandings, TiebreakHeadToHead},
		{"division record", espn.Acquisition{}, "INTRA_DIVISION_RECORD", "", TiebreakDivisionRecord},
		{"points against", espn.Acquisition{}, "TOTAL_POINTS_AGAINST", "", TiebreakPointsAgainst},
		{"a budget league, an unknown rule", espn.Acquisition{Budget: true, Total: 100, OrderReset: &rolling}, "RAW_STAT", "", ""},
	}
	for _, c := range cases {
		got := espnTerms(espn.FullLeague{Acquisition: c.acquisition, SeedingTiebreak: c.rule})
		if got.WaiverOrder != c.order || got.Tiebreak != c.tie {
			t.Errorf("%s: order %q, tiebreak %q; want %q, %q", c.name, got.WaiverOrder, got.Tiebreak, c.order, c.tie)
		}
		view := terms(Snapshot{Terms: got})
		if (view.WaiverOrder == nil) != (c.order == "") || (view.Tiebreak == nil) != (c.tie == "") {
			t.Errorf("%s: the contract's order %v, tiebreak %v", c.name, view.WaiverOrder, view.Tiebreak)
		}
	}
	if got := sleeperTerms(sleeper.League{WaiverType: sleeper.WaiverRolling}); got.WaiverOrder != OrderRolling {
		t.Errorf("Sleeper rolling waivers: %+v", got)
	}
	if got := sleeperTerms(sleeper.League{WaiverType: sleeper.WaiverReverse}); got.WaiverOrder != OrderInverseStandings {
		t.Errorf("Sleeper reverse standings waivers: %+v", got)
	}
}
