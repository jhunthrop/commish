package inseason

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// weekOrderFixture is the fixture league with every club's defense on the
// board (the twelve rostered ones and the rest free), a second kicker on
// the first rostered kicker's club, and the week's projection for each
// defense and for one kicker a club.
type weekOrderFixture struct {
	fixture
	projection boards.WeekProjection
	// kicker is the first rostered kicker; stale is the second kicker on
	// his club, whom the projection leaves out.
	kicker, stale boards.Player
}

func newWeekOrderFixture(t *testing.T) weekOrderFixture {
	t.Helper()
	f := newFixture(t)
	defended := map[string]bool{}
	var kicker boards.Player
	for _, p := range f.raw.Players {
		if p.Position == draft.DEF {
			defended[p.Team] = true
		}
		if p.Position == draft.K && kicker.ID == "" {
			kicker = p
		}
	}
	for _, club := range fixtureTeams() {
		if !defended[club] {
			f.raw.Players = append(f.raw.Players, boards.Player{ID: "DST-" + club, Name: club + " D/ST", Position: draft.DEF, Team: club})
		}
	}
	stale := boards.Player{ID: "k-stale", Name: "Stale Kicker", Position: draft.K, Team: kicker.Team}
	// Listed first, so the club's row is decided by the rule, never by the board's order.
	f.raw.Players = append([]boards.Player{stale}, f.raw.Players...)
	config, err := mock.SlotConfig(*f.league.Saved)
	if err != nil {
		t.Fatal(err)
	}
	if f.league.Board, err = boards.For(f.raw, f.league.Saved.Teams, config); err != nil {
		t.Fatal(err)
	}
	projection := boards.WeekProjection{Week: 6, ReadAt: time.Date(2026, 10, 15, 2, 0, 0, 0, time.UTC),
		Players: map[string]boards.ProjectedPoints{}, Defenses: map[string]boards.ProjectedPoints{}}
	for i, p := range f.raw.Players {
		points := boards.ProjectedPoints{PPR: float64(i%9) + 2.04, Half: 1, Standard: 1}
		switch {
		case p.Position == draft.DEF:
			projection.Defenses[p.Team] = points
		case p.Position == draft.K && p.ID != stale.ID:
			projection.Players[p.ID] = points
		}
	}
	return weekOrderFixture{fixture: f, projection: projection, kicker: kicker, stale: stale}
}

