package mocks

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

// maxSeed is the engine's seed space: mulberry32 takes 32 bits.
const maxSeed = 1<<32 - 1

// Rate limits for the mock routes. Run it again is the loop, so
// creating allows a brisk pace.
const (
	limitReadPerMinute   = 240
	limitCreatePerHour   = 120
	limitDeletePerMinute = 60
)

// LeagueReader is the part of leagues.Store a mock reads.
type LeagueReader interface {
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.League, error)
}

// Repository is the part of Store the handlers use.
type Repository interface {
	List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.Mock, int64, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.MockDetail, error)
	Create(ctx context.Context, accountID uuid.UUID, leagueID *uuid.UUID, settings apitypes.LeagueSettings, seed int64) (apitypes.Mock, error)
	Delete(ctx context.Context, accountID, id uuid.UUID) error
}

// SettingsGate checks a mock's settings and the features they need.
// *leagues.Gate implements it.
type SettingsGate interface {
	Check(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, s apitypes.LeagueSettings, prefix string) bool
}

// Handler serves /mocks.
type Handler struct {
	Store   Repository
	Leagues LeagueReader
	Gate    SettingsGate
	Log     *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/mocks", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.list},
		{Method: http.MethodPost, Path: "/mocks", Access: httpx.SignedIn, Limit: httpx.PerHour(limitCreatePerHour), Handler: h.create},
		{Method: http.MethodGet, Path: "/mocks/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.get},
		{Method: http.MethodDelete, Path: "/mocks/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDeletePerMinute), Handler: h.delete},
	}
}

func randomSeed() int64 {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return int64(binary.BigEndian.Uint32(b[:]))
}

// settingsFor resolves a create's settings: a saved league's, or the
// ones in the request, never both. On false it has already answered.
func (h *Handler) settingsFor(w http.ResponseWriter, r *http.Request, in apitypes.MockCreate) (apitypes.LeagueSettings, bool) {
	accountID := auth.AccountID(r)
	switch {
	case (in.LeagueId == nil) == (in.Settings == nil):
		httpx.WriteInvalid(w, r, map[string]string{"settings": "Start from a saved league or from settings, not both"})
		return apitypes.LeagueSettings{}, false
	case in.LeagueId != nil:
		l, err := h.Leagues.Get(r.Context(), accountID, *in.LeagueId)
		if errors.Is(err, leagues.ErrNotFound) {
			httpx.WriteNotFound(w, r)
			return apitypes.LeagueSettings{}, false
		}
		if err != nil {
			httpx.WriteInternal(w, r, h.Log, "mocks: read league", err)
			return apitypes.LeagueSettings{}, false
		}
		// A saved league passes the gate again: a custom scoring league
		// saved under a pass that has since ended cannot start a mock.
		return l.Settings, h.Gate.Check(w, r, accountID, l.Settings, "settings.")
	default:
		return *in.Settings, h.Gate.Check(w, r, accountID, *in.Settings, "settings.")
	}
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in apitypes.MockCreate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if in.Seed != nil && (*in.Seed < 0 || *in.Seed > maxSeed) {
		httpx.WriteInvalid(w, r, map[string]string{"seed": "The seed is a whole number from 0 to 4294967295"})
		return
	}
	settings, ok := h.settingsFor(w, r, in)
	if !ok {
		return
	}
	seed := randomSeed()
	if in.Seed != nil {
		seed = *in.Seed
	}
	m, err := h.Store.Create(r.Context(), auth.AccountID(r), in.LeagueId, settings, seed)
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "mocks: create", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, apitypes.MockDetail{
		Id: m.Id, LeagueId: m.LeagueId, Settings: m.Settings, Seed: m.Seed, Status: m.Status,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, CompletedAt: m.CompletedAt, Actions: []apitypes.MockAction{},
	})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p, ok := httpx.ParsePage(w, r)
	if !ok {
		return
	}
	out, total, err := h.Store.List(r.Context(), auth.AccountID(r), p.PerPage, p.Offset())
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "mocks: list", err)
		return
	}
	httpx.WritePage(w, r, out, p, total)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	m, err := h.Store.Get(r.Context(), auth.AccountID(r), id)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "mocks: get", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, m)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	err := h.Store.Delete(r.Context(), auth.AccountID(r), id)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "mocks: delete", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}
