package companion

import (
	"strings"
	"sync"
	"unicode"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Matcher places a host's pick on our board: the board player the host
// drafted, or false when we cannot say who he is. Until the players
// table carries the host's own ids (Lane 8 part A), the match is by
// name and position, a defense by its team.
type Matcher interface {
	// Match is the board id and the rule that placed him.
	Match(raw *boards.Raw, p sleeper.Pick) (id, how string, ok bool)
}

// How a name is matched, counted both ways in the lane's report.
const (
	MatchExact      = "exact"
	MatchNormalized = "normalized"
)

// NameMatcher matches by exact name and position first, then by the name
// with punctuation, case and a generational suffix (Jr, Sr, II to V)
// folded, so "James Cook" on the host is "James Cook III" on our board.
// A name two of our players share at a position is never guessed.
type NameMatcher struct {
	mu     sync.Mutex
	raw    *boards.Raw
	exact  map[string]string
	folded map[string]string
}

type nameIndex struct {
	exact  map[string]string
	folded map[string]string
}

// ambiguous marks a key two players share.
const ambiguous = ""

func put(m map[string]string, key, id string) {
	if prev, ok := m[key]; ok && prev != id {
		m[key] = ambiguous
		return
	}
	m[key] = id
}

func buildIndex(raw *boards.Raw) nameIndex {
	idx := nameIndex{exact: map[string]string{}, folded: map[string]string{}}
	for _, p := range raw.Players {
		if p.Position == draft.DEF {
			put(idx.exact, defenseKey(p.Team), p.ID)
			continue
		}
		put(idx.exact, string(p.Position)+"|"+p.Name, p.ID)
		put(idx.folded, string(p.Position)+"|"+fold(p.Name), p.ID)
	}
	return idx
}

func (m *NameMatcher) index(raw *boards.Raw) nameIndex {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.raw != raw {
		idx := buildIndex(raw)
		m.raw, m.exact, m.folded = raw, idx.exact, idx.folded
	}
	return nameIndex{exact: m.exact, folded: m.folded}
}

// Match is the board id of the host's pick and which rule placed him.
func (m *NameMatcher) Match(raw *boards.Raw, p sleeper.Pick) (string, string, bool) {
	idx := m.index(raw)
	pos := hostPosition(p.Position)
	if pos == draft.DEF {
		id := idx.exact[defenseKey(p.Team)]
		return id, MatchExact, id != ambiguous
	}
	if id := idx.exact[string(pos)+"|"+p.Name]; id != ambiguous {
		return id, MatchExact, true
	}
	id := idx.folded[string(pos)+"|"+fold(p.Name)]
	return id, MatchNormalized, id != ambiguous
}

func defenseKey(team string) string { return "DEF|" + strings.ToUpper(team) }

// hostPosition is the engine's position for the host's: Sleeper writes
// a defense as DEF, as the engine does.
func hostPosition(p string) draft.Position { return draft.Position(strings.ToUpper(p)) }

func suffixes() map[string]bool {
	return map[string]bool{"jr": true, "sr": true, "ii": true, "iii": true, "iv": true, "v": true}
}

// fold is a name with case, punctuation and a trailing generational
// suffix taken off: "D.J. Moore Jr." reads "dj moore".
func fold(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case unicode.IsSpace(r) || r == '-':
			b.WriteRune(' ')
		}
	}
	words := strings.Fields(b.String())
	if n := len(words); n > 1 && suffixes()[words[n-1]] {
		words = words[:n-1]
	}
	return strings.Join(words, " ")
}
