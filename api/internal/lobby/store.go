package lobby

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
)

// NotifyChannel is the Postgres channel every write to a room's log
// signals on, "<room id>:<seq>", delivered at commit.
const NotifyChannel = "room_actions"

// Store errors.
var (
	ErrNotFound = errors.New("lobby: no such room")
	ErrNoSeat   = errors.New("lobby: no seat in this room")
	// errNoChange is a write with nothing to do; it rolls back quietly.
	errNoChange = errors.New("lobby: nothing to change")
)

// maxCachedRooms bounds the replayed rooms a process keeps; past it the
// cache starts over and rooms replay from their logs.
const maxCachedRooms = 512

// Store reads and writes a room's row, seats and log. It keeps each
// room's replayed state, so a write replays only the rows since.
type Store struct {
	Pool *pgxpool.Pool
	Now  func() time.Time

	mu    sync.Mutex
	rooms map[uuid.UUID]*Room
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *Store) cached(id uuid.UUID) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rooms[id]
}

func (s *Store) keep(r *Room) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rooms == nil || len(s.rooms) >= maxCachedRooms {
		s.rooms = map[uuid.UUID]*Room{}
	}
	if old, ok := s.rooms[r.ID]; ok && old.Seq > r.Seq {
		return
	}
	s.rooms[r.ID] = r
}

// Forget drops a finished room from the cache.
func (s *Store) Forget(id uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.rooms, id)
}

const roomColumns = `queue, status, seed, solo_pace, fill_deadline, started_at, created_at`

// read loads the room through q, from the cached replay forward. lock
// takes the room's row lock first, so the caller is the room's only writer.
func (s *Store) read(ctx context.Context, q querier, id uuid.UUID, lock bool) (*Room, error) {
	query := `select ` + roomColumns + ` from app.rooms where id = $1`
	if lock {
		query += ` for update`
	}
	var queue, status string
	var seed int64
	fresh := Room{ID: id}
	err := q.QueryRow(ctx, query, id).Scan(&queue, &status, &seed, &fresh.SoloPace, &fresh.FillDeadline, &fresh.StartedAt, &fresh.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lobby: read room %s: %w", id, err)
	}
	format, ok := FormatOf(apitypes.LobbyFormat(queue))
	if !ok {
		return nil, fmt.Errorf("lobby: room %s has an unknown format %q", id, queue)
	}
	seats, err := readSeats(ctx, q, id)
	if err != nil {
		return nil, err
	}
	var r *Room
	if c := s.cached(id); c != nil {
		r = c.clone()
	} else {
		config, err := engineConfig(id, format, fresh.CreatedAt)
		if err != nil {
			return nil, err
		}
		r = &Room{ID: id, Config: config, State: draft.Initial(config)}
	}
	r.Format, r.Status, r.Seed, r.SoloPace = format, status, uint32(seed), fresh.SoloPace
	r.FillDeadline, r.StartedAt, r.CreatedAt = fresh.FillDeadline, fresh.StartedAt, fresh.CreatedAt
	r.Settings, r.Seats = format.Settings(), seats
	rows, err := readLog(ctx, q, id, r.Seq)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if err := r.apply(row); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func readSeats(ctx context.Context, q querier, id uuid.UUID) (map[int]Seat, error) {
	rows, err := q.Query(ctx, `select seat, account_id, handle, is_bot, left_at from app.room_seats where room_id = $1`, id)
	if err != nil {
		return nil, fmt.Errorf("lobby: seats %s: %w", id, err)
	}
	out := map[int]Seat{}
	for rows.Next() {
		var st Seat
		if err := rows.Scan(&st.Number, &st.AccountID, &st.Handle, &st.IsBot, &st.LeftAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("lobby: seats %s: %w", id, err)
		}
		out[st.Number] = st
	}
	return out, rows.Err()
}

func readLog(ctx context.Context, q querier, id uuid.UUID, after int64) ([]LogRow, error) {
	rows, err := q.Query(ctx, `select seq, kind, seat, payload, at from app.room_actions where room_id = $1 and seq > $2 order by seq`, id, after)
	if err != nil {
		return nil, fmt.Errorf("lobby: log %s: %w", id, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (LogRow, error) {
		var row LogRow
		var seat *int16
		err := r.Scan(&row.Seq, &row.Kind, &seat, &row.Payload, &row.At)
		if seat != nil {
			n := int(*seat)
			row.Seat = &n
		}
		return row, err
	})
	if err != nil {
		return nil, fmt.Errorf("lobby: log %s: %w", id, err)
	}
	return out, nil
}

// Load is the room as it stands, without a lock.
func (s *Store) Load(ctx context.Context, id uuid.UUID) (*Room, error) {
	r, err := s.read(ctx, s.Pool, id, false)
	if err != nil {
		return nil, err
	}
	s.keep(r)
	return r, nil
}

// LogSince is every row after a seq, for a socket catching up.
func (s *Store) LogSince(ctx context.Context, id uuid.UUID, after int64) ([]LogRow, error) {
	return readLog(ctx, s.Pool, id, after)
}

// writer is one transaction's work on a room: every row it logs is
// applied to the room it holds, which is cached once the write commits.
type writer struct {
	ctx  context.Context
	tx   pgx.Tx
	room *Room
	now  time.Time
	n    int
}

// Write runs fn on the room under its row lock and commits what fn
// logged, with a notification for every socket and clock on the room.
func (s *Store) Write(ctx context.Context, id uuid.UUID, fn func(w *writer) error) (*Room, error) {
	var out *Room
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		r, err := s.read(ctx, tx, id, true)
		if err != nil {
			return err
		}
		w := &writer{ctx: ctx, tx: tx, room: r, now: s.Now().UTC().Truncate(time.Millisecond)}
		if err := fn(w); err != nil {
			return err
		}
		if w.n > 0 {
			if _, err := tx.Exec(ctx, `select pg_notify($1, $2)`, NotifyChannel, id.String()+":"+strconv.FormatInt(r.Seq, 10)); err != nil {
				return fmt.Errorf("lobby: notify %s: %w", id, err)
			}
		}
		out = w.room
		return nil
	})
	if errors.Is(err, errNoChange) {
		return s.Load(ctx, id)
	}
	if err != nil {
		return nil, err
	}
	s.keep(out)
	return out, nil
}

