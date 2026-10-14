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

// fakeESPNMember reads the fixture with the cookies of the accounts it
// holds as connected, and records every account a read was made as.
type fakeESPNMember struct {
	connected map[uuid.UUID]string
	league    espn.FullLeague
	refused   bool
	as        []uuid.UUID
}

func (f *fakeESPNMember) Cookies(_ context.Context, accountID uuid.UUID) (espn.Cookies, error) {
	swid, ok := f.connected[accountID]
	if !ok {
		return espn.Cookies{}, hosts.ErrNotConnected
	}
	return espn.Cookies{SWID: swid}, nil
}

func (f *fakeESPNMember) ReadLeague(_ context.Context, accountID uuid.UUID, leagueID string, _ int) (espn.FullLeague, error) {
	if _, ok := f.connected[accountID]; !ok {
		return espn.FullLeague{}, hosts.ErrNotConnected
	}
	f.as = append(f.as, accountID)
	if f.refused {
		return espn.FullLeague{}, espnhost.ErrReconnect
	}
	if leagueID != espnFixtureLeague {
		return espn.FullLeague{}, espn.ErrNotFound
	}
	return f.league, nil
}

// readAs counts the reads made as one account.
func (f *fakeESPNMember) readAs(id uuid.UUID) int {
	n := 0
	for _, a := range f.as {
		if a == id {
			n++
		}
	}
	return n
}

// fakePublic answers the league to the public, or refuses it as private.
type fakePublic struct {
	league  espn.FullLeague
	private bool
	reads   int
}

func (f *fakePublic) Read(_ context.Context, _ string, _ int, cookies *espn.Cookies) (espn.FullLeague, error) {
	if cookies != nil {
		panic("a public read was handed cookies")
	}
	f.reads++
	if f.private {
		return espn.FullLeague{}, espn.ErrPrivate
	}
	return f.league, nil
}

type espnRig struct {
	svc    *Service
	clock  *fakeClock
	member *fakeESPNMember
	public *fakePublic
	store  *Store
}

// newESPNRig is the service over one freshly migrated database, with
// alice and bob as accounts and alice alone connected to ESPN.
func newESPNRig(t *testing.T) (espnRig, uuid.UUID, uuid.UUID) {
	t.Helper()
	pool := dbtest.Pool(t)
	ids := make([]uuid.UUID, 0, 2)
	for _, n := range []string{"alice", "bob"} {
		a, err := (&auth.Store{Pool: pool}).UpsertAccount(context.Background(), auth.Identity{UserID: "user_espn_" + n, Email: n + "@example.invalid"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, a.ID)
	}
	connected := map[uuid.UUID]string{ids[0]: espnFixtureSWID}
	clock := &fakeClock{now: time.Date(2019, 12, 20, 12, 0, 0, 0, time.UTC)}
	store := &Store{Pool: pool}
	fixture := espnFixtureRead(t)
	member := &fakeESPNMember{connected: connected, league: fixture}
	public := &fakePublic{league: fixture}
	host := &ESPN{Member: member, Public: public, Now: clock.Now}
	hostList := Hosts{host}
	svc := &Service{
		Hosts: hostList, Poller: &Poller{Hosts: hostList, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hostList}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
	return espnRig{svc: svc, clock: clock, member: member, public: public, store: store}, ids[0], ids[1]
}

const espnLink = "https://fantasy.espn.com/football/league?leagueId=48153503&seasonId=2019"

// A public league follows by link with a team picked, for anyone, read
// with no cookies at all; the same league attached as a member is read
// with that member's own cookies, for them alone.
func TestAttachESPNPublic(t *testing.T) {
	rig, alice, bob := newESPNRig(t)
	a, b := caller{t, rig.svc, alice}, caller{t, rig.svc, bob}
	eh := apitypes.LeagueHostEspn

	if status, body := b.do(rig.svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Host: &eh, Link: espnLink}, ""); status != http.StatusOK {
		t.Fatalf("a public preview: %d %s", status, body)
	}
	var got apitypes.LeagueSync
	roster := 5
	status, body := b.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink, Me: apitypes.AttachSeat{RosterId: &roster}}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 5 || len(got.Teams) != 14 {
		t.Fatalf("bob's public attach: %d %s", status, body)
	}
	roster = 3
	status, body = a.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink, Me: apitypes.AttachSeat{RosterId: &roster}}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 3 {
		t.Fatalf("alice's public attach: %d %s", status, body)
	}
	if len(rig.member.as) != 0 {
		t.Fatalf("a public league was read with cookies, as %v", rig.member.as)
	}
	// Bob, unconnected, from a list: told to connect, as FFPC's path says.
	if status, _ := b.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink}, ""); status != http.StatusConflict {
		t.Fatalf("an unconnected member attach: %d", status)
	}
	// Alice from her list: seated by her SWID, read as her.
	status, body = a.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 1 || rig.member.readAs(alice) != 1 {
		t.Fatalf("alice's member attach: %d me %d %s", status, got.Me, body)
	}
}

