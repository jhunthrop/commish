package boards

import (
	"sort"
	"strings"
)

// Designation statuses, the contract's words (InjuryDesignation.status).
const (
	StatusQuestionable   = "questionable"
	StatusDoubtful       = "doubtful"
	StatusOut            = "out"
	StatusInjuredReserve = "injured_reserve"
	StatusSuspended      = "suspended"
	StatusPUP            = "pup"
	StatusNFI            = "nfi"
)

// Statuses is every status a designation reads as.
func Statuses() []string {
	return []string{StatusQuestionable, StatusDoubtful, StatusOut, StatusInjuredReserve, StatusSuspended, StatusPUP, StatusNFI}
}

// designationCodeTable is the provider's codes in the contract's words,
// the table api/testdata/designation-codes.json pins for both lanes.
func designationCodeTable() map[string]string {
	return map[string]string{
		"Q": StatusQuestionable, "QUESTIONABLE": StatusQuestionable,
		"D": StatusDoubtful, "DOUBTFUL": StatusDoubtful,
		"O": StatusOut, "OUT": StatusOut,
		"IR": StatusInjuredReserve, "IR-R": StatusInjuredReserve, "INJURED RESERVE": StatusInjuredReserve,
		"SUSP": StatusSuspended, "SUS": StatusSuspended, "SUSPENDED": StatusSuspended,
		"PUP": StatusPUP,
		"NFI": StatusNFI,
	}
}

// StatusOf is the provider's designation code in the contract's words,
// "" for a code we do not know (then no designation is shown).
func StatusOf(code string) string {
	return designationCodeTable()[strings.ToUpper(strings.TrimSpace(code))]
}

// outForTheSeason is the capture's note that makes an out a season-long
// designation.
const outForTheSeason = "out for the season"

// SeasonLong is a designation that keeps him off the field for weeks the
// rest-of-season figure counts: injured reserve, suspended, PUP, NFI, or
// out with a note that says out for the season. A week's out, doubtful or
// questionable is not.
func SeasonLong(status, note string) bool {
	switch status {
	case StatusInjuredReserve, StatusSuspended, StatusPUP, StatusNFI:
		return true
	case StatusOut:
		return strings.Contains(strings.ToLower(note), outForTheSeason)
	}
	return false
}

// seasonLongCodes is every code a season-long status is listed under,
// beside its status, in code order: the run read's mapping.
func seasonLongCodes() (codes, statuses []string) {
	table := designationCodeTable()
	for code, status := range table {
		if SeasonLong(status, "") {
			codes = append(codes, code)
		}
	}
	sort.Strings(codes)
	for _, code := range codes {
		statuses = append(statuses, table[code])
	}
	return codes, statuses
}
