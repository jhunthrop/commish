package inseason

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/figurewords"
)

// The rule a line's game_state follows (Lane 176), the web's lineState in
// the wire's terms: a bye and a line with no game are named; otherwise
// the API's state, an upcoming read whose kickoff has passed kicked off.
func TestLineGameStateIsTheWebsLineState(t *testing.T) {
	kickoff := sundayKickoff
	upcoming, kicked, final := apitypes.GameStateUpcoming, apitypes.GameStateKickedOff, apitypes.GameStateFinal
	facts := func(state *apitypes.GameState, played bool) apitypes.WeekFacts {
		at := kickoff
		return apitypes.WeekFacts{Kickoff: &at, GameState: state, Played: played}
	}
	cases := []struct {
		name  string
		line  apitypes.PlayerLine
		now   time.Time
		state apitypes.GameStateCellState
		word  string
	}{
		{"before kickoff", apitypes.PlayerLine{Facts: facts(&upcoming, false)}, kickoff.Add(-time.Minute), apitypes.GameStateCellStateNotStarted, "Next kickoff"},
		{"an upcoming read at its kickoff", apitypes.PlayerLine{Facts: facts(&upcoming, false)}, kickoff, apitypes.GameStateCellStateKickedOff, "Kicked off"},
		{"kicked off", apitypes.PlayerLine{Facts: facts(&kicked, false)}, kickoff.Add(time.Hour), apitypes.GameStateCellStateKickedOff, "Kicked off"},
		{"final", apitypes.PlayerLine{Facts: facts(&final, true)}, kickoff.Add(time.Hour), apitypes.GameStateCellStateFinal, "Final"},
		{"no state, played", apitypes.PlayerLine{Facts: facts(nil, true)}, kickoff.Add(-time.Hour), apitypes.GameStateCellStateFinal, "Final"},
		{"no state, not played", apitypes.PlayerLine{Facts: facts(nil, false)}, kickoff.Add(-time.Hour), apitypes.GameStateCellStateNotStarted, "Next kickoff"},
		{"bye", apitypes.PlayerLine{Facts: apitypes.WeekFacts{Bye: true}}, kickoff, apitypes.GameStateCellStateBye, "Bye"},
		{"a free agent", apitypes.PlayerLine{Player: apitypes.LeaguePlayer{Team: figurewords.Table.FreeAgentClub}}, kickoff, apitypes.GameStateCellStateNoGame, "No club"},
		{"no game held", apitypes.PlayerLine{Player: apitypes.LeaguePlayer{Team: "ZZZ"}}, kickoff, apitypes.GameStateCellStateNoGame, ""},
	}
	for _, c := range cases {
		got := lineGameState(c.line, c.now)
		if got == nil || got.State != c.state || got.Word != c.word {
			t.Errorf("%s: %+v, want %s %q", c.name, got, c.state, c.word)
		}
	}
}

// A scoreboard game's game_state is its head, the web's gameHead: Next
// kickoff before it, kicked off once a kickoff has passed, final.
func TestScoreboardGameStateIsTheWebsGameHead(t *testing.T) {
	kickoff := sundayKickoff
	cases := []struct {
		name  string
		state apitypes.ScoreboardGameState
		next  *time.Time
		now   time.Time
		want  apitypes.GameStateCellState
		word  string
	}{
		{"before kickoff", apitypes.ScoreboardGameStateUpcoming, &kickoff, kickoff.Add(-time.Minute), apitypes.GameStateCellStateNotStarted, "Next kickoff"},
		{"a read whose kickoff has passed", apitypes.ScoreboardGameStateUpcoming, &kickoff, kickoff, apitypes.GameStateCellStateKickedOff, "Kicked off"},
		{"no kickoff to name", apitypes.ScoreboardGameStateUpcoming, nil, kickoff, apitypes.GameStateCellStateNotStarted, ""},
		{"playing", apitypes.ScoreboardGameStatePlaying, &kickoff, kickoff.Add(-time.Hour), apitypes.GameStateCellStateKickedOff, "Kicked off"},
		{"final", apitypes.ScoreboardGameStateFinal, nil, kickoff, apitypes.GameStateCellStateFinal, "Final"},
	}
	for _, c := range cases {
		got := scoreboardGameState(apitypes.ScoreboardGame{State: c.state, NextKickoff: c.next}, c.now)
		if got == nil || got.State != c.want || got.Word != c.word {
			t.Errorf("%s: %+v, want %s %q", c.name, got, c.want, c.word)
		}
	}
}

