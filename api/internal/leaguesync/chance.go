package leaguesync

import (
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
)

// Playoff chance (Lane 298, ruling 3): the schedule left replayed
// ChanceRuns times, each team's score in a week drawn around its season
// rate (its points for over the weeks it has played) with the league's own
// week-to-week spread of scores about those rates, then the playoff field
// picked by the host's seeds. No projection of ours or the platform's is
// used for a week to come, so no weekly number is called ours.
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
// rate, the spread, the weeks left and the seeds.
type chanceLeague struct {
	ids    []int
	wins   map[int]float64
	points map[int]float64
	rate   map[int]float64
	spread float64
	weeks  [][]chanceGame
	seeds  []string
}

// PlayoffChances is the league's playoff chance for every team, false where
// it has none: no playoff seats read, a regular season the schedule does
// not cover, or fewer than chanceMinWeeks weeks played.
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

// chanceLeagueOf reads the replay's inputs from the read.
func chanceLeagueOf(snap Snapshot) (chanceLeague, bool) {
	seeds, last := seedsOf(snap), RegularSeasonLast(snap)
	if len(seeds) == 0 || last == 0 || len(snap.Teams) < 2 || !covers(snap.Schedule, last) {
		return chanceLeague{}, false
	}
	l := chanceLeague{wins: map[int]float64{}, points: map[int]float64{}, rate: map[int]float64{}, seeds: seeds}
	played := playedWeeks(snap.Schedule, last)
	for _, t := range snap.Teams {
		if played[t.RosterID] < chanceMinWeeks {
			return chanceLeague{}, false
		}
		l.ids = append(l.ids, t.RosterID)
		l.wins[t.RosterID] = float64(t.Wins) + float64(t.Ties)/2
		l.points[t.RosterID] = t.PointsFor
		l.rate[t.RosterID] = t.PointsFor / float64(played[t.RosterID])
	}
	spread, ok := spreadOf(snap.Schedule, last, l.rate)
	if !ok {
		return chanceLeague{}, false
	}
	l.spread = spread
	l.weeks = weeksLeft(snap.Schedule, last)
	return l, true
}

// covers reports a schedule with games in every week of the regular
// season.
func covers(games []ScheduledGame, last int) bool {
	has := map[int]bool{}
	for _, g := range games {
		has[g.Week] = true
	}
	for week := 1; week <= last; week++ {
		if !has[week] {
			return false
		}
	}
	return true
}

// playedWeeks is how many final regular-season weeks each team has a game
// in.
func playedWeeks(games []ScheduledGame, last int) map[int]int {
	seen := map[[2]int]bool{}
	out := map[int]int{}
	for _, g := range games {
		if !g.Final || g.Week > last {
			continue
		}
		for _, id := range g.RosterIDs {
			if !seen[[2]int{g.Week, id}] {
				seen[[2]int{g.Week, id}] = true
				out[id]++
			}
		}
	}
	return out
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
		for _, id := range field(l.ids, l.seeds, wins, points) {
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

// field is the playoff teams by the seeds: each seed by record takes the
// best record left, ties by points for; each by points the most points
// left.
func field(ids []int, seeds []string, wins, points map[int]float64) []int {
	left := append([]int(nil), ids...)
	out := make([]int, 0, len(seeds))
	for _, seed := range seeds {
		best := 0
		for i := 1; i < len(left); i++ {
			if ahead(left[i], left[best], seed, wins, points) {
				best = i
			}
		}
		out = append(out, left[best])
		left = append(left[:best], left[best+1:]...)
	}
	return out
}

// ahead reports a ahead of b for the seed.
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
// out, by record alone. A team clinches when fewer teams than the seeds
// by record could reach its wins now; it is out, where every seed is by
// record, when the seeds' count of teams already have more wins than it
// could reach. With no game left the field is settled for every team.
func (l chanceLeague) proofs() (map[int]bool, map[int]bool) {
	left := map[int]float64{}
	for _, week := range l.weeks {
		for _, g := range week {
			for _, id := range g.rosters {
				left[id]++
			}
		}
	}
	clinched, out := map[int]bool{}, map[int]bool{}
	if len(l.weeks) == 0 {
		made := map[int]bool{}
		for _, id := range field(l.ids, l.seeds, l.wins, l.points) {
			made[id] = true
		}
		for _, id := range l.ids {
			clinched[id], out[id] = made[id], !made[id]
		}
		return clinched, out
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

// tiebreakWords is a host tie rule the replays do not follow, in the
// member's words.
var tiebreakWords = map[string]string{
	TiebreakHeadToHead:     "head-to-head",
	TiebreakPointsAgainst:  "points against",
	TiebreakDivisionRecord: "division record",
}

// chanceBasis is the figure's sentence: the replays, the model, the rules
// read.
func chanceBasis(snap Snapshot) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Playoff chance from %s replays of the schedule left, each team at its season rate, scores varying week to week as this league's have. ",
		thousands(ChanceRuns))
	b.WriteString(capital(seedWords(seedsOf(snap))))
	b.WriteString(", ties by points for")
	if words, ok := tiebreakWords[snap.Terms.Tiebreak]; ok {
		fmt.Fprintf(&b, " in place of the platform's %s rule", words)
	}
	b.WriteString(". Only a clinched place reads 100 and only a team that is out reads 0.")
	if snap.Ref.Host != HostFFPC {
		b.WriteString(" Divisions are not counted.")
	}
	return b.String()
}

// capital is s with its first letter a capital.
func capital(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// seedWords says how the field is picked.
func seedWords(seeds []string) string {
	var record, points []string
	for i, s := range seeds {
		if s == SeedPoints {
			points = append(points, fmt.Sprint(i+1))
		} else {
			record = append(record, fmt.Sprint(i+1))
		}
	}
	if len(points) == 0 {
		return fmt.Sprintf("the top %d by record make it", len(seeds))
	}
	return fmt.Sprintf("seeds %s by record and %s by points for make it", and(record), and(points))
}

// and lists items as "1, 3 and 5".
func and(items []string) string {
	if len(items) < 2 {
		return strings.Join(items, "")
	}
	return strings.Join(items[:len(items)-1], ", ") + " and " + items[len(items)-1]
}

// thousands is n with a comma at the thousands.
func thousands(n int) string {
	if n < 1000 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%d,%03d", n/1000, n%1000)
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
