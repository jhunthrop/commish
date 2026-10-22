package leagues_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// gateNow is the gate's clock: week 7 of the 2026 season.
var gateNow = time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)

// customSettings is a sound league on custom scoring.
func customSettings(t *testing.T) apitypes.LeagueSettings {
	t.Helper()
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	s := apitypes.LeagueSettings{
		BotStyle: apitypes.BotStyleAdp, Keepers: []apitypes.Keeper{}, Lineup: apitypes.LineupStandard,
		Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
		Scoring: apitypes.Scoring{Custom: &rules}, Teams: 12,
	}
	if errs := leagues.Validate(s, ""); errs != nil {
		t.Fatalf("the fixture settings do not validate: %v", errs)
	}
	return s
}

func check(t *testing.T, store *entitlements.Store) (bool, *httptest.ResponseRecorder) {
	t.Helper()
	g := &leagues.Gate{Entitlements: store, Now: func() time.Time { return gateNow }, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	w := httptest.NewRecorder()
	ok := g.Check(w, httptest.NewRequest(http.MethodPost, "/leagues", nil), uuid.New(), customSettings(t), "")
	return ok, w
}

// In the free season custom scoring passes the gate for an account with
// no rows, with no table read: the store has no pool to read from.
func TestFreeSeasonOpensCustomScoring(t *testing.T) {
	ok, w := check(t, &entitlements.Store{Free: entitlements.FreeSeason(2026)})
	if !ok {
		t.Fatalf("free season: refused with %d %s", w.Code, w.Body.String())
	}
}

// Outside a free season the same account is refused with the 403 naming
// custom_scoring, the refusal kept for when the paid tiers return.
func TestCustomScoringNeedsTheFeature(t *testing.T) {
	ok, w := check(t, &entitlements.Store{Pool: dbtest.Pool(t)})
	var env struct {
		Error *apitypes.ErrorBody `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if ok || w.Code != http.StatusForbidden || env.Error == nil || env.Error.Feature == nil ||
		*env.Error.Feature != entitlements.CustomScoring {
		t.Fatalf("no rows, no free season: ok %v, %d %s", ok, w.Code, w.Body.String())
	}
}
