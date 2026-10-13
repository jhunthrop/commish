package ffpc

import (
	"regexp"
	"strconv"
	"strings"
)

// FFPC states its scoring in prose, one rule a line under a heading:
//
//	Passing
//	0.05 point – 1 yard passing (...)
//	4 points – Passing TD
//
// Each line is "<points> point(s) – <what>". A line is put in a Sleeper
// key only when it says exactly what the key says; any other scoring
// line is kept, in FFPC's words, in the unread list.

var scoreLine = regexp.MustCompile(`^(-?[0-9]+(?:\.[0-9]+)?)\s+points?\s*(?:[–—-]|for)\s*(.+)$`)

// Section headings the lines sit under, by the word that opens them.
var sections = map[string]string{
	"passing": "pass", "rushing": "rush", "receiving": "rec",
	"place kicking": "kick", "team defense/special teams": "def", "team defense": "def",
}

// fixed is a line's words, lower case and without its examples, mapped
// to its key. A line's words are matched whole, never by a part.
func fixed() map[string]string {
	return map[string]string{
		"1 yard passing": "pass_yd", "passing td": "pass_td", "interception thrown": "pass_int",
		"1 yard rushing": "rush_yd", "rushing td": "rush_td",
		"1 yard receiving": "rec_yd", "receiving td": "rec_td",
		"made pat": "xpm", "every sack": "sack", "every safety": "safe",
		"every blocked punt or field goal": "blk_kick", "every shutout": "pts_allow_0",
	}
}

// allowedRanges is a points-allowed bracket by its exact range, only
// where it is Sleeper's own bracket.
func allowedRanges() map[string]string {
	return map[string]string{
		"1-6": "pts_allow_1_6", "7-13": "pts_allow_7_13", "14-20": "pts_allow_14_20",
		"21-27": "pts_allow_21_27", "28-34": "pts_allow_28_34",
	}
}

var (
	allowedLine = regexp.MustCompile(`^allowing between ([0-9]{1,2})\s*[–—-]\s*([0-9]{1,2}) points?$`)
	fieldGoal   = regexp.MustCompile(`^made fg of `)
	parenthesis = regexp.MustCompile(`\s*\([^)]*\)`)
	stars       = regexp.MustCompile(`\*+`)
)

// scoringLines reads every scoring line of a page's lines.
func scoringLines(lines []string) (map[string]float64, []string) {
	out := map[string]float64{}
	var unread []string
	section := ""
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if s, ok := sections[strings.ToLower(line)]; ok {
			section = s
			continue
		}
		m := scoreLine.FindStringSubmatch(line)
		if m == nil || section == "" {
			continue
		}
		points, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			continue
		}
		// A line worth nothing loses nothing when it is left out.
		if !scoreOne(out, section, points, words(m[2])) && points != 0 {
			unread = append(unread, Clean(line, maxText))
		}
	}
	if rec, ok := out["rec"]; ok {
		if te, ok := out["rec_te"]; ok {
			out["bonus_rec_te"] = te - rec
		}
	}
	delete(out, "rec_te")
	return out, unread
}

// words is a line's words as matched: lower case, its parenthesized
// examples and its footnote stars taken off, dashes made plain.
func words(s string) string {
	s = strings.ToLower(stars.ReplaceAllString(parenthesis.ReplaceAllString(s, ""), ""))
	s = strings.NewReplacer("–", "-", "—", "-").Replace(s)
	return strings.TrimSuffix(collapse(s), ".")
}

// scoreOne puts one line in its key, and says whether it could.
func scoreOne(out map[string]float64, section string, points float64, what string) bool {
	if key, ok := fixed()[what]; ok {
		out[key] = points
		return true
	}
	switch {
	case what == "fumble lost":
		out["fum_lost"] = points
		return true
	case what == "2-point conversion":
		if section == "pass" || section == "rush" || section == "rec" {
			out[section+"_2pt"] = points
			return true
		}
	case strings.HasPrefix(what, "reception for te"):
		out["rec_te"] = points
		return true
	case strings.HasPrefix(what, "reception for"):
		out["rec"] = points
		return true
	case what == "every team takeaway":
		out["int"], out["fum_rec"] = points, points
		return true
	case strings.HasPrefix(what, "every td") && section == "def":
		out["def_td"] = points
		return true
	case fieldGoal.MatchString(what):
		// "Made FG of 1 - 30 yards plus 0.1 point for every yard
		// thereafter": the flat points are a made field goal's; the
		// distance bonus has no key and stays unread.
		out["fgm"] = points
		return what == "made fg of 1 - 30 yards"
	}
	if m := allowedLine.FindStringSubmatch(what); m != nil {
		if key, ok := allowedRanges()[m[1]+"-"+m[2]]; ok {
			out[key] = points
			return true
		}
	}
	return false
}
