// Package companion is the Draft Pass's live draft (spec §2.7): a
// drafter pastes the link of a draft running on Sleeper and gets our
// call at each of their picks, against the host's actual picks, on our
// board. The host's picks are read on every poll through one shared
// read per draft (Poller), replayed on our engine as each seat's forced
// pick (Build), and never stored beyond that read.
package companion

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/memo"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Rate limits: the browser asks every 3 s while drafting, 20 a minute,
// so reads allow 60 a minute an account.
const (
	limitReadPerMinute   = 60
	limitCreatePerMinute = 20
	limitReportPerMinute = 30
)

// Repository is the part of Store the service uses.
type Repository interface {
	Upsert(ctx context.Context, r Row) (Row, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (Row, error)
	Progress(ctx context.Context, id uuid.UUID, status string, lastPick int, finished bool) error
	Card(ctx context.Context, id uuid.UUID, pick int) (json.RawMessage, bool, error)
	PutCard(ctx context.Context, id uuid.UUID, pick int, card any) error
	Cards(ctx context.Context, id uuid.UUID) (map[int]json.RawMessage, error)
	Report(ctx context.Context, id uuid.UUID) (json.RawMessage, bool, error)
	PutReport(ctx context.Context, id uuid.UUID, report any) error
	WithReportLock(ctx context.Context, id uuid.UUID, fn func(context.Context) error) error
}

// Checker answers whether an account may use a feature, from Can only.
type Checker interface {
	Can(ctx context.Context, accountID uuid.UUID, feature entitlements.Feature, now time.Time) (bool, error)
}

// BoardSource values the board for a league. *draftroom.Boards
// implements it.
type BoardSource interface {
	For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error)
}

// Directory is what the companion reads from the host beyond the draft:
// a drafter's user id by username, and a league's scoring.
type Directory interface {
	UserID(ctx context.Context, username string) (string, error)
	League(ctx context.Context, id string) (sleeper.League, error)
}

// Service serves the companion's routes.
type Service struct {
	Store     Repository
	Poller    *Poller
	Directory Directory
	Boards    BoardSource
	Matcher   Matcher
	Advisor   advisor.Advisor
	// Engine makes the conditional call between turns, the lobby's.
	Engine       advisor.Engine
	Entitlements Checker
	// Replay is the recorded draft, nil unless COMPANION_REPLAY is on.
	Replay        *Replay
	ReportWorkers int
	Now           func() time.Time
	Log           *slog.Logger

	// conditional keeps the between-turns card per companion and pick
	// count: every viewer of one pick costs one computation.
	conditional memo.Map[conditionalKey, apitypes.RoomCard]
}

type conditionalKey struct {
	companion uuid.UUID
	picks     int
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/companions", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitCreatePerMinute), Handler: s.create},
		{Method: http.MethodGet, Path: "/companions/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReadPerMinute), Handler: s.get},
		{Method: http.MethodGet, Path: "/companions/{id}/report", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitReportPerMinute), Handler: s.report},
	}
}

// allowed answers 403 with the feature unless the account has the live
// draft advisor, and says whether it does.
func (s *Service) allowed(w http.ResponseWriter, r *http.Request) bool {
	ok, err := s.Entitlements.Can(r.Context(), auth.AccountID(r), entitlements.LiveDraftAdvisor, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: can", err)
		return false
	}
	if !ok {
		httpx.WriteFeatureRequired(w, r, entitlements.LiveDraftAdvisor, "The live draft companion comes with the Draft Pass")
		return false
	}
	return true
}

// writeHostError says what went wrong reaching the host, in our words.
func (s *Service) writeHostError(w http.ResponseWriter, r *http.Request, err error) {
	var refusal *draft.Refusal
	switch {
	case errors.As(err, &refusal):
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refusal.Reason, nil)
	case errors.Is(err, sleeper.ErrNotFound):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "Sleeper has no draft at that link", nil)
	case errors.Is(err, sleeper.ErrUnavailable), errors.Is(err, sleeper.ErrMalformed):
		s.Log.Warn("companion: host", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "Sleeper is not answering right now. Try again in a moment", nil)
	default:
		httpx.WriteInternal(w, r, s.Log, "companion", err)
	}
}

func (s *Service) parseID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		httpx.WriteNotFound(w, r)
		return uuid.UUID{}, false
	}
	return id, true
}

// load is one of the account's companions, for an account that still
// has the live draft advisor: a pass refunded, disputed or past its
// season loses the call and the report at once, the same 403 as create.
func (s *Service) load(w http.ResponseWriter, r *http.Request) (Row, bool) {
	if !s.allowed(w, r) {
		return Row{}, false
	}
	id, ok := s.parseID(w, r)
	if !ok {
		return Row{}, false
	}
	row, err := s.Store.Get(r.Context(), auth.AccountID(r), id)
	// A replay made while COMPANION_REPLAY was on is gone once it is off.
	if errors.Is(err, ErrNotFound) || (err == nil && row.Replay && s.Replay == nil) {
		httpx.WriteNotFound(w, r)
		return Row{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: get", err)
		return Row{}, false
	}
	return row, true
}
