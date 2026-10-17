package scoring

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

func standard() map[string]float64 {
	out := map[string]float64{}
	for _, r := range Rules() {
		out[r.Key] = r.Standard
	}
	return out
}

// The 21 keys are the contract's, a missing rule is refused, and the map
// and the closed object round trip.
func TestRulesAndConversions(t *testing.T) {
	keys := make([]string, 0, len(rules))
	for _, r := range Rules() {
		keys = append(keys, r.Key)
	}
	contract := apitypes.ScoringRuleKeys()
	slices.Sort(keys)
	slices.Sort(contract)
	if !slices.Equal(keys, contract) {
		t.Fatalf("rules %v, contract %v", keys, contract)
	}
	m := standard()
	m[Reception] = 0.5
	r, err := FromMap(m)
	if err != nil || r.PointsPerReception != 0.5 || r.PointsPerPassingYard != 0.04 {
		t.Fatalf("FromMap = %+v, %v", r, err)
	}
	back := ToMap(r)
	for k, v := range m {
		if back[k] != v {
			t.Errorf("%s: %g back as %g", k, v, back[k])
		}
	}
	delete(m, "points_per_safety")
	if _, err := FromMap(m); err == nil {
		t.Error("a missing rule was read")
	}
	if p, ok := StoredPreset(r); !ok || p != apitypes.ScoringPresetHalfPpr {
		t.Errorf("half PPR rules read as %q %v", p, ok)
	}
	if _, ok := StoredPreset(func() apitypes.ScoringRules { x := r; x.TeReceptionBonus = 0.5; return x }()); ok {
		t.Error("a TE premium read as a stored board")
	}
	r.PointsPerSack = 101
	if p := Problems(r); p["points_per_sack"] == "" || len(p) != 1 {
		t.Errorf("problems %v", p)
	}
}

// The closed object refuses an unknown rule, a missing one and a null by
// name, so no rule is ever zero by omission.
func TestScoringRulesDecodeStrictly(t *testing.T) {
	body := func(edit func(map[string]any)) []byte {
		m := map[string]any{}
		for k, v := range standard() {
			m[k] = v
		}
		edit(m)
		b, _ := json.Marshal(m)
		return b
	}
	cases := map[string]struct {
		edit  func(map[string]any)
		field string
	}{
		"unknown": {func(m map[string]any) { m["points_per_carry"] = 1 }, "scoring.custom.points_per_carry"},
		"missing": {func(m map[string]any) { delete(m, "points_per_safety") }, "scoring.custom.points_per_safety"},
		"null":    {func(m map[string]any) { m["points_per_sack"] = nil }, "scoring.custom.points_per_sack"},
		"string":  {func(m map[string]any) { m["points_per_sack"] = "1" }, "scoring.custom.points_per_sack"},
	}
	for name, c := range cases {
		var r apitypes.ScoringRules
		var fe *apitypes.FieldError
		if err := json.Unmarshal(body(c.edit), &r); !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: %v, want a field error at %s", name, err, c.field)
		}
	}
	var r apitypes.ScoringRules
	if err := json.Unmarshal(body(func(map[string]any) {}), &r); err != nil || r.PointsPerFieldGoal != 3 {
		t.Errorf("the 21 rules: %+v, %v", r, err)
	}
}

