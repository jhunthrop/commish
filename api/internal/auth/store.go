package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store errors.
var (
	ErrNoSession   = errors.New("auth: no such session")
	ErrNoAccount   = errors.New("auth: no such account")
	ErrHandleTaken = errors.New("auth: handle taken")
)

// Session lifetime. A session slides: each day it is used, it is
// renewed for another SessionTTL.
const (
	SessionTTL        = 30 * 24 * time.Hour
	sessionRenewAfter = 24 * time.Hour
)

// Account is one row of app.accounts.
type Account struct {
	ID           uuid.UUID
	WorkOSUserID string
	Email        string
	FirstName    *string
	LastName     *string
	Handle       *string
	CreatedAt    time.Time
}

// Store reads and writes accounts and sessions.
type Store struct{ Pool *pgxpool.Pool }

const accountColumns = `a.id, a.workos_user_id, a.email, a.first_name, a.last_name, a.handle, a.created_at`

func scanAccount(row pgx.Row) (Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.WorkOSUserID, &a.Email, &a.FirstName, &a.LastName, &a.Handle, &a.CreatedAt)
	return a, err
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// UpsertAccount creates the account on first sign-in and keeps the
// email and name in step with WorkOS on every later one. The handle is
// ours and is never touched here.
func (s *Store) UpsertAccount(ctx context.Context, id Identity) (Account, error) {
	a, err := scanAccount(s.Pool.QueryRow(ctx, `
		insert into app.accounts as a (workos_user_id, email, first_name, last_name)
		values ($1, $2, $3, $4)
		on conflict (workos_user_id) do update
		  set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name
		returning `+accountColumns,
		id.UserID, id.Email, nullable(id.FirstName), nullable(id.LastName)))
	if err != nil {
		return Account{}, fmt.Errorf("auth: upsert account %s: %w", id.UserID, err)
	}
	return a, nil
}

// Account reads one account.
func (s *Store) Account(ctx context.Context, id uuid.UUID) (Account, error) {
	a, err := scanAccount(s.Pool.QueryRow(ctx, `select `+accountColumns+` from app.accounts a where a.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNoAccount
	}
	if err != nil {
		return Account{}, fmt.Errorf("auth: account %s: %w", id, err)
	}
	return a, nil
}

// HandleOf reads an account's handle, nil when it has none.
func (s *Store) HandleOf(ctx context.Context, id uuid.UUID) (*string, error) {
	a, err := s.Account(ctx, id)
	if err != nil {
		return nil, err
	}
	return a.Handle, nil
}

// SetHandle sets the account's handle. Uniqueness is case-insensitive.
func (s *Store) SetHandle(ctx context.Context, id uuid.UUID, handle string) (Account, error) {
	a, err := scanAccount(s.Pool.QueryRow(ctx,
		`update app.accounts a set handle = $2 where a.id = $1 returning `+accountColumns, id, handle))
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		return Account{}, ErrHandleTaken
	case errors.Is(err, pgx.ErrNoRows):
		return Account{}, ErrNoAccount
	case err != nil:
		return Account{}, fmt.Errorf("auth: set handle %s: %w", id, err)
	}
	return a, nil
}

// UpdateAccount is PATCH /me's write in one transaction (Lane 262 review
// L4): the handle when one is sent, then also (the push settings) in the
// same transaction, so neither lands without the other.
func (s *Store) UpdateAccount(ctx context.Context, id uuid.UUID, handle *string, also func(context.Context, pgx.Tx) error) (Account, error) {
	var a Account
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var err error
		if handle != nil {
			a, err = scanAccount(tx.QueryRow(ctx, `update app.accounts a set handle = $2 where a.id = $1 returning `+accountColumns, id, *handle))
		} else {
			a, err = scanAccount(tx.QueryRow(ctx, `select `+accountColumns+` from app.accounts a where a.id = $1`, id))
		}
		if err != nil {
			return err
		}
		if also != nil {
			return also(ctx, tx)
		}
		return nil
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		return Account{}, ErrHandleTaken
	case errors.Is(err, pgx.ErrNoRows):
		return Account{}, ErrNoAccount
	case err != nil:
		return Account{}, fmt.Errorf("auth: update account %s: %w", id, err)
	}
	return a, nil
}

// CreateSession stores a new session under its token's hash.
func (s *Store) CreateSession(ctx context.Context, accountID uuid.UUID, tokenHash []byte, workosSID, userAgent string, now time.Time) error {
	if _, err := s.Pool.Exec(ctx, `
		insert into app.sessions (account_id, token_hash, workos_session_id, user_agent, created_at, last_seen_at, expires_at)
		values ($1, $2, $3, $4, $5, $5, $6)`,
		accountID, tokenHash, nullable(workosSID), nullable(truncate(userAgent, 512)), now, now.Add(SessionTTL)); err != nil {
		return fmt.Errorf("auth: create session for %s: %w", accountID, err)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// SessionAccount resolves a live session to its account. renewed is
// true when the session was slid forward, so the caller re-issues the
// cookie with the new lifetime.
func (s *Store) SessionAccount(ctx context.Context, tokenHash []byte, now time.Time) (a Account, renewed bool, err error) {
	var lastSeen time.Time
	row := s.Pool.QueryRow(ctx, `
		select `+accountColumns+`, s.last_seen_at
		from app.sessions s join app.accounts a on a.id = s.account_id
		where s.token_hash = $1 and s.expires_at > $2`, tokenHash, now)
	err = row.Scan(&a.ID, &a.WorkOSUserID, &a.Email, &a.FirstName, &a.LastName, &a.Handle, &a.CreatedAt, &lastSeen)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, false, ErrNoSession
	}
	if err != nil {
		return Account{}, false, fmt.Errorf("auth: read session: %w", err)
	}
	if now.Sub(lastSeen) < sessionRenewAfter {
		return a, false, nil
	}
	if _, err := s.Pool.Exec(ctx,
		`update app.sessions set last_seen_at = $2, expires_at = $3 where token_hash = $1`,
		tokenHash, now, now.Add(SessionTTL)); err != nil {
		return Account{}, false, fmt.Errorf("auth: renew session: %w", err)
	}
	return a, true, nil
}

// DeleteSession ends a session and returns its WorkOS session id, empty
// when it had none or did not exist.
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) (string, error) {
	var sid *string
	err := s.Pool.QueryRow(ctx,
		`delete from app.sessions where token_hash = $1 returning workos_session_id`, tokenHash).Scan(&sid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("auth: delete session: %w", err)
	}
	if sid == nil {
		return "", nil
	}
	return *sid, nil
}

// SweepExpiredSessions deletes every session past its expiry.
func (s *Store) SweepExpiredSessions(ctx context.Context, now time.Time) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `delete from app.sessions where expires_at <= $1`, now)
	if err != nil {
		return 0, fmt.Errorf("auth: sweep sessions: %w", err)
	}
	return tag.RowsAffected(), nil
}
