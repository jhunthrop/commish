package deletion

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/lobby"
)

// The route's limit: a member deletes once; a handful a minute covers a
// mistyped email or two.
const limitDeletePerMinute = 5

// afterCommitTimeout bounds the provider call and the bucket's deletes
// the request makes after the commit. They outlive a client that hangs
// up: the account is gone whether or not the answer arrives.
const afterCommitTimeout = 15 * time.Second

// The sentences the clients show, by the field at fault.
const (
	// WrongEmail is the confirmation that does not match the account.
	WrongEmail = "Type the email you sign in with"
	// Renewing is the membership that would renew with no account left.
	Renewing = "Cancel your membership first, so your card is not charged again"
)

// Accounts is the part of Store the route and the sweep use.
type Accounts interface {
	Delete(ctx context.Context, accountID uuid.UUID, now time.Time) (Deleted, error)
	Pending(ctx context.Context, limit int) ([]Pending, error)
	Done(ctx context.Context, workosUserID string) error
	Failed(ctx context.Context, workosUserID string, cause error, now time.Time) error
}

// Rooms gives up a member's seats in live lobby drafts, the way a
// drafter who leaves gives one up: a filling room frees it, a drafting
// room hands it to its stand-in, and every socket on the room is told.
// lobby.Store implements it.
type Rooms interface {
	LiveRoomsOf(ctx context.Context, account uuid.UUID) ([]uuid.UUID, error)
	Leave(ctx context.Context, id, account uuid.UUID) error
}

// Users is the sign-in provider's user directory. auth.WorkOS
// implements it.
type Users interface {
	DeleteUser(ctx context.Context, userID string) error
}

// Objects deletes an export file from the bucket. exports.R2 implements
// it; nil when the bucket is not configured.
type Objects interface {
	Delete(ctx context.Context, key string) error
}

// Cookies clears the browser's session cookie. auth.Sessions implements
// it.
type Cookies interface {
	Clear(w http.ResponseWriter)
}

// Service serves POST /me/delete and retries the provider's deletes.
type Service struct {
	Accounts Accounts
	Rooms    Rooms
	Users    Users
	Objects  Objects
	Cookies  Cookies
	Now      func() time.Time
	Log      *slog.Logger
}

// Routes is the one route.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/me/delete", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDeletePerMinute), Handler: s.delete},
	}
}

// Confirmed reports whether typed is the account's email, without regard
// to case or the spaces around it.
func Confirmed(typed, email string) bool {
	typed = strings.TrimSpace(typed)
	return typed != "" && strings.EqualFold(typed, strings.TrimSpace(email))
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.AccountFrom(r.Context())
	var in apitypes.AccountDeletion
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if !Confirmed(in.Email, a.Email) {
		httpx.WriteInvalid(w, r, map[string]string{"email": WrongEmail})
		return
	}
	if err := s.leaveRooms(r.Context(), a.ID); err != nil {
		httpx.WriteInternal(w, r, s.Log, "deletion: leave rooms", err)
		return
	}
	deleted, err := s.Accounts.Delete(r.Context(), a.ID, s.Now())
	switch {
	case errors.Is(err, ErrRenewing):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, Renewing, nil)
		return
	case errors.Is(err, ErrNoAccount):
		// A second request that lost the race to the first: the account is
		// gone either way.
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "deletion: delete account", err)
		return
	default:
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), afterCommitTimeout)
		s.retire(ctx, Pending{WorkOSUserID: deleted.WorkOSUserID, FormerAccountID: a.ID})
		s.deleteObjects(ctx, a.ID, deleted.ObjectKeys)
		cancel()
		s.Log.Info("deletion: account deleted", "request_id", httpx.RequestIDFrom(r.Context()), "former_account_id", a.ID)
	}
	s.Cookies.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}

// leaveRooms gives up every live seat the account holds before its rows
// go, so a room on the clock hands the seat to its stand-in at once.
func (s *Service) leaveRooms(ctx context.Context, accountID uuid.UUID) error {
	ids, err := s.Rooms.LiveRoomsOf(ctx, accountID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.Rooms.Leave(ctx, id, accountID); err != nil && !errors.Is(err, lobby.ErrNoSeat) {
			return err
		}
	}
	return nil
}

// retire deletes one provider user and drops its pending row, or keeps
// the row with the failure for the sweep. A failure is logged with the
// deleted account's former id, never silent.
func (s *Service) retire(ctx context.Context, p Pending) bool {
	if err := s.Users.DeleteUser(ctx, p.WorkOSUserID); err != nil {
		s.Log.Error("deletion: sign-in user not deleted, the sweep retries it",
			"former_account_id", p.FormerAccountID, "attempts", p.Attempts+1, "err", err)
		if ferr := s.Accounts.Failed(ctx, p.WorkOSUserID, err, s.Now()); ferr != nil {
			s.Log.Error("deletion: keep the failure", "former_account_id", p.FormerAccountID, "err", ferr)
		}
		return false
	}
	if err := s.Accounts.Done(ctx, p.WorkOSUserID); err != nil {
		// The row stays and the next sweep deletes the user again, which
		// answers as done (a user already gone is success).
		s.Log.Error("deletion: drop the pending row", "former_account_id", p.FormerAccountID, "err", err)
	}
	return true
}

// deleteObjects deletes the account's export files. A failure is logged;
// the bucket's lifecycle rule removes the file within its seven days.
func (s *Service) deleteObjects(ctx context.Context, accountID uuid.UUID, keys []string) {
	if s.Objects == nil {
		return
	}
	for _, key := range keys {
		if err := s.Objects.Delete(ctx, key); err != nil {
			s.Log.Warn("deletion: export file left to the bucket's lifecycle", "former_account_id", accountID, "err", err)
		}
	}
}

// Retried is one sweep's count.
type Retried struct {
	Deleted int
	Failed  int
}

// Retry tries every pending provider user again, up to batch, oldest
// first: the daily sweep's step (cmd/api jobs.go).
func (s *Service) Retry(ctx context.Context, batch int) (Retried, error) {
	pending, err := s.Accounts.Pending(ctx, batch)
	if err != nil {
		return Retried{}, err
	}
	var out Retried
	for _, p := range pending {
		if s.retire(ctx, p) {
			out.Deleted++
		} else {
			out.Failed++
		}
	}
	return out, nil
}
