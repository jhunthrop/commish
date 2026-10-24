package inseason

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/figurewords"
)

// gameStateWords is the word each wire state prints (Lane 176): the web's
// own, the KICKOFF table's (web/src/lib/league/box/kickoff.ts) with the
// box score's Bye and No club (box.ts BOX), and the League page's "Next
// kickoff" under a game still to come. shared/fixtures/parity/game-state.json
// holds them to the web's, so a word changed there fails the parity test.
var gameStateWords = struct {
	notStarted, kickedOff, final, bye, noClub string
}{notStarted: "Next kickoff", kickedOff: "Kicked off", final: "Final", bye: "Bye", noClub: "No club"}

func gameStateCell(state apitypes.GameStateCellState, word string) *apitypes.GameStateCell {
	return &apitypes.GameStateCell{State: state, Word: word}
}

// kickedOffOrFinal is a read's state once the API says kicked off or
// final, nil for a read still upcoming.
func kickedOffOrFinal(final, kickedOff bool) *apitypes.GameStateCell {
	switch {
	case final:
		return gameStateCell(apitypes.GameStateCellStateFinal, gameStateWords.final)
	case kickedOff:
		return gameStateCell(apitypes.GameStateCellStateKickedOff, gameStateWords.kickedOff)
	}
	return nil
}

// ahead is a game still to come at now, by its kickoff (the web's
// gameHead): kicked off once the kickoff has passed, whatever an upcoming
// read says, so no line offers a move its score bug calls kicked off.
func ahead(kickoff time.Time, now time.Time, word string) *apitypes.GameStateCell {
	if kickoff.After(now) {
		return gameStateCell(apitypes.GameStateCellStateNotStarted, word)
	}
	return gameStateCell(apitypes.GameStateCellStateKickedOff, gameStateWords.kickedOff)
}

// lineGameState is a line's game at now, the web's lineState over the
// line's own facts (Lane 176): Bye on a bye; no game with no kickoff held,
// No club for a free agent and no word for anyone else (BoxGame.svelte's
// cells); else the API's state, final when played without one, an
// upcoming read kicked off once its kickoff has passed.
func lineGameState(line apitypes.PlayerLine, now time.Time) *apitypes.GameStateCell {
	f := line.Facts
	switch {
	case f.Bye:
		return gameStateCell(apitypes.GameStateCellStateBye, gameStateWords.bye)
	case f.Kickoff == nil:
		word := ""
		if line.Player.Team == figurewords.Table.FreeAgentClub {
			word = gameStateWords.noClub
		}
		return gameStateCell(apitypes.GameStateCellStateNoGame, word)
	}
	state := apitypes.GameStateUpcoming
	if f.GameState != nil {
		state = *f.GameState
	} else if f.Played {
		state = apitypes.GameStateFinal
	}
	if read := kickedOffOrFinal(state == apitypes.GameStateFinal, state == apitypes.GameStateKickedOff); read != nil {
		return read
	}
	return ahead(*f.Kickoff, now, gameStateWords.notStarted)
}

// scoreboardGameState is a scoreboard game's head at now, the web's
// gameHead over its state and next kickoff (home.ts bugHead's words):
// "Next kickoff" under a game still to come with a kickoff to name,
// nothing with none.
func scoreboardGameState(g apitypes.ScoreboardGame, now time.Time) *apitypes.GameStateCell {
	if read := kickedOffOrFinal(g.State == apitypes.ScoreboardGameStateFinal, g.State == apitypes.ScoreboardGameStatePlaying); read != nil {
		return read
	}
	if g.NextKickoff == nil {
		return gameStateCell(apitypes.GameStateCellStateNotStarted, "")
	}
	return ahead(*g.NextKickoff, now, gameStateWords.notStarted)
}
