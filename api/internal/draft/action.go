package draft

import (
	"encoding/json"
	"fmt"
)

// ActionType names an action.
type ActionType string

// The action set.
const (
	StartDraft  ActionType = "START_DRAFT"
	SetQueue    ActionType = "SET_QUEUE"
	MakePick    ActionType = "MAKE_PICK"
	Nominate    ActionType = "NOMINATE"
	Bid         ActionType = "BID"
	TimerExpire ActionType = "TIMER_EXPIRE"
)

// ActionVersion is the persisted shape's version; a row with another v is refused.
const ActionVersion = 1

// Action is one entry of the log. Which fields are set depends on Type,
// exactly as the TypeScript union (src/domain/draft.ts) has them.
type Action struct {
	Type      ActionType
	Timestamp string

	// START_DRAFT.
	DraftOrder []string
	Pool       []PoolEntry
	MinBid     int
	SkipPolicy *SkipPolicy
	Autopick   *AutopickPolicy

	// MAKE_PICK, NOMINATE, BID, SET_QUEUE.
	TeamID string
	// MAKE_PICK, NOMINATE.
	PlayerID string
	// NOMINATE.
	OpeningBid int
	// BID.
	Amount int
	// SET_QUEUE, best first; empty clears the queue.
	PlayerIDs []string
}

// NewMakePick is a MAKE_PICK.
func NewMakePick(timestamp, teamID, playerID string) Action {
	return Action{Type: MakePick, Timestamp: timestamp, TeamID: teamID, PlayerID: playerID}
}

// NewTimerExpire is a TIMER_EXPIRE.
func NewTimerExpire(timestamp string) Action {
	return Action{Type: TimerExpire, Timestamp: timestamp}
}

// NewSetQueue is a SET_QUEUE.
func NewSetQueue(timestamp, teamID string, playerIDs []string) Action {
	return Action{Type: SetQueue, Timestamp: timestamp, TeamID: teamID, PlayerIDs: append([]string{}, playerIDs...)}
}

// wire is the JSON shape of every action type at once.
type wire struct {
	V          *int            `json:"v,omitempty"`
	Type       ActionType      `json:"type"`
	Timestamp  string          `json:"timestamp"`
	DraftOrder []string        `json:"draftOrder,omitempty"`
	Pool       []wireEntry     `json:"pool,omitempty"`
	MinBid     *int            `json:"minBid,omitempty"`
	SkipPolicy *SkipPolicy     `json:"skipPolicy,omitempty"`
	Autopick   *AutopickPolicy `json:"autopick,omitempty"`
	TeamID     *string         `json:"teamId,omitempty"`
	PlayerID   *string         `json:"playerId,omitempty"`
	OpeningBid *int            `json:"openingBid,omitempty"`
	Amount     *int            `json:"amount,omitempty"`
	PlayerIDs  *[]string       `json:"playerIds,omitempty"`
}

type wireEntry struct {
	PlayerID             string   `json:"playerId"`
	Position             Position `json:"position"`
	ExcludedFromAutopick *bool    `json:"excludedFromAutopick,omitempty"`
}

// MarshalJSON writes the action in the persisted shape, v included.
func (a Action) MarshalJSON() ([]byte, error) {
	v := ActionVersion
	w := wire{V: &v, Type: a.Type, Timestamp: a.Timestamp}
	switch a.Type {
	case StartDraft:
		minBid := a.MinBid
		w.DraftOrder, w.MinBid, w.SkipPolicy, w.Autopick = a.DraftOrder, &minBid, a.SkipPolicy, a.Autopick
		w.Pool = make([]wireEntry, len(a.Pool))
		for i, e := range a.Pool {
			w.Pool[i] = wireEntry{PlayerID: e.PlayerID, Position: e.Position}
			if e.ExcludedFromAutopick {
				t := true
				w.Pool[i].ExcludedFromAutopick = &t
			}
		}
	case MakePick:
		w.TeamID, w.PlayerID = &a.TeamID, &a.PlayerID
	case Nominate:
		w.TeamID, w.PlayerID, w.OpeningBid = &a.TeamID, &a.PlayerID, &a.OpeningBid
	case Bid:
		w.TeamID, w.Amount = &a.TeamID, &a.Amount
	case SetQueue:
		ids := append([]string{}, a.PlayerIDs...)
		w.TeamID, w.PlayerIDs = &a.TeamID, &ids
	case TimerExpire:
	default:
		return nil, fmt.Errorf("draft: unknown action type %q", a.Type)
	}
	return json.Marshal(w)
}

