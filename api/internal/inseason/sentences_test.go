package inseason

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

var thursday = time.Date(2026, 10, 15, 16, 10, 0, 0, east)

func pw(v float64) *float64 { return &v }

func TestChangeSentences(t *testing.T) {
	white := Line{Name: "Rachaad White", Position: draft.RB, Rank: 14, PerWeek: pw(3.1),
		Facts: Facts{LastGames: []GamePoints{{5, 18.4}, {4, 11.2}}}}
	bigsby := Line{Name: "Tank Bigsby", Position: draft.RB, Rank: 31, PerWeek: pw(0.4),
		Facts: Facts{LastGames: []GamePoints{{5, 6.0}, {4, 3.1}}}}
	cases := []struct {
		name string
		host *Line
		ours Line
		want string
	}{
		{"the order, then his last two games", &bigsby, white,
			"White is RB14 in our preseason order, Bigsby RB31. He scored 18.4 and 11.2 in his last two games under your league's scoring."},
		{"a bye forces it", func() *Line { l := bigsby; l.Facts.Bye = true; return &l }(), Line{Name: "Rachaad White", Position: draft.RB, Rank: 14},
			"Tank Bigsby is on bye this week, so White starts."},
		{"a designation forces it, with its stamp", func() *Line {
			l := bigsby
			l.Facts.Designation = &Designation{Status: boards.StatusOut, AsOf: thursday}
			return &l
		}(), Line{Name: "Rachaad White", Position: draft.RB, Rank: 14},
			"Tank Bigsby is listed out as of Thursday 4:10 pm, so White starts."},
		{"the opponent's points allowed when it is near an end", &bigsby, Line{Name: "Rachaad White", Position: draft.RB, Rank: 14,
			Facts: Facts{Opponent: "BUF", Allowed: &Allowed{PointsAGame: 31.2, Rank: 30, Of: 32, Position: draft.RB}}},
			"White is RB14 in our preseason order, Bigsby RB31. Buffalo has allowed the 3rd most points to running backs this season, 31.2 a game in your scoring."},
		{"two positions compare by points over replacement", &Line{Name: "Josh Downs", Position: draft.WR, Rank: 40, PerWeek: pw(1.2)},
			Line{Name: "Jauan Jennings", Position: draft.WR, PerWeek: pw(2.5)},
			"Jennings gives you 1.3 more points over replacement a week than Downs on our preseason number."},
		{"questionable is a flag", &bigsby, Line{Name: "Rachaad White", Position: draft.RB, Rank: 14,
			Facts: Facts{Designation: &Designation{Status: boards.StatusQuestionable, AsOf: thursday}}},
			"White is RB14 in our preseason order, Bigsby RB31. White is questionable as of Thursday 4:10 pm, so check before kickoff."},
		{"an empty spot", nil, Line{Name: "Rachaad White"}, "Your lineup has nobody in this spot, so Rachaad White starts."},
		// M1: the fact under a change never argues against it.
		{"his last games trail the player he replaces: the order alone",
			&Line{Name: "Aaron Rodgers", Position: draft.QB, Rank: 12, Facts: Facts{LastGames: []GamePoints{{5, 25.0}, {4, 25.0}, {3, 26.7}}}},
			Line{Name: "Patrick Mahomes", Position: draft.QB, Rank: 3, Facts: Facts{LastGames: []GamePoints{{5, 19.0}, {4, 18.9}, {3, 32.0}}}},
			"Mahomes is QB3 in our preseason order, Rodgers QB12."},
		{"a defense that allows few points is never the reason to start against it", &bigsby, Line{Name: "Rachaad White", Position: draft.RB, Rank: 14,
			Facts: Facts{Opponent: "BUF", Allowed: &Allowed{PointsAGame: 14.1, Rank: 4, Of: 32, Position: draft.RB}}},
			"White is RB14 in our preseason order, Bigsby RB31."},
		{"no last games for the player he replaces: nothing to beat", &Line{Name: "Tank Bigsby", Position: draft.RB, Rank: 31}, white,
			"White is RB14 in our preseason order, Bigsby RB31."},
	}
	for _, c := range cases {
		w := &Writer{Basis: Preseason, Now: thursday.Add(2 * time.Hour)}
		if got := w.Change(c.ours, c.host); got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}

// Two changes of one shape on one page read differently: the frames
// move on, the facts stay.
func TestNoStockSentenceTwiceOnAPage(t *testing.T) {
	w := &Writer{Basis: RestOfSeason, Now: thursday}
	a := w.Change(Line{Name: "A One", Position: draft.WR, Rank: 10}, &Line{Name: "B Two", Position: draft.WR, Rank: 20})
	b := w.Change(Line{Name: "C Three", Position: draft.WR, Rank: 10}, &Line{Name: "D Four", Position: draft.WR, Rank: 20})
	frame := func(s string) string {
		for _, n := range []string{"One", "Two", "Three", "Four"} {
			s = strings.ReplaceAll(s, n, "_")
		}
		return s
	}
	if frame(a) == frame(b) {
		t.Fatalf("one frame twice: %q and %q", a, b)
	}
	if !strings.Contains(a, "rest-of-season order") || !strings.Contains(b, "rest-of-season order") {
		t.Fatalf("the basis is named: %q, %q", a, b)
	}
}

func TestAllowedWordsAtTheEnds(t *testing.T) {
	cases := map[Allowed]string{
		{14.1, 4, 32, draft.RB}: "Buffalo has allowed the 4th fewest points to running backs this season, 14.1 a game in your scoring.",
		{9.0, 1, 32, draft.TE}:  "Buffalo has allowed the fewest points to tight ends this season, 9.0 a game in your scoring.",
		{30, 32, 32, draft.WR}:  "Buffalo has allowed the most points to receivers this season, 30.0 a game in your scoring.",
	}
	for a, want := range cases {
		if got := allowedWords("BUF", a); got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}

func TestStampWords(t *testing.T) {
	if got := stampWords(thursday, thursday.Add(time.Hour)); got != "Thursday 4:10 pm" {
		t.Fatalf("%q", got)
	}
	if got := stampWords(thursday, thursday.Add(8*24*time.Hour)); got != "October 15" {
		t.Fatalf("%q", got)
	}
}

func TestWaiverSentences(t *testing.T) {
	wright := Line{Name: "Jaylen Wright", Position: draft.RB, Rank: 58}
	w := &Writer{Basis: Preseason, Now: thursday}
	got := w.Waiver(Line{Name: "Kendre Miller", Position: draft.RB, Rank: 30}, &wright, Waiver{Gain: 1.24, Starts: true})
	want := "Kendre Miller starts for you, and your lineup gains 1.2 points over replacement a week on our preseason number. " +
		"Jaylen Wright is the player it costs you least to lose."
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if got := w.Waiver(Line{Name: "X Y", Position: draft.WR, Rank: 70}, nil, Waiver{}); !strings.Contains(got, "WR70 in our preseason order") {
		t.Fatalf("%q", got)
	}
	if got := w.Waiver(Line{Name: "X Y"}, nil, Waiver{Gain: 2, Starts: true}); !strings.Contains(got, "open roster spot") {
		t.Fatalf("%q", got)
	}
	// H1: a gain from a player who does not start this week (a bye, a
	// designation) never says he starts.
	got = w.Waiver(Line{Name: "De'Von Achane", Position: draft.RB, Rank: 38}, &wright, Waiver{Gain: 0.5})
	want = "De'Von Achane does not start for you this week, and your lineup still gains 0.5 points over replacement a week " +
		"with him on our preseason number. Drop Jaylen Wright, the player it costs you least to lose."
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

// The copy guard: every sentence and basis line the routes write, over
// every frame. No em-dash or semicolon, no tip, fantasy words only.
var forbidden = regexp.MustCompile(`(?i)\b(value|values|market|markets|price|prices|priced|buy|buying|sell|selling|stock|asset|assets|tip|tips|smash|robbery|fleece|steal of)\b`)

func guard(t *testing.T, s string) {
	t.Helper()
	if strings.ContainsAny(s, "—–;") {
		t.Errorf("a dash or semicolon in %q", s)
	}
	if m := forbidden.FindString(s); m != "" {
		t.Errorf("%q in %q", m, s)
	}
	if strings.TrimSpace(s) == "" {
		t.Error("an empty sentence")
	}
}

func TestCopyGuard(t *testing.T) {
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupSuperflex, Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1}}
	none := scoring.PresetRules(apitypes.ScoringPresetPpr)
	none.PointsPerTwoPointConversion, none.PointsPerFieldGoalMissed, none.PointsPerReturnTouchdown = 0, 0, 0
	none.PointsPerDefensiveFumbleRecovery, none.PointsPerSafety = 0, 0
	plain := settings
	plain.Scoring = apitypes.Scoring{Custom: &none}
	for _, b := range []OrderBasis{Preseason, RestOfSeason} {
		for _, s := range []string{LineupBasis(b), WaiversBasis, WaiverSeasonBasis(b, SeasonGames), PerGameBasis(), TradesBasis(b, SeasonGames),
			TradeCheckBasis, UncountedOf(settings, nil).Note, UncountedOf(settings, nil).Link,
			OrderScreenBasis(b, 6, OrderLeague(false, settings, apitypes.ProjectionScoringFormatHalfPpr)), OnlyCloseCalls} {
			guard(t, s)
		}
		w := &Writer{Basis: b, Now: thursday}
		hosts := []*Line{nil,
			{Name: "Tank Bigsby", Position: draft.RB, Rank: 31, PerWeek: pw(0.2)},
			{Name: "Tank Bigsby", Position: draft.RB, Facts: Facts{Bye: true}},
			{Name: "Josh Downs", Position: draft.WR, PerWeek: pw(0.1)},
			{Name: "Josh Downs", Position: draft.WR},
		}
		for _, status := range []string{boards.StatusDoubtful, boards.StatusOut, boards.StatusInjuredReserve, boards.StatusSuspended, boards.StatusPUP, boards.StatusNFI} {
			hosts = append(hosts, &Line{Name: "Tank Bigsby", Position: draft.RB, Facts: Facts{Designation: &Designation{Status: status, AsOf: thursday}}})
		}
		ours := []Line{
			{Name: "Rachaad White", Position: draft.RB, Rank: 14, PerWeek: pw(2), Facts: Facts{LastGames: []GamePoints{{5, 18.4}, {4, 11.2}}}},
			{Name: "Rachaad White", Position: draft.RB, Rank: 14, Facts: Facts{LastGames: []GamePoints{{5, 18.4}},
				Designation: &Designation{Status: boards.StatusQuestionable, AsOf: thursday}}},
			{Name: "Rachaad White", Position: draft.RB, Facts: Facts{Opponent: "NYG", Allowed: &Allowed{3, 2, 32, draft.RB}}},
		}
		for round := 0; round < 3; round++ {
			for _, h := range hosts {
				for _, o := range ours {
					guard(t, w.Change(o, h))
				}
			}
			for _, move := range []Waiver{{Gain: 2, Starts: true}, {Gain: 2}, {Gain: 0}, {NoDrop: true}} {
				for _, add := range ours {
					guard(t, w.Waiver(add, hosts[1], move))
					guard(t, w.Waiver(add, nil, move))
				}
			}
		}
	}
}

// The uncounted rules are the league's whose metric no stat line this
// season carries, a kicking or defense rule only where the league starts
// the position, and none when every rule it scores is counted.
func TestBasisNamesTheRulesLeftOut(t *testing.T) {
	rules := scoring.PresetRules(apitypes.ScoringPresetPpr)
	rules.PointsPerFieldGoalMissed, rules.PointsPerReturnTouchdown, rules.PointsPerDefensiveFumbleRecovery = 0, 0, 0
	settings := apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Custom: &rules},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1}}
	left := func(carried func(string) bool) string {
		return strings.Join(UncountedOf(settings, carried).Rules, ", ")
	}
	if got := left(nil); got != "two-point conversions, safeties, a defense's points allowed, a defense's yards allowed" {
		t.Fatalf("%q", got)
	}
	carried := func(metric string) bool {
		return metric == "two_point_conversions" || metric == "safeties" || metric == "points_allowed" || metric == "yards_allowed"
	}
	if got := left(carried); got != "" {
		t.Fatalf("every rule carried: %q", got)
	}
	rules.PointsPerFieldGoal50Plus = 5
	if got := left(carried); got != "field goals of 40 yards or more" {
		t.Fatalf("longer field goals: %q", got)
	}
	settings.Roster.K, settings.Roster.Dst = 0, 0
	rules.PointsPerSafety = 0
	if got := left(nil); got != "two-point conversions" {
		t.Fatalf("no kicker or defense spot: %q", got)
	}
	rules.PointsPerTwoPointConversion = 0
	if got := left(nil); got != "" {
		t.Fatalf("%q", got)
	}
	// A defense's return touchdowns are on its lines; a player's kick and
	// punt returns are what the basis names.
	rules.PointsPerReturnTouchdown = 6
	if got := left(func(m string) bool { return m == "return_touchdowns" }); got != "a player's kick and punt return touchdowns" {
		t.Fatalf("return touchdowns: %q", got)
	}
}

