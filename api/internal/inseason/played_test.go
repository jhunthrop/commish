package inseason

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// thursdayReads is week 6 with Thursday's game (SEA at DEN) in the store's
// lines but its result not yet posted, and Sunday's game (BUF at MIA)
// still to play: the sweep's X3, as the store stood on 2026-10-18.
type thursdayReads struct{ countingReads }

var (
	thursdayKickoff = time.Date(2026, 10, 16, 0, 15, 0, 0, time.UTC)
	sundayKickoff   = time.Date(2026, 10, 18, 17, 0, 0, 0, time.UTC)
)

func (*thursdayReads) StatLines(context.Context, int) ([]boards.StatLine, error) {
	return []boards.StatLine{
		{PlayerID: "jsn", Position: "WR", Week: 5, Team: "SEA", Metrics: map[string]float64{"receptions": 8, "receiving_yards": 148}},
		{PlayerID: "jsn", Position: "WR", Week: 6, Team: "SEA", Metrics: map[string]float64{"receptions": 12, "receiving_yards": 134}},
	}, nil
}

func (*thursdayReads) Schedule(context.Context, int) ([]boards.TeamWeek, error) {
	return []boards.TeamWeek{
		{Week: 5, Team: "SEA", Opponent: "ARI", Home: true, Kickoff: thursdayKickoff.AddDate(0, 0, -4), Final: true},
		{Week: 5, Team: "ARI", Opponent: "SEA", Kickoff: thursdayKickoff.AddDate(0, 0, -4), Final: true},
		{Week: 6, Team: "SEA", Opponent: "DEN", Kickoff: thursdayKickoff},
		{Week: 6, Team: "DEN", Opponent: "SEA", Home: true, Kickoff: thursdayKickoff},
		{Week: 6, Team: "BUF", Opponent: "MIA", Kickoff: sundayKickoff},
		{Week: 6, Team: "MIA", Opponent: "BUF", Home: true, Kickoff: sundayKickoff},
	}, nil
}

// A played game is played on every screen (the ruling on the sweep's X3): a
// club's game is final once the store holds its result or a line from it,
// so the order and the player card count Thursday's game the moment its
// lines land, as the run's game log does, and never read the schedule
// alone. Its opponent's side is final too; Sunday's game is still ahead.
func TestAGameWithLinesIsPlayedBeforeItsResultIsPosted(t *testing.T) {
	now := sundayKickoff.Add(-time.Hour)
	c := &Cache{Reads: &thursdayReads{}, Now: func() time.Time { return now }}
	d, err := c.Data(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	final := map[string]bool{}
	for _, g := range d.Games {
		if g.Week == 6 {
			final[g.Team] = g.Final
		}
	}
	if !final["SEA"] || !final["DEN"] || final["BUF"] || final["MIA"] {
		t.Fatalf("week 6 finals %v: Thursday's both sides, not Sunday's", final)
	}
	if w := nextWeek(d.Games); w != 6 {
		t.Fatalf("next week %d with Sunday's game ahead", w)
	}
	f := NewSeason(d, RulesOf(scoring.PresetRules(pprPreset)), 6, now).For(Player{BoardID: "jsn", Team: "SEA", Position: draft.WR})
	if !f.Played || len(f.LastGames) != 2 || f.LastGames[0].Week != 6 {
		t.Fatalf("Thursday's game: %s", f)
	}
}

// The rule makes a new schedule and leaves the read's own untouched.
func TestPlayedFromLinesLeavesTheReadAsItWas(t *testing.T) {
	reads := &thursdayReads{}
	games, _ := reads.Schedule(context.Background(), 2026)
	lines, _ := reads.StatLines(context.Background(), 2026)
	out := playedFromLines(games, lines)
	if games[2].Final || !out[2].Final {
		t.Fatalf("read %v, ruled %v", games[2], out[2])
	}
}
