// Package lobby is the mock with people (docs/design/2026-10-12-mock-
// room-rethink.md, "the lobby: people, and a clock"): a queue by format,
// a room that starts when it is full or 90 seconds after its first
// drafter, bots in the open seats, a pick clock, a stand-in for a seat
// whose drafter has gone, and every pick written for the nightly ADP.
//
// The room's log (app.room_actions) is the one truth. Any process may
// write to it under the room's row lock: the api on a join or a leave,
// the room service on a command from a socket or a clock that ran out.
// The room service's owner of a room only keeps its clock.
package lobby

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// FillWindow is how long a room waits for people after its first drafter
// joins before bots take the open seats. Today's room waits 180 seconds;
// 90 is the number the room doc measures against.
const FillWindow = 90 * time.Second

// SoloPaceBelow is the count of people under which a lobby keeps the
// solo room's pace: its bots pick at once, with no think time (the room
// doc's "What the build must settle", item 5).
const SoloPaceBelow = 3

// Format is one lobby queue.
type Format struct {
	Key          apitypes.LobbyFormat
	Teams        int
	ClockSeconds int
	Scoring      apitypes.ScoringPreset
	Lineup       apitypes.Lineup
}

// Formats is every lobby queue, in the setup page's order: 12 PPR,
// 12 half PPR superflex, 10 PPR. The ten-team room drafts on a 45 second
// clock, the others on 30.
func Formats() []Format {
	return []Format{
		{Key: apitypes.LobbyFormatN12Ppr, Teams: 12, ClockSeconds: 30, Scoring: apitypes.ScoringPresetPpr, Lineup: apitypes.LineupStandard},
		{Key: apitypes.LobbyFormatN12HalfSuperflex, Teams: 12, ClockSeconds: 30, Scoring: apitypes.ScoringPresetHalfPpr, Lineup: apitypes.LineupSuperflex},
		{Key: apitypes.LobbyFormatN10Ppr, Teams: 10, ClockSeconds: 45, Scoring: apitypes.ScoringPresetPpr, Lineup: apitypes.LineupStandard},
	}
}

// FormatOf is the format by key.
func FormatOf(key apitypes.LobbyFormat) (Format, bool) {
	for _, f := range Formats() {
		if f.Key == key {
			return f, true
		}
	}
	return Format{}, false
}

// Settings is the league a format drafts: the standard roster (QB, two
// RB, two WR, TE, the lineup's flex spots, K, DEF and six on the bench),
// no keepers, bots from where drafters take players.
func (f Format) Settings() apitypes.LeagueSettings {
	preset := f.Scoring
	return apitypes.LeagueSettings{
		Scoring:  apitypes.Scoring{Preset: &preset},
		Teams:    f.Teams,
		Roster:   apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
		Lineup:   f.Lineup,
		Keepers:  []apitypes.Keeper{},
		BotStyle: apitypes.BotStyleAdp,
	}
}
