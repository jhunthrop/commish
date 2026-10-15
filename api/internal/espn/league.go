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
	"strconv"
	"strings"
)

// A whole league read (the rosters, settings, matchups and teams views)
// is bigger than a settings read: a season's schedule rides with it.
const (
	maxLeagueBody = 8 << 20
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

// Game is one matchup in the current matchup period.
type Game struct {
	Home, Away         int
	HomePoints, Points float64
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
	} `json:"status"`
	Settings struct {
		Name           string `json:"name"`
		Size           int    `json:"size"`
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
		ID       int      `json:"id"`
		Name     string   `json:"name"`
		Location string   `json:"location"`
		Nickname string   `json:"nickname"`
		Owners   []string `json:"owners"`
		Counter  *struct {
			BudgetSpent *int `json:"acquisitionBudgetSpent"`
		} `json:"transactionCounter"`
		Record struct {
			Overall struct {
				Wins      int     `json:"wins"`
				Losses    int     `json:"losses"`
				Ties      int     `json:"ties"`
				PointsFor float64 `json:"pointsFor"`
			} `json:"overall"`
		} `json:"record"`
		Roster struct {
			Entries []wireEntry `json:"entries"`
		} `json:"roster"`
	} `json:"teams"`
	Schedule []struct {
		MatchupPeriodID int `json:"matchupPeriodId"`
		Home            struct {
			TeamID      int     `json:"teamId"`
			TotalPoints float64 `json:"totalPoints"`
		} `json:"home"`
		Away *struct {
			TeamID      int     `json:"teamId"`
			TotalPoints float64 `json:"totalPoints"`
		} `json:"away"`
	} `json:"schedule"`
}

// Read is one whole read of a league for a season: rosters, settings,
// the matchups and the teams. A nil cookies reads it as the public does.
func (c *Client) Read(ctx context.Context, id string, season int, cookies *Cookies) (FullLeague, error) {
	if !leagueID.MatchString(id) || season < minSeason || season > maxSeason {
		return FullLeague{}, ErrNotALink
	}
	q := url.Values{"view": {"mRoster", "mSettings", "mMatchup", "mTeam"}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, season, id, q.Encode())
	body, err := c.get(ctx, path, cookies, maxLeagueBody)
	if err != nil {
		return FullLeague{}, err
	}
	var wire wireFull
	if err := json.Unmarshal(body, &wire); err != nil {
		return FullLeague{}, fmt.Errorf("%w: %w", ErrMalformed, err)
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
	if c.Pace != nil {
		if err := c.Pace.Wait(ctx); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrUnavailable, err)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, leagueTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, fmt.Errorf("espn: request: %w", err)
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
			return nil, fmt.Errorf("%w: %w", ErrUnavailable, ctx.Err())
		}
		return nil, fmt.Errorf("%w: unreachable", ErrUnavailable)
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && cookies != nil:
		return nil, ErrSignedOut
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, ErrPrivate
	case resp.StatusCode == http.StatusNotFound:
		return nil, ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("%w: body: %w", ErrUnavailable, err)
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("%w: over %d bytes", ErrMalformed, limit)
	}
	return body, nil
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
		l.Teams = append(l.Teams, tm)
	}
	for _, g := range w.Schedule {
		if g.MatchupPeriodID != l.MatchupPeriod || g.Away == nil {
			continue
		}
		l.Games = append(l.Games, Game{Home: g.Home.TeamID, Away: g.Away.TeamID, HomePoints: score(g.Home.TotalPoints), Points: score(g.Away.TotalPoints)})
	}
	return l, nil
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
