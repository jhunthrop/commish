package leaguesync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/entitlements/enttest"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// offline is a live client that never answers, so the replay serves
// only its recordings and the tests never reach a host.
type offline struct{}

var errOffline = errors.New("offline")

func (offline) League(context.Context, string) (sleeper.League, error) {
	return sleeper.League{}, errOffline
}
func (offline) Rosters(context.Context, string) ([]sleeper.Roster, error)   { return nil, errOffline }
func (offline) LeagueUsers(context.Context, string) ([]sleeper.User, error) { return nil, errOffline }
func (offline) Matchups(context.Context, string, int) ([]sleeper.Matchup, error) {
	return nil, errOffline
}
func (offline) Transactions(context.Context, string, int) ([]sleeper.Transaction, error) {
	return nil, errOffline
}
func (offline) NFLState(context.Context) (sleeper.State, error)   { return sleeper.State{}, errOffline }
func (offline) UserID(context.Context, string) (string, error)    { return "", sleeper.ErrNotFound }
func (offline) Players(context.Context) ([]sleeper.Player, error) { return nil, errOffline }
func (offline) Draft(context.Context, string) (sleeper.Draft, error) {
	return sleeper.Draft{}, errOffline
}

type offlineMFL struct{}

func (offlineMFL) League(context.Context, int, string) (mfl.League, error) {
	return mfl.League{}, errOffline
}
func (offlineMFL) Rosters(context.Context, int, string) ([]mfl.Roster, error) { return nil, errOffline }
func (offlineMFL) Rules(context.Context, int, string) ([]mfl.Rule, error)     { return nil, errOffline }
func (offlineMFL) Standings(context.Context, int, string) ([]mfl.Standing, error) {
	return nil, errOffline
}
func (offlineMFL) Schedule(context.Context, int, string) ([]mfl.ScheduleGame, error) {
	return nil, errOffline
}
func (offlineMFL) LiveScoring(context.Context, int, string, int) ([]mfl.Matchup, error) {
	return nil, errOffline
}
func (offlineMFL) Transactions(context.Context, int, string, int) ([]mfl.Transaction, error) {
	return nil, errOffline
}
func (offlineMFL) SeasonStatus(context.Context, int) (mfl.Status, error) {
	return mfl.Status{}, errOffline
}
func (offlineMFL) Players(context.Context, int) ([]mfl.Player, error) { return nil, errOffline }
func (offlineMFL) DraftResults(context.Context, int, string) (mfl.DraftResults, error) {
	return mfl.DraftResults{}, errOffline
}

func replayHosts(now func() time.Time) Hosts {
	return Hosts{
		&Sleeper{API: SleeperReplay{Live: offline{}}, Now: now},
		&MFL{API: MFLReplay{Live: offlineMFL{}}, Now: now},
	}
}

// smallBoard is a board of three players the recorded Sleeper league
// holds or not: Aaron Rodgers (Sleeper 96, ESPN 8439), the Vikings
// defense, and a free agent.
type smallBoard struct{}

func (smallBoard) For(_ context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	pts := 300.0
	raw := &boards.Raw{Format: boards.PPR, Season: 2026, Players: []boards.Player{
		{ID: "8439", Name: "Aaron Rodgers", Position: draft.QB, Team: "PIT", Points: &pts},
		{ID: "DST-MIN", Name: "Minnesota Vikings", Position: draft.DEF, Team: "MIN"},
		{ID: "9999999", Name: "Nobody Holds Him", Position: draft.QB, Team: "PIT", Points: &pts},
	}}
	slots, err := mock.SlotConfig(s)
	if err != nil {
		return boards.Board{}, err
	}
	return boards.For(raw, s.Teams, slots)
}

type memoryPlayers struct{ hosts Hosts }

func (m memoryPlayers) For(ctx context.Context, host string, season int, _ []string) (map[string]HostPlayer, error) {
	h, _ := m.hosts.ByKey(host)
	ps, err := h.Players(ctx, season)
	return index(ps), err
}

