package entitlements_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/season"
)

// The boundary this package owns: Can answers from the rows alone. A
// pass grants the pass's features for its season and nothing past its
// end, a membership grants the rest until its period (plus grace) ends,
// and a refunded row grants nothing.
func TestCanAnswersFromRows(t *testing.T) {
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
	passHolder, member, nobody := account("user_pass"), account("user_member"), account("user_none")

	bought := time.Date(2027, time.August, 20, 12, 0, 0, 0, time.UTC)
	if _, err := store.GrantPass(ctx, entitlements.PassGrant{
		AccountID: passHolder, Season: season.Of(bought), Source: entitlements.SourcePurchase,
		CheckoutSessionID: "cs_test_1", PaymentIntentID: "pi_test_1", GrantedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	periodEnd := bought.AddDate(1, 0, 0)
	if err := store.UpsertSubscription(ctx, entitlements.SubscriptionState{
		AccountID: member, SubscriptionID: "sub_test_1", Status: "active", Interval: "year",
		CurrentPeriodEnd: periodEnd, GrantedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}

	afterSeason := season.End(2027).Add(time.Minute)
	afterGrace := periodEnd.Add(entitlements.SubscriptionGrace).Add(time.Minute)
	cases := []struct {
		name    string
		account uuid.UUID
		feature entitlements.Feature
		at      time.Time
		want    bool
	}{
		{"pass grants the advisor", passHolder, entitlements.LiveDraftAdvisor, bought, true},
		{"pass grants custom scoring", passHolder, entitlements.CustomScoring, bought, true},
		{"pass does not grant full reasoning", passHolder, entitlements.FullReasoning, bought, false},
		{"pass ends with its season", passHolder, entitlements.LiveDraftAdvisor, afterSeason, false},
		{"membership grants full reasoning", member, entitlements.FullReasoning, bought, true},
		{"membership grants early run", member, entitlements.EarlyRun, bought, true},
		{"membership lasts through grace", member, entitlements.EarlyRun, periodEnd.Add(time.Hour), true},
		{"membership ends after grace", member, entitlements.EarlyRun, afterGrace, false},
		{"no rows, no features", nobody, entitlements.LiveDraftAdvisor, bought, false},
	}
	for _, c := range cases {
		got, err := store.Can(ctx, c.account, c.feature, c.at)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: Can = %v, want %v", c.name, got, c.want)
		}
	}

	if _, err := store.EndPayment(ctx, "pi_test_1", entitlements.EndRefunded, "test"); err != nil {
		t.Fatal(err)
	}
	if got, err := store.Can(ctx, passHolder, entitlements.LiveDraftAdvisor, bought); err != nil || got {
		t.Errorf("refunded pass: Can = %v (err %v), want false", got, err)
	}
}
