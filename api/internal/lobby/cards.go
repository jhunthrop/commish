package lobby

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// The on-clock card: the api computes it for the drafter on the clock
// and stores it here, first-wins; the room service copies it into the
// pick's row as its odds, whoever makes the pick (the drafter, the clock
// or a stand-in), so the report's hindsight reads what the room showed.
// The conditional card off the clock is never recorded: it measures the
// chance a player reaches your pick, not the chance he would have lasted
// past it.

// Card is the stored on-clock card for a pick, false when none is.
func (s *Store) Card(ctx context.Context, id uuid.UUID, pick int) (advisor.Card, bool, error) {
	return readCard(ctx, s.Pool, id, pick)
}

// PutCard stores a pick's on-clock card; the first one written stands.
func (s *Store) PutCard(ctx context.Context, id uuid.UUID, pick int, card advisor.Card) error {
	raw, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("lobby: encode card: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `insert into app.lobby_cards (room_id, pick_no, card) values ($1, $2, $3)
		on conflict (room_id, pick_no) do nothing`, id, pick, raw); err != nil {
		return fmt.Errorf("lobby: put card %s at %d: %w", id, pick, err)
	}
	return nil
}

func readCard(ctx context.Context, q querier, id uuid.UUID, pick int) (advisor.Card, bool, error) {
	var raw []byte
	err := q.QueryRow(ctx, `select card from app.lobby_cards where room_id = $1 and pick_no = $2`, id, pick).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return advisor.Card{}, false, nil
	}
	if err != nil {
		return advisor.Card{}, false, fmt.Errorf("lobby: card %s at %d: %w", id, pick, err)
	}
	var card advisor.Card
	if err := json.Unmarshal(raw, &card); err != nil {
		return advisor.Card{}, false, fmt.Errorf("lobby: decode card %s at %d: %w", id, pick, err)
	}
	return card, true, nil
}

// recordedOdds is the on-clock card for the pick about to be made, as the
// pick records it, nil when the drafter never read one.
func (w *writer) recordedOdds(pick int) (*mock.PickOdds, error) {
	card, ok, err := readCard(w.ctx, w.tx, w.room.ID, pick)
	if err != nil || !ok {
		return nil, err
	}
	return draftroom.PickOdds(card), nil
}
