package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
)

const testSecret = "whsec_test_secret"

// The boundary this package owns: nothing reaches the database unless
// Stripe signed it. A forged or missing signature is refused before the
// body is read for anything, and a signed event is recorded once, so a
// redelivery is a no-op.
func TestWebhookRejectsBadSignature(t *testing.T) {
	pool := dbtest.Pool(t)
	s := &Service{
		Store: &Store{Pool: pool}, Gateway: &FakeGateway{}, WebhookSecret: testSecret,
		Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	payload := []byte(`{"id":"evt_test_1","object":"event","type":"customer.created",` +
		`"api_version":"2025-08-27.basil","data":{"object":{"id":"cus_test_1","object":"customer"}}}`)
	send := func(signature string) int {
		req := httptest.NewRequest(http.MethodPost, "/billing/webhook", bytes.NewReader(payload))
		if signature != "" {
			req.Header.Set("Stripe-Signature", signature)
		}
		rec := httptest.NewRecorder()
		s.webhook(rec, req)
		return rec.Code
	}
	events := func() int {
		var n int
		if err := pool.QueryRow(context.Background(), `select count(*) from app.billing_events`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	forged := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_someone_else"})
	if code := send(forged.Header); code != http.StatusBadRequest {
		t.Fatalf("forged signature: status %d, want 400", code)
	}
	if code := send(""); code != http.StatusBadRequest {
		t.Fatalf("missing signature: status %d, want 400", code)
	}
	stale := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload: payload, Secret: testSecret, Timestamp: time.Now().Add(-time.Hour),
	})
	if code := send(stale.Header); code != http.StatusBadRequest {
		t.Fatalf("replayed signature: status %d, want 400", code)
	}
	if n := events(); n != 0 {
		t.Fatalf("refused deliveries recorded %d events", n)
	}

	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: testSecret})
	for i := range 2 {
		if code := send(signed.Header); code != http.StatusOK {
			t.Fatalf("signed delivery %d: status %d, want 200", i+1, code)
		}
	}
	var processed bool
	if err := pool.QueryRow(context.Background(),
		`select processed_at is not null from app.billing_events where id = 'evt_test_1'`).Scan(&processed); err != nil {
		t.Fatal(err)
	}
	if n := events(); n != 1 || !processed {
		t.Fatalf("after two deliveries: %d events, processed %v, want 1 processed", n, processed)
	}
}

type catalog struct{}

func (catalog) ProductFeatures(context.Context) (map[entitlements.Product][]entitlements.Feature, error) {
	return map[entitlements.Product][]entitlements.Feature{
		entitlements.ProductDraftPass: {entitlements.LiveDraftAdvisor},
	}, nil
}

type fixedSale struct{ season int }

func (f fixedSale) Season(context.Context, time.Time) int { return f.season }

// With Stripe not configured the catalog still answers, its figures the
// launch prices stripe-setup creates, and says no one can pay yet.
func TestPlansWithCheckoutClosed(t *testing.T) {
	s := &Service{Catalog: catalog{}, Sale: fixedSale{season: 2027}, Now: time.Now,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec := httptest.NewRecorder()
	s.plans(rec, httptest.NewRequest(http.MethodGet, "/billing/plans", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Data apitypes.PlanCatalog `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	c := body.Data
	switch {
	case c.CheckoutOpen:
		t.Error("checkout reads open with no Stripe")
	case c.Season != 2027 || !c.PassEndsAt.Equal(time.Date(2028, 3, 1, 0, 0, 0, 0, time.UTC)):
		t.Errorf("season %d ending %s, want 2027 ending 2028-03-01", c.Season, c.PassEndsAt)
	// The figures themselves, as the pass page prints them, never the
	// constants they come from: a changed constant must fail here.
	case c.DraftPass == nil || c.DraftPass.AmountCents != 3900:
		t.Errorf("draft pass %+v, want $39", c.DraftPass)
	case len(c.Membership) != 2 || c.Membership[0].AmountCents != 9900 || c.Membership[1].AmountCents != 1499:
		t.Errorf("membership %+v, want $99 a year first, then $14.99 a month", c.Membership)
	case c.GroupPass == nil || c.GroupPass.PerSeat.AmountCents != 2900 || c.GroupPass.MinSeats != 8:
		t.Errorf("group pass %+v, want $29 a seat from 8 seats", c.GroupPass)
	}
}
