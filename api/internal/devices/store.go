package devices

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
	// ErrTokenTaken is a push token another member's active device holds,
	// or one a registration racing this one took.
	ErrTokenTaken = errors.New("devices: push token held elsewhere")
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

// Binding is what a pairing code is good for: one kind of device and,
// for an app, the S256 challenge of the verifier the app keeps. The
// extension's code has no challenge.
type Binding struct {
	Kind      auth.DeviceKind
	Challenge string
}

// challengeOrNull is the binding's challenge as the column holds it.
func (b Binding) challengeOrNull() *string { return orNull(b.Challenge) }

// orNull is s as a nullable column holds it.
func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// PutCode stores the account's pairing code under its binding, replacing
// any earlier code. workosSID is the WorkOS session an app's sign-in
// began, carried to the device the code pairs; empty for the extension.
func (s *Store) PutCode(ctx context.Context, accountID uuid.UUID, b Binding, hash []byte, expires time.Time, workosSID string) error {
	_, err := s.Pool.Exec(ctx, `insert into app.device_pair_codes (account_id, code_hash, expires_at, kind, code_challenge, workos_session_id)
		values ($1, $2, $3, $4, $5, $6)
		on conflict (account_id) do update
		  set code_hash = excluded.code_hash, expires_at = excluded.expires_at, kind = excluded.kind,
		      code_challenge = excluded.code_challenge, workos_session_id = excluded.workos_session_id, created_at = now()`,
		accountID, hash, expires, string(b.Kind), b.challengeOrNull(), orNull(workosSID))
	if err != nil {
		return fmt.Errorf("devices: put code: %w", err)
	}
	return nil
}

