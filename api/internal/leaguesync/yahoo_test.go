package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

const yahooFixtureLeague = "128934"

// yahooFixtureRead is the fixture league through the Yahoo parsers.
func yahooFixtureRead(t *testing.T) yahoo.League {
	t.Helper()
	dir := filepath.Join("..", "hosts", "yahoo", "testdata")
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	l, err := yahoo.ParseLeague(read("yahoo-league-head.xml"), read("yahoo-league-rosters.xml"))
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// The fixture league as the snapshot every host fills: records, rosters
// by slot, every side's starters, the moves, the lineup, the scoring, and
// a player the id map names placed on our board by id.
func TestYahooSnapshot(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	l := yahooFixtureRead(t)
	l.Waivers = []yahoo.Waiver{{Player: yahoo.Player{ID: "35010", Name: "Tank Bigsby", Position: "RB", Team: "JAX"}, Until: "2026-10-16"}}
	snap := yahooSnapshot(l, map[string]string{"30977": "board-allen"}, now)
	unread := l
	unread.Waivers, unread.WaiversErr = nil, errors.New("waiver wire refused")
	if u := yahooSnapshot(unread, nil, now); !u.PoolUnknown || len(u.Pool) != 0 || len(u.Teams) != 10 {
		t.Fatalf("an unread waiver wire: unknown %v, pool %v", u.PoolUnknown, u.Pool)
	}
	if len(snap.Pool) != 1 || snap.Pool[0] != (PoolPlayer{PlayerID: "35010", Status: PoolWaivers, Until: "2026-10-16"}) || snap.Players["35010"].Name != "Tank Bigsby" {
		t.Fatalf("the waiver pool: %+v", snap.Pool)
	}
	if snap.Ref.Key() != "yahoo/2026/128934" || snap.Week != 6 || snap.Status != "in_season" || len(snap.Teams) != 10 {
		t.Fatalf("league %s week %d status %s, %d teams", snap.Ref.Key(), snap.Week, snap.Status, len(snap.Teams))
	}
	me, _ := snap.TeamByRoster(1)
	if me.Owner != "Justin" || me.Wins != 4 || len(me.Players) != 13 || len(me.Starters) != 10 || !slices.Equal(me.Reserve, []string{"31002"}) {
		t.Fatalf("team 1: %+v", me)
	}
	if p := snap.Players["30977"]; p.ESPNID != "board-allen" || p.Team != "BUF" || p.Position != "QB" {
		t.Fatalf("Josh Allen: %+v", p)
	}
	if p := snap.Players["31002"]; !p.InjuredReserve {
		t.Fatalf("the IR mark: %+v", p)
	}
	if len(snap.Matchups) != 10 || snap.Matchups[0].RosterID != 1 || snap.Matchups[1].Game != 1 || len(snap.Matchups[0].Starters) != 10 ||
		snap.Matchups[1].Points != 101.4 {
		t.Fatalf("matchups %+v", snap.Matchups[:2])
	}
	if len(snap.Moves) != 3 || snap.Moves[0].Kind != MoveWaiver || !slices.Equal(snap.Moves[2].RosterIDs, []int{2, 3}) {
		t.Fatalf("moves %+v", snap.Moves)
	}
	if _, ok := snap.Players["29999"]; !ok {
		t.Fatal("a dropped player is not named")
	}
	want := Shape{Teams: 10, QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1, Flex: 1, Bench: 6}
	sh := snap.Shape
	if sh.Teams != want.Teams || sh.QB != 1 || sh.RB != 2 || sh.WR != 3 || sh.Flex != 1 || sh.Bench != 6 || sh.DEF != 1 || len(sh.Unfollowed) != 0 {
		t.Fatalf("shape %+v", sh)
	}
	if NearestPreset(snap.Scoring.Rules) != apitypes.ScoringPresetHalfPpr {
		t.Fatalf("scores like %s", NearestPreset(snap.Scoring.Rules))
	}
	if _, reason := SettingsFor(snap); reason != "" {
		t.Fatalf("a mock cannot rerun it: %s", reason)
	}
	for _, id := range namedPlayers(snap) {
		if p, ok := snap.Players[id]; !ok || p.Name == "" {
			t.Fatalf("player %s not named", id)
		}
	}
}

// A receiver-only flex and a defender slot are named, not guessed at.
func TestYahooShapeNamesWhatTheRoomsCannotDraft(t *testing.T) {
	sh := yahooShape(yahoo.Settings{Slots: []yahoo.Slot{{Position: "QB", Count: 1}, {Position: "W/R", Count: 1}, {Position: "LB", Count: 2}, {Position: "Q/W/R/T", Count: 1}}}, 12)
	if !slices.Equal(sh.Unfollowed, []string{"LB", "W/R"}) || sh.SuperFlex != 1 {
		t.Fatalf("shape %+v", sh)
	}
}

func TestYahooParse(t *testing.T) {
	y := &Yahoo{}
	for in, want := range map[string]string{
		"128934": "128934", "https://football.fantasysports.yahoo.com/f1/128934": "128934",
		"https://football.fantasysports.yahoo.com/f1/128934/3": "128934",
	} {
		ref, err := y.Parse(in)
		if err != nil || ref.LeagueID != want || ref.Host != HostYahoo {
			t.Fatalf("%q: %+v %v", in, ref, err)
		}
	}
	for _, bad := range []string{"https://evil.example/f1/1", "http://football.fantasysports.yahoo.com/f1/1", "abc", ""} {
		if _, err := y.Parse(bad); err == nil {
			t.Fatalf("%q parsed", bad)
		}
	}
	if !y.Owns("https://football.fantasysports.yahoo.com/f1/1") || y.Owns("https://sleeper.com/leagues/1") {
		t.Fatal("owns")
	}
}

// fakeYahooMember answers the fixture league for one account, and that
// it needs a reconnect once refused is set.
type fakeYahooMember struct {
	owner   uuid.UUID
	league  yahoo.League
	reads   int
	refused bool
	// boards is each week's scoreboard the schedule keeper reads.
	boards map[int]yahoo.Scoreboard
	asked  [][]int
}

func (f *fakeYahooMember) Scoreboards(_ context.Context, accountID uuid.UUID, _ int, _ string, weeks []int) ([]yahoo.Scoreboard, error) {
	if accountID != f.owner {
		return nil, hosts.ErrNotConnected
	}
	f.asked = append(f.asked, weeks)
	out := make([]yahoo.Scoreboard, 0, len(weeks))
	for _, w := range weeks {
		out = append(out, f.boards[w])
	}
	return out, nil
}

func (f *fakeYahooMember) ReadLeague(_ context.Context, accountID uuid.UUID, _ int, leagueID string) (yahoo.League, error) {
	if accountID != f.owner {
		return yahoo.League{}, hosts.ErrNotConnected
	}
	if f.refused {
		return yahoo.League{}, yahoo.ErrReconnect
	}
	if leagueID != yahooFixtureLeague {
		return yahoo.League{}, yahoo.ErrNoSuchLeague
	}
	f.reads++
	return f.league, nil
}

// A Yahoo league attaches from the member's list and reads as them, at
// their own team; an account with no connection is told to connect; a
// league outside the list is refused; a refused refresh shows on the
// league as a reconnect, and a disconnect stops the reads.
func TestAttachYahoo(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_yahoo_alice", Email: "ya@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_yahoo_bob", Email: "yb@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{now: time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)}
	vault, _ := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	sealed, err := yahoo.Seal(vault, alice.ID, yahoo.Tokens{Access: "a", Refresh: "r", Expiry: clock.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&hosts.Store{Pool: pool}).Put(ctx, alice.ID, yahoo.Host, sealed, clock.now); err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	member := &fakeYahooMember{owner: alice.ID, league: yahooFixtureRead(t)}
	host := &Yahoo{Member: member, Now: clock.Now}
	hostList := Hosts{host}
	svc := &Service{
		Hosts: hostList, Poller: &Poller{Hosts: hostList, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hostList}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
	a, b := caller{t, svc, alice.ID}, caller{t, svc, bob.ID}
	yh := apitypes.LeagueHostYahoo

	if status, body := b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &yh, Link: yahooFixtureLeague}, ""); status != http.StatusConflict {
		t.Fatalf("bob with no connection: %d %s", status, body)
	}
	if status, _ := a.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &yh, Link: "999"}, ""); status != http.StatusBadRequest {
		t.Fatalf("a league outside the list: %d", status)
	}
	if status, _ := a.do(svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Host: &yh, Link: yahooFixtureLeague}, ""); status != http.StatusBadRequest {
		t.Fatalf("a Yahoo preview: %d", status)
	}
	var got apitypes.LeagueSync
	status, body := a.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &yh, Link: yahooFixtureLeague}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil {
		t.Fatalf("attach: %d %s", status, body)
	}
	if got.Me != 1 || got.Host != yh || got.Season != 2026 || len(got.Teams) != 10 || len(got.Roster) != 13 || got.SettingsLeagueId == nil ||
		got.Matchup == nil || got.Matchup.Opponent == nil || got.Matchup.Opponent.RosterId != 2 {
		t.Fatalf("the league: me %d, season %d, %d teams, %d on my roster, matchup %+v", got.Me, got.Season, len(got.Teams), len(got.Roster), got.Matchup)
	}
	followed, err := store.FollowedIDs(ctx, alice.ID, HostYahoo)
	if err != nil || !followed[hosts.FollowKey(yahooFixtureLeague, 2026)] {
		t.Fatalf("followed %v %v", followed, err)
	}
	// The league is read and kept as alice alone: her link reads as her,
	// and no read is kept for anyone else.
	link, err := store.Get(ctx, alice.ID, got.Id)
	if err != nil || link.Ref.As != alice.ID {
		t.Fatalf("alice's link reads as %s, %v", link.Ref.As, err)
	}
	ref := Ref{Host: HostYahoo, LeagueID: yahooFixtureLeague, Season: 2026}
	if _, found, err := store.LastSnapshot(ctx, ref); err != nil || found {
		t.Fatalf("a read kept for anyone: %v %v", found, err)
	}
	if _, found, err := store.LastSnapshot(ctx, link.Ref); err != nil || !found {
		t.Fatalf("alice's read not kept: %v %v", found, err)
	}
	// M1: a Yahoo league is never attached by its link and a team picked:
	// with no host the public path refuses it, and named as Yahoo it goes
	// the member path, which reads as bob alone and asks him to connect.
	roster := 2
	yahooLink := "https://football.fantasysports.yahoo.com/f1/128934"
	if status, _ := b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Link: yahooLink, Me: apitypes.AttachSeat{RosterId: &roster}}, ""); status != http.StatusBadRequest {
		t.Fatalf("bob's attach of a Yahoo link with a team picked: %d", status)
	}
	if status, _ := b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &yh, Link: yahooLink, Me: apitypes.AttachSeat{RosterId: &roster}}, ""); status != http.StatusConflict {
		t.Fatalf("bob's attach of a Yahoo link as Yahoo: %d", status)
	}
	if member.reads != 1 {
		t.Fatalf("%d reads, want alice's attach alone", member.reads)
	}

	// Yahoo refuses the refresh: the read keeps the last one, stale, and
	// says a reconnect mends it.
	member.refused = true
	clock.now = clock.now.Add(2 * MinUpstreamGap)
	for _, read := range []func(http.ResponseWriter, *http.Request){svc.refresh, svc.sync} {
		status, body = a.do(read, http.MethodPost, "/", nil, got.Id.String())
		if status != http.StatusOK || json.Unmarshal(body, &got) != nil || !got.HostFailed || !got.HostSignedOut || got.HostStaleSeconds == 0 {
			t.Fatalf("the view after a refused token: %d failed %v signed out %v", status, got.HostFailed, got.HostSignedOut)
		}
	}

}
