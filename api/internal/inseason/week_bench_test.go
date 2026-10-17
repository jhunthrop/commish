package inseason

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
)

// GET /me/week's own work at 1, 3 and 10 in-season leagues on the fixture
// league (Lane 66k M2): each league's advisor, lineup, scoreboard and the
// Waivers strip, at most leaguesync.WeekReads at once. The host reads are
// the poller's, shared and cached, and are not in it.
//
//	go test ./internal/inseason -run '^$' -bench WeekRoute
func BenchmarkWeekRoute(b *testing.B) {
	f := newFixture(b)
	for _, n := range []int{1, 3, 10} {
		list := make([]WeekLeague, n)
		for i := range list {
			list[i] = WeekLeague{ID: uuid.New(), Phase: apitypes.LeaguePhaseInSeason, WaiversOpen: true, League: &f.league}
		}
		s := &Service{Leagues: fakeLeagues{f.league}, Weeks: fakeWeeks{list: list}, Facts: fakeFacts{data: f.data},
			Holds: &fakeHolds{}, Now: func() time.Time { return fixtureNow }, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
		b.Run(fmt.Sprintf("%d leagues", n), func(b *testing.B) {
			for b.Loop() {
				req := httptest.NewRequest(http.MethodGet, "/me/week", nil)
				req = req.WithContext(auth.WithAccount(req.Context(), auth.Account{ID: uuid.New()}))
				rec := httptest.NewRecorder()
				s.week(rec, req)
				if rec.Code != http.StatusOK {
					b.Fatalf("%d", rec.Code)
				}
			}
		})
	}
}
