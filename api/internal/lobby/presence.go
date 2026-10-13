package lobby

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Touch stamps a drafter's seat as seen now: a socket calls it when it
// connects and at every ping (see Seat for the presence rule). It is not
// a log row; nothing a client replays changes.
func (s *Store) Touch(ctx context.Context, id, account uuid.UUID) error {
	if _, err := s.Pool.Exec(ctx, `update app.room_seats set last_seen = $3 where room_id = $1 and account_id = $2`,
		id, account, s.Now().UTC()); err != nil {
		return fmt.Errorf("lobby: touch %s: %w", id, err)
	}
	return nil
}

// MarkAbsent marks every seat whose drafter is past the presence window
// as left, so its stand-in drafts before the next expiry. The room's
// clock calls it; it reports how many seats it marked.
func (s *Store) MarkAbsent(ctx context.Context, id uuid.UUID) (int, error) {
	marked := 0
	_, err := s.Write(ctx, id, func(w *writer) error {
		if w.room.Status != StatusFilling && w.room.Status != StatusDrafting {
			return errNoChange
		}
		for n, seat := range w.room.Seats {
			if !seat.Absent(w.now) {
				continue
			}
			if err := w.markLeft(n, seat); err != nil {
				return err
			}
			marked++
		}
		if marked == 0 {
			return errNoChange
		}
		return nil
	})
	return marked, err
}

// AnyAbsent reports whether the room has a drafter past the presence
// window at now.
func (r *Room) AnyAbsent(now time.Time) bool {
	for _, seat := range r.Seats {
		if seat.Absent(now) {
			return true
		}
	}
	return false
}
