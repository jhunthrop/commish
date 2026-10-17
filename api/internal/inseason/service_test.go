package inseason

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

type fakeLeagues struct{ league League }

func (f fakeLeagues) Follow(http.ResponseWriter, *http.Request) (League, bool) { return f.league, true }

type fakeFacts struct {
	data       Data
	projection boards.WeekProjection
	err        error
}

func (f fakeFacts) Data(context.Context, int) (Data, error) { return f.data, nil }

func (f fakeFacts) Projection(_ context.Context, _, week int) (boards.WeekProjection, error) {
	if f.err != nil {
		return boards.WeekProjection{}, f.err
	}
	p := f.projection
	p.Week = week
	return p, nil
}

type fakeHolds struct {
	held    map[string]bool
	account uuid.UUID
}

func (f *fakeHolds) Held(_ context.Context, id uuid.UUID) (map[string]bool, error) {
	f.account = id
	return f.held, nil
}

type envelope struct {
	Ok    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Fields  map[string]string `json:"fields"`
	} `json:"error"`
}

func serve(t *testing.T, s *Service, path string) (int, envelope) {
	t.Helper()
	mux := http.NewServeMux()
	for _, rt := range s.Routes() {
		mux.HandleFunc(rt.Method+" "+rt.Path, rt.Handler)
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req = req.WithContext(auth.WithAccount(req.Context(), auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-00000000000a")}))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("%s: %v: %s", path, err, rec.Body.String())
	}
	return rec.Code, env
}

func fixtureService(t *testing.T, l League, data Data, holds *fakeHolds) *Service {
	t.Helper()
	return &Service{Leagues: fakeLeagues{l}, Facts: fakeFacts{data: data}, Holds: holds, Now: func() time.Time { return fixtureNow },
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

const leaguePath = "/leagues/attached/6b1f1a64-63a8-4b52-9a4b-8fb1d2f1c0de/"

func TestRoutesAnswerInTheEnvelope(t *testing.T) {
	f := newFixture(t)
	holds := &fakeHolds{}
	s := fixtureService(t, f.league, f.data, holds)
	for _, route := range []string{"lineup", "matchup", "waivers", "waivers?position=RB", "trades", "trades?player=p003"} {
		code, env := serve(t, s, leaguePath+route)
		if code != http.StatusOK || !env.Ok || len(env.Data) == 0 {
			t.Fatalf("%s: %d %+v", route, code, env.Error)
		}
	}
	if holds.account != uuid.MustParse("00000000-0000-0000-0000-00000000000a") {
		t.Fatalf("held read for %s, not the signed-in account", holds.account)
	}
}

type fakeMoves struct {
	host    string
	account uuid.UUID
	err     error
	// partial is what a failed check answers with its error.
	partial apitypes.LineupMoves
	// partialClaim is the same for a claim (review 66f M2).
	partialClaim apitypes.WaiverMoves
}

func (f *fakeMoves) LineupMove(_ context.Context, accountID uuid.UUID, host string) (apitypes.LineupMoves, error) {
	f.host, f.account = host, accountID
	if f.err != nil {
		return f.partial, f.err
	}
	note := "To set your lineup from here, connect ESPN again on your account page and agree to moves."
	return apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, Note: &note}, nil
}

func (f *fakeMoves) ClaimMove(_ context.Context, accountID uuid.UUID, host string) (apitypes.WaiverMoves, error) {
	f.host, f.account = host, accountID
	if f.err != nil {
		return f.partialClaim, f.err
	}
	return apitypes.WaiverMoves{Claim: apitypes.WaiverMovesClaimAvailable}, nil
}

// The waivers say whether the member may claim on the host from our
// screen, asked for the signed-in account and the league's host; with no
// moves wired, or a failed check, it is the host's page.
func TestWaiversCarryMoves(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	_, env := serve(t, s, leaguePath+"waivers")
	var plain apitypes.WaiverAdvice
	if err := json.Unmarshal(env.Data, &plain); err != nil || plain.Moves.Claim != apitypes.WaiverMovesClaimUnavailable || plain.Moves.Note != nil {
		t.Fatalf("no moves wired: %+v %v", plain.Moves, err)
	}
	moves := &fakeMoves{}
	s.Moves = moves
	_, env = serve(t, s, leaguePath+"waivers?position=RB")
	var got apitypes.WaiverAdvice
	if err := json.Unmarshal(env.Data, &got); err != nil || got.Moves.Claim != apitypes.WaiverMovesClaimAvailable {
		t.Fatalf("moves: %+v %v", got.Moves, err)
	}
	if moves.host != f.league.Snap.Ref.Host || moves.account != uuid.MustParse("00000000-0000-0000-0000-00000000000a") {
		t.Fatalf("asked for %q as %s", moves.host, moves.account)
	}
	moves.err = errors.New("the allow list did not answer")
	code, env := serve(t, s, leaguePath+"waivers")
	var closed apitypes.WaiverAdvice
	if err := json.Unmarshal(env.Data, &closed); err != nil || code != http.StatusOK || closed.Moves.Claim != apitypes.WaiverMovesClaimUnavailable {
		t.Fatalf("a failed check: %d %+v %v", code, closed.Moves, err)
	}
}

// The lineup says whether the member may set it on the host from our
// screen, asked for the signed-in account and the league's host; with no
// moves wired it is the host's page.
func TestLineupCarriesMoves(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	_, env := serve(t, s, leaguePath+"lineup")
	var plain apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &plain); err != nil || plain.Moves.Lineup != apitypes.LineupMovesLineupUnavailable || plain.Moves.Note != nil ||
		plain.Moves.TakesWrites || plain.Moves.Reason == nil || !strings.Contains(*plain.Moves.Reason, "copy the lineup") {
		t.Fatalf("no moves wired: %+v %v", plain.Moves, err)
	}
	moves := &fakeMoves{}
	s.Moves = moves
	_, env = serve(t, s, leaguePath+"lineup")
	var got apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &got); err != nil || got.Moves.Note == nil {
		t.Fatalf("moves: %+v %v", got.Moves, err)
	}
	if moves.host != f.league.Snap.Ref.Host || moves.account != uuid.MustParse("00000000-0000-0000-0000-00000000000a") {
		t.Fatalf("asked for %q as %s", moves.host, moves.account)
	}
	// A failed check fails closed: start and sit still answers, the verb
	// the host's page.
	moves.err = errors.New("the allow list did not answer")
	code, env := serve(t, s, leaguePath+"lineup")
	var closed apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &closed); err != nil || code != http.StatusOK || closed.Moves.Lineup != apitypes.LineupMovesLineupUnavailable ||
		closed.Moves.Reason == nil {
		t.Fatalf("a failed check: %d %+v %v", code, closed.Moves, err)
	}
	// What the check knew before it failed is kept: the platform takes
	// writes, and the line says why not now.
	why := "Lineups are not sent to ESPN from here yet, so copy the lineup there."
	moves.partial = apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable, TakesWrites: true, Reason: &why}
	_, env = serve(t, s, leaguePath+"lineup")
	var partial apitypes.LineupAdvice
	if err := json.Unmarshal(env.Data, &partial); err != nil || !partial.Moves.TakesWrites || partial.Moves.Reason == nil || *partial.Moves.Reason != why {
		t.Fatalf("a partial answer: %+v %v", partial.Moves, err)
	}
}

