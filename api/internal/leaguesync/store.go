package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrLinkNotFound is a link that does not exist or is someone else's.
var ErrLinkNotFound = errors.New("leaguesync: link not found")

// ErrTooMany is an attach past MaxLinksPerAccount.
var ErrTooMany = errors.New("leaguesync: too many leagues")

// MaxLinksPerAccount bounds the leagues one account attaches.
const MaxLinksPerAccount = 20

// Link is one account's attachment to a host league.
type Link struct {
	ID         uuid.UUID
	AccountID  uuid.UUID
	LeagueID   *uuid.UUID
	Ref        Ref
	RosterID   int
	AttachedAt time.Time
	LastReadAt *time.Time
}

// Store reads and writes the sync tables. Every link query is scoped by
// account, so one drafter never reads or changes another's attachment.
type Store struct{ Pool *pgxpool.Pool }

const linkColumns = `id, account_id, league_id, host, host_league_id, host_season, roster_id, attached_at, last_read_at`

func scanLink(row pgx.Row) (Link, error) {
	var l Link
	err := row.Scan(&l.ID, &l.AccountID, &l.LeagueID, &l.Ref.Host, &l.Ref.LeagueID, &l.Ref.Season, &l.RosterID, &l.AttachedAt, &l.LastReadAt)
	return l, err
}

// Find is the account's link to a host league, if any.
func (s *Store) Find(ctx context.Context, accountID uuid.UUID, ref Ref) (Link, bool, error) {
	l, err := scanLink(s.Pool.QueryRow(ctx, `select `+linkColumns+` from app.league_links
		where account_id = $1 and host = $2 and host_league_id = $3 and host_season = $4`,
		accountID, ref.Host, ref.LeagueID, ref.Season))
	if errors.Is(err, pgx.ErrNoRows) {
		return Link{}, false, nil
	}
	if err != nil {
		return Link{}, false, fmt.Errorf("leaguesync: find link: %w", err)
	}
	return l, true, nil
}

// Save inserts or updates the account's link to the host league,
// refusing a new one past MaxLinksPerAccount.
func (s *Store) Save(ctx context.Context, l Link) (Link, error) {
	var out Link
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('league_links:' || $1::text))`, l.AccountID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.league_links where account_id = $1 and detached_at is null
			and not (host = $2 and host_league_id = $3 and host_season = $4)`,
			l.AccountID, l.Ref.Host, l.Ref.LeagueID, l.Ref.Season).Scan(&n); err != nil {
			return err
		}
		if n >= MaxLinksPerAccount {
			return ErrTooMany
		}
		saved, err := scanLink(tx.QueryRow(ctx, `insert into app.league_links
			(account_id, league_id, host, host_league_id, host_season, roster_id, last_read_at)
			values ($1, $2, $3, $4, $5, $6, $7)
			on conflict (account_id, host, host_league_id, host_season)
			do update set league_id = excluded.league_id, roster_id = excluded.roster_id, last_read_at = excluded.last_read_at,
				detached_at = null
			returning `+linkColumns,
			l.AccountID, l.LeagueID, l.Ref.Host, l.Ref.LeagueID, l.Ref.Season, l.RosterID, l.LastReadAt))
		out = saved
		return err
	})
	if errors.Is(err, ErrTooMany) {
		return Link{}, err
	}
	if err != nil {
		return Link{}, fmt.Errorf("leaguesync: save link: %w", err)
	}
	return out, nil
}

// Get is one of the account's links.
func (s *Store) Get(ctx context.Context, accountID, id uuid.UUID) (Link, error) {
	l, err := scanLink(s.Pool.QueryRow(ctx, `select `+linkColumns+` from app.league_links
		where id = $1 and account_id = $2 and detached_at is null`, id, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Link{}, ErrLinkNotFound
	}
	if err != nil {
		return Link{}, fmt.Errorf("leaguesync: get link %s: %w", id, err)
	}
	return l, nil
}

// Attached is one link as the account page and the rail list it: the
// league's name and the drafter's team at the last read.
type Attached struct {
	Link
	Season   int
	Name     string
	TeamName string
}

// Attached is the account's links, newest first, each with its league's
// name and team from the last read.
func (s *Store) Attached(ctx context.Context, accountID uuid.UUID) ([]Attached, error) {
	rows, err := s.Pool.Query(ctx, `select l.id, l.account_id, l.league_id, l.host, l.host_league_id, l.host_season,
		l.roster_id, l.attached_at, l.last_read_at,
		coalesce((sn.snapshot->>'season')::int, l.host_season), coalesce(sn.snapshot->>'name', ''),
		coalesce((select t->>'name' from jsonb_array_elements(sn.snapshot->'teams') t
			where (t->>'roster_id')::int = l.roster_id limit 1), '')
		from app.league_links l
		left join app.league_snapshots sn
			on sn.host = l.host and sn.host_league_id = l.host_league_id and sn.host_season = l.host_season
		where l.account_id = $1 and l.detached_at is null order by l.attached_at desc, l.id limit $2`, accountID, MaxLinksPerAccount)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: attached: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Attached, error) {
		var a Attached
		err := r.Scan(&a.ID, &a.AccountID, &a.LeagueID, &a.Ref.Host, &a.Ref.LeagueID, &a.Ref.Season, &a.RosterID,
			&a.AttachedAt, &a.LastReadAt, &a.Season, &a.Name, &a.TeamName)
		return a, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: attached: %w", err)
	}
	return out, nil
}

// Newest is the account's newest attached league, nil when it has none.
func (s *Store) Newest(ctx context.Context, accountID uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx, `select id from app.league_links where account_id = $1 and detached_at is null
		order by attached_at desc, id limit 1`, accountID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("leaguesync: newest for %s: %w", accountID, err)
	}
	return &id, nil
}

