package leaguesync

import (
	"context"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/season"
)

// Snapshot statuses, the same for every host (Sleeper's own words).
const (
	StatusPreDraft = "pre_draft"
	StatusDrafting = "drafting"
	StatusInSeason = "in_season"
	StatusComplete = "complete"
)

// What a status was read from when the host did not state the draft.
const (
	// ReadByRosters is a status read from whether any team has a player
	// (ESPN with no draftDetail, FFPC with no draft board).
	ReadByRosters = "rosters"
	// ReadByWeek is a status read from the host's current week
	// (MyFantasyLeague with no draft results).
	ReadByWeek = "week"
)

// Calendar is the host's word on a league's draft, its playoffs and its
// waivers: the facts its phase is read from (spec 2026-10-16 §1). It is
// kept with the snapshot; the phase itself never is.
type Calendar struct {
	// DraftAt is the host's draft time, nil when the host does not say.
	DraftAt *time.Time `json:"draft_at,omitempty"`
	// DraftUnstated says the host did not state whether the league has
	// drafted, so Status was read from DraftReadBy.
	DraftUnstated bool `json:"draft_unstated,omitempty"`
	// DraftReadBy is ReadByRosters or ReadByWeek for an unstated draft.
	DraftReadBy string `json:"draft_read_by,omitempty"`
	// PlayoffStartWeek is the league's first playoff week as the host
	// states it, 0 when the host does not say.
	PlayoffStartWeek int `json:"playoff_start_week,omitempty"`
	// WaiversClosed says the host has closed adds for the league
	// (Sleeper's disable_adds, ESPN's acquisition limit of none).
	WaiversClosed bool `json:"waivers_closed,omitempty"`
	// WaiversUnstated says the host states nothing on when its waivers
	// close (FFPC, MyFantasyLeague): adds are treated as open, and the
	// playoffs' basis says so.
	WaiversUnstated bool `json:"waivers_unstated,omitempty"`
}

// SiteSeason answers the site's season. *season.Site implements it.
type SiteSeason interface {
	Phase(ctx context.Context) season.SitePhase
}

// draftDayWindow is how near a draft time makes the day a draft day.
const draftDayWindow = 24 * time.Hour

// PhaseFacts is what a league's phase is read from: the host, its last
// kept read (Read false when none is kept), that read's facts, and the
// site's season (zero when not known).
type PhaseFacts struct {
	Host     string
	Read     bool
	Status   string
	Season   int
	Week     int
	Calendar Calendar
	Site     season.SitePhase
}

// LeaguePhase is a league's phase, the one sentence naming the fact it
// came from, and the host facts the shell shows beside it.
type LeaguePhase struct {
	Phase            apitypes.LeaguePhase
	Basis            string
	DraftAt          *time.Time
	PlayoffStartWeek *int
	WaiversOpen      bool
}

// PhaseOf is the league's phase at now, by the spec's table: a past
// season or a season the host calls complete is the offseason, a draft
// under way or due within a day is draft day, an undrafted league is
// before its draft, and a drafted one is in its season until the host's
// week reaches the playoff start week. A drafted league with no week is
// in season before the NFL season and in the offseason after it.
func PhaseOf(f PhaseFacts, now time.Time) LeaguePhase {
	phase, basis := phaseAndBasis(f, now)
	out := LeaguePhase{Phase: phase, Basis: basis, DraftAt: f.Calendar.DraftAt}
	if w := f.Calendar.PlayoffStartWeek; w > 0 {
		out.PlayoffStartWeek = &w
	}
	out.WaiversOpen = phase != apitypes.LeaguePhaseOffseason && !f.Calendar.WaiversClosed
	return out
}

func phaseAndBasis(f PhaseFacts, now time.Time) (apitypes.LeaguePhase, string) {
	host := HostWords(f.Host)
	switch {
	case f.Season > 0 && f.Season < season.Of(now):
		return apitypes.LeaguePhaseOffseason, fmt.Sprintf("This is the league's %d season, which is over.", f.Season)
	case !f.Read:
		return apitypes.LeaguePhasePreDraft, fmt.Sprintf("We have not read this league from %s yet.", host)
	case f.Status == StatusComplete:
		return apitypes.LeaguePhaseOffseason, host + " says the season is over."
	case f.Status == StatusDrafting:
		return apitypes.LeaguePhaseDraftDay, host + " says the draft is under way."
	}
	if phase, basis, ok := byDraftTime(f, host, now); ok {
		return phase, basis
	}
	if f.Status == StatusPreDraft {
		return apitypes.LeaguePhasePreDraft, notDrafted(f, host)
	}
	return drafted(f, host)
}

