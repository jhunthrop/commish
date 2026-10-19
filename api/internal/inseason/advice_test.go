package inseason

import (
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

func boardID(l apitypes.PlayerLine) string {
	if l.Player.BoardId == nil {
		return ""
	}
	return *l.Player.BoardId
}

func TestLineupAdvice(t *testing.T) {
	f := newFixture(t)
	out, ok := newFixtureAdvisor(t, f, nil).Lineup()
	if !ok {
		t.Fatal("no team")
	}
	if len(out.Slots) != 10 || len(out.Bench) != 5 || out.Week != 6 || out.OrderBasis != apitypes.OrderBasisPreseason ||
		!out.Refreshed.Equal(f.raw.AsOf) || out.HostLineupUrl != "https://sleeper.com/leagues/1382163311038038016/team" {
		t.Fatalf("lineup %d slots %d bench week %d basis %s refreshed %v url %q", len(out.Slots), len(out.Bench), out.Week,
			out.OrderBasis, out.Refreshed, out.HostLineupUrl)
	}
	guard(t, out.Basis)
	if out.HostNote != nil {
		t.Fatalf("a Sleeper page carries a note: %q", *out.HostNote)
	}
	f.league.Snap.Ref = leaguesync.Ref{Host: leaguesync.HostMFL, LeagueID: "12345"}
	if mfl, _ := newFixtureAdvisor(t, f, nil).Lineup(); mfl.HostLineupUrl != "" || mfl.HostNote == nil {
		t.Fatalf("a league with no page: url %q note %v", mfl.HostLineupUrl, mfl.HostNote)
	}
	seen := map[string]bool{}
	for _, s := range out.Slots {
		if seen[boardID(s.Ours)] {
			t.Fatalf("%s starts twice", boardID(s.Ours))
		}
		seen[boardID(s.Ours)] = true
		if s.Changed != (s.Sentence != nil) {
			t.Fatalf("slot %s changed %v with sentence %v", s.Slot, s.Changed, s.Sentence)
		}
		if s.Sentence != nil {
			guard(t, *s.Sentence)
		}
	}
	for _, b := range out.Bench {
		if seen[boardID(b)] {
			t.Fatalf("%s starts and sits", boardID(b))
		}
	}
}

// A starter listed out is sat for the best bench player who can take
// his spot, and the sentence says why with the capture's stamp.
func TestLineupAdviceSitsAnOutStarter(t *testing.T) {
	f := newFixture(t)
	before, _ := newFixtureAdvisor(t, f, nil).Lineup()
	var target string
	for _, s := range before.Slots {
		if s.Slot == apitypes.LineupSlotSlotWR && !s.Ours.Facts.Bye {
			target = boardID(s.Ours)
			break
		}
	}
	f.data.Designations = map[string]boards.Designation{target: {Code: "O", AsOf: time.Date(2026, 10, 15, 20, 10, 0, 0, time.UTC)}}
	after, _ := newFixtureAdvisor(t, f, nil).Lineup()
	found := false
	for _, s := range after.Slots {
		if boardID(s.Ours) == target {
			t.Fatalf("%s is out and still starts", target)
		}
		if s.Changed && s.Host != nil && boardID(*s.Host) == target {
			found = true
			if s.Sentence == nil || !strings.Contains(*s.Sentence, "is listed out as of Thursday 4:10 pm") {
				t.Fatalf("sentence %v", s.Sentence)
			}
		}
	}
	if !found || after.Set {
		t.Fatalf("no change sits %s: %+v", target, after.Slots)
	}
}

func TestWaiverAdvice(t *testing.T) {
	f := newFixture(t)
	held := map[string]bool{}
	for _, id := range f.league.Snap.Teams[0].Players[10:] {
		held[*f.league.Player(id).BoardId] = true
	}
	out, ok := newFixtureAdvisor(t, f, held).Waivers("", "")
	if !ok || len(out.Rows) == 0 || len(out.Rows) > MaxWaiverRows {
		t.Fatalf("rows %d", len(out.Rows))
	}
	if out.HostWaiversUrl != "https://sleeper.com/leagues/1382163311038038016/players" {
		t.Fatalf("url %q", out.HostWaiversUrl)
	}
	above := true
	for i, r := range out.Rows {
		if _, rostered := f.league.HeldBy[boardID(r.Add)]; rostered {
			t.Fatalf("row %d adds a rostered player", i)
		}
		if r.Drop != nil && held[boardID(*r.Drop)] {
			t.Fatalf("row %d drops a held player", i)
		}
		if r.Gain > 0 && !above {
			t.Fatalf("row %d gains %v below the rule", i, r.Gain)
		}
		above = above && r.Gain > 0
		if !r.Starts && (strings.Contains(r.Sentence, "starts for you,") || strings.Contains(r.Sentence, "would start,")) {
			t.Fatalf("row %d does not start and says he does: %q", i, r.Sentence)
		}
		if i > 0 && r.Gain > 0 && r.Gain > out.Rows[i-1].Gain {
			t.Fatalf("row %d not by gain", i)
		}
		guard(t, r.Sentence)
	}
	// The strip's Proj is the lineup's with every card made (review 66f H1).
	if (out.LineupProj == nil) != (out.PickupsProj == nil) {
		t.Fatalf("lineup %v pickups %v", out.LineupProj, out.PickupsProj)
	}
	if out.LineupProj != nil {
		sum := *out.LineupProj
		for _, p := range out.Pickups {
			sum = roundTenth(sum + p.WeekGain)
		}
		if sum != *out.PickupsProj {
			t.Fatalf("the cards' gains reach %v, the set's Proj is %v", sum, *out.PickupsProj)
		}
	}
	rbs, _ := newFixtureAdvisor(t, f, held).Waivers(draft.RB, "")
	for _, r := range rbs.Rows {
		if r.Add.Player.Position != "RB" {
			t.Fatalf("a %s in the backs' rows", r.Add.Player.Position)
		}
	}
}

func TestTradeAdvice(t *testing.T) {
	f := newFixture(t)
	mine := f.league.Snap.Teams[0].Players
	held := map[string]bool{*f.league.Player(mine[1]).BoardId: true}
	a := newFixtureAdvisor(t, f, held)
	out, ok := a.Trades("")
	if !ok || len(out.Teams) != 11 {
		t.Fatalf("teams %d", len(out.Teams))
	}
	any := 0
	for _, team := range out.Teams {
		if team.RosterId == 1 || len(team.Trades) > TradesPerTeam {
			t.Fatalf("team %d with %d trades", team.RosterId, len(team.Trades))
		}
		for _, tr := range team.Trades {
			any++
			if tr.MyGain <= 0 || tr.TheirGain <= 0 || tr.CloseForThem != (tr.TheirGain < CloseCall) {
				t.Fatalf("gains %v %v close %v", tr.MyGain, tr.TheirGain, tr.CloseForThem)
			}
			// The fixture's rosters are full: two in for one out names the drop.
			if (len(tr.Get) > len(tr.Give)) != (tr.Drop != nil) {
				t.Fatalf("%d in, %d out, drop %v", len(tr.Get), len(tr.Give), tr.Drop)
			}
			if tr.Drop != nil && (tr.Drop.Held || boardID(*tr.Drop) == boardID(tr.Give[0])) {
				t.Fatalf("drop %s", boardID(*tr.Drop))
			}
			for _, g := range tr.Give {
				if g.Held || held[boardID(g)] {
					t.Fatal("a held player is given")
				}
				if p := draft.Position(g.Player.Position); p == draft.K || p == draft.DEF {
					t.Fatal("a kicker or defense is traded")
				}
			}
		}
	}
	if any == 0 {
		t.Fatal("no trade in a twelve-team league")
	}
	// The picker's own players: every active player on the roster, a
	// trade found or not, by position then name.
	if len(out.Roster) != len(mine) {
		t.Fatalf("roster %d of %d", len(out.Roster), len(mine))
	}
	order := map[string]int{"QB": 0, "RB": 1, "WR": 2, "TE": 3, "K": 4, "DEF": 5}
	for i := 1; i < len(out.Roster); i++ {
		a, b := out.Roster[i-1].Player, out.Roster[i].Player
		if order[a.Position] > order[b.Position] || (a.Position == b.Position && a.Name > b.Name) {
			t.Fatalf("roster order %s %s before %s %s", a.Position, a.Name, b.Position, b.Name)
		}
	}
	for _, team := range out.Teams {
		close := 0
		for _, tr := range team.Trades {
			if tr.CloseForThem {
				close++
			}
		}
		only := close > 0 && close == len(team.Trades)
		if (team.Note != nil) != only {
			t.Fatalf("team %d: %d of %d close, note %v", team.RosterId, close, len(team.Trades), team.Note)
		}
		if team.Note != nil && *team.Note != OnlyCloseCalls {
			t.Fatalf("note %q", *team.Note)
		}
		if len(team.Trades) > 0 && team.Trades[0].CloseForThem && !only {
			t.Fatalf("team %d leads with a close call", team.RosterId)
		}
	}
	focus := *f.league.Player(mine[3]).BoardId
	narrowed, _ := a.Trades(a.hostIDOf(focus))
	for _, team := range narrowed.Teams {
		for _, tr := range team.Trades {
			holds := false
			for _, l := range append(append([]apitypes.PlayerLine(nil), tr.Give...), tr.Get...) {
				holds = holds || boardID(l) == focus
			}
			if !holds {
				t.Fatalf("a trade without %s", focus)
			}
		}
	}
	if a.hostIDOf("nobody") != "" {
		t.Fatal("an unrostered board id found a host id")
	}
}

// BenchmarkTradesRoute is the trade route's work for a twelve-team
// league after the reads: the facts indexed, both sides built, the
// search against the other eleven, the wire rows.
func BenchmarkTradesRoute(b *testing.B) {
	f := newFixture(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, fixtureNow)
		if err != nil {
			b.Fatal(err)
		}
		if _, ok := a.Trades(""); !ok {
			b.Fatal("no team")
		}
	}
}