// A plural club takes "have"; a change between two doubtful players is
// the order's, never "and he is not".
func TestSentenceGrammarAndBothDoubtful(t *testing.T) {
	if got := allowedWords("LAC", Allowed{14.1, 4, 32, draft.RB}); got !=
		"The Chargers have allowed the 4th fewest points to running backs this season, 14.1 a game in your scoring." {
		t.Fatalf("%q", got)
	}
	doubtful := Facts{Designation: &Designation{Status: boards.StatusDoubtful, AsOf: thursday}}
	w := &Writer{Basis: Preseason, Now: thursday}
	got := w.Change(Line{Name: "Rachaad White", Position: draft.RB, Rank: 14, Facts: doubtful},
		&Line{Name: "Tank Bigsby", Position: draft.RB, Rank: 31, Facts: doubtful})
	if strings.Contains(got, "is not") || !strings.HasPrefix(got, "White is RB14 in our preseason order, Bigsby RB31.") {
		t.Fatalf("%q", got)
	}
	got = w.Change(Line{Name: "Rachaad White", Position: draft.RB, Rank: 14},
		&Line{Name: "Tank Bigsby", Position: draft.RB, Rank: 31, Facts: doubtful})
	if got != "Tank Bigsby is doubtful as of Thursday 4:10 pm and White is not." {
		t.Fatalf("%q", got)
	}
}
