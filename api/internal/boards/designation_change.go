package boards

import (
	"context"
	"time"
)

// DesignationPair is two consecutive injury captures that read, of one
// source: what the provider listed at NewerAt and what it listed just
// before, so a change in a player's status reads as the difference (Lane
// 262, the starter status push). Codes only: the return dates and the
// datings are the screens' concern, not a change's.
type DesignationPair struct {
	Newer   map[string]Designation
	Older   map[string]Designation
	NewerAt time.Time
	OlderAt time.Time
}

// pairsTried is how many of a source's newest captures the pair read
// takes: a capture is stored only when the list changed, at most one an
// hour, so a few hours' window is a handful, and the floor may refuse a
// short one among them.
const pairsTried = 12

// DesignationPairs is every consecutive pair of readable captures of the
// source Designations reads (the by-date list, else the roster sweep)
// whose newer capture is at or after since, oldest first. A capture the
// floor refuses is passed over, as Designations passes it over, so a
// cut-short list never reads as everyone cleared. Walking every pair in
// the window, not only the newest, lets a producer that missed an hour
// catch up at the next (review H2).
func (s *PGSource) DesignationPairs(ctx context.Context, since time.Time) ([]DesignationPair, error) {
	for _, source := range []string{injuriesByDate, injuriesRosterWide} {
		captures, err := s.captures(ctx, source, pairsTried, time.Time{})
		if err != nil {
			return nil, err
		}
		if len(captures) == 0 {
			continue
		}
		return pairsOf(source, captures, since), nil
	}
	return nil, nil
}

// pairsOf is the readable captures, newest first, paired with the one
// before each, oldest pair first.
func pairsOf(source string, captures []capture, since time.Time) []DesignationPair {
	var read []capture
	for i := range captures {
		if readableAt(captures, i) == nil {
			read = append(read, captures[i])
		}
	}
	var out []DesignationPair
	for i := len(read) - 2; i >= 0; i-- {
		newer, older := read[i], read[i+1]
		if newer.at.Before(since) {
			continue
		}
		out = append(out, DesignationPair{
			Newer: designationsOf(source, newer), Older: designationsOf(source, older),
			NewerAt: newer.at.UTC(), OlderAt: older.at.UTC(),
		})
	}
	return out
}

// designationsOf is one capture's designations by the board's player id.
func designationsOf(source string, c capture) map[string]Designation {
	out := make(map[string]Designation, len(c.entries))
	for id, e := range c.entries {
		out[id] = Designation{Code: e.code, Note: e.note, AsOf: c.at.UTC(), Source: source}
	}
	return out
}
