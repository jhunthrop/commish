package entitlements_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/season"
)

// canCase is one question Can answers in the row fixture.
type canCase struct {
	name    string
	account uuid.UUID
	feature entitlements.Feature
	at      time.Time
	want    bool
}

// rowFixture writes a pass holder, a member and an account with no rows,
// and returns the questions the rows answer, refusals included.
func rowFixture(t *testing.T, store *entitlements.Store) []canCase {
	t.Helper()
	ctx := context.Background()
	account := func(workosID string) uuid.UUID {
		var id uuid.UUID
		if err := store.Pool.QueryRow(ctx,
			`insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.com') returning id`,
			workosID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	passHolder, member, nobody := account("user_pass"), account("user_member"), account("user_none")

	if _, err := store.GrantPass(ctx, entitlements.PassGrant{
		AccountID: passHolder, Season: season.Of(fixtureBought), Source: entitlements.SourcePurchase,
		CheckoutSessionID: "cs_test_1", PaymentIntentID: "pi_test_1", GrantedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	periodEnd := fixtureBought.AddDate(1, 0, 0)
	if err := store.UpsertSubscription(ctx, entitlements.SubscriptionState{
		AccountID: member, SubscriptionID: "sub_test_1", Status: "active", Interval: "year",
		CurrentPeriodEnd: periodEnd, GrantedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}

	afterSeason := season.End(2027).Add(time.Minute)
	afterGrace := periodEnd.Add(entitlements.SubscriptionGrace).Add(time.Minute)
	return []canCase{
		{"pass grants the advisor", passHolder, entitlements.LiveDraftAdvisor, fixtureBought, true},
		{"pass grants custom scoring", passHolder, entitlements.CustomScoring, fixtureBought, true},
		{"pass does not grant full reasoning", passHolder, entitlements.FullReasoning, fixtureBought, false},
		{"pass ends with its season", passHolder, entitlements.LiveDraftAdvisor, afterSeason, false},
		{"membership grants full reasoning", member, entitlements.FullReasoning, fixtureBought, true},
		{"membership grants early run", member, entitlements.EarlyRun, fixtureBought, true},
		{"membership lasts through grace", member, entitlements.EarlyRun, periodEnd.Add(time.Hour), true},
		{"membership ends after grace", member, entitlements.EarlyRun, afterGrace, false},
		{"no rows, no features", nobody, entitlements.LiveDraftAdvisor, fixtureBought, false},
		{"no rows, no second league", nobody, entitlements.ManyLeagues, fixtureBought, false},
	}
}

// fixtureBought is when the fixture's pass was bought: the 2027 season.
var fixtureBought = time.Date(2027, time.August, 20, 12, 0, 0, 0, time.UTC)

// The boundary this package owns: Can answers from the rows alone. A
// pass grants the pass's features for its season and nothing past its
// end, a membership grants the rest until its period (plus grace) ends,
// and a refunded row grants nothing.
func TestCanAnswersFromRows(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	store := &entitlements.Store{Pool: pool}
	cases := rowFixture(t, store)
	for _, c := range cases {
		got, err := store.Can(ctx, c.account, c.feature, c.at)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: Can = %v, want %v", c.name, got, c.want)
		}
	}

	passHolder := cases[0].account
	if _, err := store.EndPayment(ctx, "pi_test_1", entitlements.EndRefunded, "test"); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Can(ctx, passHolder, entitlements.LiveDraftAdvisor, fixtureBought); err != nil || got {
		t.Errorf("refunded pass: Can = %v (err %v), want false", got, err)
	}
}

// With the free season on, every refusal inside it passes instead, the
// refunded pass's too, and Features lists every feature, with no row
// written for anyone; past the season's end the rows answer again.
func TestFreeSeasonGrantsEveryFeature(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	free := entitlements.FreeSeason(season.Of(fixtureBought))
	store := &entitlements.Store{Pool: pool, Free: free}
	cases := rowFixture(t, store)
	if _, err := store.EndPayment(ctx, "pi_test_1", entitlements.EndRefunded, "test"); err != nil {
		t.Fatal(err)
	}
	refusalsInside := 0
	for _, c := range cases {
		inside := free.Open(c.at)
		if inside && !c.want {
			refusalsInside++
		}
		got, err := store.Can(ctx, c.account, c.feature, c.at)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if want := c.want || inside; got != want {
			t.Errorf("free season, %s: Can = %v, want %v", c.name, got, want)
		}
	}
	if refusalsInside == 0 {
		t.Fatal("the fixture has no refusal inside the free season to turn")
	}

	nobody := cases[len(cases)-1].account
	features, err := store.Features(ctx, nobody, fixtureBought)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(features, entitlements.AllFeatures()) {
		t.Errorf("free season Features = %v, want every feature %v", features, entitlements.AllFeatures())
	}
	var rows int
	if err := pool.QueryRow(ctx, `select count(*) from app.entitlements where account_id = $1`, nobody).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("the free season wrote %d entitlement rows, want none", rows)
	}
	after, err := store.Features(ctx, nobody, free.EndsAt())
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 0 {
		t.Errorf("after the free season Features = %v, want none from no rows", after)
	}
}

// A seat already the claimer's answers ErrAlreadyClaimed on a repeat claim,
// even after the claimer became a member, the no-op a repeat claim gets;
// a member with no seat is refused as covered by the Membership.
func TestRepeatClaimStaysAlreadyClaimedForAMember(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	store := &entitlements.Store{Pool: pool}
	account := func(workosID string) uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(ctx,
			`insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.com') returning id`,
			workosID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	buyer, claimer, member := account("user_buyer"), account("user_claimer"), account("user_member")
	var pass uuid.UUID
	if err := pool.QueryRow(ctx, `insert into app.group_passes (purchaser_id, league_name, season, seats, claim_code, stripe_checkout_session_id)
		values ($1, 'Tuesday', 2027, 10, 'claim-code-0001-abcdef', 'cs_group_1') returning id`, buyer).Scan(&pass); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2027, time.August, 20, 12, 0, 0, 0, time.UTC)
	if err := store.ClaimGroupPass(ctx, pass, claimer, now, "test"); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	for _, who := range []uuid.UUID{claimer, member} {
		if err := store.UpsertSubscription(ctx, entitlements.SubscriptionState{
			AccountID: who, SubscriptionID: "sub_" + who.String()[:8], Status: "active", Interval: "year",
			CurrentPeriodEnd: now.AddDate(1, 0, 0), GrantedBy: "test",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.ClaimGroupPass(ctx, pass, claimer, now, "test"); !errors.Is(err, entitlements.ErrAlreadyClaimed) {
		t.Errorf("repeat claim as a member: %v, want ErrAlreadyClaimed", err)
	}
	if err := store.ClaimGroupPass(ctx, pass, member, now, "test"); !errors.Is(err, entitlements.ErrCoveredByMembership) {
		t.Errorf("a member's first claim: %v, want ErrCoveredByMembership", err)
	}
}
