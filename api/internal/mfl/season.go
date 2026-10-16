package mfl

import (
	"context"
	"net/url"
	"strconv"
	"strings"
)

// Standing is one franchise's record, checked.
type Standing struct {
	Franchise int
	Wins      int
	Losses    int
	Ties      int
	PointsFor float64
}

type wireStandings struct {
	LeagueStandings struct {
		Franchise list[struct {
			ID string `json:"id"`
			W  string `json:"h2hw"`
			L  string `json:"h2hl"`
			T  string `json:"h2ht"`
			PF string `json:"pf"`
		}] `json:"franchise"`
	} `json:"leagueStandings"`
}

// Standings reads a league's standings.
func (c *Client) Standings(ctx context.Context, season int, id string) ([]Standing, error) {
	var w wireStandings
	if err := c.export(ctx, season, id, "leagueStandings", nil, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeStandings checks a recorded standings export.
func DecodeStandings(body []byte) ([]Standing, error) {
	var w wireStandings
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// maxGames bounds a record: a league may play two games a week.
const maxGames = maxWeek * 3

func (w wireStandings) validate() ([]Standing, error) {
	if len(w.LeagueStandings.Franchise) > maxTeams {
		return nil, malformed("%d standings", len(w.LeagueStandings.Franchise))
	}
	out := make([]Standing, 0, len(w.LeagueStandings.Franchise))
	for _, f := range w.LeagueStandings.Franchise {
		n, ok := franchiseNumber(f.ID)
		wins, ok1 := count(f.W, maxGames)
		losses, ok2 := count(f.L, maxGames)
		ties, ok3 := count(f.T, maxGames)
		pf, ok4 := number(f.PF, maxPoints*maxGames)
		if !ok || !ok1 || !ok2 || !ok3 || !ok4 {
			return nil, malformed("standing %q", f.ID)
		}
		out = append(out, Standing{Franchise: n, Wins: wins, Losses: losses, Ties: ties, PointsFor: pf})
	}
	return out, nil
}

// Side is one franchise in a week's matchup, checked: its score and its
// starters' scores.
type Side struct {
	Franchise int
	Score     float64
	Starters  []string
	// Points is each starter's score so far.
	Points map[string]float64
}

// Matchup is two sides of one game; a league may play more than one
// game a week.
type Matchup struct {
	Sides []Side
}

type wireLive struct {
	LiveScoring struct {
		Week    string `json:"week"`
		Matchup list[struct {
			Franchise list[struct {
				ID      string `json:"id"`
				Score   string `json:"score"`
				Players struct {
					Player list[struct {
						ID     string `json:"id"`
						Score  string `json:"score"`
						Status string `json:"status"`
					}] `json:"player"`
				} `json:"players"`
			}] `json:"franchise"`
		}] `json:"matchup"`
	} `json:"liveScoring"`
}

// LiveScoring reads a week's matchups with the points so far.
func (c *Client) LiveScoring(ctx context.Context, season int, id string, week int) ([]Matchup, error) {
	if week < 1 || week > maxWeek {
		return nil, ErrNotFound
	}
	var w wireLive
	args := url.Values{"W": {strconv.Itoa(week)}}
	if err := c.export(ctx, season, id, "liveScoring", args, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeLiveScoring checks a recorded live scoring export.
func DecodeLiveScoring(body []byte) ([]Matchup, error) {
	var w wireLive
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wireLive) validate() ([]Matchup, error) {
	if len(w.LiveScoring.Matchup) > maxTeams*2 {
		return nil, malformed("%d matchups", len(w.LiveScoring.Matchup))
	}
	out := make([]Matchup, 0, len(w.LiveScoring.Matchup))
	for _, m := range w.LiveScoring.Matchup {
		if len(m.Franchise) > 2 {
			return nil, malformed("a matchup of %d", len(m.Franchise))
		}
		var mm Matchup
		for _, f := range m.Franchise {
			// A league that also plays the week's average or a bye names
			// that side AVG or BYE: not a team, so no side.
			if f.ID == "AVG" || f.ID == "BYE" {
				continue
			}
			n, ok := franchiseNumber(f.ID)
			score, ok2 := number(f.Score, maxPoints)
			if !ok || !ok2 || len(f.Players.Player) > maxRoster {
				return nil, malformed("matchup side %q", f.ID)
			}
			side := Side{Franchise: n, Score: score, Points: map[string]float64{}}
			for _, p := range f.Players.Player {
				pts, ok := number(p.Score, maxPoints)
				if !playerIDPattern.MatchString(p.ID) || !ok {
					return nil, malformed("matchup player %q", p.ID)
				}
				if p.Status == "starter" {
					side.Starters = append(side.Starters, p.ID)
				}
				side.Points[p.ID] = pts
			}
			mm.Sides = append(mm.Sides, side)
		}
		out = append(out, mm)
	}
	return out, nil
}

// Transaction is one roster move, checked. Moves of other kinds (locks,
// injured reserve, waiver runs) are left out.
type Transaction struct {
	Type       string
	Franchises []int
	// Adds and Drops are player id to the franchise that took or let him go.
	Adds  map[string]int
	Drops map[string]int
	// At is seconds since the epoch.
	At int64
}

// Move kinds kept from the host's transactions.
const (
	MoveFreeAgent = "FREE_AGENT"
	MoveWaiver    = "WAIVER"
	MoveBlindBid  = "BBID_WAIVER"
	MoveTrade     = "TRADE"
)

type wireTransactions struct {
	Transactions struct {
		Transaction list[struct {
			Type        string `json:"type"`
			Franchise   string `json:"franchise"`
			Transaction string `json:"transaction"`
			Timestamp   string `json:"timestamp"`
			Franchise2  string `json:"franchise2"`
			GaveUp1     string `json:"franchise1_gave_up"`
			GaveUp2     string `json:"franchise2_gave_up"`
		}] `json:"transaction"`
	} `json:"transactions"`
}

// Transactions reads a league's moves in one week.
func (c *Client) Transactions(ctx context.Context, season int, id string, week int) ([]Transaction, error) {
	if week < 1 || week > maxWeek {
		return nil, ErrNotFound
	}
	var w wireTransactions
	args := url.Values{"W": {strconv.Itoa(week)}}
	if err := c.export(ctx, season, id, "transactions", args, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeTransactions checks a recorded transactions export.
func DecodeTransactions(body []byte) ([]Transaction, error) {
	var w wireTransactions
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wireTransactions) validate() ([]Transaction, error) {
	if len(w.Transactions.Transaction) > maxTransaction {
		return nil, malformed("%d transactions", len(w.Transactions.Transaction))
	}
	var out []Transaction
	for _, t := range w.Transactions.Transaction {
		at, err := strconv.ParseInt(strings.TrimSpace(t.Timestamp), 10, 64)
		if err != nil || at < 0 {
			return nil, malformed("transaction time %q", t.Timestamp)
		}
		move, ok, err := readMove(t.Type, t.Franchise, t.Transaction, t.Franchise2, t.GaveUp1, t.GaveUp2)
		if err != nil {
			return nil, err
		}
		if ok {
			move.At = at
			out = append(out, move)
		}
	}
	return out, nil
}

// readMove reads one move: "add,|drop," for a pickup, "add,|1.00|drop,"
// for a blind bid, and each side's gave-up list for a trade.
func readMove(kind, franchise, body, franchise2, gave1, gave2 string) (Transaction, bool, error) {
	switch kind {
	case MoveFreeAgent, MoveWaiver, MoveBlindBid:
	case MoveTrade:
		return readTrade(franchise, franchise2, gave1, gave2)
	default:
		return Transaction{}, false, nil
	}
	n, ok := franchiseNumber(franchise)
	parts := strings.Split(body, "|")
	if !ok || len(parts) < 2 || len(parts) > 3 {
		return Transaction{}, false, malformed("move %q by %q", body, franchise)
	}
	adds, ok1 := playerIDs(parts[0])
	drops, ok2 := playerIDs(parts[len(parts)-1])
	if !ok1 || !ok2 {
		return Transaction{}, false, malformed("move %q", body)
	}
	t := Transaction{Type: kind, Franchises: []int{n}, Adds: map[string]int{}, Drops: map[string]int{}}
	for _, id := range adds {
		t.Adds[id] = n
	}
	for _, id := range drops {
		t.Drops[id] = n
	}
	return t, true, nil
}

func readTrade(franchise, franchise2, gave1, gave2 string) (Transaction, bool, error) {
	a, ok1 := franchiseNumber(franchise)
	b, ok2 := franchiseNumber(franchise2)
	fromA, ok3 := playerIDs(gave1)
	fromB, ok4 := playerIDs(gave2)
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return Transaction{}, false, malformed("trade between %q and %q", franchise, franchise2)
	}
	t := Transaction{Type: MoveTrade, Franchises: []int{a, b}, Adds: map[string]int{}, Drops: map[string]int{}}
	for _, id := range fromA {
		t.Drops[id], t.Adds[id] = a, b
	}
	for _, id := range fromB {
		t.Drops[id], t.Adds[id] = b, a
	}
	return t, true, nil
}

// Status is the host's season and weeks.
type Status struct {
	Season int
	// CurrentWeek is the week lineups are set for.
	CurrentWeek int
	// LiveScoringWeek is the week whose games last scored.
	LiveScoringWeek int
	// CompletedWeek is the last week whose games are all final.
	CompletedWeek int
}

type wireStatus struct {
	Status struct {
		Weeks struct {
			Current   string `json:"CurrentWeek"`
			Live      string `json:"LiveScoringWeek"`
			Completed string `json:"CompletedWeek"`
		} `json:"weeks"`
		Year string `json:"year"`
	} `json:"mfl_status"`
}

// SeasonStatus reads the host's current season and weeks. It is not a
// league read, so it goes to the front door.
func (c *Client) SeasonStatus(ctx context.Context, season int) (Status, error) {
	if !ValidSeason(season) {
		return Status{}, ErrNotFound
	}
	base, err := c.base("")
	if err != nil {
		return Status{}, err
	}
	u := base.JoinPath("fflnetdynamic"+strconv.Itoa(season), "mfl_status.json")
	if err := c.wait(ctx, base.Host); err != nil {
		return Status{}, err
	}
	var w wireStatus
	if err := c.read(ctx, u.String(), maxBody, &w); err != nil {
		return Status{}, err
	}
	return w.validate()
}

// DecodeStatus checks a recorded status answer.
func DecodeStatus(body []byte) (Status, error) {
	var w wireStatus
	if err := decode(body, &w); err != nil {
		return Status{}, err
	}
	return w.validate()
}

func (w wireStatus) validate() (Status, error) {
	year, err := strconv.Atoi(w.Status.Year)
	current, ok1 := count(w.Status.Weeks.Current, maxWeek)
	live, ok2 := count(w.Status.Weeks.Live, maxWeek)
	completed, ok3 := count(w.Status.Weeks.Completed, maxWeek)
	if err != nil || !ValidSeason(year) || !ok1 || !ok2 || !ok3 {
		return Status{}, malformed("status %q", w.Status.Year)
	}
	return Status{Season: year, CurrentWeek: current, LiveScoringWeek: live, CompletedWeek: completed}, nil
}
