package mocks

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Rate limits for listing and deleting. The room's own routes (create,
// pick, undo, the card, the report) are internal/solo's.
const (
	limitReadPerMinute   = 240
	limitDeletePerMinute = 60
)

// Repository is the part of Store the handlers use.
type Repository interface {
	List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.Mock, int64, error)
	Delete(ctx context.Context, accountID, id uuid.UUID) error
}

// Handler serves the account's list of mocks.
type Handler struct {
	Store Repository
	Log   *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/mocks", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.list},
		{Method: http.MethodDelete, Path: "/mocks/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDeletePerMinute), Handler: h.delete},
	}
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
