package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Target is one registered device a notification goes to.
type Target struct {
	DeviceID uuid.UUID
	Platform Platform
	Token    string
}

// MaxPushAccounts bounds the accounts one producer run reads.
const MaxPushAccounts = 20000

// activeDevice is the rule a device must meet to receive pushes, the same
// as auth's for an app's token: live, and used (or paired) since the
// session's life ago (devices.lapsed, security review M1). A phone signed
// in once and then given away stops receiving the account's pushes when
// its token stops opening the account. $since is the bound.
const activeDevice = `d.revoked_at is null and d.push_token is not null and coalesce(d.last_used_at, d.created_at) > `

// Targets is the account's active devices with a push token: the one
// device when deviceID is set, else every one.
func (s *Store) Targets(ctx context.Context, accountID uuid.UUID, deviceID *uuid.UUID, activeSince time.Time) ([]Target, error) {
	rows, err := s.Pool.Query(ctx, `select d.id, d.push_platform, d.push_token from app.devices d
		where d.account_id = $1 and ($2::uuid is null or d.id = $2) and `+activeDevice+`$3
		order by d.created_at, d.id`, accountID, deviceID, activeSince)
	if err != nil {
		return nil, fmt.Errorf("notify: targets %s: %w", accountID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Target, error) {
		var t Target
		var platform string
		err := r.Scan(&t.DeviceID, &platform, &t.Token)
		t.Platform = Platform(platform)
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("notify: targets %s: %w", accountID, err)
	}
	return out, nil
}

// DropToken removes a token the platform called dead, only while the
// device still holds that same token (a fresh one registered meanwhile
// stays).
func (s *Store) DropToken(ctx context.Context, deviceID uuid.UUID, token string) error {
	_, err := s.Pool.Exec(ctx, `update app.devices set push_platform = null, push_token = null, push_registered_at = null
		where id = $1 and push_token = $2`, deviceID, token)
	if err != nil {
		return fmt.Errorf("notify: drop token %s: %w", deviceID, err)
	}
	return nil
}

// PushAccounts is every account with an active device registered for
// push and the kind switched on: the accounts a producer may write for,
// at most MaxPushAccounts (full says the bound was reached).
func (s *Store) PushAccounts(ctx context.Context, kind Kind, activeSince time.Time) (ids []uuid.UUID, full bool, err error) {
	rows, err := s.Pool.Query(ctx, `select distinct d.account_id from app.devices d
		left join app.notification_preferences p on p.account_id = d.account_id
		where not (coalesce(p.kinds_off, '{}') @> array[$1]::text[]) and `+activeDevice+`$3
		order by 1 limit $2`, string(kind), MaxPushAccounts, activeSince)
	if err != nil {
		return nil, false, fmt.Errorf("notify: push accounts: %w", err)
	}
	ids, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, false, fmt.Errorf("notify: push accounts: %w", err)
	}
	return ids, len(ids) >= MaxPushAccounts, nil
}

// ProviderToken is the APNs provider token kept for the key, found false
// when none is.
func (s *Store) ProviderToken(ctx context.Context, keyID string) (string, time.Time, bool, error) {
	var token string
	var at time.Time
	err := s.Pool.QueryRow(ctx, `select token, issued_at from app.apns_provider_tokens where key_id = $1`, keyID).Scan(&token, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, fmt.Errorf("notify: apns provider token: %w", err)
	}
	return token, at, true, nil
}

// PutProviderToken keeps the key's newest provider token.
func (s *Store) PutProviderToken(ctx context.Context, keyID, token string, issuedAt time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into app.apns_provider_tokens (key_id, token, issued_at) values ($1, $2, $3)
		on conflict (key_id) do update set token = excluded.token, issued_at = excluded.issued_at
		where app.apns_provider_tokens.issued_at < excluded.issued_at`, keyID, token, issuedAt)
	if err != nil {
		return fmt.Errorf("notify: keep apns provider token: %w", err)
	}
	return nil
}
