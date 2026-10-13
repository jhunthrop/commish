package lobby

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Command errors a drafter can cause.
var (
	ErrNotDrafting = &draft.Refusal{Reason: "This room is not drafting."}
	ErrNotYourTurn = &draft.Refusal{Reason: "You are not on the clock."}
	ErrPickPassed  = &draft.Refusal{Reason: "That pick has already been made."}
)

// candidateRooms is how many filling rooms a join tries before it opens
// a new one.
const candidateRooms = 5

func randomSeed() uint32 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return binary.BigEndian.Uint32(b[:])
}

// randomFreeSeat draws an open seat, so the first to join is not always
// on the clock first.
func randomFreeSeat(r *Room) (int, bool) {
	var free []int
	for n := 1; n <= r.Format.Teams; n++ {
		if _, taken := r.Seats[n]; !taken {
			free = append(free, n)
		}
	}
	if len(free) == 0 {
		return 0, false
	}
	i, err := rand.Int(rand.Reader, big.NewInt(int64(len(free))))
	if err != nil {
		return free[0], true
	}
	return free[i.Int64()], true
}

// errFull is a filling room that filled while a join was choosing it.
var errFull = errors.New("lobby: room full")

// Join seats the account in the format's filling room, or opens one. An
// account already seated in a live room of the format goes back to it.
func (s *Store) Join(ctx context.Context, account uuid.UUID, handle string, f Format) (uuid.UUID, int, error) {
	var room uuid.UUID
	var seat int
	err := s.Pool.QueryRow(ctx, `select r.id, st.seat from app.room_seats st join app.rooms r on r.id = st.room_id
		where st.account_id = $1 and r.queue = $2 and r.status in ('filling', 'drafting')
		order by r.created_at desc limit 1`, account, string(f.Key)).Scan(&room, &seat)
	if err == nil {
		return room, seat, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, 0, fmt.Errorf("lobby: seated already: %w", err)
	}
	for attempt := 0; attempt < candidateRooms; attempt++ {
		id, err := s.fillingRoom(ctx, f)
		if err != nil {
			return uuid.Nil, 0, err
		}
		seat, err := s.takeSeat(ctx, id, account, handle)
		if errors.Is(err, errFull) {
			continue
		}
		return id, seat, err
	}
	return uuid.Nil, 0, fmt.Errorf("lobby: no %s room had a seat after %d tries", f.Key, candidateRooms)
}

// fillingRoom is the format's oldest filling room with an open seat, or a
// new one. One join at a time chooses per format (a transaction lock on
// the format), so drafters who join together land in the same room.
func (s *Store) fillingRoom(ctx context.Context, f Format) (uuid.UUID, error) {
	var id uuid.UUID
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('lobby:' || $1))`, string(f.Key)); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `select r.id from app.rooms r
			where r.queue = $1 and r.status = 'filling' and r.fill_deadline > now()
			and (select count(*) from app.room_seats st where st.room_id = r.id) < r.teams
			order by r.created_at limit 1`, string(f.Key)).Scan(&id)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		now := s.Now().UTC().Truncate(time.Millisecond)
		return tx.QueryRow(ctx, `insert into app.rooms (queue, settings, seed, clock_seconds, teams, fill_deadline, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
			string(f.Key), f.Settings(), int64(randomSeed()), f.ClockSeconds, f.Teams, now.Add(FillWindow), now).Scan(&id)
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("lobby: a %s room: %w", f.Key, err)
	}
	return id, nil
}

func (s *Store) takeSeat(ctx context.Context, id, account uuid.UUID, handle string) (int, error) {
	var seat int
	_, err := s.Write(ctx, id, func(w *writer) error {
		if w.room.Status != StatusFilling || (w.room.FillDeadline != nil && !w.now.Before(*w.room.FillDeadline)) {
			return errFull
		}
		n, ok := randomFreeSeat(w.room)
		if !ok {
			return errFull
		}
		if _, err := w.tx.Exec(w.ctx, `insert into app.room_seats (room_id, seat, account_id, handle, joined_at) values ($1, $2, $3, $4, $5)`,
			id, n, account, handle, w.now); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return errFull
			}
			return fmt.Errorf("lobby: seat %d in %s: %w", n, id, err)
		}
		h := handle
		w.room.Seats[n] = Seat{Number: n, AccountID: &account, Handle: &h, JoinedAt: w.now}
		seat = n
		return w.log(KindSeatJoined, &n, map[string]string{"handle": handle})
	})
	return seat, err
}

// Leave gives a seat up: a filling room frees it (and is abandoned when
// nobody is left), a drafting room hands it to a stand-in at once.
func (s *Store) Leave(ctx context.Context, id, account uuid.UUID) error {
	_, err := s.Write(ctx, id, func(w *writer) error {
		n := w.room.SeatOf(account)
		if n == 0 {
			return ErrNoSeat
		}
		seat := w.room.Seats[n]
		switch w.room.Status {
		case StatusFilling:
			if _, err := w.tx.Exec(w.ctx, `delete from app.room_seats where room_id = $1 and seat = $2`, id, n); err != nil {
				return fmt.Errorf("lobby: free seat %d in %s: %w", n, id, err)
			}
			delete(w.room.Seats, n)
			if err := w.log(KindSeatLeft, &n, map[string]bool{"freed": true}); err != nil {
				return err
			}
			if w.room.People() == 0 {
				return w.abandon(AbandonedEveryoneLeft)
			}
			return nil
		case StatusDrafting:
			if seat.LeftAt != nil {
				return errNoChange
			}
			return w.markLeft(n, seat)
		}
		return errNoChange
	})
	return err
}

