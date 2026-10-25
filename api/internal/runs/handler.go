package runs

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jhunthrop/commish/api/internal/httpx"
)

// limitReadPerMinute is each /run route's budget: an app reads a handful
// of files when it opens, and a 304 after.
const limitReadPerMinute = 240

// cacheControl lets the apps and any cache between keep an answer as long
// as the reader takes the pointer as read.
var cacheControl = "public, max-age=" + strconv.Itoa(int(PointerTTL.Seconds()))

// Handler is the /run routes. A nil Reader (the runs' bucket has no keys
// here) answers 503 on every one.
type Handler struct {
	Reader *Reader
	Log    *slog.Logger
}

// Routes is every /run route: public, read only.
func (h *Handler) Routes() []httpx.Route {
	limit := httpx.PerMinute(limitReadPerMinute)
	file := func(a artifact) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) { h.serve(w, r, a) }
	}
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/run/manifest", Access: httpx.Public, Limit: limit, Handler: file(manifestFile)},
		{Method: http.MethodGet, Path: "/run/boards/{format}", Access: httpx.Public, Limit: limit, Handler: h.handleBoard},
		{Method: http.MethodGet, Path: "/run/index", Access: httpx.Public, Limit: limit, Handler: file(indexFile)},
		{Method: http.MethodGet, Path: "/run/adp", Access: httpx.Public, Limit: limit, Handler: file(adpFile)},
		{Method: http.MethodGet, Path: "/run/designations", Access: httpx.Public, Limit: limit, Handler: file(designationsFile)},
	}
}

// handleBoard answers a format the published run's manifest lists, and
// 404 for any other.
func (h *Handler) handleBoard(w http.ResponseWriter, r *http.Request) {
	format := r.PathValue("format")
	if !formatPattern.MatchString(format) {
		httpx.WriteInvalid(w, r, map[string]string{"format": "a format id reads like ppr-12"})
		return
	}
	if !h.ready(w, r) {
		return
	}
	manifest, err := h.Reader.Read(r.Context(), manifestFile)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	carried, err := formatsOf(manifest)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	if !slices.Contains(carried, format) {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound,
			"The run carries no "+format+" board. It carries "+strings.Join(carried, ", ")+".", nil)
		return
	}
	h.serve(w, r, boardFile(format))
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request, a artifact) {
	if !h.ready(w, r) {
		return
	}
	answer, err := h.Reader.Read(r.Context(), a)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	header := w.Header()
	header.Set("ETag", answer.ETag)
	header.Set("Cache-Control", cacheControl)
	if matches(r.Header.Get("If-None-Match"), answer.ETag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, answer.Data)
}

func (h *Handler) ready(w http.ResponseWriter, r *http.Request) bool {
	if h.Reader == nil {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeStorageUnavailable, "The run cannot be read here", nil)
		return false
	}
	return true
}

func (h *Handler) unavailable(w http.ResponseWriter, r *http.Request, err error) {
	h.Log.Error("runs: read", "request_id", httpx.RequestIDFrom(r.Context()), "path", r.URL.Path, "err", err)
	httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeStorageUnavailable, "The run cannot be read right now", nil)
}

// formatsOf is every format id the manifest's answer lists.
func formatsOf(manifest Answer) ([]string, error) {
	var data struct {
		Manifest struct {
			Formats []struct {
				ID string `json:"id"`
			} `json:"formats"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(manifest.Data, &data); err != nil {
		return nil, fmt.Errorf("runs: run %s manifest formats: %w", manifest.RunID, err)
	}
	ids := make([]string, 0, len(data.Manifest.Formats))
	for _, f := range data.Manifest.Formats {
		ids = append(ids, f.ID)
	}
	return ids, nil
}

// matches reports whether an If-None-Match header names tag: "*", or a
// listed tag, weak or strong (a weak comparison, as RFC 9110 has it).
func matches(header, tag string) bool {
	opaque := strings.TrimPrefix(tag, "W/")
	for _, listed := range strings.Split(header, ",") {
		listed = strings.TrimSpace(listed)
		if listed == "*" || strings.TrimPrefix(listed, "W/") == opaque {
			return true
		}
	}
	return false
}