// Detach marks the account's link detached. The row and the saved league
// it made stay, so the detach can be undone (Restore) and mocks saved
// from the league keep their settings.
func (s *Store) Detach(ctx context.Context, accountID, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `update app.league_links set detached_at = now()
		where id = $1 and account_id = $2 and detached_at is null`, id, accountID)
	if err != nil {
		return fmt.Errorf("leaguesync: detach %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrLinkNotFound
	}
	return nil
}

// Restore undoes a detach of the account's link, within the attach cap.
func (s *Store) Restore(ctx context.Context, accountID, id uuid.UUID) (Link, error) {
	var out Link
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('league_links:' || $1::text))`, accountID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from app.league_links where account_id = $1 and detached_at is null`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxLinksPerAccount {
			return ErrTooMany
		}
		l, err := scanLink(tx.QueryRow(ctx, `update app.league_links set detached_at = null
			where id = $1 and account_id = $2 and detached_at is not null returning `+linkColumns, id, accountID))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkNotFound
		}
		out = l
		return err
	})
	if errors.Is(err, ErrLinkNotFound) || errors.Is(err, ErrTooMany) {
		return Link{}, err
	}
	if err != nil {
		return Link{}, fmt.Errorf("leaguesync: restore %s: %w", id, err)
	}
	return out, nil
}

// Touch records when the account's link last answered from a read.
func (s *Store) Touch(ctx context.Context, accountID, id uuid.UUID, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `update app.league_links set last_read_at = $3
		where id = $1 and account_id = $2 and last_read_at is distinct from $3`, id, accountID, at); err != nil {
		return fmt.Errorf("leaguesync: touch link %s: %w", id, err)
	}
	return nil
}

// LastSnapshot is the last good read of a host league.
func (s *Store) LastSnapshot(ctx context.Context, ref Ref) (Snapshot, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select snapshot from app.league_snapshots
		where host = $1 and host_league_id = $2 and host_season = $3`, ref.Host, ref.LeagueID, ref.Season).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, false, nil
	}
	if err != nil {
		return Snapshot{}, false, fmt.Errorf("leaguesync: snapshot %s: %w", ref.Key(), err)
	}
	var snap Snapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return Snapshot{}, false, fmt.Errorf("leaguesync: decode snapshot %s: %w", ref.Key(), err)
	}
	return snap, true, nil
}

// Linked reports whether any account has the league attached.
func (s *Store) Linked(ctx context.Context, ref Ref) (bool, error) {
	var linked bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.league_links
		where host = $1 and host_league_id = $2 and host_season = $3 and detached_at is null)`,
		ref.Host, ref.LeagueID, ref.Season).Scan(&linked)
	if err != nil {
		return false, fmt.Errorf("leaguesync: linked %s: %w", ref.Key(), err)
	}
	return linked, nil
}

// PutSnapshot keeps a good read, replacing the one before, and only for a
// league some account has attached: a league read for a preview leaves
// nothing behind.
func (s *Store) PutSnapshot(ctx context.Context, snap Snapshot) error {
	raw, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("leaguesync: encode snapshot: %w", err)
	}
	ref := snap.Ref
	_, err = s.Pool.Exec(ctx, `insert into app.league_snapshots (host, host_league_id, host_season, snapshot, read_at)
		select $1, $2, $3, $4, $5
		where exists (select 1 from app.league_links where host = $1 and host_league_id = $2 and host_season = $3
			and detached_at is null)
		on conflict (host, host_league_id, host_season) do update set snapshot = excluded.snapshot, read_at = excluded.read_at`,
		ref.Host, ref.LeagueID, ref.Season, raw, snap.ReadAt)
	if err != nil {
		return fmt.Errorf("leaguesync: keep snapshot %s: %w", ref.Key(), err)
	}
	return nil
}

// HostPlayers is a host's kept directory and when it was read.
func (s *Store) HostPlayers(ctx context.Context, host string) ([]HostPlayer, time.Time, error) {
	rows, err := s.Pool.Query(ctx, `select player_id, name, position, team, coalesce(espn_id, ''), read_at
		from app.host_players where host = $1`, host)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("leaguesync: host players %s: %w", host, err)
	}
	var at time.Time
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (HostPlayer, error) {
		var p HostPlayer
		err := r.Scan(&p.ID, &p.Name, &p.Position, &p.Team, &p.ESPNID, &at)
		return p, err
	})
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("leaguesync: host players %s: %w", host, err)
	}
	return out, at, nil
}

// PutHostPlayers replaces a host's kept directory.
func (s *Store) PutHostPlayers(ctx context.Context, host string, players []HostPlayer, at time.Time) error {
	ids := make([]string, len(players))
	names := make([]string, len(players))
	positions := make([]string, len(players))
	teams := make([]string, len(players))
	espn := make([]*string, len(players))
	for i, p := range players {
		ids[i], names[i], positions[i], teams[i] = p.ID, p.Name, p.Position, p.Team
		if p.ESPNID != "" {
			id := p.ESPNID
			espn[i] = &id
		}
	}
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `delete from app.host_players where host = $1`, host); err != nil {
			return fmt.Errorf("leaguesync: clear host players %s: %w", host, err)
		}
		_, err := tx.Exec(ctx, `insert into app.host_players (host, player_id, name, position, team, espn_id, read_at)
			select $1, * , $7 from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])`,
			host, ids, names, positions, teams, espn, at)
		if err != nil {
			return fmt.Errorf("leaguesync: keep host players %s: %w", host, err)
		}
		return nil
	})
}
