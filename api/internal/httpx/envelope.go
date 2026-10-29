// Package httpx is the request plumbing every route shares: the
// envelope (spec §2.2), request ids, structured logging, panic recovery,
// CORS, per-route rate limits, JSON decoding and pagination. It knows
// nothing about accounts; internal/server composes it with auth.
package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Error codes. A client branches on these, never on the message.
const (
	CodeInvalid            = "invalid"
	CodeUnauthorized       = "unauthorized"
	CodeForbidden          = "forbidden"
	CodeNotFound           = "not_found"
	CodeConflict           = "conflict"
	CodeRateLimited        = "rate_limited"
	CodeCSRF               = "csrf"
	CodePayloadTooLarge    = "payload_too_large"
	CodeUnsupportedMedia   = "unsupported_media_type"
	CodeBillingUnavailable = "billing_unavailable"
	CodeStorageUnavailable = "storage_unavailable"
	CodeUnavailable        = "unavailable"
	CodeInternal           = "internal"
	// CodeTeamNotRead is an in-season route's 404 for a team missing from
	// the league's last read: reading the host again may find it.
	CodeTeamNotRead = "team_not_read"
	// CodeFreeSeason is checkout's 409 in a free season: nothing is sold.
	CodeFreeSeason = "free_season"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota + 1
	routeKey
)

// WithRequestID stores the request id on a context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestIDFrom reads the request id, empty outside a request.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

func write(w http.ResponseWriter, status int, e apitypes.Envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(e); err != nil {
		// The status line is already out; all that is left is the log.
		slog.Default().Error("httpx: encode envelope", "request_id", e.RequestId, "err", err)
	}
}

// WriteOK answers status with data in the envelope.
func WriteOK(w http.ResponseWriter, r *http.Request, status int, data any) {
	write(w, status, apitypes.Envelope{Ok: true, Data: data, RequestId: RequestIDFrom(r.Context())})
}

// WritePage answers 200 with one page of a list and its meta.
func WritePage(w http.ResponseWriter, r *http.Request, data any, p Page, total int64) {
	write(w, http.StatusOK, apitypes.Envelope{
		Ok: true, Data: data, RequestId: RequestIDFrom(r.Context()),
		Meta: &apitypes.PageMeta{Page: p.Page, PerPage: p.PerPage, Total: total},
	})
}

// WriteError answers with the error envelope. fields names the inputs
// at fault, nil when none is.
func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string, fields map[string]string) {
	body := &apitypes.ErrorBody{Code: code, Message: message}
	if len(fields) > 0 {
		body.Fields = &fields
	}
	write(w, status, apitypes.Envelope{Ok: false, Error: body, RequestId: RequestIDFrom(r.Context())})
}

// WriteFeatureRequired answers 403 naming the feature the caller lacks,
// so the page can show the one product that unlocks it.
func WriteFeatureRequired(w http.ResponseWriter, r *http.Request, feature apitypes.Feature, message string) {
	write(w, http.StatusForbidden, apitypes.Envelope{
		Ok: false, RequestId: RequestIDFrom(r.Context()),
		Error: &apitypes.ErrorBody{Code: CodeForbidden, Message: message, Feature: &feature},
	})
}

// Common answers, worded once.
func WriteNotFound(w http.ResponseWriter, r *http.Request) {
	WriteError(w, r, http.StatusNotFound, CodeNotFound, "Nothing here by that id", nil)
}

// invalidMessage is the sentence of every 400 with fields at fault.
const invalidMessage = "Some of that did not check out"

// WriteInvalid answers 400 with the fields at fault.
func WriteInvalid(w http.ResponseWriter, r *http.Request, fields map[string]string) {
	WriteError(w, r, http.StatusBadRequest, CodeInvalid, invalidMessage, fields)
}

// WriteInvalidSkipped answers 400 with the fields at fault and the lines
// an import skipped, each with its reason (an empty list is sent as one).
func WriteInvalidSkipped(w http.ResponseWriter, r *http.Request, fields map[string]string, skipped []apitypes.ImportSkip) {
	if skipped == nil {
		skipped = []apitypes.ImportSkip{}
	}
	body := &apitypes.ErrorBody{Code: CodeInvalid, Message: invalidMessage, Skipped: &skipped}
	if len(fields) > 0 {
		body.Fields = &fields
	}
	write(w, http.StatusBadRequest, apitypes.Envelope{Ok: false, Error: body, RequestId: RequestIDFrom(r.Context())})
}

// WriteInternal logs err with the request id and answers 500 without
// leaking it.
func WriteInternal(w http.ResponseWriter, r *http.Request, log *slog.Logger, op string, err error) {
	log.Error(op, "request_id", RequestIDFrom(r.Context()), "err", err)
	WriteError(w, r, http.StatusInternalServerError, CodeInternal, "Something went wrong on our side", nil)
}
