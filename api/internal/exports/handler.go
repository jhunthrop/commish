package exports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/sheets"
)

// Lifetimes. The bucket's lifecycle rule deletes objects after
// FileTTL too, so an export never outlives its row by much.
const (
	FileTTL = 7 * 24 * time.Hour
	LinkTTL = 15 * time.Minute
)

// Rate limits for the export routes. Writing a file costs storage, so
// creating one is budgeted by the hour.
const (
	limitCreatePerHour = 30
	limitReadPerMinute = 120
)

// Objects is the bucket. *R2 implements it.
type Objects interface {
	Put(ctx context.Context, key, contentType, disposition string, body []byte) error
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}

// SheetReader is the part of sheets.Store an export reads.
type SheetReader interface {
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.SheetDetail, error)
}

// Repository is the part of Store the handlers use.
type Repository interface {
	Insert(ctx context.Context, x Row) (Row, error)
	Get(ctx context.Context, accountID, id uuid.UUID, now time.Time) (Row, error)
	List(ctx context.Context, accountID uuid.UUID, now time.Time, limit, offset int) ([]apitypes.Export, int64, error)
}

// Handler serves the export routes.
type Handler struct {
	Store  Repository
	Sheets SheetReader
	// Objects is nil when R2 is not configured; the routes then answer
	// 503 rather than the API refusing to start.
	Objects Objects
	Now     func() time.Time
	Log     *slog.Logger
}

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/sheets/{id}/exports", Access: httpx.SignedIn, Limit: httpx.PerHour(limitCreatePerHour), Handler: h.create},
		{Method: http.MethodGet, Path: "/exports", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.list},
		{Method: http.MethodGet, Path: "/exports/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: h.get},
	}
}

func writeUnavailable(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeStorageUnavailable, "Exports are not available right now", nil)
}

var unsafeFileChars = regexp.MustCompile(`[^A-Za-z0-9 _.-]+`)

// fileName is the download's name: the sheet's name made safe for any
// file system, then the extension.
func fileName(sheetName string) string {
	base := strings.TrimSpace(unsafeFileChars.ReplaceAllString(sheetName, ""))
	if base == "" {
		base = "sheet"
	}
	return base + ".csv"
}

func (h *Handler) link(w http.ResponseWriter, r *http.Request, x Row, status int) {
	url, err := h.Objects.PresignGet(r.Context(), x.ObjectKey, LinkTTL)
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: sign", err)
		return
	}
	e := x.Export
	httpx.WriteOK(w, r, status, apitypes.ExportLink{
		Id: e.Id, SheetId: e.SheetId, Format: e.Format, FileName: e.FileName, Bytes: e.Bytes,
		CreatedAt: e.CreatedAt, ExpiresAt: e.ExpiresAt, Url: url, UrlExpiresAt: h.Now().Add(LinkTTL),
	})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	if h.Objects == nil {
		writeUnavailable(w, r)
		return
	}
	sheetID, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	var in apitypes.ExportCreate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if !in.Format.Valid() {
		httpx.WriteInvalid(w, r, map[string]string{"format": "Pick csv"})
		return
	}
	accountID := auth.AccountID(r)
	sheet, err := h.Sheets.Get(r.Context(), accountID, sheetID)
	if errors.Is(err, sheets.ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: read sheet", err)
		return
	}
	body, err := sheets.EncodeCSV(sheet)
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: encode", err)
		return
	}
	id := uuid.New()
	name := fileName(sheet.Name)
	key := fmt.Sprintf("exports/%s/%s.csv", accountID, id)
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if err := h.Objects.Put(r.Context(), key, "text/csv; charset=utf-8", disposition, body); err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: put", err)
		return
	}
	x, err := h.Store.Insert(r.Context(), Row{
		Export: apitypes.Export{
			Id: id, SheetId: &sheetID, Format: in.Format, FileName: name, Bytes: int64(len(body)),
			ExpiresAt: h.Now().Add(FileTTL),
		},
		AccountID: accountID, ObjectKey: key,
	})
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: record", err)
		return
	}
	h.link(w, r, x, http.StatusCreated)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p, ok := httpx.ParsePage(w, r)
	if !ok {
		return
	}
	out, total, err := h.Store.List(r.Context(), auth.AccountID(r), h.Now(), p.PerPage, p.Offset())
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: list", err)
		return
	}
	httpx.WritePage(w, r, out, p, total)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	if h.Objects == nil {
		writeUnavailable(w, r)
		return
	}
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	x, err := h.Store.Get(r.Context(), auth.AccountID(r), id, h.Now())
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "exports: get", err)
		return
	}
	h.link(w, r, x, http.StatusOK)
}

// ExpiredRows is the part of Store the sweep uses.
type ExpiredRows interface {
	Expired(ctx context.Context, now time.Time, limit int) ([]Row, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// Sweep deletes expired exports, object first and then row, up to
// batch at a time. The bucket's lifecycle rule is the backstop.
func Sweep(ctx context.Context, store ExpiredRows, objects Objects, now time.Time, batch int) (int, error) {
	expired, err := store.Expired(ctx, now, batch)
	if err != nil {
		return 0, err
	}
	for i, x := range expired {
		if err := objects.Delete(ctx, x.ObjectKey); err != nil {
			return i, err
		}
		if err := store.Delete(ctx, x.Id); err != nil {
			return i, err
		}
	}
	return len(expired), nil
}