// C1: Alice attaches her private league with her cookies. Bob, in no
// league with her, previews and attaches the same link, by link and from
// a list: each is refused, and no read is ever made with Alice's cookies
// for him. Alice's own reads stay hers; when ESPN refuses her cookies the
// private league asks her to connect again.
func TestPrivateESPNLeagueIsReadOnlyForItsMember(t *testing.T) {
	rig, alice, bob := newESPNRig(t)
	rig.public.private = true
	a, b := caller{t, rig.svc, alice}, caller{t, rig.svc, bob}
	eh := apitypes.LeagueHostEspn

	var got apitypes.LeagueSync
	status, body := a.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil || got.Me != 1 {
		t.Fatalf("alice attaches her private league: %d %s", status, body)
	}
	aliceReads := rig.member.readAs(alice)

	if status, _ := b.do(rig.svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Host: &eh, Link: espnLink}, ""); status != http.StatusUnprocessableEntity {
		t.Fatalf("bob's preview of a private league: %d", status)
	}
	if status, _ := b.do(rig.svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Link: espnLink}, ""); status != http.StatusUnprocessableEntity {
		t.Fatalf("bob's preview with no host: %d", status)
	}
	roster := 1
	if status, _ := b.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink, Me: apitypes.AttachSeat{RosterId: &roster}}, ""); status != http.StatusUnprocessableEntity {
		t.Fatalf("bob's attach by link: %d", status)
	}
	if status, _ := b.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Link: espnLink, Me: apitypes.AttachSeat{RosterId: &roster}}, ""); status != http.StatusUnprocessableEntity {
		t.Fatalf("bob's attach by link with no host: %d", status)
	}
	if status, _ := b.do(rig.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &eh, Link: espnLink}, ""); status != http.StatusConflict {
		t.Fatalf("bob's attach from a list with no connection: %d", status)
	}
	if rig.member.readAs(alice) != aliceReads || rig.member.readAs(bob) != 0 {
		t.Fatalf("reads as %v for bob's asks", rig.member.as)
	}
	if list, err := rig.store.Attached(context.Background(), bob); err != nil || len(list) != 0 {
		t.Fatalf("bob follows %d leagues, %v", len(list), err)
	}

	// Alice's league reads as her, and when ESPN refuses her cookies it
	// keeps its last read and asks her to connect again.
	rig.member.refused = true
	rig.clock.now = rig.clock.now.Add(2 * MinUpstreamGap)
	status, body = a.do(rig.svc.refresh, http.MethodPost, "/", nil, got.Id.String())
	if status != http.StatusOK || json.Unmarshal(body, &got) != nil || !got.HostSignedOut {
		t.Fatalf("a refused member on a private league: %d signed out %v", status, got.HostSignedOut)
	}
	if rig.member.readAs(bob) != 0 {
		t.Fatal("a read was made as bob")
	}
}
