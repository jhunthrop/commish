package hostmoves

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
)

// Claims reads a claim's add, sends the claim and reads it back.
// *espn.Client implements it.
type Claims interface {
	Availability(ctx context.Context, cookies espn.Cookies, league string, season, period int, playerID string) (espn.Availability, error)
	Claim(ctx context.Context, cookies espn.Cookies, set espn.ClaimSet) (espn.WriteAnswer, error)
	PendingClaim(ctx context.Context, cookies espn.Cookies, set espn.ClaimSet, transactionID string) (espn.PendingClaim, error)
	Claimed(ctx context.Context, cookies espn.Cookies, set espn.ClaimSet) (bool, error)
}

// claimPlan is a claim checked against a fresh read: the set ESPN takes,
// the claim in words, the bid with its bounds where the league bids, and
// the league's claim days for the answer.
type claimPlan struct {
	set      espn.ClaimSet
	sentence string
	bid      *apitypes.HostBid
	days     string
}

// availability reads the add's status with the member's cookies; a
// failure is said as the host not answering, or the session refused.
type availability func(playerID string) (espn.Availability, error)

// planClaim turns the screen's claim into ESPN's on the member's own
// team: the week must be ESPN's current one, the add a player no team
// holds, the drop one of the member's ESPN lets go, and the bid the
// member typed (the league's least when none is typed yet, which only a
// plan accepts: a move needs the number the member saw) inside the
// league's bounds. espn.OwnClaim checks the team and the rest.
func planClaim(l espn.FullLeague, swid string, me int, mv apitypes.HostMoveInput, read availability, making bool) (claimPlan, error) {
	c := *mv.Claim
	if mv.Week != l.ScoringPeriod {
		return claimPlan{}, refuse(fmt.Sprintf(claimWeekMovedWords, l.ScoringPeriod), fmt.Errorf("week %d is not ESPN's %d", mv.Week, l.ScoringPeriod))
	}
	team, ok := teamOf(l, me)
	if !ok {
		return claimPlan{}, claimNotTheirs(espn.ErrNotYourTeam)
	}
	in := espn.ClaimInput{Add: c.Add, Bid: c.Bid}
	if c.Drop != nil {
		in.Drop = *c.Drop
	}
	var bid *apitypes.HostBid
	unbound := in.Bid == nil && l.Acquisition.Budget
	if l.Acquisition.Budget {
		low, high := espn.BidBounds(l.Acquisition, team.BudgetSpent)
		if in.Bid == nil {
			in.Bid = &low
		}
		bid = &apitypes.HostBid{Amount: *in.Bid, Min: low, Max: high, LeftKnown: team.BudgetSpent != nil}
	}
	avail, err := read(c.Add)
	if err != nil {
		return claimPlan{}, err
	}
	set, err := espn.OwnClaim(l, swid, me, in, avail)
	if err != nil {
		return claimPlan{}, claimRefusal(err, in, avail, team, l.Acquisition, bid)
	}
	if unbound && making {
		// The token makes the number the member saw, never one derived again
		// at send time.
		return claimPlan{}, refuse(bidUnboundWords, espn.ErrBid)
	}
	days := espn.ProcessDays(l.Acquisition)
	return claimPlan{set: set, sentence: claimSentence(avail.Name, dropName(team, in.Drop), set, days), bid: bid, days: days}, nil
}

func dropName(t espn.Team, id string) string {
	for _, p := range t.Roster {
		if p.ID == id {
			return p.Name
		}
	}
	return ""
}

func claimNotTheirs(cause error) error {
	return &refusal{words: claimNotYourTeamWords, cause: cause, unavailable: true}
}

// claimRefusal is the member's sentence for a claim espn.OwnClaim refused.
func claimRefusal(err error, in espn.ClaimInput, avail espn.Availability, team espn.Team, a espn.Acquisition, bid *apitypes.HostBid) error {
	name := avail.Name
	if name == "" {
		name = "He"
	}
	switch {
	case errors.Is(err, espn.ErrDropGone):
		return refuse(claimStaleWords, err)
	case errors.Is(err, espn.ErrNotYourTeam):
		return claimNotTheirs(err)
	case errors.Is(err, espn.ErrNotAvailable) && avail.OnTeam == team.ID:
		return refuse(fmt.Sprintf(alreadyYoursWords, name), err)
	case errors.Is(err, espn.ErrNotAvailable):
		return refuse(fmt.Sprintf(notAvailableWords, name), err)
	case errors.Is(err, espn.ErrNotDroppable):
		return refuse(fmt.Sprintf(notDroppableWords, dropName(team, in.Drop)), err)
	case errors.Is(err, espn.ErrBid) && !a.Budget:
		return refuse(noBidsWords, err)
	case errors.Is(err, espn.ErrBid) && bid != nil:
		return refuse(fmt.Sprintf(bidBoundsWords, bid.Min, bid.Max), err)
	case errors.Is(err, espn.ErrBadMove) && in.Drop != "" && in.Drop != in.Add:
		return refuse(fmt.Sprintf(dropLockedWords, dropName(team, in.Drop)), err)
	}
	return refuse(claimStaleWords, err)
}

