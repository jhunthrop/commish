package inseason

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguerecord"
)

// Lane 292: the League screen's figures.

// The gap is the first side's printed projection less the second's, to
// the tenth; a lone side or a side with no projection has none.
func TestProjectionGapOnAFixedPairOfLineups(t *testing.T) {
	pair := []apitypes.ScoreboardSide{{Projection: proj(104.3)}, {Projection: proj(97.9)}}
	if got := projectionGap(pair); got == nil || *got != 6.4 {
		t.Fatalf("gap %v, want 6.4", got)
	}
	behind := []apitypes.ScoreboardSide{{Projection: proj(88.1)}, {Projection: proj(101.6)}}
	if got := projectionGap(behind); got == nil || *got != -13.5 {
		t.Fatalf("gap %v, want -13.5", got)
	}
	for _, sides := range [][]apitypes.ScoreboardSide{
		{{Projection: proj(90)}},
		{{Projection: proj(90)}, {}},
		{{}, {Projection: proj(90)}},
	} {
		if got := projectionGap(sides); got != nil {
			t.Errorf("gap %v for %+v, want none", *got, sides)
		}
	}
}

// The synthetic 12-team league of Lane 287: every team a little weaker the
// later it comes, team 0 with no quarterback worth starting. The standard
// lineup ranks QB, RB, WR, TE and the flex, never the kicker or defense;
// team 0 is last at quarterback, and teams 2 to 11 rank in their order.
func TestPowerRanksTheSyntheticLeague(t *testing.T) {
	l, squads := syntheticLeague(standardConfig, noQB(10), 10)
	columns := l.PowerColumns()
	want := []apitypes.LeaguePowerColumn{apitypes.LeaguePowerColumnQB, apitypes.LeaguePowerColumnRB,
		apitypes.LeaguePowerColumnWR, apitypes.LeaguePowerColumnTE, apitypes.LeaguePowerColumnFLEX}
	if !reflect.DeepEqual(columns, want) {
		t.Fatalf("columns %v, want %v", columns, want)
	}
	teams := make([]PowerTeam, len(squads))
	for i, s := range squads {
		teams[i] = l.Power(i, s.Players)
	}
	got := PowerRanks(columns, teams)
	if len(got) != 12 {
		t.Fatalf("%d teams ranked", len(got))
	}
	byRoster := map[int]apitypes.LeaguePowerTeam{}
	for _, team := range got {
		byRoster[team.RosterId] = team
	}
	if qb := byRoster[0].Ranks[0]; qb != 12 {
		t.Errorf("team 0 at quarterback %d, want 12", qb)
	}
	for i := 3; i < 12; i++ {
		if byRoster[i].Rank <= byRoster[i-1].Rank {
			t.Errorf("team %d overall %d, team %d %d: want the later team below", i, byRoster[i].Rank, i-1, byRoster[i-1].Rank)
		}
	}
	for i := 1; i < len(got); i++ {
		if got[i].Rank < got[i-1].Rank {
			t.Fatalf("not in rank order: %+v", got)
		}
	}
}

// A superflex league ranks its superflex too, after the flex.
func TestPowerRanksTheSuperflex(t *testing.T) {
	l, _ := syntheticLeague(superflexConfig, leagueTeam(0, 10), 10)
	columns := l.PowerColumns()
	if len(columns) != 6 || columns[5] != apitypes.LeaguePowerColumnSUPERFLEX {
		t.Fatalf("columns %v", columns)
	}
}

