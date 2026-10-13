package sleeper

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Draft types and states as Sleeper names them.
const (
	TypeSnake   = "snake"
	TypeAuction = "auction"
	TypeLinear  = "linear"

	StatusPreDraft = "pre_draft"
	StatusDrafting = "drafting"
	StatusPaused   = "paused"
	StatusComplete = "complete"
)

// Bounds every answer is held to.
const (
	maxTeams    = 32
	maxRounds   = 50
	maxSlots    = 60
	maxNameLen  = 80
	maxTextLen  = 40
	maxScoring  = 200
	maxPosition = 60
)

var playerIDPattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,16}$`)

// Draft is a draft's settings and state, checked.
type Draft struct {
	ID       string
	Type     string
	Status   string
	LeagueID string
	// ScoringType is metadata.scoring_type: "ppr", "half_ppr", "std",
	// "2qb", "dynasty_ppr" and the like.
	ScoringType string
	Name        string
	Teams       int
	Rounds      int
	// ReversalRound is the round a third-round reversal starts, 0 for none.
	ReversalRound int
	// Slots is every slots_* setting by its key ("slots_qb": 1).
	Slots map[string]int
	// Order is user id to draft slot, empty before the order is set.
	Order map[string]int
	// SlotRoster is draft slot to roster id.
	SlotRoster map[int]int
}

// Pick is one pick on the host, checked.
type Pick struct {
	PickNo   int
	Round    int
	Slot     int
	RosterID int
	PlayerID string
	Keeper   bool
	Name     string
	Position string
	Team     string
}

// League is a league's scoring and roster, checked.
type League struct {
	ID              string
	Name            string
	Scoring         map[string]float64
	RosterPositions []string
}

type wireDraft struct {
	DraftID      string                     `json:"draft_id"`
	Type         string                     `json:"type"`
	Status       string                     `json:"status"`
	LeagueID     *string                    `json:"league_id"`
	Settings     map[string]json.RawMessage `json:"settings"`
	DraftOrder   map[string]int             `json:"draft_order"`
	SlotToRoster map[string]int             `json:"slot_to_roster_id"`
	Metadata     map[string]any             `json:"metadata"`
}

func intSetting(raw json.RawMessage) (int, bool) {
	var n json.Number
	if json.Unmarshal(raw, &n) != nil {
		return 0, false
	}
	v, err := strconv.Atoi(n.String())
	return v, err == nil
}

func text(m map[string]any, key string) string {
	s, _ := m[key].(string)
	if utf8.RuneCountInString(s) > maxNameLen {
		return ""
	}
	return s
}

func malformed(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrMalformed}, args...)...)
}

func (w wireDraft) validate(id string) (Draft, error) {
	if w.DraftID != id {
		return Draft{}, malformed("draft id %q for %q", w.DraftID, id)
	}
	d := Draft{
		ID: id, Type: w.Type, Status: w.Status, ScoringType: text(w.Metadata, "scoring_type"), Name: text(w.Metadata, "name"),
		Slots: map[string]int{}, Order: map[string]int{}, SlotRoster: map[int]int{},
	}
	switch d.Type {
	case TypeSnake, TypeAuction, TypeLinear:
	default:
		return Draft{}, malformed("draft type %q", d.Type)
	}
	switch d.Status {
	case StatusPreDraft, StatusDrafting, StatusPaused, StatusComplete:
	default:
		return Draft{}, malformed("draft status %q", d.Status)
	}
	if w.LeagueID != nil && *w.LeagueID != "" && *w.LeagueID != "0" {
		if !ValidID(*w.LeagueID) {
			return Draft{}, malformed("league id %q", *w.LeagueID)
		}
		d.LeagueID = *w.LeagueID
	}
	if len(w.Settings) > maxSlots*2 {
		return Draft{}, malformed("%d settings", len(w.Settings))
	}
	for key, raw := range w.Settings {
		n, ok := intSetting(raw)
		switch {
		case key == "teams" && ok:
			d.Teams = n
		case key == "rounds" && ok:
			d.Rounds = n
		case key == "reversal_round" && ok:
			d.ReversalRound = n
		case strings.HasPrefix(key, "slots_") && ok:
			if n < 0 || n > maxSlots {
				return Draft{}, malformed("%s = %d", key, n)
			}
			d.Slots[key] = n
		}
	}
	if d.Teams < 2 || d.Teams > maxTeams || d.Rounds < 1 || d.Rounds > maxRounds || d.ReversalRound < 0 {
		return Draft{}, malformed("%d teams, %d rounds, reversal %d", d.Teams, d.Rounds, d.ReversalRound)
	}
	for user, slot := range w.DraftOrder {
		if !ValidID(user) || slot < 1 || slot > d.Teams {
			return Draft{}, malformed("draft order %q at %d", user, slot)
		}
		d.Order[user] = slot
	}
	for slot, roster := range w.SlotToRoster {
		n, err := strconv.Atoi(slot)
		if err != nil || n < 1 || n > d.Teams || roster < 0 || roster > maxTeams*2 {
			return Draft{}, malformed("slot %q to roster %d", slot, roster)
		}
		d.SlotRoster[n] = roster
	}
	return d, nil
}

type wirePick struct {
	PickNo   int            `json:"pick_no"`
	Round    int            `json:"round"`
	Slot     int            `json:"draft_slot"`
	RosterID *int           `json:"roster_id"`
	PlayerID string         `json:"player_id"`
	IsKeeper *bool          `json:"is_keeper"`
	Metadata map[string]any `json:"metadata"`
}

func validatePicks(w []wirePick, teams, rounds int) ([]Pick, error) {
	total := teams * rounds
	if len(w) > total {
		return nil, malformed("%d picks in a %d-pick draft", len(w), total)
	}
	seen := make(map[int]bool, len(w))
	out := make([]Pick, 0, len(w))
	for _, p := range w {
		switch {
		case p.PickNo < 1 || p.PickNo > total || seen[p.PickNo]:
			return nil, malformed("pick %d", p.PickNo)
		case p.Round < 1 || p.Round > rounds || p.Slot < 1 || p.Slot > teams:
			return nil, malformed("pick %d at round %d, slot %d", p.PickNo, p.Round, p.Slot)
		case !playerIDPattern.MatchString(p.PlayerID):
			return nil, malformed("pick %d player %q", p.PickNo, p.PlayerID)
		}
		seen[p.PickNo] = true
		pick := Pick{
			PickNo: p.PickNo, Round: p.Round, Slot: p.Slot, PlayerID: p.PlayerID,
			Keeper: p.IsKeeper != nil && *p.IsKeeper, Position: strings.ToUpper(text(p.Metadata, "position")),
			Team: strings.ToUpper(text(p.Metadata, "team")),
			Name: strings.TrimSpace(text(p.Metadata, "first_name") + " " + text(p.Metadata, "last_name")),
		}
		if p.RosterID != nil {
			pick.RosterID = *p.RosterID
		}
		if len(pick.Position) > maxTextLen || len(pick.Team) > maxTextLen {
			return nil, malformed("pick %d position %q team %q", p.PickNo, pick.Position, pick.Team)
		}
		out = append(out, pick)
	}
	return out, nil
}

type wireLeague struct {
	LeagueID        string             `json:"league_id"`
	Name            string             `json:"name"`
	ScoringSettings map[string]float64 `json:"scoring_settings"`
	RosterPositions []string           `json:"roster_positions"`
}

func (w wireLeague) validate(id string) (League, error) {
	if w.LeagueID != id {
		return League{}, malformed("league id %q for %q", w.LeagueID, id)
	}
	if len(w.ScoringSettings) > maxScoring || len(w.RosterPositions) > maxPosition {
		return League{}, malformed("%d scoring settings, %d roster positions", len(w.ScoringSettings), len(w.RosterPositions))
	}
	name := w.Name
	if utf8.RuneCountInString(name) > maxNameLen {
		name = ""
	}
	return League{ID: id, Name: name, Scoring: w.ScoringSettings, RosterPositions: w.RosterPositions}, nil
}