// Sleeper's settings map to the 21: the two-point trio when alike, every
// other non-zero setting named with its figure, a figure out of bounds
// named, and what Sleeper leaves out at the standard figure.
func TestFromSleeper(t *testing.T) {
	im := FromSleeper(map[string]float64{
		"rec": 1, "pass_td": 6, "pass_2pt": 2, "rush_2pt": 2, "rec_2pt": 2, "bonus_rec_te": 0.5,
		"pass_cmp": 0.1, "st_td": 0, "rush_fd": 1e6, "IDP‮_tkl": 1,
	})
	if im.Rules[Reception] != 1 || im.Rules["points_per_two_point_conversion"] != 2 || im.Rules[TEBonus] != 0.5 {
		t.Errorf("rules %v", im.Rules)
	}
	ranged := FromSleeper(map[string]float64{"fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4, "fgm_50p": 5})
	if ranged.Rules["points_per_field_goal"] != 3 || len(ranged.Dropped) != 0 {
		t.Errorf("field goals by distance: %v, dropped %+v", ranged.Rules["points_per_field_goal"], ranged.Dropped)
	}
	words := DroppedWords(im.Dropped)
	for _, want := range []string{"completion 0.1", "rushing first down 1e+06", "Sleeper setting IDP tkl 1"} {
		if !slices.Contains(words, want) {
			t.Errorf("dropped %q, want %q", words, want)
		}
	}
	if slices.ContainsFunc(words, func(d string) bool { return strings.HasPrefix(d, "special teams touchdown") }) {
		t.Error("a setting worth 0 was named dropped")
	}
	for _, d := range im.Dropped {
		if strings.Contains(d.Rule, ",") || d.Group == "" {
			t.Errorf("a left-out rule that does not read in a list: %+v", d)
		}
	}
	if len(im.Rules) != len(rules) || slices.Contains(im.Applied(), "points_per_safety") || !slices.Contains(im.Applied(), Reception) {
		t.Errorf("applied %v", im.Applied())
	}
}

// repoFile is a file of the repository, read by the cross-check below.
func repoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// figures are every "key<sep>number" pair in text between start and end.
func figures(t *testing.T, text, start, end string, pair *regexp.Regexp) map[string]float64 {
	t.Helper()
	i := strings.Index(text, start)
	if i < 0 {
		t.Fatalf("%q is gone", start)
	}
	block := text[i:]
	if j := strings.Index(block, end); j >= 0 {
		block = block[:j]
	}
	out := map[string]float64{}
	for _, m := range pair.FindAllStringSubmatch(block, -1) {
		v, err := strconv.ParseFloat(m[2], 64)
		if err != nil {
			t.Fatal(err)
		}
		out[m[1]] = v
	}
	return out
}

func one(t *testing.T, text string, pattern string) float64 {
	t.Helper()
	m := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if m == nil {
		t.Fatalf("%q is gone", pattern)
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// The standard figures, the half and PPR reception points and the preset
// thresholds are one set across Go, research/model/domain.py, the web and
// the 00019 migration, so StoredPreset never serves a stored board for
// rules the research side scores differently.
func TestScoringFiguresAgreeEverywhere(t *testing.T) {
	want := map[string]float64{}
	for _, r := range Rules() {
		want[r.Key] = r.Standard
	}
	number := `(-?[0-9]+(?:\.[0-9]+)?)`
	py := repoFile(t, "research/model/domain.py")
	ts := repoFile(t, "web/src/lib/room/setup/rules.ts")
	sql := repoFile(t, "api/migrations/00019_scoring_rules.sql")
	board := map[string]float64{}
	for _, r := range boardRules {
		board[r.Key] = r.Standard
	}
	kickDefense := map[string]float64{}
	for _, r := range kickDefenseRules() {
		kickDefense[r.Key] = r.Standard
	}
	sql25 := repoFile(t, "api/migrations/00025_kick_defense_rules.sql")
	sides := []struct {
		name      string
		got, want map[string]float64
	}{
		{"domain.py STANDARD_SCORING", figures(t, py, "STANDARD_SCORING: Final = ScoringRules(", ")",
			regexp.MustCompile(`(\w+)=`+number)), board},
		{"rules.ts STANDARD", figures(t, ts, "const STANDARD:", "};", regexp.MustCompile(`(\w+): `+number)), want},
		{"00019 defaults", figures(t, sql, "jsonb_build_object(", "$$;",
			regexp.MustCompile(`'(\w+)', coalesce\(.*, `+number+`\)`)), board},
		{"00025 defaults", figures(t, sql25, "jsonb_build_object(", "$$;",
			regexp.MustCompile(`'(\w+)', (?:coalesce\(.*, )?`+number)), kickDefense},
		{"domain.py tier tables", domainTiers(t, py), tierStandards()},
	}
	for _, side := range sides {
		if len(side.got) != len(side.want) {
			t.Errorf("%s: %d figures, want %d", side.name, len(side.got), len(side.want))
		}
		for k, v := range side.want {
			if g, ok := side.got[k]; !ok || g != v {
				t.Errorf("%s: %s = %g (%v), want %g", side.name, k, g, ok, v)
			}
		}
	}
	presets := map[string][2]float64{
		"PPR":  {one(t, py, `PPR_SCORING: Final = replace\(STANDARD_SCORING, points_per_reception=`+number), one(t, ts, `\sppr: \{ points_per_reception: `+number)},
		"half": {one(t, py, `HALF_PPR_SCORING: Final = replace\(STANDARD_SCORING, points_per_reception=`+number), one(t, ts, `half_ppr: \{ points_per_reception: `+number)},
	}
	for name, p := range presets {
		r := Standard()
		r.PointsPerReception = p[0]
		if got, ok := StoredPreset(r); !ok || p[0] != p[1] {
			t.Errorf("%s: domain.py %g, web %g, Go reads %q %v", name, p[0], p[1], got, ok)
		}
	}
	boardsPy := repoFile(t, "research/boards/custom.py")
	web := repoFile(t, "web/src/lib/room/setup/scoring.ts")
	thresholds := map[string][3]float64{
		"PPR":  {PPRFrom, one(t, boardsPy, `PPR_RECEPTION_FROM: Final = `+number), one(t, web, `const PPR_FROM = `+number)},
		"half": {HalfFrom, one(t, boardsPy, `HALF_RECEPTION_FROM: Final = `+number), one(t, web, `const HALF_FROM = `+number)},
	}
	for name, th := range thresholds {
		if th[0] != th[1] || th[0] != th[2] {
			t.Errorf("%s threshold: Go %g, boards service %g, web %g", name, th[0], th[1], th[2])
		}
	}
}

// tierStandards is every tier's standard figure, keyed by rule.
func tierStandards() map[string]float64 {
	out := map[string]float64{}
	for _, group := range [][]Tier{PointsAllowedTiers(), YardsAllowedTiers()} {
		for _, tier := range group {
			out[tier.Key] = tier.Standard
		}
	}
	return out
}

// domainTiers is domain.py's two tier tables read onto our tiers: each
// tier takes the figure of the first ceiling its top does not pass, and a
// tier's bottom must read the same, so no domain.py ceiling falls inside
// one of ours.
func domainTiers(t *testing.T, py string) map[string]float64 {
	t.Helper()
	pair := regexp.MustCompile(`\((-?[0-9]+|math\.inf), (-?[0-9]+)\)`)
	table := func(name string) [][2]float64 {
		i := strings.Index(py, name+": Final = (")
		if i < 0 {
			t.Fatalf("domain.py lost %s", name)
		}
		block := py[i : i+strings.Index(py[i:], "\n)")+2]
		if j := strings.Index(py[i:], ")\n"); j >= 0 && !strings.Contains(py[i:i+j], "\n") {
			block = py[i : i+j+1]
		}
		var out [][2]float64
		for _, m := range pair.FindAllStringSubmatch(block, -1) {
			ceiling := math.Inf(1)
			if m[1] != "math.inf" {
				ceiling, _ = strconv.ParseFloat(m[1], 64)
			}
			points, _ := strconv.ParseFloat(m[2], 64)
			out = append(out, [2]float64{ceiling, points})
		}
		return out
	}
	at := func(rows [][2]float64, v float64) float64 {
		for _, r := range rows {
			if v <= r[0] {
				return r[1]
			}
		}
		return 0
	}
	out := map[string]float64{}
	for name, group := range map[string][]Tier{"POINTS_ALLOWED_TIERS": PointsAllowedTiers(), "YARDS_ALLOWED_TIERS": YardsAllowedTiers()} {
		rows := table(name)
		for _, tier := range group {
			top := float64(tier.Hi)
			if tier.Hi == Open {
				top = 1e9
			}
			if at(rows, float64(tier.Lo)) != at(rows, top) {
				t.Errorf("%s: a ceiling falls inside %s", name, tier.Key)
			}
			out[tier.Key] = at(rows, top)
		}
	}
	return out
}

// The board's rules are domain.py's ScoringRules fields, exactly: the
// boards service refuses any other key.
func TestBoardRulesAreDomains(t *testing.T) {
	py := repoFile(t, "research/model/domain.py")
	i := strings.Index(py, "class ScoringRules:")
	j := strings.Index(py[i:], "\n\n\n")
	var fields []string
	for _, m := range regexp.MustCompile(`\n    (\w+): float`).FindAllStringSubmatch(py[i:i+j], -1) {
		fields = append(fields, m[1])
	}
	got := BoardRules(Standard())
	if len(got) != len(fields) {
		t.Fatalf("board rules %d, domain.py %d", len(got), len(fields))
	}
	for _, f := range fields {
		if _, ok := got[f]; !ok {
			t.Errorf("board rules lack %s", f)
		}
	}
	r := PresetRules(apitypes.ScoringPresetPpr)
	r.PointsAllowed0, r.YardsAllowed550Plus, r.PointsPerFieldGoal50Plus = 10, 0, 5
	if p, ok := StoredPreset(r); !ok || p != apitypes.ScoringPresetPpr {
		t.Errorf("PPR with its own kicking and defense rules read as %q %v", p, ok)
	}
}

// A host's bracket spans our tiers exactly or not at all.
func TestCover(t *testing.T) {
	cases := []struct {
		lo, hi int
		want   []string
	}{
		{0, 0, []string{"points_allowed_0"}},
		{14, 20, []string{"points_allowed_14_17", "points_allowed_18_20"}},
		{18, 21, []string{"points_allowed_18_20", "points_allowed_21"}},
		{35, 99, []string{"points_allowed_35_45", "points_allowed_46_plus"}},
		{46, 999, []string{"points_allowed_46_plus"}},
		{14, 16, nil},
		{15, 17, nil},
		{30, 99, nil},
	}
	for _, c := range cases {
		got, ok := Cover(PointsAllowedTiers(), c.lo, c.hi, 99)
		if !slices.Equal(got, c.want) || ok != (c.want != nil) {
			t.Errorf("%d to %d: %v %v, want %v", c.lo, c.hi, got, ok, c.want)
		}
	}
	if At(PointsAllowedTiers(), 21).Key != "points_allowed_21" || At(YardsAllowedTiers(), 612).Key != "yards_allowed_550_plus" ||
		At(YardsAllowedTiers(), 99).Key != "yards_allowed_0_99" {
		t.Error("At reads a value into the wrong tier")
	}
}

// A real Sleeper league's kicking and defense settings land in the rules:
// field goals by distance, each bracket on the tiers it spans, the yards
// brackets it does not score at 0 and never named defaulted, and a longer
// miss scored apart named left out rather than read at the short figure.
func TestFromSleeperKeepsKickingAndDefense(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "leaguesync", "replay", "sleeper", "league.json"))
	if err != nil {
		t.Fatal(err)
	}
	var league struct {
		ScoringSettings map[string]float64 `json:"scoring_settings"`
	}
	if err := json.Unmarshal(raw, &league); err != nil {
		t.Fatal(err)
	}
	settings := league.ScoringSettings
	settings["fgmiss_0_19"], settings["fgmiss_20_29"], settings["fgmiss_30_39"], settings["fgmiss_40_49"] = -1, -1, -1, -2
	delete(settings, "fgmiss")
	im := FromSleeper(settings)
	want := map[string]float64{
		FieldGoal: 3, FieldGoal40To49: 4, FieldGoal50AndUp: 5, "points_per_field_goal_missed": -1,
		"points_allowed_0": 10, "points_allowed_1_6": 7, "points_allowed_7_13": 4, "points_allowed_14_17": 1,
		"points_allowed_18_20": 1, "points_allowed_21": 0, "points_allowed_22_27": 0, "points_allowed_28_34": -1,
		"points_allowed_35_45": -4, "points_allowed_46_plus": -4, "yards_allowed_0_99": 0, "yards_allowed_550_plus": 0,
	}
	for k, v := range want {
		if im.Rules[k] != v {
			t.Errorf("%s = %g, want %g", k, im.Rules[k], v)
		}
	}
	for _, d := range im.Defaulted {
		if IsTier(strings.Fields(d)[0]) {
			t.Errorf("a tier named defaulted: %s", d)
		}
	}
	words := DroppedWords(im.Dropped)
	if !slices.Contains(words, "field goal missed from 40 to 49 yards -2") {
		t.Errorf("dropped %q lacks the longer miss", words)
	}
	for _, w := range words {
		if strings.Contains(w, "allowed") || strings.HasPrefix(w, "field goal made") {
			t.Errorf("a kept rule named left out: %s", w)
		}
	}
	if _, err := FromMap(im.Rules); err != nil {
		t.Errorf("the import is not whole: %v", err)
	}
	// Sleeper adds the flat figure and a make's distance figure, as ESPN
	// does: a range a league does not state adds nothing, and a flat 0
	// beside ranges zeroes nothing.
	cases := []struct {
		name     string
		settings map[string]float64
		want     [3]float64
	}{
		{"flat and the longest range", map[string]float64{"fgm": 3.5, "fgm_50p": 2}, [3]float64{3.5, 3.5, 5.5}},
		{"a flat 0 beside ranges", map[string]float64{"fgm": 0, "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4, "fgm_50p": 5},
			[3]float64{3, 4, 5}},
		{"flat alone", map[string]float64{"fgm": 3}, [3]float64{3, 3, 3}},
		{"ranges alone", map[string]float64{"fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4}, [3]float64{3, 4, 0}},
	}
	for _, c := range cases {
		im := FromSleeper(c.settings)
		got := [3]float64{im.Rules[FieldGoal], im.Rules[FieldGoal40To49], im.Rules[FieldGoal50AndUp]}
		if got != c.want || len(im.Dropped) != 0 {
			t.Errorf("%s: %v, want %v, dropped %v", c.name, got, c.want, DroppedWords(im.Dropped))
		}
	}
}