// A team missing from the last read is its own code, so the page offers to
// read the host again for it and for no other 404.
func TestMissingTeamHasItsOwnCode(t *testing.T) {
	f := newFixture(t)
	f.league.Me = 99
	for _, route := range []string{"lineup", "matchup", "waivers", "trades"} {
		code, env := serve(t, fixtureService(t, f.league, f.data, &fakeHolds{}), leaguePath+route)
		if code != http.StatusNotFound || env.Error == nil || env.Error.Code != httpx.CodeTeamNotRead {
			t.Fatalf("%s: %d %+v", route, code, env.Error)
		}
	}
}

func TestRouteErrors(t *testing.T) {
	f := newFixture(t)
	noGames := f.league
	noGames.Snap.Week = 0
	unsaved := f.league
	unsaved.Saved, unsaved.SettingsNote = nil, "A mock draft cannot rerun this league yet: its lineup has IDP."
	cases := []struct {
		name    string
		league  League
		path    string
		code    int
		message string
		field   string
	}{
		{"a league with no current week", noGames, "lineup", http.StatusConflict, leaguesync.NoGamesWords, ""},
		{"a league with no saved scoring", unsaved, "trades", http.StatusUnprocessableEntity, unsaved.SettingsNote, ""},
		{"a position we do not rank", f.league, "waivers?position=LB", http.StatusBadRequest, "", fieldPosition},
		{"a player on no roster", f.league, "trades?player=p999", http.StatusBadRequest, "", fieldPlayer},
	}
	for _, c := range cases {
		code, env := serve(t, fixtureService(t, c.league, f.data, &fakeHolds{}), leaguePath+c.path)
		if code != c.code || env.Ok || env.Error == nil {
			t.Fatalf("%s: %d %+v", c.name, code, env)
		}
		if c.message != "" && env.Error.Message != c.message {
			t.Fatalf("%s: %q", c.name, env.Error.Message)
		}
		if c.field != "" && env.Error.Fields[c.field] == "" {
			t.Fatalf("%s: fields %v", c.name, env.Error.Fields)
		}
	}
}
