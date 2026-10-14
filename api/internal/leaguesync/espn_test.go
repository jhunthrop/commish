package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

const espnFixtureLeague = "48153503"

// espnFixtureSWID owns team 1 in the fixture (its members' ids replaced).
const espnFixtureSWID = "{00000011-0000-4000-8000-000000000011}"

// espnFixtureRead is the recorded public league through the ESPN reader.
func espnFixtureRead(t *testing.T) espn.FullLeague {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "espn", "testdata", "league-48153503-2019-full.json"))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	c := &espn.Client{HTTP: srv.Client(), Base: srv.URL}
	l, err := c.Read(context.Background(), espnFixtureLeague, 2019, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// The recorded league as the snapshot every host fills: fourteen teams
// with owners and records, rosters by slot, every side's starters, a
// defense placed by its team and everyone else by ESPN's own id, the
// lineup and the scoring.
func TestESPNSnapshot(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	snap := espnSnapshot(espnFixtureRead(t), now)
	if snap.Ref.Key() != "espn/2019/48153503" || snap.Week != 18 || len(snap.Teams) != 14 || snap.Name != "Agbo Superhero League" {
		t.Fatalf("league %s week %d, %d teams", snap.Ref.Key(), snap.Week, len(snap.Teams))
	}
	one, _ := snap.TeamByRoster(1)
	if one.Name != "TEAM BERRY" || one.Owner == "" || one.Wins != 8 || len(one.Players) != 12 || len(one.Starters) != 7 {
		t.Fatalf("team 1: %+v", one)
	}
	if p := snap.Players["-16033"]; p.Position != "DEF" || p.Team != "BAL" || p.ESPNID != "" {
		t.Fatalf("the defense: %+v", p)
	}
	if p := snap.Players["16733"]; p.ESPNID != "16733" || p.Position != "WR" {
		t.Fatalf("a receiver: %+v", p)
	}
	if len(snap.Matchups) != 14 || snap.Matchups[0].RosterID != 3 || snap.Matchups[1].RosterID != 9 || snap.Matchups[0].Game != snap.Matchups[1].Game {
		t.Fatalf("matchups %+v", snap.Matchups[:2])
	}
	sh := snap.Shape
	if sh.Teams != 14 || sh.QB != 1 || sh.RB != 1 || sh.WR != 1 || sh.Flex != 2 || sh.DEF != 1 || sh.K != 1 || sh.Bench != 5 || len(sh.Unfollowed) != 0 {
		t.Fatalf("shape %+v", sh)
	}
	if len(snap.Scoring.Rules) != 21 || len(snap.Moves) != 0 {
		t.Fatalf("rules %v", snap.Scoring.Rules)
	}
	if _, reason := SettingsFor(snap); reason != "" {
		t.Fatalf("a mock cannot rerun it: %s", reason)
	}
}

func TestESPNParseAndOwns(t *testing.T) {
	e := &ESPN{Now: func() time.Time { return time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC) }}
	ref, err := e.Parse("https://fantasy.espn.com/football/league?leagueId=48153503")
	if err != nil || ref.Season != 2026 || ref.LeagueID != espnFixtureLeague {
		t.Fatalf("%+v %v", ref, err)
	}
	if !e.Owns("https://fantasy.espn.com/football/league?leagueId=1") || e.Owns("48153503") || e.Owns("https://sleeper.com/leagues/1") {
		t.Fatal("owns")
	}
}

// fakeESPNMember reads the fixture with one account's cookies, and
// refuses them once refused is set.
type fakeESPNMember struct {
	owner   uuid.UUID
	league  espn.FullLeague
	refused bool
	reads   int
}

func (f *fakeESPNMember) Cookies(_ context.Context, accountID uuid.UUID) (espn.Cookies, error) {
	if accountID != f.owner {
		return espn.Cookies{}, hosts.ErrNotConnected
	}
	return espn.Cookies{SWID: espnFixtureSWID}, nil
}

