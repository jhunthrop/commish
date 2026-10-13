package solo

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
)

// cardStore records the cards written to it; every other Repository
// method is left to the embedded nil interface and is never called here.
type cardStore struct {
	Repository
	puts []cardPut
	err  error
}

type cardPut struct {
	branch, pick int
	card         string
}

func (c *cardStore) PutCard(_ context.Context, _ uuid.UUID, branch, pick int, card any) error {
	if c.err != nil {
		return c.err
	}
	raw, err := json.Marshal(card)
	if err != nil {
		return err
	}
	c.puts = append(c.puts, cardPut{branch: branch, pick: pick, card: string(raw)})
	return nil
}

func roomAt(pick int, waiting bool) room {
	return room{
		mock:   apitypes.Mock{Id: uuid.New()},
		branch: 1,
		draft:  mock.Draft{Waiting: waiting, State: draft.State{PickNumber: pick}},
	}
}

// TestCarryCard pins M2: the card shown at the undone pick moves to the new
// branch only when the room is back on that pick, and a failed write never
// fails the undo.
func TestCarryCard(t *testing.T) {
	shown := json.RawMessage(`{"pick_number":22,"source":"advisor"}`)
	cases := []struct {
		name    string
		back    room
		storeEr error
		want    []cardPut
	}{
		{name: "back on the pick", back: roomAt(22, true), want: []cardPut{{branch: 1, pick: 22, card: string(shown)}}},
		{name: "landed elsewhere", back: roomAt(23, true)},
		{name: "not on the clock", back: roomAt(22, false)},
		{name: "store fails", back: roomAt(22, true), storeEr: errors.New("down")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &cardStore{err: tc.storeEr}
			s := &Service{Mocks: store, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
			s.carryCard(context.Background(), tc.back, 22, shown)
			if len(store.puts) != len(tc.want) {
				t.Fatalf("puts = %v, want %v", store.puts, tc.want)
			}
			for i := range tc.want {
				if store.puts[i] != tc.want[i] {
					t.Fatalf("put %d = %v, want %v", i, store.puts[i], tc.want[i])
				}
			}
		})
	}
}
