package companion

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// checker answers Can from one switch, the way a pass that lapses and is
// restored looks to the companion.
type checker struct{ live bool }

func (c *checker) Can(_ context.Context, _ uuid.UUID, f entitlements.Feature, _ time.Time) (bool, error) {
	return c.live && f == entitlements.LiveDraftAdvisor, nil
}

// storedRepo holds one companion with its report already stored. Any
// other call fails the test by its nil embedded interface.
type storedRepo struct {
	Repository
	row Row
}

func (s storedRepo) Get(_ context.Context, accountID, id uuid.UUID) (Row, error) {
	if id != s.row.ID || accountID != s.row.AccountID {
		return Row{}, ErrNotFound
	}
	return s.row, nil
}

func (s storedRepo) Report(context.Context, uuid.UUID) (json.RawMessage, bool, error) {
	return json.RawMessage(`{"teams":12}`), true, nil
}

// H1 (fix round 1): a pass that lapses loses the call and the report at
// once, with the 403 that names the feature; restored, the report reads.
func TestLapsedPassLosesTheCompanion(t *testing.T) {
	account := auth.Account{ID: uuid.New()}
	row := Row{ID: uuid.New(), AccountID: account.ID}
	can := &checker{}
	s := &Service{Store: storedRepo{row: row}, Entitlements: can, Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	send := func(handler http.HandlerFunc, path string) (int, string) {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.SetPathValue("id", row.ID.String())
		req = req.WithContext(auth.WithAccount(req.Context(), account))
		rec := httptest.NewRecorder()
		handler(rec, req)
		var body struct {
			Error *struct {
				Feature *string `json:"feature"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		feature := ""
		if body.Error != nil && body.Error.Feature != nil {
			feature = *body.Error.Feature
		}
		return rec.Code, feature
	}
	can.live = false
	for name, handler := range map[string]http.HandlerFunc{"read": s.get, "report": s.report} {
		code, feature := send(handler, "/companions/"+row.ID.String())
		if code != http.StatusForbidden || feature != string(entitlements.LiveDraftAdvisor) {
			t.Fatalf("lapsed %s: %d %q, want 403 live_draft_advisor", name, code, feature)
		}
	}
	can.live = true
	if code, _ := send(s.report, "/companions/"+row.ID.String()+"/report"); code != http.StatusOK {
		t.Fatalf("restored report: %d, want 200", code)
	}
}

// countingHost counts the reads that reach it and fails every one when
// down.
type countingHost struct {
	down  bool
	reads int
}

func (h *countingHost) Draft(context.Context, string) (sleeper.Draft, error) {
	h.reads++
	if h.down {
		return sleeper.Draft{}, sleeper.ErrUnavailable
	}
	return sleeper.Draft{ID: "1", Teams: 12, Rounds: 15, Status: sleeper.StatusDrafting}, nil
}

func (h *countingHost) Picks(context.Context, string, int, int) ([]sleeper.Pick, error) {
	return nil, nil
}

// M1 (fix round 1): one upstream read per draft per 2 s whatever the
// viewer count, with the host up and with it down before any read ever
// succeeded.
func TestPollerHoldsTheGap(t *testing.T) {
	for _, down := range []bool{false, true} {
		host := &countingHost{down: down}
		clock := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
		p := &Poller{Host: host, Now: func() time.Time { return clock }}
		const viewers = 25
		for range viewers {
			_, err := p.Read(context.Background(), "1")
			if down != (err != nil) {
				t.Fatalf("down=%v: err %v", down, err)
			}
		}
		clock = clock.Add(MinUpstreamGap - time.Millisecond)
		for range viewers {
			_, _ = p.Read(context.Background(), "1")
		}
		if host.reads != 1 {
			t.Fatalf("down=%v: %d host reads inside the gap, want 1", down, host.reads)
		}
		clock = clock.Add(time.Millisecond)
		for range viewers {
			_, _ = p.Read(context.Background(), "1")
		}
		if host.reads != 2 {
			t.Fatalf("down=%v: %d host reads after the gap, want 2", down, host.reads)
		}
	}
}