// BenchmarkWaiversRoute is the waiver route's: 60 unrostered and every
// drop for each.
func BenchmarkWaiversRoute(b *testing.B) {
	f := newFixture(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, nil, fixtureNow)
		if err != nil {
			b.Fatal(err)
		}
		if _, ok := a.Waivers("", ""); !ok {
			b.Fatal("no team")
		}
	}
}

// The pages take the order and its stamp from the board: preseason with
// the stored board's as_of today, the rest-of-season order when a source
// sets it.
func TestOrderComesFromTheBoard(t *testing.T) {
	f := newFixture(t)
	if f.league.Board.Order != boards.OrderPreseason || !f.league.Board.Refreshed.Equal(f.raw.AsOf) {
		t.Fatalf("board order %q refreshed %v", f.league.Board.Order, f.league.Board.Refreshed)
	}
	at := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	f.league.Board.Order, f.league.Board.Refreshed = boards.OrderRestOfSeason, at
	out, _ := newFixtureAdvisor(t, f, nil).Trades("")
	if out.OrderBasis != apitypes.OrderBasisRestOfSeason || !out.Refreshed.Equal(at) || !strings.Contains(out.Basis, " to 17.") {
		t.Fatalf("basis %q refreshed %v: %q", out.OrderBasis, out.Refreshed, out.Basis)
	}
}
