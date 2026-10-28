package boards

import (
	"context"
	"time"
)

// DesignationPair is the two newest injury captures that read, of one
// source: what the provider lists now and what it listed just before, so
// a change in a player's status reads as the difference (Lane 262, the
// starter status push). Codes only: the return dates and the datings are
// the screens' concern, not a change's.
type DesignationPair struct {
	Newer   map[string]Designation
	Older   map[string]Designation
	NewerAt time.Time
	OlderAt time.Time
}

// pairTried is how many of a source's newest captures the pair read takes:
// the floor (readableAt) may refuse a short list, so a few more than two.
const pairTried = capturesTried + 2

// DesignationPair is the newest two readable captures of the source
// Designations reads (the by-date list, else the roster sweep), found
// false when that source holds fewer than two that read. A capture the
// floor refuses is passed over, as Designations passes it over, so a
// cut-short list never reads as everyone cleared.
func (s *PGSource) DesignationPair(ctx context.Context) (DesignationPair, bool, error) {
	for _, source := range []string{injuriesByDate, injuriesRosterWide} {
		captures, err := s.captures(ctx, source, pairTried, time.Time{})
		if err != nil {
			return DesignationPair{}, false, err
		}
		if len(captures) == 0 {
			continue
		}
		pair, ok := pairOf(source, captures)
		return pair, ok, nil
	}
	return DesignationPair{}, false, nil
}

// pairOf is the first two captures, newest first, that read.
func pairOf(source string, captures []capture) (DesignationPair, bool) {
	var read []capture
	for i := range captures {
		if readableAt(captures, i) == nil {
			read = append(read, captures[i])
		}
		if len(read) == 2 {
			break
		}
	}
	if len(read) < 2 {
		return DesignationPair{}, false
	}
	return DesignationPair{
		Newer: designationsOf(source, read[0]), Older: designationsOf(source, read[1]),
		NewerAt: read[0].at.UTC(), OlderAt: read[1].at.UTC(),
	}, true
}

// designationsOf is one capture's designations by the board's player id.
func designationsOf(source string, c capture) map[string]Designation {
	out := make(map[string]Designation, len(c.entries))
	for id, e := range c.entries {
		out[id] = Designation{Code: e.code, Note: e.note, AsOf: c.at.UTC(), Source: source}
	}
	return out
}
