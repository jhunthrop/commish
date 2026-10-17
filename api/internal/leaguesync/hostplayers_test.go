package leaguesync

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// A move's names and positions come from the kept directory by id: only
// the ids asked for, only the host's own.
func TestHostPlayersByID(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	s := &Store{Pool: pool}
	at := time.Now().UTC()
	if err := s.PutHostPlayers(ctx, HostMFL, []HostPlayer{{ID: "13116", Name: "Josh Allen", Position: "QB", Team: "BUF"},
		{ID: "13604", Name: "Bucky Irving", Position: "RB", Team: "TB"}, {ID: "15287", Name: "Nico Collins", Position: "WR", Team: "HOU"}}, at); err != nil {
		t.Fatal(err)
	}
	if err := s.PutHostPlayers(ctx, HostSleeper, []HostPlayer{{ID: "13116", Name: "Someone Else", Position: "TE", Team: "NYJ"}}, at); err != nil {
		t.Fatal(err)
	}
	got, err := s.HostPlayersByID(ctx, HostMFL, []string{"13116", "13604", "99999", "13604"})
	if err != nil || len(got) != 2 || got["13116"].Name != "Josh Allen" || got["13604"].Position != "RB" {
		t.Fatalf("%v %+v", err, got)
	}
	if none, err := s.HostPlayersByID(ctx, HostMFL, nil); err != nil || len(none) != 0 {
		t.Fatalf("no ids: %v %+v", err, none)
	}
}
