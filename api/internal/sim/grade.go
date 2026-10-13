package sim

import (
	"math"
	"sort"

	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// byeCollisionThreshold is three starters sharing a bye.
const byeCollisionThreshold = 3

// GradePick is the part of a pick grading reads.
type GradePick struct {
	PickNumber int    `json:"pickNumber"`
	TeamID     string `json:"teamId"`
	PlayerID   string `json:"playerId"`
}

// GradeInput is everything Grade reads; it derives nothing it is not handed.
type GradeInput struct {
	// Picks is every pick of the draft, any team.
	Picks []GradePick
	// Rosters is one entry per team in the room.
	Rosters    map[string][]RosteredPlayer
	SlotConfig []draft.SlotConfig
	// Points is projected season points; absent scores 0.
	Points map[string]float64
	// Values is the board's value over replacement.
	Values map[string]float64
	// ByeWeeks is NFL team code to bye week; NFLTeamByPlayer resolves a player's team.
	ByeWeeks        map[string]int
	NFLTeamByPlayer map[string]string
}

// TeamGrade is one team's facts. No letter: the report names the basis
// and the numbers, not a verdict (room doc, the report).
type TeamGrade struct {
	TeamID              string  `json:"teamId"`
	ValueCaptured       float64 `json:"valueCaptured"`
	StartingSlotsFilled int     `json:"startingSlotsFilled"`
	StartingSlotsTotal  int     `json:"startingSlotsTotal"`
	ByeCollisions       int     `json:"byeCollisions"`
	ProjectedPoints     float64 `json:"projectedPoints"`
	// ProjectedRank is 1-based by projected points, ties by team id.
	ProjectedRank int `json:"projectedRank"`
}

// valueCaptured sums, over the team's picks, the pick's value less the
// best value still on the board the instant before it. Never above zero.
func valueCaptured(ordered []GradePick, values map[string]float64, byValue []string, teamID string) float64 {
	gone := map[string]bool{}
	cursor := 0
	total := 0.0
	for _, p := range ordered {
		if p.TeamID == teamID {
			for cursor < len(byValue) && gone[byValue[cursor]] {
				cursor++
			}
			pickValue := values[p.PlayerID]
			best := math.Inf(-1)
			if cursor < len(byValue) {
				best = values[byValue[cursor]]
			}
			if math.IsInf(best, -1) {
				best = pickValue
			}
			total += pickValue - best
		}
		gone[p.PlayerID] = true
	}
	return total
}

func byeCollisions(starters []string, nflTeam map[string]string, byes map[string]int) int {
	perWeek := map[int]int{}
	for _, id := range starters {
		team, ok := nflTeam[id]
		if !ok {
			continue
		}
		if week, ok := byes[team]; ok {
			perWeek[week]++
		}
	}
	n := 0
	for _, c := range perWeek {
		if c >= byeCollisionThreshold {
			n++
		}
	}
	return n
}

// Grade scores every finished roster in the room.
func Grade(in GradeInput) []TeamGrade {
	teams := make([]string, 0, len(in.Rosters))
	for team := range in.Rosters {
		teams = append(teams, team)
	}
	sort.SliceStable(teams, func(i, j int) bool { return jsmath.Collate(teams[i], teams[j]) < 0 })
	ordered := append([]GradePick(nil), in.Picks...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].PickNumber < ordered[j].PickNumber })
	byValue := make([]string, 0, len(in.Values))
	for id := range in.Values {
		byValue = append(byValue, id)
	}
	sort.Slice(byValue, func(i, j int) bool { return in.Values[byValue[i]] > in.Values[byValue[j]] })

	slots := in.SlotConfig
	grades := make([]TeamGrade, len(teams))
	for i, team := range teams {
		lineup := AssignStartingLineup(in.Rosters[team], slots, in.Points)
		grades[i] = TeamGrade{
			TeamID:              team,
			ValueCaptured:       valueCaptured(ordered, in.Values, byValue, team),
			StartingSlotsFilled: len(lineup.StarterIDs),
			StartingSlotsTotal:  lineup.StartingSlotsTotal,
			ByeCollisions:       byeCollisions(lineup.StarterIDs, in.NFLTeamByPlayer, in.ByeWeeks),
			ProjectedPoints:     StartingPoints(lineup, in.Points),
		}
	}
	byPoints := make([]int, len(grades))
	for i := range byPoints {
		byPoints[i] = i
	}
	sort.SliceStable(byPoints, func(a, b int) bool {
		ga, gb := grades[byPoints[a]], grades[byPoints[b]]
		if ga.ProjectedPoints != gb.ProjectedPoints {
			return ga.ProjectedPoints > gb.ProjectedPoints
		}
		return jsmath.Collate(ga.TeamID, gb.TeamID) < 0
	})
	for rank, i := range byPoints {
		grades[i].ProjectedRank = rank + 1
	}
	return grades
}
