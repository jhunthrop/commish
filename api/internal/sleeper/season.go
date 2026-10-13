package sleeper

import (
	"context"
	"encoding/json"
	"strconv"
)

// The league's in-season reads (Lane 11): rosters, matchups by week,
// transactions by week and the NFL state, each checked like the draft
// reads before anything else sees it.

// Bounds on a league's season answers.
const (
	maxWeek            = 25
	maxRosterPlayers   = 120
	maxTransactions    = 1000
	maxMatchupPoints   = 1000
	maxTransactionKind = 20
)

// Roster is one team in a league, checked.
type Roster struct {
	RosterID int
	OwnerID  string
	CoOwners []string
	Players  []string
	Starters []string
	Reserve  []string
	Taxi     []string
	Wins     int
	Losses   int
	Ties     int
	// PointsFor is the season's points so far.
	PointsFor float64
}

// Matchup is one team's side of a week's matchup, checked.
type Matchup struct {
	RosterID int
	// MatchupID pairs the two sides; 0 is a team with no opponent.
	MatchupID     int
	Points        float64
	Starters      []string
	StarterPoints []float64
	PlayerPoints  map[string]float64
}

// Transaction is one move in a league's week, checked.
type Transaction struct {
	Type      string
	Status    string
	RosterIDs []int
	// Adds and Drops are player id to the roster that took or let him go.
	Adds  map[string]int
	Drops map[string]int
	// Created is the host's milliseconds since the epoch.
	Created int64
}

// State is the NFL's state on the host: the season and its week.
type State struct {
	Season     int
	Week       int
	SeasonType string
}

type wireRoster struct {
	RosterID int      `json:"roster_id"`
	OwnerID  *string  `json:"owner_id"`
	CoOwners []string `json:"co_owners"`
	Players  []string `json:"players"`
	Starters []string `json:"starters"`
	Reserve  []string `json:"reserve"`
	Taxi     []string `json:"taxi"`
	Settings struct {
		Wins        int `json:"wins"`
		Losses      int `json:"losses"`
		Ties        int `json:"ties"`
		Fpts        int `json:"fpts"`
		FptsDecimal int `json:"fpts_decimal"`
	} `json:"settings"`
}

type wireMatchup struct {
	RosterID      int                `json:"roster_id"`
	MatchupID     *int               `json:"matchup_id"`
	Points        float64            `json:"points"`
	Starters      []string           `json:"starters"`
	StartersPoint []float64          `json:"starters_points"`
	PlayersPoints map[string]float64 `json:"players_points"`
}

type wireTransaction struct {
	Type      string         `json:"type"`
	Status    string         `json:"status"`
	RosterIDs []int          `json:"roster_ids"`
	Adds      map[string]int `json:"adds"`
	Drops     map[string]int `json:"drops"`
	Created   int64          `json:"created"`
}

type wireState struct {
	Season     string `json:"season"`
	Week       int    `json:"week"`
	SeasonType string `json:"season_type"`
}

// Rosters reads a league's teams.
func (c *Client) Rosters(ctx context.Context, leagueID string) ([]Roster, error) {
	if !ValidID(leagueID) {
		return nil, ErrNotFound
	}
	var w []wireRoster
	if err := c.get(ctx, "/league/"+leagueID+"/rosters", maxBody, &w); err != nil {
		return nil, err
	}
	return validateRosters(w)
}

// Matchups reads a league's matchups in one week.
func (c *Client) Matchups(ctx context.Context, leagueID string, week int) ([]Matchup, error) {
	if !ValidID(leagueID) || week < 1 || week > maxWeek {
		return nil, ErrNotFound
	}
	var w []wireMatchup
	if err := c.get(ctx, "/league/"+leagueID+"/matchups/"+strconv.Itoa(week), maxBody, &w); err != nil {
		return nil, err
	}
	return validateMatchups(w)
}

// Transactions reads a league's moves in one week.
func (c *Client) Transactions(ctx context.Context, leagueID string, week int) ([]Transaction, error) {
	if !ValidID(leagueID) || week < 1 || week > maxWeek {
		return nil, ErrNotFound
	}
	var w []wireTransaction
	if err := c.get(ctx, "/league/"+leagueID+"/transactions/"+strconv.Itoa(week), maxPicksBody, &w); err != nil {
		return nil, err
	}
	return validateTransactions(w)
}

// NFLState reads the season and week the host is on.
func (c *Client) NFLState(ctx context.Context) (State, error) {
	var w wireState
	if err := c.get(ctx, "/state/nfl", maxBody, &w); err != nil {
		return State{}, err
	}
	return w.validate()
}

// DecodeRosters checks a recorded rosters answer.
func DecodeRosters(body []byte) ([]Roster, error) {
	var w []wireRoster
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validateRosters(w)
}

// DecodeMatchups checks a recorded matchups answer.
func DecodeMatchups(body []byte) ([]Matchup, error) {
	var w []wireMatchup
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validateMatchups(w)
}

// DecodeTransactions checks a recorded transactions answer.
func DecodeTransactions(body []byte) ([]Transaction, error) {
	var w []wireTransaction
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validateTransactions(w)
}

