package leaguesync

import (
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
	"sync"
)

// Playoff chance (Lane 298, ruling 3): the schedule left replayed
// ChanceRuns times, each team's score in a week drawn around its season
// rate (its mean over the weeks the schedule scores) with the league's own
// week-to-week spread of scores about those rates, then the playoff field
// picked by the platform's seeds and, where read, its division winners. No
// projection of ours or the platform's is used for a week to come, so no
// weekly number is called ours. 100 and 0 are printed only when proven
// (fix round 1: never where the league's divisions or tie rule leave the
// proof open).
const (
	// ChanceRuns is how many times the schedule left is replayed.
	ChanceRuns = 2000
	// chanceMinWeeks is the played weeks a rate and a spread need.
	chanceMinWeeks = 3
	// chanceCacheSize bounds the reads whose figures are kept.
	chanceCacheSize = 512
)

// Chances is each team's playoff chance by roster id, a percent, and the
// sentence that says how it was reckoned.
type Chances struct {
	ByRoster map[int]int
	Basis    string
}

// chanceGame is one game left as the replay plays it.
type chanceGame struct {
	rosters []int
	against string
}

// chanceLeague is what a replay reads: the standings now, each team's
// rate, the spread, the weeks left, the seeds, the divisions and the tie
// rule.
type chanceLeague struct {
	ids    []int
	wins   map[int]float64
	points map[int]float64
	rate   map[int]float64
	spread float64
	weeks  [][]chanceGame
	seeds  []string
	// division is each team's division where the platform seats each
	// division's winner (Terms.DivisionWinners), nil otherwise.
	division map[int]int
	// hold says no team may read 100 or 0: the league's divisions are not
	// read, or it has several and whether their winners are seated is not.
	hold bool
	// tieRule is the platform's own tie rule as read, empty where unread.
	tieRule string
	// played is the season's final head-to-head games, for a tie the
	// platform breaks head-to-head.
	played []ScheduledGame
}

// PlayoffChances is the league's playoff chance for every team, false where
// it has none: no playoff seats read, a regular season the schedule does
// not cover, fewer than chanceMinWeeks weeks scored, or standings and
// schedule that disagree on the games played (fix round 1, M3).
func PlayoffChances(snap Snapshot) (Chances, bool) {
	l, ok := chanceLeagueOf(snap)
	if !ok {
		return Chances{}, false
	}
	made := l.replay(rand.New(rand.NewPCG(seedOf(snap.Ref.Key()), uint64(snap.Week))))
	clinched, out := l.proofs()
	byRoster := make(map[int]int, len(l.ids))
	for _, id := range l.ids {
		pct := int(math.Round(100 * float64(made[id]) / ChanceRuns))
		switch {
		case clinched[id]:
			pct = 100
		case out[id]:
			pct = 0
		default:
			pct = min(max(pct, 1), 99)
		}
		byRoster[id] = pct
	}
	return Chances{ByRoster: byRoster, Basis: chanceBasis(snap)}, true
}

// seedOf is the replays' seed for a league: the same league replays the
// same draws.
func seedOf(key string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	return h.Sum64()
}

// seedsOf is the host's seeding, seed by seed: its own where it states
// one, else its playoff teams all by record; none where it states
// neither, or seats every team.
func seedsOf(snap Snapshot) []string {
	seeds := snap.Terms.Seeds
	if len(seeds) == 0 && snap.Terms.PlayoffTeams > 0 {
		seeds = make([]string, snap.Terms.PlayoffTeams)
		for i := range seeds {
			seeds[i] = SeedRecord
		}
	}
	if len(seeds) >= len(snap.Teams) {
		return nil
	}
	return seeds
}

// divisional reports a league of several divisions whose winners the
// platform's rules seat, as read.
func divisional(t Terms) bool { return t.Divisions > 1 && t.DivisionWinners }

// holdsProof reports a league where no team may read 100 or 0: its
// divisions unread, or several of them with no read of how they seat.
func holdsProof(t Terms) bool {
	return !t.DivisionsRead || (t.Divisions > 1 && !t.DivisionWinners)
}

