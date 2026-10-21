package leaguesync

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"testing"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/entitlements/enttest"
)

// A Draft Pass alone follows more than one league.
func TestADraftPassFollowsTwoLeagues(t *testing.T) {
	pool := dbtest.Pool(t)
	svc := replayService(pool)
	cara := newAccount(t, &auth.Store{Pool: pool}, "cara")
	enttest.GrantFrom(t, &entitlements.Store{Pool: pool}, cara, entitlements.ProductDraftPass, 2026, svc.Now(), clock2027())
	for _, link := range []string{sleeperLink, mflLink} {
		if status, _, feature := attachAs(t, svc, cara, link); status != http.StatusCreated {
			t.Fatalf("attach %s: %d %q", link, status, feature)
		}
	}
}

// Two attaches at once from a free account both pass the early gate, and
// the account's lock lets one through: the other is the 403 naming
// many_leagues.
func TestTwoFreeAttachesAtOnceFollowOne(t *testing.T) {
	pool := dbtest.Pool(t)
	svc := replayService(pool)
	dan := newAccount(t, &auth.Store{Pool: pool}, "dan")
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i, link := range []string{sleeperLink, mflLink} {
		wg.Go(func() {
			statuses[i], _, _ = attachAs(t, svc, dan, link)
		})
	}
	wg.Wait()
	slices.Sort(statuses)
	if statuses[0] != http.StatusCreated || statuses[1] != http.StatusForbidden {
		t.Fatalf("statuses %v, want one 201 and one 403", statuses)
	}
	list, err := (&Store{Pool: pool}).Attached(context.Background(), dan)
	if err != nil || len(list) != 1 {
		t.Fatalf("dan follows %d leagues (%v), want 1", len(list), err)
	}
}

// The early gate's one league: host and id, and the season where the
// asked link names one, so a league's next season is a second league.
func TestSameLeague(t *testing.T) {
	followed := Ref{Host: HostMFL, LeagueID: "10010", Season: 2025}
	cases := []struct {
		asked Ref
		want  bool
	}{
		{Ref{Host: HostMFL, LeagueID: "10010", Season: 2025}, true},
		{Ref{Host: HostMFL, LeagueID: "10010"}, true},
		{Ref{Host: HostMFL, LeagueID: "10010", Season: 2026}, false},
		{Ref{Host: HostMFL, LeagueID: "10011", Season: 2025}, false},
	}
	for _, c := range cases {
		if got := sameLeague(followed, c.asked); got != c.want {
			t.Fatalf("%+v: %v, want %v", c.asked, got, c.want)
		}
	}
}
