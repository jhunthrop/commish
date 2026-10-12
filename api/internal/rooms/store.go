// Package rooms is the live lobby's persistence and the room service's
// WebSocket surface. The room process (cmd/room) owns each lobby's
// clock; its state is the app.room_actions log, replayed by seq, so a
// client that drops reconnects by room id and the last seq it applied
// and loses nothing. The lobby lane (Lane 6) adds the clock, the queue
// and the broadcast on top of this handshake.
package rooms

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// ErrNotFound is a room that does not exist.
var ErrNotFound = errors.New("rooms: not found")

// Store reads app.rooms and app.room_actions.
type Store struct{ Pool *pgxpool.Pool }

// maxReplay bounds one welcome's replay. A full 14-team, 25-round room
// with its joins, leaves and clock events is well under it.
const maxReplay = 2000

// ActionsSince is the room's head seq and every action after afterSeq,
// in seq order.
func (s *Store) ActionsSince(ctx context.Context, roomID uuid.UUID, afterSeq int64) (int64, []apitypes.RoomAction, error) {
	var head int64
	err := s.Pool.QueryRow(ctx, `
		select coalesce((select max(seq) from app.room_actions where room_id = r.id), 0)
		from app.rooms r where r.id = $1`, roomID).Scan(&head)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, ErrNotFound
	}
	if err != nil {
		return 0, nil, fmt.Errorf("rooms: head %s: %w", roomID, err)
	}
	rows, err := s.Pool.Query(ctx, `
		select seq, kind, seat, payload, at from app.room_actions
		where room_id = $1 and seq > $2 order by seq limit $3`, roomID, afterSeq, maxReplay)
	if err != nil {
		return 0, nil, fmt.Errorf("rooms: actions %s: %w", roomID, err)
	}
	actions, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (apitypes.RoomAction, error) {
		var a apitypes.RoomAction
		err := r.Scan(&a.Seq, &a.Kind, &a.Seat, &a.Payload, &a.At)
		return a, err
	})
	if err != nil {
		return 0, nil, fmt.Errorf("rooms: actions %s: %w", roomID, err)
	}
	return head, actions, nil
}
