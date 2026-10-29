package mfl

import (
	"context"
	"strconv"
)

// averageSide is the side a league that also plays the week's average
// score names in its schedule.
const averageSide = "AVG"

// ScheduleGame is one game of the season's schedule (TYPE=schedule, Lane
// 298): its week, the franchises in it (one for a game against the week's
// average), each one's score once the week is played, and whether it is.
type ScheduleGame struct {
	Week       int
	Franchises []int
	// Scores is each franchise's score in Franchises' order, nil for a
	// week not yet played (the export lists no score for it).
	Scores []float64
	// Average is a game against the week's average score.
	Average bool
}

type wireScheduleSide struct {
	ID    string  `json:"id"`
	Score *string `json:"score"`
}

type wireSchedule struct {
	Schedule struct {
		WeeklySchedule list[struct {
			Week    string `json:"week"`
			Matchup list[struct {
				Franchise list[wireScheduleSide] `json:"franchise"`
			}] `json:"matchup"`
		}] `json:"weeklySchedule"`
	} `json:"schedule"`
}

// Schedule reads the season's schedule with each played week's scores,
// one export for every week.
func (c *Client) Schedule(ctx context.Context, season int, id string) ([]ScheduleGame, error) {
	var w wireSchedule
	if err := c.export(ctx, season, id, "schedule", nil, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeSchedule checks a recorded schedule export.
func DecodeSchedule(body []byte) ([]ScheduleGame, error) {
	var w wireSchedule
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wireSchedule) validate() ([]ScheduleGame, error) {
	if len(w.Schedule.WeeklySchedule) > maxWeek {
		return nil, malformed("%d weeks", len(w.Schedule.WeeklySchedule))
	}
	var out []ScheduleGame
	for _, wk := range w.Schedule.WeeklySchedule {
		week, err := strconv.Atoi(wk.Week)
		if err != nil || week < 1 || week > maxWeek || len(wk.Matchup) > maxTeams*2 {
			return nil, malformed("schedule week %q", wk.Week)
		}
		for _, m := range wk.Matchup {
			g, ok, err := scheduleGame(week, m.Franchise)
			if err != nil {
				return nil, err
			}
			if ok {
				out = append(out, g)
			}
		}
	}
	return out, nil
}

// scheduleGame is one matchup's franchises and scores; a side that is no
// franchise is the week's average (AVG) or nobody. false for a matchup
// that names no franchise.
func scheduleGame(week int, sides []wireScheduleSide) (ScheduleGame, bool, error) {
	if len(sides) > 2 {
		return ScheduleGame{}, false, malformed("a scheduled matchup of %d", len(sides))
	}
	g := ScheduleGame{Week: week}
	scored := true
	var scores []float64
	for _, s := range sides {
		n, ok := franchiseNumber(s.ID)
		if !ok {
			g.Average = g.Average || s.ID == averageSide
			continue
		}
		g.Franchises = append(g.Franchises, n)
		if s.Score == nil {
			scored = false
			continue
		}
		v, ok := number(*s.Score, maxPoints)
		if !ok {
			return ScheduleGame{}, false, malformed("scheduled score %q", *s.Score)
		}
		scores = append(scores, v)
	}
	if len(g.Franchises) == 0 {
		return ScheduleGame{}, false, nil
	}
	if scored {
		g.Scores = scores
	}
	return g, true, nil
}
