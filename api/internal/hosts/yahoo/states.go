package yahoo

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StateTTL is how long an authorize address works.
const StateTTL = 10 * time.Minute

// ErrNoState is a state this account never started, already used, or
// past its ten minutes.
var ErrNoState = errors.New("yahoo: no such sign-in in flight")

// States keeps each sign-in in flight (app.host_oauth_states) by its
// state's sha256, so one state finishes one sign-in for the account that
// started it, within StateTTL.
type States struct{ Pool *pgxpool.Pool }

func stateHash(state string) []byte {
	sum := sha256.Sum256([]byte(state))
	return sum[:]
}

// Flight is one sign-in in flight: the account that started it, its PKCE
// verifier, and the site page to return to (empty for the account page).
type Flight struct {
	Account  uuid.UUID
	Verifier string
	ReturnTo string
}

// Start keeps a new sign-in in flight, dropping every expired one.
func (s *States) Start(ctx context.Context, f Flight, state string, now time.Time) error {
	if _, err := s.Pool.Exec(ctx, `delete from app.host_oauth_states where expires_at < $1`, now); err != nil {
		return fmt.Errorf("yahoo: drop expired states: %w", err)
	}
	_, err := s.Pool.Exec(ctx, `insert into app.host_oauth_states (state_hash, account_id, host, verifier, return_to, expires_at)
		values ($1, $2, $3, $4, nullif($5, ''), $6)`, stateHash(state), f.Account, Host, f.Verifier, f.ReturnTo, now.Add(StateTTL))
	if err != nil {
		return fmt.Errorf("yahoo: keep state: %w", err)
	}
	return nil
}

// Finish takes a sign-in in flight, once: the account that started it
// and its verifier, or ErrNoState.
func (s *States) Finish(ctx context.Context, state string, now time.Time) (Flight, error) {
	var f Flight
	err := s.Pool.QueryRow(ctx, `delete from app.host_oauth_states where state_hash = $1 and host = $2 and expires_at >= $3
		returning account_id, verifier, coalesce(return_to, '')`, stateHash(state), Host, now).Scan(&f.Account, &f.Verifier, &f.ReturnTo)
	if errors.Is(err, pgx.ErrNoRows) {
		return Flight{}, ErrNoState
	}
	if err != nil {
		return Flight{}, fmt.Errorf("yahoo: take state: %w", err)
	}
	return f, nil
}
