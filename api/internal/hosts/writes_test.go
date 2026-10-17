package hosts

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
)

// fakeWrites answers each platform's lineup moves, or fails.
type fakeWrites struct {
	moves apitypes.LineupMoves
	err   error
	asked []string
}

func (f *fakeWrites) LineupMove(_ context.Context, _ uuid.UUID, host string) (apitypes.LineupMoves, error) {
	f.asked = append(f.asked, host)
	return f.moves, f.err
}

// oneStore answers one connection.
type oneStore struct{ c Connection }

func (s oneStore) List(context.Context, uuid.UUID) ([]Connection, error) {
	return []Connection{s.c}, nil
}

func mflConn(over func(*Connection)) Connection {
	c := Connection{Host: "mfl", Status: StatusConnected, CreatedAt: time.Now(), Proven: true, ConsentVersion: MFLConsentVersion}
	if over != nil {
		over(&c)
	}
	return c
}

// Each connection carries its consent version and whether its lineup is
// set from here; off, the reason is the Account room's own sentence for
// the case, naming the platform, never the Lineup screen's (Lane 66k L1).
// A failed check keeps the row with writes off and a reason.
func TestHostsCarryConsentAndWrites(t *testing.T) {
	me := auth.Account{ID: uuid.New()}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	unavailable := apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, TakesWrites: true, WritesOn: true}
	cases := []struct {
		name  string
		conn  Connection
		moves apitypes.LineupMoves
		err   error
		on    bool
		words string
	}{
		{"on", mflConn(nil), apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupAvailable, TakesWrites: true, WritesOn: true}, nil, true, ""},
		{"takes none", Connection{Host: "ffpc", Status: StatusConnected, ConsentVersion: ConsentVersion},
			apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable}, nil, false, "FFPC takes no lineups from here."},
		{"switched off", mflConn(nil), apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, TakesWrites: true}, nil, false,
			"Lineups on MyFantasyLeague are not open to your account yet."},
		{"signed out", mflConn(func(c *Connection) { c.Status = StatusSignedOut }), unavailable, nil, false,
			"Connect MyFantasyLeague again to set your lineup from here."},
		{"old consent", mflConn(func(c *Connection) { c.ConsentVersion = 0 }), unavailable, nil, false,
			"Connect MyFantasyLeague again and agree to moves to set your lineup from here."},
		{"check failed", mflConn(nil), apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupAvailable}, context.DeadlineExceeded, false, uncheckedWords},
	}
	for _, c := range cases {
		w := &fakeWrites{moves: c.moves, err: c.err}
		l := &List{Store: oneStore{c.conn}, Writes: w, Log: log}
		got := listHosts(t, l, &me).Connections[0]
		if got.ConsentVersion != c.conn.ConsentVersion || got.WritesOn != c.on {
			t.Errorf("%s: %+v", c.name, got)
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
