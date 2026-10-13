package companion

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/entitlements"
)

// seedOf seeds the engine's runs for a host draft, so its fallback card
// is the same twice.
func seedOf(hostDraftID string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(hostDraftID))
	return h.Sum32()
}

// storedCard is the pick's card: the one stored, or the advisor's (the
// engine's when the advisor does not answer), stored the first time.
func (s *Service) storedCard(ctx context.Context, f followed) (advisor.Card, error) {
	pick := f.built.Draft.State.PickNumber
	raw, ok, err := s.Store.Card(ctx, f.row.ID, pick)
	if err != nil {
		return advisor.Card{}, err
	}
	if !ok {
		st := f.built.Draft.State
		c, err := s.Advisor.Card(ctx, advisor.Request{
			State: st, TeamID: f.built.Draft.HumanTeamID, Board: f.board, Teams: len(st.DraftOrder), Seed: seedOf(f.row.HostDraftID),
		})
		if err != nil {
			return advisor.Card{}, err
		}
		if err := s.Store.PutCard(ctx, f.row.ID, pick, draftroom.Trim(c, st)); err != nil {
			return advisor.Card{}, err
		}
		// Two viewers at once: the first card written is the one both see.
		if raw, ok, err = s.Store.Card(ctx, f.row.ID, pick); err != nil || !ok {
			if err == nil {
				err = fmt.Errorf("companion: card at %d vanished", pick)
			}
			return advisor.Card{}, err
		}
	}
	var c advisor.Card
	if err := json.Unmarshal(raw, &c); err != nil {
		return advisor.Card{}, fmt.Errorf("companion: decode card at %d: %w", pick, err)
	}
	return c, nil
}

// cardFor is the card at the drafter's turn, shaped by what the account
// has: the pass shows the call's why, full_reasoning every row's, and
// range_of_outcomes the shortlist's floor, median and ceiling.
func (s *Service) cardFor(ctx context.Context, f followed) (*apitypes.RoomCard, *map[string]apitypes.OutcomeRange, error) {
	c, err := s.storedCard(ctx, f)
	if err != nil {
		return nil, nil, err
	}
	full, err := s.can(ctx, f.row.AccountID, entitlements.FullReasoning)
	if err != nil {
		return nil, nil, err
	}
	if !full {
		for i := 1; i < len(c.Shortlist); i++ {
			c.Shortlist[i].Why = ""
		}
	}
	view := draftroom.CardView(c, f.built.Draft.State.PickNumber, false)
	withRange, err := s.can(ctx, f.row.AccountID, entitlements.RangeOfOutcomes)
	if err != nil || !withRange {
		return &view, nil, err
	}
	ranges := map[string]apitypes.OutcomeRange{}
	byID := map[string]int{}
	for i, p := range f.board.Raw.Players {
		byID[p.ID] = i
	}
	for _, cand := range c.Shortlist {
		if i, ok := byID[cand.PlayerID]; ok && f.board.Raw.Players[i].Range != nil {
			r := f.board.Raw.Players[i].Range
			ranges[cand.PlayerID] = apitypes.OutcomeRange{Floor: round1(r.Floor), Median: round1(r.Median), Ceiling: round1(r.Ceiling)}
		}
	}
	return &view, &ranges, nil
}

// conditionalFor is the call if the board holds to the drafter's next
// pick, made on each new pick and kept for every viewer of it.
func (s *Service) conditionalFor(ctx context.Context, f followed) (*apitypes.RoomCard, error) {
	key := conditionalKey{companion: f.row.ID, picks: len(f.read.Picks)}
	if card, ok := s.conditional.Get(key); ok {
		return &card, nil
	}
	st := f.built.Draft.State
	c, err := s.Engine.Conditional(ctx, advisor.Request{
		State: st, TeamID: f.built.Draft.HumanTeamID, Board: f.board, Teams: len(st.DraftOrder), Seed: seedOf(f.row.HostDraftID),
	})
	if err != nil {
		return nil, err
	}
	view := draftroom.CardView(draftroom.Trim(c, st), *c.NextPick, true)
	s.conditional.Put(key, view)
	return &view, nil
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }

func (s *Service) can(ctx context.Context, accountID uuid.UUID, f entitlements.Feature) (bool, error) {
	return s.Entitlements.Can(ctx, accountID, f, s.Now())
}
