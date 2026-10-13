package lobby

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
)

// DueKind is what a room's clock does next.
type DueKind int

// The things a clock does.
const (
	// DueNothing is a room with nothing left to run.
	DueNothing DueKind = iota
	// DueStart fills the open seats with bots and starts the draft.
	DueStart
	// DueBot is a bot seat's pick, after its think time.
	DueBot
	// DueStandIn is a stand-in's pick: a seat whose drafter left, after a
	// bot's think time, or a present drafter whose clock ran out.
	DueStandIn
)

// Due is the room's next event: what, when, and the pick it is for, so
// an event that comes too late (the drafter picked) does nothing.
type Due struct {
	Kind DueKind
	At   time.Time
	Pick int
	Seq  int64
}

// NextDue is what the room's clock does next and when.
func NextDue(r *Room) Due {
	switch r.Status {
	case StatusFilling:
		at := r.CreatedAt.Add(FillWindow)
		if r.FillDeadline != nil {
			at = *r.FillDeadline
		}
		// Every seat taken: the room starts now. A seat whose drafter is gone
		// is marked left first and drafts by its stand-in.
		if len(r.Seats) >= r.Format.Teams {
			at = r.CreatedAt
		}
		return Due{Kind: DueStart, At: at, Seq: r.Seq}
	case StatusDrafting:
		team, ok := draft.TeamOnClock(r.State)
		if !ok || r.State.TurnStartedAt == nil {
			return Due{}
		}
		startMs, err := draft.ParseMillis(*r.State.TurnStartedAt)
		if err != nil {
			return Due{}
		}
		started := time.UnixMilli(startMs).UTC()
		seat := r.Seats[draftroom.SeatNumber(r.State.DraftOrder, team)]
		due := Due{Pick: r.State.PickNumber, Seq: r.Seq}
		switch {
		case seat.IsBot:
			due.Kind, due.At = DueBot, started.Add(r.thinkTime(team))
		case seat.Left():
			due.Kind, due.At = DueStandIn, started.Add(r.thinkTime(team))
		default:
			deadline, ok := r.Deadline()
			if !ok {
				return Due{}
			}
			due.Kind, due.At = DueStandIn, deadline
		}
		return due
	}
	return Due{}
}

// thinkTime is a bot's or a stand-in's think time at the pick on the
// clock, the seeded draw the pins fix; none at the solo room's pace.
func (r *Room) thinkTime(team string) time.Duration {
	if r.SoloPace {
		return 0
	}
	ms := bots.ThinkDelayMs(float64(r.Format.ClockSeconds), bots.DefaultDelay(), bots.RngFor(r.Seed, bots.DelayStreamKey(team, r.State.PickNumber)))
	return time.Duration(ms * float64(time.Millisecond))
}

// Clock runs a room's due events. The room service owns one per room.
type Clock struct {
	Store  *Store
	Boards *draftroom.Boards
	// Sheets is a drafter's newest cheat sheet, the stand-in's second source.
	Sheets interface {
		Order(ctx context.Context, accountID uuid.UUID) ([]string, error)
	}
}

// Act does a due event if the room is still where the event found it.
func (c *Clock) Act(ctx context.Context, id uuid.UUID, due Due) error {
	switch due.Kind {
	case DueStart:
		return c.start(ctx, id)
	case DueBot, DueStandIn:
		return c.turn(ctx, id, due)
	}
	return nil
}

