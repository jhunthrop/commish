package yahoo

// The member's pending trades (Lane 279, B263). Yahoo lists a pending
// trade only to the teams in it, and only when the league's transactions
// collection is asked for that type with the team's key: "Pending
// transactions will not show up if you simply ask for all of the
// transactions in the league" (developer.yahoo.com/fantasysports/guide,
// Transaction resource; the filters table: "type with team_key:
// waiver,pending_trade"). Each is a pending_trade transaction with its
// status, the trader (who offered) and tradee team keys, when it was
// proposed, and one player per leg with the team he leaves and the team he
// joins. Yahoo states no expiry. Read with the member's read-only grant.

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Yahoo's words for an open offer.
const (
	pendingTrade   = "pending_trade"
	statusProposed = "proposed"
)

// Bounds on the pending read.
const (
	maxPendingTrades = 50
	maxTradeLegs     = 16
)

// PendingTrade is one trade Yahoo lists as proposed and not yet answered.
type PendingTrade struct {
	// Key is Yahoo's transaction key ("461.l.12345.pt.1").
	Key string
	// Trader is the team that offered, Tradee the team it is offered to.
	Trader, Tradee int
	ProposedAt     *time.Time
	Legs           []TradeLeg
}

// TradeLeg is one player a trade moves, from one team to another.
type TradeLeg struct {
	PlayerID string
	From, To int
}

type xmlPendingTrades struct {
	XMLName      xml.Name `xml:"fantasy_content"`
	Transactions []struct {
		Key      string      `xml:"transaction_key"`
		Type     string      `xml:"type"`
		Status   string      `xml:"status"`
		Trader   string      `xml:"trader_team_key"`
		Tradee   string      `xml:"tradee_team_key"`
		Proposed int64       `xml:"trade_proposed_time"`
		Players  []xmlPlayer `xml:"players>player"`
	} `xml:"league>transactions>transaction"`
}

// PendingTrades is the league's trades pending for the team, read with the
// member's access token.
func (c *Client) PendingTrades(ctx context.Context, access, leagueKey string, team int) ([]PendingTrade, error) {
	if team < 1 || team > MaxTeams {
		return nil, fmt.Errorf("%w: team %d", ErrNoSuchLeague, team)
	}
	teamKey := leagueKey + ".t." + strconv.Itoa(team)
	body, err := c.get(ctx, access, "league/"+leagueKey+"/transactions;team_key="+teamKey+";type="+pendingTrade)
	if err != nil {
		return nil, err
	}
	return ParsePendingTrades(body)
}

// ParsePendingTrades reads the collection's open offers: a pending_trade
// still proposed, with both teams and at least one player, each leg
// between those two teams. Any other row (an accepted trade waiting on the
// league, a waiver claim) is left out; a body that is not Yahoo's XML is
// ErrMalformed.
func ParsePendingTrades(body []byte) ([]PendingTrade, error) {
	var root xmlPendingTrades
	if err := xml.NewDecoder(bytes.NewReader(body)).Decode(&root); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	if len(root.Transactions) > maxPendingTrades {
		return nil, fmt.Errorf("%w: %d pending trades", ErrMalformed, len(root.Transactions))
	}
	out := []PendingTrade{}
	for _, tx := range root.Transactions {
		if tx.Type != pendingTrade || tx.Status != statusProposed || tx.Key == "" || len(tx.Key) > 64 {
			continue
		}
		_, trader, okTrader := splitTeamKey(tx.Trader)
		_, tradee, okTradee := splitTeamKey(tx.Tradee)
		if !okTrader || !okTradee || trader == tradee {
			continue
		}
		t := PendingTrade{Key: tx.Key, Trader: trader, Tradee: tradee}
		if tx.Proposed > 0 {
			at := time.Unix(tx.Proposed, 0).UTC()
			t.ProposedAt = &at
		}
		if legs, ok := tradeLegs(tx.Players, trader, tradee); ok {
			t.Legs = legs
			out = append(out, t)
		}
	}
	return out, nil
}

// tradeLegs is each player's move, false when one does not move between
// the trade's two teams or the trade moves none or too many.
func tradeLegs(players []xmlPlayer, a, b int) ([]TradeLeg, bool) {
	if len(players) == 0 || len(players) > maxTradeLegs {
		return nil, false
	}
	legs := make([]TradeLeg, 0, len(players))
	for _, p := range players {
		_, from, okFrom := splitTeamKey(p.Data.SourceTeam)
		_, to, okTo := splitTeamKey(p.Data.DestTeam)
		between := (from == a && to == b) || (from == b && to == a)
		if !playerIDPattern.MatchString(p.PlayerID) || !okFrom || !okTo || !between {
			return nil, false
		}
		legs = append(legs, TradeLeg{PlayerID: p.PlayerID, From: from, To: to})
	}
	return legs, true
}

// PendingTrades is the league's trades pending for the member's team in a
// season (0 the current season's game), read as the member.
func (m *Member) PendingTrades(ctx context.Context, accountID uuid.UUID, season int, leagueID string, team int) ([]PendingTrade, error) {
	var out []PendingTrade
	err := m.as(ctx, accountID, func(access string) error {
		key, err := m.leagueKey(ctx, access, season, leagueID)
		if err != nil {
			return err
		}
		list, err := m.Client.PendingTrades(ctx, access, key, team)
		out = list
		return err
	})
	return out, err
}
