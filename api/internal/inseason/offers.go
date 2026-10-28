package inseason

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// OfferedWords is the label an offer's preset carries (Lane 279).
const OfferedWords = "Offered to you"

// OfferKeptFor is how long an offer the last good read found is answered:
// a league whose offers have not read since is answered with none rather
// than an offer the platform may have closed.
const OfferKeptFor = 6 * time.Hour

// Offers is the offers kept for an account's attachment, as the capture
// read them. *leaguesync.Store implements it.
type Offers interface {
	Offers(ctx context.Context, accountID, linkID uuid.UUID) ([]leaguesync.HeldOffer, error)
}

// offersFor is the trade answer's offers: each kept offer still open at
// now whose players are where it says, against the read the answer is
// from. A kept read that cannot be read answers none, said once, and never
// fails the page.
func (s *Service) offersFor(ctx context.Context, account uuid.UUID, l League, now time.Time) *[]apitypes.TradeOffer {
	if s.Offers == nil {
		return nil
	}
	out := []apitypes.TradeOffer{}
	held, err := s.Offers.Offers(ctx, account, l.LinkID)
	if err != nil {
		s.Log.Warn("inseason: the kept offers were not read; the answer holds none", "league", l.Snap.Ref.Key(), "err", err)
		return &out
	}
	for _, o := range held {
		if row, ok := offerRow(o, l, now); ok {
			out = append(out, row)
		}
	}
	return &out
}

// offerRow is one kept offer as the answer carries it, false when it is
// past its expiry, its read too old, or its players are no longer on the
// rosters it names.
func offerRow(o leaguesync.HeldOffer, l League, now time.Time) (apitypes.TradeOffer, bool) {
	if (o.ExpiresAt != nil && !now.Before(*o.ExpiresAt)) || now.Sub(o.ReadAt) > OfferKeptFor || o.From == l.Me {
		return apitypes.TradeOffer{}, false
	}
	mine, ok := l.Snap.TeamByRoster(l.Me)
	if !ok {
		return apitypes.TradeOffer{}, false
	}
	theirs, ok := l.Snap.TeamByRoster(o.From)
	if !ok || !allOn(mine.Players, o.Give) || !allOn(theirs.Players, o.Get) || !allOn(mine.Players, o.Drop) {
		return apitypes.TradeOffer{}, false
	}
	readAt := o.ReadAt
	return apitypes.TradeOffer{Label: OfferedWords, RosterId: o.From, Name: theirs.Name, Give: o.Give, Get: o.Get, Drop: o.Drop,
		HostOfferId: o.OfferID, ExpiresAt: o.ExpiresAt, ReadAt: readAt}, true
}

// allOn reports whether every one of ids is on the roster.
func allOn(roster, ids []string) bool {
	for _, id := range ids {
		if !slices.Contains(roster, id) {
			return false
		}
	}
	return true
}
