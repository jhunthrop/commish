// Package deletion deletes a member's account at their own request
// (Lane 233, B230: Apple's guideline 5.1.1(v) and Play's data deletion
// rule): POST /me/delete, every row kept with the account in one
// transaction, then the sign-in provider's user, retried by the daily
// sweep when the provider fails.
package deletion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DepartedHandle is the name a kept lobby seat carries once its member
// deleted their account: the draft keeps the seat and its picks, the
// member's handle goes.
const DepartedHandle = "Former member"

// Errors a caller tells apart.
var (
	// ErrNoAccount is an account already gone (a second request that
	// lost the race to the first).
	ErrNoAccount = errors.New("deletion: no such account")
	// ErrRenewing is an account whose membership still renews: deleting
	// it would leave the card charged with no account to cancel from.
	ErrRenewing = errors.New("deletion: membership renews")
)

// maxErrorChars bounds the provider's error kept on a pending row.
const maxErrorChars = 500

// MaxAttempts is how many failed tries mark a provider user dead: about
// ten days of daily sweeps. A dead row is logged once for a hand.
const MaxAttempts = 10

// Store deletes accounts and keeps the provider's users still to delete.
type Store struct{ Pool *pgxpool.Pool }

// Deleted is what the transaction leaves for after its commit.
type Deleted struct {
	// WorkOSUserID is the provider's user, queued in the same commit.
	WorkOSUserID string
	// ObjectKeys are the account's export files in the bucket; their rows
	// are gone, and the bucket's lifecycle rule is the backstop.
	ObjectKeys []string
}

// Delete removes the account and everything kept with it, in one
// transaction, and queues its provider user. The platform connections go
// first, as the privacy policy says. Most rows go by the accounts
// table's cascades (migrations 00001 to 00031); the statements here are
// what a cascade does not reach: a league read kept as the member
// (league_snapshots.read_as names the account with no reference), and
// the kept lobby seats renamed, in room_seats and in each seat's
// SEAT_JOINED row, before the reference clears to null. A lobby pick
// keeps its row with no account (lobby_picks: the site's own ADP), and a
// group pass keeps its row with no buyer (migration 00033).
func (s *Store) Delete(ctx context.Context, accountID uuid.UUID, now time.Time) (Deleted, error) {
	var out Deleted
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `select workos_user_id from app.accounts where id = $1 for update`, accountID).Scan(&out.WorkOSUserID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoAccount
		}
		if err != nil {
			return err
		}
		if err := refuseRenewing(ctx, tx, accountID); err != nil {
			return err
		}
		if out.ObjectKeys, err = objectKeys(ctx, tx, accountID); err != nil {
			return err
		}
		for _, step := range deleteSteps {
			if _, err := tx.Exec(ctx, step, accountID); err != nil {
				return err
			}
		}
		for _, step := range renameSteps {
			if _, err := tx.Exec(ctx, step, accountID, DepartedHandle); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `insert into app.workos_user_deletions (workos_user_id, former_account_id, created_at)
			values ($1, $2, $3) on conflict (workos_user_id) do nothing`, out.WorkOSUserID, accountID, now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `delete from app.accounts where id = $1`, accountID)
		return err
	})
	if errors.Is(err, ErrNoAccount) || errors.Is(err, ErrRenewing) {
		return Deleted{}, err
	}
	if err != nil {
		return Deleted{}, fmt.Errorf("deletion: delete %s: %w", accountID, err)
	}
	return out, nil
}

// deleteSteps run first inside the transaction, in order, each with the
// account id as $1.
var deleteSteps = []string{
	// The platform connections first: the sessions, tokens and sign-ins
	// kept to read and write as the member.
	`delete from app.host_connections where account_id = $1`,
	// A league read kept as the member alone (a private league read with
	// their own sign-in) names them with no reference.
	`delete from app.league_snapshots where read_as = $1`,
}

// renameSteps run next, in order, each with the account id as $1 and
// the departed member's word as $2.
var renameSteps = []string{
	// A kept lobby seat's join row names the member's handle in its
	// payload: the room's log is replayed to every socket that catches up.
	`update app.room_actions a set payload = jsonb_set(a.payload, '{handle}', to_jsonb($2::text))
		from app.room_seats st
		where st.account_id = $1 and a.room_id = st.room_id and a.seat = st.seat
		  and a.kind = 'SEAT_JOINED' and a.payload ? 'handle'`,
	// The seat itself: the draft keeps it, under the departed word.
	`update app.room_seats set handle = $2 where account_id = $1`,
}

