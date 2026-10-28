package leaguesync

// A member's pending trade offers on the host (Lane 279, B263): the
// trades another team has offered the member and the host still holds
// open, read with the session the attach flow keeps, for the Trades
// screen's "Offered to you" presets. Read where the host lists them to the
// member: ESPN (the league's queue with the member's cookies), Yahoo (the
// league's pending_trade transactions for the member's team, with their
// grant) and MyFantasyLeague (the pendingTrades export with their
// session). Sleeper keeps no session for us and its public API lists only
// completed moves; FFPC's pages that list an offer were never captured, so
// neither host is read (the lane report has the findings).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/mflhost"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/mfl"
)

// Offer is one trade another team offered the member, as the host holds
// it open. Player ids are the host's (the snapshot's).
type Offer struct {
	// OfferID is the host's id for the offer.
	OfferID string `json:"offer_id"`
	// From is the roster that offered.
	From int `json:"from"`
	// Give is the member's players the offer takes, Get theirs it sends.
	Give []string `json:"give"`
	Get  []string `json:"get"`
	// Drop is the member's players the host requires dropped to take it,
	// empty where the host names none.
	Drop       []string   `json:"drop"`
	ProposedAt *time.Time `json:"proposed_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
}

// OfferReader reads a member's pending offers in one league on a host.
type OfferReader interface {
	// Offers is the offers made to the member's roster in the league,
	// read as the account; snap is the league's read that just landed.
	Offers(ctx context.Context, accountID uuid.UUID, ref Ref, roster int, snap Snapshot) ([]Offer, error)
}

// sides is an offer's two lists from the member's roster's view, false
// when a leg does not move between the member and the one offering team.
func sides(legs []offerLeg, me, them int) (give, get []string, ok bool) {
	give, get = []string{}, []string{}
	for _, l := range legs {
		switch {
		case l.from == me && l.to == them:
			give = append(give, l.player)
		case l.from == them && l.to == me:
			get = append(get, l.player)
		default:
			return nil, nil, false
		}
	}
	return give, get, len(give)+len(get) > 0
}

// offerLeg is one player an offer moves.
type offerLeg struct {
	player   string
	from, to int
}

// ESPNTrades reads a league's queue with a member's cookies, and the
// cookies themselves (their SWID names the member). *espnhost.Member
// implements it.
type ESPNTrades interface {
	Cookies(ctx context.Context, accountID uuid.UUID) (espn.Cookies, error)
	PendingTrades(ctx context.Context, accountID uuid.UUID, leagueID string, season int) ([]espn.PendingTrade, error)
}

// ESPNOffers is ESPN's offers: the queue's open proposals another team
// made with the member's team on the other side. An ESPN team is picked
// from the league's list at attach, so the queue is read only for a
// roster the cookies' member owns in the league's read (its owners name
// the SWID): any other roster's offers are not the member's to see, and
// it reads none. ESPN asks for any drop when the offer is accepted, so an
// offer names none.
type ESPNOffers struct{ Member ESPNTrades }

// Offers reads the queue as the account.
func (e ESPNOffers) Offers(ctx context.Context, accountID uuid.UUID, ref Ref, roster int, snap Snapshot) ([]Offer, error) {
	cookies, err := e.Member.Cookies(ctx, accountID)
	if err != nil {
		return nil, espnErr(err)
	}
	if !ownsRoster(snap, roster, cookies.SWID) {
		return []Offer{}, nil
	}
	list, err := e.Member.PendingTrades(ctx, accountID, ref.LeagueID, ref.Season)
	if err != nil {
		return nil, espnErr(err)
	}
	out := []Offer{}
	for _, t := range list {
		legs := make([]offerLeg, len(t.Legs))
		for i, l := range t.Legs {
			legs[i] = offerLeg{player: l.PlayerID, from: l.From, to: l.To}
		}
		if t.Proposer == roster {
			continue
		}
		if give, get, ok := sides(legs, roster, t.Proposer); ok {
			out = append(out, Offer{OfferID: t.ID, From: t.Proposer, Give: give, Get: get, Drop: []string{},
				ProposedAt: t.ProposedAt, ExpiresAt: t.ExpiresAt})
		}
	}
	return out, nil
}

// ownsRoster reports whether the read names the member (by their host
// user id) among the roster's owners.
func ownsRoster(snap Snapshot, roster int, member string) bool {
	team, ok := snap.TeamByRoster(roster)
	if !ok || strings.TrimSpace(member) == "" {
		return false
	}
	for _, owner := range team.OwnerIDs {
		if strings.EqualFold(owner, member) {
			return true
		}
	}
	return false
}

// YahooTrades reads a league's pending trades for a team as a member.
// *yahoo.Member implements it.
type YahooTrades interface {
	PendingTrades(ctx context.Context, accountID uuid.UUID, season int, leagueID string, team int) ([]yahoo.PendingTrade, error)
}

// YahooOffers is Yahoo's offers: the proposed trades whose tradee is the
// member's team. Yahoo states no expiry and no drop.
type YahooOffers struct{ Member YahooTrades }

// Offers reads the member's team's pending trades as the account.
func (y YahooOffers) Offers(ctx context.Context, accountID uuid.UUID, ref Ref, roster int, _ Snapshot) ([]Offer, error) {
	list, err := y.Member.PendingTrades(ctx, accountID, ref.Season, ref.LeagueID, roster)
	if err != nil {
		return nil, yahooErr(err)
	}
	out := []Offer{}
	for _, t := range list {
		if t.Tradee != roster {
			continue
		}
		legs := make([]offerLeg, len(t.Legs))
		for i, l := range t.Legs {
			legs[i] = offerLeg{player: l.PlayerID, from: l.From, to: l.To}
		}
		if give, get, ok := sides(legs, roster, t.Trader); ok {
			out = append(out, Offer{OfferID: t.Key, From: t.Trader, Give: give, Get: get, Drop: []string{}, ProposedAt: t.ProposedAt})
		}
	}
	return out, nil
}

// MFLTrades reads a league's pending trades with a member's session, and
// the member's franchise. *mflhost.Member implements it.
type MFLTrades interface {
	PendingTrades(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (int, []mfl.PendingTrade, error)
}

// MFLOffers is MyFantasyLeague's offers: the pending trades offered to the
// member's franchise, its sides read the offering franchise's way round.
// An offer carrying a draft pick or blind-bid dollars is left out: the
// builder holds players only, and the offer without them is not the one
// made. MyFantasyLeague names no drop.
type MFLOffers struct{ Member MFLTrades }

// Offers reads the pending trades as the account.
func (m MFLOffers) Offers(ctx context.Context, accountID uuid.UUID, ref Ref, roster int, _ Snapshot) ([]Offer, error) {
	franchise, list, err := m.Member.PendingTrades(ctx, accountID, ref.LeagueID, ref.Season)
	if err != nil {
		return nil, mflMemberErr(err)
	}
	if franchise != roster {
		return nil, fmt.Errorf("%w: the session's franchise %d is not the attached roster %d", ErrNotFound, franchise, roster)
	}
	out := []Offer{}
	for _, t := range list {
		if t.OfferedTo != roster || t.Assets || len(t.GiveUp)+len(t.Receive) == 0 {
			continue
		}
		out = append(out, Offer{OfferID: t.ID, From: t.Offering, Give: listOf(t.Receive), Get: listOf(t.GiveUp), Drop: []string{},
			ProposedAt: t.ProposedAt, ExpiresAt: t.ExpiresAt})
	}
	return out, nil
}

// listOf is ids as a list, empty rather than nil: a one-sided offer's
// empty side is stored and answered as [], never null.
func listOf(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}

// maxOfferID bounds a host's offer id, as the store keeps it.
const maxOfferID = 64

// offerProblem says why an offer cannot be kept, "" for one that can: an
// id the store cannot hold, no offering team, or no player at all. The
// capture skips such an offer, so it never stops a read's retire.
func offerProblem(o Offer) string {
	switch {
	case o.OfferID == "" || len(o.OfferID) > maxOfferID:
		return "its id is empty or too long"
	case o.From < 1:
		return "it names no offering team"
	case len(o.Give)+len(o.Get) == 0:
		return "it moves no player"
	}
	return ""
}

// normalized is the offer with every list non-nil.
func (o Offer) normalized() Offer {
	o.Give, o.Get, o.Drop = listOf(o.Give), listOf(o.Get), listOf(o.Drop)
	return o
}

// mflMemberErr is a MyFantasyLeague member read's failure in this
// package's words.
func mflMemberErr(err error) error {
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return fmt.Errorf("%w: %v", ErrNotConnected, err)
	case errors.Is(err, mflhost.ErrReconnect), errors.Is(err, mfl.ErrSignedOut):
		return fmt.Errorf("%w: %v", ErrSignInAgain, err)
	case errors.Is(err, mfl.ErrNotYourTeam), errors.Is(err, mfl.ErrNotFound):
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	default:
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
}
