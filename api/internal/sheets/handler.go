package sheets

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// maxSheetBody bounds a CSV import and a whole-sheet JSON write: a full
// sheet of 1,000 rows with long notes and faces is under it.
const maxSheetBody = 1 << 20

// Rate limits for the sheet routes. A drag sends the whole order, so
// row writes allow a steady hand.
const (
	limitReadPerMinute   = 240
	limitWritePerMinute  = 120
	limitCreatePerMinute = 30
	limitImportPerHour   = 30
)

// Repository is the part of Store the handlers use.
type Repository interface {
	List(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]apitypes.Sheet, int64, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.SheetDetail, error)
	Create(ctx context.Context, accountID uuid.UUID, in apitypes.SheetCreate) (apitypes.SheetDetail, error)
	Rename(ctx context.Context, accountID, id uuid.UUID, name string) (apitypes.Sheet, error)
	Delete(ctx context.Context, accountID, id uuid.UUID) error
	ReplaceRows(ctx context.Context, accountID, id uuid.UUID, rows []apitypes.SheetRowInput, name *string, ifUpdatedAt *time.Time) (apitypes.SheetDetail, error)
	UpdateRow(ctx context.Context, accountID, id uuid.UUID, playerID string, in apitypes.SheetRowUpdate) (apitypes.SheetRow, error)
}

// BoardLoader reads a stored board: boards.Cache.
type BoardLoader interface {
	Load(ctx context.Context, f boards.Format) (*boards.Raw, error)
}

// Handler serves /sheets. Boards is what a names list is read against.
type Handler struct {
	Store  Repository
	Boards BoardLoader
	Log    *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/sheets", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.list},
		{Method: http.MethodPost, Path: "/sheets", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitCreatePerMinute), Handler: h.create},
		{Method: http.MethodGet, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.get},
		{Method: http.MethodPatch, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitWritePerMinute), Handler: h.rename},
		{Method: http.MethodDelete, Path: "/sheets/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitWritePerMinute), Handler: h.delete},
		{Method: http.MethodPut, Path: "/sheets/{id}/rows", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitWritePerMinute), Handler: h.replaceRows},
		{Method: http.MethodPut, Path: "/sheets/{id}/rows/{player_id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitWritePerMinute), Handler: h.updateRow},
		{Method: http.MethodPost, Path: "/sheets/{id}/import", Access: httpx.SignedIn, Limit: httpx.PerHour(limitImportPerHour), Handler: h.importCSV},
	}
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.WriteNotFound(w, r)
	case errors.Is(err, ErrTooMany):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "You have the most sheets allowed, delete one first", nil)
	case errors.Is(err, ErrChanged):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "This sheet changed on another device", nil)
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
	if !httpx.DecodeJSON(w, r, maxSheetBody, &in) {
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
		rows := normalizeRows(*in.Rows)
		in.Rows = &rows
		errs = validateRows(rows)
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
	if !httpx.DecodeJSON(w, r, maxSheetBody, &in) {
		return
	}
	rows := normalizeRows(in.Rows)
	errs := validateRows(rows)
	if in.Name != nil {
		if nameErrs := validateName(*in.Name); nameErrs != nil {
			if errs == nil {
				errs = map[string]string{}
			}
			errs["name"] = nameErrs["name"]
		}
	}
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	d, err := h.Store.ReplaceRows(r.Context(), auth.AccountID(r), id, rows, in.Name, in.IfUpdatedAt)
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
	in.Tags = normalizeTags(&in.Tags)
	validateAnnotations(errs, "", in.Tier, in.Tags, in.Note, ownTag())
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

// emptyReadSentence refuses a body that read to no player: the import
// replaces the sheet, so an empty read would empty it. The refusal carries
// the skipped lines with their reasons, as a 200 import does.
const emptyReadSentence = "No player read, so your sheet is as it was."

// badHeaderSentence refuses a CSV whose first line is not the header.
const badHeaderSentence = "The first row must name rank, player_id, name and position"

// readImport reads the body as the sheet's CSV, or as a names list against
// the board the sheet is built on. It answers the request itself when it
// cannot read.
func (h *Handler) readImport(w http.ResponseWriter, r *http.Request, id uuid.UUID) ([]apitypes.SheetRowInput, []apitypes.ImportSkip, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSheetBody))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		httpx.WriteError(w, r, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "That file is over 1 MB", nil)
		return nil, nil, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "sheets: import", err)
		return nil, nil, false
	}
	if looksLikeCSV(string(body)) {
		rows, skipped, err := DecodeCSV(bytes.NewReader(body))
		if errors.Is(err, ErrBadHeader) {
			httpx.WriteInvalid(w, r, map[string]string{"body": badHeaderSentence})
			return nil, nil, false
		}
		if err != nil {
			httpx.WriteInternal(w, r, h.Log, "sheets: import", err)
			return nil, nil, false
		}
		return rows, skipped, true
	}
	raw, ok := h.boardFor(w, r, id)
	if !ok {
		return nil, nil, false
	}
	rows, skipped := ReadList(string(body), raw)
	if len(rows) == 0 && headerLike(string(body)) {
		httpx.WriteInvalid(w, r, map[string]string{"body": badHeaderSentence})
		return nil, nil, false
	}
	return rows, skipped, true
}

// boardFor is the stored board of the sheet's format, which a names list
// is matched against.
func (h *Handler) boardFor(w http.ResponseWriter, r *http.Request, id uuid.UUID) (*boards.Raw, bool) {
	d, err := h.Store.Get(r.Context(), auth.AccountID(r), id)
	if err != nil {
		h.fail(w, r, "sheets: import", err)
		return nil, false
	}
	raw, err := h.Boards.Load(r.Context(), boards.FormatForBoard(d.Format))
	if err != nil {
		h.Log.Error("sheets: import board", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "Our board did not load, so a list of names cannot be read yet", nil)
		return nil, false
	}
	return raw, true
}

func (h *Handler) importCSV(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	rows, skipped, ok := h.readImport(w, r, id)
	if !ok {
		return
	}
	if len(rows) == 0 {
		// A sheet that is not the account's is a 404 before it is a refusal.
		if _, err := h.Store.Get(r.Context(), auth.AccountID(r), id); err != nil {
			h.fail(w, r, "sheets: import", err)
			return
		}
		httpx.WriteInvalidSkipped(w, r, map[string]string{"body": emptyReadSentence}, skipped)
		return
	}
	d, err := h.Store.ReplaceRows(r.Context(), auth.AccountID(r), id, rows, nil, nil)
	if err != nil {
		h.fail(w, r, "sheets: import", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.SheetImportResult{Imported: len(rows), Skipped: skipped, Sheet: d})
}