// start fills the open seats with bots and starts the draft, or abandons
// a room nobody stayed in.
func (c *Clock) start(ctx context.Context, id uuid.UUID) error {
	_, err := c.Store.Write(ctx, id, func(w *writer) error {
		r := w.room
		if r.Status != StatusFilling {
			return errNoChange
		}
		people := r.People()
		full := len(r.Seats) >= r.Format.Teams
		if !full && r.FillDeadline != nil && w.now.Before(*r.FillDeadline) {
			return errNoChange
		}
		if people == 0 {
			return w.setStatus(StatusAbandoned)
		}
		board, err := c.Boards.For(ctx, r.Settings)
		if err != nil {
			return err
		}
		var botSeats []int
		for n := 1; n <= r.Format.Teams; n++ {
			if _, taken := r.Seats[n]; taken {
				continue
			}
			if _, err := w.tx.Exec(ctx, `insert into app.room_seats (room_id, seat, is_bot, joined_at) values ($1, $2, true, $3)`, id, n, w.now); err != nil {
				return fmt.Errorf("lobby: bot seat %d in %s: %w", n, id, err)
			}
			r.Seats[n] = Seat{Number: n, IsBot: true, JoinedAt: w.now}
			botSeats = append(botSeats, n)
		}
		solo := people < SoloPaceBelow
		if _, err := w.tx.Exec(ctx, `update app.rooms set status = 'drafting', started_at = $2, solo_pace = $3 where id = $1`, id, w.now, solo); err != nil {
			return fmt.Errorf("lobby: start %s: %w", id, err)
		}
		at := w.now
		r.Status, r.StartedAt, r.SoloPace = StatusDrafting, &at, solo
		if err := w.log(KindRoomStarted, nil, map[string]any{"bots": botSeats, "solo_pace": solo}); err != nil {
			return err
		}
		order := make([]string, r.Format.Teams)
		for i := range order {
			order[i] = TeamID(i + 1)
		}
		autopick := draft.AutopickConfig()
		skip := draft.DraftSkipPolicy()
		return w.engine(draft.Action{
			Type: draft.StartDraft, Timestamp: w.stamp(), DraftOrder: order, Pool: board.Pool(),
			MinBid: draft.AuctionMinBid, SkipPolicy: &skip, Autopick: &autopick,
		}, 0, "")
	})
	return err
}

// turn is a bot's pick, or a stand-in's for a seat whose drafter left or
// whose clock ran out.
func (c *Clock) turn(ctx context.Context, id uuid.UUID, due Due) error {
	var sheet []string
	if due.Kind == DueStandIn {
		r, err := c.Store.Load(ctx, id)
		if err != nil {
			return err
		}
		if team, ok := draft.TeamOnClock(r.State); ok {
			if seat := r.Seats[draftroom.SeatNumber(r.State.DraftOrder, team)]; seat.AccountID != nil {
				if sheet, err = c.Sheets.Order(ctx, *seat.AccountID); err != nil {
					return err
				}
			}
		}
	}
	_, err := c.Store.Write(ctx, id, func(w *writer) error {
		r := w.room
		if r.Status != StatusDrafting || r.State.PickNumber != due.Pick || NextDue(r).Kind != due.Kind {
			return errNoChange
		}
		if w.now.Before(NextDue(r).At) {
			return errNoChange
		}
		team, ok := draft.TeamOnClock(r.State)
		if !ok {
			return errNoChange
		}
		n := draftroom.SeatNumber(r.State.DraftOrder, team)
		if due.Kind == DueBot {
			player, ok := botChoice(r, team)
			if !ok {
				return fmt.Errorf("lobby: bot %s has no pick at %d", team, r.State.PickNumber)
			}
			return w.engine(draft.NewMakePick(w.stamp(), team, player), n, ByBot)
		}
		player, ok := draftroom.StandIn(r.State, team, sheet, nil)
		if !ok {
			return fmt.Errorf("lobby: stand-in for %s has no pick at %d", team, r.State.PickNumber)
		}
		by := ByClock
		if r.Seats[n].Left() {
			by = ByQueue
		}
		return w.engine(draft.NewMakePick(w.stamp(), team, player), n, by)
	})
	return err
}

// botChoice is a bot seat's pick: its archetype, dealt over the room's
// bot seats by the seed, drawing from its own stream positioned by its
// earlier picks, the solo room's replay law.
func botChoice(r *Room, team string) (string, bool) {
	var botTeams []string
	for n, s := range r.Seats {
		if s.IsBot {
			botTeams = append(botTeams, TeamID(n))
		}
	}
	sort.Strings(botTeams)
	dealt := bots.AssignArchetypes(r.Seed, botTeams)
	rng := bots.RngFor(r.Seed, bots.PickStreamKey(team))
	for _, p := range r.State.Picks {
		if p.TeamID == team && !p.Auto {
			rng.Next()
		}
	}
	return bots.ChooseBotPick(r.State, team, dealt[team], bots.DefaultStrategy(), rng)
}
