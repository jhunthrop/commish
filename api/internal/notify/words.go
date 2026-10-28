package notify

import "fmt"

// unnamedStarter stands in for a starter the host's directory does not
// name yet.
const unnamedStarter = "One of your starters"

// maxNameRunes bounds a player's or a league's name in a push, so a title
// and a body stay inside the outbox's bounds.
const maxNameRunes = 60

// cut is s to n runes.
func cut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// starterHeadline is each change's title after the player's name.
var starterHeadline = map[StatusChange]string{
	ChangeOut:            "is out",
	ChangeDoubtful:       "is doubtful",
	ChangeCleared:        "is cleared to play",
	ChangeInjuredReserve: "is on injured reserve",
	ChangeActivated:      "is activated",
}

// starterLine is each change's sentence, what the member may want to do.
var starterLine = map[StatusChange]string{
	ChangeOut:            "Set a replacement before his game.",
	ChangeDoubtful:       "Have a replacement ready before his game.",
	ChangeCleared:        "He no longer carries an injury designation.",
	ChangeInjuredReserve: "Move him to a reserve slot if your league has one.",
	ChangeActivated:      "He is off his list and can play again.",
}

// starterWords is a starter status push's title and body. leagues is how
// many of the member's lineups start him.
func starterWords(c StatusChange, name, league string, leagues int) (string, string) {
	if name == "" {
		name = unnamedStarter
	}
	name, league = cut(name, maxNameRunes), cut(league, maxNameRunes)
	where := fmt.Sprintf("He starts in your %s lineup.", league)
	switch {
	case leagues > 1:
		where = fmt.Sprintf("He starts in %d of your lineups.", leagues)
	case league == "":
		where = "He is in your starting lineup."
	}
	return name + " " + starterHeadline[c], where + " " + starterLine[c]
}
