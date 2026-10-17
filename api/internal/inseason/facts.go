package inseason

import (
	"fmt"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// lastGamesShown is how many completed games a row carries.
const lastGamesShown = 3

// allowedPositions are the positions a defense's points allowed are
// ranked at.
func allowedPositions() []draft.Position {
	return []draft.Position{draft.QB, draft.RB, draft.WR, draft.TE, draft.K}
}

// Data is the season's facts as the reads answer them.
type Data struct {
	Lines        []boards.StatLine
	Games        []boards.TeamWeek
	Designations map[string]boards.Designation
	// GameFacts is each club-week's figures, forecast and venue.
	GameFacts map[boards.ClubWeek]boards.GameFact
}

// GamePoints is one completed game's points under the league's scoring.
type GamePoints struct {
	Week   int
	Points float64
}

// Allowed is the points a defense has allowed to a position this season
// under the league's scoring, a game, and its rank: 1 is the fewest.
type Allowed struct {
	PointsAGame float64
	Rank        int
	Of          int
	Position    draft.Position
}

// Designation is a player's designation in the contract's words and its
// stamp.
type Designation struct {
	Status string
	AsOf   time.Time
}

// Facts is one player's week (spec §3, WeekFacts). A fact we do not hold
// is absent, never zero.
type Facts struct {
	Week        int
	Opponent    string
	Home        *bool
	Kickoff     *time.Time
	Bye         bool
	Designation *Designation
	// Played is his game this week being final; Locked his game having
	// kicked off by the run's clock.
	Played bool
	Locked bool
	// LastGames is up to three completed games, newest first.
	LastGames []GamePoints
	// PerGame is his points a game over every completed game this season.
	PerGame *float64
	Allowed *Allowed
	// Game is his club's game facts this week, empty without a game.
	Game boards.GameFact
}

// Tier is §4.2's first two keys for the facts.
func (f Facts) Tier() Tier {
	if f.Bye {
		return Out
	}
	if f.Designation == nil {
		return Available
	}
	switch f.Designation.Status {
	case boards.StatusDoubtful:
		return Doubtful
	case boards.StatusQuestionable:
		return Available
	}
	return Out
}

// InjuredReserve is a player listed on injured reserve.
func (f Facts) InjuredReserve() bool {
	return f.Designation != nil && f.Designation.Status == boards.StatusInjuredReserve
}

type teamWeek struct {
	week int
	team string
}

type teamPosition struct {
	team     string
	position draft.Position
}

// Season is the season's facts indexed for one league's scoring and one
// week at one instant.
type Season struct {
	week         int
	now          time.Time
	games        map[teamWeek]boards.TeamWeek
	scheduled    map[string]bool
	weekHasGames bool
	points       map[string][]GamePoints
	allowed      map[teamPosition]Allowed
	// carried is every metric a counted line carries.
	carried      map[string]bool
	designations map[string]boards.Designation
	gameFacts    map[boards.ClubWeek]boards.GameFact
}

// NewSeason indexes the data for the league's rules, the week and now.
func NewSeason(d Data, rules Rules, week int, now time.Time) *Season {
	s := &Season{week: week, now: now, games: map[teamWeek]boards.TeamWeek{}, scheduled: map[string]bool{},
		points: map[string][]GamePoints{}, designations: d.Designations, gameFacts: d.GameFacts}
	for _, g := range d.Games {
		s.games[teamWeek{g.Week, g.Team}] = g
		s.scheduled[g.Team] = true
		if g.Week == week {
			s.weekHasGames = true
		}
	}
	sums := map[teamPosition]float64{}
	lined := map[draft.Position]bool{}
	s.carried = map[string]bool{}
	results := positionsWithResults(d.Lines)
	for _, l := range d.Lines {
		g, known := s.games[teamWeek{l.Week, l.Team}]
		position := draft.Position(l.Position)
		if (l.Team != "" && (!known || !g.Final)) || !results[position] {
			continue
		}
		pts := rules.Points(l.Metrics, position)
		s.points[l.PlayerID] = append(s.points[l.PlayerID], GamePoints{Week: l.Week, Points: pts})
		lined[position] = true
		for m := range l.Metrics {
			s.carried[m] = true
		}
		if known {
			sums[teamPosition{g.Opponent, position}] += pts
		}
	}
	for id := range s.points {
		sort.Slice(s.points[id], func(i, j int) bool { return s.points[id][i].Week < s.points[id][j].Week })
	}
	s.allowed = rankAllowed(sums, finalGames(d.Games), lined)
	return s
}

// Carries reports whether any line counted this season carries the
// metric: a rule whose metric none carries scores nothing in points so far.
func (s *Season) Carries(metric string) bool { return s.carried[metric] }

// resultMetrics is the metrics a kicker's or a defense's results are
// read from: the player-week store writes a kicker's kicking as zeros and
// holds no defense, so a position whose lines carry none of these above
// zero all season holds no results, never a row of zeros.
func resultMetrics() map[draft.Position][]string {
	return map[draft.Position][]string{
		draft.K: {"field_goals_made", "extra_points_made", "field_goals_missed", "extra_points_missed"},
		draft.DEF: {"sacks", "defensive_interceptions", "defensive_touchdowns", "defensive_fumbles_recovered", "safeties",
			metricPointsAllowed, metricYardsAllowed},
	}
}

// positionsWithResults is the positions whose lines are results: every
// position but a kicker or defense, and those when a line carries one of
// their result metrics above zero (a defense allowing points counts).
func positionsWithResults(lines []boards.StatLine) map[draft.Position]bool {
	out := map[draft.Position]bool{}
	gated := resultMetrics()
	for _, l := range lines {
		position := draft.Position(l.Position)
		metrics, isGated := gated[position]
		if !isGated {
			out[position] = true
			continue
		}
		for _, m := range metrics {
			if l.Metrics[m] > 0 {
				out[position] = true
				break
			}
		}
	}
	return out
}

// finalGames is each club's count of final games.
func finalGames(games []boards.TeamWeek) map[string]int {
	out := map[string]int{}
	for _, g := range games {
		if g.Final {
			out[g.Team]++
		}
	}
	return out
}

// rankAllowed is each defense's points allowed a game at each position
// the season holds results for, ranked among the defenses with a final
// game: 1 allowed the fewest. A position with no counted line is not
// ranked, so no rank is read from zeros.
func rankAllowed(sums map[teamPosition]float64, games map[string]int, lined map[draft.Position]bool) map[teamPosition]Allowed {
	out := map[teamPosition]Allowed{}
	teams := make([]string, 0, len(games))
	for team, n := range games {
		if n > 0 {
			teams = append(teams, team)
		}
	}
	sort.Strings(teams)
	for _, position := range allowedPositions() {
		if !lined[position] {
			continue
		}
		type row struct {
			team    string
			perGame float64
		}
		rows := make([]row, 0, len(teams))
		for _, team := range teams {
			rows = append(rows, row{team, sums[teamPosition{team, position}] / float64(games[team])})
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].perGame < rows[j].perGame })
		for i, r := range rows {
			out[teamPosition{r.team, position}] = Allowed{PointsAGame: roundTenth(r.perGame), Rank: i + 1, Of: len(rows), Position: position}
		}
	}
	return out
}

