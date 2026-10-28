package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// memoryDirectory is the hosts' directories from the replay, as the
// store's kept directory answers them.
type memoryDirectory struct{ players memoryPlayers }

func (m memoryDirectory) HostPlayersByID(ctx context.Context, host string, ids []string) (map[string]HostPlayer, error) {
	return m.players.For(ctx, host, 0, ids)
}

// The starters of the member's own team in each followed league, from the
// read the API kept, placed on our board as the league page places them
// (review M8, re-review N1): the team that starts Aaron Rodgers yields
// him, on his board id, with the host's name for him and the league's
// name; starters our small board does not hold are left out; a league the
// API has never read is left out and the others are kept; the directory
// comes through the kept directory (Sleeper's read carries none).
func TestStartersOnOurBoard(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	svc := replayService(pool)
	read, err := svc.Poller.Read(ctx, Ref{Host: HostSleeper, LeagueID: ReplaySleeperLeague})
	if err != nil {
		t.Fatal(err)
	}
	if read.Snapshot.Players != nil {
		t.Fatal("the recorded Sleeper read carries a directory; the test means the Players.For path")
	}
	// Sleeper's id for Aaron Rodgers, whom smallBoard holds as 8439.
	const rodgers = "96"
	roster := 0
	var starters []string
	for _, team := range read.Snapshot.Teams {
		if slices.Contains(team.Starters, rodgers) {
			roster, starters = team.RosterID, team.Starters
		}
	}
	if roster == 0 {
		t.Fatal("no team in the recording starts Aaron Rodgers")
	}
	a := caller{t, svc, alice.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(roster)}}, "")
	var attached apitypes.LeagueSync
	if status != http.StatusCreated || json.Unmarshal(body, &attached) != nil {
		t.Fatalf("attach: %d %s", status, body)
	}
	// A second league the API has never read: no kept snapshot.
	if _, err := pool.Exec(ctx, `insert into app.league_links (account_id, host, host_league_id, host_season, roster_id)
		values ($1, 'sleeper', '999000111', 0, 1)`, alice.ID); err != nil {
		t.Fatal(err)
	}

	store := &Store{Pool: pool}
	reads := &StoredStarters{Links: store, Snapshots: store, Directory: memoryDirectory{memoryPlayers{replayHosts(time.Now)}},
		Boards: smallBoard{}, Log: quietLog()}
	got, err := reads.Starters(ctx, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].LinkID != attached.Id || got[0].LeagueName == "" {
		t.Fatalf("leagues %+v", got)
	}
	players := got[0].Players
	if len(players) == 0 || len(players) >= len(starters) {
		t.Fatalf("%d of %d starters placed", len(players), len(starters))
	}
	found := false
	for _, p := range players {
		if p.BoardID != "8439" && p.BoardID != "DST-MIN" {
			t.Fatalf("a starter on no board id our board holds: %+v", p)
		}
		if p.BoardID == "8439" {
			found = p.Name != "" && p.Position == "QB"
		}
	}
	if !found {
		t.Fatalf("Aaron Rodgers not among %+v", players)
	}
}
