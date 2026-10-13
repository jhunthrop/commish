package sheets

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Tag bounds, matching openapi.yaml's SheetTags and app.sheet_tags_valid.
const (
	MaxTags   = 4
	maxTagLen = 20
)

// ownTag is the shape of a drafter's own tag: a letter or digit, then
// letters, digits, spaces, apostrophes, periods or hyphens. Commas, bars
// and semicolons are left out because they separate tags in a CSV cell.
func ownTag() *regexp.Regexp {
	return regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} '’.\-]*$`)
}

// fixedTags is every fixed tag, in the order the sheet offers them.
func fixedTags() []apitypes.SheetTag {
	return []apitypes.SheetTag{
		apitypes.SheetTagTarget, apitypes.SheetTagSleeper, apitypes.SheetTagBreakout,
		apitypes.SheetTagAvoid, apitypes.SheetTagInjury, apitypes.SheetTagHandcuff,
	}
}

// canonicalTag trims a tag and closes up its inner spaces, and spells a
// fixed tag in any case as the fixed tag.
func canonicalTag(raw string) string {
	t := strings.Join(strings.Fields(raw), " ")
	for _, f := range fixedTags() {
		if strings.EqualFold(t, string(f)) {
			return string(f)
		}
	}
	return t
}

// normalizeTags is a row's tags in canonical spelling with repeats (in
// any case) taken out, first one kept. Never nil, so a row always
// answers with a list.
func normalizeTags(tags *apitypes.SheetTags) apitypes.SheetTags {
	out := apitypes.SheetTags{}
	if tags == nil {
		return out
	}
	seen := map[string]bool{}
	for _, raw := range *tags {
		t := canonicalTag(raw)
		key := strings.ToLower(t)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, t)
	}
	return out
}

// validateTags checks normalized tags against shape, ownTag compiled
// once by the caller for a whole request.
func validateTags(errs map[string]string, field string, tags apitypes.SheetTags, shape *regexp.Regexp) {
	if len(tags) > MaxTags {
		errs[field] = fmt.Sprintf("Keep it to %d tags", MaxTags)
		return
	}
	for _, t := range tags {
		if n := utf8.RuneCountInString(t); n < 1 || n > maxTagLen || !shape.MatchString(t) {
			errs[field] = fmt.Sprintf("A tag is 1 to %d letters or numbers", maxTagLen)
			return
		}
	}
}

// splitTagCell reads a CSV tags cell: tags separated by commas, bars or
// semicolons, empty pieces dropped.
func splitTagCell(cell string) apitypes.SheetTags {
	parts := strings.FieldsFunc(cell, func(r rune) bool { return r == ',' || r == '|' || r == ';' })
	out := apitypes.SheetTags{}
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// joinTagCell writes tags into one CSV cell, the way a person types them.
func joinTagCell(tags apitypes.SheetTags) string {
	return strings.Join(tags, ", ")
}
