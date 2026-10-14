package scoring

import (
	"cmp"
	"fmt"
	"slices"
)

// The groups a left-out rule is listed under, in the order the setup page
// shows them.
const (
	GroupOffense = "offense"
	GroupBonus   = "bonus"
	GroupKicking = "kicking"
	GroupDefense = "defense"
	GroupOther   = "other"
)

var groupOrder = map[string]int{GroupOffense: 0, GroupBonus: 1, GroupKicking: 2, GroupDefense: 3, GroupOther: 4}

// DroppedRule is one rule a league scores that the 21 do not carry: the
// rule in drafter words (no commas, so a list of them reads), the group
// it is listed under, and the host's figure, nil when the host's words
// carry it themselves (MyFantasyLeague's rule text).
type DroppedRule struct {
	Group  string   `json:"group"`
	Rule   string   `json:"rule"`
	Points *float64 `json:"points"`
}

// Label is a rule in drafter words and the group it is listed under.
type Label struct {
	Group string
	Rule  string
}

// Dropped is a left-out rule with its figure.
func Dropped(l Label, figure float64) DroppedRule {
	return DroppedRule{Group: l.Group, Rule: HostText(l.Rule), Points: &figure}
}

// Words is the rule and its figure as one phrase, for a list kept as text
// (a league's sync snapshot): "0 points allowed 10".
func (d DroppedRule) Words() string {
	if d.Points == nil {
		return d.Rule
	}
	return HostText(fmt.Sprintf("%s %g", d.Rule, *d.Points))
}

// SortDropped orders left-out rules by group, then by rule.
func SortDropped(rules []DroppedRule) {
	slices.SortFunc(rules, func(a, b DroppedRule) int {
		if c := cmp.Compare(groupOrder[a.Group], groupOrder[b.Group]); c != 0 {
			return c
		}
		if na, nb := leadingNumber(a.Rule), leadingNumber(b.Rule); na >= 0 && nb >= 0 && na != nb {
			return cmp.Compare(na, nb)
		}
		return cmp.Compare(a.Rule, b.Rule)
	})
}

// leadingNumber is the number a rule opens with ("7 to 13 points
// allowed"), so tiers list in order, or -1 for one that opens with words.
func leadingNumber(rule string) int {
	n, digits := 0, 0
	for _, r := range rule {
		if r < '0' || r > '9' {
			break
		}
		n, digits = n*10+int(r-'0'), digits+1
	}
	if digits == 0 {
		return -1
	}
	return n
}

// DroppedWords is each rule's Words.
func DroppedWords(rules []DroppedRule) []string {
	out := make([]string, 0, len(rules))
	for _, d := range rules {
		out = append(out, d.Words())
	}
	return out
}
