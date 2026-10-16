package leaguesync

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/account"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// LeagueScoring is the preset a league's scoring is or scores most like,
// and the board it reads on. The saved league decides when there is one
// (its preset, or its own rules read by NearestPreset on the boards'
// thresholds, scoring.PPRFrom and HalfFrom; superflex by its lineup);
// otherwise the last read's rules and lineup do. A league with no rules
// read reads as PPR.
func LeagueScoring(saved *apitypes.LeagueSettings, rules map[string]float64, superFlex bool) (apitypes.ScoringPreset, apitypes.BoardFormat) {
	preset := apitypes.ScoringPresetPpr
	switch {
	case saved != nil && saved.Scoring.Preset != nil:
		preset = *saved.Scoring.Preset
	case saved != nil && saved.Scoring.Custom != nil:
		preset = NearestPreset(scoring.ToMap(*saved.Scoring.Custom))
	case saved == nil && len(rules) > 0:
		preset = NearestPreset(rules)
	}
	if saved != nil {
		superFlex = saved.Lineup == apitypes.LineupSuperflex
	}
	if superFlex {
		return preset, apitypes.BoardFormatSuperflex
	}
	return preset, boards.FormatFor(preset).Board()
}

// contextLeague is a followed league as the shell's switcher lists it,
// with its phase as listed.
func contextLeague(a Attached) apitypes.ContextLeague {
	scoring, format := LeagueScoring(a.Saved, a.Rules, a.SuperFlex > 0)
	settings := a.LeagueID
	if a.Saved == nil {
		settings = nil
	}
	p := a.Phase
	return apitypes.ContextLeague{
		Id: a.ID, Name: a.Name, Host: apitypes.LeagueHost(a.Ref.Host), TeamName: a.TeamName,
		Standing: standingOf(a.Teams, a.RosterID), Scoring: scoring, Format: format, SettingsLeagueId: settings,
		Phase: p.Phase, PhaseBasis: p.Basis, DraftAt: p.DraftAt, PlayoffStartWeek: p.PlayoffStartWeek, WaiversOpen: p.WaiversOpen,
	}
}

// Context is the account's league context: every league it follows,
// the one selected, and the format pages open in.
func (s *Store) Context(ctx context.Context, accountID uuid.UUID) (account.LeagueContext, error) {
	list, err := s.Attached(ctx, accountID)
	if err != nil {
		return account.LeagueContext{}, err
	}
	var link *uuid.UUID
	var format *apitypes.BoardFormat
	err = s.Pool.QueryRow(ctx, `select link_id, format from app.league_selections where account_id = $1`,
		accountID).Scan(&link, &format)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return account.LeagueContext{}, fmt.Errorf("leaguesync: selection for %s: %w", accountID, err)
	}
	return contextOf(list, link, format), nil
}

// contextOf is the context from the followed leagues and the selection:
// the selected league while it is followed, none when a format was
// chosen, and otherwise the newest league.
func contextOf(list []Attached, link *uuid.UUID, format *apitypes.BoardFormat) account.LeagueContext {
	out := account.LeagueContext{Leagues: make([]apitypes.ContextLeague, 0, len(list))}
	for _, a := range list {
		out.Leagues = append(out.Leagues, contextLeague(a))
	}
	out.League = selected(out.Leagues, link, format)
	switch {
	case out.League != nil:
		f := out.League.Format
		out.Format = &f
	case format != nil:
		f := *format
		out.Format = &f
	}
	return out
}

func selected(leagues []apitypes.ContextLeague, link *uuid.UUID, format *apitypes.BoardFormat) *apitypes.ContextLeague {
	if link != nil {
		for _, l := range leagues {
			if l.Id == *link {
				return &l
			}
		}
	}
	if format != nil || len(leagues) == 0 {
		return nil
	}
	newest := leagues[0]
	return &newest
}

// Select sets the account's context: one of its followed leagues, or a
// format with no league. ErrLinkNotFound is a league it does not follow.
func (s *Store) Select(ctx context.Context, accountID uuid.UUID, choice apitypes.LeagueChoice) error {
	tag, err := s.Pool.Exec(ctx, `insert into app.league_selections (account_id, link_id, format)
		select $1, $2, $3
		where $2::uuid is null or exists (select 1 from app.league_links
			where id = $2 and account_id = $1 and detached_at is null)
		on conflict (account_id) do update set link_id = excluded.link_id, format = excluded.format, updated_at = now()`,
		accountID, choice.LeagueId, choice.Format)
	if err != nil {
		return fmt.Errorf("leaguesync: select for %s: %w", accountID, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrLinkNotFound
	}
	return nil
}
