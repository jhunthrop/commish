package devices

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/auth"
)

// Errors a caller tells apart.
var (
	// ErrBadCode is a code that is unknown, used or past its ten minutes.
	ErrBadCode = errors.New("devices: no such code")
	// ErrNotFound is a device that is not the account's or is revoked.
	ErrNotFound = errors.New("devices: not found")
	// ErrTooMany is a pairing past MaxDevices live devices.
	ErrTooMany = errors.New("devices: too many devices")
)

// Bounds.
const (
	CodeTTL    = 10 * time.Minute
	MaxDevices = 10
	// usedEvery is how often a device's last use is written: once an hour
	// is enough for the account page, and a push every ten seconds would
	// otherwise be a write every ten seconds.
	usedEvery = time.Hour
)

// Device is one paired device as the account page lists it.
type Device struct {
	ID         uuid.UUID
	Name       string
	Kind       auth.DeviceKind
	Scopes     []auth.Scope
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

// Store reads and writes devices and pairing codes. Every query is
// scoped by account or by a token hash.
type Store struct{ Pool *pgxpool.Pool }

// PutCode stores the account's pairing code for one kind of device,
// replacing any earlier code.
func (s *Store) PutCode(ctx context.Context, accountID uuid.UUID, kind auth.DeviceKind, hash []byte, expires time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into app.device_pair_codes (account_id, code_hash, expires_at, kind) values ($1, $2, $3, $4)
		on conflict (account_id) do update
		  set code_hash = excluded.code_hash, expires_at = excluded.expires_at, kind = excluded.kind, created_at = now()`,
		accountID, hash, expires, string(kind))
	if err != nil {
		return fmt.Errorf("devices: put code: %w", err)
	}
	return nil
}

// Pair spends a live code minted for kind and makes a device of that kind
// for its account under the token's hash, in one transaction: a code
// pairs exactly one device, and only of its own kind.
func (s *Store) Pair(ctx context.Context, code []byte, kind auth.DeviceKind, name string, tokenHash []byte, scopes []auth.Scope, now time.Time) (uuid.UUID, Device, error) {
	var accountID uuid.UUID
	var dev Device
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `delete from app.device_pair_codes where code_hash = $1 and expires_at > $2 and kind = $3 returning account_id`,
			code, now, string(kind)).Scan(&accountID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrBadCode
		}
		if err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.devices where account_id = $1 and revoked_at is null`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxDevices {
			return ErrTooMany
		}
		dev = Device{Name: name, Kind: kind, Scopes: scopes}
		return tx.QueryRow(ctx, `insert into app.devices (account_id, name, token_hash, scopes, kind) values ($1, $2, $3, $4, $5)
			returning id, created_at`, accountID, name, tokenHash, scopeStrings(scopes), string(kind)).Scan(&dev.ID, &dev.CreatedAt)
	})
	if errors.Is(err, ErrBadCode) || errors.Is(err, ErrTooMany) {
		return uuid.Nil, Device{}, err
	}
	if err != nil {
		return uuid.Nil, Device{}, fmt.Errorf("devices: pair: %w", err)
	}
	return accountID, dev, nil
}

func scopeStrings(scopes []auth.Scope) []string {
	out := make([]string, len(scopes))
	for i, s := range scopes {
		out[i] = string(s)
	}
	return out
}

func toScopes(raw []string) []auth.Scope {
	out := make([]auth.Scope, len(raw))
	for i, s := range raw {
		out[i] = auth.Scope(s)
	}
	return out
}

const deviceColumns = `id, name, kind, scopes, created_at, last_used_at`

func scanDevice(row pgx.Row) (Device, error) {
	var d Device
	var kind string
	var scopes []string
	err := row.Scan(&d.ID, &d.Name, &kind, &scopes, &d.CreatedAt, &d.LastUsedAt)
	d.Kind, d.Scopes = auth.DeviceKind(kind), toScopes(scopes)
	return d, err
}

// List is the account's live devices, newest first.
func (s *Store) List(ctx context.Context, accountID uuid.UUID) ([]Device, error) {
	rows, err := s.Pool.Query(ctx, `select `+deviceColumns+` from app.devices
		where account_id = $1 and revoked_at is null order by created_at desc, id limit $2`, accountID, MaxDevices)
	if err != nil {
		return nil, fmt.Errorf("devices: list: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Device, error) { return scanDevice(r) })
	if err != nil {
		return nil, fmt.Errorf("devices: list: %w", err)
	}
	return out, nil
}

// Revoke ends one of the account's devices; its token opens nothing from
// the next request on.
func (s *Store) Revoke(ctx context.Context, accountID, id uuid.UUID, now time.Time) error {
	tag, err := s.Pool.Exec(ctx, `update app.devices set revoked_at = $3 where id = $1 and account_id = $2 and revoked_at is null`,
		id, accountID, now)
	if err != nil {
		return fmt.Errorf("devices: revoke %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Get is one of the account's live devices.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (Device, error) {
	d, err := scanDevice(s.Pool.QueryRow(ctx, `select `+deviceColumns+` from app.devices
		where id = $1 and account_id = $2 and revoked_at is null`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Device{}, ErrNotFound
	}
	if err != nil {
		return Device{}, fmt.Errorf("devices: get %s: %w", id, err)
	}
	return d, nil
}

// DeviceAccount resolves a live device's token hash to the device and its
// account, for auth.Bearer, and notes its use at most once an hour.
func (s *Store) DeviceAccount(ctx context.Context, tokenHash []byte, now time.Time) (auth.Account, auth.Device, error) {
	var a auth.Account
	var d auth.Device
	var scopes []string
	var lastUsed *time.Time
	err := s.Pool.QueryRow(ctx, `select a.id, a.workos_user_id, a.email, a.first_name, a.last_name, a.handle, a.created_at,
			d.id, d.scopes, d.last_used_at
		from app.devices d join app.accounts a on a.id = d.account_id
		where d.token_hash = $1 and d.revoked_at is null`, tokenHash).
		Scan(&a.ID, &a.WorkOSUserID, &a.Email, &a.FirstName, &a.LastName, &a.Handle, &a.CreatedAt, &d.ID, &scopes, &lastUsed)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Account{}, auth.Device{}, auth.ErrNoDevice
	}
	if err != nil {
		return auth.Account{}, auth.Device{}, fmt.Errorf("devices: resolve: %w", err)
	}
	d.AccountID, d.Scopes = a.ID, toScopes(scopes)
	if lastUsed == nil || now.Sub(*lastUsed) >= usedEvery {
		if _, err := s.Pool.Exec(ctx, `update app.devices set last_used_at = $2 where id = $1`, d.ID, now); err != nil {
			return auth.Account{}, auth.Device{}, fmt.Errorf("devices: note use: %w", err)
		}
	}
	return a, d, nil
}

// SweepCodes deletes every code past its ten minutes.
func (s *Store) SweepCodes(ctx context.Context, now time.Time) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `delete from app.device_pair_codes where expires_at <= $1`, now)
	if err != nil {
		return 0, fmt.Errorf("devices: sweep codes: %w", err)
	}
	return tag.RowsAffected(), nil
}