// A tie at the printed tenth shares its place and the next place is
// skipped; the teams come back in rank order, ties by roster id.
func TestPowerRanksShareATie(t *testing.T) {
	columns := []apitypes.LeaguePowerColumn{apitypes.LeaguePowerColumnQB, apitypes.LeaguePowerColumnRB}
	teams := []PowerTeam{
		{RosterID: 4, Columns: []float64{10, 30.04}, Total: 40.04},
		{RosterID: 2, Columns: []float64{10.01, 30}, Total: 40.01},
		{RosterID: 9, Columns: []float64{20, 5}, Total: 25},
	}
	got := PowerRanks(columns, teams)
	want := []apitypes.LeaguePowerTeam{
		{RosterId: 2, Rank: 1, Ranks: []int{2, 1}},
		{RosterId: 4, Rank: 1, Ranks: []int{2, 1}},
		{RosterId: 9, Rank: 3, Ranks: []int{1, 3}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// Through the route: the scoreboard answers every team's power once, the
// ranks within the league's size, its sentence naming the weeks, and the
// gap of the drafter's game from its sides' projections with its sentence.
func TestScoreboardAnswersPowerAndTheGap(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Facts = fakeFacts{data: f.data, projection: weekProjection(f)}
	board := scoreboardOf(t, s)
	if board.ProjectionGapBasis == nil || *board.ProjectionGapBasis != ProjectionGapBasis {
		t.Errorf("gap basis %v", board.ProjectionGapBasis)
	}
	mine := board.Games[0]
	if mine.Sides[0].Projection == nil || mine.Sides[1].Projection == nil {
		t.Fatalf("the fixture's game has a side with no projection: %+v", mine.Sides)
	}
	if mine.ProjectionGap == nil || *mine.ProjectionGap != roundTenth(*mine.Sides[0].Projection-*mine.Sides[1].Projection) {
		t.Errorf("gap %v for %+v", mine.ProjectionGap, mine.Sides)
	}
	if alone := board.Games[1]; alone.ProjectionGap != nil {
		t.Errorf("a lone side's gap %v", *alone.ProjectionGap)
	}
	if board.Power == nil {
		t.Fatal("no power")
	}
	if !strings.HasPrefix(board.Power.Basis, "Power ranks each team's best lineup by our order") || strings.Contains(board.Power.Basis, "%") {
		t.Errorf("basis %q", board.Power.Basis)
	}
	var ids []int
	for _, team := range board.Power.Teams {
		ids = append(ids, team.RosterId)
		if team.Rank < 1 || team.Rank > len(f.league.Snap.Teams) || len(team.Ranks) != len(board.Power.Columns) {
			t.Errorf("team %+v", team)
		}
	}
	var want []int
	for _, team := range f.league.Snap.Teams {
		want = append(want, team.RosterID)
	}
	slices.Sort(ids)
	slices.Sort(want)
	if !slices.Equal(ids, want) {
		t.Errorf("ranked %v, want every team %v", ids, want)
	}
}

// The record route answers each week's set lineup and the member's start
// and sit record over the weeks that carry one, with its sentence; a week
// without one carries no field.
func TestLeagueRecordAnswersTheStartSitRecord(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Records = &fakeRecords{weeks: []leaguerecord.Week{
		{Week: 7, Benchmark: leaguerecord.BenchmarkESPN, Ours: 97, Theirs: 70, Margin: 27, Set: &leaguerecord.SetLineup{Points: 87, Matched: false}},
		{Week: 8, Benchmark: leaguerecord.BenchmarkESPN, Ours: 90, Theirs: 91, Margin: -1, Set: &leaguerecord.SetLineup{Points: 90, Matched: true}},
		{Week: 9, Benchmark: leaguerecord.BenchmarkPublished, Ours: 80, Theirs: 82, Margin: -2},
	}}
	code, env := serve(t, s, leaguePath+"record")
	if code != http.StatusOK {
		t.Fatalf("%d", code)
	}
	var got apitypes.LeagueRecord
	if err := json.Unmarshal(env.Data, &got); err != nil {
		t.Fatal(err)
	}
	want := apitypes.LeagueStartSit{Weeks: 2, Matched: 1, OursLessSet: 10, Basis: StartSitBasis}
	if got.StartSit == nil || *got.StartSit != want {
		t.Fatalf("start sit %+v, want %+v", got.StartSit, want)
	}
	if set := got.Weeks[0].Set; set == nil || *set != (apitypes.LeagueRecordSet{Points: 87}) {
		t.Errorf("week 7 set %+v", set)
	}
	if got.Weeks[2].Set != nil {
		t.Errorf("week 9 set %+v", got.Weeks[2].Set)
	}
}

// With no graded week carrying a set lineup the answer has no record, so
// it reads as before.
func TestLeagueRecordWithNoSetLineupHasNoStartSit(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Records = &fakeRecords{weeks: []leaguerecord.Week{{Week: 7, Benchmark: leaguerecord.BenchmarkESPN, Ours: 97, Theirs: 70, Margin: 27}}}
	_, env := serve(t, s, leaguePath+"record")
	var raw map[string]any
	if err := json.Unmarshal(env.Data, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["start_sit"]; ok {
		t.Error("an answer with no set lineup carried start_sit")
	}
}

// The figures' sentences keep the site's words (shared/words/banned-words.json):
// no betting or trading word, no dash or semicolon, never "our model".
func TestFigureSentencesKeepTheSitesWords(t *testing.T) {
	banned := regexp.MustCompile(`(?i)\b(markets?|prices?|priced|buy|buys|buying|sell|sells|selling|stock|hosts?|totals?|odds|bets?|spreads?|favou?red|model)\b|[—–;]`)
	power := fmt.Sprintf(powerWords, "weeks 6 to 17")
	for _, s := range []string{ProjectionGapBasis, power, StartSitBasis} {
		if m := banned.FindString(s); m != "" {
			t.Errorf("%q says %q", s, m)
		}
	}
}
