package solo

import (
	"sync"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sim"
)

// view is the room on the wire. withBoard adds the board, which a page
// reads once; a pick's answer leaves it off.
func view(r room, withBoard bool) (apitypes.MockRoom, error) {
	code, err := shareCodeOf(r)
	if err != nil {
		return apitypes.MockRoom{}, err
	}
	s := r.draft.State
	status := apitypes.MockStatusActive
	if draft.IsComplete(s) {
		status = apitypes.MockStatusComplete
	}
	out := apitypes.MockRoom{
		LeagueId: r.mock.LeagueId, Status: status, Seed: int64(r.seed), Settings: r.settings.League,
		Teams: len(s.DraftOrder), Rounds: leagues.Rounds(r.settings.League), Slot: r.draft.Slot, PickNumber: s.PickNumber,
		OnClock: draftroom.OnClock(s), Waiting: r.draft.Waiting, Picks: draftroom.Picks(s), Seq: r.head, ShareCode: *code,
		CreatedAt: r.mock.CreatedAt, Queue: append([]string{}, draft.QueueFor(s, r.draft.HumanTeamID)...),
	}
	if r.mock.Id != uuid.Nil {
		id := r.mock.Id
		out.Id = &id
	}
	if r.sharer != "" {
		sharer := r.sharer
		out.SharedBy = &sharer
	}
	if withBoard {
		b := draftroom.BoardView(r.board, nil)
		out.Board = &b
	}
	return out, nil
}

// shareCodeOf is the link that replays the room as it stands.
func shareCodeOf(r room) (*string, error) {
	picks, forYou := sharedPicks(r)
	code, err := encodeShare(share{
		V: shareVersion, Settings: r.settings.League, Seed: int64(r.seed), Picks: picks, ForYou: forYou, Sharer: r.sharer,
	})
	if err != nil {
		return nil, err
	}
	return &code, nil
}

// sharedPicks is the drafter's own picks in order, keepers left out
// because the settings force them, and the places in that list a
// stand-in made. A solo log's picks are its MAKE_PICK actions one for
// one, so the k-th MAKE_PICK is the state's k-th pick.
func sharedPicks(r room) (picks []string, forYou []int) {
	keepers := mock.KeepersOf(r.settings.League)
	human := r.draft.HumanTeamID
	made := r.draft.State.Picks
	k := 0
	for i, a := range r.draft.Actions {
		if a.Type != draft.MakePick {
			continue
		}
		if k >= len(made) {
			break
		}
		p := made[k]
		k++
		if p.TeamID != human || keepers[sim.KeeperKey{TeamID: human, Round: p.Round}] == p.PlayerID {
			continue
		}
		if _, ok := r.draft.By[i+1]; ok {
			forYou = append(forYou, len(picks))
		}
		picks = append(picks, p.PlayerID)
	}
	return picks, forYou
}

// sharedReports keeps the last few shared reports: a link passed around
// is opened many times, and each report is 200 runs and, with no recorded
// odds, the engine's hindsight for every pick.
type sharedReports struct {
	mu      sync.Mutex
	entries map[string]apitypes.MockReport
}

// maxSharedReports bounds the cache; past it the cache starts over.
const maxSharedReports = 64

func (c *sharedReports) get(code string) (apitypes.MockReport, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	out, ok := c.entries[code]
	return out, ok
}

func (c *sharedReports) put(code string, out apitypes.MockReport) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil || len(c.entries) >= maxSharedReports {
		c.entries = map[string]apitypes.MockReport{}
	}
	c.entries[code] = out
}
