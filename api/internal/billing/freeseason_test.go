package billing

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// freeNow is inside the 2026 free season: week 7.
var freeNow = time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)

// freeService has Stripe keys (the fake gateway stands in for them) and
// the 2026 free season on.
func freeService(gateway *FakeGateway) *Service {
	return &Service{
		Catalog: catalog{}, Sale: fixedSale{season: 2027}, Gateway: gateway, Free: entitlements.FreeSeason(2026),
		Now: func() time.Time { return freeNow }, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func readPlans(t *testing.T, s *Service) apitypes.PlanCatalog {
	t.Helper()
	rec := httptest.NewRecorder()
	s.plans(rec, httptest.NewRequest(http.MethodGet, "/billing/plans", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("plans: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data apitypes.PlanCatalog `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.Data
}

// In the free season the catalog says so, says checkout is shut although
// Stripe's keys are set, and carries no figure for any product; what each
// product unlocks is still listed.
func TestPlansInTheFreeSeason(t *testing.T) {
	c := readPlans(t, freeService(&FakeGateway{}))
	switch {
	case c.FreeSeason == nil || !*c.FreeSeason:
		t.Errorf("free_season = %v, want true", c.FreeSeason)
	case c.CheckoutOpen:
		t.Error("checkout reads open in the free season")
	case c.DraftPass != nil || len(c.Membership) != 0 || c.GroupPass != nil:
		t.Errorf("figures in the free season: pass %+v, membership %+v, group %+v", c.DraftPass, c.Membership, c.GroupPass)
	case len(c.Features.DraftPass) == 0:
		t.Error("the free season dropped what each product unlocks")
	}
	// Past the season's end the paid catalog is back, its flag false.
	after := freeService(&FakeGateway{})
	after.Gateway = nil
	after.Now = func() time.Time { return after.Free.EndsAt() }
	if c := readPlans(t, after); c.FreeSeason == nil || *c.FreeSeason || c.DraftPass == nil {
		t.Errorf("after the free season: free_season %v, pass %+v, want false with the launch figure", c.FreeSeason, c.DraftPass)
	}
}

// Checkout, the group pass's included, answers 409 free_season with the
// one sentence for every product, and nothing reaches Stripe.
func TestCheckoutIsShutInTheFreeSeason(t *testing.T) {
	gateway := &FakeGateway{}
	s := freeService(gateway)
	seats, name := 10, "Tuesday"
	for _, in := range []apitypes.CheckoutRequest{
		{Product: apitypes.ProductDraftPass},
		{Product: apitypes.ProductMembership},
		{Product: apitypes.ProductGroupPass, Seats: &seats, LeagueName: &name},
	} {
		body, err := json.Marshal(in)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/billing/checkout", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(auth.WithAccount(req.Context(), auth.Account{ID: uuid.New(), Email: "free@example.invalid"}))
		rec := httptest.NewRecorder()
		s.checkout(rec, req)
		var env struct {
			Error *apitypes.ErrorBody `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusConflict || env.Error == nil || env.Error.Code != httpx.CodeFreeSeason ||
			env.Error.Message != freeSeasonWords {
			t.Errorf("%s checkout: %d %s, want 409 %s", in.Product, rec.Code, rec.Body.String(), httpx.CodeFreeSeason)
		}
	}
	if len(gateway.Customers) != 0 || len(gateway.Checkouts) != 0 {
		t.Errorf("the free season reached Stripe: %d customers, %d checkouts", len(gateway.Customers), len(gateway.Checkouts))
	}
}

// The webhook stays live in the free season, so a test event lands.
func TestWebhookStaysLiveInTheFreeSeason(t *testing.T) {
	s := freeService(&FakeGateway{})
	s.Store, s.WebhookSecret = &Store{Pool: dbtest.Pool(t)}, testSecret
	payload := []byte(`{"id":"evt_free_1","object":"event","type":"customer.created",` +
		`"api_version":"2025-08-27.basil","data":{"object":{"id":"cus_free_1","object":"customer"}}}`)
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: testSecret})
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", bytes.NewReader(payload))
	req.Header.Set("Stripe-Signature", signed.Header)
	rec := httptest.NewRecorder()
	s.webhook(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("signed delivery in the free season: %d %s, want 200", rec.Code, rec.Body.String())
	}
}

// The free season's sentence passes the site's copy rules: no trading or
// betting word, no platform word, no dash between clauses, no semicolon
// (web/src/lib/format/banned-words.json).
func TestFreeSeasonWordsPassTheCopyRules(t *testing.T) {
	banned := regexp.MustCompile(`(?i)\b(markets?|prices?|priced|buy|buys|buying|sell|sells|selling|stock|hosts?|totals?|odds|bets?)\b|[—–;]`)
	if m := banned.FindString(freeSeasonWords); m != "" {
		t.Errorf("%q says %q", freeSeasonWords, m)
	}
}