type caller struct {
	t   *testing.T
	svc *Service
	id  uuid.UUID
}

func (c caller) do(handler http.HandlerFunc, method, path string, body any, pathID string) (int, json.RawMessage) {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			c.t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &buf)
	r.Header.Set("Content-Type", "application/json")
	if pathID != "" {
		r.SetPathValue("id", pathID)
	}
	r = r.WithContext(auth.WithAccount(r.Context(), auth.Account{ID: c.id}))
	w := httptest.NewRecorder()
	handler(w, r)
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	return w.Code, env.Data
}

func intp(n int) *int { return &n }

// replayService serves the recorded Sleeper and MyFantasyLeague leagues
// over the test database, with Can read from it too.
func replayService(pool *pgxpool.Pool) *Service {
	clock := &fakeClock{now: time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)}
	hosts := replayHosts(clock.Now)
	store := &Store{Pool: pool}
	return &Service{
		Hosts: hosts, Poller: &Poller{Hosts: hosts, Store: store, Now: clock.Now, Log: quietLog()},
		Admission: &Admission{Now: clock.Now}, Players: memoryPlayers{hosts}, Links: store,
		Saved: &leagues.Store{Pool: pool}, Boards: smallBoard{}, Entitlements: &entitlements.Store{Pool: pool},
		Now: clock.Now, Log: quietLog(),
	}
}

