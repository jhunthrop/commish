package leagues

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Rate limits for the league routes.
var (
	limitRead  = httpx.Limit{N: 240, Per: time.Minute}
	limitWrite = httpx.Limit{N: 60, Per: time.Minute}
)

// Checker is the part of entitlements.Store a gate needs.
type Checker interface {
	Can(ctx context.Context, accountID uuid.UUID, feature entitlements.Feature, now time.Time) (bool, error)
}

// Gate validates settings and the features they need, answering the
// request itself when they fail. Mocks pass their settings through the
// same gate, so a rule is never checked in one place and missed in the
// other.
type Gate struct {
	Entitlements Checker
	Now          func() time.Time
	Log          *slog.Logger
}

// Check reports whether s may be saved by accountID. On false it has
// already answered.
func (g *Gate) Check(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, s apitypes.LeagueSettings, prefix string) bool {
	if errs := Validate(s, prefix); errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return false
	}
	if !UsesCustomScoring(s) {
		return true
	}
	ok, err := g.Entitlements.Can(r.Context(), accountID, entitlements.CustomScoring, g.Now())
	if err != nil {
		httpx.WriteInternal(w, r, g.Log, "leagues: gate", err)
		return false
	}
	if !ok {
		httpx.WriteFeatureRequired(w, r, entitlements.CustomScoring, "Custom scoring comes with the Draft Pass")
		return false
	}
	return true
}

// Handler serves /leagues.
type Handler struct {
	Store *Store
	Gate  *Gate
	Log   *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/leagues", Access: httpx.SignedIn, Limit: limitRead, Handler: h.list},
		{Method: http.MethodPost, Path: "/leagues", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.create},
		{Method: http.MethodGet, Path: "/leagues/{id}", Access: httpx.SignedIn, Limit: limitRead, Handler: h.get},
		{Method: http.MethodPut, Path: "/leagues/{id}", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.replace},
		{Method: http.MethodDelete, Path: "/leagues/{id}", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.delete},
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteNotFound(w, r)
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "You have saved the most leagues allowed, delete one first", nil)
	default:
		httpx.WriteInternal(w, r, h.Log, op, err)
	}
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p, ok := httpx.ParsePage(w, r)
	if !ok {
		return
	}
	out, total, err := h.Store.List(r.Context(), auth.AccountID(r), p.PerPage, p.Offset())
	if err != nil {
		h.fail(w, r, "leagues: list", err)
		return
	}
	httpx.WritePage(w, r, out, p, total)
}

func (h *Handler) decode(w http.ResponseWriter, r *http.Request) (apitypes.LeagueInput, bool) {
	var in apitypes.LeagueInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return in, false
	}
	if n := len([]rune(in.Name)); n < 1 || n > 60 {
		httpx.WriteInvalid(w, r, map[string]string{"name": "Name it in 1 to 60 characters"})
		return in, false
	}
	return in, h.Gate.Check(w, r, auth.AccountID(r), in.Settings, "settings.")
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	in, ok := h.decode(w, r)
	if !ok {
		return
	}
	l, err := h.Store.Create(r.Context(), auth.AccountID(r), in)
	if err != nil {
		h.fail(w, r, "leagues: create", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, l)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	l, err := h.Store.Get(r.Context(), auth.AccountID(r), id)
	if err != nil {
		h.fail(w, r, "leagues: get", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, l)
}

func (h *Handler) replace(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	in, ok := h.decode(w, r)
	if !ok {
		return
	}
	l, err := h.Store.Replace(r.Context(), auth.AccountID(r), id, in)
	if err != nil {
		h.fail(w, r, "leagues: replace", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, l)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.Store.Delete(r.Context(), auth.AccountID(r), id); err != nil {
		h.fail(w, r, "leagues: delete", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}
