package inseason

import (
	"fmt"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// The fixture league (test-only, never served): 12 teams on Sleeper, PPR,
// QB, 2 RB, 3 WR, TE, a flex, K, DEF and five on the bench; 15 players a
// roster in the order below; 60 more on the board unrostered. Week 6,
// Thursday afternoon, every club playing except two on bye.

var fixtureNow = time.Date(2026, 10, 15, 16, 0, 0, 0, east)

func fixtureSettings() apitypes.LeagueSettings {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	return apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1, Bench: 5}}
}

// rosterTemplate is each team's 15, starters first in the host's order.
func rosterTemplate() []draft.Position {
	return []draft.Position{draft.QB, draft.RB, draft.RB, draft.WR, draft.WR, draft.WR, draft.TE, draft.RB, draft.K, draft.DEF,
		draft.QB, draft.RB, draft.WR, draft.TE, draft.WR}
}

func fixtureTeams() []string {
	return []string{"ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
		"LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WSH"}
}

type fixture struct {
	league League
	data   Data
	raw    *boards.Raw
}

// newFixture builds the league. Points fall with the player's number,
// spread over teams so each roster mixes strong and weak players.
func newFixture(t testing.TB) fixture {
	t.Helper()
	settings := fixtureSettings()
	config, err := mock.SlotConfig(settings)
	if err != nil {
		t.Fatal(err)
	}
	clubs := fixtureTeams()
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Source: "fixture", AsOf: time.Date(2026, 10, 14, 5, 0, 0, 0, time.UTC)}
	lp := map[string]apitypes.LeaguePlayer{}
	var teams []leaguesync.Team
	n := 0
	add := func(position draft.Position) (string, string) {
		id, host := fmt.Sprintf("p%03d", n), fmt.Sprintf("h%03d", n)
		club := clubs[(n*7)%len(clubs)]
		var pts *float64
		if position != draft.K && position != draft.DEF {
			v := 320 - float64((n*37)%280)
			pts = &v
		}
		raw.Players = append(raw.Players, boards.Player{ID: id, Name: fmt.Sprintf("Player %03d", n), Position: position, Team: club, Points: pts})
		board := id
		lp[host] = apitypes.LeaguePlayer{HostId: host, BoardId: &board, Name: fmt.Sprintf("Player %03d", n), Position: string(position), Team: club}
		n++
		return id, host
	}
	for roster := 1; roster <= 12; roster++ {
		team := leaguesync.Team{RosterID: roster, Name: fmt.Sprintf("Team %d", roster), Owner: fmt.Sprintf("owner%d", roster), Wins: 12 - roster}
		for i, position := range rosterTemplate() {
			_, host := add(position)
			team.Players = append(team.Players, host)
			if i < 10 {
				team.Starters = append(team.Starters, host)
			}
		}
		teams = append(teams, team)
	}
	for i := 0; i < 60; i++ {
		add([]draft.Position{draft.RB, draft.WR, draft.QB, draft.TE, draft.WR}[i%5])
	}
	board, err := boards.For(raw, settings.Teams, config)
	if err != nil {
		t.Fatal(err)
	}
	held := map[string]int{}
	for _, team := range teams {
		for _, h := range team.Players {
			held[*lp[h].BoardId] = team.RosterID
		}
	}
	snap := leaguesync.Snapshot{Ref: leaguesync.Ref{Host: leaguesync.HostSleeper, LeagueID: "1382163311038038016"}, Name: "Fixture",
		Season: 2026, Week: 6, Teams: teams, ReadAt: fixtureNow.Add(-time.Minute)}
	league := League{Snap: snap, Me: 1, Saved: &settings, Board: board, HeldBy: held,
		Player: func(id string) apitypes.LeaguePlayer {
			if p, ok := lp[id]; ok {
				return p
			}
			return apitypes.LeaguePlayer{HostId: id, Name: "A player not yet listed"}
		}}
	return fixture{league: league, data: fixtureData(clubs), raw: raw}
}

// fixtureData is the week's schedule: clubs paired in order, Sunday 1:00
// Eastern, the last two on bye; five final weeks before it.
func fixtureData(clubs []string) Data {
	var games []boards.TeamWeek
	for week := 1; week <= 6; week++ {
		playing := clubs
		if week == 6 {
			playing = clubs[:len(clubs)-2]
		}
		kickoff := time.Date(2026, 9, 13, 13, 0, 0, 0, east).AddDate(0, 0, 7*(week-1))
		for i := 0; i+1 < len(playing); i += 2 {
			games = append(games, game(week, playing[i], playing[i+1], kickoff, week < 6)...)
		}
	}
	return Data{Games: games, Designations: map[string]boards.Designation{}}
}

func newFixtureAdvisor(t testing.TB, f fixture, held map[string]bool) *advisor {
	t.Helper()
	a, err := newAdvisor(f.league, f.data, boards.WeekProjection{}, held, fixtureNow)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
