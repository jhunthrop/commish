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

// Start keeps a new sign-in in flight, dropping every expired one.
func (s *States) Start(ctx context.Context, accountID uuid.UUID, state, verifier string, now time.Time) error {
	if _, err := s.Pool.Exec(ctx, `delete from app.host_oauth_states where expires_at < $1`, now); err != nil {
		return fmt.Errorf("yahoo: drop expired states: %w", err)
	}
	_, err := s.Pool.Exec(ctx, `insert into app.host_oauth_states (state_hash, account_id, host, verifier, expires_at)
		values ($1, $2, $3, $4, $5)`, stateHash(state), accountID, Host, verifier, now.Add(StateTTL))
	if err != nil {
		return fmt.Errorf("yahoo: keep state: %w", err)
	}
	return nil
}

// Finish takes a sign-in in flight, once: the account that started it
// and its verifier, or ErrNoState.
func (s *States) Finish(ctx context.Context, state string, now time.Time) (uuid.UUID, string, error) {
	var accountID uuid.UUID
	var verifier string
	err := s.Pool.QueryRow(ctx, `delete from app.host_oauth_states where state_hash = $1 and host = $2 and expires_at >= $3
		returning account_id, verifier`, stateHash(state), Host, now).Scan(&accountID, &verifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", ErrNoState
	}
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("yahoo: take state: %w", err)
	}
	return accountID, verifier, nil
}
