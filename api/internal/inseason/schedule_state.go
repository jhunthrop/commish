package inseason

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// scheduleRead is a side's games by the schedule (Lane 124, B102), for a
// side the platform lists no starters for (FFPC's opponent view), whose
// state no starter's game can give: its roster's games where the league
// read carries the roster (FFPC's rosters page, read without a weekly
// lineup), else every game of the week, each by gameStateAt. Nil for a
// side that lists starters, and with no side.
func (a *advisor) scheduleRead(s *leaguesync.Side) *kickoffs {
	if s == nil || len(s.Starters) > 0 {
		return nil
	}
	var k kickoffs
	if t, ok := a.Snap.TeamByRoster(s.RosterID); ok {
		for _, p := range a.active(t) {
			k.add(p.line.Facts)
		}
	}
	if k.games > 0 {
		return &k
	}
	for _, g := range a.data.Games {
		if g.Week != a.week {
			continue
		}
		at, state := g.Kickoff, gameStateAt(g, a.season.now)
		k.add(apitypes.WeekFacts{Kickoff: &at, GameState: &state})
	}
	return &k
}

// scheduleState is the side's state by the games it reads: final once
// every one is final (startersFinal's strict rule), kicked off once one
// has kicked off, upcoming before; upcoming with none.
func (k kickoffs) scheduleState() apitypes.GameState {
	switch {
	case k.games > 0 && k.finals == k.games:
		return apitypes.GameStateFinal
	case k.kicked > 0:
		return apitypes.GameStateKickedOff
	}
	return apitypes.GameStateUpcoming
}

// gameState is the game's state by each side's own rule (Lane 124, B102):
// its listed starters' games (kickoffs.state), never final while a side
// the platform lists no starters for is not final by the schedule. A game
// none of whose sides lists a starter with a game reads by the schedule
// alone. The next kickoff is the listed starters', else the schedule's.
func gameState(listed kickoffs, unlisted []*kickoffs) (apitypes.ScoreboardGameState, *time.Time) {
	var reads []kickoffs
	for _, u := range unlisted {
		if u != nil {
			reads = append(reads, *u)
		}
	}
	if listed.games == 0 && len(reads) > 0 {
		var all kickoffs
		for _, u := range reads {
			all.merge(u)
		}
		return scheduleGame(all.scheduleState()), all.next
	}
	state := listed.state()
	for _, u := range reads {
		if state == apitypes.ScoreboardGameStateFinal && u.scheduleState() != apitypes.GameStateFinal {
			state = apitypes.ScoreboardGameStatePlaying
		}
	}
	return state, listed.next
}

// scheduleGame is a schedule's state as a game's.
func scheduleGame(s apitypes.GameState) apitypes.ScoreboardGameState {
	switch s {
	case apitypes.GameStateFinal:
		return apitypes.ScoreboardGameStateFinal
	case apitypes.GameStateKickedOff:
		return apitypes.ScoreboardGameStatePlaying
	}
	return apitypes.ScoreboardGameStateUpcoming
}

// merge adds another read's counts, its next kickoff when earlier.
func (k *kickoffs) merge(o kickoffs) {
	k.kicked += o.kicked
	k.done += o.done
	k.finals += o.finals
	k.inPlay += o.inPlay
	k.toCome += o.toCome
	k.games += o.games
	if o.next != nil && (k.next == nil || o.next.Before(*k.next)) {
		at := *o.next
		k.next = &at
	}
}

// scheduleStateOf is the wire's schedule_state for a side: its state by
// the schedule where it lists no starters, nil where it lists them.
func scheduleStateOf(k *kickoffs) *apitypes.GameState {
	if k == nil {
		return nil
	}
	state := k.scheduleState()
	return &state
}
