package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
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
	"github.com/jhunthrop/commish/api/internal/scoring"
)

const (
	fixtureLeague = "104870"
	fixtureLTUID  = "F3C-781497793F8E"
)

// fixtureLeagueRead is the founder's captured league through every
// parser, as a member read would give it.
func fixtureLeagueRead(t *testing.T) ffpc.League {
	t.Helper()
	dir := filepath.Join("..", "hosts", "ffpc", "testdata")
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	pages := map[ffpc.PageName][]byte{
		ffpc.PageLeagueHome: read("ffpc-league-home.html"), ffpc.PageStandings: read("ffpc-standings.html"),
		ffpc.PageRosters: read("ffpc-rosters.html"), ffpc.PageLineup: read("ffpc-team-lineup.html"),
		ffpc.PageSchedule: read("ffpc-schedule.html"), ffpc.PageOwners: read("ffpc-owners.html"), ffpc.PageRules: read("ffpc-rules.html"),
		ffpc.PageScoreboard: read("ffpc-scoreboard.html"),
	}
	l, err := ffpc.Parse(pages, read("public-big-gorilla-official-rules.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Missing) != 0 {
		t.Fatalf("missing %v", l.Missing)
	}
	return l
}

// The standings are FFPC's own page (Lane 94, B21): the member's 2-3 is
// FFPC's record, never another league's, with FFPC's points against and
// streak; and the rules' four seeds, by record and points in turn, are
// the playoffs' terms, weeks 13 to 14, with no cut by record alone.
func TestFFPCStandingsAndPlayoffsAsFFPCStatesThem(t *testing.T) {
	snap := ffpcSnapshot(fixtureLeagueRead(t), time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC), 6)
	me, ok := snap.TeamByRoster(11)
	if !ok || me.Wins != 2 || me.Losses != 3 || me.PointsFor != 598.7 || me.PointsAgainst == nil || *me.PointsAgainst != 784.9 || me.Streak != "W1" {
		t.Fatalf("my standing %+v", me)
	}
	top, _ := snap.TeamByRoster(3)
	if top.Wins != 4 || top.Streak != "W4" || top.PointsAgainst == nil || *top.PointsAgainst != 655.25 {
		t.Fatalf("the leader %+v", top)
	}
	got := terms(snap)
	seeds := []apitypes.LeagueTermsPlayoffSeeds{"record", "points", "record", "points"}
	if got.PlayoffSeeds == nil || !slices.Equal(*got.PlayoffSeeds, seeds) {
		t.Fatalf("seeds %v", got.PlayoffSeeds)
	}
	if got.PlayoffWeeks == nil || got.PlayoffWeeks.First != 13 || got.PlayoffWeeks.Last != 14 {
		t.Fatalf("playoff weeks %+v", got.PlayoffWeeks)
	}
	if got.PlayoffTeams != nil {
		t.Fatalf("a field seeded on points too draws no cut by record, got %d teams", *got.PlayoffTeams)
	}
	allRecord := ffpcTerms(ffpc.Rules{PlayoffStartWeek: 15, PlayoffLastWeek: 17, Seeds: []string{ffpc.SeedRecord, ffpc.SeedRecord}})
	if allRecord.PlayoffTeams != 2 || len(allRecord.Seeds) != 2 {
		t.Fatalf("a field seeded on record alone %+v", allRecord)
	}
}

