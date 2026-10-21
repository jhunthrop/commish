package leaguerecord

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Ranking is one graded week of the weekly record in the member's own
// league (Lane 114): our set order and ESPN's projection, each graded on
// the league's rostered players by what they scored as the league scores,
// the measures the site's record grades with (research/nightly/reads/
// record.py): order matched, places off, and the starters each order
// called right in the league's lineup across its teams.
type Ranking struct {
	Players int
	Ours    Score
	ESPN    Score
}

// Score is one order's measures on a week's players.
type Score struct {
	// Agreement is Spearman's rank correlation with what they scored, to
	// two places; nil when the week cannot support one.
	Agreement *float64
	// PlacesOff is the mean distance in places between the order and the
	// finish, to a tenth; nil with no players.
	PlacesOff  *float64
	Starters   int
	StartersOf int
}

// Places the record prints each measure to (record.py AGREEMENT_PLACES,
// PLACES_OFF_PLACES).
const (
	agreementPlaces = 2
	placesOffPlaces = 1
)

// stanceOf is a ranking's view of a player: his value, higher first, and
// whether it has one at all (the fill rule ties every one it lacks below
// every one it has).
type stanceOf func(id string) (float64, bool)

func byRankValue(rank map[string]int) stanceOf {
	return func(id string) (float64, bool) {
		r, ok := rank[id]
		return -float64(r), ok
	}
}

func byPointsValue(points map[string]float64) stanceOf {
	return func(id string) (float64, bool) {
		p, ok := points[id]
		return p, ok
	}
}

// rank grades a week's league: every rostered candidate with a points
// split for the week (the record's rule, review M1: a player with no stat
// line is graded by neither, never counted as scoring none), ours by the
// set order and ESPN's by its projection, against the points.
func rank(cands []Candidate, ours map[string]int, espn map[string]float64, actual map[string]float64, shape leaguesync.Shape) Ranking {
	var played []Candidate
	for _, c := range cands {
		if _, ok := actual[c.ID]; ok {
			played = append(played, c)
		}
	}
	return Ranking{
		Players: len(played),
		Ours:    scoreOf(played, byRankValue(ours), ByRank(ours), actual, shape),
		ESPN:    scoreOf(played, byPointsValue(espn), ByPoints(espn), actual, shape),
	}
}

func scoreOf(cands []Candidate, stance stanceOf, order Stance, actual map[string]float64, shape leaguesync.Shape) Score {
	if len(cands) == 0 {
		return Score{}
	}
	ranks := filledRanks(cands, stance)
	points := make([]float64, len(cands))
	for i, c := range cands {
		points[i] = actual[c.ID]
	}
	finish := averageRanks(points)
	held := make([]float64, len(cands))
	off := 0.0
	for i, c := range cands {
		held[i] = -ranks[c.ID]
		off += math.Abs(ranks[c.ID] - finish[i])
	}
	places := roundTo(off/float64(len(cands)), placesOffPlaces)
	score := Score{PlacesOff: &places}
	if rho, ok := spearman(held, points); ok {
		v := roundTo(math.Max(-1, math.Min(1, rho)), agreementPlaces)
		score.Agreement = &v
	}
	score.Starters, score.StartersOf = startersRight(cands, stance, order, actual, shape)
	return score
}

// filledRanks is the record's fill rule: the players the order has a stance
// on in its order, 1 first, ties by id, and every one it has none on below
// them all, sharing their average place.
func filledRanks(cands []Candidate, stance stanceOf) map[string]float64 {
	type held struct {
		id    string
		value float64
	}
	var listed []held
	var missing []string
	for _, c := range cands {
		if v, ok := stance(c.ID); ok {
			listed = append(listed, held{c.ID, v})
		} else {
			missing = append(missing, c.ID)
		}
	}
	sort.Slice(listed, func(i, j int) bool {
		if listed[i].value != listed[j].value {
			return listed[i].value > listed[j].value
		}
		return listed[i].id < listed[j].id
	})
	out := make(map[string]float64, len(cands))
	for i, h := range listed {
		out[h.id] = float64(i + 1)
	}
	shared := float64(len(listed)+1+len(cands)) / 2
	for _, id := range missing {
		out[id] = shared
	}
	return out
}

// averageRanks is each value's place, highest first, ties sharing their
// average place.
func averageRanks(values []float64) []float64 {
	idx := make([]int, len(values))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return values[idx[a]] > values[idx[b]] })
	out := make([]float64, len(values))
	for start := 0; start < len(idx); {
		end := start
		for end+1 < len(idx) && values[idx[end+1]] == values[idx[start]] {
			end++
		}
		shared := float64(start+end)/2 + 1
		for k := start; k <= end; k++ {
			out[idx[k]] = shared
		}
		start = end + 1
	}
	return out
}

// spearman is Pearson's correlation on the average ranks of each side;
// false with fewer than two players or no spread on a side.
func spearman(x, y []float64) (float64, bool) {
	if len(x) < 2 {
		return 0, false
	}
	rx, ry := averageRanks(x), averageRanks(y)
	mean := func(v []float64) float64 {
		s := 0.0
		for _, e := range v {
			s += e
		}
		return s / float64(len(v))
	}
	mx, my := mean(rx), mean(ry)
	var sxy, sxx, syy float64
	for i := range rx {
		dx, dy := rx[i]-mx, ry[i]-my
		sxy += dx * dy
		sxx += dx * dx
		syy += dy * dy
	}
	if sxx == 0 || syy == 0 {
		return 0, false
	}
	return sxy / math.Sqrt(sxx*syy), true
}

// startersRight fills the league's starting slots across its teams twice,
// by the order (only the players it ranks) and by what they scored, and
// counts the players in both, of the starters the finish fills.
func startersRight(cands []Candidate, stance stanceOf, order Stance, actual map[string]float64, shape leaguesync.Shape) (int, int) {
	teams := max(1, shape.Teams)
	all := leaguesync.Shape{
		QB: shape.QB * teams, RB: shape.RB * teams, WR: shape.WR * teams, TE: shape.TE * teams,
		Flex: shape.Flex * teams, SuperFlex: shape.SuperFlex * teams,
	}
	var ranked []Candidate
	for _, c := range cands {
		if _, ok := stance(c.ID); ok {
			ranked = append(ranked, c)
		}
	}
	finished := Lineup(cands, all, ByPoints(actual))
	called := map[string]bool{}
	for _, id := range Lineup(ranked, all, order) {
		called[id] = true
	}
	right := 0
	for _, id := range finished {
		if called[id] {
			right++
		}
	}
	return right, len(finished)
}

// roundTo rounds as the record prints (record.py printed): half away from
// zero on the value's shortest decimal form, so 0.285 is 0.29 although its
// binary double sits just below it.
func roundTo(v float64, places int) float64 {
	text := strconv.FormatFloat(math.Abs(v), 'f', -1, 64)
	whole, frac, _ := strings.Cut(text, ".")
	if len(frac) <= places {
		return v
	}
	kept := whole + frac[:places]
	n, err := strconv.ParseInt(kept, 10, 64)
	if err != nil {
		step := math.Pow(10, float64(places))
		return math.Round(v*step) / step
	}
	if frac[places] >= '5' {
		n++
	}
	out := float64(n) / math.Pow(10, float64(places))
	if v < 0 {
		return -out
	}
	return out
}
