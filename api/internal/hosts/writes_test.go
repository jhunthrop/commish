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

// consentStore answers one MyFantasyLeague connection agreed at version 1.
type consentStore struct{}

func (consentStore) List(context.Context, uuid.UUID) ([]Connection, error) {
	return []Connection{{Host: "mfl", Status: StatusConnected, CreatedAt: time.Now(), Proven: true, ConsentVersion: MFLConsentVersion}}, nil
}

// Each connection carries its consent version and whether its lineup is
// set from here; off, the reason says why in the platform's words, and a
// failed check keeps the row with writes off and a reason.
func TestHostsCarryConsentAndWrites(t *testing.T) {
	me := auth.Account{ID: uuid.New()}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	on := &fakeWrites{moves: apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupAvailable}}
	l := &List{Store: consentStore{}, Writes: on, Log: log}
	c := listHosts(t, l, &me).Connections[0]
	if c.ConsentVersion != MFLConsentVersion || !c.WritesOn || c.WritesReason != nil || len(on.asked) != 1 || on.asked[0] != "mfl" {
		t.Fatalf("on: %+v after %v", c, on.asked)
	}

	reason := "Lineups on MyFantasyLeague are not open to your account yet."
	l.Writes = &fakeWrites{moves: apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, Reason: &reason}}
	if c := listHosts(t, l, &me).Connections[0]; c.WritesOn || c.WritesReason == nil || *c.WritesReason != reason {
		t.Fatalf("off: %+v", c)
	}

	note := "Connect MyFantasyLeague again to agree to moves."
	l.Writes = &fakeWrites{moves: apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, Note: &note}}
	if c := listHosts(t, l, &me).Connections[0]; c.WritesOn || c.WritesReason == nil || *c.WritesReason != note {
		t.Fatalf("waiting on the member: %+v", c)
	}

	l.Writes = &fakeWrites{moves: apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupAvailable}, err: context.DeadlineExceeded}
	if c := listHosts(t, l, &me).Connections[0]; c.WritesOn || c.WritesReason == nil || *c.WritesReason != uncheckedWords {
		t.Fatalf("failed check: %+v", c)
	}
}