func TestFFPCSnapshotFromTheFixtures(t *testing.T) {
	now := time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC)
	snap := ffpcSnapshot(fixtureLeagueRead(t), now, 6)
	if snap.Ref.Key() != "ffpc/2026/104870" || snap.Season != 2026 || snap.Week != 6 || len(snap.Teams) != 12 {
		t.Fatalf("league %s season %d week %d, %d teams", snap.Ref.Key(), snap.Season, snap.Week, len(snap.Teams))
	}
	me, ok := snap.TeamByRoster(11)
	if !ok || me.Name != "My Ball Zach Ertz" || me.Owner != "jh0486" || me.Wins != 2 || me.Losses != 3 ||
		len(me.Players) != 20 || len(me.Starters) != 10 {
		t.Fatalf("my team %+v", me)
	}
	for _, tm := range snap.Teams {
		if tm.Name == "" || tm.Owner == "" || len(tm.Players) != 20 {
			t.Fatalf("team %d %q owner %q, %d players", tm.RosterID, tm.Name, tm.Owner, len(tm.Players))
		}
	}
	if len(snap.Scoring.Rules) != len(scoring.Rules()) || snap.Scoring.Rules["points_per_reception"] != 1 || snap.Scoring.Rules["te_reception_bonus"] != 0.5 ||
		snap.Scoring.Rules["points_per_passing_yard"] != 0.05 || snap.Scoring.Rules["points_per_interception"] != -1 {
		t.Fatalf("rules %v", snap.Scoring.Rules)
	}
	if NearestPreset(snap.Scoring.Rules) != apitypes.ScoringPresetTePremium {
		t.Fatalf("scores like %s", NearestPreset(snap.Scoring.Rules))
	}
	// Week 6 is an all-play week on FFPC's schedule ("All Play Week", no
	// games listed): the member's side stands alone with their starters,
	// scored from the scoring page (0.00, read).
	if !snap.AllPlay || len(snap.Matchups) != 1 || snap.Matchups[0].RosterID != 11 || len(snap.Matchups[0].Starters) != 10 ||
		snap.Matchups[0].PointsUnread {
		t.Fatalf("week 6: all play %v, sides %+v", snap.AllPlay, snap.Matchups)
	}
	// Without the scoring page the side says its score was not read.
	unscored := fixtureLeagueRead(t)
	unscored.Scoreboard = nil
	if side := ffpcSnapshot(unscored, now, 6).Matchups[0]; !side.PointsUnread {
		t.Fatalf("an unread score read as %+v", side)
	}
	want := Shape{Teams: 12, QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, Flex: 2, Bench: 10}
	if snap.Shape.Teams != want.Teams || snap.Shape.Bench != want.Bench || snap.Shape.Flex != want.Flex || len(snap.Shape.Unfollowed) != 0 {
		t.Fatalf("shape %+v", snap.Shape)
	}
	if _, reason := SettingsFor(snap); reason != "" {
		t.Fatalf("a mock cannot rerun it: %s", reason)
	}
	if len(snap.Moves) != 4 || snap.Moves[0].Kind != MoveAdd || len(snap.Moves[0].Adds) != 1 {
		t.Fatalf("moves %+v", snap.Moves)
	}
	for _, id := range namedPlayers(snap) {
		if p, ok := snap.Players[id]; !ok || p.Name == "" || p.Position == "" {
			t.Fatalf("player %s not named: %+v", id, p)
		}
	}
	if !slices.ContainsFunc(snap.Scoring.Dropped, func(s string) bool { return strings.Contains(s, "every yard thereafter") }) {
		t.Fatalf("dropped %q", snap.Scoring.Dropped)
	}
}

// fakeMember is a member read that answers the fixtures for one account
// and its league, and refuses any other.
type fakeMember struct {
	t      *testing.T
	owner  uuid.UUID
	league ffpc.League
	reads  int
}

func (f *fakeMember) ReadLeague(_ context.Context, accountID uuid.UUID, ltuid string, _ bool) (ffpc.League, error) {
	if accountID != f.owner || ltuid != fixtureLTUID {
		return ffpc.League{}, hosts.ErrNotConnected
	}
	f.reads++
	return f.league, nil
}

// ReadDraft answers the member's draft as done.
func (f *fakeMember) ReadDraft(_ context.Context, accountID uuid.UUID, _ string) (ffpc.Draft, error) {
	if accountID != f.owner {
		return ffpc.Draft{}, hosts.ErrNotConnected
	}
	return ffpc.Draft{Complete: true}, nil
}

func (f *fakeMember) OpenLeague(_ context.Context, accountID uuid.UUID, leagueID string) (string, error) {
	if accountID != f.owner {
		return "", hosts.ErrNotConnected
	}
	if leagueID != fixtureLeague {
		return "", ffpc.ErrNoSuchLeague
	}
	return fixtureLTUID, nil
}

