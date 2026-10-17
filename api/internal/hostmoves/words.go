package hostmoves

import (
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The member's words for a move. No em-dash, no semicolon, the host named
// as where the move happens.
const (
	// The answers.
	doneWords    = "Set on ESPN. Your lineup there now reads as ours."
	refusedWords = "ESPN did not make the move, so nothing changed there."
	pendingWords = "Sent to ESPN, but your lineup there did not show it when we read it back. Check your lineup on ESPN before you set it again."
	notSentWords = "ESPN is not answering right now, and nothing was sent. Review the move again in a moment."
	offWords     = "Make this change on ESPN."

	// Why the lineup cannot be set from our screen, said under the copy
	// verb (Lane 66e), the platform named.
	noLineupPathWords = "%s takes no lineup from outside."
	writesNotOnWords  = "Lineup writes to %s are not on yet."
	renewWords        = "Your %s connection needs renewing."
	connectWords      = "Connect %s on your account page to set your lineup from here."

	// Why a move is unavailable, said under the verb.
	reconsentWords = "To set your lineup from here, connect ESPN again on your account page and agree to moves."
	reconnectWords = "ESPN no longer accepts your saved sign-in. Connect ESPN again on your account page to set your lineup from here."

	// Why a plan is refused before anything is sent.
	weekMovedWords   = "ESPN is on week %d now. Reload your lineup to see it."
	notYourTeamWords = "ESPN does not list this team as yours, so we cannot set its lineup."
	staleWords       = "Your lineup on ESPN changed since this page read it. Reload your lineup to see it."
	reserveWords     = "%s is on injured reserve on ESPN, so he cannot start."
	lockedWords      = "ESPN has locked %s, whose %s started."
	cannotFillWords  = "ESPN does not let %s start in that spot."
	notAnsweringWord = "ESPN is not answering right now. Try again in a moment."

	// The confirm token.
	tokenOtherWords   = "That confirmation is for another move. Review the move again."
	tokenExpiredWords = "That confirmation expired. Review the move again."
	tokenUsedWords    = "That move was already sent. Check your lineup on ESPN."

	// The form.
	fieldMove     = "move"
	fieldConfirm  = "confirm"
	moveFormWords = "Send the lineup changes from the start screen."

	// A claim's answers.
	claimDoneWords    = "Done on ESPN. He is on your roster there now."
	claimRefusedWords = "ESPN did not take the claim, so nothing changed there."
	claimNotSeenWords = "Sent to ESPN, but your claims there did not show it when we read them back. Check your claims on ESPN before you claim again."
	// A free agent's add the roster read back does not show.
	claimNotOnRosterWords = "Sent to ESPN, but your roster there did not show him when we read it back. Check your roster on ESPN before you claim again."
	// The read-back itself failed: nothing was checked, and the sentence says so.
	claimNotReadWords = "Sent to ESPN, but we could not read it back. Check your claims on ESPN before you claim again."
	// A move with no bid where the league bids: the screen plans the bid it shows.
	bidUnboundWords = "Review the claim again with your bid."

	// Why a claim is unavailable, said under the verb.
	claimReconsentWords = "To claim from here, connect ESPN again on your account page and agree to moves."
	claimReconnectWords = "ESPN no longer accepts your saved sign-in. Connect ESPN again on your account page to claim from here."

	// Why a claim is refused before anything is sent.
	claimWeekMovedWords   = "ESPN is on week %d now. Reload the waivers to see it."
	claimNotYourTeamWords = "ESPN does not list this team as yours, so we cannot claim for it."
	claimStaleWords       = "Your roster on ESPN changed since this page read it. Reload the waivers to see it."
	notAvailableWords     = "%s is on another team in this league now."
	alreadyYoursWords     = "%s is already on your team."
	notDroppableWords     = "ESPN does not let you drop %s."
	dropLockedWords       = "ESPN has locked %s on your roster until his game ends, so he cannot be dropped for a free agent now."
	noBidsWords           = "This league on ESPN does not take bids."
	bidBoundsWords        = "ESPN takes bids from $%d to $%d in this league."
	claimFormWords        = "Send the claim from the waivers screen."
	claimTokenUsedWords   = "That claim was already sent. Check your claims on ESPN."
)

// kindWords is a move kind's own sentences where a lineup and a claim
// differ.
type kindWords struct {
	reconsent, reconnect, notYourTeam, form, used string
}

// wordsFor is the kind's sentences; anything but a claim is a lineup's.
func wordsFor(kind apitypes.HostMoveInputKind) kindWords {
	if kind == apitypes.HostMoveInputKindClaim {
		return kindWords{reconsent: claimReconsentWords, reconnect: claimReconnectWords, notYourTeam: claimNotYourTeamWords,
			form: claimFormWords, used: claimTokenUsedWords}
	}
	return kindWords{reconsent: reconsentWords, reconnect: reconnectWords, notYourTeam: notYourTeamWords, form: moveFormWords,
		used: tokenUsedWords}
}

// andNames joins names: "A", "A and B", "A, B and C".
func andNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// andClauses joins a move's clauses: "A", "A, and B", "A, B, and C".
func andClauses(clauses []string) string {
	switch len(clauses) {
	case 0:
		return ""
	case 1:
		return clauses[0]
	}
	return strings.Join(clauses[:len(clauses)-1], ", ") + ", and " + clauses[len(clauses)-1]
}
