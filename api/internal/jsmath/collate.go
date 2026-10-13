package jsmath

import "strings"

// asciiPunctuationOrder is the CLDR root collation's order for the ASCII
// punctuation and symbols, all of which sort before the digits, which sort
// before the letters. Space and controls come first.
const asciiPunctuationOrder = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"

// primaryWeight orders one ASCII byte at the primary level, letters folded
// to one weight per letter; ok is false outside printable ASCII.
func primaryWeight(b byte) (int, bool) {
	if i := strings.IndexByte(asciiPunctuationOrder, b); i >= 0 {
		return i, true
	}
	base := len(asciiPunctuationOrder)
	switch {
	case b >= '0' && b <= '9':
		return base + int(b-'0'), true
	case b >= 'a' && b <= 'z':
		return base + 10 + int(b-'a'), true
	case b >= 'A' && b <= 'Z':
		return base + 10 + int(b-'A'), true
	}
	return 0, false
}

func isUpper(b byte) bool { return b >= 'A' && b <= 'Z' }

// Collate is String.prototype.localeCompare as V8 answers it with ICU's
// root locale, for the identifiers the engine compares: printable ASCII
// (player ids, team ids, positions). Punctuation before digits before
// letters; case decides only when everything else ties, lowercase first.
// A string outside printable ASCII falls back to code-unit order, which
// no identifier the engine sorts carries.
func Collate(a, b string) int {
	if c, ok := collatePrimary(a, b); ok {
		if c != 0 {
			return c
		}
		return collateTertiary(a, b)
	}
	return strings.Compare(a, b)
}

func collatePrimary(a, b string) (int, bool) {
	for i := 0; i < len(a) || i < len(b); i++ {
		if i >= len(a) {
			return -1, allPrintable(b[i:])
		}
		if i >= len(b) {
			return 1, allPrintable(a[i:])
		}
		wa, okA := primaryWeight(a[i])
		wb, okB := primaryWeight(b[i])
		if !okA || !okB {
			return 0, false
		}
		if wa != wb {
			if wa < wb {
				return -1, allPrintable(a[i:]) && allPrintable(b[i:])
			}
			return 1, allPrintable(a[i:]) && allPrintable(b[i:])
		}
	}
	return 0, true
}

func allPrintable(s string) bool {
	for i := 0; i < len(s); i++ {
		if _, ok := primaryWeight(s[i]); !ok {
			return false
		}
	}
	return true
}

// collateTertiary breaks a primary tie: the first differing case, lowercase first.
func collateTertiary(a, b string) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		ua, ub := isUpper(a[i]), isUpper(b[i])
		if ua != ub {
			if ua {
				return 1
			}
			return -1
		}
	}
	return 0
}
