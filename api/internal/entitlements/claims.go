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
)

func isClaimRefusal(err error) bool {
	return errors.Is(err, ErrNoGroupPass) || errors.Is(err, ErrGroupPassFull) || errors.Is(err, ErrAlreadyClaimed) ||
		errors.Is(err, ErrGroupPassClosed) || errors.Is(err, ErrGroupPassExpired)
}

// ClaimGroupPass writes one Draft Pass from a group pass, inside one
// transaction that locks the group pass row, so two claims racing for
// the last seat cannot both win. A pass whose season has ended at now
// cannot be claimed: it would grant nothing.
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