// notDrafted names the fact a league before its draft was read from.
func notDrafted(f PhaseFacts, host string) string {
	switch {
	case !f.Calendar.DraftUnstated:
		return host + " says the league has not drafted yet."
	case f.Calendar.DraftReadBy == ReadByRosters:
		return host + " did not state the draft and no team has a player yet."
	}
	return host + " did not state the draft and its season has no current week yet."
}

// byDraftTime reads the phase from the host's draft time: for a league
// the host says has not drafted, or one whose draft it does not state.
// A draft time within a day either way is draft day; a later one, for a
// league whose draft is unstated, is before the draft.
func byDraftTime(f PhaseFacts, host string, now time.Time) (apitypes.LeaguePhase, string, bool) {
	at := f.Calendar.DraftAt
	if at == nil || (f.Status != StatusPreDraft && !f.Calendar.DraftUnstated) {
		return "", "", false
	}
	switch until := at.Sub(now); {
	case until > draftDayWindow:
		if f.Calendar.DraftUnstated {
			return apitypes.LeaguePhasePreDraft, host + " has the draft set for a later day.", true
		}
	case until > 0:
		return apitypes.LeaguePhaseDraftDay, host + " has the draft starting within a day.", true
	case until > -draftDayWindow && f.Status == StatusPreDraft:
		return apitypes.LeaguePhaseDraftDay, host + "'s draft time has come and the draft is not marked done.", true
	}
	return "", "", false
}

// draftClause names the fact a league counts as drafted from.
func draftClause(f PhaseFacts, host string) string {
	switch {
	case !f.Calendar.DraftUnstated:
		return host + " says the draft is done"
	case f.Calendar.DraftReadBy == ReadByRosters:
		return host + " did not state the draft but its teams have players"
	}
	return host + " did not state the draft"
}

// drafted is the phase of a league past its draft (or whose draft the
// host does not state but whose rosters or week say so), by the host's
// week.
func drafted(f PhaseFacts, host string) (apitypes.LeaguePhase, string) {
	draft, start := draftClause(f, host), f.Calendar.PlayoffStartWeek
	switch {
	case f.Week < 1:
		return noWeek(f, draft)
	case start > 0 && f.Week >= start:
		basis := fmt.Sprintf("%s is in week %d and the league's playoffs start in week %d", host, f.Week, start)
		if f.Calendar.WaiversUnstated {
			basis += ", and " + host + " does not say when waivers close so we treat adds as open"
		}
		return apitypes.LeaguePhasePlayoffs, basis + "."
	}
	return apitypes.LeaguePhaseInSeason, fmt.Sprintf("%s and week %d is under way.", draft, f.Week)
}

// noWeek is a drafted league the host gives no current week: in season
// before the NFL season starts (the member manages the roster from the
// draft on), the offseason once the NFL regular season is over.
func noWeek(f PhaseFacts, draft string) (apitypes.LeaguePhase, string) {
	switch f.Site.Phase {
	case season.SitePreseason:
		if !f.Site.Opener.IsZero() {
			return apitypes.LeaguePhaseInSeason, draft + " and the season starts " + season.OpenerDay(f.Site.Opener) + "."
		}
		return apitypes.LeaguePhaseInSeason, draft + " and the NFL season has not started yet."
	case season.SitePlayoffs, season.SiteOffseason:
		return apitypes.LeaguePhaseOffseason, draft + " and the NFL regular season is over."
	}
	return apitypes.LeaguePhaseInSeason, draft + " and there is no current week."
}

// maxDraftKept bounds a host's process-local draft answers: past it the
// map starts again, costing one more draft read a league.
const maxDraftKept = 10000

// keep sets m[key] = v in a map bounded by maxDraftKept, making the map
// when nil and starting it again when full.
func keep[V any](m map[string]V, key string, v V) map[string]V {
	if _, present := m[key]; m == nil || (!present && len(m) >= maxDraftKept) {
		m = map[string]V{}
	}
	m[key] = v
	return m
}
