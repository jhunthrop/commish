package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jhunthrop/commish/api/internal/season"
)

// Claim errors, each a different answer to the drafter.
var (
	ErrNoGroupPass      = errors.New("entitlements: no such group pass")
	ErrGroupPassFull    = errors.New("entitlements: every seat is claimed")
	ErrAlreadyClaimed   = errors.New("entitlements: already claimed")
	ErrGroupPassClosed  = errors.New("entitlements: group pass refunded or disputed")
	ErrGroupPassExpired = errors.New("entitlements: group pass season has ended")
	// ErrCoveredByMembership and ErrCoveredByPass are a claimer who
	// already has what a seat grants: the seat stays open for the league.
	ErrCoveredByMembership = errors.New("entitlements: the membership covers the claimer")
	ErrCoveredByPass       = errors.New("entitlements: the claimer has the season's pass")
)

// AccountLockKey is the per-account lock a claim and a checkout take, so
// a claim never races the account's other claims or its checkout.
func AccountLockKey(accountID uuid.UUID) string { return "checkout:" + accountID.String() }

func isClaimRefusal(err error) bool {
	return errors.Is(err, ErrNoGroupPass) || errors.Is(err, ErrGroupPassFull) || errors.Is(err, ErrAlreadyClaimed) ||
		errors.Is(err, ErrGroupPassClosed) || errors.Is(err, ErrGroupPassExpired) ||
		errors.Is(err, ErrCoveredByMembership) || errors.Is(err, ErrCoveredByPass)
}

// ClaimGroupPass writes one Draft Pass from a group pass, inside one
// transaction that locks the group pass row, so two claims racing for
// the last seat cannot both win. A pass whose season has ended at now
// cannot be claimed: it would grant nothing. A claimer the Membership or
// the season's own pass already covers is refused inside the same
// transaction. The caller holds AccountLockKey around the call (billing
// takes it with db.WithLock, on a connection outside the pool, as
// checkout does), so two claims on two links, or a claim and a checkout,
// cannot both take a seat, and a waiting claim never holds a pooled
// connection.
func (s *Store) ClaimGroupPass(ctx context.Context, groupPassID, accountID uuid.UUID, now time.Time, actor string) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var seats, seasonYear int
		var status string
		err := tx.QueryRow(ctx, `
			select seats, season, status from app.group_passes where id = $1 for update`, groupPassID).
			Scan(&seats, &seasonYear, &status)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return ErrNoGroupPass
		case err != nil:
			return err
		case status != StatusActive:
			return ErrGroupPassClosed
		case !now.Before(season.End(seasonYear)):
			return ErrGroupPassExpired
		}
		if err := coveredElsewhere(ctx, tx, groupPassID, accountID, seasonYear, now); err != nil {
			return err
		}
		var claimed int
		if err := tx.QueryRow(ctx, `
			select count(*) from app.entitlements where group_pass_id = $1`, groupPassID).Scan(&claimed); err != nil {
			return err
		}
		if claimed >= seats {
			return ErrGroupPassFull
		}
		_, err = tx.Exec(ctx, `
			insert into app.entitlements (account_id, product, source, status, season, ends_at, group_pass_id, granted_by)
			values ($1, 'draft_pass', 'group_pass', 'active', $2, $3, $4, $5)`,
			accountID, seasonYear, season.End(seasonYear), groupPassID, actor)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrAlreadyClaimed
		}
		return err
	})
	if err != nil && !isClaimRefusal(err) {
		return fmt.Errorf("entitlements: claim group pass %s: %w", groupPassID, err)
	}
	return err
}

// coveredElsewhere refuses a claimer who already has what a seat grants
// from somewhere other than this group pass. A seat already theirs is not
// refused: it answers ErrAlreadyClaimed first, the no-op a repeat claim
// gets, even for a claimer who has since become a member.
func coveredElsewhere(ctx context.Context, tx pgx.Tx, groupPassID, accountID uuid.UUID, seasonYear int, now time.Time) error {
	var mine, member, pass bool
	err := tx.QueryRow(ctx, `
		select
		  exists (select 1 from app.entitlements e where e.account_id = $1 and e.group_pass_id = $4),
		  exists (select 1 from app.entitlements e where e.account_id = $1 and e.product = 'membership' and `+liveClause+`),
		  exists (select 1 from app.entitlements e where e.account_id = $1 and e.product = 'draft_pass' and e.season = $3
		    and e.group_pass_id is distinct from $4 and `+liveClause+`)`,
		accountID, now, seasonYear, groupPassID).Scan(&mine, &member, &pass)
	switch {
	case err != nil:
		return err
	case mine:
		return ErrAlreadyClaimed
	case member:
		return ErrCoveredByMembership
	case pass:
		return ErrCoveredByPass
	}
	return nil
}