// claimSentence is the claim as the member confirms it: "Add Keenan
// Allen, drop Danny Amendola, bid $12. He is on waivers, so ESPN runs the
// claim on Wednesday." or "Add Keenan Allen, drop Danny Amendola, on ESPN
// now. He is a free agent, so the add is made at once."
func claimSentence(add, drop string, set espn.ClaimSet, days string) string {
	words := "Add " + add
	if drop != "" {
		words += ", drop " + drop
	}
	if b := set.Bid(); b != nil {
		words += fmt.Sprintf(", bid $%d", *b)
	}
	if !set.Waiver() {
		return words + ", on ESPN now. He is a free agent, so the add is made at once."
	}
	if days == "" {
		return words + ". He is on waivers, so ESPN runs the claim when the league runs claims."
	}
	return words + ". He is on waivers, so ESPN runs the claim on " + days + "."
}

// claimRecord is a claim as the proof keeps it: the words and the items.
type claimRecord struct {
	Sentence string `json:"sentence"`
	Team     int    `json:"team"`
	Period   int    `json:"scoring_period"`
	Add      string `json:"add"`
	Drop     string `json:"drop,omitempty"`
	Bid      *int   `json:"bid,omitempty"`
	Waiver   bool   `json:"waiver"`
}

func (p claimPlan) record() claimRecord {
	return claimRecord{Sentence: p.sentence, Team: p.set.Team(), Period: p.set.Period(), Add: p.set.Add(), Drop: p.set.Drop(),
		Bid: p.set.Bid(), Waiver: p.set.Waiver()}
}

// settleClaim is what a sent claim came to: a refusal is ESPN's. A waiver
// claim, queued or with its answer lost, is read back in the league's
// queue (by ESPN's id, or by the team and the claim's players when the
// answer gave none), pending with when ESPN runs it; never on the roster,
// where a queued claim is not. A free agent's add, made at once, is read
// back on the roster, done when he is there. Each sentence names what was
// read. Never a retry.
func (s *Service) settleClaim(ctx context.Context, cookies espn.Cookies, p claimPlan, ans espn.WriteAnswer) (Answer, string) {
	a := Answer{HostStatus: ans.Status, TransactionID: ans.TransactionID, Member: string(ans.Member)}
	switch {
	case ans.Outcome == espn.WriteRefused:
		a.Outcome, a.HostReason, a.HostWords, a.ReadBack = OutcomeRefused, ans.Refusal.Type, ans.Refusal.Message, readNotRead
		return a, claimRefusedWords
	case ans.Outcome == espn.WritePending, p.set.Waiver() && ans.Outcome != espn.WriteExecuted:
		id := ""
		if ans.Outcome == espn.WritePending {
			id = ans.TransactionID
		}
		return s.settleQueued(ctx, cookies, p, id, a)
	}
	added, err := s.Claims.Claimed(ctx, cookies, p.set)
	switch {
	case err != nil:
		s.Log.Warn("hostmoves: read the roster back", "err", err)
		a.Outcome, a.ReadBack = OutcomePending, readNotRead
		return a, claimNotReadWords
	case added:
		a.Outcome, a.ReadBack = OutcomeDone, readMatched
		return a, claimDoneWords
	}
	a.Outcome, a.ReadBack = OutcomePending, readNotMatched
	return a, claimNotOnRosterWords
}

// settleQueued reads a waiver claim back in the league's queue.
func (s *Service) settleQueued(ctx context.Context, cookies espn.Cookies, p claimPlan, id string, a Answer) (Answer, string) {
	a.Outcome = OutcomePending
	q, err := s.Claims.PendingClaim(ctx, cookies, p.set, id)
	switch {
	case err != nil:
		s.Log.Warn("hostmoves: read the claims back", "err", err)
		a.ReadBack = readNotRead
		return a, claimNotReadWords
	case !q.Found:
		a.ReadBack = readNotMatched
		return a, claimNotSeenWords
	}
	a.ReadBack, a.ProcessAt = readMatched, q.ProcessAt
	return a, claimPendingWords(p.days)
}

// claimPendingWords is a queued claim's answer, with the league's days.
func claimPendingWords(days string) string {
	if days == "" {
		return "Claim submitted. ESPN processes claims when the league runs them, and your lineup screen will show him once it goes through."
	}
	return "Claim submitted. ESPN processes claims on " + days + ", and your lineup screen will show him once it goes through."
}

// processAt is a pending claim's run time for the wire, nil otherwise.
func processAt(a Answer) *time.Time {
	if a.Outcome != OutcomePending || a.ProcessAt == nil {
		return nil
	}
	at := a.ProcessAt.UTC()
	return &at
}
