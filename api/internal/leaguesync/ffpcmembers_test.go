package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// bobLTUID is the second member's own league-team id in the fixture league.
const bobLTUID = "F3C-0000000000B0"

// ffpcSeat is one member's own team in an FFPC league: the league-team
// id their list opens, and the league as their pages show it.
type ffpcSeat struct {
	ltuid  string
	league ffpc.League
}

// ffpcMembers answers each connected member their own pages, signs out
// whom the test says, and records every read by the account it was made
// as and the league-team id it was made with.
type ffpcMembers struct {
	mu        sync.Mutex
	seats     map[uuid.UUID]ffpcSeat
	signedOut map[uuid.UUID]bool
	reads     []ffpcRead
}

type ffpcRead struct {
	as    uuid.UUID
	ltuid string
}

func (m *ffpcMembers) ReadLeague(_ context.Context, accountID uuid.UUID, ltuid string, _ bool) (ffpc.League, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reads = append(m.reads, ffpcRead{as: accountID, ltuid: ltuid})
	seat, ok := m.seats[accountID]
	if !ok {
		return ffpc.League{}, hosts.ErrNotConnected
	}
	if m.signedOut[accountID] {
		return ffpc.League{}, ffpc.ErrNeedsSignIn
	}
	if ltuid != seat.ltuid {
		// FFPC opens a league-team page only for its own member.
		return ffpc.League{}, ffpc.ErrNoSuchLeague
	}
	return seat.league, nil
}

func (m *ffpcMembers) OpenLeague(_ context.Context, accountID uuid.UUID, leagueID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	seat, ok := m.seats[accountID]
	if !ok {
		return "", hosts.ErrNotConnected
	}
	if leagueID != seat.league.Banner.LeagueID {
		return "", ffpc.ErrNoSuchLeague
	}
	return seat.ltuid, nil
}

// readsAs is how many reads were made as the account.
func (m *ffpcMembers) readsAs(id uuid.UUID) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.reads {
		if r.as == id {
			n++
		}
	}
	return n
}

// bobsLeague is the fixture league as team 3's member sees it: their own
// banner and lineup, the scoring page's card (another team's) unread.
func bobsLeague(t *testing.T) ffpc.League {
	t.Helper()
	l := fixtureLeagueRead(t)
	l.Banner.TeamID = 3
	l.Banner.TeamName = ""
	for _, s := range l.Standings {
		if s.TeamID == 3 {
			l.Banner.TeamName = s.Name
		}
	}
	for _, r := range l.Rosters {
		if r.TeamID == 3 {
			l.Lineup = &ffpc.Lineup{Week: 6, Starters: r.Players[:2], Bench: r.Players[2:]}
		}
	}
	if l.Banner.TeamName == "" || l.Lineup == nil {
		t.Fatal("the fixture has no team 3")
	}
	return l
}

type ffpcRig struct {
	svc     *Service
	clock   *fakeClock
	members *ffpcMembers
	store   *Store
	conns   *hosts.Store
}