// Disconnect is a drafter's last socket closing: the seat is marked left
// at once and goes to its stand-in. A filling room keeps the seat for the
// drafter (a reload takes it straight back) but no longer counts them
// toward a full room, and a drafter who does not come back is a seat
// whose queue drafts once the room starts.
func (s *Store) Disconnect(ctx context.Context, id, account uuid.UUID) error {
	_, err := s.Write(ctx, id, func(w *writer) error {
		n := w.room.SeatOf(account)
		if n == 0 {
			return ErrNoSeat
		}
		seat := w.room.Seats[n]
		if seat.LeftAt != nil || (w.room.Status != StatusFilling && w.room.Status != StatusDrafting) {
			return errNoChange
		}
		return w.markLeft(n, seat)
	})
	return err
}

// markLeft stamps a seat's drafter as gone and logs it.
func (w *writer) markLeft(n int, seat Seat) error {
	if _, err := w.tx.Exec(w.ctx, `update app.room_seats set left_at = $3 where room_id = $1 and seat = $2`, w.room.ID, n, w.now); err != nil {
		return fmt.Errorf("lobby: leave seat %d in %s: %w", n, w.room.ID, err)
	}
	at := w.now
	seat.LeftAt = &at
	w.room.Seats[n] = seat
	return w.log(KindSeatLeft, &n, struct{}{})
}

// Return gives a drafter who left a live room the seat back from its
// stand-in, as the socket reconnects.
func (s *Store) Return(ctx context.Context, id, account uuid.UUID) error {
	_, err := s.Write(ctx, id, func(w *writer) error {
		n := w.room.SeatOf(account)
		if n == 0 {
			return ErrNoSeat
		}
		seat := w.room.Seats[n]
		live := w.room.Status == StatusFilling || w.room.Status == StatusDrafting
		if !live || seat.LeftAt == nil {
			return errNoChange
		}
		if _, err := w.tx.Exec(w.ctx, `update app.room_seats set left_at = null where room_id = $1 and seat = $2`, id, n); err != nil {
			return fmt.Errorf("lobby: return seat %d in %s: %w", n, id, err)
		}
		seat.LeftAt = nil
		w.room.Seats[n] = seat
		return w.log(KindSeatReturned, &n, struct{}{})
	})
	return err
}

// Pick is a drafter's own pick on the clock.
func (s *Store) Pick(ctx context.Context, id, account uuid.UUID, playerID string, pick int) error {
	_, err := s.Write(ctx, id, func(w *writer) error {
		n, err := w.drafter(account)
		if err != nil {
			return err
		}
		if pick != w.room.State.PickNumber {
			return ErrPickPassed
		}
		team, ok := draft.TeamOnClock(w.room.State)
		if !ok || team != TeamID(n) {
			return ErrNotYourTurn
		}
		return w.engine(draft.NewMakePick(w.stamp(), team, playerID), n, ByDrafter)
	})
	return err
}

// Queue replaces a drafter's queue.
func (s *Store) Queue(ctx context.Context, id, account uuid.UUID, ids []string) error {
	_, err := s.Write(ctx, id, func(w *writer) error {
		n, err := w.drafter(account)
		if err != nil {
			return err
		}
		queue := dedupe(ids)
		// The same queue again writes nothing: no row, no broadcast.
		if slices.Equal(queue, draft.QueueFor(w.room.State, TeamID(n))) {
			return errNoChange
		}
		return w.engine(draft.NewSetQueue(w.stamp(), TeamID(n), queue), n, "")
	})
	return err
}

// drafter is the account's seat in a drafting room.
func (w *writer) drafter(account uuid.UUID) (int, error) {
	n := w.room.SeatOf(account)
	if n == 0 {
		return 0, ErrNoSeat
	}
	if w.room.Status != StatusDrafting {
		return 0, ErrNotDrafting
	}
	return n, nil
}

// abandon closes a room that never drafted and logs why, so every socket
// on it (a drafter who joined and stepped away included, when they come
// back) is told rather than left on a room that will never start.
func (w *writer) abandon(reason string) error {
	if err := w.setStatus(StatusAbandoned); err != nil {
		return err
	}
	return w.log(KindRoomAbandoned, nil, map[string]string{"reason": reason})
}

func (w *writer) setStatus(status string) error {
	if _, err := w.tx.Exec(w.ctx, `update app.rooms set status = $2 where id = $1`, w.room.ID, status); err != nil {
		return fmt.Errorf("lobby: %s %s: %w", status, w.room.ID, err)
	}
	w.room.Status = status
	return nil
}

func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// Filling is, per format, how many drafters sit in its filling room.
func (s *Store) Filling(ctx context.Context) (map[apitypes.LobbyFormat]int, error) {
	rows, err := s.Pool.Query(ctx, `select r.queue, count(st.seat) from app.rooms r
		left join app.room_seats st on st.room_id = r.id and st.account_id is not null and st.left_at is null
		where r.status = 'filling' and r.fill_deadline > now()
		group by r.id, r.queue, r.created_at order by r.created_at`)
	if err != nil {
		return nil, fmt.Errorf("lobby: filling: %w", err)
	}
	out := map[apitypes.LobbyFormat]int{}
	for rows.Next() {
		var queue string
		var n int
		if err := rows.Scan(&queue, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("lobby: filling: %w", err)
		}
		// The oldest filling room is the one a join lands in.
		if _, seen := out[apitypes.LobbyFormat(queue)]; !seen {
			out[apitypes.LobbyFormat(queue)] = n
		}
	}
	return out, rows.Err()
}