// chanceLeagueOf reads the replay's inputs from the read.
func chanceLeagueOf(snap Snapshot) (chanceLeague, bool) {
	seeds, last := seedsOf(snap), RegularSeasonLast(snap)
	first := max(snap.Terms.StartWeek, 1)
	if len(seeds) == 0 || last < first || len(snap.Teams) < 2 || !covers(snap.Schedule, first, last) ||
		Disagreement(snap, snap.Schedule) != 0 {
		return chanceLeague{}, false
	}
	l := chanceLeague{wins: map[int]float64{}, points: map[int]float64{}, seeds: seeds,
		hold: holdsProof(snap.Terms), tieRule: snap.Terms.Tiebreak}
	rate, scored := ratesOf(snap.Schedule, last)
	for _, t := range snap.Teams {
		if scored[t.RosterID] < chanceMinWeeks {
			return chanceLeague{}, false
		}
		l.ids = append(l.ids, t.RosterID)
		l.wins[t.RosterID] = float64(t.Wins) + float64(t.Ties)/2
		l.points[t.RosterID] = t.PointsFor
	}
	l.rate = rate
	if divisional(snap.Terms) {
		l.division = map[int]int{}
		for _, t := range snap.Teams {
			l.division[t.RosterID] = t.Division
		}
	}
	spread, ok := spreadOf(snap.Schedule, last, l.rate)
	if !ok {
		return chanceLeague{}, false
	}
	l.spread = spread
	l.weeks = weeksLeft(snap.Schedule, last)
	for _, g := range snap.Schedule {
		if g.Final && g.Scored() && g.HeadToHead() && g.Week <= last {
			l.played = append(l.played, g)
		}
	}
	return l, true
}

// covers reports a schedule with games in every week of the regular
// season, from its first week to its last.
func covers(games []ScheduledGame, first, last int) bool {
	has := map[int]bool{}
	for _, g := range games {
		has[g.Week] = true
	}
	for week := first; week <= last; week++ {
		if !has[week] {
			return false
		}
	}
	return true
}

// ratesOf is each team's season rate, its mean score over the final
// regular-season weeks the schedule scores (M3: the schedule's own scores,
// never the standings' points for over a count of weeks it may not share),
// and how many such weeks each team has.
func ratesOf(games []ScheduledGame, last int) (map[int]float64, map[int]int) {
	sum, n := map[int]float64{}, map[int]int{}
	for _, week := range Weeks(games) {
		if week > last {
			continue
		}
		for id, score := range WeekScores(games, week) {
			sum[id] += score
			n[id]++
		}
	}
	rate := make(map[int]float64, len(sum))
	for id, s := range sum {
		rate[id] = s / float64(n[id])
	}
	return rate, n
}

// gamesCounted is whether a game counts in a team's record: a game against
// another team, the median, the average or the field; a bye does not.
func gamesCounted(g ScheduledGame) bool {
	return g.Against != AgainstTeam || len(g.RosterIDs) == 2
}

// Disagreement is the first regular-season week at which the schedule and
// the platform's standings stop agreeing on the games each team has played
// (wins, losses and ties), 0 when they agree. The standings win: a final
// week past a team's record is read again, and a played week the schedule
// has not scored final, which the standings already count, is read again
// (M3). Nothing is reckoned on a schedule that disagrees.
func Disagreement(snap Snapshot, games []ScheduledGame) int {
	last := RegularSeasonLast(snap)
	if last == 0 {
		last = snap.Week
	}
	record := map[int]int{}
	for _, t := range snap.Teams {
		record[t.RosterID] = t.Wins + t.Losses + t.Ties
	}
	count := map[int]int{}
	pending := 0
	for _, week := range Weeks(games) {
		if week > last {
			break
		}
		for _, g := range games {
			if g.Week != week || !gamesCounted(g) {
				continue
			}
			for _, id := range g.RosterIDs {
				if !g.Final {
					if pending == 0 && playedBefore(snap, week) {
						pending = week
					}
					continue
				}
				count[id]++
				if want, ok := record[id]; ok && count[id] > want {
					return week
				}
			}
		}
	}
	for id, want := range record {
		if count[id] < want {
			if pending == 0 {
				return last
			}
			return pending
		}
	}
	return 0
}

// spreadOf is the league's week-to-week spread: the pooled deviation of
// every scored team-week from that team's rate. false with no more scored
// team-weeks than teams.
func spreadOf(games []ScheduledGame, last int, rate map[int]float64) (float64, bool) {
	var sum float64
	n := 0
	for _, week := range Weeks(games) {
		if week > last {
			continue
		}
		for id, score := range WeekScores(games, week) {
			r, ok := rate[id]
			if !ok {
				continue
			}
			sum += (score - r) * (score - r)
			n++
		}
	}
	if n <= len(rate) {
		return 0, false
	}
	return math.Sqrt(sum / float64(n-len(rate))), true
}

