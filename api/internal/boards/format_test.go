package boards

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// A preset reads its stored board, TE premium the PPR one; a board
// source names its format, and one that names none is refused.
func TestFormatForAndSource(t *testing.T) {
	presets := map[apitypes.ScoringPreset]Format{
		apitypes.ScoringPresetPpr: PPR, apitypes.ScoringPresetHalfPpr: Half,
		apitypes.ScoringPresetStandard: Standard, apitypes.ScoringPresetTePremium: PPR,
	}
	for p, want := range presets {
		if got := FormatFor(p); got != want {
			t.Errorf("FormatFor(%s) = %s, want %s", p, got, want)
		}
	}
	for source, want := range map[string]Format{"commish_board_v9_ppr_12": PPR, "commish_board_v9_half_12": Half, "commish_board_v9_std_12": Standard} {
		if got, ok := FormatOfSource(source); !ok || got != want {
			t.Errorf("FormatOfSource(%s) = %s %v, want %s", source, got, ok, want)
		}
	}
	if _, ok := FormatOfSource("commish_board_v9_superflex_12"); ok {
		t.Error("a source naming no stored format was read as one")
	}
}

// fakeDirectory joins a scored board to two players, one the service
// scored and one it did not.
type fakeDirectory struct{}

func (fakeDirectory) LoadScored(_ context.Context, f Format, source string, asOf time.Time, points map[string]Projection) (*Raw, error) {
	raw := &Raw{Format: f, Source: source, AsOf: asOf, Custom: true}
	for _, id := range []string{"00-0039337", "00-0000001"} {
		p := Player{ID: "p" + id, Position: draft.WR}
		if proj, ok := points[id]; ok {
			pts := proj.Points
			p.Points = &pts
		}
		raw.Players = append(raw.Players, p)
	}
	return raw, nil
}

func customServer(t *testing.T, answer func(w http.ResponseWriter, in wireCustom)) (*CustomSource, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var in wireCustom
		if r.URL.Path != "/boards/custom" || json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		time.Sleep(20 * time.Millisecond)
		answer(w, in)
	}))
	t.Cleanup(srv.Close)
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	return &CustomSource{
		BaseURL: srv.URL, Client: srv.Client(), Season: 2026, Directory: fakeDirectory{}, TTL: time.Hour,
		Now: func() time.Time { return now },
	}, &calls
}

func goodAnswer(w http.ResponseWriter, in wireCustom) {
	pts := 200 + in.Rules.PointsPerReception
	_, _ = w.Write([]byte(`{"ok":true,"error":null,"data":{"season":2026,"source":"commish_board_v9_half_12",` +
		`"as_of":"2026-09-09T02:20:29.697Z","rows":[{"player_id":"00-0039337","projected_points":` + jsonNumber(pts) +
		`,"floor_points":150,"median_points":200,"ceiling_points":250}]}}`))
}

func jsonNumber(v float64) string { b, _ := json.Marshal(v); return string(b) }

func halfRules() apitypes.ScoringRules {
	return apitypes.ScoringRules{PointsPerReception: 0.5, PointsPerPassingYard: 0.04, PointsPerPassingTouchdown: 4}
}

// A league's rules are asked for once however many rooms load them at the
// same time, kept by rules, and joined to the directory: the scored
// player carries the service's points, the other none.
func TestCustomSourceBuildsOncePerRules(t *testing.T) {
	src, calls := customServer(t, goodAnswer)
	var wg sync.WaitGroup
	raws := make([]*Raw, 8)
	for i := range raws {
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := src.Load(context.Background(), halfRules(), 12, nil)
			if err != nil {
				t.Error(err)
			}
			raws[i] = raw
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("8 rooms made %d calls, want 1", calls.Load())
	}
	raw := raws[0]
	if raw.Format != Half || !raw.Custom || raw.Players[0].Points == nil || *raw.Players[0].Points != 200.5 || raw.Players[1].Points != nil {
		t.Fatalf("raw %+v", raw)
	}
	other := halfRules()
	other.PointsPerReception = 1
	if _, err := src.Load(context.Background(), other, 12, nil); err != nil || calls.Load() != 2 {
		t.Fatalf("other rules: %v, %d calls", err, calls.Load())
	}
	if _, err := src.Load(context.Background(), halfRules(), 10, nil); err != nil || calls.Load() != 2 {
		t.Fatalf("the same rules for another shape: %v, %d calls, want the kept board", err, calls.Load())
	}
}

// The api trusts no service's shape: a failure, a source that names no
// stored board, another season or a row that cannot be is
// ErrCustomUnavailable, and so is an unconfigured source.
func TestCustomSourceRefusesWhatCannotBe(t *testing.T) {
	answers := map[string]func(http.ResponseWriter, wireCustom){
		"503": func(w http.ResponseWriter, _ wireCustom) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"ok":false,"data":null,"error":"warming up"}`))
		},
		"source": func(w http.ResponseWriter, _ wireCustom) {
			_, _ = w.Write([]byte(`{"ok":true,"data":{"season":2026,"source":"elsewhere","as_of":"2026-09-09T00:00:00Z","rows":[{"player_id":"a","projected_points":1}]}}`))
		},
		"season": func(w http.ResponseWriter, _ wireCustom) {
			_, _ = w.Write([]byte(`{"ok":true,"data":{"season":2025,"source":"commish_board_v9_ppr_12","as_of":"2026-09-09T00:00:00Z","rows":[{"player_id":"a","projected_points":1}]}}`))
		},
		"row": func(w http.ResponseWriter, _ wireCustom) {
			_, _ = w.Write([]byte(`{"ok":true,"data":{"season":2026,"source":"commish_board_v9_ppr_12","as_of":"2026-09-09T00:00:00Z","rows":[{"player_id":"../x","projected_points":1}]}}`))
		},
		"points": func(w http.ResponseWriter, _ wireCustom) {
			_, _ = w.Write([]byte(`{"ok":true,"data":{"season":2026,"source":"commish_board_v9_ppr_12","as_of":"2026-09-09T00:00:00Z","rows":[{"player_id":"a","projected_points":1e9}]}}`))
		},
	}
	for name, answer := range answers {
		src, _ := customServer(t, answer)
		if _, err := src.Load(context.Background(), halfRules(), 12, nil); !errors.Is(err, ErrCustomUnavailable) {
			t.Errorf("%s: %v, want ErrCustomUnavailable", name, err)
		}
	}
	var none *CustomSource
	if _, err := none.Load(context.Background(), halfRules(), 12, nil); !errors.Is(err, ErrCustomUnavailable) {
		t.Errorf("an unconfigured source: %v", err)
	}
}

// The basis names a league's own scoring, not a stored board.
func TestCustomBasis(t *testing.T) {
	b := Board{Raw: &Raw{Format: Half, Season: 2026, Custom: true}, teams: 10}
	if got := b.Basis(); got[:len("Your league's scoring.")] != "Your league's scoring." {
		t.Errorf("basis %q", got)
	}
}

// A 400 is the service refusing what the api built: a contract bug, not
// a reason to try again.
func TestCustomSourceRefusalIsNotTransient(t *testing.T) {
	src, _ := customServer(t, func(w http.ResponseWriter, _ wireCustom) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"data":null,"error":"shape.slots.7.count must be a whole number from 1 to 15"}`))
	})
	_, err := src.Load(context.Background(), halfRules(), 12, nil)
	if !errors.Is(err, ErrCustomRefused) || errors.Is(err, ErrCustomUnavailable) {
		t.Fatalf("%v, want ErrCustomRefused only", err)
	}
}
