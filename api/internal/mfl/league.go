package mfl

import (
	"context"
	"strings"
)

// League is a league's setup, checked.
type League struct {
	ID         string
	Season     int
	Name       string
	Franchises []Franchise
	// Starters is the lineup: how many start, and each position's range.
	Starters       int
	StarterLimits  []PositionLimit
	RosterSize     int
	InjuredReserve int
	TaxiSquad      int
}

// Franchise is one team in a league.
type Franchise struct {
	ID   int
	Name string
}

// PositionLimit is how many of a position start: "2-3" is Min 2, Max 3.
type PositionLimit struct {
	Position string
	Min, Max int
}

type wireLeague struct {
	League struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		BaseURL    string `json:"baseURL"`
		RosterSize string `json:"rosterSize"`
		IR         string `json:"injuredReserve"`
		Taxi       string `json:"taxiSquad"`
		Franchises struct {
			Franchise list[struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			}] `json:"franchise"`
		} `json:"franchises"`
		Starters struct {
			Count    string `json:"count"`
			Position list[struct {
				Name  string `json:"name"`
				Limit string `json:"limit"`
			}] `json:"position"`
		} `json:"starters"`
	} `json:"league"`
}

// League reads a league's setup, and learns which server it lives on.
func (c *Client) League(ctx context.Context, season int, id string) (League, error) {
	var w wireLeague
	if err := c.export(ctx, season, id, "league", nil, maxBody, &w); err != nil {
		return League{}, err
	}
	l, err := w.validate(season, id)
	if err == nil {
		c.learnServer(id, w.League.BaseURL)
	}
	return l, err
}

// DecodeLeague checks a recorded league export.
func DecodeLeague(body []byte, season int, id string) (League, error) {
	var w wireLeague
	if err := decode(body, &w); err != nil {
		return League{}, err
	}
	return w.validate(season, id)
}

func (w wireLeague) validate(season int, id string) (League, error) {
	l := w.League
	if l.ID != id {
		return League{}, malformed("league id %q for %q", l.ID, id)
	}
	out := League{ID: id, Season: season, Name: cleanText(l.Name, maxNameLen)}
	var ok1, ok2, ok3, ok4 bool
	out.RosterSize, ok1 = count(l.RosterSize, maxRoster)
	out.InjuredReserve, ok2 = count(l.IR, maxRoster)
	out.TaxiSquad, ok3 = count(l.Taxi, maxRoster)
	out.Starters, ok4 = count(l.Starters.Count, maxRoster)
	if !ok1 || !ok2 || !ok3 || !ok4 || len(l.Franchises.Franchise) > maxTeams || len(l.Starters.Position) > maxShortText {
		return League{}, malformed("league %s setup", id)
	}
	for _, f := range l.Franchises.Franchise {
		n, ok := franchiseNumber(f.ID)
		if !ok {
			return League{}, malformed("franchise %q", f.ID)
		}
		out.Franchises = append(out.Franchises, Franchise{ID: n, Name: cleanText(f.Name, maxNameLen)})
	}
	for _, p := range l.Starters.Position {
		limit, ok := parseLimit(p.Name, p.Limit)
		if !ok {
			return League{}, malformed("starter limit %q %q", p.Name, p.Limit)
		}
		out.StarterLimits = append(out.StarterLimits, limit)
	}
	return out, nil
}

func parseLimit(position, limit string) (PositionLimit, bool) {
	if position == "" || len(position) > maxShortText {
		return PositionLimit{}, false
	}
	lo, hi, found := strings.Cut(limit, "-")
	if !found {
		hi = lo
	}
	minN, ok1 := count(lo, maxRoster)
	maxN, ok2 := count(hi, maxRoster)
	if !ok1 || !ok2 || maxN < minN {
		return PositionLimit{}, false
	}
	return PositionLimit{Position: position, Min: minN, Max: maxN}, true
}

// Roster is one franchise's players, checked.
type Roster struct {
	Franchise int
	// Players is every player on the active roster; Reserve and Taxi are
	// the injured reserve and taxi squad.
	Players []string
	Reserve []string
	Taxi    []string
}

type wirePlayerStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type wireRosters struct {
	Rosters struct {
		Franchise list[struct {
			ID     string                 `json:"id"`
			Player list[wirePlayerStatus] `json:"player"`
		}] `json:"franchise"`
	} `json:"rosters"`
}

// Rosters reads every franchise's roster.
func (c *Client) Rosters(ctx context.Context, season int, id string) ([]Roster, error) {
	var w wireRosters
	if err := c.export(ctx, season, id, "rosters", nil, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeRosters checks a recorded rosters export.
func DecodeRosters(body []byte) ([]Roster, error) {
	var w wireRosters
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wireRosters) validate() ([]Roster, error) {
	if len(w.Rosters.Franchise) > maxTeams {
		return nil, malformed("%d rosters", len(w.Rosters.Franchise))
	}
	out := make([]Roster, 0, len(w.Rosters.Franchise))
	for _, f := range w.Rosters.Franchise {
		n, ok := franchiseNumber(f.ID)
		if !ok || len(f.Player) > maxRoster {
			return nil, malformed("roster %q", f.ID)
		}
		r := Roster{Franchise: n}
		for _, p := range f.Player {
			if !playerIDPattern.MatchString(p.ID) {
				return nil, malformed("roster %q player %q", f.ID, p.ID)
			}
			switch p.Status {
			case "INJURED_RESERVE":
				r.Reserve = append(r.Reserve, p.ID)
			case "TAXI_SQUAD":
				r.Taxi = append(r.Taxi, p.ID)
			default:
				r.Players = append(r.Players, p.ID)
			}
		}
		out = append(out, r)
	}
	return out, nil
}

// Rule is one scoring rule as the league states it: the event code, the
// range it applies over, and its points ("*0.04" per unit, or a flat
// figure for a value inside the range).
type Rule struct {
	Positions string
	Event     string
	Range     string
	Points    string
}

type wireRules struct {
	Rules struct {
		PositionRules list[struct {
			Positions string `json:"positions"`
			Rule      list[struct {
				Event  text `json:"event"`
				Range  text `json:"range"`
				Points text `json:"points"`
			}] `json:"rule"`
		}] `json:"positionRules"`
	} `json:"rules"`
}

// Rules reads a league's scoring rules.
func (c *Client) Rules(ctx context.Context, season int, id string) ([]Rule, error) {
	var w wireRules
	if err := c.export(ctx, season, id, "rules", nil, maxBody, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodeRules checks a recorded rules export.
func DecodeRules(body []byte) ([]Rule, error) {
	var w wireRules
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

func (w wireRules) validate() ([]Rule, error) {
	var out []Rule
	for _, group := range w.Rules.PositionRules {
		if len(group.Positions) > maxShortText {
			return nil, malformed("rule positions %q", group.Positions)
		}
		for _, r := range group.Rule {
			rule := Rule{Positions: group.Positions, Event: r.Event.T, Range: r.Range.T, Points: r.Points.T}
			if len(rule.Event) > maxShortText || len(rule.Range) > maxShortText || len(rule.Points) > maxShortText {
				return nil, malformed("rule %q", rule.Event)
			}
			out = append(out, rule)
			if len(out) > maxRules {
				return nil, malformed("over %d rules", maxRules)
			}
		}
	}
	return out, nil
}