// Player is who a row is about, as the facts need him.
type Player struct {
	BoardID  string
	Team     string
	Position draft.Position
	// HostIR is the host's own IR mark beside his name, read at ReadAt.
	HostIR bool
	ReadAt time.Time
}

// For is one player's facts.
func (s *Season) For(p Player) Facts {
	f := Facts{Week: s.week, Designation: s.designation(p)}
	if p.Team != "" {
		if g, ok := s.games[teamWeek{s.week, p.Team}]; ok {
			home, kickoff := g.Home, g.Kickoff
			f.Opponent, f.Home, f.Kickoff, f.Played = g.Opponent, &home, &kickoff, g.Final
			f.Locked = g.Final || !s.now.Before(g.Kickoff)
			f.Game = figuresAt(s.gameFacts[boards.ClubWeek{Week: s.week, Team: p.Team}], s.now, g.Kickoff)
			if a, ok := s.allowed[teamPosition{g.Opponent, p.Position}]; ok {
				f.Allowed = &a
			}
		} else {
			f.Bye = s.weekHasGames && s.scheduled[p.Team]
		}
	}
	games := s.points[p.BoardID]
	if len(games) > 0 {
		total := 0.0
		for _, g := range games {
			total += g.Points
		}
		perGame := roundTenth(total / float64(len(games)))
		f.PerGame = &perGame
	}
	for i := len(games) - 1; i >= 0 && len(f.LastGames) < lastGamesShown; i-- {
		f.LastGames = append(f.LastGames, games[i])
	}
	return f
}

// designation is the newest capture's designation for him, else the
// host's IR mark at the read.
func (s *Season) designation(p Player) *Designation {
	if d, ok := s.designations[p.BoardID]; ok && p.BoardID != "" {
		if status := boards.StatusOf(d.Code); status != "" {
			return &Designation{Status: status, AsOf: d.AsOf}
		}
	}
	if p.HostIR {
		return &Designation{Status: boards.StatusInjuredReserve, AsOf: p.ReadAt}
	}
	return nil
}

// String names the facts for a test's failure.
func (f Facts) String() string {
	return fmt.Sprintf("week %d opp %q bye %v played %v locked %v games %v", f.Week, f.Opponent, f.Bye, f.Played, f.Locked, f.LastGames)
}
