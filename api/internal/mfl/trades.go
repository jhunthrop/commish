package mfl

// The member's pending trades (Lane 279, B263): TYPE=pendingTrades,
// "Pending trades that the current franchise has offered to other
// franchises, or has been offered to by other franchises", access
// restricted to league owners (api_info), so read with the member's
// session. Each row names the offering franchise, the one it is offered
// to, what the offering franchise will give up and will receive (comma
// lists with a trailing comma, the same way round as tradeProposal's
// WILL_GIVE_UP and WILL_RECEIVE), the trade id tradeResponse answers, and
// its expiry in Unix seconds (an owner-view answer saved from a league
// clone: bborchardt/fuadmflsite tools/verify/screens/pendingTrades-offer.json).

import (
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// maxPendingTrades bounds one read's offers.
const maxPendingTrades = 100

// PendingTrade is one offer MyFantasyLeague lists as pending.
type PendingTrade struct {
	// ID is the trade_id tradeResponse names.
	ID string
	// Offering is the franchise that offered, OfferedTo the one it is
	// offered to.
	Offering, OfferedTo int
	// GiveUp is what the offering franchise gives, Receive what it gets.
	GiveUp, Receive []string
	// Assets says a side carries a draft pick or blind-bid dollars beside
	// (or instead of) its players.
	Assets     bool
	ProposedAt *time.Time
	ExpiresAt  *time.Time
}

type wirePendingTrades struct {
	PendingTrades wireTradeList `json:"pendingTrades"`
}

// wireTradeList is the answer's list, Present when the answer names it at
// all: MyFantasyLeague answers an empty list as an empty string or object.
type wireTradeList struct {
	Present bool
	Trade   list[wirePendingTrade]
}

type wirePendingTrade struct {
	ID          string `json:"trade_id"`
	Offering    string `json:"offeringteam"`
	OfferedTo   string `json:"offeredto"`
	WillGiveUp  string `json:"will_give_up"`
	WillReceive string `json:"will_receive"`
	Timestamp   string `json:"timestamp"`
	Expires     string `json:"expires"`
}

func (l *wireTradeList) UnmarshalJSON(b []byte) error {
	l.Present = true
	b = bytes.TrimSpace(b)
	if len(b) == 0 || b[0] != '{' {
		// "" or null: the list named, and empty.
		return nil
	}
	var w struct {
		Trade list[wirePendingTrade] `json:"pendingTrade"`
	}
	if err := json.Unmarshal(b, &w); err != nil {
		return err
	}
	l.Trade = w.Trade
	return nil
}

// PendingTrades is the league's offers to and from the member's franchise,
// read with their session on the league's server.
func (c *Client) PendingTrades(ctx context.Context, sess Session, server string, season int, leagueID string) ([]PendingTrade, error) {
	var w wirePendingTrades
	if err := c.memberExport(ctx, sess, server, season, leagueID, "pendingTrades", nil, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// DecodePendingTrades reads a pendingTrades answer.
func DecodePendingTrades(body []byte) ([]PendingTrade, error) {
	var w wirePendingTrades
	if err := decode(body, &w); err != nil {
		return nil, err
	}
	return w.validate()
}

// validate keeps each row whose id, two franchises and lists read; a row
// that does not read is left out, never half-read.
func (w wirePendingTrades) validate() ([]PendingTrade, error) {
	if !w.PendingTrades.Present {
		return nil, malformed("no pendingTrades")
	}
	if len(w.PendingTrades.Trade) > maxPendingTrades {
		return nil, malformed("%d pending trades", len(w.PendingTrades.Trade))
	}
	out := []PendingTrade{}
	for _, row := range w.PendingTrades.Trade {
		offering, okA := franchiseNumber(row.Offering)
		offeredTo, okB := franchiseNumber(row.OfferedTo)
		give, assetsA, okGive := tradeSide(row.WillGiveUp)
		get, assetsB, okGet := tradeSide(row.WillReceive)
		id := strings.TrimSpace(row.ID)
		if !okA || !okB || offering == offeredTo || !okGive || !okGet || id == "" || len(id) > 20 {
			continue
		}
		out = append(out, PendingTrade{ID: id, Offering: offering, OfferedTo: offeredTo, GiveUp: give, Receive: get,
			Assets: assetsA || assetsB, ProposedAt: unixStamp(row.Timestamp), ExpiresAt: unixStamp(row.Expires)})
	}
	return out, nil
}

// tradeSide is one side's players, whether it carries any other asset,
// and false when an entry is neither.
func tradeSide(s string) ([]string, bool, bool) {
	var players []string
	assets := false
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		switch {
		case part == "":
		case assetPattern.MatchString(part):
			assets = true
		case playerIDPattern.MatchString(part):
			players = append(players, part)
		default:
			return nil, false, false
		}
	}
	return players, assets, len(players) <= maxRoster
}

// unixStamp is a Unix-seconds string as a time, nil for none.
func unixStamp(s string) *time.Time {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || n <= 0 {
		return nil
	}
	at := time.Unix(n, 0).UTC()
	return &at
}
