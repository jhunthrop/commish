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

	"github.com/jhunthrop/commish/api/internal/season"
)

// ErrLinkNotFound is a link that does not exist or is someone else's.
var ErrLinkNotFound = errors.New("leaguesync: link not found")

// ErrTooMany is an attach past MaxLinksPerAccount.
var ErrTooMany = errors.New("leaguesync: too many leagues")

// ErrManyLeagues is a second live league for an account without the
// many_leagues feature (the Draft Pass, and the Membership with it).
var ErrManyLeagues = errors.New("leaguesync: a second league needs many_leagues")

// MaxLinksPerAccount bounds the leagues one account attaches.
const MaxLinksPerAccount = 20

// MostFree is the live leagues an account follows without many_leagues.
const MostFree = 1

// overCap says why one more live league is refused when the account
// already follows n others, nil when it is not.
func overCap(n int, many bool) error {
	switch {
	case !many && n >= MostFree:
		return ErrManyLeagues
	case n >= MaxLinksPerAccount:
		return ErrTooMany
	}
	return nil
}

// Link is one account's attachment to a host league.
type Link struct {
	ID         uuid.UUID
	AccountID  uuid.UUID
	LeagueID   *uuid.UUID
	Ref        Ref
	RosterID   int
	AttachedAt time.Time
	LastReadAt *time.Time
	// TeamKey is the member's own league-team id on a host whose pages are
	// keyed by it (FFPC's ltuid), empty elsewhere.
	TeamKey string
}

// Store reads and writes the sync tables. Every link query is scoped by
// account, so one drafter never reads or changes another's attachment.
//
// Now is the clock a league's phase is read at, time.Now when nil;
// Season is the site's season it reads with, none when nil.
type Store struct {
	Pool   *pgxpool.Pool
	Now    func() time.Time
	Season SiteSeason
}

// site is the site's season, zero when the store has no source.
func (s *Store) site(ctx context.Context) season.SitePhase {
	if s.Season == nil {
		return season.SitePhase{}
	}
	return s.Season.Phase(ctx)
}

func (s *Store) now() time.Time {
	if s.Now == nil {
		return time.Now()
	}
	return s.Now()
}

const linkColumns = `id, account_id, league_id, host, host_league_id, host_season, roster_id, attached_at, last_read_at,
	coalesce(host_team_key, ''), read_as_member`

func scanLink(row pgx.Row) (Link, error) {
	var l Link
	var member bool
	err := row.Scan(&l.ID, &l.AccountID, &l.LeagueID, &l.Ref.Host, &l.Ref.LeagueID, &l.Ref.Season, &l.RosterID, &l.AttachedAt, &l.LastReadAt, &l.TeamKey, &member)
	if member {
		// A league attached as a member is read for this account alone.
		l.Ref.As = l.AccountID
	}
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
// refusing a new one past MostFree without many, and past
// MaxLinksPerAccount with it.
func (s *Store) Save(ctx context.Context, l Link, many bool) (Link, error) {
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
		if err := overCap(n, many); err != nil {
			return err
		}
		saved, err := scanLink(tx.QueryRow(ctx, `insert into app.league_links
			(account_id, league_id, host, host_league_id, host_season, roster_id, last_read_at, host_team_key, read_as_member)
			values ($1, $2, $3, $4, $5, $6, $7, nullif($8, ''), $9)
			on conflict (account_id, host, host_league_id, host_season)
			do update set league_id = excluded.league_id, roster_id = excluded.roster_id, last_read_at = excluded.last_read_at,
				host_team_key = excluded.host_team_key, read_as_member = excluded.read_as_member,
				detached_at = null
			returning `+linkColumns,
			l.AccountID, l.LeagueID, l.Ref.Host, l.Ref.LeagueID, l.Ref.Season, l.RosterID, l.LastReadAt, l.TeamKey, l.Ref.As != uuid.Nil))
		out = saved
		return err
	})
	if errors.Is(err, ErrTooMany) || errors.Is(err, ErrManyLeagues) {
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

// Detach marks the account's link detached. The row and the saved league
// it made stay, so the detach can be undone (Restore) and mocks saved
// from the league keep their settings. The link's host offers are retired
// in the same transaction (Lane 285, B278): a restore answers none until
// its next good read.
func (s *Store) Detach(ctx context.Context, accountID, id uuid.UUID) error {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `update app.league_links set detached_at = now()
			where id = $1 and account_id = $2 and detached_at is null`, id, accountID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrLinkNotFound
		}
		return retireOffers(ctx, tx, []uuid.UUID{id})
	})
	if errors.Is(err, ErrLinkNotFound) {
		return err
	}
	if err != nil {
		return fmt.Errorf("leaguesync: detach %s: %w", id, err)
	}
	return nil
}

