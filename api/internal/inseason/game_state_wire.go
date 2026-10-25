package inseason

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/figurewords"
)

// The word each wire state prints (Lane 176), a copy of the web's own:
// the KICKOFF table's (web/src/lib/league/box/kickoff.ts: next, kickedOff,
// final) and the box score's BOX table (web/src/lib/league/box/box.ts:
// bye, noClub). TestGameStateMatchesTheWebsReaderOnTheSharedFixtures is
// their guard: every row of shared/fixtures/parity/game-state.json
// carries the web's word, so a word changed there fails it until this
// copy follows.
const (
	wordNotStarted = "Next kickoff"
	wordKickedOff  = "Kicked off"
	wordFinal      = "Final"
	wordBye        = "Bye"
	wordNoClub     = "No club"
)

func gameStateCell(state apitypes.GameStateCellState, word string) *apitypes.GameStateCell {
	return &apitypes.GameStateCell{State: state, Word: word}
}

// ahead is a game the API reads upcoming, at now by its kickoff (the
// web's gameHead): kicked off once the kickoff has passed, so no line
// offers a move its score bug calls kicked off.
func ahead(kickoff time.Time, now time.Time, word string) *apitypes.GameStateCell {
	if kickoff.After(now) {
		return gameStateCell(apitypes.GameStateCellStateNotStarted, word)
	}
	return gameStateCell(apitypes.GameStateCellStateKickedOff, wordKickedOff)
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
		return gameStateCell(apitypes.GameStateCellStateBye, wordBye)
	case f.Kickoff == nil:
		word := ""
		if line.Player.Team == figurewords.Table.FreeAgentClub {
			word = wordNoClub
		}
		return gameStateCell(apitypes.GameStateCellStateNoGame, word)
	}
	state := apitypes.GameStateUpcoming
	if f.GameState != nil {
		state = *f.GameState
	} else if f.Played {
		state = apitypes.GameStateFinal
	}
	switch state {
	case apitypes.GameStateFinal:
		return gameStateCell(apitypes.GameStateCellStateFinal, wordFinal)
	case apitypes.GameStateKickedOff:
		return gameStateCell(apitypes.GameStateCellStateKickedOff, wordKickedOff)
	}
	return ahead(*f.Kickoff, now, wordNotStarted)
}

// scoreboardGameState is a scoreboard game's head at now, the web's
// gameHead over its state and next kickoff (home.ts bugHead's words):
// "Next kickoff" under a game still to come with a kickoff to name,
// nothing with none.
func scoreboardGameState(g apitypes.ScoreboardGame, now time.Time) *apitypes.GameStateCell {
	switch {
	case g.State == apitypes.ScoreboardGameStateFinal:
		return gameStateCell(apitypes.GameStateCellStateFinal, wordFinal)
	case g.State == apitypes.ScoreboardGameStatePlaying:
		return gameStateCell(apitypes.GameStateCellStateKickedOff, wordKickedOff)
	case g.NextKickoff == nil:
		return gameStateCell(apitypes.GameStateCellStateNotStarted, "")
	}
	return ahead(*g.NextKickoff, now, wordNotStarted)
}
