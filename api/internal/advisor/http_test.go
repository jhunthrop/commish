package advisor

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// fixed is an advisor that always answers the same card.
type fixed struct{ card Card }

func (f fixed) Card(context.Context, Request) (Card, error) { return f.card, nil }

func declining(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"detail":"a pick is owed"}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func request() Request {
	return Request{
		State:  draft.State{DraftOrder: []string{"seat01", "seat02"}, PickNumber: 3},
		TeamID: "seat01", Teams: 2, Board: boards.Board{Raw: &boards.Raw{}},
	}
}

// The advisor's 422, for a room with an owed or skipped pick, is a decline,
// whatever its body says.
func TestHTTPDeclinesOn422(t *testing.T) {
	srv := declining(t)
	_, err := HTTP{BaseURL: srv.URL, Client: srv.Client()}.Card(context.Background(), request())
	if !errors.Is(err, ErrDeclined) {
		t.Fatalf("got %v, want ErrDeclined", err)
	}
}

// A declined room is answered by the engine, as the oracle does.
func TestFallbackAnswersADeclinedRoom(t *testing.T) {
	srv := declining(t)
	engine := Card{Source: SourceSim, Call: "engine-call"}
	f := Fallback{
		Primary:   HTTP{BaseURL: srv.URL, Client: srv.Client()},
		Secondary: fixed{card: engine},
		Timeout:   time.Second,
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	got, err := f.Card(context.Background(), request())
	if err != nil || got.Call != "engine-call" {
		t.Fatalf("got %+v, %v; want the engine's card", got, err)
	}
}

// The rows after the call carry the advisor's contrast as their why; the
// call keeps its own.
func TestHTTPRowsTakeTheirContrast(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"error":null,"data":{"pickNumber":3,"nextPickNumber":6,"survival":{},"shortlist":[` +
			`{"playerId":"a","why":"Call why.","contrast":null},{"playerId":"b","why":"Plain why.","contrast":"He is another back."}]}}`))
	}))
	t.Cleanup(srv.Close)
	card, err := HTTP{BaseURL: srv.URL, Client: srv.Client()}.Card(context.Background(), request())
	if err != nil || card.Shortlist[0].Why != "Call why." || card.Shortlist[1].Why != "He is another back." {
		t.Fatalf("card %+v, %v", card.Shortlist, err)
	}
}