func (f weekOrderFixture) advisor(t *testing.T, projection boards.WeekProjection, now time.Time) *advisor {
	t.Helper()
	a, err := newAdvisor(f.league, f.data, projection, nil, now, nil)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// sectionRank is a section's place in the rows.
var sectionRank = map[apitypes.WeekOrderRowSection]int{
	apitypes.WeekOrderRowSectionToPlay: 0, apitypes.WeekOrderRowSectionKickedOff: 1, apitypes.WeekOrderRowSectionBye: 2,
}

func TestWeekOrderListsEveryClubsDefenseByProj(t *testing.T) {
	f := newWeekOrderFixture(t)
	out := f.advisor(t, f.projection, fixtureNow).WeekOrder(draft.DEF, false)
	if out.Week != 6 || out.Position != apitypes.WeekOrderAdvicePositionDEF || out.ProjectionReadAt == nil || out.ReadAt != nil || out.Moves != nil {
		t.Fatalf("week %d position %s read %v league read %v moves %v", out.Week, out.Position, out.ProjectionReadAt, out.ReadAt, out.Moves)
	}
	if len(out.Rows) != len(fixtureTeams()) {
		t.Fatalf("%d rows for %d clubs", len(out.Rows), len(fixtureTeams()))
	}
	clubs := map[string]bool{}
	for i, row := range out.Rows {
		line := row.Line
		if line.Player.Position != string(draft.DEF) || clubs[line.Player.Team] || row.Roster != nil || row.Move != nil {
			t.Fatalf("row %d: %+v roster %v move %v", i, line.Player, row.Roster, row.Move)
		}
		clubs[line.Player.Team] = true
		// The fixture's last two clubs are on bye in week 6, and nobody has kicked off by Thursday.
		bye := line.Player.Team == "TEN" || line.Player.Team == "WSH"
		if bye != (row.Section == apitypes.WeekOrderRowSectionBye) || (!bye && row.Section != apitypes.WeekOrderRowSectionToPlay) {
			t.Fatalf("%s is %s", line.Player.Team, row.Section)
		}
		if bye != (line.WeekProjection == nil) {
			t.Fatalf("%s: bye %v, proj %v", line.Player.Team, bye, line.WeekProjection)
		}
		if i == 0 {
			continue
		}
		prev := out.Rows[i-1]
		if sectionRank[prev.Section] > sectionRank[row.Section] {
			t.Fatalf("row %d's section %s follows %s", i, row.Section, prev.Section)
		}
		if row.Section == apitypes.WeekOrderRowSectionToPlay && *line.WeekProjection > *prev.Line.WeekProjection {
			t.Fatalf("row %d's Proj %v tops the row above's %v", i, *line.WeekProjection, *prev.Line.WeekProjection)
		}
	}
	// Every Proj is the tenth a screen prints, rounded once here.
	if p := *out.Rows[0].Line.WeekProjection; p != roundTenth(p) {
		t.Fatalf("Proj %v is not a tenth", p)
	}
}

func TestWeekOrderListsTheClubsOneKicker(t *testing.T) {
	f := newWeekOrderFixture(t)
	seen := func(out apitypes.WeekOrderAdvice) map[string]int {
		on := map[string]int{}
		for _, row := range out.Rows {
			if row.Line.Player.Position != string(draft.K) {
				t.Fatalf("%s is a %s", row.Line.Player.Name, row.Line.Player.Position)
			}
			on[row.Line.Player.Team]++
			if on[row.Line.Player.Team] > 1 {
				t.Fatalf("two kickers for %s", row.Line.Player.Team)
			}
		}
		return on
	}
	projected := f.advisor(t, f.projection, fixtureNow).WeekOrder(draft.K, false)
	seen(projected)
	for _, row := range projected.Rows {
		if *row.Line.Player.BoardId == f.stale.ID {
			t.Fatal("the kicker the projection leaves out stands for his club")
		}
	}
	// Before the projection, the club's kicker is the one who kicked for it last.
	f.data.Lines = append(f.data.Lines, kicking(f.stale.ID, f.stale.Team, 4, 1, 1), kicking(f.kicker.ID, f.kicker.Team, 5, 2, 2))
	unread := f.advisor(t, boards.WeekProjection{Week: 6}, fixtureNow).WeekOrder(draft.K, false)
	seen(unread)
	if unread.ProjectionReadAt != nil {
		t.Fatalf("read at %v", unread.ProjectionReadAt)
	}
	found := false
	for _, row := range unread.Rows {
		id := *row.Line.Player.BoardId
		if id == f.stale.ID {
			t.Fatal("the kicker who kicked for the club before stands for it")
		}
		found = found || id == f.kicker.ID
		if row.Line.WeekProjection != nil {
			t.Fatalf("%s carries a Proj with none read", id)
		}
	}
	if !found {
		t.Fatal("the club's last kicker is not listed")
	}
}

// The rules the season's points leave out are a count (Lane 66w review
// finding 2): the basis says how many and links to the league's Settings,
// never a list that grows with the league.
func TestWeekOrderCountsTheRulesLeftOut(t *testing.T) {
	f := newWeekOrderFixture(t)
	rules := *f.league.Saved.Scoring.Custom
	rules.PointsPerFieldGoal50Plus = 5
	saved := *f.league.Saved
	saved.Scoring = apitypes.Scoring{Custom: &rules}
	f.league.Saved = &saved
	out := f.advisor(t, f.projection, fixtureNow).WeekOrder(draft.K, true)
	left := uncountedRulesAt(saved, func(string) bool { return false }, draft.K)
	want := uncountedOf(left)
	if len(left) < 2 || out.BasisNote != want.Note {
		t.Fatalf("%q, want %d rules left out", out.BasisNote, len(left))
	}
	// A reader with no league is told the board's scoring in the same sentence.
	visitor := f.advisor(t, f.projection, fixtureNow).WeekOrder(draft.K, false)
	if visitor.BasisNote != want.Note {
		t.Fatalf("visitor %q", visitor.BasisNote)
	}
}

// The rules are the tab's own (Lane 66w rereview N2), named inline (Lane
// 111, B33): the recorded league leaves out five rules, two-point
// conversions, missed field goals, missed extra points, fumble recoveries
// and safeties; a kicker's Avg and Last leave out the two kicking ones,
// said as one missed kick, a defense's the two defense ones.
func TestWeekOrderNamesOnlyTheTabsRulesLeftOut(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerTwoPointConversion, rules.PointsPerReturnTouchdown = 2, 0
	rules.PointsPerFieldGoalMissed, rules.PointsPerExtraPointMissed = -1, -1
	rules.PointsPerDefensiveFumbleRecovery, rules.PointsPerSafety = 2, 2
	rules.PointsPerFieldGoal4049, rules.PointsPerFieldGoal50Plus = rules.PointsPerFieldGoal, rules.PointsPerFieldGoal
	settings := fixtureSettings()
	settings.Scoring = apitypes.Scoring{Custom: &rules}
	carried := func(metric string) bool { return metric == metricPointsAllowed || metric == metricYardsAllowed }
	if all := uncountedRules(settings, carried); len(all) != 5 {
		t.Fatalf("the league leaves out %v", all)
	}
	want := map[draft.Position]struct {
		rules []string
		note  string
	}{
		draft.K:   {[]string{"missed field goals", "missed extra points"}, "Our stats omit missed kick."},
		draft.DEF: {[]string{"fumble recoveries", "safeties"}, "Our stats omit fumble recovery and safety."},
	}
	f := newWeekOrderFixture(t)
	f.league.Saved = &settings
	a := f.advisor(t, f.projection, fixtureNow)
	a.season.carried = map[string]bool{metricPointsAllowed: true, metricYardsAllowed: true}
	for position, w := range want {
		got := uncountedOf(uncountedRulesAt(settings, carried, position))
		if strings.Join(got.Rules, "|") != strings.Join(w.rules, "|") {
			t.Errorf("%s: %v, want %v", position, got.Rules, w.rules)
		}
		if out := a.WeekOrder(position, true); out.BasisNote != w.note {
			t.Errorf("%s tab: %q", position, out.BasisNote)
		}
	}
}

// Week 1 before its projection (Lane 66w review finding 7): no Proj and no
// counted game, so the club's kicker is the one a roster in the league
// holds, else the one the drafts price; never the board's first listing.
func TestWeekOrderBeforeAnyGameListsTheClubsCurrentKicker(t *testing.T) {
	f := newWeekOrderFixture(t)
	adp := 140.5
	for i := range f.raw.Players {
		if f.raw.Players[i].ID == f.kicker.ID {
			f.raw.Players[i].ADP = &adp
		}
	}
	config, err := mock.SlotConfig(*f.league.Saved)
	if err != nil {
		t.Fatal(err)
	}
	if f.league.Board, err = boards.For(f.raw, f.league.Saved.Teams, config); err != nil {
		t.Fatal(err)
	}
	clubOf := func(out apitypes.WeekOrderAdvice) string {
		for _, row := range out.Rows {
			if row.Line.Player.Team == f.kicker.Team {
				return *row.Line.Player.BoardId
			}
		}
		return ""
	}
	none := boards.WeekProjection{Week: 6}
	if got := clubOf(f.advisor(t, none, fixtureNow).WeekOrder(draft.K, false)); got != f.kicker.ID {
		t.Fatalf("the priced kicker does not stand for his club: %s", got)
	}
	// A roster in the league holding the other one decides it for the league's tab.
	delete(f.league.HeldBy, f.kicker.ID)
	f.league.HeldBy[f.stale.ID] = 2
	if got := clubOf(f.advisor(t, none, fixtureNow).WeekOrder(draft.K, true)); got != f.stale.ID {
		t.Fatalf("the rostered kicker does not stand for his club: %s", got)
	}
}

func TestWeekOrderWithoutAProjectionIsInOrderOfAvg(t *testing.T) {
	f := newWeekOrderFixture(t)
	for i, club := range fixtureTeams()[:8] {
		f.data.Lines = append(f.data.Lines, sacking(club, 1, float64(i%4)), sacking(club, 2, float64(i%3)))
	}
	out := f.advisor(t, boards.WeekProjection{Week: 6}, fixtureNow).WeekOrder(draft.DEF, false)
	var avgs []*float64
	for _, row := range out.Rows {
		if row.Section == apitypes.WeekOrderRowSectionToPlay {
			avgs = append(avgs, row.Line.SeasonAvg)
		}
	}
	for i := 1; i < len(avgs); i++ {
		if avgs[i] != nil && (avgs[i-1] == nil || *avgs[i] > *avgs[i-1]) {
			t.Fatalf("row %d's Avg %v tops the row above's %v", i, *avgs[i], avgs[i-1])
		}
	}
	if avgs[0] == nil {
		t.Fatal("no row carries an Avg, so the test proves nothing")
	}
}

func TestWeekOrderKickedOffGamesFollowTheGamesToPlay(t *testing.T) {
	f := newWeekOrderFixture(t)
	sunday := time.Date(2026, 10, 18, 14, 0, 0, 0, east)
	out := f.advisor(t, f.projection, sunday).WeekOrder(draft.DEF, true)
	for _, row := range out.Rows {
		if row.Section == apitypes.WeekOrderRowSectionToPlay || row.Move != nil {
			t.Fatalf("%s is %s with move %v after every kickoff", row.Line.Player.Team, row.Section, row.Move)
		}
	}
}

func TestWeekOrderMarksRostersAndAddsOnTheFirstFiveFree(t *testing.T) {
	f := newWeekOrderFixture(t)
	out := f.advisor(t, f.projection, fixtureNow).WeekOrder(draft.DEF, true)
	if out.ReadAt == nil {
		t.Fatal("no league read")
	}
	adds, free := 0, 0
	kinds := map[apitypes.RosterMarkKind]int{}
	for _, row := range out.Rows {
		kinds[row.Roster.Kind]++
		if row.Roster.Kind != apitypes.RosterMarkKindFree {
			if row.Move != nil {
				t.Fatalf("%s on a roster admits %v", row.Line.Player.Team, *row.Move)
			}
			continue
		}
		if row.Section == apitypes.WeekOrderRowSectionToPlay {
			free++
		}
		if row.Move != nil {
			adds++
			if adds != free || *row.Move != apitypes.WeekOrderRowMoveAdd {
				t.Fatalf("add on %s, the %d free row", row.Line.Player.Team, free)
			}
		}
	}
	if adds != addsShown || free <= addsShown {
		t.Fatalf("%d adds on %d free rows still to play", adds, free)
	}
	if kinds[apitypes.RosterMarkKindYours] != 1 || kinds[apitypes.RosterMarkKindTeam] != 11 {
		t.Fatalf("kinds %v", kinds)
	}
}

func TestWeekOrderRoutes(t *testing.T) {
	f := newWeekOrderFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Boards, s.Season = &askingBoards{board: f.league.Board}, 2026
	code, env := serve(t, s, "/order/week?position=DEF")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("public: %d %+v", code, env.Error)
	}
	var out apitypes.WeekOrderAdvice
	if err := json.Unmarshal(env.Data, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Rows) == 0 || out.Rows[0].Roster != nil || out.ReadAt != nil || out.Moves != nil {
		t.Fatalf("public: %d rows, read at %v, moves %v", len(out.Rows), out.ReadAt, out.Moves)
	}
	code, env = serve(t, s, leaguePath+"order/week?position=K")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("league: %d %+v", code, env.Error)
	}
	var league apitypes.WeekOrderAdvice
	if err := json.Unmarshal(env.Data, &league); err != nil {
		t.Fatal(err)
	}
	if league.Moves == nil || league.ReadAt == nil || league.Rows[0].Roster == nil {
		t.Fatalf("league: moves %v read at %v", league.Moves, league.ReadAt)
	}
	for _, bad := range []string{"/order/week", "/order/week?position=RB", leaguePath + "order/week?position=DST"} {
		code, env := serve(t, s, bad)
		if code != http.StatusBadRequest || env.Error == nil || env.Error.Fields[fieldPosition] == "" {
			t.Fatalf("%s: %d %+v", bad, code, env.Error)
		}
	}
}