// newFFPCRig is the FFPC host behind the service, with Alice (team 11)
// and Bob (team 3) each connected to FFPC with their own sign-in.
func newFFPCRig(t *testing.T) (ffpcRig, uuid.UUID, uuid.UUID) {
	t.Helper()
	pool := dbtest.Pool(t)
	ctx := context.Background()
	clock := &fakeClock{now: time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC)}
	vault, err := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	conns := &hosts.Store{Pool: pool}
	ids := make([]uuid.UUID, 0, 2)
	for _, n := range []string{"alice", "bob"} {
		a, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_ffpc_" + n, Email: n + "@example.invalid"})
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := vault.Seal(a.ID.String(), ffpc.Host, hosts.Session{"BGSLMSession": "test"}, hosts.SignIn{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conns.Put(ctx, a.ID, ffpc.Host, sealed, clock.now); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, a.ID)
	}
	alice, bob := ids[0], ids[1]
	members := &ffpcMembers{
		seats: map[uuid.UUID]ffpcSeat{
			alice: {ltuid: fixtureLTUID, league: fixtureLeagueRead(t)},
			bob:   {ltuid: bobLTUID, league: bobsLeague(t)},
		},
		signedOut: map[uuid.UUID]bool{},
	}
	store := &Store{Pool: pool}
	host := &FFPC{Member: members, TeamKeys: store, Now: clock.Now}
	hostList := Hosts{host}
	svc := &Service{
		Hosts: hostList, Poller: &Poller{Hosts: hostList, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hostList}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, FFPC: host, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
	return ffpcRig{svc: svc, clock: clock, members: members, store: store, conns: conns}, alice, bob
}

func (r ffpcRig) attach(t *testing.T, as uuid.UUID) apitypes.LeagueSync {
	t.Helper()
	fh := apitypes.LeagueHostFfpc
	var got apitypes.LeagueSync
	status, body := caller{t, r.svc, as}.do(r.svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &fh, Link: fixtureLeague}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil {
		t.Fatalf("attach: %d %s", status, body)
	}
	return got
}

func (r ffpcRig) refresh(t *testing.T, as uuid.UUID, id uuid.UUID) apitypes.LeagueSync {
	t.Helper()
	var got apitypes.LeagueSync
	status, body := caller{t, r.svc, as}.do(r.svc.refresh, http.MethodPost, "/", nil, id.String())
	if status != http.StatusOK || json.Unmarshal(body, &got) != nil {
		t.Fatalf("refresh: %d %s", status, body)
	}
	return got
}

// Two members of one FFPC league each attach it from their own list, are
// read as themselves alone, and are kept apart: each read is stored under
// its reader, and neither member's lineup reaches the other.
func TestTwoFFPCMembersReadOneLeagueApart(t *testing.T) {
	rig, alice, bob := newFFPCRig(t)
	ctx := context.Background()

	mine, theirs := rig.attach(t, alice), rig.attach(t, bob)
	if mine.Me != 11 || theirs.Me != 3 {
		t.Fatalf("seats: alice %d, bob %d", mine.Me, theirs.Me)
	}
	if rig.members.readsAs(alice) != 1 || rig.members.readsAs(bob) != 1 {
		t.Fatalf("reads %+v", rig.members.reads)
	}
	for _, read := range rig.members.reads {
		want := map[uuid.UUID]string{alice: fixtureLTUID, bob: bobLTUID}[read.as]
		if read.ltuid != want {
			t.Fatalf("a read as %s with league-team %s", read.as, read.ltuid)
		}
	}

	ref := Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026}
	var shared, kept int
	if err := rig.store.Pool.QueryRow(ctx, `select count(*) filter (where read_as = '00000000-0000-0000-0000-000000000000'),
		count(*) filter (where read_as in ($1, $2)) from app.league_snapshots where host = 'ffpc'`, alice, bob).Scan(&shared, &kept); err != nil {
		t.Fatal(err)
	}
	if shared != 0 || kept != 2 {
		t.Fatalf("%d shared FFPC reads and %d member reads kept, want 0 and 2", shared, kept)
	}
	asAlice, asBob := ref, ref
	asAlice.As, asBob.As = alice, bob
	hers, _, err := rig.store.LastSnapshot(ctx, asAlice)
	if err != nil {
		t.Fatal(err)
	}
	his, _, err := rig.store.LastSnapshot(ctx, asBob)
	if err != nil {
		t.Fatal(err)
	}
	if team, _ := hers.TeamByRoster(11); len(team.Starters) != 10 {
		t.Fatalf("alice's read has her starters: %v", team.Starters)
	}
	if team, _ := his.TeamByRoster(11); len(team.Starters) != 0 {
		t.Fatalf("bob's read carries alice's starters: %v", team.Starters)
	}
	if team, _ := his.TeamByRoster(3); len(team.Starters) != 2 {
		t.Fatalf("bob's read has his starters: %v", team.Starters)
	}

	// One upstream read per league per interval per reading account: the
	// views inside the minute answer each member's own kept read.
	before := rig.svc.Poller.Upstream()
	for range 3 {
		for _, c := range []struct {
			as uuid.UUID
			id uuid.UUID
		}{{alice, mine.Id}, {bob, theirs.Id}} {
			if status, body := (caller{t, rig.svc, c.as}).do(rig.svc.sync, http.MethodGet, "/", nil, c.id.String()); status != http.StatusOK {
				t.Fatalf("view: %d %s", status, body)
			}
		}
	}
	if got := rig.svc.Poller.Upstream() - before; got != 0 {
		t.Fatalf("%d reads upstream inside the minute", got)
	}
	rig.clock.now = rig.clock.now.Add(2 * MinUpstreamGap)
	mine, theirs = rig.refresh(t, alice, mine.Id), rig.refresh(t, bob, theirs.Id)
	if rig.members.readsAs(alice) != 2 || rig.members.readsAs(bob) != 2 {
		t.Fatalf("after one refresh each: alice %d, bob %d", rig.members.readsAs(alice), rig.members.readsAs(bob))
	}
	if mine.Me != 11 || theirs.Me != 3 {
		t.Fatalf("seats after the refresh: alice %d, bob %d", mine.Me, theirs.Me)
	}
}

