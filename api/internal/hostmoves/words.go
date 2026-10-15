package hostmoves

import "strings"

// The member's words for a move. No em-dash, no semicolon, the host named
// as where the move happens.
const (
	// The answers.
	doneWords    = "Set on ESPN. Your lineup there now reads as ours."
	refusedWords = "ESPN did not make the move, so nothing changed there."
	pendingWords = "Sent to ESPN, but your lineup there did not show it when we read it back. Check your lineup on ESPN before you set it again."
	notSentWords = "ESPN is not answering right now, and nothing was sent. Review the move again in a moment."
	offWords     = "Make this change on ESPN."

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
)

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
