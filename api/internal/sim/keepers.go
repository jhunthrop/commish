package sim

import "github.com/jhunthrop/commish/api/internal/draft"

// KeeperKey is one seat's pick in one round.
type KeeperKey struct {
	TeamID string
	Round  int
}

// Keepers is the players kept, by seat and round. A kept player is that
// seat's pick in that round, forced exactly as the room forces it, and
// nobody else's to draft before then.
type Keepers map[KeeperKey]string

// Forced is the kept player for the seat on the clock at s's pick, if any.
func (k Keepers) Forced(s draft.State, teamID string) (string, bool) {
	if len(k) == 0 {
		return "", false
	}
	id, ok := k[KeeperKey{TeamID: teamID, Round: draft.RoundForPick(len(s.DraftOrder), s.PickNumber)}]
	return id, ok
}

// HeldBack is every kept player not yet drafted: off the board for every
// pick but his own.
func (k Keepers) HeldBack(s draft.State) map[string]bool {
	if len(k) == 0 {
		return nil
	}
	taken := draft.TakenOn(s)
	out := make(map[string]bool, len(k))
	for _, id := range k {
		if !taken.Has(id) {
			out[id] = true
		}
	}
	return out
}

// IDs is every kept player.
func (k Keepers) IDs() map[string]bool {
	out := make(map[string]bool, len(k))
	for _, id := range k {
		out[id] = true
	}
	return out
}

// union is a and b together; either alone when the other is empty, so a
// room without keepers draws from exactly the board it always did.
func union(a, b map[string]bool) map[string]bool {
	switch {
	case len(b) == 0:
		return a
	case len(a) == 0:
		return b
	}
	out := make(map[string]bool, len(a)+len(b))
	for id := range a {
		out[id] = true
	}
	for id := range b {
		out[id] = true
	}
	return out
}
