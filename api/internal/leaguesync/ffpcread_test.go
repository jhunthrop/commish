package leaguesync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// readersInTurn answers each connected member in turn, as the store does
// once a signed-out member is no longer a reader.
type readersInTurn struct{ ids []uuid.UUID }

func (r *readersInTurn) FFPCReader(context.Context, Ref) (uuid.UUID, string, error) {
	if len(r.ids) == 0 {
		return uuid.Nil, "", ErrNotConnected
	}
	id := r.ids[0]
	r.ids = r.ids[1:]
	return id, fixtureLTUID, nil
}

// signedOutFirst signs one member out and reads as any other.
type signedOutFirst struct {
	out    uuid.UUID
	league ffpc.League
}

func (s signedOutFirst) ReadLeague(_ context.Context, accountID uuid.UUID, _ string, _ bool) (ffpc.League, error) {
	if accountID == s.out {
		return ffpc.League{}, ffpc.ErrNeedsSignIn
	}
	return s.league, nil
}

func (s signedOutFirst) OpenLeague(context.Context, uuid.UUID, string) (string, error) {
	return fixtureLTUID, nil
}

// One league-mate signed out is not the viewer's news: the read goes on as
// the next connected member, and only with none left does it ask.
func TestFFPCReadMovesPastASignedOutMember(t *testing.T) {
	out, next := uuid.New(), uuid.New()
	clock := &fakeClock{now: time.Date(2026, 10, 13, 14, 0, 0, 0, time.UTC)}
	league := fixtureLeagueRead(t)
	ref := Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026}
	host := &FFPC{Member: signedOutFirst{out: out, league: league}, Readers: &readersInTurn{ids: []uuid.UUID{out, next}}, Now: clock.Now}
	if snap, err := host.Read(context.Background(), ref); err != nil || len(snap.Teams) != 12 {
		t.Fatalf("read past a signed-out member: %v", err)
	}
	alone := &FFPC{Member: signedOutFirst{out: out, league: league}, Readers: &readersInTurn{ids: []uuid.UUID{out}}, Now: clock.Now}
	if _, err := alone.Read(context.Background(), ref); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("no member left: %v", err)
	}
	// Two members found signed out in one read is a sign-out, so the stale
	// read says no one is signed in rather than that FFPC is not answering.
	second := uuid.New()
	both := &FFPC{Member: allSignedOut{}, Readers: &readersInTurn{ids: []uuid.UUID{out, second}}, Now: clock.Now}
	_, err := both.Read(context.Background(), ref)
	if !errors.Is(err, ErrSignInAgain) || !signedOut(err) {
		t.Fatalf("two members signed out in one read: %v", err)
	}
}

// allSignedOut signs every member out.
type allSignedOut struct{}

func (allSignedOut) ReadLeague(context.Context, uuid.UUID, string, bool) (ffpc.League, error) {
	return ffpc.League{}, ffpc.ErrNeedsSignIn
}

func (allSignedOut) OpenLeague(context.Context, uuid.UUID, string) (string, error) {
	return fixtureLTUID, nil
}

// With FFPC switched off, an FFPC league reads as off, never as a bad link.
func TestFFPCOffIsNotABadLink(t *testing.T) {
	p := &Poller{Hosts: Hosts{}, Store: nil, Now: time.Now, Log: quietLog()}
	_, err := p.Read(context.Background(), Ref{Host: HostFFPC, LeagueID: fixtureLeague, Season: 2026})
	if !errors.Is(err, ErrHostOff) {
		t.Fatalf("an off FFPC league: %v", err)
	}
}
