package leaguesync

import (
	"fmt"
	"strings"
)

// tiebreakWords is a platform tie rule in the member's words.
var tiebreakWords = map[string]string{
	TiebreakHeadToHead:     "head-to-head",
	TiebreakPointsAgainst:  "points against",
	TiebreakDivisionRecord: "division record",
}

// chanceBasis is the figure's sentence: the replays, the model, the rules
// read and what is left open.
func chanceBasis(snap Snapshot) string {
	t := snap.Terms
	var b strings.Builder
	fmt.Fprintf(&b, "Playoff chance from %s replays of the schedule left, each team at its season rate, "+
		"scores varying week to week as this league's have. ", thousands(ChanceRuns))
	seeds := seedWords(seedsOf(snap))
	if divisional(t) {
		seeds = "each division's winner makes it, then " + seeds
	}
	b.WriteString(capital(seeds))
	b.WriteString(". ")
	b.WriteString(tieWords(t.Tiebreak))
	if holdsProof(t) {
		b.WriteString(" Divisions are not counted, so no team reads 100 or 0.")
	} else {
		b.WriteString(" Only a clinched place reads 100 and only a team that is out reads 0.")
	}
	return b.String()
}

// tieWords says how a tie on record is broken: by the platform's own rule
// where it is read and replayed, else by points for in the replays, with a
// tie at the cut once the season is over left to the platform.
func tieWords(rule string) string {
	switch rule {
	case TiebreakPointsFor:
		return "Ties go by points for, the platform's rule."
	case TiebreakHeadToHead:
		return "Ties go by the platform's head-to-head rule once the season is over, by points for in the replays."
	}
	unread := "the platform's tie rule is not read"
	if words, ok := tiebreakWords[rule]; ok {
		unread = fmt.Sprintf("the platform's %s rule is not replayed", words)
	}
	return fmt.Sprintf("Ties go by points for in the replays, as %s, so a team tied at the cut when the season is over waits on the platform.", unread)
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
