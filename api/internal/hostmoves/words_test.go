package hostmoves

import (
	"fmt"
	"regexp"
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
		doneWords, refusedWords, pendingWords, notSentWords, offWords, reconsentWords, reconnectWords,
		fmt.Sprintf(weekMovedWords, 7), notYourTeamWords, staleWords, fmt.Sprintf(reserveWords, "Tank Bigsby"),
		fmt.Sprintf(lockedWords, andNames([]string{"Tank Bigsby", "Jauan Jennings"}), verbFor(2)), notAnsweringWord,
		tokenOtherWords, tokenExpiredWords, tokenUsedWords, moveFormWords,
		claimDoneWords, claimRefusedWords, claimNotSeenWords, claimReconsentWords, claimReconnectWords,
		fmt.Sprintf(claimWeekMovedWords, 7), claimNotYourTeamWords, claimStaleWords, fmt.Sprintf(notAvailableWords, "Keenan Allen"),
		fmt.Sprintf(alreadyYoursWords, "Keenan Allen"), fmt.Sprintf(notDroppableWords, "Danny Amendola"),
		fmt.Sprintf(dropLockedWords, "Danny Amendola"), noBidsWords, fmt.Sprintf(bidBoundsWords, 0, 500), claimFormWords,
		claimTokenUsedWords, claimPendingWords("Wednesday"), claimPendingWords(""),
		lineupWords([]apitypes.HostMoveChange{
			{Slot: apitypes.HostMoveChangeSlotRB, In: "1", Out: ptr("2")},
			{Slot: apitypes.HostMoveChangeSlotFLEX, In: "3", Out: nil},
		}, roster),
	}
	for _, line := range lines {
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
