package entitlements

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
)

// FreeSeason is the season every member holds every feature in, with no
// row written (founder ruling 2026-10-22: the 2026 season is free and
// billing stays off). Zero is no free season, and the tables alone
// answer. It is FREE_SEASON, read once at start.
type FreeSeason int

// NoFreeSeason is the zero FreeSeason: the paid tiers are on.
const NoFreeSeason FreeSeason = 0

// Open reports whether now falls in the free season: from its start
// until EndsAt, the same end a pass for that season has.
func (f FreeSeason) Open(now time.Time) bool {
	return f != NoFreeSeason && season.Of(now) == int(f)
}

// EndsAt is when the free season ends: March 1 UTC after it, 2027-03-01
// for 2026 (season.End, the one rule).
func (f FreeSeason) EndsAt() time.Time { return season.End(int(f)) }
