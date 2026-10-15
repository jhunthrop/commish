package sheets

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

func TestHeldReadsTheHoldTagOnEverySheet(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	store := &Store{Pool: pool}
	account := func(name string) uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.com') returning id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	me, other := account("user_held_me"), account("user_held_other")
	row := func(id string, tags ...string) apitypes.SheetRowInput {
		list := apitypes.SheetTags(tags)
		return apitypes.SheetRowInput{PlayerId: id, Name: "Player " + id, Position: "RB", Tags: &list}
	}
	sheet := func(owner uuid.UUID, rows ...apitypes.SheetRowInput) {
		if _, err := store.Create(ctx, owner, apitypes.SheetCreate{Name: "Mine", Format: apitypes.BoardFormatPpr, Rows: &rows}); err != nil {
			t.Fatal(err)
		}
	}
	sheet(me, row("p1", "Hold"), row("p2", "target"), row("p3", "HOLD", "sleeper"))
	sheet(me, row("p4", "hold"), row("p1", "hold"))
	sheet(other, row("p5", "Hold"))
	held, err := store.Held(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	if len(held) != 3 || !held["p1"] || !held["p3"] || !held["p4"] {
		t.Fatalf("held %v, want p1, p3 and p4, never another account's", held)
	}
}