// linesOf is every player line an answer carries, wherever it sits: an
// object with a player and his facts.
func linesOf(t *testing.T, raw json.RawMessage) []apitypes.PlayerLine {
	t.Helper()
	var tree any
	if err := json.Unmarshal(raw, &tree); err != nil {
		t.Fatal(err)
	}
	var out []apitypes.PlayerLine
	var walk func(any)
	walk = func(node any) {
		switch v := node.(type) {
		case []any:
			for _, item := range v {
				walk(item)
			}
		case map[string]any:
			_, player := v["player"]
			_, facts := v["facts"]
			if player && facts {
				b, err := json.Marshal(v)
				if err != nil {
					t.Fatal(err)
				}
				var line apitypes.PlayerLine
				if err := json.Unmarshal(b, &line); err != nil {
					t.Fatal(err)
				}
				out = append(out, line)
			}
			for _, item := range v {
				walk(item)
			}
		}
	}
	walk(tree)
	return out
}

// noGameFixture is the paired fixture with two bench players of team 1's
// that have no game: a free agent and a club the schedule does not hold;
// and week 7 scheduled, every club playing, for a screen that turns to it.
func noGameFixture(t *testing.T) fixture {
	t.Helper()
	f := pairedFixture(t)
	named := f.league.Player
	f.league.Player = func(id string) apitypes.LeaguePlayer {
		switch id {
		case "hfa":
			return apitypes.LeaguePlayer{HostId: id, Name: "A free agent", Position: "WR", Team: figurewords.Table.FreeAgentClub}
		case "hzz":
			return apitypes.LeaguePlayer{HostId: id, Name: "No schedule", Position: "WR", Team: "ZZZ"}
		}
		return named(id)
	}
	for i := range f.league.Snap.Teams {
		if f.league.Snap.Teams[i].RosterID == 1 {
			f.league.Snap.Teams[i].Players = append(f.league.Snap.Teams[i].Players, "hfa", "hzz")
		}
	}
	clubs := fixtureTeams()
	week7 := time.Date(2026, 10, 25, 13, 0, 0, 0, east)
	for i := 0; i+1 < len(clubs); i += 2 {
		f.data.Games = append(f.data.Games, game(7, clubs[i], clubs[i+1], week7, false)...)
	}
	return f
}

// The week 6 clubs on bye in the fixture (fixtureData: the last two).
func byeClubs() map[string]bool {
	clubs := fixtureTeams()
	return map[string]bool{clubs[len(clubs)-1]: true, clubs[len(clubs)-2]: true}
}

// wantLine is what a line of the fixture says at a clock: the week 6
// game's state for a club playing that week (week 7's, every club
// playing, for a line of the week after), Bye for a club on bye, and no
// game for the two with none.
func wantLine(line apitypes.PlayerLine, week6 apitypes.GameStateCell) apitypes.GameStateCell {
	switch {
	case line.Player.Team == figurewords.Table.FreeAgentClub:
		return apitypes.GameStateCell{State: apitypes.GameStateCellStateNoGame, Word: "No club"}
	case line.Player.Team == "ZZZ":
		return apitypes.GameStateCell{State: apitypes.GameStateCellStateNoGame}
	case line.Facts.Week == 7:
		return apitypes.GameStateCell{State: apitypes.GameStateCellStateNotStarted, Word: "Next kickoff"}
	case byeClubs()[line.Player.Team]:
		return apitypes.GameStateCell{State: apitypes.GameStateCellStateBye, Word: "Bye"}
	}
	return week6
}

