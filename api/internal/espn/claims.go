package espn

// The second ESPN write: a claim on the member's own team, an add with
// its drop and, where the league bids, the bid the member typed, the move
// the member confirmed on our screen (spec 2026-10-15 §10.2;
// docs/research/2026-10-15-host-writes-design.md §1.3). A player on
// waivers goes as a WAIVER transaction, a free agent as FREEAGENT, the
// same items either way (jwulff 06 §1, p4; krmisystems compat lines
// 129-131). ESPN has no dry run and no idempotency key, and a claim
// retried could spend a bid twice: it is sent once and never again on
// its own, and a lost answer is read back.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Bounds on a claim and its reads.
const (
	// maxBudget bounds a league's waiver budget and a bid: ESPN's own
	// defaults are 100 to 1000.
	maxBudget = 100000
	// maxProcessDays bounds the days a league runs claims.
	maxProcessDays = 7
	// maxPending bounds the queue a read keeps.
	maxPending = 200
)

// The ways a claim is not made, beside ErrNotYourTeam and ErrBadMove.
var (
	// ErrNotAvailable is an add another team holds, or the member's
	// own team already does.
	ErrNotAvailable = errors.New("espn: the player is not available")
	// ErrDropGone is a drop no longer on the member's team: the screen
	// was read before a change on ESPN.
	ErrDropGone = errors.New("espn: the drop is not on the team")
	// ErrNotDroppable is a drop ESPN does not let the team make.
	ErrNotDroppable = errors.New("espn: the drop cannot be dropped")
	// ErrBid is a bid in a league without a budget, none where the league
	// bids, or one outside the league's bounds.
	ErrBid = errors.New("espn: the bid is not one the league takes")
)

// A player's status in a league, as ESPN's players read names it.
const (
	StatusFreeAgent = "FREEAGENT"
	StatusWaivers   = "WAIVERS"
	StatusOnTeam    = "ONTEAM"
)

// Availability is where a player is in the league now.
type Availability struct {
	// Status is FREEAGENT, WAIVERS or ONTEAM.
	Status string
	// OnTeam is the team holding him, 0 for none.
	OnTeam int
	Name   string
}

type wireAvailability struct {
	Players []struct {
		ID       int    `json:"id"`
		OnTeamID int    `json:"onTeamId"`
		Status   string `json:"status"`
		Player   struct {
			FullName string `json:"fullName"`
		} `json:"player"`
	} `json:"players"`
}

