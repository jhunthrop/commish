package espn

import (
	"strconv"
	"time"
)

// maxPeriod bounds a scoring period ESPN names: a season has at most 18
// weeks and a few of playoffs.
const maxPeriod = 25

// Bounds on a draft date ESPN states: 2000 to 2100, in Unix milliseconds.
const (
	minDraftMillis = 946684800000
	maxDraftMillis = 4102444800000
)

// period is a scoring period ESPN states, 0 when out of bounds.
func period(n int) int {
	if n < 0 || n > maxPeriod {
		return 0
	}
	return n
}

// draftDate is settings.draftSettings.date, nil when ESPN states none or
// one out of bounds.
func draftDate(ms int64) *time.Time {
	if ms < minDraftMillis || ms > maxDraftMillis {
		return nil
	}
	t := time.UnixMilli(ms).UTC()
	return &t
}

// playoffStart is the league's first playoff scoring period: the first
// period of the matchup period after the regular season's last
// (matchupPeriodCount), by matchupPeriods when ESPN lists it, else by the
// matchup period's length. 0 when ESPN states no regular season.
// playoffTeams is scheduleSettings.playoffTeamCount, 0 when it is not a
// count of teams.
func playoffTeams(n int) int {
	if n < 1 || n > maxTeams {
		return 0
	}
	return n
}

func playoffStart(w wireFull) int {
	s := w.Settings.ScheduleSettings
	if s.MatchupPeriodCount < 1 || s.MatchupPeriodCount > maxPeriod {
		return 0
	}
	if periods := s.MatchupPeriods[strconv.Itoa(s.MatchupPeriodCount+1)]; len(periods) > 0 {
		return period(periods[0])
	}
	length := max(s.MatchupPeriodLength, 1)
	return period(s.MatchupPeriodCount*length + 1)
}
