package leaguesync

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
)

var (
	sleeperLink = "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	mflLink     = "https://www43.myfantasyleague.com/2026/home/" + ReplayMFLLeague
)

// attachAs attaches a recorded league by roster 1 and answers the
// status, the link id on a 201 and the feature a 403 names.
func attachAs(t *testing.T, svc *Service, accountID uuid.UUID, link string) (int, uuid.UUID, apitypes.Feature) {
	t.Helper()
	body, err := json.Marshal(apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/leagues/attach", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r = r.WithContext(auth.WithAccount(r.Context(), auth.Account{ID: accountID}))
	w := httptest.NewRecorder()
	svc.attach(w, r)
	var env struct {
		Data  apitypes.LeagueSync `json:"data"`
		Error *apitypes.ErrorBody `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("attach %s: %d %s", link, w.Code, w.Body.String())
	}
	var feature apitypes.Feature
	if env.Error != nil && env.Error.Feature != nil {
		feature = *env.Error.Feature
	}
	return w.Code, env.Data.Id, feature
}

func newAccount(t *testing.T, store *auth.Store, name string) uuid.UUID {
	t.Helper()
	a, err := store.UpsertAccount(context.Background(), auth.Identity{UserID: "user_" + name, Email: name + "@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

// One live league is free: a free account's second league, by attach or
// by undoing a detach, is refused with 403 naming many_leagues before any
// read goes upstream. Attaching the same league again is not a second
// one, and a detached league does not count.
func TestASecondLeagueNeedsManyLeagues(t *testing.T) {
	pool := dbtest.Pool(t)
	svc := replayService(pool)
	alice := newAccount(t, &auth.Store{Pool: pool}, "alice")
	c := caller{t, svc, alice}

	status, first, _ := attachAs(t, svc, alice, sleeperLink)
	if status != http.StatusCreated {
		t.Fatalf("first league: %d", status)
	}
	if status, _, _ := attachAs(t, svc, alice, sleeperLink); status != http.StatusCreated {
		t.Fatalf("the same league again: %d", status)
	}
	reads := svc.Poller.Upstream()
	status, _, feature := attachAs(t, svc, alice, mflLink)
	if status != http.StatusForbidden || feature != entitlements.ManyLeagues {
		t.Fatalf("second league: %d naming %q, want 403 naming many_leagues", status, feature)
	}
	if got := svc.Poller.Upstream(); got != reads {
		t.Fatalf("the refused league was read upstream (%d reads, was %d)", got, reads)
	}

	if status, _ := c.do(svc.detach, http.MethodDelete, "/", nil, first.String()); status != http.StatusOK {
		t.Fatalf("detach: %d", status)
	}
	if status, _, _ := attachAs(t, svc, alice, mflLink); status != http.StatusCreated {
		t.Fatalf("a league with the first detached: %d", status)
	}
	if status, _ := c.do(svc.restore, http.MethodPost, "/", nil, first.String()); status != http.StatusForbidden {
		t.Fatalf("undoing the detach as a second league: %d", status)
	}
}

// A Membership, which carries the Draft Pass's features, follows more
// than one league.
func TestAMembershipFollowsTwoLeagues(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	svc := replayService(pool)
	bob := newAccount(t, &auth.Store{Pool: pool}, "bob")
	ents := &entitlements.Store{Pool: pool}
	if err := ents.Grant(ctx, bob, entitlements.ProductMembership, 0, time.Now().AddDate(1, 0, 0), "test"); err != nil {
		t.Fatal(err)
	}
	for _, link := range []string{sleeperLink, mflLink} {
		if status, _, feature := attachAs(t, svc, bob, link); status != http.StatusCreated {
			t.Fatalf("attach %s: %d %q", link, status, feature)
		}
	}
	list, err := (&Store{Pool: pool}).Attached(ctx, bob)
	if err != nil || len(list) != 2 {
		t.Fatalf("bob follows %d leagues (%v), want 2", len(list), err)
	}
}
