package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// startState is one starter's place in his side's week by the one game
// state (gameStateAt, carried on his facts): no game (a bye, or none
// held), still to come, in play, or done (final, or out of a game under
// way: he scores nothing more, Lane 92, B02). Before kickoff an out
// starter is still to come, as the platform keeps the matchup in
// progress: he can still be swapped out (fix round 1, HIGH-2).
type startState int

const (
	noGame startState = iota
	stillToCome
	inPlay
	done
)

func stateOfStart(f apitypes.WeekFacts) startState {
	if f.Bye || f.Kickoff == nil || f.GameState == nil {
		return noGame
	}
	switch *f.GameState {
	case apitypes.GameStateFinal:
		return done
	case apitypes.GameStateKickedOff:
		if sitsOut(f) {
			return done
		}
		return inPlay
	}
	return stillToCome
}

// sideLeft is a side's starters who can still score, by second mention:
// those in play and those still to come.
type sideLeft struct {
	playing, coming []string
}

func (s sideLeft) count() int { return len(s.playing) + len(s.coming) }

// leftOf is the side's starters who can still score.
func leftOf(starters []apitypes.PlayerLine) sideLeft {
	var out sideLeft
	for _, l := range starters {
		switch stateOfStart(l.Facts) {
		case inPlay:
			out.playing = append(out.playing, secondMention(l.Player.Name))
		case stillToCome:
			out.coming = append(out.coming, secondMention(l.Player.Name))
		}
	}
	return out
}

// Standing is where the member's game stands at the read (Lane 99, B31):
// the score bug's sentence under the two scores, and whether the side
// behind has nobody left to score (the bug then says Decided).
type Standing struct {
	Words   string
	Decided bool
}

// standingOf is the member's game as the bug says it: nothing before the
// first kickoff, without an opponent, with either score unread or with a
// side whose starters the platform does not show us (FFPC's opponents);
// while it plays the margin and who is left on each side; once final the
// result.
func standingOf(state apitypes.ScoreboardGameState, sides []*leaguesync.Side, starters [][]apitypes.PlayerLine) (Standing, bool) {
	if state == apitypes.ScoreboardGameStateUpcoming || len(sides) != 2 || len(starters) != 2 {
		return Standing{}, false
	}
	mine, theirs := sidePoints(sides[0]), sidePoints(sides[1])
	if mine == nil || theirs == nil || len(starters[0]) == 0 || len(starters[1]) == 0 {
		return Standing{}, false
	}
	margin := roundTenth(*mine - *theirs)
	if state == apitypes.ScoreboardGameStateFinal {
		return Standing{Words: ResultWords(margin)}, true
	}
	ours, others := leftOf(starters[0]), leftOf(starters[1])
	decided := (margin < 0 && ours.count() == 0) || (margin > 0 && others.count() == 0)
	return Standing{Words: StandingWords(margin, ours, others), Decided: decided}, true
}

// standingFields is the standing as the matchup answer carries it.
func standingFields(s Standing, ok bool) (*string, *bool) {
	if !ok {
		return nil, nil
	}
	words, decided := s.Words, s.Decided
	return &words, &decided
}
