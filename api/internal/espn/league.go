package espn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A whole league read (the rosters, settings, matchups, teams and live
// score views) is bigger than a settings read: a season's schedule rides
// with it, 6.9 MB for a 12-team league in week 6 of 2026 (Lane 74).
const (
	maxLeagueBody = 16 << 20
	maxTeams      = 32
	maxRoster     = 60
	maxSchedule   = 600
	maxMembers    = 100
	maxScore      = 10000
	maxMyLeagues  = 50
)

// FanBase is ESPN's fan API, which lists a member's own fantasy teams.
const FanBase = "https://fan.api.espn.com"

// ErrSignedOut is cookies ESPN no longer accepts: the member connects again.
var ErrSignedOut = errors.New("espn: the cookies are refused")

var (
	swidPattern = regexp.MustCompile(`^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$`)
	s2Pattern   = regexp.MustCompile(`^[A-Za-z0-9%+/=_.-]{40,600}$`)
)

// Cookies are the member's two ESPN cookies. They never print.
type Cookies struct {
	SWID string
	S2   string
}

func (Cookies) String() string   { return "[redacted]" }
func (Cookies) GoString() string { return "[redacted]" }

// Valid reports whether both cookies have ESPN's shape.
func (c Cookies) Valid() bool { return ValidSWID(c.SWID) && ValidS2(c.S2) }

// ValidSWID reports a SWID of ESPN's shape: a braced id.
func ValidSWID(s string) bool { return swidPattern.MatchString(s) }

// ValidS2 reports an espn_s2 of ESPN's shape: one cookie value, no space,
// no separator a header could be split at.
func ValidS2(s string) bool { return s2Pattern.MatchString(s) }

// header is the Cookie header the two make.
func (c Cookies) header() string { return "SWID=" + c.SWID + "; espn_s2=" + c.S2 }

// Positions by ESPN's defaultPositionId, in our names.
var positions = map[int]string{1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

// proTeams is ESPN's proTeamId as our board's team code.
var proTeams = map[int]string{
	1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
	11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
	21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX",
	33: "BAL", 34: "HOU",
}

// defenseBase is the base of ESPN's D/ST player ids: a club's D/ST is
// -(defenseBase + its proTeamId), as every defense in the recorded league
// 48153503 carries it (Ravens D/ST -16033, Lions D/ST -16008).
const defenseBase = 16000

// TeamCodes is every club code ESPN's proTeamId table names, sorted.
func TeamCodes() []string {
	out := make([]string, 0, len(proTeams))
	for _, code := range proTeams {
		out = append(out, code)
	}
	sort.Strings(out)
	return out
}

// DefenseID is ESPN's player id for the club's D/ST, by our team code;
// false for a club ESPN does not name.
func DefenseID(team string) (string, bool) {
	for id, code := range proTeams {
		if code == team {
			return strconv.Itoa(-(defenseBase + id)), true
		}
	}
	return "", false
}

// Lineup slots by ESPN's lineupSlotId, in our names; any other is named
// by its number to the caller.
var slots = map[int]string{
	0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "DEF", 17: "K", 23: "FLEX", 7: "SUPER_FLEX", SlotBench: "BN", SlotReserve: "IR",
	1: "TQB", 3: "RB/WR", 5: "WR/TE", 8: "DT", 9: "DE", 10: "LB", 11: "DL", 12: "CB", 13: "S", 14: "DB", 15: "DP",
	18: "P", 19: "HC", 24: "ER",
}

// SlotName is a lineup slot in our words, or "slot N" for one we do not
// name.
func SlotName(id int) string {
	if s, ok := slots[id]; ok {
		return s
	}
	return "slot " + strconv.Itoa(id)
}

// FullLeague is one whole read of a league.
type FullLeague struct {
	ID              string
	Name            string
	Season          int
	ScoringPeriod   int
	MatchupPeriod   int
	Size            int
	Teams           []Team
	Members         map[string]string
	Games           []Game
	Items           []Item
	LineupSlotCount map[int]int
	// Acquisition is how the league takes adds: its waiver budget and
	// when its claims run (settings.acquisitionSettings).
	Acquisition Acquisition
	// Draft is ESPN's draftDetail, nil when the read does not carry it.
	Draft *DraftState
	// DraftAt is settings.draftSettings.date, nil when ESPN states none.
	DraftAt *time.Time
	// PlayoffStartWeek is the first scoring period of the matchup period
	// after the regular season's (scheduleSettings.matchupPeriodCount),
	// 0 when ESPN does not say.
	PlayoffStartWeek int
	// FinalScoringPeriod is status.finalScoringPeriod, the season's last
	// scoring period, 0 when ESPN does not say.
	FinalScoringPeriod int
	// FinalRoundWeeks is how many scoring periods the matchup period
	// holding FinalScoringPeriod spans (scheduleSettings.matchupPeriods):
	// 2 for a two-week championship, 0 when ESPN does not say.
	FinalRoundWeeks int
	// PlayoffTeams is scheduleSettings.playoffTeamCount, 0 when unset.
	PlayoffTeams int
	// SeedingTiebreak is scheduleSettings.playoffSeedingRule, the rule
	// ESPN breaks a tie in the standings by (H2H_RECORD,
	// TOTAL_POINTS_SCORED and the like; espn-api's playoff_seed_tie_rule),
	// empty when the read carries none.
	SeedingTiebreak string
	// Divisions is the number of divisions scheduleSettings.divisions
	// lists, and DivisionsRead whether the read carries the list at all
	// (Lane 298 fix round 1). Each team's division is Team.Division.
	Divisions     int
	DivisionsRead bool
	// Schedule is every regular-season matchup of the season, past and to
	// come, from the same read's schedule (Lane 298): the matchup periods up
	// to scheduleSettings.matchupPeriodCount, each placed at its first
	// scoring period. The playoffs' brackets are left out.
	Schedule []Scheduled
}

// Scheduled is one regular-season matchup: its scoring period, the two
// teams (Away 0 for a team ESPN gives no opponent), each side's points
// once ESPN has decided it, and whether it has.
type Scheduled struct {
	Period             int
	Home, Away         int
	HomePoints, Points float64
	// Final is a winner ESPN has decided (HOME, AWAY or TIE): the points
	// are the period's final totalPoints. Undecided, they say nothing.
	Final bool
}

// DraftState is ESPN's draftDetail: whether the league has drafted, and
// whether its draft is under way.
type DraftState struct {
	Drafted    bool
	InProgress bool
}

// Acquisition is a league's waiver settings as ESPN's mSettings answers
// them (settings.acquisitionSettings; the names espn-api's
// base_settings.py reads).
type Acquisition struct {
	// Budget is isUsingAcquisitionBudget: claims carry a bid.
	Budget bool
	// Total is acquisitionBudget, each team's budget for the season.
	Total int
	// MinimumBid is the least bid a claim may carry.
	MinimumBid int
	// Type is acquisitionType, WAIVERS_TRADITIONAL and the like.
	Type string
	// ProcessDays is waiverProcessDays, the days ESPN runs claims, as
	// ESPN names them (MONDAY ...).
	ProcessDays []string
	// Closed is an acquisitionLimit of 0: the league takes no adds (-1 is
	// no limit).
	Closed bool
	// OrderReset is waiverOrderReset: true resets the waiver order each
	// week by inverse standings, false keeps it rolling (a claim sends the
	// team to the back); nil when the read carries none.
	OrderReset *bool
}

// Team is one team, its record, owners and roster.
type Team struct {
	ID        int
	Name      string
	Owners    []string
	Wins      int
	Losses    int
	Ties      int
	PointsFor float64
	Roster    []Player
	// BudgetSpent is transactionCounter.acquisitionBudgetSpent, nil when
	// the read does not carry it.
	BudgetSpent *int
	// PointsAgainst is record.overall.pointsAgainst.
	PointsAgainst float64
	// Streak is the run of wins or losses, "W3" or "L2", empty when ESPN
	// states none (record.overall.streakType and streakLength).
	Streak string
	// WaiverRank is the team's place in the waiver order, 0 when unset.
	WaiverRank int
	// Division is the team's divisionId (Lane 298 fix round 1).
	Division int
}

// Player is one rostered player and the slot he fills.
type Player struct {
	ID       string
	Name     string
	Position string
	Team     string
	Slot     int
	// Injured is ESPN's injured reserve mark on him.
	Injured bool
	// Eligible is the lineup slots ESPN lets him fill (eligibleSlots).
	Eligible []int
	// Locked is ESPN's lineupLocked: his game has started, and no lineup
	// move may hold him.
	Locked bool
	// RosterLocked is ESPN's rosterLocked: he cannot leave the roster now.
	RosterLocked bool
	// droppable is ESPN's droppable, nil when the read does not carry it.
	droppable *bool
}

// Droppable reports whether ESPN lets the team drop him: false only when
// ESPN says so.
func (p Player) Droppable() bool { return p.droppable == nil || *p.droppable }

// Game is one matchup in the current matchup period, each side's points
// as ESPN scores them now: totalPoints once ESPN decides the matchup
// (the final), else totalPointsLive (the period in play).
type Game struct {
	Home, Away         int
	HomePoints, Points float64
	// HomeUnread and Unread say ESPN gave no score for a side under way:
	// an undecided matchup, a starter kicked off, and no live points, so
	// its 0.0 totalPoints is not a score.
	HomeUnread, Unread bool
	// HomePlayerPoints and PlayerPoints are each rostered player's points
	// for the scoring period by his id, live and final alike (Lane 79);
	// nil where the read carries no rosterForCurrentScoringPeriod for the
	// side, which then has ESPN's team total alone.
	HomePlayerPoints, PlayerPoints map[string]float64
}

// undecided is ESPN's winner for a matchup not yet decided.
const undecided = "UNDECIDED"

// wireSide is one side of a scheduled matchup. totalPoints is ESPN's
// final, 0.0 until the matchup is decided; totalPointsLive is the score
// so far, carried by mMatchupScore and mScoreboard for the current
// period alone.
type wireSide struct {
	TeamID          int      `json:"teamId"`
	TotalPoints     float64  `json:"totalPoints"`
	TotalPointsLive *float64 `json:"totalPointsLive"`
	// Current is rosterForCurrentScoringPeriod: the side's roster with
	// each player's points for the period (appliedStatTotal), carried by
	// the live views for the current period alone. The team roster's own
	// appliedStatTotal is another figure (Lane 74).
	Current *struct {
		Entries []struct {
			PlayerID        int `json:"playerId"`
			PlayerPoolEntry struct {
				AppliedStatTotal float64 `json:"appliedStatTotal"`
			} `json:"playerPoolEntry"`
		} `json:"entries"`
	} `json:"rosterForCurrentScoringPeriod"`
}

// points is the side's score as ESPN has it now, and whether ESPN gave
// one: the final once ESPN decides the matchup, else the live points
// when carried, else 0.0 for a side none of whose starters has kicked
// off (kicked is any starter lineupLocked). A side under way with no
// score sent is unread.
func (s wireSide) points(winner string, kicked bool) (float64, bool) {
	switch {
	case winner != "" && winner != undecided:
		return score(s.TotalPoints), true
	case s.TotalPointsLive != nil:
		return score(*s.TotalPointsLive), true
	}
	return 0, !kicked
}

// playerPoints is each of the team's rostered players' points for the
// period, nil where ESPN sends no roster for it. A player the period's
// roster leaves out follows the locked-starter rule: unlocked, his game
// is still to kick off and he has 0.0; locked, his points are not known
// and he is left out, never a 0.0.
func (s wireSide) playerPoints(t Team) map[string]float64 {
	if s.Current == nil {
		return nil
	}
	sent := make(map[string]float64, len(s.Current.Entries))
	for _, e := range s.Current.Entries {
		sent[strconv.Itoa(e.PlayerID)] = score(e.PlayerPoolEntry.AppliedStatTotal)
	}
	out := make(map[string]float64, len(t.Roster))
	for _, p := range t.Roster {
		if v, ok := sent[p.ID]; ok {
			out[p.ID] = v
		} else if !p.Locked {
			out[p.ID] = 0
		}
	}
	return out
}

// kickedOff is the teams with a starter whose game has started: ESPN
// locks his lineup slot (lineupLocked).
func kickedOff(teams []Team) map[int]bool {
	out := map[int]bool{}
	for _, t := range teams {
		for _, p := range t.Roster {
			if p.Locked && p.Slot != SlotBench && p.Slot != SlotReserve {
				out[t.ID] = true
			}
		}
	}
	return out
}

type wirePlayer struct {
	ID                int    `json:"id"`
	FullName          string `json:"fullName"`
	DefaultPositionID int    `json:"defaultPositionId"`
	ProTeamID         int    `json:"proTeamId"`
	InjuryStatus      string `json:"injuryStatus"`
	EligibleSlots     []int  `json:"eligibleSlots"`
	Droppable         *bool  `json:"droppable"`
}

type wireEntry struct {
	PlayerID        int    `json:"playerId"`
	LineupSlotID    int    `json:"lineupSlotId"`
	InjuryStatus    string `json:"injuryStatus"`
	PlayerPoolEntry struct {
		LineupLocked bool       `json:"lineupLocked"`
		RosterLocked bool       `json:"rosterLocked"`
		Player       wirePlayer `json:"player"`
	} `json:"playerPoolEntry"`
}

type wireFull struct {
	ID              int `json:"id"`
	SeasonID        int `json:"seasonId"`
	ScoringPeriodID int `json:"scoringPeriodId"`
	Status          struct {
		CurrentMatchupPeriod int `json:"currentMatchupPeriod"`
		FinalScoringPeriod   int `json:"finalScoringPeriod"`
	} `json:"status"`
	DraftDetail *struct {
		Drafted    bool `json:"drafted"`
		InProgress bool `json:"inProgress"`
	} `json:"draftDetail"`
	Settings struct {
		Name          string `json:"name"`
		Size          int    `json:"size"`
		DraftSettings struct {
			Date int64 `json:"date"`
		} `json:"draftSettings"`
		ScheduleSettings struct {
			MatchupPeriodCount  int              `json:"matchupPeriodCount"`
			MatchupPeriodLength int              `json:"matchupPeriodLength"`
			MatchupPeriods      map[string][]int `json:"matchupPeriods"`
			PlayoffTeamCount    int              `json:"playoffTeamCount"`
			PlayoffSeedingRule  string           `json:"playoffSeedingRule"`
			Divisions           *[]struct {
				ID int `json:"id"`
			} `json:"divisions"`
		} `json:"scheduleSettings"`
		RosterSettings struct {
			LineupSlotCounts map[string]int `json:"lineupSlotCounts"`
		} `json:"rosterSettings"`
		AcquisitionSettings wireAcquisition `json:"acquisitionSettings"`
		ScoringSettings     struct {
			ScoringItems []Item `json:"scoringItems"`
		} `json:"scoringSettings"`
	} `json:"settings"`
	Members []struct {
		ID          string `json:"id"`
		DisplayName string `json:"displayName"`
	} `json:"members"`
	Teams []struct {
		ID         int      `json:"id"`
		Name       string   `json:"name"`
		Location   string   `json:"location"`
		Nickname   string   `json:"nickname"`
		Owners     []string `json:"owners"`
		WaiverRank int      `json:"waiverRank"`
		DivisionID int      `json:"divisionId"`
		Counter    *struct {
			BudgetSpent *int `json:"acquisitionBudgetSpent"`
		} `json:"transactionCounter"`
		Record struct {
			Overall struct {
				Wins          int     `json:"wins"`
				Losses        int     `json:"losses"`
				Ties          int     `json:"ties"`
				PointsFor     float64 `json:"pointsFor"`
				PointsAgainst float64 `json:"pointsAgainst"`
				StreakLength  int     `json:"streakLength"`
				StreakType    string  `json:"streakType"`
			} `json:"overall"`
		} `json:"record"`
		Roster struct {
			Entries []wireEntry `json:"entries"`
		} `json:"roster"`
	} `json:"teams"`
	Schedule []struct {
		MatchupPeriodID int       `json:"matchupPeriodId"`
		Winner          string    `json:"winner"`
		Home            wireSide  `json:"home"`
		Away            *wireSide `json:"away"`
	} `json:"schedule"`
}

// Read is one whole read of a league for a season: rosters, settings,
// the matchups with their live scores (mMatchupScore and mScoreboard
// carry totalPointsLive for the period in play) and the teams. A nil
// cookies reads it as the public does.
func (c *Client) Read(ctx context.Context, id string, season int, cookies *Cookies) (FullLeague, error) {
	if !leagueID.MatchString(id) || season < minSeason || season > maxSeason {
		return FullLeague{}, ErrNotALink
	}
	q := url.Values{"view": {"mRoster", "mSettings", "mMatchup", "mTeam", "mDraftDetail", "mMatchupScore", "mScoreboard"}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, season, id, q.Encode())
	var wire wireFull
	err := c.fetch(ctx, path, cookies, "", func(body io.Reader) error {
		// Decoded as it streams, never held whole: a body past the limit
		// is cut short and fails to decode.
		if err := json.NewDecoder(io.LimitReader(body, maxLeagueBody)).Decode(&wire); err != nil {
			return fmt.Errorf("%w: %w", ErrMalformed, err)
		}
		return nil
	})
	if err != nil {
		return FullLeague{}, err
	}
	return checkFull(wire)
}

// Public reports whether the public reads a league in a season: its
// settings alone, read with no cookies. A refusal is a private league;
// any other failure is not known and is answered as an error, never a
// guess.
func (c *Client) Public(ctx context.Context, id string, season int) (bool, error) {
	if !leagueID.MatchString(id) || season < minSeason || season > maxSeason {
		return false, ErrNotALink
	}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?view=mSettings", c.Base, season, id)
	_, err := c.get(ctx, path, nil, maxBody)
	if errors.Is(err, ErrPrivate) {
		return false, nil
	}
	return err == nil, err
}

// get reads one address with the cookies when given. A refusal with
// cookies is ErrSignedOut, without them ErrPrivate. Its errors name a
// status, never a cookie.
func (c *Client) get(ctx context.Context, path string, cookies *Cookies, limit int64) ([]byte, error) {
	return c.getFiltered(ctx, path, cookies, limit, "")
}

// getFiltered is get with ESPN's X-Fantasy-Filter header when filter is
// set: the players read narrows by it.
func (c *Client) getFiltered(ctx context.Context, path string, cookies *Cookies, limit int64, filter string) ([]byte, error) {
	var body []byte
	err := c.fetch(ctx, path, cookies, filter, func(r io.Reader) error {
		read, err := io.ReadAll(io.LimitReader(r, limit+1))
		if err != nil {
			return fmt.Errorf("%w: body: %w", ErrUnavailable, err)
		}
		if int64(len(read)) > limit {
			return fmt.Errorf("%w: over %d bytes", ErrMalformed, limit)
		}
		body = read
		return nil
	})
	return body, err
}

// fetch reads one address with the cookies when given and the filter
// when set, handing an answered body to use while the read is open. A
// refusal with cookies is ErrSignedOut, without them ErrPrivate. Its
// errors name a status, never a cookie.
func (c *Client) fetch(ctx context.Context, path string, cookies *Cookies, filter string, use func(io.Reader) error) error {
	if c.Pace != nil {
		if err := c.Pace.Wait(ctx); err != nil {
			return fmt.Errorf("%w: %w", ErrUnavailable, err)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, leagueTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("espn: request: %w", err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	if filter != "" {
		req.Header.Set("X-Fantasy-Filter", filter)
	}
	if cookies != nil {
		req.Header.Set("Cookie", cookies.header())
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("%w: %w", ErrUnavailable, ctx.Err())
		}
		return fmt.Errorf("%w: unreachable", ErrUnavailable)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && cookies != nil:
		return ErrSignedOut
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrPrivate
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return use(resp.Body)
}

func checkFull(w wireFull) (FullLeague, error) {
	if w.ID <= 0 || len(w.Teams) == 0 || len(w.Teams) > maxTeams || len(w.Schedule) > maxSchedule || len(w.Members) > maxMembers {
		return FullLeague{}, fmt.Errorf("%w: league %d with %d teams", ErrMalformed, w.ID, len(w.Teams))
	}
	scoring, err := checkScoring(w.Settings.Name, w.Settings.ScoringSettings.ScoringItems)
	if err != nil {
		return FullLeague{}, err
	}
	l := FullLeague{
		ID: strconv.Itoa(w.ID), Name: scoring.Name, Season: w.SeasonID, ScoringPeriod: w.ScoringPeriodID,
		MatchupPeriod: w.Status.CurrentMatchupPeriod, Size: w.Settings.Size, Items: scoring.Items,
		Members: map[string]string{}, LineupSlotCount: map[int]int{}, Acquisition: acquisitionOf(w.Settings.AcquisitionSettings),
		DraftAt: draftDate(w.Settings.DraftSettings.Date), PlayoffStartWeek: playoffStart(w), PlayoffTeams: playoffTeams(w.Settings.ScheduleSettings.PlayoffTeamCount),
		FinalScoringPeriod: period(w.Status.FinalScoringPeriod), FinalRoundWeeks: finalRoundWeeks(w),
		SeedingTiebreak: bounded64(text(w.Settings.ScheduleSettings.PlayoffSeedingRule)),
	}
	if d := w.DraftDetail; d != nil {
		l.Draft = &DraftState{Drafted: d.Drafted, InProgress: d.InProgress}
	}
	for k, n := range w.Settings.RosterSettings.LineupSlotCounts {
		id, err := strconv.Atoi(k)
		if err != nil || n < 0 || n > 20 {
			return FullLeague{}, fmt.Errorf("%w: lineup slot %q", ErrMalformed, k)
		}
		if n > 0 {
			l.LineupSlotCount[id] = n
		}
	}
	for _, m := range w.Members {
		l.Members[m.ID] = text(m.DisplayName)
	}
	for _, t := range w.Teams {
		tm := team(t.ID, t.Name, t.Location, t.Nickname, t.Owners, t.Record.Overall.Wins, t.Record.Overall.Losses,
			t.Record.Overall.Ties, t.Record.Overall.PointsFor, rosterOf(t.Roster.Entries))
		if t.Counter != nil && t.Counter.BudgetSpent != nil && *t.Counter.BudgetSpent >= 0 && *t.Counter.BudgetSpent <= maxBudget {
			spent := *t.Counter.BudgetSpent
			tm.BudgetSpent = &spent
		}
		tm.PointsAgainst = score(t.Record.Overall.PointsAgainst)
		tm.Streak = streak(t.Record.Overall.StreakType, t.Record.Overall.StreakLength)
		if t.WaiverRank > 0 && t.WaiverRank <= maxTeams {
			tm.WaiverRank = t.WaiverRank
		}
		tm.Division = t.DivisionID
		l.Teams = append(l.Teams, tm)
	}
	kicked := kickedOff(l.Teams)
	byID := make(map[int]Team, len(l.Teams))
	for _, t := range l.Teams {
		byID[t.ID] = t
	}
	l.Schedule = regularSeason(w)
	if d := w.Settings.ScheduleSettings.Divisions; d != nil && len(*d) <= maxTeams {
		l.Divisions, l.DivisionsRead = len(*d), true
	}
	for _, g := range w.Schedule {
		if g.MatchupPeriodID != l.MatchupPeriod || g.Away == nil {
			continue
		}
		home, homeRead := g.Home.points(g.Winner, kicked[g.Home.TeamID])
		away, awayRead := g.Away.points(g.Winner, kicked[g.Away.TeamID])
		l.Games = append(l.Games, Game{Home: g.Home.TeamID, Away: g.Away.TeamID, HomePoints: home, Points: away, HomeUnread: !homeRead, Unread: !awayRead,
			HomePlayerPoints: g.Home.playerPoints(byID[g.Home.TeamID]), PlayerPoints: g.Away.playerPoints(byID[g.Away.TeamID])})
	}
	return l, nil
}

// regularSeason is the schedule's regular-season matchups, each at its
// matchup period's first scoring period; none when ESPN states no
// regular season (matchupPeriodCount).
func regularSeason(w wireFull) []Scheduled {
	s := w.Settings.ScheduleSettings
	if s.MatchupPeriodCount < 1 || s.MatchupPeriodCount > maxPeriod {
		return nil
	}
	length := max(s.MatchupPeriodLength, 1)
	var out []Scheduled
	for _, g := range w.Schedule {
		if g.MatchupPeriodID < 1 || g.MatchupPeriodID > s.MatchupPeriodCount {
			continue
		}
		first := (g.MatchupPeriodID-1)*length + 1
		if periods := s.MatchupPeriods[strconv.Itoa(g.MatchupPeriodID)]; len(periods) > 0 {
			first = periods[0]
		}
		if period(first) == 0 || g.Home.TeamID <= 0 {
			continue
		}
		final := g.Winner != "" && g.Winner != undecided
		game := Scheduled{Period: first, Home: g.Home.TeamID, Final: final}
		if final {
			game.HomePoints = score(g.Home.TotalPoints)
		}
		if g.Away != nil && g.Away.TeamID > 0 {
			game.Away = g.Away.TeamID
			if final {
				game.Points = score(g.Away.TotalPoints)
			}
		}
		out = append(out, game)
	}
	return out
}

// maxStreak bounds a run of wins or losses.
const maxStreak = 30

// streak is ESPN's run as "W3" or "L2", empty for none or a tie's.
func streak(kind string, length int) string {
	if length < 1 || length > maxStreak {
		return ""
	}
	switch kind {
	case "WIN":
		return "W" + strconv.Itoa(length)
	case "LOSS":
		return "L" + strconv.Itoa(length)
	}
	return ""
}

func team(id int, name, location, nickname string, owners []string, w, lo, ti int, pf float64, roster []Player) Team {
	if strings.TrimSpace(name) == "" {
		name = strings.TrimSpace(location + " " + nickname)
	}
	return Team{ID: id, Name: text(name), Owners: owners, Wins: w, Losses: lo, Ties: ti, PointsFor: score(pf), Roster: roster}
}

func rosterOf(entries []wireEntry) []Player {
	out := []Player{}
	for i, e := range entries {
		if i >= maxRoster {
			break
		}
		p := e.PlayerPoolEntry.Player
		id := e.PlayerID
		if id == 0 {
			id = p.ID
		}
		out = append(out, Player{
			ID: strconv.Itoa(id), Name: text(p.FullName), Position: positions[p.DefaultPositionID], Team: proTeams[p.ProTeamID],
			Slot: e.LineupSlotID, Injured: e.InjuryStatus == "INJURY_RESERVE" || p.InjuryStatus == "INJURY_RESERVE",
			Eligible: eligible(p.EligibleSlots), Locked: e.PlayerPoolEntry.LineupLocked,
			RosterLocked: e.PlayerPoolEntry.RosterLocked, droppable: p.Droppable,
		})
	}
	return out
}

// maxEligible bounds one player's eligible slots: ESPN has 25 slot ids.
const maxEligible = 32

// eligible is a player's eligible slots, bounded.
func eligible(in []int) []int {
	if len(in) > maxEligible {
		in = in[:maxEligible]
	}
	return append([]int(nil), in...)
}

func text(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > maxNameRunes {
		r = r[:maxNameRunes]
	}
	return string(r)
}

func score(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > maxScore {
		return 0
	}
	return math.Round(v*100) / 100
}

// MyLeague is one of the member's football leagues, as ESPN's fan API
// lists their teams.
type MyLeague struct {
	LeagueID string
	Season   int
	Name     string
	TeamName string
	Teams    int
}

// wholeNumber is a JSON number or a numeric string holding a whole
// number, as the fan API may send either. Anything else reads as 0, which
// every caller treats as absent, so the entry is skipped and nothing is
// invented.
type wholeNumber int

func (n *wholeNumber) UnmarshalJSON(b []byte) error {
	*n = 0
	raw := strings.Trim(string(b), `"`)
	if v, err := strconv.Atoi(raw); err == nil {
		*n = wholeNumber(v)
	}
	return nil
}

type wireFan struct {
	Preferences []struct {
		MetaData struct {
			Entry struct {
				Abbrev        string                    `json:"abbrev"`
				SeasonID      wholeNumber               `json:"seasonId"`
				EntryLocation string                    `json:"entryLocation"`
				EntryNickname string                    `json:"entryNickname"`
				EntryMetadata struct{ TeamName string } `json:"entryMetadata"`
				Groups        []struct {
					GroupID   wholeNumber `json:"groupId"`
					GroupName string      `json:"groupName"`
					GroupSize wholeNumber `json:"groupSize"`
				} `json:"groups"`
			} `json:"entry"`
		} `json:"metaData"`
	} `json:"preferences"`
}

// MyLeagues is the member's football leagues in a season, read from the
// fan API with their cookies.
func (c *Client) MyLeagues(ctx context.Context, cookies Cookies, season int) ([]MyLeague, error) {
	if !cookies.Valid() {
		return nil, ErrSignedOut
	}
	fan := c.FanBase
	if fan == "" {
		fan = FanBase
	}
	path := fan + "/apis/v2/fans/" + url.PathEscape(cookies.SWID) + "?" + url.Values{
		"displayEvents": {"false"}, "displayNow": {"false"}, "displayRecs": {"false"}, "context": {"fantasy"},
		"source": {"espncom-fantasy"}, "lang": {"en"}, "section": {"espn"}, "region": {"us"},
	}.Encode()
	body, err := c.get(ctx, path, &cookies, maxBody)
	if err != nil {
		return nil, err
	}
	return ParseMyLeagues(body, season)
}

// ParseMyLeagues reads the fan API's answer into the football leagues of
// the season, each once.
func ParseMyLeagues(body []byte, season int) ([]MyLeague, error) {
	var wire wireFan
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	out := []MyLeague{}
	seen := map[string]bool{}
	for _, p := range wire.Preferences {
		e := p.MetaData.Entry
		if !strings.EqualFold(e.Abbrev, "ffl") || int(e.SeasonID) != season || len(e.Groups) == 0 || len(out) >= maxMyLeagues {
			continue
		}
		g := e.Groups[0]
		id := strconv.Itoa(int(g.GroupID))
		if g.GroupID <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		teamName := strings.TrimSpace(e.EntryLocation + " " + e.EntryNickname)
		if e.EntryMetadata.TeamName != "" {
			teamName = e.EntryMetadata.TeamName
		}
		out = append(out, MyLeague{LeagueID: id, Season: season, Name: text(g.GroupName), TeamName: text(teamName), Teams: min(max(int(g.GroupSize), 0), maxTeams)})
	}
	return out, nil
}
