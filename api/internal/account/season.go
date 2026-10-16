package account

import (
	"context"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// limitSeasonPerMinute bounds GET /season per caller: a shell reads it
// once at boot.
const limitSeasonPerMinute = 60

// unwired is the site's season with no source: the preseason, saying so.
var unwired = season.SitePhase{Phase: season.SitePreseason, Basis: "The site's season is not read here."}

// siteSeason is the site's season from src, as the contract answers it.
func siteSeason(ctx context.Context, src Season) apitypes.SiteSeason {
	p := unwired
	if src != nil {
		p = src.Phase(ctx)
	}
	out := apitypes.SiteSeason{Phase: apitypes.SiteSeasonPhase(p.Phase), Week: p.Week, Basis: p.Basis}
	if p.BoardWeek > 0 {
		out.BoardWeek = &p.BoardWeek
	}
	return out
}

// SeasonHandler serves the site's season to anyone (GET /season), so a
// signed-out shell can correct its rail at boot. Season is the same
// source /me reads (*season.Site, kept an hour).
type SeasonHandler struct {
	Season Season
}

// Routes is GET /season.
func (h *SeasonHandler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/season", Access: httpx.Anonymous, Limit: httpx.PerMinute(limitSeasonPerMinute), Handler: h.get},
	}
}

func (h *SeasonHandler) get(w http.ResponseWriter, r *http.Request) {
	httpx.WriteOK(w, r, http.StatusOK, siteSeason(r.Context(), h.Season))
}
