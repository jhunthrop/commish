package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/google/uuid"
)

// Body size caps. Every JSON body is read through one of these.
const (
	MaxSmallBody = 16 << 10
	MaxLargeBody = 512 << 10
)

// jsonMediaType is the only body type DecodeJSON reads.
const jsonMediaType = "application/json"

// DecodeJSON reads one JSON object of at most limit bytes into dst,
// refusing unknown fields and trailing data. The body must be sent as
// application/json: an HTML form cannot send that type across sites
// without a CORS preflight, so a cross-site form POST never reaches a
// handler that reads a body (and so never changes a cookie it sets). On
// failure it has already answered and reports false.
func DecodeJSON(w http.ResponseWriter, r *http.Request, limit int64, dst any) bool {
	if media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || media != jsonMediaType {
		WriteError(w, r, http.StatusUnsupportedMediaType, CodeUnsupportedMedia, "Send the body as application/json", nil)
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeDecodeError(w, r, err)
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		WriteInvalid(w, r, map[string]string{"body": "must be one JSON object"})
		return false
	}
	return true
}

func writeDecodeError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.As(err, &tooLarge):
		WriteError(w, r, http.StatusRequestEntityTooLarge, CodePayloadTooLarge,
			fmt.Sprintf("The body is over %d bytes", tooLarge.Limit), nil)
	case errors.As(err, &typeErr) && typeErr.Field != "":
		WriteInvalid(w, r, map[string]string{typeErr.Field: "has the wrong type"})
	default:
		WriteInvalid(w, r, map[string]string{"body": "is not valid JSON for this route"})
	}
}

// PathUUID reads a {name} path value as a UUID, answering 404 for
// anything else: an id that cannot exist is the same as one that does
// not.
func PathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		WriteNotFound(w, r)
		return uuid.Nil, false
	}
	return id, true
}

// Page is one page of a list.
type Page struct {
	Page    int
	PerPage int
}

// Offset is the row offset of the page.
func (p Page) Offset() int { return (p.Page - 1) * p.PerPage }

// Paging bounds, matching openapi.yaml's Page and PerPage parameters.
// MaxPage keeps the offset far from overflow and every list the API
// serves is far shorter.
const (
	DefaultPerPage = 25
	MaxPerPage     = 100
	MaxPage        = 10000
)

// ParsePage reads page and per_page. On a bad value it has already
// answered 400 and reports false.
func ParsePage(w http.ResponseWriter, r *http.Request) (Page, bool) {
	p := Page{Page: 1, PerPage: DefaultPerPage}
	fields := map[string]string{}
	if v := r.URL.Query().Get("page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > MaxPage {
			fields["page"] = fmt.Sprintf("must be from 1 to %d", MaxPage)
		}
		p.Page = n
	}
	if v := r.URL.Query().Get("per_page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > MaxPerPage {
			fields["per_page"] = fmt.Sprintf("must be from 1 to %d", MaxPerPage)
		}
		p.PerPage = n
	}
	if len(fields) > 0 {
		WriteInvalid(w, r, fields)
		return Page{}, false
	}
	return p, true
}
