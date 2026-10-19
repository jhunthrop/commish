package inseason

import (
	"fmt"
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Line is what a sentence knows about one player: the facts and our
// order, nothing more.
type Line struct {
	Name     string
	Position draft.Position
	// Rank is his place at his position in our order, 0 when unranked.
	Rank int
	// PerWeek is points over replacement a week, nil without one.
	PerWeek *float64
	// Proj is this week's projection as the screen prints it, nil
	// without one (Lane 66e).
	Proj  *float64
	Facts Facts
}

func (l Line) short() string { return lastName(l.Name) }

// extremeRanks is how near the end of the 32 a defense's points allowed
// must sit to be named: the six that allow the most (§4.3's bottom six;
// its top six would argue against the start).
const extremeRanks = 6

// Writer writes one page's sentences from facts (§4.3, §5.1). Template
// words are the floor: each sentence takes the next of its frames, so no
// two changes on one page read alike, and the facts are never varied.
type Writer struct {
	Basis OrderBasis
	Now   time.Time
	used  map[string]int
}

// next is the frame to use from a kind's frames, moving that kind on
// for its next sentence.
func (w *Writer) next(frames []string) string {
	if w.used == nil {
		w.used = map[string]int{}
	}
	key := frames[0]
	i := w.used[key] % len(frames)
	w.used[key]++
	return frames[i]
}

func sentence(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, " ")
}

// Change is the reason ours starts over host (nil when the host's spot
// is empty): the bye or designation that forces it, else our order;
// then one supporting fact at most, only one that points the same way;
// then a questionable flag.
func (w *Writer) Change(ours Line, host *Line) string {
	reason := w.forced(ours, host)
	if reason == "" {
		reason = projectionWords(ours, *host)
	}
	if reason == "" {
		reason = w.order(ours, *host)
	}
	return sentence(reason, w.support(ours, host), w.questionable(ours))
}

// forced is the fact that keeps host out of the lineup, "" when none.
func (w *Writer) forced(ours Line, host *Line) string {
	if host == nil {
		frames := []string{"Your lineup has nobody in this spot, so %s starts.", "This spot is empty in your lineup, so %s takes it."}
		return fmt.Sprintf(w.next(frames), ours.Name)
	}
	f := host.Facts
	if f.Bye {
		frames := []string{"%s is on bye this week, so %s starts.", "With %s on bye this week, %s takes the spot."}
		return fmt.Sprintf(w.next(frames), host.Name, ours.short())
	}
	d := f.Designation
	if d == nil || d.Status == boards.StatusQuestionable {
		return ""
	}
	when := stampWords(d.AsOf, w.Now)
	if d.Status == boards.StatusDoubtful {
		// Both doubtful (nobody better eligible): the order decided it.
		if ours.Facts.Tier() != Available {
			return ""
		}
		frames := []string{"%s is doubtful as of %s and %s is not.", "With %s doubtful as of %s, %s starts."}
		return fmt.Sprintf(w.next(frames), host.Name, when, ours.short())
	}
	frames := []string{"%s is %s as of %s, so %s starts.", "With %s %s as of %s, %s takes the spot."}
	return fmt.Sprintf(w.next(frames), host.Name, statusWords(d.Status), when, ours.short())
}

// projectionWords is the change the advice rule makes (Lane 66e): the
// higher projection the screen shows, "" when either has none or they
// print alike (the order then decides, and says so).
func projectionWords(ours, host Line) string {
	if ours.Proj == nil || host.Proj == nil || *ours.Proj <= *host.Proj {
		return ""
	}
	return fmt.Sprintf("%s has %.1f Proj this week against %s's %.1f.", ours.short(), *ours.Proj, host.short(), *host.Proj)
}

// statusWords is a designation as a sentence says it.
func statusWords(status string) string {
	switch status {
	case boards.StatusInjuredReserve:
		return "on injured reserve"
	case boards.StatusSuspended:
		return "suspended"
	case boards.StatusPUP:
		return "on the PUP list"
	case boards.StatusNFI:
		return "on the NFI list"
	case boards.StatusDoubtful:
		return "doubtful"
	case boards.StatusQuestionable:
		return "questionable"
	}
	return "listed out"
}

// order is our order between two players: their ranks at one position,
// or the points over replacement a week between two positions.
func (w *Writer) order(ours, host Line) string {
	basis := orderWords(w.Basis)
	switch {
	case ours.Position == host.Position && ours.Rank > 0 && host.Rank > 0:
		frames := []string{"%s is %s in %s, %s %s.", "%s sits at %s in %s and %s at %s."}
		return fmt.Sprintf(w.next(frames), ours.short(), rankWords(ours.Position, ours.Rank), basis,
			host.short(), rankWords(host.Position, host.Rank))
	case ours.PerWeek != nil && host.PerWeek != nil:
		frames := []string{"%s gives you %s more points over replacement a week than %s on %s.",
			"On %[4]s, %[1]s is %[2]s points over replacement a week ahead of %[3]s."}
		return fmt.Sprintf(w.next(frames), ours.short(), points(*ours.PerWeek-*host.PerWeek), host.short(),
			numberWords(w.Basis))
	case ours.Rank > 0 && host.Rank == 0:
		return fmt.Sprintf("%s is %s in %s and %s is not in it.", ours.short(), rankWords(ours.Position, ours.Rank), basis, host.short())
	}
	return fmt.Sprintf("%s is ahead of %s in %s.", ours.short(), host.short(), basis)
}