// Pair spends a live code whose binding matches (its kind, and its
// challenge or the lack of one) and makes a device of that kind for its
// account under the token's hash, in one transaction: a code pairs
// exactly one device, only of its own kind, and an app's only with its
// verifier. An app code's WorkOS session, if it carries one, moves to
// the device; an extension code's never does (a binary before Lane 225
// could leave an app's id on a code it turned into the extension's). A
// code that does not match is left as it was.
func (s *Store) Pair(ctx context.Context, code []byte, b Binding, name string, tokenHash []byte, scopes []auth.Scope, now time.Time) (uuid.UUID, Device, error) {
	kind := b.Kind
	var accountID uuid.UUID
	var workosSID *string
	var dev Device
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `delete from app.device_pair_codes
			where code_hash = $1 and expires_at > $2 and kind = $3 and code_challenge is not distinct from $4
			returning account_id, workos_session_id`,
			code, now, string(kind), b.challengeOrNull()).Scan(&accountID, &workosSID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrBadCode
		}
		if err != nil {
			return err
		}
		if !kind.IsApp() {
			workosSID = nil
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.devices where account_id = $1 and revoked_at is null`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxDevices {
			return ErrTooMany
		}
		dev = Device{Name: name, Kind: kind, Scopes: scopes}
		return tx.QueryRow(ctx, `insert into app.devices (account_id, name, token_hash, scopes, kind, created_at, workos_session_id)
			values ($1, $2, $3, $4, $5, $6, $7) returning id, created_at`,
			accountID, name, tokenHash, scopeStrings(scopes), string(kind), now, workosSID).Scan(&dev.ID, &dev.CreatedAt)
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
// the next request on, and its push token goes with it. It answers the WorkOS session the device's
// sign-in began, empty when it has none (the extension, or an app paired
// before Lane 225), and clears it from the row in the same statement: a
// revoked device keeps no WorkOS session id.
func (s *Store) Revoke(ctx context.Context, accountID, id uuid.UUID, now time.Time) (string, error) {
	var workosSID *string
	err := s.Pool.QueryRow(ctx, `with live as (
			select id, workos_session_id from app.devices
			where id = $1 and account_id = $2 and revoked_at is null for update)
		update app.devices d set revoked_at = $3, workos_session_id = null,
			push_platform = null, push_token = null, push_registered_at = null
		from live where d.id = live.id
		returning live.workos_session_id`,
		id, accountID, now).Scan(&workosSID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("devices: revoke %s: %w", id, err)
	}
	if workosSID == nil {
		return "", nil
	}
	return *workosSID, nil
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
	var created time.Time
	err := s.Pool.QueryRow(ctx, `select a.id, a.workos_user_id, a.email, a.first_name, a.last_name, a.handle, a.created_at,
			d.id, d.scopes, d.last_used_at, d.created_at
		from app.devices d join app.accounts a on a.id = d.account_id
		where d.token_hash = $1 and d.revoked_at is null`, tokenHash).
		Scan(&a.ID, &a.WorkOSUserID, &a.Email, &a.FirstName, &a.LastName, &a.Handle, &a.CreatedAt, &d.ID, &scopes, &lastUsed, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Account{}, auth.Device{}, auth.ErrNoDevice
	}
	if err != nil {
		return auth.Account{}, auth.Device{}, fmt.Errorf("devices: resolve: %w", err)
	}
	d.AccountID, d.Scopes = a.ID, toScopes(scopes)
	if lapsed(d, created, lastUsed, now) {
		return auth.Account{}, auth.Device{}, auth.ErrNoDevice
	}
	if lastUsed == nil || now.Sub(*lastUsed) >= usedEvery {
		if _, err := s.Pool.Exec(ctx, `update app.devices set last_used_at = $2 where id = $1`, d.ID, now); err != nil {
			return auth.Account{}, auth.Device{}, fmt.Errorf("devices: note use: %w", err)
		}
	}
	return a, d, nil
}

// lapsed reports whether a device carrying the session scope (an app's)
// has gone unused past the browser session's life, auth.SessionTTL, from
// its last use (noted to the hour) or its pairing: it then opens nothing,
// as an idle browser session would. The extension's token reaches only
// the device routes and does not lapse.
func lapsed(d auth.Device, created time.Time, lastUsed *time.Time, now time.Time) bool {
	if !d.Has(auth.ScopeSession) {
		return false
	}
	since := created
	if lastUsed != nil {
		since = *lastUsed
	}
	return now.Sub(since) > auth.SessionTTL
}

// SweepCodes deletes every code past its ten minutes.
func (s *Store) SweepCodes(ctx context.Context, now time.Time) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `delete from app.device_pair_codes where expires_at <= $1`, now)
	if err != nil {
		return 0, fmt.Errorf("devices: sweep codes: %w", err)
	}
	return tag.RowsAffected(), nil
}

// PutPush registers a push token on one of the account's live app
// devices, replacing its earlier one, and answers when. A token belongs
// to one device. Another device of the same account holding it lets it go
// in the same transaction (the app reinstalled and paired again). A
// device of another account still active (live, used within the
// session's life) keeps it, and the registration is ErrTokenTaken (Lane
// 262 security review L4: no taking a member's token without the phone);
// one past its life lets it go, so a phone that changed hands is not
// locked out. A registration that races another for the token is
// ErrTokenTaken too (review L5), never a 500.
func (s *Store) PutPush(ctx context.Context, accountID, id uuid.UUID, platform, token string, now time.Time) (time.Time, error) {
	var at time.Time
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var held bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from app.devices
			where push_platform = $1 and push_token = $2 and id <> $3 and account_id <> $4
				and revoked_at is null and coalesce(last_used_at, created_at) > $5)`,
			platform, token, id, accountID, now.Add(-auth.SessionTTL)).Scan(&held); err != nil {
			return err
		}
		if held {
			return ErrTokenTaken
		}
		if _, err := tx.Exec(ctx, `update app.devices set push_platform = null, push_token = null, push_registered_at = null
			where push_platform = $1 and push_token = $2 and id <> $3`, platform, token, id); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `update app.devices set push_platform = $3, push_token = $4, push_registered_at = $5
			where id = $1 and account_id = $2 and revoked_at is null and kind <> 'extension'
			returning push_registered_at`, id, accountID, platform, token, now).Scan(&at)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrTokenTaken):
		return time.Time{}, err
	case errors.As(err, &pgErr) && pgErr.Code == uniqueViolation:
		return time.Time{}, ErrTokenTaken
	case err != nil:
		return time.Time{}, fmt.Errorf("devices: put push %s: %w", id, err)
	}
	return at, nil
}

// uniqueViolation is Postgres's unique_violation.
const uniqueViolation = "23505"

// DeletePush removes the push token of one of the account's live
// devices, if it holds one.
func (s *Store) DeletePush(ctx context.Context, accountID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `update app.devices set push_platform = null, push_token = null, push_registered_at = null
		where id = $1 and account_id = $2 and revoked_at is null`, id, accountID)
	if err != nil {
		return fmt.Errorf("devices: delete push %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
