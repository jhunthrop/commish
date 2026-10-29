package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Lane 291: the Waivers screen's position panel, read off the trade
// finder's team profile (Lane 287) counted by position.

// pointed is a roster whose players carry rest-of-season points: each
// one's points over replacement plus 100.
func pointed(roster []Candidate) []Candidate {
	out := append([]Candidate(nil), roster...)
	for i := range out {
		if out[i].HasValue {
			out[i].Points, out[i].HasPoints = out[i].Value+100, true
		}
	}
	return out
}

// syntheticPanel is the synthetic 12 teams with points, team 0 given first.
func syntheticPanel(config []draft.SlotConfig, first []Candidate) TradeLeague {
	squads := []Squad{{Players: pointed(first)}}
	for i := 1; i < 12; i++ {
		squads = append(squads, Squad{Players: pointed(leagueTeam(i, 20))})
	}
	return NewTradeLeague(config, SpanOf(SeasonGames, SeasonGames), squads)
}

func panelFigures(l TradeLeague, p draft.Position) []float64 {
	out := make([]float64, len(l.Positions))
	for i, by := range l.Positions {
		out[i] = by[p]
	}
	return out
}

func TestPanelWeakAtTERanksLast(t *testing.T) {
	weak := set(leagueTeam(0, 20), "t0-te1", func(c Candidate) Candidate { c.Value = -60; return c })
	l := syntheticPanel(standardConfig, weak)
	got := StandingOf(panelFigures(l, draft.TE), 0)
	if got.Rank != 12 {
		t.Fatalf("TE rank %d of 12, want 12: %+v", got.Rank, got)
	}
	if got.Points >= got.Median {
		t.Fatalf("TE %v not under the median %v", got.Points, got.Median)
	}
	// Team 0 is the strongest elsewhere (each later team a little weaker).
	if rb := StandingOf(panelFigures(l, draft.RB), 0); rb.Rank != 1 {
		t.Fatalf("RB rank %d, want 1", rb.Rank)
	}
	if !PositionNeed(draft.TE, &got, l.Weeks()) {
		t.Fatalf("no TE need at %+v", got)
	}
	if rb := StandingOf(panelFigures(l, draft.RB), 0); PositionNeed(draft.RB, &rb, l.Weeks()) {
		t.Fatalf("a need marked where team 0 leads: %+v", rb)
	}
}

func TestPanelFoldsTheFlexIntoItsPlayersPosition(t *testing.T) {
	// A third receiver worth more than every back on the bench takes the flex.
	deep := set(leagueTeam(0, 20), "t0-wr3", func(c Candidate) Candidate { c.Value = 70; return c })
	l := syntheticPanel(standardConfig, deep)
	by := l.Positions[0]
	// Every club plays every week (no schedule read), so each starter's
	// figure is his rest-of-season points whole.
	if want := (95.0 + 100) + (55 + 100) + (70 + 100); roundTenth(by[draft.WR]) != want {
		t.Fatalf("WR %v, want the three receivers' %v", by[draft.WR], want)
	}
	if want := (90.0 + 100) + (50 + 100); roundTenth(by[draft.RB]) != want {
		t.Fatalf("RB %v, want the two backs' %v", by[draft.RB], want)
	}
	starting := l.Starting(pointed(deep))
	for i, c := range deep {
		if c.ID == "t0-wr3" && !starting[i] {
			t.Fatal("the flex receiver is not a starter")
		}
		if c.ID == "t0-rb3" && starting[i] {
			t.Fatal("the third back starts over the flex receiver")
		}
	}
	// Superflex: a second quarterback worth starting counts at QB.
	sf := syntheticPanel(superflexConfig, set(leagueTeam(0, 45), "t0-qb2", func(c Candidate) Candidate { c.Value = 45; return c }))
	if want := (60.0 + 100) + (45 + 100); roundTenth(sf.Positions[0][draft.QB]) != want {
		t.Fatalf("QB %v, want both quarterbacks' %v", sf.Positions[0][draft.QB], want)
	}
}

