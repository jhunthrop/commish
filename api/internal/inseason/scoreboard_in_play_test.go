package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// Week 6 in three slots: the first pair of clubs on Thursday night, the
// next three pairs Sunday at 1:00, the rest Sunday at 4:25 Eastern.
var (
	inPlayThursday = time.Date(2026, 10, 15, 20, 15, 0, 0, east)
	inPlayEarly    = time.Date(2026, 10, 18, 13, 0, 0, 0, east)
	inPlayLate     = time.Date(2026, 10, 18, 16, 25, 0, 0, east)
)

// slottedWeek is the fixture's week 6 in those slots, each game final when
// final says so of its kickoff.
func slottedWeek(data Data, final func(kickoff time.Time) bool) (Data, map[string]time.Time) {
	clubs := fixtureTeams()
	playing := clubs[:len(clubs)-2]
	kickoffs := map[string]time.Time{}
	var games []boards.TeamWeek
	for _, g := range data.Games {
		if g.Week != 6 {
			games = append(games, g)
		}
	}
	for i := 0; i+1 < len(playing); i += 2 {
		kickoff := inPlayLate
		switch {
		case i == 0:
			kickoff = inPlayThursday
		case i <= 6:
			kickoff = inPlayEarly
		}
		kickoffs[playing[i]], kickoffs[playing[i+1]] = kickoff, kickoff
		games = append(games, game(6, playing[i], playing[i+1], kickoff, final(kickoff))...)
	}
	data.Games = games
	return data, kickoffs
}

// A side's in_play is its starters whose own game is under way at the
// read's clock (Lane 102, B38): none between Thursday's final and Sunday's
// first kickoff though the game reads playing, the Sunday early slot's
// starters mid-slate, none once every game is final.
func TestScoreboardInPlayCountsOnlyGamesUnderWay(t *testing.T) {
	for _, tc := range []struct {
		name  string
		now   time.Time
		final func(time.Time) bool
		state string
		slot  *time.Time
	}{
		{"Friday, Thursday's game final, Sunday's to come", time.Date(2026, 10, 16, 10, 0, 0, 0, east),
			func(k time.Time) bool { return k.Equal(inPlayThursday) }, "playing", nil},
		{"Sunday 2:30, the early slot under way", time.Date(2026, 10, 18, 14, 30, 0, 0, east),
			func(k time.Time) bool { return k.Equal(inPlayThursday) }, "playing", &inPlayEarly},
		{"Monday, every game final", time.Date(2026, 10, 19, 10, 0, 0, 0, east),
			func(time.Time) bool { return true }, "final", nil},
	} {
		f := pairedFixture(t)
		data, kickoffs := slottedWeek(f.data, tc.final)
		s := fixtureService(t, f.league, data, &fakeHolds{})
		s.Facts = fakeFacts{data: data, projection: weekProjection(f)}
		now := tc.now
		s.Now = func() time.Time { return now }
		mine := scoreboardOf(t, s).Games[0]
		if string(mine.State) != tc.state {
			t.Fatalf("%s: state %s, want %s", tc.name, mine.State, tc.state)
		}
		for i, side := range mine.Sides {
			want := 0
			if tc.slot != nil {
				team, _ := f.league.Snap.TeamByRoster(side.RosterId)
				for _, id := range team.Starters {
					if k, ok := kickoffs[f.league.Player(id).Team]; ok && k.Equal(*tc.slot) {
						want++
					}
				}
				if want == 0 {
					t.Fatalf("%s: side %d starts nobody in the slot, the case proves nothing", tc.name, i)
				}
			}
			if side.InPlay == nil || *side.InPlay != want {
				t.Errorf("%s: side %d in_play %v, want %d", tc.name, side.RosterId, side.InPlay, want)
			}
		}
	}
}
