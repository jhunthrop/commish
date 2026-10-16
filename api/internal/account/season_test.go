package account_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jhunthrop/commish/api/internal/account"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// GET /season answers anyone, with no session read, the site's season, the same object /me
// carries, from the same source.
func TestSeasonRoute(t *testing.T) {
	src := fixedSeason{season.SitePhase{Phase: season.SitePlayoffs, Week: 20, Basis: "The 2026 regular season is over and the NFL playoffs are on."}}
	routes := (&account.SeasonHandler{Season: src}).Routes()
	if len(routes) != 1 || routes[0].Method != http.MethodGet || routes[0].Path != "/season" || routes[0].Access != httpx.Anonymous || routes[0].Access.ResolvesSession() {
		t.Fatalf("routes %+v", routes)
	}
	w := httptest.NewRecorder()
	routes[0].Handler(w, httptest.NewRequest(http.MethodGet, "/season", nil))
	var env struct {
		Ok   bool                `json:"ok"`
		Data apitypes.SiteSeason `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || w.Code != http.StatusOK || !env.Ok {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if env.Data.Phase != apitypes.SiteSeasonPhasePlayoffs || env.Data.Week != 20 || env.Data.Basis != src.p.Basis {
		t.Fatalf("season %+v", env.Data)
	}
}
