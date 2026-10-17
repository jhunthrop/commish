package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// follow calls Follow as an in-season route does, answering the status
// and the envelope it wrote when it reports false.
func follow(t *testing.T, svc *Service, account uuid.UUID, id string) (Followed, bool, int, apitypes.Envelope) {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/leagues/attached/"+id+"/lineup", nil)
	r.SetPathValue("id", id)
	r = r.WithContext(auth.WithAccount(r.Context(), auth.Account{ID: account}))
	w := httptest.NewRecorder()
	f, ok := svc.Follow(w, r)
	var env apitypes.Envelope
	if !ok {
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("no envelope: %d %s", w.Code, w.Body.String())
		}
	}
	return f, ok, w.Code, env
}

// The in-season routes' access: the account's own league only, a host
// with no read answers 502, a deleted saved league is no saved scoring
// with the league page's sentence.
func TestFollowIsTheAccountsOwnLeague(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	alice, bob := newAccount(t, accounts, "follow_alice"), newAccount(t, accounts, "follow_bob")
	svc := replayService(pool)
	status, linkID, _ := attachAs(t, svc, alice, "https://sleeper.com/leagues/"+ReplaySleeperLeague+"/team")
	if status != http.StatusCreated {
		t.Fatalf("attach: %d", status)
	}

	f, ok, _, _ := follow(t, svc, alice, linkID.String())
	if !ok || f.Saved == nil || f.Link.RosterID != 1 || f.Snap.Ref.LeagueID != ReplaySleeperLeague || len(f.HeldBy) == 0 {
		t.Fatalf("alice's own league: ok %v saved %v roster %d", ok, f.Saved, f.Link.RosterID)
	}
	if p := f.Player("96"); p.BoardId == nil || *p.BoardId != "8439" {
		t.Fatalf("player 96 placed at %v", p.BoardId)
	}

	for name, c := range map[string]struct {
		account uuid.UUID
		id      string
	}{"another account's league": {bob, linkID.String()}, "an unknown id": {alice, uuid.NewString()}} {
		_, ok, code, env := follow(t, svc, c.account, c.id)
		if ok || code != http.StatusNotFound || env.Ok || env.Error == nil || env.Error.Code != "not_found" {
			t.Fatalf("%s: ok %v %d %+v", name, ok, code, env.Error)
		}
	}

	link, err := (&Store{Pool: pool}).Get(ctx, alice, linkID)
	if err != nil {
		t.Fatal(err)
	}
	if err := (&leagues.Store{Pool: pool}).Delete(ctx, alice, *link.LeagueID); err != nil {
		t.Fatal(err)
	}
	f, ok, _, _ = follow(t, svc, alice, linkID.String())
	if !ok || f.Saved != nil || f.SettingsNote() == "" {
		t.Fatalf("a deleted saved league: ok %v saved %v note %q", ok, f.Saved, f.SettingsNote())
	}

	// A host that cannot be read, with no read kept: 502.
	if _, err := pool.Exec(ctx, `delete from app.league_snapshots`); err != nil {
		t.Fatal(err)
	}
	down := replayService(pool)
	offlineHosts := Hosts{&Sleeper{API: offline{}, Now: down.Now}, &MFL{API: offlineMFL{}, Now: down.Now}}
	down.Hosts, down.Poller = offlineHosts, &Poller{Hosts: offlineHosts, Store: &Store{Pool: pool}, Now: down.Now, Log: quietLog()}
	_, ok, code, env := follow(t, down, alice, linkID.String())
	if ok || code != http.StatusBadGateway || env.Error == nil || env.Error.Code != "unavailable" {
		t.Fatalf("an unreadable host: ok %v %d %+v", ok, code, env.Error)
	}
}

// A saved league's kicking and defense rules are its host's: a league
// saved with the standard ones (00025's fill for a league attached before
// them) takes the host's on its next read, the Sleeper league's shutout at
// 10, its 40 to 49 and 50-plus field goals at 4 and 5 and no yards tiers,
// while the rules the board ranks by stay as saved.
func TestSyncKeepsTheHostsKickingAndDefenseRules(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice := newAccount(t, &auth.Store{Pool: pool}, "kdef_alice")
	svc := replayService(pool)
	status, linkID, _ := attachAs(t, svc, alice, "https://sleeper.com/leagues/"+ReplaySleeperLeague+"/team")
	if status != http.StatusCreated {
		t.Fatalf("attach: %d", status)
	}
	link, err := (&Store{Pool: pool}).Get(ctx, alice, linkID)
	if err != nil {
		t.Fatal(err)
	}
	saved := &leagues.Store{Pool: pool}
	l, err := saved.Get(ctx, alice, *link.LeagueID)
	if err != nil || l.Settings.Scoring.Custom == nil {
		t.Fatalf("saved league %+v %v", l, err)
	}
	stale := scoring.Standard()
	stale.PointsPerReception = 0.75
	settings := l.Settings
	settings.Scoring.Custom = &stale
	if _, err := saved.Replace(ctx, alice, l.Id, apitypes.LeagueInput{Name: l.Name, Settings: settings}); err != nil {
		t.Fatal(err)
	}

	f, ok, _, _ := follow(t, svc, alice, linkID.String())
	if !ok || f.Saved == nil || f.Saved.Scoring.Custom == nil {
		t.Fatalf("follow: ok %v saved %v", ok, f.Saved)
	}
	for name, r := range map[string]apitypes.ScoringRules{"the read's": *f.Saved.Scoring.Custom, "the stored": storedRules(t, saved, alice, l.Id)} {
		if r.PointsAllowed0 != 10 || r.PointsAllowed1820 != 1 || r.PointsAllowed46Plus != -4 || r.PointsPerFieldGoal4049 != 4 ||
			r.PointsPerFieldGoal50Plus != 5 || r.YardsAllowed099 != 0 || r.YardsAllowed550Plus != 0 {
			t.Errorf("%s kicking and defense rules: %+v", name, r)
		}
		if r.PointsPerReception != 0.75 {
			t.Errorf("%s board rules changed: reception %v", name, r.PointsPerReception)
		}
	}
}

func storedRules(t *testing.T, saved *leagues.Store, account, id uuid.UUID) apitypes.ScoringRules {
	t.Helper()
	l, err := saved.Get(context.Background(), account, id)
	if err != nil || l.Settings.Scoring.Custom == nil {
		t.Fatalf("stored league %+v %v", l, err)
	}
	return *l.Settings.Scoring.Custom
}
