package mfl

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// list reads the host's JSON lists, which carry a single element as the
// element itself rather than as a list of one, and no element as absent.
type list[T any] []T

func (l *list[T]) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	switch {
	case len(b) == 0 || string(b) == "null" || string(b) == `""`:
		*l = nil
		return nil
	case b[0] == '[':
		var out []T
		if err := json.Unmarshal(b, &out); err != nil {
			return err
		}
		*l = out
		return nil
	}
	var one T
	if err := json.Unmarshal(b, &one); err != nil {
		return err
	}
	*l = list[T]{one}
	return nil
}

// text is an element's text node, {"$t": "..."}.
type text struct {
	T string `json:"$t"`
}

// Bounds every answer is held to.
const (
	maxTeams       = 32
	maxRoster      = 120
	maxWeek        = 25
	maxNameLen     = 80
	maxShortText   = 40
	maxRules       = 400
	maxTransaction = 2000
	maxPoints      = 1000
)

var (
	franchisePattern = regexp.MustCompile(`^[0-9]{4}$`)
	playerIDPattern  = regexp.MustCompile(`^[0-9]{4,6}$`)
	assetPattern     = regexp.MustCompile(`^(DP|FP|BB)_[0-9_.]{1,20}$`)
)

func malformed(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrMalformed}, args...)...)
}

// franchiseNumber is "0007" as 7.
func franchiseNumber(id string) (int, bool) {
	if !franchisePattern.MatchString(id) {
		return 0, false
	}
	n, err := strconv.Atoi(id)
	return n, err == nil && n >= 1 && n <= maxTeams
}

// number reads one of the host's numeric strings ("148.50"), bounded.
func number(s string, bound float64) (float64, bool) {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "$"))
	if s == "" {
		return 0, true
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || v < -bound || v > bound {
		return 0, false
	}
	return v, true
}

// count reads a non-negative integer string, bounded.
func count(s string, bound int) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	v, err := strconv.Atoi(s)
	return v, err == nil && v >= 0 && v <= bound
}

// cleanText is a host string as a page may show it: control and format
// characters dropped, trimmed, cut at limit runes.
func cleanText(s string, limit int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s))
	if utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit])
	}
	return s
}

// playerIDs reads the host's "1234,5678," lists, refusing anything that
// is not a player id.
func playerIDs(s string) ([]string, bool) {
	var out []string
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		// Draft picks and blind-bid dollars ride in a trade's lists too
		// (DP_02_05, FP_0005_2018_2, BB_10): they are not players.
		if part == "" || assetPattern.MatchString(part) {
			continue
		}
		if !playerIDPattern.MatchString(part) {
			return nil, false
		}
		out = append(out, part)
	}
	return out, len(out) <= maxRoster
}
