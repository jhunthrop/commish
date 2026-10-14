package espn

import (
	"fmt"
	"sort"

	"github.com/jhunthrop/commish/api/internal/scoring"
)

// ESPN's lineup slots a rule is overridden for.
const (
	slotTE      = "6"
	slotDefense = "16"
)

// yardage is a yardage rule ESPN states per yard (unit 1) or per so many
// yards (5, 10, 20, 25, 50, 100): each is read as points per yard.
var yardage = map[string]map[int]float64{
	"points_per_passing_yard":   {3: 1, 5: 5, 6: 10, 7: 20, 8: 25, 9: 50, 10: 100},
	"points_per_rushing_yard":   {24: 1, 27: 5, 28: 10, 29: 20, 30: 25, 31: 50, 32: 100},
	"points_per_receiving_yard": {42: 1, 47: 5, 48: 10, 49: 20, 50: 25, 51: 50, 52: 100},
}

// one is a rule ESPN states as one stat (the first of these it states).
var one = map[string][]int{
	"points_per_passing_touchdown":   {4},
	"points_per_interception":        {20},
	"points_per_rushing_touchdown":   {25},
	"points_per_receiving_touchdown": {43},
	scoring.Reception:                {53, 41},
	"points_per_fumble_lost":         {72},
	"points_per_extra_point":         {86},
	"points_per_extra_point_missed":  {88},
}

// defense is a rule ESPN scores to the defense slot.
var defense = map[string]int{
	"points_per_sack":                      99,
	"points_per_defensive_interception":    95,
	"points_per_defensive_fumble_recovery": 96,
	"points_per_safety":                    98,
}

// alikeStats is a rule taken from several stats only when every one the
// league states scores the same; otherwise each is named dropped.
var alikeStats = map[string][]int{
	"points_per_two_point_conversion": {19, 26, 44},
	"points_per_defensive_touchdown":  {94, 93, 103, 104},
	"points_per_return_touchdown":     {101, 102},
	"points_per_field_goal_missed":    {85, 82, 79, 76},
}

// Field goals by distance: one figure carries them, the under-40 one when
// the league states no flat figure; a distance scored differently is
// named dropped.
const statFieldGoal = 83

var fieldGoalsByDistance = []int{80, 77, 74}

// Map is a league's ESPN scoring as ScoringRules: what it states that
// the 21 carry, every other rule it scores named in drafter words with
// its figure, and the rules it does not state at the standard figure.
func Map(items []Item) scoring.Imported {
	stated := map[int]float64{}
	var te *float64
	for _, it := range items {
		v := it.Points
		if d, ok := it.Overrides[slotDefense]; ok && v == 0 {
			v = d
		}
		stated[it.StatID] = v
		if t, ok := it.Overrides[slotTE]; ok && (it.StatID == 53 || it.StatID == 41) {
			bonus := t - it.Points
			te = &bonus
		}
	}
	m := mapper{stated: stated, used: map[int]bool{}, rules: map[string]float64{}}
	m.yardage()
	m.single()
	m.fieldGoals()
	m.alike()
	if te != nil {
		m.rules[scoring.TEBonus] = *te
	}
	return m.finish()
}

type mapper struct {
	stated  map[int]float64
	used    map[int]bool
	rules   map[string]float64
	dropped []string
}

func (m *mapper) take(stat int) (float64, bool) {
	v, ok := m.stated[stat]
	if ok {
		m.used[stat] = true
	}
	return v, ok
}

func (m *mapper) yardage() {
	for rule, units := range yardage {
		total, any := 0.0, false
		for stat, unit := range units {
			if v, ok := m.take(stat); ok {
				total, any = total+v/unit, true
			}
		}
		if any {
			m.rules[rule] = total
		}
	}
}

func (m *mapper) single() {
	for rule, stats := range one {
		for _, stat := range stats {
			if v, ok := m.take(stat); ok {
				m.rules[rule] = v
				for _, s := range stats {
					m.used[s] = true
				}
				break
			}
		}
	}
	for rule, stat := range defense {
		if v, ok := m.take(stat); ok {
			m.rules[rule] = v
		}
	}
}

func (m *mapper) fieldGoals() {
	if v, ok := m.take(statFieldGoal); ok {
		m.rules["points_per_field_goal"] = v
		return
	}
	base, ok := m.take(fieldGoalsByDistance[0])
	if !ok {
		return
	}
	m.rules["points_per_field_goal"] = base
	// The longer buckets are taken with the short one: a kicker is not
	// projected, so how they were read belongs to the league's record, not
	// to a list of what the board leaves out.
	for _, stat := range fieldGoalsByDistance[1:] {
		m.take(stat)
	}
}

func (m *mapper) alike() {
	for rule, stats := range alikeStats {
		var figure float64
		stated, same := false, true
		for _, stat := range stats {
			v, ok := m.stated[stat]
			if !ok {
				continue
			}
			if stated && v != figure {
				same = false
			}
			figure, stated = v, true
		}
		if !stated || !same {
			continue
		}
		m.rules[rule] = figure
		for _, stat := range stats {
			m.used[stat] = true
		}
	}
}

func (m *mapper) finish() scoring.Imported {
	for stat, v := range m.stated {
		if !m.used[stat] && v != 0 {
			m.dropped = append(m.dropped, fmt.Sprintf("%s %g", label(stat), v))
		}
	}
	sort.Strings(m.dropped)
	out := scoring.Imported{Rules: m.rules, Dropped: m.dropped}
	for _, r := range scoring.Rules() {
		if _, ok := out.Rules[r.Key]; !ok {
			out.Rules[r.Key] = r.Standard
			out.Defaulted = append(out.Defaulted, fmt.Sprintf("%s %g", r.Key, r.Standard))
		}
	}
	return out
}
