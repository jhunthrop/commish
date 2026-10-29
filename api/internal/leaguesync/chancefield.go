package leaguesync

import "slices"

// The playoff field (Lane 298, fix round 1): each division's winner first
// where the platform seats them (as read), then each seed by record (the
// best record left, ties by points for in the replays) or by points (the
// most points left). The settled field, once no game is left, breaks a tie
// only by the platform's own rule where it is read; a tie it cannot break
// that straddles the cut proves nothing for the teams in it.

// field is the replay's playoff teams.
func (l chanceLeague) field(wins, points map[int]float64) []int {
	made, _ := l.pick(wins, points, false)
	return made
}

// pickOne is the best team of cands for a seed of kind, and the teams tied
// with it that the rule in force could not tell apart (none when it could).
type pickOne func(cands []int, kind string) (best int, tied []int)

// pick runs the seeding: the replay's (exact false: ties by points for)
// or the settled field's (exact true: ties by the platform's read rule).
// It answers the field and the ties no read rule broke.
func (l chanceLeague) pick(wins, points map[int]float64, exact bool) ([]int, [][]int) {
	choose := l.replayPick(wins, points)
	if exact {
		choose = l.exactPick(wins, points)
	}
	left := append([]int(nil), l.ids...)
	var made []int
	var open [][]int
	take := func(cands []int, kind string) {
		if len(cands) == 0 {
			return
		}
		best, tied := choose(cands, kind)
		if len(tied) > 1 {
			open = append(open, tied)
		}
		made = append(made, best)
		left = slices.DeleteFunc(left, func(id int) bool { return id == best })
	}
	seeds := l.seeds
	if l.division != nil {
		for _, d := range l.divisionsOf() {
			take(l.inDivision(left, d), SeedRecord)
		}
		seeds = seeds[min(len(made), len(seeds)):]
	}
	for _, kind := range seeds {
		take(left, kind)
	}
	return made, open
}

// divisionsOf is the league's divisions, in order.
func (l chanceLeague) divisionsOf() []int {
	var out []int
	for _, id := range l.ids {
		if d := l.division[id]; !slices.Contains(out, d) {
			out = append(out, d)
		}
	}
	slices.Sort(out)
	return out
}

func (l chanceLeague) inDivision(ids []int, d int) []int {
	var out []int
	for _, id := range ids {
		if l.division[id] == d {
			out = append(out, id)
		}
	}
	return out
}

// replayPick takes the best record (ties by points for) or the most points
// (ties by record); a replay's tie never stays open.
func (l chanceLeague) replayPick(wins, points map[int]float64) pickOne {
	return func(cands []int, kind string) (int, []int) {
		best := cands[0]
		for _, id := range cands[1:] {
			if ahead(id, best, kind, wins, points) {
				best = id
			}
		}
		return best, nil
	}
}

// exactPick takes the best record, breaking a tie by the platform's read
// rule (points for, or head-to-head over the season's games between the
// tied teams); a tie no read rule breaks is answered open, with the best by
// points for standing in.
func (l chanceLeague) exactPick(wins, points map[int]float64) pickOne {
	return func(cands []int, kind string) (int, []int) {
		key := func(id int) float64 {
			if kind == SeedPoints {
				return points[id]
			}
			return wins[id]
		}
		top := cands[0]
		for _, id := range cands[1:] {
			if key(id) > key(top) {
				top = id
			}
		}
		var tied []int
		for _, id := range cands {
			if key(id) == key(top) {
				tied = append(tied, id)
			}
		}
		if len(tied) == 1 {
			return top, nil
		}
		standIn := l.replayPick(wins, points)
		if kind == SeedPoints {
			best, _ := standIn(tied, kind)
			return best, tied
		}
		switch l.tieRule {
		case TiebreakPointsFor:
			return l.unique(tied, func(id int) float64 { return points[id] })
		case TiebreakHeadToHead:
			return l.unique(tied, l.headToHead(tied))
		}
		best, _ := standIn(tied, kind)
		return best, tied
	}
}

