package lobby

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// The room's statuses (app.rooms.status).
const (
	StatusFilling   = "filling"
	StatusDrafting  = "drafting"
	StatusComplete  = "complete"
	StatusAbandoned = "abandoned"
)

// The room's own log kinds; the engine's actions log under their own type.
const (
	KindSeatJoined   = "SEAT_JOINED"
	KindSeatLeft     = "SEAT_LEFT"
	KindSeatReturned = "SEAT_RETURNED"
	KindRoomStarted  = "ROOM_STARTED"
	KindRoomComplete = "ROOM_COMPLETE"
)

// Who made a pick, as the log says it.
const (
	ByDrafter = "drafter"
	ByBot     = "bot"
	// ByQueue is a stand-in for a drafter who left: queue, sheet, board.
	ByQueue = "queue"
	// ByClock is the same stand-in when a present drafter's clock ran out.
	ByClock = "clock"
)

// Seat is one seat of a room.
//
// Presence: a drafter's seat is held by its sockets, on any instance.
// Every open socket stamps LastSeen when it connects and at each ping
// (every 10 s). A seat whose drafter has not been seen within
// PresenceWindow (counted from JoinedAt when no socket ever arrived) is
// gone: the room's clock marks it left and its stand-in drafts it, the
// same as a closed tab, whether the socket never connected or the
// instance holding it died. A socket closing marks it left at once.
type Seat struct {
	Number    int
	AccountID *uuid.UUID
	Handle    *string
	IsBot     bool
	LeftAt    *time.Time
	JoinedAt  time.Time
	LastSeen  *time.Time
}

// PresenceWindow is two pings and a margin: well inside the 30 second
// pick clock, so a drafter who is gone is replaced before the next expiry.
const PresenceWindow = 25 * time.Second

// Person reports whether a drafter sits here now.
func (s Seat) Person() bool { return s.AccountID != nil && !s.IsBot && s.LeftAt == nil }

// Absent reports whether a seated drafter has not been seen within the
// presence window at now.
func (s Seat) Absent(now time.Time) bool {
	if !s.Person() {
		return false
	}
	seen := s.JoinedAt
	if s.LastSeen != nil && s.LastSeen.After(seen) {
		seen = *s.LastSeen
	}
	return now.Sub(seen) > PresenceWindow
}

// Left reports whether a drafter sat here and has gone.
func (s Seat) Left() bool { return s.AccountID != nil && s.LeftAt != nil }

// Room is one lobby as its log replays.
type Room struct {
	ID           uuid.UUID
	Format       Format
	Status       string
	Seed         uint32
	SoloPace     bool
	FillDeadline *time.Time
	StartedAt    *time.Time
	CreatedAt    time.Time
	Settings     apitypes.LeagueSettings
	Seats        map[int]Seat
	// Seq is the log's head.
	Seq int64
	// Config, State and Actions are the engine's: Initial before START.
	Config  draft.Config
	State   draft.State
	Actions []draft.Action
	// Odds is the odds recorded with picks, by the 1-based place of the
	// MAKE_PICK in Actions (mock.Draft.Odds's key).
	Odds map[int]mock.PickOdds
}

// TeamID is a seat's team in the engine: seat01 and on, as the solo room.
func TeamID(seat int) string { return mock.SeatID(seat) }

// clone copies what a write changes, so a failed transaction leaves the
// cached room as it was.
func (r *Room) clone() *Room {
	out := *r
	out.Seats = make(map[int]Seat, len(r.Seats))
	for k, v := range r.Seats {
		out.Seats[k] = v
	}
	return &out
}

// People counts the drafters seated now.
func (r *Room) People() int {
	n := 0
	for _, s := range r.Seats {
		if s.Person() {
			n++
		}
	}
	return n
}

// SeatOf is the account's seat, 0 when it has none.
func (r *Room) SeatOf(account uuid.UUID) int {
	for n, s := range r.Seats {
		if s.AccountID != nil && *s.AccountID == account {
			return n
		}
	}
	return 0
}

// engineConfig is the room's engine config: a snake draft on the
// format's pick clock, no overnight pause.
func engineConfig(id uuid.UUID, f Format, createdAt time.Time) (draft.Config, error) {
	slots, err := mock.SlotConfig(f.Settings())
	if err != nil {
		return draft.Config{}, err
	}
	return draft.Config{
		DraftID: "lobby_" + id.String(), LeagueID: "lobby", Format: draft.Snake, KickoffAt: draft.FormatMillis(createdAt.UnixMilli()),
		SlotConfig: slots, ClockSchedule: []draft.ClockTier{{UntilHoursBeforeKickoff: 0, PickSeconds: f.ClockSeconds}}, IsMock: true,
	}, nil
}

// LogRow is one app.room_actions row.
type LogRow struct {
	Seq     int64
	Kind    string
	Seat    *int
	Payload json.RawMessage
	At      time.Time
}

// enginePayload is an engine row's payload: the action, and for a pick
// what the room shows of it.
type enginePayload struct {
	Action   json.RawMessage `json:"action"`
	Pick     *PickNote       `json:"pick,omitempty"`
	Deadline *string         `json:"deadline,omitempty"`
	// Odds is the card the drafter on the clock saw, recorded with the
	// pick as the solo room records it, for the report's hindsight.
	Odds *mock.PickOdds `json:"odds,omitempty"`
}

// PickNote is a pick as the room shows it.
type PickNote struct {
	apitypes.RoomPick
	By string `json:"by"`
}

// isEngine reports whether a kind is one of the engine's actions.
func isEngine(kind string) bool {
	switch draft.ActionType(kind) {
	case draft.StartDraft, draft.SetQueue, draft.MakePick, draft.TimerExpire:
		return true
	}
	return false
}

// apply replays one row onto the room's engine state.
func (r *Room) apply(row LogRow) error {
	if row.Seq != r.Seq+1 {
		return fmt.Errorf("lobby: room %s log skips from %d to %d", r.ID, r.Seq, row.Seq)
	}
	r.Seq = row.Seq
	if !isEngine(row.Kind) {
		return nil
	}
	var p enginePayload
	if err := json.Unmarshal(row.Payload, &p); err != nil {
		return fmt.Errorf("lobby: room %s row %d: %w", r.ID, row.Seq, err)
	}
	a, err := draft.ParseAction(p.Action)
	if err != nil {
		return fmt.Errorf("lobby: room %s row %d: %w", r.ID, row.Seq, err)
	}
	next, err := draft.Reduce(r.State, a)
	if err != nil {
		return &draft.ReplayError{Sequence: int(row.Seq), Err: err}
	}
	r.State = next
	// Capped first, so an append always copies: a cached room and the
	// clone a write works on never share the tail.
	n := len(r.Actions)
	r.Actions = append(r.Actions[:n:n], a)
	if p.Odds != nil {
		odds := make(map[int]mock.PickOdds, len(r.Odds)+1)
		for k, v := range r.Odds {
			odds[k] = v
		}
		odds[len(r.Actions)] = *p.Odds
		r.Odds = odds
	}
	return nil
}

// Deadline is when the turn on the clock runs out, false with no turn.
func (r *Room) Deadline() (time.Time, bool) {
	at, running, err := draft.CurrentDeadline(r.State)
	if err != nil || !running {
		return time.Time{}, false
	}
	ms, err := draft.ParseMillis(at)
	if err != nil {
		return time.Time{}, false
	}
	return time.UnixMilli(ms).UTC(), true
}
