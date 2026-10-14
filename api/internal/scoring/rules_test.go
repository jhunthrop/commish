package scoring

import (
	"encoding/json"
	"errors"
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
	if ranged.Rules["points_per_field_goal"] != 3 || !slices.Equal(ranged.Dropped,
		[]string{"field goal made, 40 to 49 yards 4 (read as 3)", "field goal made, 50+ yards 5 (read as 3)"}) {
		t.Errorf("field goals by distance: %v, dropped %q", ranged.Rules["points_per_field_goal"], ranged.Dropped)
	}
	for _, want := range []string{"completion 0.1", "rushing first down 1e+06", "Sleeper setting IDP tkl 1"} {
		if !slices.Contains(im.Dropped, want) {
			t.Errorf("dropped %q, want %q", im.Dropped, want)
		}
	}
	if slices.ContainsFunc(im.Dropped, func(d string) bool { return strings.HasPrefix(d, "st_td") }) {
		t.Error("a setting worth 0 was named dropped")
	}
	if len(im.Rules) != 21 || slices.Contains(im.Applied(), "points_per_safety") || !slices.Contains(im.Applied(), Reception) {
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
	sides := map[string]map[string]float64{
		"domain.py STANDARD_SCORING": figures(t, py, "STANDARD_SCORING: Final = ScoringRules(", ")",
			regexp.MustCompile(`(\w+)=`+number)),
		"rules.ts STANDARD": figures(t, ts, "const STANDARD:", "};", regexp.MustCompile(`(\w+): `+number)),
		"00019 defaults": figures(t, sql, "jsonb_build_object(", "$$;",
			regexp.MustCompile(`'(\w+)', coalesce\(.*, `+number+`\)`)),
	}
	for side, got := range sides {
		if len(got) != len(want) {
			t.Errorf("%s: %d figures, want %d", side, len(got), len(want))
		}
		for k, v := range want {
			if g, ok := got[k]; !ok || g != v {
				t.Errorf("%s: %s = %g (%v), want %g", side, k, g, ok, v)
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