func TestPanelPositionsSkipWhatTheLeagueDoesNotStart(t *testing.T) {
	noK := withoutSlot(standardConfig, draft.SlotK)
	got := panelPositionsOf(Slots(noK))
	want := []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE, draft.DEF}
	if len(got) != len(want) {
		t.Fatalf("positions %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("positions %v, want %v", got, want)
		}
	}
	if all := panelPositionsOf(Slots(standardConfig)); len(all) != 6 {
		t.Fatalf("positions %v, want all six", all)
	}
}

func withoutSlot(config []draft.SlotConfig, slot draft.SlotType) []draft.SlotConfig {
	var out []draft.SlotConfig
	for _, c := range config {
		if c.Slot != slot {
			out = append(out, c)
		}
	}
	return out
}

func TestStandingOfSharesAPlaceAtTheTenth(t *testing.T) {
	got := StandingOf([]float64{100.04, 100.0, 120, 90}, 0)
	if got.Rank != 2 || got.Points != 100 || got.Median != 100 {
		t.Fatalf("%+v", got)
	}
	if second := StandingOf([]float64{100.04, 100.0, 120, 90}, 1); second.Rank != 2 {
		t.Fatalf("level teams at different places: %+v", second)
	}
}

// Review M2: the need mark and the rank are one measure, so a card never
// shows a strong rank with a Need, and a position well under the median
// marks one even when no single slot misses by the close call.
func TestPositionNeedIsTheRanksOwnMeasure(t *testing.T) {
	const weeks = 11
	cases := []struct {
		name string
		p    draft.Position
		s    *apitypes.WaiverStanding
		want bool
	}{
		{"rank 2, above the median: never a need", draft.WR, &apitypes.WaiverStanding{Rank: 2, Points: 1084.8, Median: 920.3}, false},
		{"at the median: no need", draft.RB, &apitypes.WaiverStanding{Rank: 6, Points: 400, Median: 400}, false},
		{"under by less than the close call over the weeks", draft.RB, &apitypes.WaiverStanding{Rank: 7, Points: 395, Median: 400}, false},
		{"three receivers each a little under: one need at the position", draft.WR, &apitypes.WaiverStanding{Rank: 10, Points: 880, Median: 900}, true},
		{"exactly the close call over the weeks", draft.TE, &apitypes.WaiverStanding{Rank: 9, Points: 94.5, Median: 100}, true},
		{"never at K", draft.K, &apitypes.WaiverStanding{Rank: 12, Points: 0, Median: 90}, false},
		{"never without a figure", draft.QB, nil, false},
	}
	for _, c := range cases {
		if got := PositionNeed(c.p, c.s, weeks); got != c.want {
			t.Errorf("%s: need %v, want %v", c.name, got, c.want)
		}
		if c.want && c.s.Points >= c.s.Median {
			t.Errorf("%s: a need at or above the median", c.name)
		}
	}
}