// weeksLeft is the regular season's games not yet final, week by week.
func weeksLeft(games []ScheduledGame, last int) [][]chanceGame {
	byWeek := map[int][]chanceGame{}
	for _, g := range games {
		if g.Final || g.Week > last {
			continue
		}
		byWeek[g.Week] = append(byWeek[g.Week], chanceGame{rosters: g.RosterIDs, against: g.Against})
	}
	weeks := make([]int, 0, len(byWeek))
	for w := range byWeek {
		weeks = append(weeks, w)
	}
	sort.Ints(weeks)
	out := make([][]chanceGame, 0, len(weeks))
	for _, w := range weeks {
		out = append(out, byWeek[w])
	}
	return out
}

// replay plays the weeks left ChanceRuns times and counts each team's
// places in the field.
func (l chanceLeague) replay(rng *rand.Rand) map[int]int {
	made := map[int]int{}
	wins, points := map[int]float64{}, map[int]float64{}
	for range ChanceRuns {
		for _, id := range l.ids {
			wins[id], points[id] = l.wins[id], l.points[id]
		}
		for _, week := range l.weeks {
			l.playWeek(rng, week, wins, points)
		}
		for _, id := range l.field(wins, points) {
			made[id]++
		}
	}
	return made
}

// playWeek draws each team's score in the week once and settles every
// game of the week by it.
func (l chanceLeague) playWeek(rng *rand.Rand, week []chanceGame, wins, points map[int]float64) {
	score := map[int]float64{}
	for _, g := range week {
		for _, id := range g.rosters {
			if _, ok := score[id]; !ok {
				score[id] = l.rate[id] + l.spread*rng.NormFloat64()
			}
		}
	}
	for id, s := range score {
		points[id] += s
	}
	marks := map[string]float64{}
	for _, g := range week {
		switch {
		case g.against == AgainstTeam && len(g.rosters) == 2:
			a, b := g.rosters[0], g.rosters[1]
			settleGame(wins, a, score[a], score[b])
			settleGame(wins, b, score[b], score[a])
		case g.against == AgainstMedian || g.against == AgainstAverage || g.against == AgainstField:
			mark, ok := marks[g.against]
			if !ok {
				mark = markOf(g.against, score)
				marks[g.against] = mark
			}
			for _, id := range g.rosters {
				settleGame(wins, id, score[id], mark)
			}
		}
	}
}

// settleGame gives a win for a score above the mark, half for one level.
func settleGame(wins map[int]float64, id int, score, mark float64) {
	switch {
	case score > mark:
		wins[id]++
	case score == mark:
		wins[id] += 0.5
	}
}

// markOf is the score a game against the week beats: its median, its
// average, or for an all-play week the lowest score of the top half, so a
// tie at the cut wins as FFPC's rules say. The mark is lowered a hair for
// the field so the score at the cut is above it.
func markOf(against string, score map[int]float64) float64 {
	vals := make([]float64, 0, len(score))
	sum := 0.0
	for _, s := range score {
		vals = append(vals, s)
		sum += s
	}
	sort.Float64s(vals)
	n := len(vals)
	switch against {
	case AgainstAverage:
		return sum / float64(n)
	case AgainstField:
		return math.Nextafter(vals[n-n/2], math.Inf(-1))
	}
	if n%2 == 1 {
		return vals[n/2]
	}
	return (vals[n/2-1] + vals[n/2]) / 2
}

// chanceCache keeps each read's figures, so a read is replayed once
// whatever the number of views (ruling 3).
type chanceCache struct {
	mu   sync.Mutex
	kept map[string]chanceEntry
}

type chanceEntry struct {
	chances Chances
	ok      bool
}

// of is the read's figures, replayed on the first ask.
func (c *chanceCache) of(snap Snapshot) (Chances, bool) {
	key := snap.Ref.Key() + "|" + snap.ReadAt.UTC().String()
	c.mu.Lock()
	e, hit := c.kept[key]
	c.mu.Unlock()
	if hit {
		return e.chances, e.ok
	}
	chances, ok := PlayoffChances(snap)
	c.mu.Lock()
	if c.kept == nil || len(c.kept) >= chanceCacheSize {
		c.kept = map[string]chanceEntry{}
	}
	c.kept[key] = chanceEntry{chances: chances, ok: ok}
	c.mu.Unlock()
	return chances, ok
}
