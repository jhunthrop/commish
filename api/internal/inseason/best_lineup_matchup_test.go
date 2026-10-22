package inseason

import (
	"fmt"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// matchupSideOf is the Matchup's side for roster, failing without one.
func matchupSideOf(t *testing.T, box apitypes.MatchupBox, roster int) apitypes.MatchupBoxSide {
	t.Helper()
	for _, s := range box.Sides {
		if s.RosterId == roster {
			return s
		}
	}
	t.Fatalf("no Matchup side for team %d in %+v", roster, box.Sides)
	return apitypes.MatchupBoxSide{}
}

func isTrue(b *bool) bool { return b != nil && *b }

// The FFPC week's clocks the Matchup is read at: the Friday before, and
// half an hour into Sunday's games.
var ffpcBeforeAndUnderWay = []time.Time{ffpcFriday, liveSunday.Add(30 * time.Minute)}

// B107 ruling 1 (Lane 137): the FFPC Matchup's opponent, whom FFPC sends no
// lineup for, has the Proj the home's bug shows him, our best lineup from
// his roster by the one function, flagged as such; the member's side keeps
// no such Proj (his rows add his). Before kickoff and once his game is
// under way the Matchup has no standing and no Decided: the opponent's
// figure is a Proj, never points to stand against.
func TestTheFFPCMatchupOpponentHasTheHomesBestLineupProj(t *testing.T) {
	f, projection, me, them := ffpcWeekBeforeSunday(t)
	rosterOf(&f, projection, them, false)
	for _, at := range ffpcBeforeAndUnderWay {
		s := ffpcService(t, f, projection, at)
		_, side := sideOf(t, scoreboardOf(t, s), them)
		box := matchupOf(t, s)
		opp := matchupSideOf(t, box, them)
		if side.Projection == nil || *side.Projection != bestWithTE || deref(opp.Projection) != deref(side.Projection) {
			t.Errorf("%s: Matchup Proj %v, board %v, want both %v", at, deref(opp.Projection), deref(side.Projection), bestWithTE)
		}
		if !isTrue(opp.ProjectionBestLineup) || opp.BestLineupSkipped != nil {
			t.Errorf("%s: Matchup flags best lineup %v skipped %v", at, opp.ProjectionBestLineup, opp.BestLineupSkipped)
		}
		if mine := matchupSideOf(t, box, me); mine.Projection != nil || mine.ProjectionBestLineup != nil {
			t.Errorf("%s: the member's Matchup side Proj %v flag %v, want neither", at, deref(mine.Projection), mine.ProjectionBestLineup)
		}
		if box.Standing != nil || box.Decided != nil {
			t.Errorf("%s: standing %v decided %v beside a best-lineup Proj", at, box.Standing, box.Decided)
		}
		// One figure per side across screens (fix round 1, the veteran's Sunday morning): each side's
		// Proj final and count are the board's on the Matchup, the member's as well as the opponent's.
		for _, roster := range []int{me, them} {
			_, board := sideOf(t, scoreboardOf(t, s), roster)
			m := matchupSideOf(t, box, roster)
			if deref(m.ProjectedFinal) != deref(board.ProjectedFinal) || strOf(m.ToPlay) != strOf(board.ToPlay) {
				t.Errorf("%s team %d: Matchup Proj final %v to play %q, board %v and %q", at, roster,
					deref(m.ProjectedFinal), strOf(m.ToPlay), deref(board.ProjectedFinal), strOf(board.ToPlay))
			}
		}
		if _, mine := sideOf(t, scoreboardOf(t, s), me); at.After(liveSunday) && mine.ProjectedFinal == nil {
			t.Errorf("%s: the member's Proj final none under way", at)
		}
	}
}

func strOf(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// B107 ruling 2 (Lane 137): a player with no Proj never empties a team's
// figure. Team 2's roster as rosterOf sets it (QBs p015 at 20 and p025 at
// 25, TEs p021 at 4 and p028 at 3), on the Matchup and the board alike:
//   - the 20 quarterback with no Proj: a bench player by the season's
//     order, not passed over, and the 25 starts as he does anyway;
//   - the 25 with no Proj: the season's first quarterback passed over, the
//     next best with a Proj, the 20, in his slot, flagged;
//   - neither tight end with a Proj: the slot stays empty and the rest
//     still sum, flagged; once the game is under way its Proj final is a
//     figure.
func TestABestLineupPassesOverAPlayerWithNoProjAndSaysSo(t *testing.T) {
	id := func(i int) string { return fmt.Sprintf("p%03d", len(rosterTemplate())+i) }
	for _, tc := range []struct {
		name    string
		noProj  []string
		want    float64
		skipped bool
	}{
		{"every player projected", nil, bestWithTE, false},
		{"the bench quarterback unprojected", []string{id(0)}, bestWithTE, false},
		{"the season's quarterback unprojected", []string{id(10)}, bestWithTE - 25 + 20, true},
		{"no tight end projected", []string{id(6), id(13)}, bestWithTE - 4, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, projection, _, them := ffpcWeekBeforeSunday(t)
			rosterOf(&f, projection, them, false)
			for _, p := range tc.noProj {
				delete(projection.Players, p)
			}
			for _, at := range ffpcBeforeAndUnderWay {
				s := ffpcService(t, f, projection, at)
				_, side := sideOf(t, scoreboardOf(t, s), them)
				opp := matchupSideOf(t, matchupOf(t, s), them)
				for screen, got := range map[string]struct {
					proj    *float64
					skipped *bool
				}{"board": {side.Projection, side.BestLineupSkipped}, "Matchup": {opp.Projection, opp.BestLineupSkipped}} {
					if got.proj == nil || *got.proj != tc.want || isTrue(got.skipped) != tc.skipped {
						t.Errorf("%s %s: Proj %v skipped %v, want %v and %v", at, screen, deref(got.proj), got.skipped, tc.want, tc.skipped)
					}
				}
				if at.After(liveSunday) && (side.ProjectedFinal == nil || opp.ProjectedFinal == nil) {
					t.Errorf("%s: Proj final board %v Matchup %v, want a figure", at, deref(side.ProjectedFinal), deref(opp.ProjectedFinal))
				}
			}
		})
	}
}
