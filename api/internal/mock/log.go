package mock

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mocks"
)

// LogEntries is the actions as app.mock_actions rows for
// mocks.Store.AppendActions: the kind is the action type, the payload the
// persisted action itself, so the log replays through draft.ParseAction.
func LogEntries(actions []draft.Action) ([]mocks.Action, error) {
	out := make([]mocks.Action, len(actions))
	for i, a := range actions {
		raw, err := json.Marshal(a)
		if err != nil {
			return nil, fmt.Errorf("mock: encode action %d: %w", i+1, err)
		}
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, fmt.Errorf("mock: payload %d: %w", i+1, err)
		}
		ms, err := draft.ParseMillis(a.Timestamp)
		if err != nil {
			return nil, fmt.Errorf("mock: action %d time: %w", i+1, err)
		}
		out[i] = mocks.Action{Kind: string(a.Type), Payload: payload, At: time.UnixMilli(ms).UTC()}
	}
	return out, nil
}

// ActionsFromLog reads app.mock_actions payloads back into actions.
func ActionsFromLog(payloads []json.RawMessage) ([]draft.Action, error) {
	out := make([]draft.Action, len(payloads))
	for i, raw := range payloads {
		a, err := draft.ParseAction(raw)
		if err != nil {
			return nil, fmt.Errorf("mock: log row %d: %w", i+1, err)
		}
		out[i] = a
	}
	return out, nil
}