// support is one fact for ours over host, and only one that favours
// him, so the reason never argues against the change (M1): his
// opponent's points allowed when it sits among the six most, else his
// last games when they beat the last games of the player he replaces.
// Otherwise the order stands alone.
func (w *Writer) support(l Line, host *Line) string {
	if a := l.Facts.Allowed; a != nil && l.Facts.Opponent != "" && a.Rank > a.Of-extremeRanks {
		return allowedWords(l.Facts.Opponent, *a)
	}
	if host == nil || !beats(l.Facts.LastGames, host.Facts.LastGames) {
		return ""
	}
	games := l.Facts.LastGames
	switch {
	case len(games) >= 2:
		frames := []string{"He scored %s and %s in his last two games under your league's scoring.",
			"His last two games came to %s and %s under your league's scoring."}
		return fmt.Sprintf(w.next(frames), points(games[0].Points), points(games[1].Points))
	case len(games) == 1:
		return fmt.Sprintf("He scored %s in his last game under your league's scoring.", points(games[0].Points))
	}
	return ""
}

// namedGames is how many of a player's last games a sentence names.
const namedGames = 2

// beats reports whether the games a sentence names (his last two, or
// one) average more than the other player's same games; false when
// either has none.
func beats(ours, theirs []GamePoints) bool {
	mean := func(games []GamePoints) (float64, bool) {
		n := min(len(games), namedGames)
		if n == 0 {
			return 0, false
		}
		sum := 0.0
		for _, g := range games[:n] {
			sum += g.Points
		}
		return sum / float64(n), true
	}
	a, okA := mean(ours)
	b, okB := mean(theirs)
	return okA && okB && a > b
}

// allowedWords is "Buffalo has allowed the 4th fewest points to running
// backs this season, 14.1 a game in your scoring."
func allowedWords(opponent string, a Allowed) string {
	end, n := "fewest", a.Rank
	if a.Rank > a.Of-extremeRanks {
		end, n = "most", a.Of-a.Rank+1
	}
	place := "the " + end
	if n > 1 {
		place = "the " + ordinal(n) + " " + end
	}
	club := placeOf(opponent)
	verb := "has"
	if strings.HasPrefix(club, "the ") {
		verb = "have"
	}
	return fmt.Sprintf("%s %s allowed %s points to %s this season, %s a game in your scoring.",
		capitalized(club), verb, place, positionPlural(a.Position), points(a.PointsAGame))
}

// questionable flags a questionable starter: check before kickoff.
func (w *Writer) questionable(l Line) string {
	d := l.Facts.Designation
	if d == nil || d.Status != boards.StatusQuestionable {
		return ""
	}
	return fmt.Sprintf("%s is questionable as of %s, so check before kickoff.", l.short(), stampWords(d.AsOf, w.Now))
}

// Waiver is a waiver row's sentence: the gain and the drop, or why he
// does not start for you.
func (w *Writer) Waiver(add Line, drop *Line, move Waiver) string {
	number := numberWords(w.Basis)
	switch {
	case move.NoDrop:
		return fmt.Sprintf("%s would start for you, but every player he could replace is held or starts.", add.Name)
	case positive(move.Gain) && !move.Starts:
		gain := fmt.Sprintf("%s does not start for you this week, and your lineup still gains %s points over replacement a week with him on %s.",
			add.Name, points(move.Gain), number)
		return sentence(gain, w.dropWords(drop))
	case positive(move.Gain):
		frames := []string{"%s starts for you, and your lineup gains %s points over replacement a week on %s.",
			"Adding %s raises your lineup by %s points over replacement a week on %s.",
			"%s would start, a gain of %s points over replacement a week to your lineup on %s."}
		gain := fmt.Sprintf(w.next(frames), add.Name, points(move.Gain), number)
		return sentence(gain, w.dropWords(drop))
	case add.Rank > 0:
		frames := []string{"%s is %s in %s and would not start for you.", "At %[2]s in %[3]s, %[1]s sits behind your starters."}
		return fmt.Sprintf(w.next(frames), add.Name, rankWords(add.Position, add.Rank), orderWords(w.Basis))
	}
	return fmt.Sprintf("%s is not in our order and would not start for you.", add.Name)
}

// Moves a starter's drop is said for: the trade's, and the waiver add's.
const (
	TradeMove = "the trade"
	AddMove   = "the add"
)

// StarterDrop is the sentence for a drop this week's lineup starts (Lane
// 66u): the spot he starts in, and the player the move brings in with the
// slot he actually takes, the lineup kept full; a chain of moves fills the
// rest. move is TradeMove or AddMove.
func (w *Writer) StarterDrop(drop, by Line, slot, bySlot, move string) string {
	if bySlot == slot {
		return fmt.Sprintf("%s starts at %s for you this week, and %s takes that spot after %s.", drop.short(), slot, by.short(), move)
	}
	return fmt.Sprintf("%s starts at %s for you this week. After %s %s starts at %s and your lineup stays full.",
		drop.short(), slot, move, by.short(), bySlot)
}

// dropWords names the drop, or says an open spot needs none.
func (w *Writer) dropWords(drop *Line) string {
	if drop == nil {
		return "Your open roster spot takes him with no drop."
	}
	frames := []string{"%s is the player it costs you least to lose.", "Drop %s, the player it costs you least to lose.",
		"The drop is %s, who costs you least to lose."}
	return fmt.Sprintf(w.next(frames), drop.Name)
}