func TestWaiverPanelOnTheFullPage(t *testing.T) {
	f := newFixture(t)
	f.league.Board.Order, f.league.Board.FromWeek = boards.OrderRestOfSeason, 7
	a := newFixtureAdvisor(t, f, map[string]bool{})
	out, ok := a.Waivers("", "")
	if !ok || out.Positions == nil {
		t.Fatalf("no panel: %v", ok)
	}
	rows := map[string]apitypes.WaiverRow{}
	for _, r := range out.Rows {
		rows[rowKey(r.Add)] = r
	}
	seen := map[string]bool{}
	for _, card := range *out.Positions {
		seen[string(card.Position)] = true
		if card.Teams != 12 {
			t.Fatalf("%s out of %d", card.Position, card.Teams)
		}
		if len(card.Available) > PanelFree {
			t.Fatalf("%s lists %d free agents", card.Position, len(card.Available))
		}
		for i, free := range card.Available {
			if free.Row.Add.Player.Position != string(card.Position) {
				t.Fatalf("a %s on the %s card", free.Row.Add.Player.Position, card.Position)
			}
			if _, rostered := f.league.HeldBy[boardID(free.Row.Add)]; rostered {
				t.Fatalf("%s card lists a rostered player", card.Position)
			}
			if i > 0 && fv(free.RestOfSeasonPoints) > fv(card.Available[i-1].RestOfSeasonPoints) {
				t.Fatalf("%s free agents not by rest-of-season points", card.Position)
			}
			// One rule: the row is the table's own wherever the table lists him.
			if table, ok := rows[rowKey(free.Row.Add)]; ok && (table.Gain != free.Row.Gain || table.Sentence != free.Row.Sentence) {
				t.Fatalf("%s card's row for %s differs from the table's", card.Position, free.Row.Add.Player.Name)
			}
		}
		for i, m := range card.Mine {
			if m.Line.Player.Position != string(card.Position) {
				t.Fatalf("a %s among my %s", m.Line.Player.Position, card.Position)
			}
			if i > 0 && fv(m.RestOfSeasonPoints) > fv(card.Mine[i-1].RestOfSeasonPoints) {
				t.Fatalf("my %s not by rest-of-season points", card.Position)
			}
		}
		skilled := card.Position != apitypes.WaiverPositionCardPositionK && card.Position != apitypes.WaiverPositionCardPositionDEF
		if skilled && (card.RestOfSeason == nil || card.RestOfSeason.Rank < 1 || card.RestOfSeason.Rank > 12) {
			t.Fatalf("%s standing %+v", card.Position, card.RestOfSeason)
		}
		// The fixture board carries no points for kickers and defenses: no figure to rank by.
		if !skilled && card.RestOfSeason != nil {
			t.Fatalf("%s ranked with no points: %+v", card.Position, card.RestOfSeason)
		}
		if !skilled && card.Need {
			t.Fatalf("a need at %s", card.Position)
		}
		// No projection read: no week figure.
		if card.Week != nil {
			t.Fatalf("%s week %+v with no projection", card.Position, card.Week)
		}
	}
	for _, p := range []string{"QB", "RB", "WR", "TE"} {
		if !seen[p] {
			t.Fatalf("no %s card", p)
		}
	}
	narrowed, _ := newFixtureAdvisor(t, f, map[string]bool{}).Waivers(draft.RB, "")
	if narrowed.Positions != nil {
		t.Fatal("a narrowed page carries the panel")
	}
	f.league.Board.Order = boards.OrderPreseason
	if pre, _ := newFixtureAdvisor(t, f, map[string]bool{}).Waivers("", ""); pre.Positions != nil {
		t.Fatal("the preseason number carries the panel")
	}
}

func TestWeekByPositionCountsTheLineupsProj(t *testing.T) {
	roster := []Candidate{
		{ID: "qb", Position: draft.QB, Rank: 1, Proj: 20, HasProj: true},
		{ID: "rb1", Position: draft.RB, Rank: 1, Proj: 15, HasProj: true},
		{ID: "rb2", Position: draft.RB, Rank: 2, Proj: 12, HasProj: true},
		{ID: "rb3", Position: draft.RB, Rank: 3, Proj: 11, HasProj: true},
		{ID: "wr1", Position: draft.WR, Rank: 1, Proj: 14, HasProj: true},
		{ID: "wr2", Position: draft.WR, Rank: 2, Proj: 9, HasProj: true},
		{ID: "te", Position: draft.TE, Rank: 1, Proj: 8, HasProj: true},
		{ID: "k", Position: draft.K, Rank: 1, Proj: 7, HasProj: true},
		{ID: "def", Position: draft.DEF, Rank: 1, Proj: 6, HasProj: true},
	}
	by, starts := WeekByPosition(standardConfig, roster, nil)
	// The flex takes the third back (11) over nobody else free.
	if by[draft.RB] != 38 || by[draft.WR] != 23 || by[draft.K] != 7 {
		t.Fatalf("%v", by)
	}
	for i, s := range starts {
		if !s {
			t.Fatalf("%s sits", roster[i].ID)
		}
	}
}