// Restore undoes a detach of the account's link, within the same caps
// as Save.
func (s *Store) Restore(ctx context.Context, accountID, id uuid.UUID, many bool) (Link, error) {
	var out Link
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('league_links:' || $1::text))`, accountID); err != nil {
			return err
		}
		// The undo first, so another account's link is not found before
		// any cap is counted; a cap refusal rolls it back.
		l, err := scanLink(tx.QueryRow(ctx, `update app.league_links set detached_at = null
			where id = $1 and account_id = $2 and detached_at is not null returning `+linkColumns, id, accountID))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkNotFound
		}
		if err != nil {
			return err
		}
		var others int
		if err := tx.QueryRow(ctx, `select count(*) from app.league_links where account_id = $1 and detached_at is null and id <> $2`,
			accountID, id).Scan(&others); err != nil {
			return err
		}
		if err := overCap(others, many); err != nil {
			return err
		}
		out = l
		return nil
	})
	if errors.Is(err, ErrLinkNotFound) || errors.Is(err, ErrTooMany) || errors.Is(err, ErrManyLeagues) {
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
		where host = $1 and host_league_id = $2 and host_season = $3 and read_as = $4`,
		ref.Host, ref.LeagueID, ref.Season, ref.As).Scan(&raw)
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
	snap.Ref.As = ref.As
	return snap, true, nil
}

// linkedAs is the filter that finds the links a read serves: the links
// read as anyone for a shared read, the one account's member link for a
// read made as it.
const linkedAs = `detached_at is null and (case when read_as_member then account_id else '00000000-0000-0000-0000-000000000000'::uuid end) = $4`

