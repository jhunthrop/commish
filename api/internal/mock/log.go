package mock

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mocks"
)

// oddsKey is where a MAKE_PICK row's payload carries the odds the room
// showed with the pick, and byKey who made a pick the drafter's own hand
// did not. draft.ParseAction ignores both.
const (
	oddsKey = "odds"
	byKey   = "by"
)

// LogEntries is the mock's actions as app.mock_actions rows for
// mocks.Store.AppendActions, from the 1-based sequence from on (1 for the
// whole log, len(before)+1 for a batch). The kind is the action type and
// the payload the persisted action itself, plus "odds" on a drafter's
// pick that carried them, so the log replays through draft.ParseAction.
func LogEntries(d Draft, from int) ([]mocks.Action, error) {
	if from < 1 || from > len(d.Actions)+1 {
		return nil, fmt.Errorf("mock: no action %d in a log of %d", from, len(d.Actions))
	}
	out := make([]mocks.Action, 0, len(d.Actions)-from+1)
	for seq := from; seq <= len(d.Actions); seq++ {
		a := d.Actions[seq-1]
		raw, err := json.Marshal(a)
		if err != nil {
			return nil, fmt.Errorf("mock: encode action %d: %w", seq, err)
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, fmt.Errorf("mock: payload %d: %w", seq, err)
		}
		if odds, ok := d.Odds[seq]; ok {
			payload[oddsKey] = odds
		}
		if by, ok := d.By[seq]; ok {
			payload[byKey] = by
		}
		ms, err := draft.ParseMillis(a.Timestamp)
		if err != nil {
			return nil, fmt.Errorf("mock: action %d time: %w", seq, err)
		}
		out = append(out, mocks.Action{Kind: string(a.Type), Payload: payload, At: time.UnixMilli(ms).UTC()})
	}
	return out, nil
}

// FromLog rebuilds a mock from its stored rows (payloads in sequence
// order): the actions, the odds recorded with the drafter's picks, and the
// state they replay to.
func FromLog(s Settings, seed uint32, payloads []json.RawMessage) (Draft, error) {
	config, err := Config(s, seed)
	if err != nil {
		return Draft{}, err
	}
	d := Draft{Config: config, Slot: HumanSlot(s.League, seed)}
	d.HumanTeamID = SeatID(d.Slot)
	for i, raw := range payloads {
		a, err := draft.ParseAction(raw)
		if err != nil {
			return Draft{}, fmt.Errorf("mock: log row %d: %w", i+1, err)
		}
		d.Actions = append(d.Actions, a)
		var carried struct {
			Odds *PickOdds `json:"odds"`
			By   string    `json:"by"`
		}
		if err := json.Unmarshal(raw, &carried); err != nil {
			return Draft{}, fmt.Errorf("mock: log row %d odds: %w", i+1, err)
		}
		if carried.Odds != nil {
			if d.Odds == nil {
				d.Odds = map[int]PickOdds{}
			}
			d.Odds[i+1] = *carried.Odds
		}
		if carried.By != "" {
			if d.By == nil {
				d.By = map[int]string{}
			}
			d.By[i+1] = carried.By
		}
	}
	if d.State, err = draft.Replay(config, d.Actions); err != nil {
		return Draft{}, err
	}
	team, onClock := draft.TeamOnClock(d.State)
	d.Waiting = onClock && team == d.HumanTeamID
	return d, nil
}