// queryRow is a pool or a transaction, as a read needs it.
type queryRow interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// renewing reports whether a membership of the account still renews at
// Stripe.
func renewing(ctx context.Context, q queryRow, accountID uuid.UUID) (bool, error) {
	var out bool
	err := q.QueryRow(ctx, `select exists (select 1 from app.entitlements
		where account_id = $1 and source = 'subscription' and not cancel_at_period_end
		  and status in ('active', 'trialing', 'past_due'))`, accountID).Scan(&out)
	return out, err
}

// refuseRenewing is ErrRenewing when a membership of the account still
// renews: the transaction's own check, the authority.
func refuseRenewing(ctx context.Context, tx pgx.Tx, accountID uuid.UUID) error {
	r, err := renewing(ctx, tx, accountID)
	if err != nil {
		return err
	}
	if r {
		return ErrRenewing
	}
	return nil
}

// Renewing is the same check read before the delete starts, so a refusal
// costs the member nothing: a live draft seat is given up only once the
// delete is going ahead. The transaction checks again.
func (s *Store) Renewing(ctx context.Context, accountID uuid.UUID) (bool, error) {
	r, err := renewing(ctx, s.Pool, accountID)
	if err != nil {
		return false, fmt.Errorf("deletion: renewing %s: %w", accountID, err)
	}
	return r, nil
}

func objectKeys(ctx context.Context, tx pgx.Tx, accountID uuid.UUID) ([]string, error) {
	rows, err := tx.Query(ctx, `select object_key from app.exports where account_id = $1 order by created_at`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Pending is a provider user still to delete.
type Pending struct {
	WorkOSUserID    string
	FormerAccountID uuid.UUID
	Attempts        int
}

// Pending is up to limit provider users still to delete: the ones never
// tried first, then the longest untried, so a failing row moves behind
// the fresh ones. A dead row is never read again.
func (s *Store) Pending(ctx context.Context, limit int) ([]Pending, error) {
	rows, err := s.Pool.Query(ctx, `select workos_user_id, former_account_id, attempts
		from app.workos_user_deletions where dead_at is null
		order by last_tried_at nulls first, created_at, workos_user_id limit $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("deletion: pending: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Pending, error) {
		var p Pending
		err := r.Scan(&p.WorkOSUserID, &p.FormerAccountID, &p.Attempts)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("deletion: pending: %w", err)
	}
	return out, nil
}

// Done drops a provider user the provider has deleted.
func (s *Store) Done(ctx context.Context, workosUserID string) error {
	if _, err := s.Pool.Exec(ctx, `delete from app.workos_user_deletions where workos_user_id = $1`, workosUserID); err != nil {
		return fmt.Errorf("deletion: done: %w", err)
	}
	return nil
}

// Failed counts a failed try and keeps its error, for the next sweep.
// The MaxAttempts-th failure marks the row dead, and dead says so.
func (s *Store) Failed(ctx context.Context, workosUserID string, cause error, now time.Time) (dead bool, err error) {
	msg := cause.Error()
	if len(msg) > maxErrorChars {
		msg = msg[:maxErrorChars]
	}
	err = s.Pool.QueryRow(ctx, `update app.workos_user_deletions
		set attempts = attempts + 1, last_error = $2, last_tried_at = $3,
		    dead_at = case when attempts + 1 >= $4::integer then $3::timestamptz end
		where workos_user_id = $1 returning dead_at is not null`,
		workosUserID, msg, now, MaxAttempts).Scan(&dead)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("deletion: failed: %w", err)
	}
	return dead, nil
}

// Queued reports whether the provider user is in the queue, pending or
// dead: its account was deleted here and the provider has not confirmed.
// auth refuses a sign-in as that user meanwhile, so no fresh account is
// made on a user the sweep is about to delete.
func (s *Store) Queued(ctx context.Context, workosUserID string) (bool, error) {
	var out bool
	if err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.workos_user_deletions where workos_user_id = $1)`,
		workosUserID).Scan(&out); err != nil {
		return false, fmt.Errorf("deletion: queued: %w", err)
	}
	return out, nil
}
