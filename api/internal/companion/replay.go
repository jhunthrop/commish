package companion

import (
	"embed"
	"fmt"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// The development replay (COMPANION_REPLAY, refused in production by
// internal/config): a completed 2026 Sleeper draft recorded on
// 2026-10-13 (12 teams, 20 rounds, PPR scoring, 21 keepers), replayed one
// pick a second from the moment its companion is made, so the page is
// built and shot without a live draft.

//go:embed replay/draft.json replay/picks.json replay/league.json
var replayFiles embed.FS

// ReplayDraftID is the recorded draft's id: POST /companions with this
// draft and replay true.
const ReplayDraftID = "1382163311050645504"

// replayLeagueID is the recorded draft's league.
const replayLeagueID = "1382163311038038016"

// ReplayPace is how fast the replay drafts, and ReplayHold how long it
// waits at each of the drafter's own picks, the way a drafter takes a
// moment on the clock, so the card is on screen long enough to read.
const (
	ReplayPace = time.Second
	ReplayHold = 12 * time.Second
)

// Replay is the recorded draft.
type Replay struct {
	Draft  sleeper.Draft
	Picks  []sleeper.Pick
	League sleeper.League
}

// LoadReplay reads the fixture through the same checks a live answer
// gets.
func LoadReplay() (Replay, error) {
	read := func(name string) ([]byte, error) { return replayFiles.ReadFile("replay/" + name) }
	body, err := read("draft.json")
	if err != nil {
		return Replay{}, err
	}
	d, err := sleeper.DecodeDraft(body, ReplayDraftID)
	if err != nil {
		return Replay{}, fmt.Errorf("companion: replay draft: %w", err)
	}
	if body, err = read("picks.json"); err != nil {
		return Replay{}, err
	}
	picks, err := sleeper.DecodePicks(body, d.Teams, d.Rounds)
	if err != nil {
		return Replay{}, fmt.Errorf("companion: replay picks: %w", err)
	}
	if body, err = read("league.json"); err != nil {
		return Replay{}, err
	}
	league, err := sleeper.DecodeLeague(body, replayLeagueID)
	if err != nil {
		return Replay{}, fmt.Errorf("companion: replay league: %w", err)
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].PickNo < picks[j].PickNo })
	return Replay{Draft: d, Picks: picks, League: league}, nil
}

// At is the recorded draft as it stood elapsed after the replay began:
// one pick a second, a hold before each of seat's picks, drafting until
// the last pick lands.
func (r Replay) At(elapsed time.Duration, seat int) Snapshot {
	n := 0
	var clock time.Duration
	for _, p := range r.Picks {
		step := ReplayPace
		if p.Slot == seat {
			step += ReplayHold
		}
		if clock+step > elapsed {
			break
		}
		clock += step
		n++
	}
	d := r.Draft
	d.Status = sleeper.StatusDrafting
	if n == len(r.Picks) {
		d.Status = sleeper.StatusComplete
	}
	return Snapshot{Draft: d, Picks: append([]sleeper.Pick(nil), r.Picks[:n]...)}
}
