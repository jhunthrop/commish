package sim

import "github.com/jhunthrop/commish/api/internal/draft"

// GradeInputFor builds Grade's input from a finished state: every pick,
// every seat's roster with the pool's positions, and the board's numbers.
func GradeInputFor(s draft.State, points, values map[string]float64, byes map[string]int, nflTeam map[string]string) GradeInput {
	picks := make([]GradePick, len(s.Picks))
	for i, p := range s.Picks {
		picks[i] = GradePick{PickNumber: p.PickNumber, TeamID: p.TeamID, PlayerID: p.PlayerID}
	}
	rosters := make(map[string][]RosteredPlayer, len(s.DraftOrder))
	for _, team := range s.DraftOrder {
		slots := draft.RosterFor(s, team)
		players := make([]RosteredPlayer, 0, len(slots))
		for _, slot := range slots {
			pos, _ := s.Pool.PositionOf(slot.PlayerID)
			players = append(players, RosteredPlayer{PlayerID: slot.PlayerID, Position: pos})
		}
		rosters[team] = players
	}
	return GradeInput{
		Picks: picks, Rosters: rosters, SlotConfig: s.Config.SlotConfig,
		Points: points, Values: values, ByeWeeks: byes, NFLTeamByPlayer: nflTeam,
	}
}