// log appends one row and applies it.
func (w *writer) log(kind string, seat *int, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("lobby: encode %s: %w", kind, err)
	}
	row := LogRow{Seq: w.room.Seq + 1, Kind: kind, Seat: seat, Payload: raw, At: w.now}
	if _, err := w.tx.Exec(w.ctx, `insert into app.room_actions (room_id, seq, kind, seat, payload, at) values ($1, $2, $3, $4, $5, $6)`,
		w.room.ID, row.Seq, row.Kind, row.Seat, raw, row.At); err != nil {
		return fmt.Errorf("lobby: log %s on %s: %w", kind, w.room.ID, err)
	}
	if err := w.room.apply(row); err != nil {
		return err
	}
	w.n++
	return nil
}

// stamp is the writer's instant in the engine's form, never before the
// turn on the clock began, so the log's stamps stay monotone.
func (w *writer) stamp() string {
	at := draft.FormatMillis(w.now.UnixMilli())
	if t := w.room.State.TurnStartedAt; t != nil {
		if started, err := draft.ParseMillis(*t); err == nil && started > w.now.UnixMilli() {
			return *t
		}
	}
	return at
}

// engine checks an engine action at command time (Admit), logs it with
// what the room shows of a pick, and writes the pick for the nightly ADP.
func (w *writer) engine(a draft.Action, seat int, by string) error {
	before := w.room.State
	next, err := draft.Submit(before, a)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return fmt.Errorf("lobby: encode action: %w", err)
	}
	payload := enginePayload{Action: raw}
	picked := len(next.Picks) > len(before.Picks)
	if picked {
		p := next.Picks[len(next.Picks)-1]
		payload.Pick = &PickNote{By: by, RoomPick: apitypes.RoomPick{
			Pick: p.PickNumber, Round: p.Round, Seat: draftroom.SeatNumber(next.DraftOrder, p.TeamID), PlayerId: p.PlayerID, Auto: p.Auto,
		}}
	}
	if at, running, err := draft.CurrentDeadline(next); err == nil && running {
		payload.Deadline = &at
	}
	var seatRef *int
	if seat > 0 {
		seatRef = &seat
	}
	if err := w.log(string(a.Type), seatRef, payload); err != nil {
		return err
	}
	if picked {
		if err := w.lobbyPick(*payload.Pick); err != nil {
			return err
		}
	}
	if draft.IsComplete(w.room.State) {
		return w.complete()
	}
	return nil
}

// lobbyPick writes one pick for the nightly job. by_bot is every pick a
// drafter's own hand did not make: a bot's, and a stand-in's.
func (w *writer) lobbyPick(p PickNote) error {
	st := w.room.Seats[p.Seat]
	var account *uuid.UUID
	if st.AccountID != nil {
		account = st.AccountID
	}
	scoring := string(w.room.Format.Scoring)
	_, err := w.tx.Exec(w.ctx, `insert into app.lobby_picks
		(room_id, pick_no, round, seat, player_id, account_id, by_bot, queue, scoring, teams, picked_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		w.room.ID, p.Pick, p.Round, p.Seat, p.PlayerId, account, p.By != ByDrafter, string(w.room.Format.Key), scoring, w.room.Format.Teams, w.now)
	if err != nil {
		return fmt.Errorf("lobby: lobby pick %d on %s: %w", p.Pick, w.room.ID, err)
	}
	return nil
}

func (w *writer) complete() error {
	if _, err := w.tx.Exec(w.ctx, `update app.rooms set status = 'complete', completed_at = $2, owner_instance = null, lease_until = null where id = $1`,
		w.room.ID, w.now); err != nil {
		return fmt.Errorf("lobby: complete %s: %w", w.room.ID, err)
	}
	w.room.Status = StatusComplete
	return w.log(KindRoomComplete, nil, struct{}{})
}
