package leaguesync

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Attached is one link as the account page and the shell's switcher list
// it: the league's name and the drafter's team at the last read, and what
// decides its scoring and board (the saved league it made, else the
// last read's rules and lineup).
type Attached struct {
	Link
	Season   int
	Name     string
	TeamName string
	// Teams are the league's teams at the last read, none when unread.
	Teams []Team
	// Saved is the saved league the attach made, nil when it made none
	// or it was deleted.
	Saved *apitypes.LeagueSettings
	// Rules are the league's scoring at the last read, none when unread.
	Rules map[string]float64
	// SuperFlex is the superflex spots the last read's lineup starts.
	SuperFlex int
	// Read says a read of the league is kept; Status, Week and Calendar
	// are that read's, what its phase is computed from.
	Read     bool
	Status   string
	Week     int
	Calendar Calendar
	// Phase is the league's phase when it was listed, at the store's
	// clock and the site's season.
	Phase LeaguePhase
}

// Attached is the account's links, newest first, each with its league's
// name and team from the last read. With no read kept, the name is the
// saved league's the attach made, so a league is never nameless.
func (s *Store) Attached(ctx context.Context, accountID uuid.UUID) ([]Attached, error) {
	rows, err := s.Pool.Query(ctx, `select l.id, l.account_id, l.league_id, l.host, l.host_league_id, l.host_season,
		l.roster_id, l.attached_at, l.last_read_at,
		coalesce((sn.snapshot->>'season')::int, l.host_season), coalesce(nullif(sn.snapshot->>'name', ''), saved.name, ''),
		coalesce((select t->>'name' from jsonb_array_elements(sn.snapshot->'teams') t
			where (t->>'roster_id')::int = l.roster_id limit 1), ''),
		sn.snapshot->'teams', saved.settings, sn.snapshot->'scoring'->'rules',
		coalesce((sn.snapshot->'shape'->>'super_flex')::int, 0),
		sn.snapshot is not null, coalesce(sn.snapshot->>'status', ''), coalesce((sn.snapshot->>'week')::int, 0),
		sn.snapshot->'calendar'
		from app.league_links l
		left join app.league_snapshots sn
			on sn.host = l.host and sn.host_league_id = l.host_league_id and sn.host_season = l.host_season
			and sn.read_as = case when l.read_as_member then l.account_id else '00000000-0000-0000-0000-000000000000'::uuid end
		left join app.leagues saved on saved.id = l.league_id and saved.account_id = l.account_id
		where l.account_id = $1 and l.detached_at is null order by l.attached_at desc, l.id limit $2`, accountID, MaxLinksPerAccount)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: attached: %w", err)
	}
	out, err := pgx.CollectRows(rows, scanAttached)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: attached: %w", err)
	}
	if len(out) == 0 {
		return out, nil
	}
	now, site := s.now(), s.site(ctx)
	for i, a := range out {
		out[i].Phase = PhaseOf(PhaseFacts{Host: a.Ref.Host, Read: a.Read, Status: a.Status, Season: a.Season,
			Week: a.Week, Calendar: a.Calendar, Site: site}, now)
	}
	return out, nil
}

func scanAttached(r pgx.CollectableRow) (Attached, error) {
	var a Attached
	var teams, saved, rules, calendar []byte
	err := r.Scan(&a.ID, &a.AccountID, &a.LeagueID, &a.Ref.Host, &a.Ref.LeagueID, &a.Ref.Season, &a.RosterID,
		&a.AttachedAt, &a.LastReadAt, &a.Season, &a.Name, &a.TeamName, &teams, &saved, &rules, &a.SuperFlex,
		&a.Read, &a.Status, &a.Week, &calendar)
	if err != nil {
		return a, err
	}
	for _, field := range []struct {
		raw  []byte
		into any
	}{{teams, &a.Teams}, {saved, &a.Saved}, {rules, &a.Rules}, {calendar, &a.Calendar}} {
		if len(field.raw) == 0 {
			continue
		}
		if err := json.Unmarshal(field.raw, field.into); err != nil {
			return a, err
		}
	}
	return a, nil
}
