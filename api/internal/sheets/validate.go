// Package sheets is the drafter's own sheet: rank, tier, tag and note
// per player, reordered by drag, imported and exported as CSV, printed
// from its detail (spec §1 part 5).
package sheets

import (
	"fmt"
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
	maxPosition    = 8
	maxTeam        = 8
	maxTier        = 50
	maxNote        = 500
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

// validateAnnotations checks one row's tier, tag and note. prefix names its place in
// the request.
func validateAnnotations(errs map[string]string, prefix string, tier *int, tag *apitypes.SheetTag, note *string) {
	if tier != nil && (*tier < 1 || *tier > maxTier) {
		errs[prefix+"tier"] = fmt.Sprintf("Tiers run from 1 to %d", maxTier)
	}
	if tag != nil && !tag.Valid() {
		errs[prefix+"tag"] = "Pick target, sleeper, breakout, avoid, injury or handcuff"
	}
	if note != nil && utf8.RuneCountInString(*note) > maxNote {
		errs[prefix+"note"] = fmt.Sprintf("Keep notes under %d characters", maxNote)
	}
}

// validateRows checks a whole ordered list of rows: each row's shape,
// and that no player appears twice.
func validateRows(rows []apitypes.SheetRowInput) map[string]string {
	errs := map[string]string{}
	if len(rows) > MaxRows {
		errs["rows"] = fmt.Sprintf("A sheet holds at most %d players", MaxRows)
		return errs
	}
	seen := make(map[string]int, len(rows))
	for i, row := range rows {
		prefix := fmt.Sprintf("rows.%d.", i)
		checkLen(errs, prefix+"player_id", row.PlayerId, 1, maxPlayerIDLen)
		checkLen(errs, prefix+"name", row.Name, 1, maxPlayerName)
		checkLen(errs, prefix+"position", row.Position, 1, maxPosition)
		if row.Team != nil {
			checkLen(errs, prefix+"team", *row.Team, 0, maxTeam)
		}
		validateAnnotations(errs, prefix, row.Tier, row.Tag, row.Note)
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