// A member whose FFPC sign-in lapses sees their own league stale, with
// the reconnect sentence; their league-mate's attachment reads on as them.
func TestFFPCSignInLapsesForOneMemberAlone(t *testing.T) {
	rig, alice, bob := newFFPCRig(t)
	mine, theirs := rig.attach(t, alice), rig.attach(t, bob)

	rig.members.signedOut[alice] = true
	rig.clock.now = rig.clock.now.Add(2 * MinUpstreamGap)
	mine = rig.refresh(t, alice, mine.Id)
	if !mine.HostSignedOut || !mine.HostFailed || mine.HostStaleSeconds <= 0 || mine.Me != 11 || len(mine.Teams) != 12 {
		t.Fatalf("alice signed out: signed out %v failed %v stale %d", mine.HostSignedOut, mine.HostFailed, mine.HostStaleSeconds)
	}
	theirs = rig.refresh(t, bob, theirs.Id)
	if theirs.HostSignedOut || theirs.HostFailed || theirs.HostStaleSeconds != 0 {
		t.Fatalf("bob still reads: signed out %v failed %v stale %d", theirs.HostSignedOut, theirs.HostFailed, theirs.HostStaleSeconds)
	}
	if rig.members.readsAs(bob) != 2 {
		t.Fatalf("bob's reads %d, want his attach and his refresh", rig.members.readsAs(bob))
	}
	for _, read := range rig.members.reads {
		if read.as == bob && read.ltuid != bobLTUID {
			t.Fatalf("bob read with %s", read.ltuid)
		}
	}
}

// The background read reads each connected member's own attachment as
// them, and none for a member signed out.
func TestFFPCBackgroundReadIsPerMember(t *testing.T) {
	rig, alice, bob := newFFPCRig(t)
	ctx := context.Background()
	rig.attach(t, alice)
	rig.attach(t, bob)

	refs, err := rig.store.FFPCLeagues(ctx)
	if err != nil {
		t.Fatal(err)
	}
	as := map[uuid.UUID]bool{}
	for _, ref := range refs {
		if ref.Host != HostFFPC || ref.LeagueID != fixtureLeague || ref.Season != 2026 {
			t.Fatalf("ref %+v", ref)
		}
		as[ref.As] = true
	}
	if len(refs) != 2 || !as[alice] || !as[bob] {
		t.Fatalf("background reads %+v", refs)
	}
	if err := rig.conns.SignedOut(ctx, alice, ffpc.Host); err != nil {
		t.Fatal(err)
	}
	refs, err = rig.store.FFPCLeagues(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].As != bob {
		t.Fatalf("with alice signed out: %+v", refs)
	}
	snap, err := rig.svc.FFPC.Read(ctx, refs[0])
	if err != nil || snap.Ref.As != bob {
		t.Fatalf("bob's background read: as %s, %v", snap.Ref.As, err)
	}
	if team, _ := snap.TeamByRoster(3); len(team.Starters) != 2 {
		t.Fatalf("bob's background read is not his: %v", team.Starters)
	}
}

// An FFPC league is never read for anyone but the account that attached
// it: a ref with no account, or an account with no attachment of its own,
// has no reader, and no member's sign-in is tried for it.
func TestFFPCReadsOnlyAsItsOwnMember(t *testing.T) {
	rig, alice, bob := newFFPCRig(t)
	ctx := context.Background()
	rig.attach(t, alice)
	before := len(rig.members.reads)

	ref := Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026}
	if _, err := rig.svc.FFPC.Read(ctx, ref); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("a read as no one: %v", err)
	}
	ref.As = bob
	if _, err := rig.svc.FFPC.Read(ctx, ref); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("a read as bob, who attached nothing: %v", err)
	}
	if len(rig.members.reads) != before {
		t.Fatalf("reads made for no attachment: %+v", rig.members.reads[before:])
	}
}

// A member whose attachment has no read of their own and no FFPC
// connection (an attachment that rode another member's sign-in before
// 00023) is told to connect FFPC, and no one else's sign-in is tried.
func TestFFPCMemberWithNoConnectionIsToldToConnect(t *testing.T) {
	rig, alice, _ := newFFPCRig(t)
	ctx := context.Background()
	delete(rig.members.seats, alice)
	link, err := rig.store.Save(ctx, Link{
		AccountID: alice, Ref: Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026, As: alice},
		RosterID: 11, TeamKey: fixtureLTUID,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	status, body := caller{t, rig.svc, alice}.do(rig.svc.sync, http.MethodGet, "/", nil, link.ID.String())
	if status != http.StatusConflict {
		t.Fatalf("no connection: %d %s", status, body)
	}
	w := httptest.NewRecorder()
	if !writeMemberError(w, httptest.NewRequest(http.MethodGet, "/", nil), HostFFPC, ErrNotConnected) ||
		!strings.Contains(w.Body.String(), "Connect FFPC to keep this league in sync.") {
		t.Fatalf("the words: %s", w.Body.String())
	}
	for _, read := range rig.members.reads {
		if read.as != alice {
			t.Fatalf("a read as %s for alice's league", read.as)
		}
	}
}
