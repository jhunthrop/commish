package leaguesync

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// limitSelectPerMinute bounds switching the site's league: a tap each.
const limitSelectPerMinute = 60

// Selector is the part of Store the selection route writes through.
type Selector interface {
	Select(ctx context.Context, accountID uuid.UUID, choice apitypes.LeagueChoice) error
}

// AccountViewer answers the Account a selection changes. *account.Viewer
// implements it.
type AccountViewer interface {
	View(ctx context.Context, a auth.Account) (apitypes.Account, error)
}

// checkChoice says what is wrong with a selection, nil when it names
// exactly one of a league and one of our board formats.
func checkChoice(c apitypes.LeagueChoice) map[string]string {
	switch {
	case (c.LeagueId == nil) == (c.Format == nil):
		return map[string]string{"league_id": "Choose a league or a format"}
	case c.Format != nil && !c.Format.Valid():
		return map[string]string{"format": "Choose one of our boards"}
	}
	return nil
}

// selectLeague sets the site's context and answers the Account with it.
func (s *Service) selectLeague(w http.ResponseWriter, r *http.Request) {
	var choice apitypes.LeagueChoice
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &choice) {
		return
	}
	if fields := checkChoice(choice); fields != nil {
		httpx.WriteInvalid(w, r, fields)
		return
	}
	a, _ := auth.AccountFrom(r.Context())
	err := s.Selection.Select(r.Context(), a.ID, choice)
	if errors.Is(err, ErrLinkNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: select", err)
		return
	}
	view, err := s.Accounts.View(r.Context(), a)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: view account", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, view)
}
