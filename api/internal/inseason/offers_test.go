package inseason

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

type fakeOffers struct {
	held    []leaguesync.HeldOffer
	err     error
	account uuid.UUID
	link    uuid.UUID
}

func (f *fakeOffers) Offers(_ context.Context, account, link uuid.UUID) ([]leaguesync.HeldOffer, error) {
	f.account, f.link = account, link
	return f.held, f.err
}

// offerAnswer is the trade finder's answer from the route, as raw fields and
// as the type.
func offerAnswer(t *testing.T, s *Service) (map[string]json.RawMessage, apitypes.TradeAdvice) {
	t.Helper()
	code, env := serve(t, s, leaguePath+"trades")
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("trades: %d %+v", code, env.Error)
	}
	var raw map[string]json.RawMessage
	var advice apitypes.TradeAdvice
	if err := json.Unmarshal(env.Data, &raw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(env.Data, &advice); err != nil {
		t.Fatal(err)
	}
	return raw, advice
}

// The finder's answer carries the platform's open offers to the member as
// "Offered to you": each kept offer still open whose players are where it
// says, read for the signed-in account's attachment. An expired offer, one
// read too long ago, one naming a player no longer on the roster it names,
// and one from the member's own roster are left out.
func TestTradesCarryTheOffers(t *testing.T) {
	f := newFixture(t)
	f.league.LinkID = uuid.MustParse("6b1f1a64-63a8-4b52-9a4b-8fb1d2f1c0de")
	mine, _ := f.league.Snap.TeamByRoster(f.league.Me)
	other := 3
	if other == f.league.Me {
		other = 4
	}
	theirs, _ := f.league.Snap.TeamByRoster(other)
	now := fixtureNow
	later, past := now.Add(24*time.Hour), now.Add(-time.Minute)
	offer := func(id string, give, get []string, expires *time.Time, readAt time.Time) leaguesync.HeldOffer {
		return leaguesync.HeldOffer{Offer: leaguesync.Offer{OfferID: id, From: other, Give: give, Get: get, Drop: []string{}, ExpiresAt: expires}, ReadAt: readAt}
	}
	fresh := now.Add(-2 * time.Minute)
	offers := &fakeOffers{held: []leaguesync.HeldOffer{
		offer("open", []string{mine.Players[0]}, []string{theirs.Players[1]}, &later, fresh),
		offer("lapsed", []string{mine.Players[0]}, []string{theirs.Players[1]}, &past, fresh),
		offer("old read", []string{mine.Players[0]}, []string{theirs.Players[1]}, nil, now.Add(-OfferKeptFor-time.Minute)),
		offer("moved", []string{theirs.Players[2]}, []string{theirs.Players[1]}, nil, fresh),
		{Offer: leaguesync.Offer{OfferID: "mine", From: f.league.Me, Give: []string{}, Get: []string{mine.Players[1]}, Drop: []string{}}, ReadAt: fresh},
	}}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	s.Offers = offers
	_, advice := offerAnswer(t, s)
	if advice.Offers == nil || len(*advice.Offers) != 1 {
		t.Fatalf("offers %+v, want the one open offer", advice.Offers)
	}
	got := (*advice.Offers)[0]
	want := apitypes.TradeOffer{Label: "Offered to you", RosterId: other, Name: theirs.Name, Give: []string{mine.Players[0]},
		Get: []string{theirs.Players[1]}, Drop: []string{}, HostOfferId: "open", ExpiresAt: &later, ReadAt: fresh}
	if got.Label != want.Label || got.RosterId != want.RosterId || got.Name != want.Name || got.HostOfferId != want.HostOfferId ||
		got.Give[0] != want.Give[0] || got.Get[0] != want.Get[0] || len(got.Drop) != 0 || !got.ExpiresAt.Equal(later) || !got.ReadAt.Equal(fresh) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if offers.account != uuid.MustParse("00000000-0000-0000-0000-00000000000a") || offers.link != f.league.LinkID {
		t.Fatalf("offers read for %s on %s", offers.account, offers.link)
	}
}

// With no offers kept the answer carries an empty list; with no offer
// source wired it carries no offers field at all (the older answer's
// shape); a kept read that fails answers none and never fails the page.
func TestTradesWithoutOffers(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	raw, _ := offerAnswer(t, s)
	if _, ok := raw["offers"]; ok {
		t.Fatalf("an answer with no offer source carries offers: %s", raw["offers"])
	}
	s.Offers = &fakeOffers{}
	raw, _ = offerAnswer(t, s)
	if string(raw["offers"]) != "[]" {
		t.Fatalf("no offers kept: %s, want []", raw["offers"])
	}
	s.Offers = &fakeOffers{err: errors.New("the database is away")}
	raw, _ = offerAnswer(t, s)
	if string(raw["offers"]) != "[]" {
		t.Fatalf("a failed read: %s, want []", raw["offers"])
	}
}
