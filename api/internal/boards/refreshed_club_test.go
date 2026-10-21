package boards

import (
	"context"
	"testing"
	"time"
)

// The daily player list refreshes provider_players.team in place (Lane
// 122, research/pipeline/tank01/player_clubs.py). The board reads the
// column as before: the refreshed club and that club's bye reach the
// next load, and the version moves, so a cached board is read again
// rather than kept with the old club.
func TestARefreshedClubReachesTheBoard(t *testing.T) {
	pool, src := publishedFixture(t, false)
	ctx := context.Background()
	before := load(t, src, PPR)
	gibbs := before.Players[0]
	if gibbs.ID != "p1" || gibbs.Team != "DET" || gibbs.Bye != 2 {
		t.Fatalf("seeded %+v, want p1 on DET with the week 2 bye", gibbs)
	}
	seeded, err := src.Version(ctx, PPR)
	if err != nil {
		t.Fatal(err)
	}
	// The writer's update: his row, his club, nothing else.
	if _, err := pool.Exec(ctx, "update "+publishedSchema+".provider_players set team = 'DAL' where id = 'p1'"); err != nil {
		t.Fatal(err)
	}
	refreshed, err := src.Version(ctx, PPR)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed == seeded {
		t.Fatal("the version did not move with the club")
	}
	after := load(t, src, PPR)
	gibbs = after.Players[0]
	if gibbs.ID != "p1" || gibbs.Team != "DAL" || gibbs.Bye != 1 {
		t.Fatalf("refreshed %+v, want p1 on DAL with DAL's week 1 bye", gibbs)
	}
	if len(after.Players) != len(before.Players) || after.Players[1].Team != before.Players[1].Team {
		t.Fatalf("another player moved: %+v against %+v", after.Players, before.Players)
	}
}

// A free agent's club is NULL (revision 0018, Lane 123): the board reads
// him with no club, so no bye, and the version moves, so a cached board
// is read again. The directory read the custom boards take does the same.
func TestAFreeAgentReadsNoClub(t *testing.T) {
	pool, src := publishedFixture(t, false)
	ctx := context.Background()
	seeded, err := src.Version(ctx, PPR)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "update "+publishedSchema+".provider_players set team = null where id = 'p1'"); err != nil {
		t.Fatal(err)
	}
	cleared, err := src.Version(ctx, PPR)
	if err != nil {
		t.Fatal(err)
	}
	if cleared == seeded {
		t.Fatal("the version did not move with the cleared club")
	}
	gibbs := load(t, src, PPR).Players[0]
	if gibbs.ID != "p1" || gibbs.Team != "" || gibbs.Bye != 0 {
		t.Fatalf("cleared %+v, want p1 with no club and no bye", gibbs)
	}
	if WireClub(gibbs.Team) != "FA" {
		t.Fatalf("the answer names him %q", WireClub(gibbs.Team))
	}
	scored, err := src.LoadScored(ctx, PPR, "custom", time.Now(), nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range scored.Players {
		if p.ID == "p1" {
			found = true
			if p.Team != "" || p.Bye != 0 {
				t.Fatalf("the directory read %+v, want no club and no bye", p)
			}
		}
	}
	if !found {
		t.Fatal("the directory read left him out")
	}
}
