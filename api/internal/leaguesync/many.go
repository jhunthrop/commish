package leaguesync

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Checker answers whether an account may use a feature, from Can only.
// *entitlements.Store implements it.
type Checker interface {
	Can(ctx context.Context, accountID uuid.UUID, feature entitlements.Feature, now time.Time) (bool, error)
}

// oneLeagueWords is the refusal of a free account's second live league.
const oneLeagueWords = "One league is free. The rest come with the Draft Pass."

// admitLeague is the many_leagues gate, asked before any read goes
// upstream: a free account following a live league other than this one
// is refused with 403 naming the feature. It reports whether the
// account has the feature, for the save's own check, and whether to go
// on. A detached league does not count; Save checks again under the
// account's lock, so two attaches at once cannot both pass.
func (s *Service) admitLeague(w http.ResponseWriter, r *http.Request, host, leagueID string) (many, ok bool) {
	ctx := r.Context()
	accountID := auth.AccountID(r)
	many, err := s.Entitlements.Can(ctx, accountID, entitlements.ManyLeagues, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: can many leagues", err)
		return false, false
	}
	if many {
		return true, true
	}
	live, err := s.Links.Attached(ctx, accountID)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: live leagues", err)
		return false, false
	}
	for _, a := range live {
		if a.Ref.Host != host || a.Ref.LeagueID != leagueID {
			writeManyLeagues(w, r)
			return false, false
		}
	}
	return false, true
}

func writeManyLeagues(w http.ResponseWriter, r *http.Request) {
	httpx.WriteFeatureRequired(w, r, entitlements.ManyLeagues, oneLeagueWords)
}

// writeCapError answers a save or restore refused by a cap, and reports
// whether it did.
func writeCapError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, ErrManyLeagues):
		writeManyLeagues(w, r)
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, tooManyWords(), nil)
	default:
		return false
	}
	return true
}
