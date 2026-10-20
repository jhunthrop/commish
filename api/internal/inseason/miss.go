package inseason

import (
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// missedLine is the Lineup's miss line (Lane 99, B11): the lineup our
// rule picks with no player held by his kickoff (the highest Proj at each
// slot after designations and byes, as of each kickoff), set against the
// lineup as the platform has it. Each slot where the two differ is named
// once every player in it has kicked off (a bye is past already), with
// what each scored; once every starter of both lineups is final, what our
// lineup would have scored. Nil where the lineups agree, before a
// differing slot has kicked off, where the platform gives no player's
// points, or where a player in a named slot has no points read (no half
// line is said).
func missedLine(config []draft.SlotConfig, people []person, starters []string, points bool) *string {
	if !points {
		return nil
	}
	cands := make([]Candidate, len(people))
	for i, p := range people {
		cands[i] = p.cand
		cands[i].Locked = false
	}
	var misses [][2]string
	// The total is said once every starter of both lineups is final with
	// his points read.
	ours, final := 0.0, true
	for _, r := range Lineup(config, cands, starters) {
		pick, read := pickPoints(people, r.Ours)
		ours += pick.pts
		final = final && read && pick.final && (r.Host < 0 || finalOrBye(people[r.Host].line.Facts))
		if !r.Changed || r.NoOneCanPlay || r.Ours < 0 {
			continue
		}
		m, past, ok := missAt(people, r, missSlot(r.Slot.Type))
		if !ok {
			return nil
		}
		if past {
			misses = append(misses, m)
		}
	}
	if len(misses) == 0 {
		return nil
	}
	var total *float64
	if final {
		t := roundTenth(ours)
		total = &t
	}
	words := MissWords(misses, total)
	return &words
}

// picked is one starter of our pick: his points so far (0 on a bye or
// with no game) and whether his week is over.
type picked struct {
	pts   float64
	final bool
}

// pickPoints is our pick's starter at a slot; an empty slot scores 0 and
// is over. Not ok where his game has kicked off with no points read.
func pickPoints(people []person, at int) (picked, bool) {
	if at < 0 {
		return picked{final: true}, true
	}
	f := people[at].line.Facts
	if stateOfStart(f) == noGame {
		return picked{final: true}, true
	}
	if f.GameState == nil || *f.GameState == apitypes.GameStateUpcoming {
		return picked{}, true
	}
	if f.PointsThisWeek == nil {
		return picked{}, false
	}
	return picked{pts: *f.PointsThisWeek, final: *f.GameState == apitypes.GameStateFinal}, true
}

// finalOrBye is a player whose week is over: his game final, or none.
func finalOrBye(f apitypes.WeekFacts) bool {
	return f.Bye || f.Kickoff == nil || (f.GameState != nil && *f.GameState == apitypes.GameStateFinal)
}

// missAt is one differing slot's two halves, past once both players have
// kicked off (or the set one is on bye or the spot is empty); not ok where
// a player past kickoff has no points read.
func missAt(people []person, r Row, slot string) ([2]string, bool, bool) {
	ours := people[r.Ours].line
	if !kickedOff(ours.Facts) {
		return [2]string{}, false, true
	}
	if ours.Facts.PointsThisWeek == nil {
		return [2]string{}, false, false
	}
	pick := missPick(ours.Player.Name, scoredVerb(*ours.Facts.GameState), *ours.Facts.PointsThisWeek)
	if r.Host < 0 {
		return [2]string{missSet("", "", "", 0, slot, false), pick}, true, true
	}
	set := people[r.Host].line
	if set.Facts.Bye {
		return [2]string{missSet(set.Player.Name, "", "", 0, slot, true), pick}, true, true
	}
	if !kickedOff(set.Facts) {
		return [2]string{}, false, true
	}
	if set.Facts.PointsThisWeek == nil {
		return [2]string{}, false, false
	}
	mark := ""
	if d := set.Facts.Designation; d != nil {
		mark = designationMark(d.Status)
	}
	half := missSet(set.Player.Name, mark, scoredVerb(*set.Facts.GameState), *set.Facts.PointsThisWeek, slot, false)
	return [2]string{half, pick}, true, true
}

// kickedOff is a game past its kickoff by the one state (gameStateAt).
func kickedOff(f apitypes.WeekFacts) bool {
	return !f.Bye && f.GameState != nil && *f.GameState != apitypes.GameStateUpcoming
}
