package advisor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// The advisor call's shape limits.
const (
	// undraftedSent is how deep into the undrafted pool, in the order
	// drafters take players, the request reaches. The closed form's cost
	// grows with the pool, and no call or odds the room shows reach past
	// this depth; every drafted player is always sent.
	undraftedSent = 400
	shortlistSize = 5
	// unpricedADPFrom is where a player no ADP source has is placed in the
	// advisor's queue: after every priced player, in pool order.
	unpricedADPFrom = 1000
	maxResponse     = 2 << 20
)

// HTTP is the research lane's advisor service.
type HTTP struct {
	// BaseURL is ADVISOR_URL, e.g. http://advisor:8080.
	BaseURL string
	Client  *http.Client
}

type wirePool struct {
	ID              string   `json:"id"`
	Position        string   `json:"position"`
	ADP             float64  `json:"adp"`
	ProjectedPoints *float64 `json:"projectedPoints"`
}

type wirePick struct {
	PickNumber int    `json:"pickNumber"`
	PlayerID   string `json:"playerId"`
	Seat       int    `json:"seat"`
}

type wireRequest struct {
	TeamCount     int                `json:"teamCount"`
	RosterSlots   []draft.SlotConfig `json:"rosterSlots"`
	Pool          []wirePool         `json:"pool"`
	Picks         []wirePick         `json:"picks"`
	SeatOnClock   int                `json:"seatOnClock"`
	ShortlistSize int                `json:"shortlistSize"`
}

type wireResponse struct {
	OK    bool    `json:"ok"`
	Error *string `json:"error"`
	Data  struct {
		PickNumber     int  `json:"pickNumber"`
		NextPickNumber *int `json:"nextPickNumber"`
		Shortlist      []struct {
			PlayerID string `json:"playerId"`
			Why      string `json:"why"`
		} `json:"shortlist"`
		Survival map[string]float64 `json:"survival"`
	} `json:"data"`
}

// seatOf is a team's 1-based draft slot.
func seatOf(order []string, teamID string) int {
	for i, t := range order {
		if t == teamID {
			return i + 1
		}
	}
	return 0
}

func (h HTTP) request(req Request) (wireRequest, error) {
	s := req.State
	seat := seatOf(s.DraftOrder, req.TeamID)
	if seat == 0 {
		return wireRequest{}, fmt.Errorf("advisor: %s is not in the draft", req.TeamID)
	}
	out := wireRequest{
		TeamCount: len(s.DraftOrder), RosterSlots: s.Config.SlotConfig, SeatOnClock: seat, ShortlistSize: shortlistSize,
		Picks: make([]wirePick, 0, len(s.Picks)),
	}
	drafted := map[string]bool{}
	for _, p := range s.Picks {
		drafted[p.PlayerID] = true
		out.Picks = append(out.Picks, wirePick{PickNumber: p.PickNumber, PlayerID: p.PlayerID, Seat: seatOf(s.DraftOrder, p.TeamID)})
	}
	held := req.Keepers.HeldBack(s)
	undrafted := 0
	for i, p := range req.Board.Raw.Players {
		if held[p.ID] {
			continue
		}
		if !drafted[p.ID] {
			if undrafted >= undraftedSent {
				continue
			}
			undrafted++
		}
		adp := float64(unpricedADPFrom + i)
		if p.ADP != nil && *p.ADP > 0 {
			adp = *p.ADP
		}
		out.Pool = append(out.Pool, wirePool{ID: p.ID, Position: string(p.Position), ADP: adp, ProjectedPoints: p.Points})
	}
	return out, nil
}

// Card asks the service for the seat on the clock.
func (h HTTP) Card(ctx context.Context, req Request) (Card, error) {
	body, err := h.request(req)
	if err != nil {
		return Card{}, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return Card{}, fmt.Errorf("advisor: encode: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(h.BaseURL, "/")+"/advise", bytes.NewReader(raw))
	if err != nil {
		return Card{}, fmt.Errorf("advisor: request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := h.Client.Do(httpReq)
	if err != nil {
		return Card{}, fmt.Errorf("advisor: call: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var wire wireResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(&wire); err != nil {
		return Card{}, fmt.Errorf("advisor: decode (status %d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK || !wire.OK {
		msg := ""
		if wire.Error != nil {
			msg = *wire.Error
		}
		return Card{}, fmt.Errorf("advisor: status %d: %s", resp.StatusCode, msg)
	}
	if len(wire.Data.Shortlist) == 0 {
		return Card{}, fmt.Errorf("advisor: an empty shortlist at pick %d", wire.Data.PickNumber)
	}
	card := Card{
		PickNumber: wire.Data.PickNumber, NextPick: wire.Data.NextPickNumber, Source: SourceAdvisor,
		Call: wire.Data.Shortlist[0].PlayerID, StillThere: wire.Data.Survival,
	}
	for _, c := range wire.Data.Shortlist {
		card.Shortlist = append(card.Shortlist, Candidate{PlayerID: c.PlayerID, Why: c.Why})
	}
	return card, nil
}
