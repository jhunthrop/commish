// Package sheets is the drafter's own sheet: rank, tier, tags and note
// per player, reordered by drag, imported and exported as CSV, printed
// from its detail (spec §1 part 5).
package sheets

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Bounds, matching openapi.yaml's SheetRowInput and the sheet_rows
// table's checks.
const (
	MaxRows        = 1000
	MaxPerAccount  = 50
	maxNameLen     = 60
	maxPlayerIDLen = 64
	maxPlayerName  = 80
	maxTeam        = 8
	maxTier        = 50
	maxNote        = 500
	minHeadshotLen = 9
	maxHeadshotLen = 300
	headshotScheme = "https://"
)

func checkLen(errs map[string]string, field, v string, min, max int) {
	if n := utf8.RuneCountInString(v); n < min || n > max {
		errs[field] = fmt.Sprintf("Keep it from %d to %d characters", min, max)
	}
}

// validateName checks a sheet's name.
func validateName(name string) map[string]string {
	errs := map[string]string{}
	checkLen(errs, "name", name, 1, maxNameLen)
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// validateAnnotations checks one row's tier, normalized tags and note.
// prefix names its place in the request.
func validateAnnotations(errs map[string]string, prefix string, tier *int, tags apitypes.SheetTags, note *string, shape *regexp.Regexp) {
	if tier != nil && (*tier < 1 || *tier > maxTier) {
		errs[prefix+"tier"] = fmt.Sprintf("Tiers run from 1 to %d", maxTier)
	}
	validateTags(errs, prefix+"tags", tags, shape)
	if note != nil && utf8.RuneCountInString(*note) > maxNote {
		errs[prefix+"note"] = fmt.Sprintf("Keep notes under %d characters", maxNote)
	}
}

func validateHeadshot(errs map[string]string, field string, headshot *string) {
	if headshot == nil {
		return
	}
	n := utf8.RuneCountInString(*headshot)
	if n < minHeadshotLen || n > maxHeadshotLen || !strings.HasPrefix(*headshot, headshotScheme) {
		errs[field] = "A face is an https link"
	}
}

// positions are the positions a sheet ranks, keyed by every spelling a
// file uses for one.
func positions() map[string]string {
	return map[string]string{
		"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "PK": "K",
		"DST": "DST", "DEF": "DST", "D/ST": "DST",
	}
}

// canonicalPosition is a position in the sheet's spelling, or the input
// trimmed when it is not one the sheet ranks, which validation refuses.
func canonicalPosition(raw string) string {
	p := strings.ToUpper(strings.TrimSpace(raw))
	if c, ok := positions()[p]; ok {
		return c
	}
	return p
}

// normalizeRows returns rows with their positions and tags in canonical
// spelling, so what is validated is what is stored.
func normalizeRows(rows []apitypes.SheetRowInput) []apitypes.SheetRowInput {
	out := make([]apitypes.SheetRowInput, len(rows))
	for i, r := range rows {
		tags := normalizeTags(r.Tags)
		r.Tags = &tags
		r.Position = canonicalPosition(r.Position)
		out[i] = r
	}
	return out
}

// validateRows checks a whole ordered list of normalized rows: each
// row's shape, and that no player appears twice.
func validateRows(rows []apitypes.SheetRowInput) map[string]string {
	errs := map[string]string{}
	if len(rows) > MaxRows {
		errs["rows"] = fmt.Sprintf("A sheet holds at most %d players", MaxRows)
		return errs
	}
	shape := ownTag()
	known := positions()
	seen := make(map[string]int, len(rows))
	for i, row := range rows {
		prefix := fmt.Sprintf("rows.%d.", i)
		checkLen(errs, prefix+"player_id", row.PlayerId, 1, maxPlayerIDLen)
		checkLen(errs, prefix+"name", row.Name, 1, maxPlayerName)
		if _, ok := known[row.Position]; !ok {
			errs[prefix+"position"] = "Pick QB, RB, WR, TE, K or DST"
		}
		if row.Team != nil {
			checkLen(errs, prefix+"team", *row.Team, 0, maxTeam)
		}
		validateHeadshot(errs, prefix+"headshot", row.Headshot)
		validateAnnotations(errs, prefix, row.Tier, normalizeTags(row.Tags), row.Note, shape)
		if first, dup := seen[row.PlayerId]; dup {
			errs[prefix+"player_id"] = fmt.Sprintf("Already on the sheet at row %d", first+1)
		} else {
			seen[row.PlayerId] = i
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}