// Every in-season screen's lines and the scoreboard's games carry
// game_state at the request's clock, through the engine with the clock
// injected (Lane 176): before Sunday's kickoff, during the games and once
// they are final, a bye club's players Bye and a player with no game
// named so at each.
func TestGameStateOnEveryLineAtTheRequestsClock(t *testing.T) {
	clocks := []struct {
		name  string
		now   time.Time
		final bool
		state apitypes.GameStateCell
	}{
		{"before kickoff", fixtureNow, false, apitypes.GameStateCell{State: apitypes.GameStateCellStateNotStarted, Word: "Next kickoff"}},
		{"during the games", sundayKickoff.Add(30 * time.Minute), false, apitypes.GameStateCell{State: apitypes.GameStateCellStateKickedOff, Word: "Kicked off"}},
		{"final", sundayKickoff.Add(21 * time.Hour), true, apitypes.GameStateCell{State: apitypes.GameStateCellStateFinal, Word: "Final"}},
	}
	routes := []string{leaguePath + "lineup", leaguePath + "matchup", leaguePath + "waivers", leaguePath + "trades",
		leaguePath + "order/week?position=DEF", "/order/week?position=K", leaguePath + "players/p000", "/players/p000/week"}
	for _, clock := range clocks {
		f := noGameFixture(t)
		if clock.final {
			finishWeekBut(&f, nil)
		}
		s := fixtureService(t, f.league, f.data, &fakeHolds{})
		s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
		now := clock.now
		s.Now = func() time.Time { return now }
		seen := map[apitypes.GameStateCellState]bool{}
		for _, route := range routes {
			code, env := serve(t, s, route)
			if code != http.StatusOK || !env.Ok {
				t.Fatalf("%s %s: %d %+v", clock.name, route, code, env.Error)
			}
			lines := linesOf(t, env.Data)
			if len(lines) == 0 {
				t.Fatalf("%s %s: no lines", clock.name, route)
			}
			for _, line := range lines {
				want := wantLine(line, clock.state)
				if line.GameState == nil || *line.GameState != want {
					t.Errorf("%s %s %s (%s): %+v, want %+v", clock.name, route, line.Player.Name, line.Player.Team, line.GameState, want)
					continue
				}
				seen[want.State] = true
			}
		}
		for _, state := range []apitypes.GameStateCellState{clock.state.State, apitypes.GameStateCellStateBye, apitypes.GameStateCellStateNoGame} {
			if !seen[state] {
				t.Errorf("%s: no line read %s", clock.name, state)
			}
		}
		for _, g := range scoreboardOf(t, s).Games {
			if g.GameState == nil || *g.GameState != clock.state {
				t.Errorf("%s: scoreboard game %+v, want %+v", clock.name, g.GameState, clock.state)
			}
		}
	}
}

// gameStateParity is shared/fixtures/parity/game-state.json: what the
// web's readers print for every lineup line and scoreboard game of the
// fixture league at its clocks (shared/scripts/game-state-parity.ts).
type gameStateParity struct {
	Rows []struct {
		Route    string                      `json:"route"`
		Clock    time.Time                   `json:"clock"`
		Fixture  string                      `json:"fixture"`
		PlayerID *string                     `json:"player_id"`
		Game     *int                        `json:"game"`
		State    apitypes.GameStateCellState `json:"state"`
		Word     string                      `json:"word"`
	} `json:"rows"`
}

const repositoryRoot = "../../.."

func readShared(t *testing.T, path string, into any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repositoryRoot, path))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

// The API's rule prints what the web's does on every line and game of the
// shared fixture league at every fixture clock (Lane 176): each fixture
// answer read as the wire's types, its game_state computed at the row's
// clock, equal to the web's state and word; and every line the answer
// carries has its row.
func TestGameStateMatchesTheWebsReaderOnTheSharedFixtures(t *testing.T) {
	var parity gameStateParity
	readShared(t, "shared/fixtures/parity/game-state.json", &parity)
	if len(parity.Rows) == 0 {
		t.Fatal("the parity file holds no rows")
	}
	type answer struct {
		lines []apitypes.PlayerLine
		board apitypes.Scoreboard
	}
	answers := map[string]answer{}
	read := func(path string) answer {
		if a, ok := answers[path]; ok {
			return a
		}
		var env envelope
		readShared(t, path, &env)
		a := answer{lines: linesOf(t, env.Data)}
		if err := json.Unmarshal(env.Data, &a.board); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		answers[path] = a
		return a
	}
	rowed := map[string]map[string]bool{}
	states := map[apitypes.GameStateCellState]bool{}
	for _, row := range parity.Rows {
		a := read(row.Fixture)
		var got *apitypes.GameStateCell
		switch {
		case row.PlayerID != nil:
			for _, line := range a.lines {
				if line.Player.HostId == *row.PlayerID {
					got = lineGameState(line, row.Clock)
					break
				}
			}
			if rowed[row.Fixture] == nil {
				rowed[row.Fixture] = map[string]bool{}
			}
			rowed[row.Fixture][*row.PlayerID] = true
		case row.Game != nil && *row.Game < len(a.board.Games):
			got = scoreboardGameState(a.board.Games[*row.Game], row.Clock)
		}
		if got == nil || got.State != row.State || got.Word != row.Word {
			t.Errorf("%s at %s, player %v game %v: %+v, the web's %s %q", row.Route, row.Clock.Format(time.RFC3339), row.PlayerID, row.Game, got, row.State, row.Word)
		}
		states[row.State] = true
	}
	for path, players := range rowed {
		for _, line := range answers[path].lines {
			if !players[line.Player.HostId] {
				t.Errorf("%s: %s has no row", path, line.Player.HostId)
			}
		}
	}
	for _, state := range []apitypes.GameStateCellState{apitypes.GameStateCellStateNotStarted, apitypes.GameStateCellStateKickedOff,
		apitypes.GameStateCellStateFinal, apitypes.GameStateCellStateBye} {
		if !states[state] {
			t.Errorf("no row reads %s", state)
		}
	}
}