func (f *fakeESPNMember) ReadLeague(_ context.Context, accountID uuid.UUID, leagueID string, _ int) (espn.FullLeague, error) {
	if accountID != f.owner {
		return espn.FullLeague{}, hosts.ErrNotConnected
	}
	if f.refused {
		return espn.FullLeague{}, espnhost.ErrReconnect
	}
	if leagueID != espnFixtureLeague {
		return espn.FullLeague{}, espn.ErrNotFound
	}
	f.reads++
	return f.league, nil
}

// fakePublic answers the league to the public, or refuses it as private.
type fakePublic struct {
	league  espn.FullLeague
	private bool
	reads   int
}

func (f *fakePublic) Read(context.Context, string, int, *espn.Cookies) (espn.FullLeague, error) {
	f.reads++
	if f.private {
		return espn.FullLeague{}, espn.ErrPrivate
	}
	return f.league, nil
}

// A public ESPN league follows by link with a team picked, no sign-in;
// a connected member follows from their list and is seated at the team
// their SWID owns; when ESPN refuses the member's cookies a public league
// still reads, a private one asks for a reconnect.
func TestAttachESPN(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_espn_alice", Email: "ea@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_espn_bob", Email: "eb@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{now: time.Date(2019, 12, 20, 12, 0, 0, 0, time.UTC)}
	vault, _ := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	sealed, err := espnhost.Seal(vault, alice.ID, espn.Cookies{SWID: espnFixtureSWID, S2: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&hosts.Store{Pool: pool}).Put(ctx, alice.ID, espnhost.Host, sealed, clock.now); err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	fixture := espnFixtureRead(t)
	member := &fakeESPNMember{owner: alice.ID, league: fixture}
	public := &fakePublic{league: fixture}
	host := &ESPN{Member: member, Public: public, Readers: store, Now: clock.Now}
	hostList := Hosts{host}
	svc := &Service{
		Hosts: hostList, Poller: &Poller{Hosts: hostList, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hostList}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
	a, b := caller{t, svc, alice.ID}, caller{t, svc, bob.ID}
	eh := apitypes.LeagueHostEspn
	link := "https://fantasy.espn.com/football/league?leagueId=48153503&seasonId=2019"

	// Bob: public, by link, a team picked.
	status, body := b.do(svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Host: &eh, Link: link}, "")
	if status != http.StatusOK {
		t.Fatalf("a public preview: %d %s", status, body)
	}
	roster := 5
	var got apitypes.LeagueSync
	status, body = b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: link, Me: apitypes.AttachSeat{RosterId: &roster}}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 5 || len(got.Teams) != 14 {
		t.Fatalf("a public attach: %d %s", status, body)
	}
	// Bob, unconnected, from a list: told to connect.
	if status, _ := b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: link}, ""); status != http.StatusConflict {
		t.Fatalf("an unconnected member attach: %d", status)
	}
	// Alice: from her list, seated by her SWID.
	status, body = a.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: link}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 1 {
		t.Fatalf("a member attach: %d me %d %s", status, got.Me, body)
	}
	ref := Ref{Host: HostESPN, LeagueID: espnFixtureLeague, Season: 2019}
	if reader, err := store.MemberReader(ctx, ref); err != nil || reader != alice.ID {
		t.Fatalf("reader %s %v", reader, err)
	}
	// ESPN refuses Alice's cookies: the league is public, so it still reads.
	member.refused = true
	before := public.reads
	clock.now = clock.now.Add(2 * MinUpstreamGap)
	if status, body := a.do(svc.refresh, http.MethodPost, "/", nil, got.Id.String()); status != http.StatusOK || public.reads != before+1 {
		t.Fatalf("a refused member on a public league: %d %s", status, body)
	}
	// And private: the read keeps the last one and asks for a reconnect.
	public.private = true
	clock.now = clock.now.Add(2 * MinUpstreamGap)
	status, body = a.do(svc.refresh, http.MethodPost, "/", nil, got.Id.String())
	if status != http.StatusOK || json.Unmarshal(body, &got) != nil || !got.HostSignedOut {
		t.Fatalf("a refused member on a private league: %d signed out %v", status, got.HostSignedOut)
	}
	if got.Me != 1 {
		t.Fatalf("seat moved: %d", got.Me)
	}
}
