package espn

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
)

// ESPN's player stat splits (player.stats in view=mRoster): statSourceId
// 0 is what he scored, 1 what ESPN projects; statSplitTypeId 1 is one
// scoring period, 0 the season and 2 the rest of it. appliedTotal is the
// split's points in the league's own scoring.
const (
	statActual    = 0
	statProjected = 1
	splitPeriod   = 1
)

// maxWeekStats bounds one player's stat splits: a period read carries
// the period, the one before it and the season's two.
const maxWeekStats = 16

// WeekRead is a league's rosters for one scoring period with ESPN's own
// points for each player (Lane 93): the period ESPN projects in the
// league's scoring before its games, and what he scored once they are
// played. A read for a period carries that period and the one before it.
type WeekRead struct {
	Season int
	// Period is the scoring period asked for, ScoringPeriod the league's
	// current one when it was read.
	Period        int
	ScoringPeriod int
	Teams         []WeekTeam
}

// WeekTeam is one team's roster as the period's read has it.
type WeekTeam struct {
	ID      int
	Players []WeekPlayer
}

// WeekPlayer is one rostered player, the slot he fills in the period
// read, ESPN's injury status for him, and his points by scoring period.
type WeekPlayer struct {
	ID       string
	Position string
	Team     string
	Slot     int
	// Status is ESPN's injuryStatus (ACTIVE, QUESTIONABLE, OUT,
	// INJURY_RESERVE ...), empty when ESPN sends none.
	Status string
	Points map[int]PeriodPoints
}

// PeriodPoints is one scoring period's points in the league's scoring,
// each nil where ESPN sends no split for it.
type PeriodPoints struct {
	Projected *float64
	Actual    *float64
}

type wireStat struct {
	SeasonID        int     `json:"seasonId"`
	ScoringPeriodID int     `json:"scoringPeriodId"`
	StatSourceID    int     `json:"statSourceId"`
	StatSplitTypeID int     `json:"statSplitTypeId"`
	AppliedTotal    float64 `json:"appliedTotal"`
}

type wireWeek struct {
	ID              int `json:"id"`
	SeasonID        int `json:"seasonId"`
	ScoringPeriodID int `json:"scoringPeriodId"`
	Teams           []struct {
		ID     int `json:"id"`
		Roster struct {
			Entries []struct {
				PlayerID        int    `json:"playerId"`
				LineupSlotID    int    `json:"lineupSlotId"`
				InjuryStatus    string `json:"injuryStatus"`
				PlayerPoolEntry struct {
					Player struct {
						ID                int        `json:"id"`
						DefaultPositionID int        `json:"defaultPositionId"`
						ProTeamID         int        `json:"proTeamId"`
						InjuryStatus      string     `json:"injuryStatus"`
						Stats             []wireStat `json:"stats"`
					} `json:"player"`
				} `json:"playerPoolEntry"`
			} `json:"entries"`
		} `json:"roster"`
	} `json:"teams"`
}

// ReadWeek reads the league's rosters for one scoring period
// (view=mRoster with scoringPeriodId), with the cookies when given.
func (c *Client) ReadWeek(ctx context.Context, id string, season, period int, cookies *Cookies) (WeekRead, error) {
	if !leagueID.MatchString(id) || season < minSeason || season > maxSeason || period < 1 || period > maxPeriod {
		return WeekRead{}, ErrNotALink
	}
	q := url.Values{"view": {"mRoster"}, "scoringPeriodId": {strconv.Itoa(period)}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, season, id, q.Encode())
	var wire wireWeek
	err := c.fetch(ctx, path, cookies, "", func(body io.Reader) error {
		if err := json.NewDecoder(io.LimitReader(body, maxLeagueBody)).Decode(&wire); err != nil {
			return fmt.Errorf("%w: %w", ErrMalformed, err)
		}
		return nil
	})
	if err != nil {
		return WeekRead{}, err
	}
	return checkWeek(wire, season, period)
}

func checkWeek(w wireWeek, season, period int) (WeekRead, error) {
	if w.ID <= 0 || w.SeasonID != season || len(w.Teams) == 0 || len(w.Teams) > maxTeams {
		return WeekRead{}, fmt.Errorf("%w: week read of league %d season %d with %d teams", ErrMalformed, w.ID, w.SeasonID, len(w.Teams))
	}
	out := WeekRead{Season: season, Period: period, ScoringPeriod: w.ScoringPeriodID}
	for _, t := range w.Teams {
		team := WeekTeam{ID: t.ID}
		for i, e := range t.Roster.Entries {
			if i >= maxRoster {
				break
			}
			p := e.PlayerPoolEntry.Player
			id := e.PlayerID
			if id == 0 {
				id = p.ID
			}
			status := e.InjuryStatus
			if p.InjuryStatus != "" {
				status = p.InjuryStatus
			}
			team.Players = append(team.Players, WeekPlayer{
				ID: strconv.Itoa(id), Position: positions[p.DefaultPositionID], Team: proTeams[p.ProTeamID],
				Slot: e.LineupSlotID, Status: text(status), Points: periodPoints(p.Stats, season, period),
			})
		}
		out.Teams = append(out.Teams, team)
	}
	return out, nil
}

// periodPoints is a player's points for the period and the one before it,
// each split in the league's scoring; a split for another season, another
// period or the season whole is not read.
func periodPoints(stats []wireStat, season, period int) map[int]PeriodPoints {
	out := map[int]PeriodPoints{}
	for i, s := range stats {
		if i >= maxWeekStats {
			break
		}
		if s.SeasonID != season || s.StatSplitTypeID != splitPeriod || (s.ScoringPeriodID != period && s.ScoringPeriodID != period-1) {
			continue
		}
		v := score(s.AppliedTotal)
		got := out[s.ScoringPeriodID]
		switch s.StatSourceID {
		case statActual:
			got.Actual = &v
		case statProjected:
			got.Projected = &v
		default:
			continue
		}
		out[s.ScoringPeriodID] = got
	}
	return out
}
