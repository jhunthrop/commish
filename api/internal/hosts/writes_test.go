package hosts

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
)

// fakeWrites answers each platform's writes state, or fails.
type fakeWrites struct {
	state WriteState
	err   error
	asked []string
}

func (f *fakeWrites) LineupWrites(_ context.Context, _ uuid.UUID, host string) (WriteState, error) {
	f.asked = append(f.asked, host)
	return f.state, f.err
}

// oneStore answers one connection.
type oneStore struct{ c Connection }

func (s oneStore) List(context.Context, uuid.UUID) ([]Connection, error) {
	return []Connection{s.c}, nil
}

// Each connection carries its consent version and whether its lineup is
// set from here; off, the reason is the Account room's own sentence for the
// check hostmoves names, naming the platform, never the Lineup screen's
// (Lane 66k L1, rereview N5). A failed check keeps the row with writes off
// and a reason.
func TestHostsCarryConsentAndWrites(t *testing.T) {
	me := auth.Account{ID: uuid.New()}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	mfl := Connection{Host: "mfl", Status: StatusConnected, CreatedAt: time.Now(), Proven: true, ConsentVersion: MFLConsentVersion}
	cases := []struct {
		name  string
		host  string
		state WriteState
		err   error
		on    bool
		words string
	}{
		{"on", "mfl", WriteState{On: true}, nil, true, ""},
		{"takes none", "ffpc", WriteState{Off: WritesOffTakesNone}, nil, false, "FFPC takes no lineups from here."},
		{"not open", "mfl", WriteState{Off: WritesOffNotOpen}, nil, false, "Lineups on MyFantasyLeague are not open to your account yet."},
		{"connect", "mfl", WriteState{Off: WritesOffConnect}, nil, false, "Connect MyFantasyLeague to set your lineup from here."},
		{"signed out", "mfl", WriteState{Off: WritesOffReconnect}, nil, false, "Connect MyFantasyLeague again to set your lineup from here."},
		{"old consent", "mfl", WriteState{Off: WritesOffReconsent}, nil, false, "Connect MyFantasyLeague again and agree to moves to set your lineup from here."},
		{"check failed", "mfl", WriteState{On: true}, context.DeadlineExceeded, false, uncheckedWords},
	}
	for _, c := range cases {
		conn := mfl
		conn.Host = c.host
		w := &fakeWrites{state: c.state, err: c.err}
		l := &List{Store: oneStore{conn}, Writes: w, Log: log}
		got := listHosts(t, l, &me).Connections[0]
		if got.ConsentVersion != conn.ConsentVersion || got.WritesOn != c.on || len(w.asked) != 1 || w.asked[0] != c.host {
			t.Errorf("%s: %+v asked %v", c.name, got, w.asked)
			continue
		}
		said := ""
		if got.WritesReason != nil {
			said = *got.WritesReason
		}
		if said != c.words {
			t.Errorf("%s: reason %q, want %q", c.name, said, c.words)
		}
	}
}