// unique is the tied team with the highest score, open when the highest is
// shared.
func (l chanceLeague) unique(tied []int, score func(int) float64) (int, []int) {
	best := tied[0]
	for _, id := range tied[1:] {
		if score(id) > score(best) {
			best = id
		}
	}
	for _, id := range tied {
		if id != best && score(id) == score(best) {
			return best, tied
		}
	}
	return best, nil
}

// headToHead is each tied team's share of the games played between the
// tied teams this season, a win one and a tie a half.
func (l chanceLeague) headToHead(tied []int) func(int) float64 {
	won, played := map[int]float64{}, map[int]float64{}
	for _, g := range l.played {
		a, b := g.RosterIDs[0], g.RosterIDs[1]
		if !slices.Contains(tied, a) || !slices.Contains(tied, b) {
			continue
		}
		played[a]++
		played[b]++
		switch {
		case g.Points[0] > g.Points[1]:
			won[a]++
		case g.Points[1] > g.Points[0]:
			won[b]++
		default:
			won[a] += 0.5
			won[b] += 0.5
		}
	}
	return func(id int) float64 {
		if played[id] == 0 {
			return 0.5
		}
		return won[id] / played[id]
	}
}

// ahead reports a ahead of b for the seed in a replay.
func ahead(a, b int, seed string, wins, points map[int]float64) bool {
	if seed == SeedPoints {
		if points[a] != points[b] {
			return points[a] > points[b]
		}
		return wins[a] > wins[b]
	}
	if wins[a] != wins[b] {
		return wins[a] > wins[b]
	}
	return points[a] > points[b]
}

// proofs is the teams that have clinched a place and the teams that are
// out. None where the league holds its proofs (divisions unread, or
// several with no read of how they seat). With no game left, the settled
// field: every team is proven but those in a tie the platform's read rule
// does not break that straddles the cut. Mid-season, by record alone and
// only in a league without division winners: a team clinches when fewer
// teams than the seeds by record could reach its wins now; it is out,
// where every seed is by record, when the seeds' count of teams already
// have more wins than it could reach. A tie never proves anything.
func (l chanceLeague) proofs() (map[int]bool, map[int]bool) {
	clinched, out := map[int]bool{}, map[int]bool{}
	switch {
	case l.hold:
		return clinched, out
	case len(l.weeks) == 0:
		return l.settled()
	case l.division != nil:
		return clinched, out
	}
	left := map[int]float64{}
	for _, week := range l.weeks {
		for _, g := range week {
			for _, id := range g.rosters {
				left[id]++
			}
		}
	}
	byRecord := 0
	for _, s := range l.seeds {
		if s == SeedRecord {
			byRecord++
		}
	}
	for _, id := range l.ids {
		reach, above := 0, 0
		for _, o := range l.ids {
			if o == id {
				continue
			}
			if l.wins[o]+left[o] >= l.wins[id] {
				reach++
			}
			if l.wins[o] > l.wins[id]+left[id] {
				above++
			}
		}
		clinched[id] = byRecord > 0 && reach < byRecord
		out[id] = byRecord == len(l.seeds) && above >= len(l.seeds)
	}
	return clinched, out
}

// settled is the field once no game is left: in or out for every team but
// those in an open tie across the cut.
func (l chanceLeague) settled() (map[int]bool, map[int]bool) {
	made, open := l.pick(l.wins, l.points, true)
	unsure := map[int]bool{}
	for _, tied := range open {
		in := 0
		for _, id := range tied {
			if slices.Contains(made, id) {
				in++
			}
		}
		if in > 0 && in < len(tied) {
			for _, id := range tied {
				unsure[id] = true
			}
		}
	}
	clinched, out := map[int]bool{}, map[int]bool{}
	for _, id := range l.ids {
		if unsure[id] {
			continue
		}
		in := slices.Contains(made, id)
		clinched[id], out[id] = in, !in
	}
	return clinched, out
}
