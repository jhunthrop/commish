package inseason

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// WeekLeague is one league the account follows as the front door reads
// it: the attached row, and in season the league the advice reads, or
// the sentence saying why it has none.
type WeekLeague struct {
	ID       uuid.UUID
	Name     string
	Host     string
	TeamName string
	Standing *apitypes.LeagueStanding
	Phase    apitypes.LeaguePhase
	// WaiversOpen says the platform still runs waivers this week.
	WaiversOpen bool
	ReadAt      *time.Time
	// League is nil out of season or when the read failed.
	League  *League
	Problem string
}

// Weeks lists the account's leagues for the front door. SyncLeagues
// implements it.
type Weeks interface {
	Weeks(ctx context.Context, accountID uuid.UUID) ([]WeekLeague, error)
}

// The front door's sentences when a part of a league's week is missing.
const (
	factsWords = "This week's facts could not be read just now. Your standing is from the last read."
)

// week is GET /me/week (Lane 66k): every league the account follows, each
// with its score bug, its lineup's changes and up to three roster facts,
// read once for the front door. A league whose read fails keeps its row
// and says why.
func (s *Service) week(w http.ResponseWriter, r *http.Request) {
	out := apitypes.MemberWeek{Leagues: []apitypes.WeekLeague{}}
	if s.Weeks == nil {
		httpx.WriteOK(w, r, http.StatusOK, out)
		return
	}
	ctx, account := r.Context(), auth.AccountID(r)
	list, err := s.Weeks.Weeks(ctx, account)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: week", err)
		return
	}
	var held map[string]bool
	for _, wl := range list {
		if wl.League != nil && held == nil {
			if held, err = s.Holds.Held(ctx, account); err != nil {
				httpx.WriteInternal(w, r, s.Log, "inseason: week held", err)
				return
			}
		}
		out.Leagues = append(out.Leagues, s.weekLeague(ctx, account, wl, held))
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// weekLeague is one league's week. Every part it could not read is left
// null with problem saying why; the row itself is always answered.
func (s *Service) weekLeague(ctx context.Context, account uuid.UUID, wl WeekLeague, held map[string]bool) apitypes.WeekLeague {
	out := apitypes.WeekLeague{Id: wl.ID, Name: wl.Name, Host: apitypes.LeagueHost(wl.Host), TeamName: wl.TeamName,
		Standing: wl.Standing, Phase: wl.Phase, ReadAt: wl.ReadAt, Chips: []apitypes.RosterChip{}}
	problem := func(words string) apitypes.WeekLeague {
		out.Problem = &words
		return out
	}
	switch {
	case wl.Problem != "":
		return problem(wl.Problem)
	case wl.League == nil:
		return out
	case wl.League.Saved == nil:
		return problem(wl.League.SettingsNote)
	case wl.League.Snap.Week == 0:
		return out
	}
	l := *wl.League
	readAt := l.Snap.ReadAt
	out.ReadAt, out.Week = &readAt, l.Snap.Week
	data, err := s.Facts.Data(ctx, seasonOf(l))
	if err != nil {
		s.Log.Warn("inseason: week facts", "league", wl.ID, "err", err)
		return problem(factsWords)
	}
	a, err := newAdvisor(l, data, s.projection(ctx, seasonOf(l), l.Snap.Week), held, s.Now())
	if err != nil {
		s.Log.Warn("inseason: week advisor", "league", wl.ID, "err", err)
		return problem(factsWords)
	}
	scoring := projectionScoring(a.settings, a.preset)
	out.ProjectionReadAt, out.ProjectionScoring = a.projectionReadAt(), &scoring
	lineup, ok := a.Lineup()
	if !ok {
		return problem(noTeamWords)
	}
	out.Bug = a.weekBug(lineup)
	moves := s.lineupMoves(ctx, account, l.Snap.Ref.Host)
	summary := lineupSummary(lineup, moves)
	out.Lineup = &summary
	var pickups []apitypes.WaiverRow
	if wl.WaiversOpen {
		if wa, ok := a.Waivers(""); ok {
			pickups = wa.Pickups
		}
	}
	out.Chips = rosterChips(lineup, pickups)
	return out
}

// lineupMoves is whether the account sets its lineup on the platform from
// our screen. A failed check keeps what it knew with the verb closed and
// a reason always set, as the Lineup's answer does.
func (s *Service) lineupMoves(ctx context.Context, account uuid.UUID, host string) apitypes.LineupMoves {
	if s.Moves == nil {
		return CopyOnlyMoves(host)
	}
	moves, err := s.Moves.LineupMove(ctx, account, host)
	if err != nil {
		s.Log.Warn("inseason: moves", "err", err)
		moves.Lineup = apitypes.LineupMovesLineupUnavailable
		if moves.Reason == nil {
			moves = CopyOnlyMoves(host)
		}
	}
	return moves
}

// asSet is the slot's player as the platform holds it: ours when
// unchanged, the starter we sit for a change, nil for a spot left empty.
func asSet(slot apitypes.LineupSlot) *apitypes.PlayerLine {
	if !slot.Changed {
		return &slot.Ours
	}
	return slot.Host
}

// weekBug is the member's game this week with both teams and the
// starters as set whose kickoff is the earliest of theirs to come; nil
// when the member has no game in the read.
func (a *advisor) weekBug(lineup apitypes.LineupAdvice) *apitypes.WeekBug {
	games := a.Scoreboard().Games
	if len(games) == 0 || games[0].Sides[0].RosterId != a.Me {
		return nil
	}
	game := games[0]
	out := apitypes.WeekBug{Game: game, Teams: make([]apitypes.LeagueTeam, 0, len(game.Sides)), First: []apitypes.PlayerLine{}}
	for _, side := range game.Sides {
		if t, ok := a.Snap.TeamByRoster(side.RosterId); ok {
			out.Teams = append(out.Teams, leaguesync.TeamOnWire(t))
		}
	}
	out.First = firstToPlay(lineup.Slots, a.now)
	return &out
}

// firstToPlay is the starters as set whose kickoff is the earliest of
// theirs still to come, in slot order.
func firstToPlay(slots []apitypes.LineupSlot, now time.Time) []apitypes.PlayerLine {
	var next *time.Time
	var out []apitypes.PlayerLine
	for _, slot := range slots {
		line := asSet(slot)
		if line == nil || line.Facts.Bye || line.Facts.Played || line.Facts.Kickoff == nil || !line.Facts.Kickoff.After(now) {
			continue
		}
		at := *line.Facts.Kickoff
		switch {
		case next == nil || at.Before(*next):
			next, out = &at, []apitypes.PlayerLine{*line}
		case at.Equal(*next):
			out = append(out, *line)
		}
	}
	if out == nil {
		return []apitypes.PlayerLine{}
	}
	return out
}

// printedSum is the lines' week projections, each as printed to the
// tenth, summed; nil when none has one (the web's projTotal, once here).
func printedSum(lines []*apitypes.PlayerLine) *float64 {
	var sum float64
	held := false
	for _, l := range lines {
		if l == nil || l.WeekProjection == nil {
			continue
		}
		sum += roundTenth(*l.WeekProjection)
		held = true
	}
	if !held {
		return nil
	}
	total := roundTenth(sum)
	return &total
}

// lineupSummary is the lineup's changes and what they add: our starters'
// Proj against the lineup as the platform holds it, a spot no one can
// play counting nothing on both sides.
func lineupSummary(lineup apitypes.LineupAdvice, moves apitypes.LineupMoves) apitypes.WeekLineup {
	var ours, set []*apitypes.PlayerLine
	out := apitypes.WeekLineup{Swaps: []apitypes.WeekSwap{}, Moves: moves}
	for i := range lineup.Slots {
		slot := lineup.Slots[i]
		if slot.Changed {
			swap := apitypes.WeekSwap{Slot: apitypes.WeekSwapSlot(slot.Slot), In: slot.Ours.Player}
			if slot.Host != nil {
				who := slot.Host.Player
				swap.Out = &who
			}
			out.Swaps = append(out.Swaps, swap)
		}
		if slot.NoOneCanPlay {
			continue
		}
		ours = append(ours, &lineup.Slots[i].Ours)
		set = append(set, asSet(slot))
	}
	out.Changes = len(out.Swaps)
	out.Projection, out.AsSet = printedSum(ours), printedSum(set)
	if out.Projection != nil && out.AsSet != nil {
		gain := roundTenth(*out.Projection - *out.AsSet)
		out.Gain = &gain
	}
	return out
}

// rosterChips is at most three facts about the member's roster, in order:
// a starter as set with this week's newest designation, a starter as set
// on bye (one whose spot no one can play first), and the first pickup the
// Waivers screen chooses.
func rosterChips(lineup apitypes.LineupAdvice, pickups []apitypes.WaiverRow) []apitypes.RosterChip {
	out := []apitypes.RosterChip{}
	if line := newestDesignation(lineup.Slots); line != nil {
		out = append(out, apitypes.RosterChip{Kind: apitypes.RosterChipKindStatus, Line: *line})
	}
	if line, idle := byeStarter(lineup.Slots); line != nil {
		out = append(out, apitypes.RosterChip{Kind: apitypes.RosterChipKindBye, Line: *line, Idle: idle})
	}
	if len(pickups) > 0 {
		gain := pickups[0].WeekGain
		out = append(out, apitypes.RosterChip{Kind: apitypes.RosterChipKindPickup, Line: pickups[0].Add, Gain: &gain})
	}
	return out
}

// newestDesignation is the starter as set whose designation is the
// newest, nil when none carries one.
func newestDesignation(slots []apitypes.LineupSlot) *apitypes.PlayerLine {
	var out *apitypes.PlayerLine
	for _, slot := range slots {
		line := asSet(slot)
		if line == nil || line.Facts.Designation == nil {
			continue
		}
		if out == nil || line.Facts.Designation.AsOf.After(out.Facts.Designation.AsOf) {
			out = line
		}
	}
	return out
}

// byeStarter is a starter as set on bye, one whose spot no one on the
// roster can play first, and whether it is that.
func byeStarter(slots []apitypes.LineupSlot) (*apitypes.PlayerLine, bool) {
	var first *apitypes.PlayerLine
	for _, slot := range slots {
		line := asSet(slot)
		if line == nil || !line.Facts.Bye {
			continue
		}
		if slot.NoOneCanPlay {
			return line, true
		}
		if first == nil {
			first = line
		}
	}
	return first, false
}

// Weeks is the account's leagues for the front door, each in season read
// as the routes read it.
func (l SyncLeagues) Weeks(ctx context.Context, accountID uuid.UUID) ([]WeekLeague, error) {
	list, err := l.Sync.Week(ctx, accountID)
	if err != nil {
		return nil, err
	}
	out := make([]WeekLeague, 0, len(list))
	for _, r := range list {
		wl := WeekLeague{ID: r.ID, Name: r.Name, Host: r.Host, TeamName: r.TeamName, Standing: r.Standing, Phase: r.Phase.Phase,
			WaiversOpen: r.Phase.WaiversOpen, ReadAt: r.LastReadAt, Problem: r.Problem}
		if r.Followed != nil {
			league := leagueOf(*r.Followed)
			wl.League = &league
			if t, ok := r.Followed.Snap.TeamByRoster(r.Followed.Link.RosterID); ok && t.Name != "" {
				wl.TeamName = t.Name
			}
		}
		out = append(out, wl)
	}
	return out, nil
}