// DecodeState checks a recorded state answer.
func DecodeState(body []byte) (State, error) {
	var w wireState
	if err := json.Unmarshal(body, &w); err != nil {
		return State{}, malformed("%v", err)
	}
	return w.validate()
}

func validPlayerIDs(ids []string, limit int) bool {
	if len(ids) > limit {
		return false
	}
	for _, id := range ids {
		// Sleeper writes an empty starter slot as "0".
		if id != "0" && !playerIDPattern.MatchString(id) {
			return false
		}
	}
	return true
}

func validateRosters(w []wireRoster) ([]Roster, error) {
	if len(w) > maxTeams {
		return nil, malformed("%d rosters", len(w))
	}
	seen := map[int]bool{}
	out := make([]Roster, 0, len(w))
	for _, r := range w {
		if r.RosterID < 1 || r.RosterID > maxTeams || seen[r.RosterID] {
			return nil, malformed("roster id %d", r.RosterID)
		}
		seen[r.RosterID] = true
		for _, ids := range [][]string{r.Players, r.Starters, r.Reserve, r.Taxi} {
			if !validPlayerIDs(ids, maxRosterPlayers) {
				return nil, malformed("roster %d players", r.RosterID)
			}
		}
		s := r.Settings
		if s.Wins < 0 || s.Losses < 0 || s.Ties < 0 || s.Wins+s.Losses+s.Ties > maxWeek || s.FptsDecimal < 0 || s.FptsDecimal > 99 {
			return nil, malformed("roster %d record", r.RosterID)
		}
		owners := make([]string, 0, len(r.CoOwners))
		for _, co := range r.CoOwners {
			if ValidID(co) && len(owners) < maxTeams {
				owners = append(owners, co)
			}
		}
		out = append(out, Roster{
			RosterID: r.RosterID, OwnerID: validOwner(r.OwnerID), CoOwners: owners, Players: r.Players,
			Starters: r.Starters, Reserve: r.Reserve, Taxi: r.Taxi, Wins: s.Wins, Losses: s.Losses, Ties: s.Ties,
			PointsFor: float64(s.Fpts) + float64(s.FptsDecimal)/100,
		})
	}
	return out, nil
}

func validOwner(id *string) string {
	if id == nil || !ValidID(*id) {
		return ""
	}
	return *id
}

func validateMatchups(w []wireMatchup) ([]Matchup, error) {
	if len(w) > maxTeams {
		return nil, malformed("%d matchups", len(w))
	}
	out := make([]Matchup, 0, len(w))
	for _, m := range w {
		if m.RosterID < 1 || m.RosterID > maxTeams || !validPlayerIDs(m.Starters, maxRosterPlayers) ||
			len(m.StartersPoint) > maxRosterPlayers || len(m.PlayersPoints) > maxRosterPlayers ||
			m.Points < -maxMatchupPoints || m.Points > maxMatchupPoints {
			return nil, malformed("matchup for roster %d", m.RosterID)
		}
		for id, pts := range m.PlayersPoints {
			if !playerIDPattern.MatchString(id) || pts < -maxMatchupPoints || pts > maxMatchupPoints {
				return nil, malformed("matchup points for %q", id)
			}
		}
		mm := Matchup{RosterID: m.RosterID, Points: m.Points, Starters: m.Starters, StarterPoints: m.StartersPoint, PlayerPoints: m.PlayersPoints}
		if m.MatchupID != nil {
			if *m.MatchupID < 0 || *m.MatchupID > maxTeams {
				return nil, malformed("matchup id %d", *m.MatchupID)
			}
			mm.MatchupID = *m.MatchupID
		}
		out = append(out, mm)
	}
	return out, nil
}

func validMoves(m map[string]int) bool {
	if len(m) > maxRosterPlayers {
		return false
	}
	for id, roster := range m {
		if !playerIDPattern.MatchString(id) || roster < 1 || roster > maxTeams {
			return false
		}
	}
	return true
}

func validateTransactions(w []wireTransaction) ([]Transaction, error) {
	if len(w) > maxTransactions {
		return nil, malformed("%d transactions", len(w))
	}
	out := make([]Transaction, 0, len(w))
	for _, t := range w {
		if len(t.Type) > maxTransactionKind || len(t.Status) > maxTransactionKind || len(t.RosterIDs) > maxTeams ||
			!validMoves(t.Adds) || !validMoves(t.Drops) || t.Created < 0 {
			return nil, malformed("transaction %q", t.Type)
		}
		for _, id := range t.RosterIDs {
			if id < 1 || id > maxTeams {
				return nil, malformed("transaction roster %d", id)
			}
		}
		out = append(out, Transaction{Type: t.Type, Status: t.Status, RosterIDs: t.RosterIDs, Adds: t.Adds, Drops: t.Drops, Created: t.Created})
	}
	return out, nil
}

func (w wireState) validate() (State, error) {
	season, err := strconv.Atoi(w.Season)
	if err != nil || season < minSeason || season > maxSeason || w.Week < 0 || w.Week > maxWeek || len(w.SeasonType) > maxTransactionKind {
		return State{}, malformed("state %q week %d", w.Season, w.Week)
	}
	return State{Season: season, Week: w.Week, SeasonType: w.SeasonType}, nil
}
