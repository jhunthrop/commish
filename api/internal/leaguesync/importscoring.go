package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/scoring"
	"github.com/jhunthrop/commish/api/internal/season"
)

// ESPNLeagues reads a public ESPN league's scoring. *espn.Client
// implements it.
type ESPNLeagues interface {
	League(ctx context.Context, ref espn.Ref, season int) (espn.League, error)
}

// The import's words.
const (
	hostESPN          = "espn"
	espnLinkWords     = "Paste your league's link from ESPN, or its league id"
	espnPrivateWords  = "This ESPN league is private. Make it viewable to the public in its settings, or enter your rules by hand"
	importNeedsPass   = "Your league's own scoring comes with the Draft Pass"
	// maxImportLink is the contract's ScoringImportInput.link maxLength.
	maxImportLink = 300
)

// importScoring reads a league's scoring from its host and answers it as
// ScoringRules, naming what was applied, dropped and defaulted. Nothing
// is saved: the setup page fills its form from the answer.
func (s *Service) importScoring(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ScoringImportInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if len(in.Link) > maxImportLink {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: "A league link is at most 300 characters"})
		return
	}
	if !in.Host.Valid() {
		httpx.WriteInvalid(w, r, map[string]string{fieldHost: "Pick Sleeper, ESPN or MyFantasyLeague"})
		return
	}
	ok, err := s.Entitlements.Can(r.Context(), auth.AccountID(r), entitlements.CustomScoring, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: import scoring entitlement", err)
		return
	}
	if !ok {
		httpx.WriteFeatureRequired(w, r, entitlements.CustomScoring, importNeedsPass)
		return
	}
	var im scoring.Imported
	if string(in.Host) == hostESPN {
		if im, ok = s.espnScoring(w, r, in.Link); !ok {
			return
		}
	} else if im, ok = s.hostScoring(w, r, string(in.Host), in.Link); !ok {
		return
	}
	rules, err := scoring.FromMap(im.Rules)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: import scoring rules", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.ScoringImport{
		Rules: rules, Applied: im.Applied(), Dropped: nonNil(im.Dropped), Defaulted: nonNil(im.Defaulted),
	})
}

// hostScoring is a Sleeper or MyFantasyLeague league's rules, read as
// an attach preview reads the league.
func (s *Service) hostScoring(w http.ResponseWriter, r *http.Request, host, link string) (scoring.Imported, bool) {
	key := apitypes.LeagueHost(host)
	h, ref, ok := s.resolve(w, r, &key, link)
	if !ok {
		return scoring.Imported{}, false
	}
	if h.Key() == HostFFPC {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcPickWords})
		return scoring.Imported{}, false
	}
	read, err := s.readFor(r.Context(), auth.AccountID(r), ref)
	if err != nil {
		s.writeHostError(w, r, ref.Host, err)
		return scoring.Imported{}, false
	}
	sc := read.Scoring
	if len(sc.Rules) == 0 {
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, "This league states no scoring we can read. Enter your rules by hand", nil)
		return scoring.Imported{}, false
	}
	return scoring.Imported{Rules: sc.Rules, Dropped: sc.Dropped, Defaulted: sc.Defaulted}, true
}

// espnScoring is a public ESPN league's rules, for the link's season or
// the current one.
func (s *Service) espnScoring(w http.ResponseWriter, r *http.Request, link string) (scoring.Imported, bool) {
	ref, err := espn.Parse(link)
	if err != nil {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: espnLinkWords})
		return scoring.Imported{}, false
	}
	yr := ref.Season
	if yr == 0 {
		yr = season.Of(s.Now())
	}
	league, err := s.ESPN.League(r.Context(), ref, yr)
	switch {
	case err == nil:
		return espn.Map(league.Items), true
	case errors.Is(err, espn.ErrPrivate):
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, espnPrivateWords, nil)
	case errors.Is(err, espn.ErrNotFound):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound,
			fmt.Sprintf("ESPN has no league at that link for the %d season. A league not renewed yet: paste the link with its seasonId", yr), nil)
	case errors.Is(err, espn.ErrNotALink):
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: espnLinkWords})
	default:
		s.Log.Warn("leaguesync: espn", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "ESPN is not answering right now. Try again in a moment", nil)
	}
	return scoring.Imported{}, false
}