// Linked reports whether any account has the league attached, read the
// way ref is read.
func (s *Store) Linked(ctx context.Context, ref Ref) (bool, error) {
	var linked bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.league_links
		where host = $1 and host_league_id = $2 and host_season = $3 and `+linkedAs+`)`,
		ref.Host, ref.LeagueID, ref.Season, ref.As).Scan(&linked)
	if err != nil {
		return false, fmt.Errorf("leaguesync: linked %s: %w", ref.Key(), err)
	}
	return linked, nil
}

// LinksOf is every account's live link to the league, read the way ref
// is read: the links a read that just landed serves (Lane 66u, the trade
// search warmed when a read lands). Bounded by the accounts that attach
// one league, at most a league's teams in practice.
func (s *Store) LinksOf(ctx context.Context, ref Ref) ([]Link, error) {
	rows, err := s.Pool.Query(ctx, `select `+linkColumns+` from app.league_links
		where host = $1 and host_league_id = $2 and host_season = $3 and `+linkedAs+`
		order by attached_at limit $5`, ref.Host, ref.LeagueID, ref.Season, ref.As, maxLinksPerLeague)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: links of %s: %w", ref.Key(), err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Link, error) { return scanLink(r) })
	if err != nil {
		return nil, fmt.Errorf("leaguesync: links of %s: %w", ref.Key(), err)
	}
	return out, nil
}

// maxLinksPerLeague bounds the links one landed read warms: a league's
// teams, with room.
const maxLinksPerLeague = 64

// PutSnapshot keeps a good read, replacing the one before, and only for a
// league some account has attached: a league read for a preview leaves
// nothing behind. stored says whether a row was written.
func (s *Store) PutSnapshot(ctx context.Context, snap Snapshot) (stored bool, err error) {
	raw, err := json.Marshal(snap)
	if err != nil {
		return false, fmt.Errorf("leaguesync: encode snapshot: %w", err)
	}
	ref := snap.Ref
	tag, err := s.Pool.Exec(ctx, `insert into app.league_snapshots (host, host_league_id, host_season, read_as, snapshot, read_at)
		select $1, $2, $3, $4, $5, $6
		where exists (select 1 from app.league_links where host = $1 and host_league_id = $2 and host_season = $3
			and `+linkedAs+`)
		on conflict (host, host_league_id, host_season, read_as) do update set snapshot = excluded.snapshot, read_at = excluded.read_at`,
		ref.Host, ref.LeagueID, ref.Season, ref.As, raw, snap.ReadAt)
	if err != nil {
		return false, fmt.Errorf("leaguesync: keep snapshot %s: %w", ref.Key(), err)
	}
	return tag.RowsAffected() > 0, nil
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

// HostPlayersByID is the host's kept directory rows for the ids, by id;
// an id the directory does not hold is absent.
func (s *Store) HostPlayersByID(ctx context.Context, host string, ids []string) (map[string]HostPlayer, error) {
	out := map[string]HostPlayer{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.Pool.Query(ctx, `select player_id, name, position, team, coalesce(espn_id, '')
		from app.host_players where host = $1 and player_id = any($2::text[])`, host, ids)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: host players by id %s: %w", host, err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (HostPlayer, error) {
		var p HostPlayer
		err := r.Scan(&p.ID, &p.Name, &p.Position, &p.Team, &p.ESPNID)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: host players by id %s: %w", host, err)
	}
	for _, p := range list {
		out[p.ID] = p
	}
	return out, nil
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

// FFPCTeamKey is the league-team id on the FFPC attachment of the account
// the league is read as (ref.As): that account's own, never another's.
// An account with no live member attachment of the league has none.
func (s *Store) FFPCTeamKey(ctx context.Context, ref Ref) (string, error) {
	var ltuid string
	err := s.Pool.QueryRow(ctx, `select host_team_key from app.league_links
		where account_id = $1 and host = 'ffpc' and host_league_id = $2 and host_season = $3
			and read_as_member and detached_at is null and host_team_key is not null`,
		ref.As, ref.LeagueID, ref.Season).Scan(&ltuid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: no FFPC attachment of %s for the account", ErrNotConnected, ref.Shared().Key())
	}
	if err != nil {
		return "", fmt.Errorf("leaguesync: ffpc team key %s: %w", ref.Shared().Key(), err)
	}
	return ltuid, nil
}

// FollowedIDs is the account's live leagues on a host, keyed "id/season"
// (hosts.FollowKey), for a host's league list to mark.
func (s *Store) FollowedIDs(ctx context.Context, accountID uuid.UUID, host string) (map[string]bool, error) {
	rows, err := s.Pool.Query(ctx, `select host_league_id || '/' || host_season from app.league_links
		where account_id = $1 and host = $2 and detached_at is null`, accountID, host)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: followed %s: %w", host, err)
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("leaguesync: followed %s: %w", host, err)
	}
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out, nil
}

// FFPCLeagues is every live FFPC attachment whose member is connected,
// each as the ref read as that member, for the background read: one read
// per attachment, with its own member's sign-in.
func (s *Store) FFPCLeagues(ctx context.Context) ([]Ref, error) {
	rows, err := s.Pool.Query(ctx, `select l.host_league_id, l.host_season, l.account_id from app.league_links l
		join app.host_connections c on c.account_id = l.account_id and c.host = l.host and c.status = 'connected'
		where l.host = 'ffpc' and l.read_as_member and l.detached_at is null and l.host_team_key is not null
		order by 1, 2, 3`)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: ffpc leagues: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ref, error) {
		ref := Ref{Host: HostFFPC}
		err := r.Scan(&ref.LeagueID, &ref.Season, &ref.As)
		return ref, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: ffpc leagues: %w", err)
	}
	return out, nil
}
