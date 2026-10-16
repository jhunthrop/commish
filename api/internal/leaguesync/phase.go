package leaguesync

import (
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

// Calendar is the host's word on a league's draft, its playoffs and its
// waivers: the facts its phase is read from (spec 2026-10-16 §1). It is
// kept with the snapshot; the phase itself never is.
type Calendar struct {
	// DraftAt is the host's draft time, nil when the host does not say.
	DraftAt *time.Time `json:"draft_at,omitempty"`
	// DraftUnstated says the host did not state whether the league has
	// drafted, so Status was read from its week (MyFantasyLeague with no
	// draft results, a read whose draft page did not answer).
	DraftUnstated bool `json:"draft_unstated,omitempty"`
	// PlayoffStartWeek is the league's first playoff week as the host
	// states it, 0 when the host does not say.
	PlayoffStartWeek int `json:"playoff_start_week,omitempty"`
	// WaiversClosed says the host has closed adds for the league
	// (Sleeper's disable_adds, ESPN's acquisition limit of none).
	WaiversClosed bool `json:"waivers_closed,omitempty"`
}

// draftDayWindow is how near a draft time makes the day a draft day.
const draftDayWindow = 24 * time.Hour

// PhaseFacts is what a league's phase is read from: the host, its last
// kept read (Read false when none is kept), and that read's facts.
type PhaseFacts struct {
	Host     string
	Read     bool
	Status   string
	Season   int
	Week     int
	Calendar Calendar
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
// week reaches the playoff start week (or has no week at all).
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
		if f.Calendar.DraftUnstated {
			return apitypes.LeaguePhasePreDraft, host + " does not say whether the league has drafted, and its season has no current week yet."
		}
		return apitypes.LeaguePhasePreDraft, host + " says the league has not drafted yet."
	}
	return drafted(f, host)
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

// drafted is the phase of a league past its draft (or whose draft the
// host does not state but whose week is under way), by the host's week.
func drafted(f PhaseFacts, host string) (apitypes.LeaguePhase, string) {
	start := f.Calendar.PlayoffStartWeek
	switch {
	case f.Week < 1:
		return apitypes.LeaguePhaseOffseason, host + " says the draft is done and has no current week."
	case start > 0 && f.Week >= start:
		return apitypes.LeaguePhasePlayoffs, fmt.Sprintf("%s is in week %d and the league's playoffs start in week %d.", host, f.Week, start)
	case f.Calendar.DraftUnstated:
		return apitypes.LeaguePhaseInSeason, fmt.Sprintf("%s does not say whether the league has drafted, and its week %d is under way.", host, f.Week)
	}
	return apitypes.LeaguePhaseInSeason, fmt.Sprintf("%s says the draft is done and week %d is under way.", host, f.Week)
}
