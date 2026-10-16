package leaguesync

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
)

// draftingMember is the captured league with a draft board the test
// sets: the captured board (complete), one part made, one empty, or a
// board that does not answer.
type draftingMember struct {
	fakeMember
	draft      ffpc.Draft
	draftErr   error
	draftReads int
}

func (m *draftingMember) ReadDraft(_ context.Context, accountID uuid.UUID, ltuid string) (ffpc.Draft, error) {
	m.draftReads++
	if accountID != m.owner || ltuid != fixtureLTUID {
		return ffpc.Draft{}, errors.New("not this member's league")
	}
	return m.draft, m.draftErr
}

func capturedBoard(t *testing.T) ffpc.Draft {
	t.Helper()
	page, err := os.ReadFile(filepath.Join("..", "hosts", "ffpc", "testdata", "ffpc-draft-board.html"))
	if err != nil {
		t.Fatal(err)
	}
	d, err := ffpc.ParseDraftBoard(page)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// FFPC states the draft on its draft board ("Your draft is complete" with
// every pick made), never a hardcoded in_season; a complete draft is not
// read again; a board that does not answer leaves the draft unstated and
// the rosters decide, said in the basis. The rules' Duration row gives
// the playoff start week (13).
func TestFFPCPhase(t *testing.T) {
	owner := uuid.New()
	board := capturedBoard(t)
	part := board
	part.Complete, part.Picks = false, board.Picks[:30]
	empty := board
	empty.Complete, empty.Picks = false, nil
	cases := []struct {
		name     string
		draft    ffpc.Draft
		draftErr error
		phase    apitypes.LeaguePhase
		basis    string
	}{
		{"the captured board", board, nil, apitypes.LeaguePhaseInSeason, "FFPC says the draft is done and week 6 is under way."},
		{"part of the draft made", part, nil, apitypes.LeaguePhaseDraftDay, "FFPC says the draft is under way."},
		{"no pick made", empty, nil, apitypes.LeaguePhasePreDraft, "FFPC says the league has not drafted yet."},
		{"the board does not answer", ffpc.Draft{}, ffpc.ErrNotThisPage, apitypes.LeaguePhaseInSeason,
			"FFPC does not say whether the league has drafted, and its week 6 is under way."},
	}
	for _, c := range cases {
		member := &draftingMember{fakeMember: fakeMember{t: t, owner: owner, league: fixtureLeagueRead(t)}, draft: c.draft, draftErr: c.draftErr}
		host := &FFPC{Member: member, Now: func() time.Time { return phaseNow }, Log: quietLog()}
		snap, _, err := host.ReadAs(context.Background(), owner, fixtureLTUID)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		wantPhase(t, c.name, hostPhase(snap), c.phase, c.basis, 13)
		if _, _, err := host.ReadAs(context.Background(), owner, fixtureLTUID); err != nil {
			t.Fatal(err)
		}
		want := 2
		if c.draft.Complete {
			want = 1
		}
		if member.draftReads != want {
			t.Errorf("%s: %d draft reads over two league reads, want %d", c.name, member.draftReads, want)
		}
	}
}