// Two members of one league each attach it and each see their own seat;
// one read reaches the host for both; neither can read, list or detach
// the other's attachment or saved league; a detach keeps the saved league
// and can be undone, by its own account only.
func TestAttachIsScopedToTheAccount(t *testing.T) {
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
	svc := replayService(pool)
	store := &Store{Pool: pool}
	saved := &leagues.Store{Pool: pool}
	a, b := caller{t, svc, alice.ID}, caller{t, svc, bob.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"

	var aliceSync, bobSync apitypes.LeagueSync
	status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &aliceSync) != nil {
		t.Fatalf("alice attach: %d %s", status, body)
	}
	status, body = b.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(5)}}, "")
	if status != http.StatusCreated || json.Unmarshal(body, &bobSync) != nil {
		t.Fatalf("bob attach: %d %s", status, body)
	}
	if aliceSync.Me != 1 || bobSync.Me != 5 || aliceSync.Id == bobSync.Id {
		t.Fatalf("seats %d and %d on links %s and %s", aliceSync.Me, bobSync.Me, aliceSync.Id, bobSync.Id)
	}
	if got := svc.Poller.Upstream(); got != 1 {
		t.Fatalf("two members attaching made %d upstream reads, want 1", got)
	}
	if aliceSync.SettingsLeagueId == nil || len(aliceSync.Teams) != 12 || len(aliceSync.Roster) == 0 {
		t.Fatalf("alice's league: settings %v, %d teams, %d on her roster", aliceSync.SettingsLeagueId, len(aliceSync.Teams), len(aliceSync.Roster))
	}
	_, free := aliceSync.HeldBy["9999999"]
	_, heldA := aliceSync.HeldBy["8439"]
	_, heldB := aliceSync.HeldBy["DST-MIN"]
	if !heldA || !heldB || free {
		t.Fatalf("held by %v, want the two held players by their rosters and not the free one", aliceSync.HeldBy)
	}
	if len(aliceSync.Rostered) != len(aliceSync.HeldBy) || !contains(aliceSync.Rostered, "8439") {
		t.Fatalf("rostered %v, want held_by's ids for a web from before held_by", aliceSync.Rostered)
	}
	if aliceSync.BoardFormat != apitypes.BoardFormatPpr || aliceSync.ScoringLike != apitypes.ScoringPresetTePremium {
		t.Fatalf("board %s, scoring like %s", aliceSync.BoardFormat, aliceSync.ScoringLike)
	}

	if status, _ := a.do(svc.sync, http.MethodGet, "/", nil, bobSync.Id.String()); status != http.StatusNotFound {
		t.Fatalf("alice read bob's league: %d", status)
	}
	if status, _ := a.do(svc.detach, http.MethodDelete, "/", nil, bobSync.Id.String()); status != http.StatusNotFound {
		t.Fatalf("alice detached bob's league: %d", status)
	}
	if _, err := saved.Get(ctx, bob.ID, *aliceSync.SettingsLeagueId); !errors.Is(err, leagues.ErrNotFound) {
		t.Fatalf("bob read alice's saved league: %v", err)
	}
	_, body = a.do(svc.attached, http.MethodGet, "/", nil, "")
	var list []apitypes.AttachedLeague
	if err := json.Unmarshal(body, &list); err != nil || len(list) != 1 || list[0].Id != aliceSync.Id || list[0].TeamName == "" ||
		list[0].Standing == nil || list[0].Standing.Teams != 12 || list[0].Standing.Place < 1 {
		t.Fatalf("alice's list %s", body)
	}
	if l := list[0]; l.Phase != apitypes.LeaguePhaseInSeason || l.PhaseBasis == "" || l.PlayoffStartWeek == nil || *l.PlayoffStartWeek != 15 || !l.WaiversOpen {
		t.Fatalf("alice's league's phase in the list: %s", body)
	}

	// A second league needs many_leagues, so alice holds a Draft Pass for it.
	enttest.GrantFrom(t, &entitlements.Store{Pool: pool}, alice.ID, entitlements.ProductDraftPass, 2026, svc.Now(), clock2027())
	status, body = a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{
		Link: "https://www43.myfantasyleague.com/2026/home/" + ReplayMFLLeague, Me: apitypes.AttachSeat{Username: strp("alice")},
	}, "")
	if status != http.StatusBadRequest {
		t.Fatalf("a MyFantasyLeague seat by username: %d %s", status, body)
	}
	// That league was read but never attached: nothing of it was kept.
	mflRef := Ref{Host: HostMFL, LeagueID: ReplayMFLLeague, Season: ReplayMFLSeason}
	if _, kept, err := store.LastSnapshot(ctx, mflRef); err != nil || kept {
		t.Fatalf("a league read and not attached left a snapshot (%v, %v)", kept, err)
	}

	if status, _ := a.do(svc.detach, http.MethodDelete, "/", nil, aliceSync.Id.String()); status != http.StatusOK {
		t.Fatalf("alice detach: %d", status)
	}
	if _, err := saved.Get(ctx, alice.ID, *aliceSync.SettingsLeagueId); err != nil {
		t.Fatalf("the detach took the saved league with it: %v", err)
	}
	if status, _ := a.do(svc.sync, http.MethodGet, "/", nil, aliceSync.Id.String()); status != http.StatusNotFound {
		t.Fatalf("a detached league still read: %d", status)
	}
	if status, _ := b.do(svc.restore, http.MethodPost, "/", nil, aliceSync.Id.String()); status != http.StatusNotFound {
		t.Fatalf("bob undid alice's detach: %d", status)
	}
	if status, _ := b.do(svc.sync, http.MethodGet, "/", nil, bobSync.Id.String()); status != http.StatusOK {
		t.Fatalf("bob's league after alice detached: %d", status)
	}
	if status, _ := a.do(svc.restore, http.MethodPost, "/", nil, aliceSync.Id.String()); status != http.StatusOK {
		t.Fatalf("alice's undo: %d", status)
	}
	var back apitypes.LeagueSync
	status, body = a.do(svc.sync, http.MethodGet, "/", nil, aliceSync.Id.String())
	if status != http.StatusOK || json.Unmarshal(body, &back) != nil || back.Me != 1 ||
		back.SettingsLeagueId == nil || *back.SettingsLeagueId != *aliceSync.SettingsLeagueId {
		t.Fatalf("after the undo: %d %s", status, body)
	}
}

func strp(s string) *string { return &s }

// clock2027 is a grant's end well past the replay clock's day.
func clock2027() time.Time { return time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC) }