// An FFPC league attaches from the member's own list and reads as them;
// an account with no connection is told to connect; a league outside the
// list is refused; the league reads again as the member alone.
func TestAttachFFPC(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_alice", Email: "alice@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	bob, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_bob", Email: "bob@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{now: time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC)}
	clock0 := clock.now
	// Alice's connection row, sealed under a throwaway key.
	vault, _ := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	sealed, err := vault.Seal(alice.ID.String(), ffpc.Host, hosts.Session{"BGSLMSession": "test"}, hosts.SignIn{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&hosts.Store{Pool: pool}).Put(ctx, alice.ID, ffpc.Host, sealed, clock0); err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	member := &fakeMember{t: t, owner: alice.ID, league: fixtureLeagueRead(t)}
	host := &FFPC{Member: member, TeamKeys: store, Now: clock.Now}
	hostList := Hosts{host}
	svc := &Service{
		Hosts: hostList, Poller: &Poller{Hosts: hostList, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hostList}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, FFPC: host, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
	a, b := caller{t, svc, alice.ID}, caller{t, svc, bob.ID}
	ffpcHost := apitypes.LeagueHostFfpc

	status, body := b.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &ffpcHost, Link: fixtureLeague}, "")
	if status != http.StatusConflict {
		t.Fatalf("bob with no connection: %d %s", status, body)
	}
	if status, _ := a.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &ffpcHost, Link: "999"}, ""); status != http.StatusBadRequest {
		t.Fatalf("a league outside the list: %d", status)
	}
	if status, _ := a.do(svc.preview, http.MethodPost, "/", apitypes.AttachPreviewInput{Host: &ffpcHost, Link: fixtureLeague}, ""); status != http.StatusBadRequest {
		t.Fatalf("an FFPC preview: %d", status)
	}
	var got apitypes.LeagueSync
	status, body = a.do(svc.attach, http.MethodPost, "/", apitypes.AttachInput{Host: &ffpcHost, Link: fixtureLeague}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &got) != nil {
		t.Fatalf("attach: %d %s", status, body)
	}
	if got.Me != 11 || got.Host != apitypes.LeagueHostFfpc || len(got.Teams) != 12 || len(got.Roster) != 20 || got.SettingsLeagueId == nil {
		t.Fatalf("the league: me %d, %d teams, %d on my roster, settings %v", got.Me, len(got.Teams), len(got.Roster), got.SettingsLeagueId)
	}
	ref := Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026, As: alice.ID}
	ltuid, err := store.FFPCTeamKey(ctx, ref)
	if err != nil || ltuid != fixtureLTUID {
		t.Fatalf("alice's league-team %q %v", ltuid, err)
	}
	clock.now = clock.now.Add(2 * MinUpstreamGap)
	if status, _ := a.do(svc.refresh, http.MethodPost, "/", nil, got.Id.String()); status != http.StatusOK {
		t.Fatalf("refresh: %d", status)
	}
	if member.reads != 2 {
		t.Fatalf("%d member reads, want the attach and the refresh", member.reads)
	}
	// A league-mate's view never carries the reader's lineup: the view
	// keeps starters for the viewer's own team only.
	if got.Roster[0].Slot != apitypes.RosterSpotSlotStarter {
		t.Fatalf("the member's own starters: %+v", got.Roster[0])
	}
	scrubbed := ownLineupOnly(ffpcSnapshot(fixtureLeagueRead(t), clock.now, 6), 3)
	if me, _ := scrubbed.TeamByRoster(11); len(me.Starters) != 0 {
		t.Fatalf("team 3's view shows team 11's starters: %v", me.Starters)
	}
	for _, side := range scrubbed.Matchups {
		if side.RosterID != 3 && len(side.Starters) != 0 {
			t.Fatalf("team 3's view shows team %d's matchup starters", side.RosterID)
		}
	}

	// Bob, who attached nothing, has no league-team of his own to read as.
	ref.As = bob.ID
	if _, err := host.Read(ctx, ref); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("a read as bob: %v", err)
	}
	if member.reads != 2 {
		t.Fatalf("%d member reads, want no read for bob", member.reads)
	}
}