// ParseAction validates a persisted row the way draftActionSchema does:
// version 1, a known type, a strict ISO timestamp, the fields that type
// needs and nothing malformed. A row written by an earlier process is
// checked, never trusted.
func ParseAction(raw []byte) (Action, error) {
	var w wire
	if err := json.Unmarshal(raw, &w); err != nil {
		return Action{}, fmt.Errorf("draft: action: %w", err)
	}
	if w.V == nil || *w.V != ActionVersion {
		return Action{}, fmt.Errorf("draft: action version must be %d", ActionVersion)
	}
	if !validTimestamp(w.Timestamp) {
		return Action{}, fmt.Errorf("draft: action timestamp %q is not an ISO datetime", w.Timestamp)
	}
	a := Action{Type: w.Type, Timestamp: w.Timestamp}
	var err error
	switch w.Type {
	case StartDraft:
		err = parseStart(w, &a)
	case MakePick:
		a.TeamID, err = required("teamId", w.TeamID)
		if err == nil {
			a.PlayerID, err = required("playerId", w.PlayerID)
		}
	case Nominate:
		err = parseNominate(w, &a)
	case Bid:
		a.TeamID, err = required("teamId", w.TeamID)
		if err == nil {
			a.Amount, err = dollars("amount", w.Amount)
		}
	case SetQueue:
		err = parseSetQueue(w, &a)
	case TimerExpire:
	default:
		err = fmt.Errorf("draft: unknown action type %q", w.Type)
	}
	if err != nil {
		return Action{}, err
	}
	return a, nil
}

func required(field string, v *string) (string, error) {
	if v == nil || *v == "" {
		return "", fmt.Errorf("draft: action needs a non-empty %s", field)
	}
	return *v, nil
}

func dollars(field string, v *int) (int, error) {
	if v == nil || *v <= 0 {
		return 0, fmt.Errorf("draft: action needs a positive whole %s", field)
	}
	return *v, nil
}

func parseStart(w wire, a *Action) error {
	if len(w.DraftOrder) < 2 {
		return fmt.Errorf("draft: START_DRAFT needs at least two teams")
	}
	for _, id := range w.DraftOrder {
		if id == "" {
			return fmt.Errorf("draft: START_DRAFT team ids are non-empty")
		}
	}
	if len(w.Pool) < 1 {
		return fmt.Errorf("draft: START_DRAFT needs a pool")
	}
	a.DraftOrder = append([]string{}, w.DraftOrder...)
	a.Pool = make([]PoolEntry, len(w.Pool))
	for i, e := range w.Pool {
		if e.PlayerID == "" || !e.Position.Valid() {
			return fmt.Errorf("draft: START_DRAFT pool entry %d is malformed", i)
		}
		if e.ExcludedFromAutopick != nil && !*e.ExcludedFromAutopick {
			return fmt.Errorf("draft: START_DRAFT pool entry %d: excludedFromAutopick is only ever true", i)
		}
		a.Pool[i] = PoolEntry{PlayerID: e.PlayerID, Position: e.Position, ExcludedFromAutopick: e.ExcludedFromAutopick != nil}
	}
	a.MinBid = AuctionMinBid
	if w.MinBid != nil {
		if *w.MinBid <= 0 {
			return fmt.Errorf("draft: START_DRAFT minBid must be positive")
		}
		a.MinBid = *w.MinBid
	}
	if p := w.SkipPolicy; p != nil && (p.MaxOwedPerTeam <= 0 || p.AppliesAtOrAbovePickSeconds <= 0) {
		return fmt.Errorf("draft: START_DRAFT skipPolicy values must be positive")
	}
	if err := validAutopick(w.Autopick); err != nil {
		return err
	}
	a.SkipPolicy, a.Autopick = w.SkipPolicy, w.Autopick
	return nil
}

func validAutopick(p *AutopickPolicy) error {
	if p == nil {
		return nil
	}
	switch {
	case p.Temperature <= 0, p.NeedPerOpenStartingSlot < 0, p.StartersFilledDamp <= 0, p.RampFullAtRosterFraction <= 0:
		return fmt.Errorf("draft: START_DRAFT autopick dials are out of range")
	case p.SurplusDamp != nil && (*p.SurplusDamp <= 0 || *p.SurplusDamp > 1):
		return fmt.Errorf("draft: START_DRAFT autopick surplusDamp is in (0, 1]")
	case p.LateRoundOnlyRoundsFromEnd != nil && *p.LateRoundOnlyRoundsFromEnd <= 0:
		return fmt.Errorf("draft: START_DRAFT autopick lateRoundOnlyRoundsFromEnd is positive")
	case p.RosterCeilings != nil && p.RosterCeilings.BackupsAtSingleStarterPosition < 0:
		return fmt.Errorf("draft: START_DRAFT autopick backups are never negative")
	}
	return nil
}

func parseNominate(w wire, a *Action) error {
	var err error
	if a.TeamID, err = required("teamId", w.TeamID); err != nil {
		return err
	}
	if a.PlayerID, err = required("playerId", w.PlayerID); err != nil {
		return err
	}
	a.OpeningBid, err = dollars("openingBid", w.OpeningBid)
	return err
}

func parseSetQueue(w wire, a *Action) error {
	var err error
	if a.TeamID, err = required("teamId", w.TeamID); err != nil {
		return err
	}
	if w.PlayerIDs == nil {
		return fmt.Errorf("draft: SET_QUEUE needs playerIds")
	}
	if len(*w.PlayerIDs) > PersistedQueueMax {
		return fmt.Errorf("draft: SET_QUEUE holds at most %d players", PersistedQueueMax)
	}
	for _, id := range *w.PlayerIDs {
		if id == "" {
			return fmt.Errorf("draft: SET_QUEUE player ids are non-empty")
		}
	}
	a.PlayerIDs = append([]string{}, *w.PlayerIDs...)
	return nil
}
