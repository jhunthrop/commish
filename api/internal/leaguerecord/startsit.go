package leaguerecord

import "github.com/jhunthrop/commish/api/internal/tenth"

// StartSit is the member's start and sit record (Lane 292) over the graded
// weeks that carry the set lineup: how many started the same players as
// our picks, and our picks' points less the set lineup's, summed from each
// week's printed tenths.
type StartSit struct {
	Weeks       int
	Matched     int
	OursLessSet float64
}

// StartSitOf is the record over weeks, false with none carrying the set
// lineup.
func StartSitOf(weeks []Week) (StartSit, bool) {
	var out StartSit
	for _, w := range weeks {
		if w.Set == nil {
			continue
		}
		out.Weeks++
		if w.Set.Matched {
			out.Matched++
		}
		out.OursLessSet = tenth.Round(out.OursLessSet + tenth.Round(w.Ours-w.Set.Points))
	}
	return out, out.Weeks > 0
}
