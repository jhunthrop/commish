package hostmoves

import (
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The member's words for a move. No em-dash, no semicolon, the platform
// named as where the move happens.

// platformWords is one platform's sentences for a lineup move, its name
// in each. Every lineup sentence is built here from one template, so ESPN
// and MyFantasyLeague say the same thing in the same words.
type platformWords struct {
	// The answers.
	done, refused, locked, pending, notSent, off string
	// Why a move is unavailable, said under the verb.
	reconsent, reconnect, connect, switchedOff string
	// Why a plan is refused before anything is sent; weekMoved takes the
	// week, reserve, taxi, lockedPlayers, cannotFill and limit a name.
	weekMoved, notYourTeam, stale, reserve, taxi, lockedPlayers, cannotFill, limit, fewer, notAnswering string
	// The confirm token used, and the sentence's close.
	used, now string
}

// platformTemplates is every lineup sentence with {p} for the platform.
var platformTemplates = platformWords{
	done:          "Set on {p}. Your lineup there now reads as ours.",
	refused:       "{p} did not make the move, so nothing changed there.",
	locked:        "{p} refused: lineups lock at kickoff.",
	pending:       "Sent to {p}, but your lineup there did not show it when we read it back. Check your lineup on {p} before you set it again.",
	notSent:       "{p} is not answering right now, and nothing was sent. Review the move again in a moment.",
	off:           "Make this change on {p}.",
	reconsent:     "To set your lineup from here, connect {p} again on your account page and agree to moves.",
	reconnect:     "{p} no longer accepts your saved sign-in. Connect {p} again on your account page to set your lineup from here.",
	connect:       "Connect {p} on your account page to set your lineup from here.",
	switchedOff:   "Lineups are not sent to {p} from here yet, so copy the lineup there.",
	weekMoved:     "{p} is on week %d now. Reload your lineup to see it.",
	notYourTeam:   "{p} does not list this team as yours, so we cannot set its lineup.",
	stale:         "Your lineup on {p} changed since this page read it. Reload your lineup to see it.",
	reserve:       "%s is on injured reserve on {p}, so he cannot start.",
	taxi:          "%s is on the taxi squad on {p}, so he cannot start.",
	lockedPlayers: "{p} has locked %s, whose %s started.",
	cannotFill:    "{p} does not let %s start in that spot.",
	limit:         "Your league on {p} does not start that many at %s.",
	fewer:         "Your league on {p} starts at least %d at %s.",
	notAnswering:  "{p} is not answering right now. Try again in a moment.",
	used:          "That move was already sent. Check your lineup on {p}.",
	now:           ", on {p} now.",
}

// wordsOn is the lineup sentences with the platform's name in them.
func wordsOn(name string) platformWords {
	t, put := platformTemplates, func(s string) string { return strings.ReplaceAll(s, "{p}", name) }
	return platformWords{
		done: put(t.done), refused: put(t.refused), locked: put(t.locked), pending: put(t.pending), notSent: put(t.notSent), off: put(t.off),
		reconsent: put(t.reconsent), reconnect: put(t.reconnect), connect: put(t.connect),
		switchedOff: put(t.switchedOff), weekMoved: put(t.weekMoved), notYourTeam: put(t.notYourTeam), stale: put(t.stale),
		reserve: put(t.reserve), taxi: put(t.taxi), lockedPlayers: put(t.lockedPlayers), cannotFill: put(t.cannotFill),
		limit: put(t.limit), fewer: put(t.fewer), notAnswering: put(t.notAnswering), used: put(t.used), now: put(t.now),
	}
}

// The two platforms that take a lineup from here.
var (
	espnWords = wordsOn(leaguesync.HostWords(leaguesync.HostESPN))
	mflWords  = wordsOn(leaguesync.HostWords(leaguesync.HostMFL))
)

// onHost is the lineup sentences for the league's host.
func onHost(host string) platformWords {
	switch host {
	case leaguesync.HostESPN:
		return espnWords
	case leaguesync.HostMFL:
		return mflWords
	}
	return wordsOn(leaguesync.HostWords(host))
}

// Words with no platform in them, and a claim's, which ESPN alone takes.
const (
	// The confirm token.
	tokenOtherWords   = "That confirmation is for another move. Review the move again."
	tokenExpiredWords = "That confirmation expired. Review the move again."

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

// kindWords is a move's own sentences where a lineup and a claim differ,
// and where the platform says them.
type kindWords struct {
	reconsent, reconnect, notYourTeam, form, used, off, notAnswering, notSent string
}

// wordsFor is the move's sentences on the host: a claim's are ESPN's, a
// lineup's name the league's platform.
func wordsFor(host string, kind apitypes.HostMoveInputKind) kindWords {
	p := onHost(host)
	if kind == apitypes.HostMoveInputKindClaim {
		return kindWords{reconsent: claimReconsentWords, reconnect: claimReconnectWords, notYourTeam: claimNotYourTeamWords,
			form: claimFormWords, used: claimTokenUsedWords, off: espnWords.off, notAnswering: espnWords.notAnswering, notSent: espnWords.notSent}
	}
	return kindWords{reconsent: p.reconsent, reconnect: p.reconnect, notYourTeam: p.notYourTeam, form: moveFormWords, used: p.used,
		off: p.off, notAnswering: p.notAnswering, notSent: p.notSent}
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

// lineupSentence is the move as the member confirms it: "Start Rachaad
// White over Tank Bigsby at RB, and Jauan Jennings over Josh Downs in the
// flex, on ESPN now." name is each player's name by his id on the
// platform.
func lineupSentence(changes []apitypes.HostMoveChange, name func(id string) string, p platformWords) string {
	clauses := make([]string, 0, len(changes))
	for _, c := range changes {
		clause := name(c.In)
		if c.Out != nil {
			clause += " over " + name(*c.Out)
		}
		clauses = append(clauses, clause+" "+slotPlace(c.Slot))
	}
	return "Start " + andClauses(clauses) + p.now
}