// Availability reads one player's status in the league with the member's
// cookies: view=kona_player_info with an X-Fantasy-Filter naming his id
// (the players read jwulff's probe and espn-api make, narrowed by
// filterIds as espn-api's player card read is). A player the answer does
// not hold is ErrMalformed, never a guess.
func (c *Client) Availability(ctx context.Context, cookies Cookies, league string, season, period int, playerID string) (Availability, error) {
	id, err := strconv.Atoi(playerID)
	if err != nil {
		return Availability{}, fmt.Errorf("%w: player id %q", ErrBadMove, playerID)
	}
	if !leagueID.MatchString(league) || season < minSeason || season > maxSeason {
		return Availability{}, ErrNotALink
	}
	q := url.Values{"view": {"kona_player_info"}, "scoringPeriodId": {strconv.Itoa(period)}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, season, league, q.Encode())
	filter := fmt.Sprintf(`{"players":{"filterIds":{"value":[%d]}}}`, id)
	body, err := c.getFiltered(ctx, path, &cookies, maxBody, filter)
	if err != nil {
		return Availability{}, err
	}
	var w wireAvailability
	if err := json.Unmarshal(body, &w); err != nil {
		return Availability{}, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	for _, p := range w.Players {
		if p.ID != id {
			continue
		}
		switch p.Status {
		case StatusFreeAgent, StatusWaivers, StatusOnTeam:
		default:
			return Availability{}, fmt.Errorf("%w: player %d status %q", ErrMalformed, id, p.Status)
		}
		return Availability{Status: p.Status, OnTeam: p.OnTeamID, Name: text(p.Player.FullName)}, nil
	}
	return Availability{}, fmt.Errorf("%w: player %d is not in the answer", ErrMalformed, id)
}

// ClaimInput is the claim the member asks for, by ESPN's player ids: the
// add, the drop ("" for an open spot) and the bid (nil for none).
type ClaimInput struct {
	Add  string
	Drop string
	Bid  *int
}

// ClaimSet is a claim on the member's own team. Only OwnClaim makes one,
// so no write names a team the guard has not checked.
type ClaimSet struct {
	leagueID string
	season   int
	team     int
	period   int
	add      string
	drop     string
	bid      *int
	waiver   bool
}

// Team is the member's team the claim is for.
func (s ClaimSet) Team() int { return s.team }

// Period is the scoring period the claim is sent in: the league's current one.
func (s ClaimSet) Period() int { return s.period }

// Add is the player claimed.
func (s ClaimSet) Add() string { return s.add }

// Drop is the player dropped for him, "" for none.
func (s ClaimSet) Drop() string { return s.drop }

// Bid is the bid, nil where the league does not bid.
func (s ClaimSet) Bid() *int {
	if s.bid == nil {
		return nil
	}
	b := *s.bid
	return &b
}

// Waiver reports a claim on a player on waivers, which ESPN runs later; a
// free agent's add is made at once.
func (s ClaimSet) Waiver() bool { return s.waiver }

// OwnClaim checks a claim against a fresh read of the league and the
// add's status: team must be the one the caller names as the member's
// (the attached league's seat) and one the SWID owns; the add must be on
// waivers or a free agent; the drop a player on that team ESPN lets go
// (and, for a free agent's add made at once, not locked on the roster);
// a bid only where the league bids, at least its minimum and at most what
// the team has left.
func OwnClaim(l FullLeague, swid string, team int, in ClaimInput, avail Availability) (ClaimSet, error) {
	t, ok := ownTeam(l, swid, team)
	if !ok {
		return ClaimSet{}, fmt.Errorf("%w: team %d", ErrNotYourTeam, team)
	}
	if _, err := strconv.Atoi(in.Add); err != nil || in.Add == in.Drop {
		return ClaimSet{}, fmt.Errorf("%w: add %q drop %q", ErrBadMove, in.Add, in.Drop)
	}
	if avail.OnTeam != 0 || (avail.Status != StatusWaivers && avail.Status != StatusFreeAgent) {
		return ClaimSet{}, fmt.Errorf("%w: player %s is %s on team %d", ErrNotAvailable, in.Add, avail.Status, avail.OnTeam)
	}
	waiver := avail.Status == StatusWaivers
	if err := checkDrop(t, in.Drop, waiver); err != nil {
		return ClaimSet{}, err
	}
	if err := checkBid(l.Acquisition, t.BudgetSpent, in.Bid); err != nil {
		return ClaimSet{}, err
	}
	set := ClaimSet{leagueID: l.ID, season: l.Season, team: team, period: l.ScoringPeriod, add: in.Add, drop: in.Drop, waiver: waiver}
	if in.Bid != nil {
		b := *in.Bid
		set.bid = &b
	}
	return set, nil
}

// checkDrop is the drop on the team, one ESPN lets go; a free agent's add
// is made at once, so his drop must not be locked on the roster.
func checkDrop(t Team, drop string, waiver bool) error {
	if drop == "" {
		return nil
	}
	for _, p := range t.Roster {
		if p.ID != drop {
			continue
		}
		switch {
		case !p.Droppable():
			return fmt.Errorf("%w: player %s", ErrNotDroppable, drop)
		case !waiver && p.RosterLocked:
			return fmt.Errorf("%w: player %s is locked on the roster", ErrBadMove, drop)
		}
		return nil
	}
	return fmt.Errorf("%w: player %s is not on team %d", ErrDropGone, drop, t.ID)
}

// checkBid is a bid the league takes: none without a budget (ESPN refuses
// any, TRAN_ACQUISITION_BUDGET_NOT_SUPPORTED), one with it, between the
// league's minimum and what the team has left.
func checkBid(a Acquisition, spent *int, bid *int) error {
	switch {
	case !a.Budget && bid != nil:
		return fmt.Errorf("%w: the league has no budget", ErrBid)
	case !a.Budget:
		return nil
	case bid == nil:
		return fmt.Errorf("%w: the league bids and none was given", ErrBid)
	}
	low, high := BidBounds(a, spent)
	if *bid < low || *bid > high {
		return fmt.Errorf("%w: %d is outside %d to %d", ErrBid, *bid, low, high)
	}
	return nil
}

// BidBounds is the least and the most a team may bid: the league's
// minimum, and its budget less what the team has spent (the whole budget
// when the read does not carry the spend).
func BidBounds(a Acquisition, spent *int) (int, int) {
	high := a.Total
	if spent != nil {
		high -= *spent
	}
	return max(0, a.MinimumBid), max(0, high)
}

// wireClaimItem and wireClaim are the captured body (jwulff 06 §1, p4,
// bidAmount from the bundle, compat line 143): no memberId, so the SWID
// never rides in a body we keep, and no bidAmount where the league does
// not bid.
type wireClaimItem struct {
	PlayerID   int    `json:"playerId"`
	Type       string `json:"type"`
	ToTeamID   int    `json:"toTeamId,omitempty"`
	FromTeamID int    `json:"fromTeamId,omitempty"`
}

type wireClaim struct {
	IsLeagueManager bool            `json:"isLeagueManager"`
	TeamID          int             `json:"teamId"`
	Type            string          `json:"type"`
	ScoringPeriodID int             `json:"scoringPeriodId"`
	ExecutionType   string          `json:"executionType"`
	Items           []wireClaimItem `json:"items"`
	BidAmount       *int            `json:"bidAmount,omitempty"`
}

// Body is the JSON ESPN takes for the claim. It never holds a cookie.
func (s ClaimSet) Body() ([]byte, error) {
	kind := "FREEAGENT"
	if s.waiver {
		kind = "WAIVER"
	}
	add, err := strconv.Atoi(s.add)
	if err != nil {
		return nil, fmt.Errorf("%w: player id %q", ErrBadMove, s.add)
	}
	w := wireClaim{TeamID: s.team, Type: kind, ScoringPeriodID: s.period, ExecutionType: "EXECUTE", BidAmount: s.Bid(),
		Items: []wireClaimItem{{PlayerID: add, Type: "ADD", ToTeamID: s.team}}}
	if s.drop != "" {
		drop, err := strconv.Atoi(s.drop)
		if err != nil {
			return nil, fmt.Errorf("%w: player id %q", ErrBadMove, s.drop)
		}
		w.Items = append(w.Items, wireClaimItem{PlayerID: drop, Type: "DROP", FromTeamID: s.team})
	}
	b, err := json.Marshal(w)
	if err != nil {
		return nil, fmt.Errorf("espn: body: %w", err)
	}
	return b, nil
}

// Claim sends the claim once, with the member's cookies. ErrNotSent when
// nothing left; any request that left answers a WriteAnswer, never an
// error. It never retries.
func (c *Client) Claim(ctx context.Context, cookies Cookies, set ClaimSet) (WriteAnswer, error) {
	body, err := set.Body()
	if err != nil {
		return WriteAnswer{}, fmt.Errorf("%w: %w", ErrNotSent, err)
	}
	return c.send(ctx, cookies, set.leagueID, set.season, body)
}

// PendingClaim is a claim as ESPN's queue holds it: found, and when ESPN
// runs it (processDate), nil when the row does not say.
type PendingClaim struct {
	Found     bool
	ProcessAt *time.Time
}

type wirePendingRow struct {
	ID          string `json:"id"`
	TeamID      int    `json:"teamId"`
	ProcessDate int64  `json:"processDate"`
	Items       []struct {
		PlayerID int    `json:"playerId"`
		Type     string `json:"type"`
	} `json:"items"`
}

type wirePending struct {
	Pending *[]wirePendingRow `json:"pendingTransactions"`
}

// holds reports whether a queued row is the claim: ESPN's id when the
// answer gave one, else (an answer lost) the member's team with the
// claim's ADD and, when there is one, its DROP. The queue holds live
// claims only, so a match is a claim ESPN will run.
func (row wirePendingRow) holds(set ClaimSet, transactionID string) bool {
	if row.TeamID != set.team {
		return false
	}
	if transactionID != "" {
		return row.ID == transactionID
	}
	added, dropped := false, set.drop == ""
	for _, it := range row.Items {
		id := strconv.Itoa(it.PlayerID)
		switch {
		case it.Type == "ADD" && id == set.add:
			added = true
		case it.Type == "DROP" && id == set.drop:
			dropped = true
		}
	}
	return added && dropped
}

// PendingClaim reads the league's queue (view=mPendingTransactions, the
// queue a cancelled claim leaves at once: jwulff docs/memory
// a-cancelled-claim-still-reads-pending.md) and finds the claim by the
// transaction id ESPN answered, or, with none (an answer lost), by the
// member's team and the claim's players. A body without the queue's key
// is drift, ErrMalformed, never an empty queue.
func (c *Client) PendingClaim(ctx context.Context, cookies Cookies, set ClaimSet, transactionID string) (PendingClaim, error) {
	if !leagueID.MatchString(set.leagueID) {
		return PendingClaim{}, ErrNotALink
	}
	q := url.Values{"view": {"mPendingTransactions"}, "scoringPeriodId": {strconv.Itoa(set.period)}}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?%s", c.Base, set.season, set.leagueID, q.Encode())
	body, err := c.get(ctx, path, &cookies, maxBody)
	if err != nil {
		return PendingClaim{}, err
	}
	var w wirePending
	if err := json.Unmarshal(body, &w); err != nil {
		return PendingClaim{}, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	if w.Pending == nil || len(*w.Pending) > maxPending {
		return PendingClaim{}, fmt.Errorf("%w: no pending transactions", ErrMalformed)
	}
	for _, p := range *w.Pending {
		if !p.holds(set, transactionID) {
			continue
		}
		out := PendingClaim{Found: true}
		if p.ProcessDate > 0 {
			at := time.UnixMilli(p.ProcessDate).UTC()
			out.ProcessAt = &at
		}
		return out, nil
	}
	return PendingClaim{}, nil
}

// Claimed reads the team's roster back (view=mRoster) and reports whether
// the add is on it and the drop is not.
func (c *Client) Claimed(ctx context.Context, cookies Cookies, set ClaimSet) (bool, error) {
	ids, ok, err := c.rosterIDs(ctx, cookies, set.leagueID, set.season, set.team)
	if err != nil || !ok {
		return false, err
	}
	_, added := ids[set.add]
	_, kept := ids[set.drop]
	return added && (set.drop == "" || !kept), nil
}

// wireAcquisition is settings.acquisitionSettings as the read answers it.
type wireAcquisition struct {
	IsUsingAcquisitionBudget bool     `json:"isUsingAcquisitionBudget"`
	AcquisitionBudget        int      `json:"acquisitionBudget"`
	MinimumBid               int      `json:"minimumBid"`
	AcquisitionType          string   `json:"acquisitionType"`
	WaiverProcessDays        []string `json:"waiverProcessDays"`
}

// acquisitionOf is the league's waiver settings, bounded: a budget or a
// minimum out of any league's range reads as no budget, so no bid is
// sent on a number we cannot trust.
func acquisitionOf(w wireAcquisition) Acquisition {
	a := Acquisition{Budget: w.IsUsingAcquisitionBudget, Total: w.AcquisitionBudget, MinimumBid: w.MinimumBid,
		Type: bounded64(text(w.AcquisitionType))}
	if a.Total < 0 || a.Total > maxBudget || a.MinimumBid < 0 || a.MinimumBid > a.Total {
		a.Budget, a.Total, a.MinimumBid = false, 0, 0
	}
	for i, d := range w.WaiverProcessDays {
		if i >= maxProcessDays {
			break
		}
		a.ProcessDays = append(a.ProcessDays, bounded64(text(d)))
	}
	return a
}

// ProcessDays is the league's claim days in words: "Wednesday", "Tuesday
// and Friday". Empty when the read carries none.
func ProcessDays(a Acquisition) string {
	order := []string{"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"}
	set := map[string]bool{}
	for i, d := range a.ProcessDays {
		if i >= maxProcessDays {
			break
		}
		set[strings.ToUpper(strings.TrimSpace(d))] = true
	}
	var days []string
	for _, d := range order {
		if set[d] {
			days = append(days, d[:1]+strings.ToLower(d[1:]))
		}
	}
	switch len(days) {
	case 0:
		return ""
	case 1:
		return days[0]
	}
	return strings.Join(days[:len(days)-1], ", ") + " and " + days[len(days)-1]
}
