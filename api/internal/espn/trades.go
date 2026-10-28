package espn

// The member's pending trade offers (Lane 279, B263): the league's queue
// (view=mPendingTransactions) read with the member's cookies lists the
// open TRADE_PROPOSAL rows that name their team, one TRADE item per
// player with the team it leaves and the team it joins, the proposer as
// the row's teamId, and the offer's expirationDate in epoch milliseconds
// (jwulff/fantasy-sports docs/research/07-espn-trade-surface.md, row 4 and
// t1-pending.json, captured live 2026-10-16; the incoming direction read
// live in production by dustinJ15/fantasy src/ff/sources/espn.py
// pending_trades). An accepted trade in its review period stays in the
// queue as TRADE_ACCEPT and is not an open offer. Nothing here writes.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// Bounds on one offer: a trade moves a handful of players, never a roster.
const maxTradeLegs = 16

// The queue's words for an open offer.
const (
	tradeProposal = "TRADE_PROPOSAL"
	tradeItem     = "TRADE"
	statusPending = "PENDING"
	cancelRow     = "CANCEL"
)

// PendingTrade is one open trade proposal in a league's queue.
type PendingTrade struct {
	// ID is ESPN's transaction id for the proposal.
	ID string
	// Proposer is the team that made the offer (the row's teamId).
	Proposer int
	// Legs are the players the trade moves, each from one team to another.
	Legs []TradeLeg
	// ProposedAt and ExpiresAt are ESPN's stamps, nil when the row has none.
	ProposedAt *time.Time
	ExpiresAt  *time.Time
}

// TradeLeg is one player a trade moves.
type TradeLeg struct {
	PlayerID string
	From, To int
}

type wireTradeQueue struct {
	ID       int64           `json:"id"`
	SeasonID int             `json:"seasonId"`
	Pending  *[]wireTradeRow `json:"pendingTransactions"`
}

type wireTradeRow struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Status        string `json:"status"`
	ExecutionType string `json:"executionType"`
	TeamID        int    `json:"teamId"`
	ProposedDate  int64  `json:"proposedDate"`
	Expiration    int64  `json:"expirationDate"`
	Items         []struct {
		PlayerID   int    `json:"playerId"`
		Type       string `json:"type"`
		FromTeamID int    `json:"fromTeamId"`
		ToTeamID   int    `json:"toTeamId"`
	} `json:"items"`
}

// PendingTrades reads the league's queue with the member's cookies and
// answers its open trade proposals, any team's the cookies are shown.
func (c *Client) PendingTrades(ctx context.Context, cookies Cookies, league string, season int) ([]PendingTrade, error) {
	if !leagueID.MatchString(league) || season < minSeason || season > maxSeason {
		return nil, ErrNotALink
	}
	q := url.Values{"view": {"mPendingTransactions"}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, season, league, q.Encode())
	body, err := c.get(ctx, path, &cookies, maxBody)
	if err != nil {
		return nil, err
	}
	return ParsePendingTrades(body, league, season)
}

// ParsePendingTrades is the open trade proposals of a queue answer. A
// private league with nothing queued answers its envelope with no queue
// key at all (jwulff docs/memory/espn-omits-an-empty-pending-queue.md):
// the league's own envelope without the key is an empty queue, and a body
// that is not this league's envelope is ErrMalformed, never empty.
func ParsePendingTrades(body []byte, league string, season int) ([]PendingTrade, error) {
	var w wireTradeQueue
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	if strconv.FormatInt(w.ID, 10) != league || w.SeasonID != season {
		return nil, fmt.Errorf("%w: not the league's queue", ErrMalformed)
	}
	if w.Pending == nil {
		return []PendingTrade{}, nil
	}
	if len(*w.Pending) > maxPending {
		return nil, fmt.Errorf("%w: %d queued rows", ErrMalformed, len(*w.Pending))
	}
	out := []PendingTrade{}
	for _, row := range *w.Pending {
		if t, ok := row.trade(); ok {
			out = append(out, t)
		}
	}
	return out, nil
}

// trade is the row as an open proposal, false for any other row: a claim,
// a cancel, an accepted trade, or a proposal with no players or too many.
func (row wireTradeRow) trade() (PendingTrade, bool) {
	if row.Type != tradeProposal || row.Status != statusPending || row.ExecutionType == cancelRow || row.ID == "" || len(row.ID) > 64 {
		return PendingTrade{}, false
	}
	t := PendingTrade{ID: row.ID, Proposer: row.TeamID, ProposedAt: millis(row.ProposedDate), ExpiresAt: millis(row.Expiration)}
	for _, it := range row.Items {
		if it.Type != tradeItem || it.PlayerID <= 0 || it.FromTeamID <= 0 || it.ToTeamID <= 0 {
			continue
		}
		t.Legs = append(t.Legs, TradeLeg{PlayerID: strconv.Itoa(it.PlayerID), From: it.FromTeamID, To: it.ToTeamID})
	}
	if len(t.Legs) == 0 || len(t.Legs) > maxTradeLegs || t.Proposer <= 0 {
		return PendingTrade{}, false
	}
	return t, true
}

// millis is an ESPN stamp in epoch milliseconds, nil for none.
func millis(ms int64) *time.Time {
	if ms <= 0 {
		return nil
	}
	at := time.UnixMilli(ms).UTC()
	return &at
}
