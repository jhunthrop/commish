package sheets

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// maxImportBody bounds a CSV import: a full sheet with long notes is
// well under it.
const maxImportBody = 1 << 20

// Rate limits for the sheet routes. A drag sends the whole order, so
// row writes allow a steady hand.
var (
	limitRead   = httpx.Limit{N: 240, Per: time.Minute}
	limitWrite  = httpx.Limit{N: 120, Per: time.Minute}
	limitCreate = httpx.Limit{N: 30, Per: time.Minute}
	limitImport = httpx.Limit{N: 30, Per: time.Hour}
)

// Handler serves /sheets.
type Handler struct {
	Store *Store
	Log   *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/sheets", Access: httpx.SignedIn, Limit: limitRead, Handler: h.list},
		{Method: http.MethodPost, Path: "/sheets", Access: httpx.SignedIn, Limit: limitCreate, Handler: h.create},
		{Method: http.MethodGet, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: limitRead, Handler: h.get},
		{Method: http.MethodPatch, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.rename},
		{Method: http.MethodDelete, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.delete},
		{Method: http.MethodPut, Path: "/sheets/{id}/rows", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.replaceRows},
		{Method: http.MethodPut, Path: "/sheets/{id}/rows/{player_id}", Access: httpx.SignedIn, Limit: limitWrite, Handler: h.updateRow},
		{Method: http.MethodPost, Path: "/sheets/{id}/import", Access: httpx.SignedIn, Limit: limitImport, Handler: h.importCSV},
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteNotFound(w, r)
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "You have the most sheets allowed, delete one first", nil)
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
		h.fail(w, r, "sheets: list", err)
		return
	}
	httpx.WritePage(w, r, out, p, total)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in apitypes.SheetCreate
	if !httpx.DecodeJSON(w, r, httpx.MaxLargeBody, &in) {
		return
	}
	errs := validateName(in.Name)
	if !in.Format.Valid() {
		if errs == nil {
			errs = map[string]string{}
		}
		errs["format"] = "Pick a board format"
	}
	if errs == nil && in.Rows != nil {
		errs = validateRows(*in.Rows)
	}
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	d, err := h.Store.Create(r.Context(), auth.AccountID(r), in)
	if err != nil {
		h.fail(w, r, "sheets: create", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusCreated, d)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	d, err := h.Store.Get(r.Context(), auth.AccountID(r), id)
	if err != nil {
		h.fail(w, r, "sheets: get", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, d)
}

func (h *Handler) rename(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	var in apitypes.SheetUpdate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if errs := validateName(in.Name); errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	s, err := h.Store.Rename(r.Context(), auth.AccountID(r), id, in.Name)
	if err != nil {
		h.fail(w, r, "sheets: rename", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, s)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.Store.Delete(r.Context(), auth.AccountID(r), id); err != nil {
		h.fail(w, r, "sheets: delete", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

func (h *Handler) replaceRows(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	var in apitypes.SheetRowsReplace
	if !httpx.DecodeJSON(w, r, httpx.MaxLargeBody, &in) {
		return
	}
	if errs := validateRows(in.Rows); errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	d, err := h.Store.ReplaceRows(r.Context(), auth.AccountID(r), id, in.Rows)
	if err != nil {
		h.fail(w, r, "sheets: replace rows", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, d)
}

func (h *Handler) updateRow(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	var in apitypes.SheetRowUpdate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	errs := map[string]string{}
	validateAnnotations(errs, "", in.Tier, in.Tag, in.Note)
	if len(errs) > 0 {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	row, err := h.Store.UpdateRow(r.Context(), auth.AccountID(r), id, r.PathValue("player_id"), in)
	if err != nil {
		h.fail(w, r, "sheets: update row", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, row)
}

func (h *Handler) importCSV(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	rows, skipped, err := DecodeCSV(http.MaxBytesReader(w, r.Body, maxImportBody))
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge):
		httpx.WriteError(w, r, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "That file is over 1 MB", nil)
		return
	case errors.Is(err, ErrBadHeader):
		httpx.WriteInvalid(w, r, map[string]string{"body": "The first line must name rank, player_id, name and position"})
		return
	case err != nil:
		httpx.WriteInternal(w, r, h.Log, "sheets: import", err)
		return
	}
	d, err := h.Store.ReplaceRows(r.Context(), auth.AccountID(r), id, rows)
	if err != nil {
		h.fail(w, r, "sheets: import", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.SheetImportResult{Imported: len(rows), Skipped: skipped, Sheet: d})
}
