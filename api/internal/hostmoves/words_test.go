package hostmoves

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
)

// The copy guard over every sentence a move says: no dash between
// clauses, no semicolon, no trading word, no doubled word.
func TestMoveWordsPassTheCopyRules(t *testing.T) {
	banned := regexp.MustCompile(`(?i)\b(market|prices?|buy|sell|stock|assets?|value)\b`)
	doubled := regexp.MustCompile(`(?i)\b([a-z]+)\s+([a-z]+)\b`)
	roster := map[string]espn.Player{"1": {Name: "Rachaad White"}, "2": {Name: "Tank Bigsby"}, "3": {Name: "Jauan Jennings"}}
	lines := []string{
		espnWords.done, espnWords.refused, espnWords.pending, espnWords.notSent, espnWords.off, espnWords.reconsent, espnWords.reconnect,
		fmt.Sprintf(espnWords.weekMoved, 7), espnWords.notYourTeam, espnWords.stale, fmt.Sprintf(espnWords.reserve, "Tank Bigsby"),
		fmt.Sprintf(espnWords.lockedPlayers, andNames([]string{"Tank Bigsby", "Jauan Jennings"}), verbFor(2)), espnWords.notAnswering,
		tokenOtherWords, tokenExpiredWords, espnWords.used, moveFormWords,
		claimDoneWords, claimRefusedWords, claimNotSeenWords, claimReconsentWords, claimReconnectWords,
		fmt.Sprintf(claimWeekMovedWords, 7), claimNotYourTeamWords, claimStaleWords, fmt.Sprintf(notAvailableWords, "Keenan Allen"),
		fmt.Sprintf(alreadyYoursWords, "Keenan Allen"), fmt.Sprintf(notDroppableWords, "Danny Amendola"),
		fmt.Sprintf(dropLockedWords, "Danny Amendola"), noBidsWords, fmt.Sprintf(bidBoundsWords, 0, 500), claimFormWords,
		claimTokenUsedWords, claimPendingWords("Wednesday"), claimPendingWords(""),
		claimNotOnRosterWords, claimNotReadWords, bidUnboundWords,
		lineupWords([]apitypes.HostMoveChange{
			{Slot: apitypes.HostMoveChangeSlotRB, In: "1", Out: ptr("2")},
			{Slot: apitypes.HostMoveChangeSlotFLEX, In: "3", Out: nil},
		}, roster),
	}
	for _, p := range []platformWords{espnWords, mflWords, onHost("sleeper")} {
		lines = append(lines, p.done, p.refused, p.locked, p.pending, p.notSent, p.off, p.reconsent, p.reconnect, p.connect,
			p.switchedOff, fmt.Sprintf(p.weekMoved, 7), p.notYourTeam, p.stale, fmt.Sprintf(p.reserve, "A.J. Brown"), fmt.Sprintf(p.taxi, "A.J. Brown"),
			fmt.Sprintf(p.lockedPlayers, "Josh Downs", verbFor(1)), fmt.Sprintf(p.cannotFill, "Josh Downs"), fmt.Sprintf(p.limit, "WR"),
			fmt.Sprintf(p.fewer, 1, "RB"), p.notAnswering, p.used, "Start A"+p.now)
	}
	for _, line := range lines {
		if strings.Contains(line, "{p}") || strings.Contains(line, "%!") || strings.Contains(strings.ToLower(line), "host") {
			t.Errorf("unfilled or host-named: %q", line)
		}
		if regexp.MustCompile(`[–—;]`).MatchString(line) || banned.MatchString(line) {
			t.Errorf("%q", line)
		}
		for _, m := range doubled.FindAllStringSubmatch(line, -1) {
			if m[1] == m[2] {
				t.Errorf("doubled word in %q", line)
			}
		}
	}
	if got := lineupWords([]apitypes.HostMoveChange{{Slot: apitypes.HostMoveChangeSlotRB, In: "1", Out: ptr("2")},
		{Slot: apitypes.HostMoveChangeSlotFLEX, In: "3"}}, roster); got != "Start Rachaad White over Tank Bigsby at RB, and Jauan Jennings in the flex, on ESPN now." {
		t.Fatalf("%q", got)
	}
}
