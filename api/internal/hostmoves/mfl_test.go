package hostmoves

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/mflhost"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/mfl/mfltest"
)

// mflMember reads the stand-in with the fixture's session, as
// *mflhost.Member does with a kept one.
type mflMember struct {
	client *mfl.Client
	err    error
}

func (m mflMember) Lineup(ctx context.Context, _ uuid.UUID, leagueID string, season int) (mfl.TeamLineup, mfl.Session, error) {
	if m.err != nil {
		return mfl.TeamLineup{}, mfl.Session{}, m.err
	}
	sess := mfl.Session{UserID: mfltest.Session}
	l, err := m.client.MemberLineup(ctx, sess, season, leagueID)
	return l, sess, err
}

// directory is the kept MyFantasyLeague directory for the fixture's
// players.
type directory map[string]leaguesync.HostPlayer

func (d directory) HostPlayersByID(_ context.Context, host string, ids []string) (map[string]leaguesync.HostPlayer, error) {
	out := map[string]leaguesync.HostPlayer{}
	for _, id := range ids {
		if p, ok := d[id]; ok && host == mflhost.Host {
			out[id] = p
		}
	}
	return out, nil
}

var mflDirectory = directory{
	mfltest.QB:       {ID: mfltest.QB, Name: "Josh Allen", Position: "QB"},
	mfltest.RBStarts: {ID: mfltest.RBStarts, Name: "Kimani Vidal", Position: "RB"},
	mfltest.RBBench:  {ID: mfltest.RBBench, Name: "Bucky Irving", Position: "RB"},
	mfltest.WR1:      {ID: mfltest.WR1, Name: "Nico Collins", Position: "WR"},
	mfltest.WR2:      {ID: mfltest.WR2, Name: "DJ Moore", Position: "WR"},
	mfltest.WRBench:  {ID: mfltest.WRBench, Name: "Josh Downs", Position: "WR"},
	mfltest.OnIR:     {ID: mfltest.OnIR, Name: "A.J. Brown", Position: "WR"},
}

type mflRig struct {
	*rig
	srv *mfltest.Server
}

func newMFLRig(t *testing.T) *mflRig {
	t.Helper()
	srv := mfltest.New(t)
	client := srv.Client()
	logs := &bytes.Buffer{}
	r := &rig{proofs: newProofs(), logs: logs, now: time.Date(2026, 10, 18, 15, 0, 0, 0, time.UTC)}
	r.svc = &Service{
		MFLOpen: true, MFLLineup: true, MFLMember: mflMember{client: client}, MFLWriter: client, Players: mflDirectory,
		Links: links{leaguesync.Link{ID: linkID, AccountID: me, RosterID: mfltest.Franchise,
			Ref: leaguesync.Ref{Host: mflhost.Host, LeagueID: mfltest.LeagueID, Season: mfltest.Season, As: me}}},
		Connections: conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: hosts.MFLConsentVersion, Proven: true}},
		Proofs:      r.proofs,
		Signer:      Signer{Key: []byte("a test key of thirty-two bytes!!")},
		Now:         func() time.Time { return r.now },
		Log:         slog.New(slog.NewTextHandler(logs, nil)),
	}
	return &mflRig{rig: r, srv: srv}
}

// mflSwap is the screen's change: Bucky Irving over Kimani Vidal at RB.
func mflSwap() apitypes.HostMoveInput {
	return apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: mfltest.Week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotRB, In: mfltest.RBBench, Out: ptr(mfltest.RBStarts)},
	}}
}

// The whole move: the plan names it on MyFantasyLeague and sends nothing;
// the confirmed move is one lineup import with the whole set of starters,
// read back and kept as its proof, done; the same token twice writes
// once, and the same change planned again is stale.
func TestMFLPlanThenMoveDoneOnce(t *testing.T) {
	r := newMFLRig(t)
	p := r.plan(t, mflSwap())
	if p.Status != apitypes.HostMovePlanStatusReady || p.Confirm == nil ||
		p.Sentence != "Start Bucky Irving over Kimani Vidal at RB, on MyFantasyLeague now." || !strings.Contains(p.HostUrl, "myfantasyleague.com/2026/home/10010") {
		t.Fatalf("plan %+v", p)
	}
	if len(r.srv.Imports()) != 0 {
		t.Fatal("a plan sent a lineup")
	}
	code, env, res := r.move(t, mflSwap(), *p.Confirm)
	if code != http.StatusOK || res.Outcome != apitypes.HostMoveResultOutcomeDone || res.Sentence != mflWords.done || res.MoveId == nil {
		t.Fatalf("move %d %+v %+v", code, env.Error, res)
	}
	imports := r.srv.Imports()
	if len(imports) != 1 || imports[0].Get("STARTERS") != strings.Join([]string{mfltest.QB, mfltest.WR1, mfltest.WR2, mfltest.RBBench}, ",") ||
		imports[0].Has("FRANCHISE_ID") || imports[0].Get("W") != "7" {
		t.Fatalf("imports %v", imports)
	}
	rec, ans := r.proofs.last(t)
	var plan mflRecord
	if err := json.Unmarshal(rec.Plan, &plan); err != nil || plan.Sentence != p.Sentence || plan.Franchise != mfltest.Franchise || len(plan.Starters) != 4 ||
		rec.Host != mflhost.Host || !json.Valid(rec.Body) || !bytes.Contains(rec.Body, []byte(`"TYPE":"lineup"`)) {
		t.Fatalf("record %+v %s", rec, rec.Plan)
	}
	if ans.Outcome != OutcomeDone || ans.ReadBack != readMatched || ans.HostStatus != http.StatusOK || ans.Member != "" {
		t.Fatalf("answer %+v", ans)
	}
	if code, env, _ := r.move(t, mflSwap(), *p.Confirm); code != http.StatusConflict || env.Error.Message != mflWords.used {
		t.Fatalf("the token twice: %d %+v", code, env.Error)
	}
	code, env, _ = r.call(t, r.svc.plan, me, mflSwap())
	if code != http.StatusUnprocessableEntity || env.Error.Message != mflWords.stale || len(r.srv.Imports()) != 1 {
		t.Fatalf("the change again: %d %+v, %d imports", code, env.Error, len(r.srv.Imports()))
	}
	r.noSessionKept(t)
}

// noSessionKept checks no proof row, answer or log line carries the
// session.
func (r *mflRig) noSessionKept(t *testing.T) {
	t.Helper()
	for _, rec := range r.proofs.records {
		if bytes.Contains(rec.Body, []byte(mfltest.Session)) || bytes.Contains(rec.Plan, []byte(mfltest.Session)) {
			t.Fatal("the session in a proof")
		}
	}
	for _, a := range r.proofs.answers {
		if strings.Contains(a.HostWords, mfltest.Session) {
			t.Fatal("the session in an answer")
		}
	}
	if strings.Contains(r.logs.String(), mfltest.Session) {
		t.Fatal("the session in the logs")
	}
}

// A refusal is MyFantasyLeague's, in its words: a lock is said plainly,
// anything else as nothing changed; an answer neither done nor refused
// reads back, pending when the lineup does not show it.
func TestMFLAnswers(t *testing.T) {
	cases := []struct {
		name, answer string
		status       int
		outcome      apitypes.HostMoveResultOutcome
		sentence     string
		words        string
	}{
		{"locked", "import-locked.xml", http.StatusOK, apitypes.HostMoveResultOutcomeRefused, mflWords.locked, "Lineup is locked: a player's game has started."},
		{"invalid", "import-invalid.xml", http.StatusOK, apitypes.HostMoveResultOutcomeRefused, mflWords.refused,
			"An error has occurred - probably caused by one or more invalid parameters."},
		{"lost", "", http.StatusInternalServerError, apitypes.HostMoveResultOutcomePending, mflWords.pending, ""},
	}
	for _, tc := range cases {
		r := newMFLRig(t)
		r.srv.Set(func(s *mfltest.Server) { s.ImportAnswer, s.ImportStatus, s.Applies = tc.answer, tc.status, false })
		p := r.plan(t, mflSwap())
		_, _, res := r.move(t, mflSwap(), *p.Confirm)
		got := ""
		if res.HostWords != nil {
			got = *res.HostWords
		}
		if res.Outcome != tc.outcome || res.Sentence != tc.sentence || got != tc.words || len(r.srv.Imports()) != 1 {
			t.Errorf("%s: %+v", tc.name, res)
		}
		r.noSessionKept(t)
	}
}

// Only lock wording reads as a lock: a refusal that says "started" about
// something else keeps the plain sentence and MyFantasyLeague's words.
func TestMFLLockWordsOnly(t *testing.T) {
	cases := map[string]string{
		"Lineup is locked.":                   mflWords.locked,
		"Player 13604 is locked for week 7.":  mflWords.locked,
		"Lineups lock at kickoff.":            mflWords.locked,
		"The season has not started.":         mflWords.refused,
		"Unlocking requires the commissioner": mflWords.refused,
		"An error has occurred - probably caused by one or more invalid parameters.": mflWords.refused,
	}
	for words, want := range cases {
		if got := mflResultWords(Answer{Outcome: OutcomeRefused, HostWords: words}); got != want {
			t.Errorf("%q: %q", words, got)
		}
	}
}

type failingWriter struct{}

func (failingWriter) SetLineup(context.Context, mfl.Session, mfl.LineupSet) (mfl.WriteAnswer, error) {
	return mfl.WriteAnswer{}, mfl.ErrNotSent
}

func (failingWriter) Applied(context.Context, mfl.Session, mfl.LineupSet) (bool, error) {
	return false, nil
}

// A lineup that never left says so in MyFantasyLeague's name and is kept
// as not sent.
func TestMFLNotSent(t *testing.T) {
	r := newMFLRig(t)
	p := r.plan(t, mflSwap())
	r.svc.MFLWriter = failingWriter{}
	code, env, _ := r.move(t, mflSwap(), *p.Confirm)
	if _, ans := r.proofs.last(t); code != http.StatusBadGateway || env.Error.Message != mflWords.notSent || ans.Outcome != OutcomeNotSent {
		t.Fatalf("%d %+v %+v", code, env.Error, ans)
	}
}

// Refused before anything is sent, in the member's words.
func TestMFLPlanRefusals(t *testing.T) {
	change := func(slot apitypes.HostMoveChangeSlot, in string, out *string) apitypes.HostMoveChange {
		return apitypes.HostMoveChange{Slot: slot, In: in, Out: out}
	}
	cases := map[string]struct {
		week    int
		changes []apitypes.HostMoveChange
		words   string
	}{
		"week moved":       {6, mflSwap().Changes, "MyFantasyLeague is on week 7 now. Reload your lineup to see it."},
		"on IR":            {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotWR, mfltest.OnIR, ptr(mfltest.WR2))}, "A.J. Brown is on injured reserve on MyFantasyLeague, so he cannot start."},
		"out not starting": {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotRB, mfltest.RBBench, ptr(mfltest.WRBench))}, mflWords.stale},
		"not on roster":    {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotRB, "14802", ptr(mfltest.RBStarts))}, mflWords.stale},
		"wrong slot":       {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotRB, mfltest.WRBench, ptr(mfltest.RBStarts))}, "MyFantasyLeague does not let Josh Downs start in that spot."},
		"too few at RB":    {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotFLEX, mfltest.WRBench, ptr(mfltest.RBStarts))}, "Your league on MyFantasyLeague starts at least 1 at RB."},
		"too many at WR": {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotFLEX, mfltest.WRBench, ptr(mfltest.RBStarts)),
			change(apitypes.HostMoveChangeSlotRB, mfltest.RBBench, nil)}, "Your league on MyFantasyLeague does not start that many at WR."},
		"no change": {7, []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotQB, mfltest.QB, nil)}, mflWords.stale},
	}
	for name, tc := range cases {
		r := newMFLRig(t)
		mv := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: tc.week, Changes: tc.changes}
		code, env, _ := r.call(t, r.svc.plan, me, mv)
		if code != http.StatusUnprocessableEntity || env.Error == nil || env.Error.Message != tc.words {
			t.Errorf("%s: %d %+v", name, code, env.Error)
		}
		if len(r.srv.Imports()) != 0 {
			t.Errorf("%s: a refused plan sent a lineup", name)
		}
	}
	// A flex swap within the counts plans.
	r := newMFLRig(t)
	ok := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: 7,
		Changes: []apitypes.HostMoveChange{change(apitypes.HostMoveChangeSlotFLEX, mfltest.RBBench, ptr(mfltest.WR2))}}
	if p := r.plan(t, ok); p.Status != apitypes.HostMovePlanStatusReady {
		t.Fatalf("a flex swap: %+v", p)
	}
	// With no kept directory the names are their ids and MyFantasyLeague
	// judges the positions.
	r.svc.Players = nil
	if p := r.plan(t, mflSwap()); p.Status != apitypes.HostMovePlanStatusReady || !strings.Contains(p.Sentence, "player "+mfltest.RBBench) {
		t.Fatalf("no directory: %+v", p)
	}
}

// A whole lineup is sent, so a read that does not list the member's
// franchise, or a move that would start fewer than start now, sends
// nothing: never "start X" alone over an empty read.
func TestMFLNeverSendsAPartialLineup(t *testing.T) {
	r := newMFLRig(t)
	r.srv.Set(func(s *mfltest.Server) { s.Live = "live-member-absent.json" })
	fill := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: mfltest.Week,
		Changes: []apitypes.HostMoveChange{{Slot: apitypes.HostMoveChangeSlotRB, In: mfltest.RBBench}}}
	code, env, _ := r.call(t, r.svc.plan, me, fill)
	if code != http.StatusBadGateway || env.Error == nil || env.Error.Message != mflWords.notAnswering {
		t.Fatalf("absent franchise, plan: %d %+v", code, env.Error)
	}
	token, _ := r.svc.Signer.Sign(me, linkID, fill, r.now.Add(ConfirmFor))
	if code, _, _ := r.move(t, fill, token); code != http.StatusBadGateway {
		t.Fatalf("absent franchise, move: %d", code)
	}
	r.srv.Set(func(s *mfltest.Server) { s.Live = "live-member.json" })
	shrink := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: mfltest.Week,
		Changes: []apitypes.HostMoveChange{{Slot: apitypes.HostMoveChangeSlotFLEX, In: mfltest.WR1, Out: ptr(mfltest.RBStarts)}}}
	if code, env, _ := r.call(t, r.svc.plan, me, shrink); code != http.StatusUnprocessableEntity || env.Error.Message != mflWords.stale {
		t.Fatalf("fewer starters: %d %+v", code, env.Error)
	}
	r.svc.Players = nil
	if code, _, _ := r.call(t, r.svc.plan, me, shrink); code != http.StatusUnprocessableEntity {
		t.Fatalf("fewer starters, no directory: %d", code)
	}
	if n := len(r.srv.Imports()); n != 0 || len(r.proofs.order) != 0 {
		t.Fatalf("%d imports, %d moves kept", n, len(r.proofs.order))
	}
}

// The team must be the attached league's seat and the one MyFantasyLeague
// lists for the session: anything else is unavailable, nothing sent; a
// session MyFantasyLeague refuses asks to connect again.
func TestMFLNotYourTeamAndReconnect(t *testing.T) {
	r := newMFLRig(t)
	r.svc.Links = links{leaguesync.Link{ID: linkID, AccountID: me, RosterID: 1,
		Ref: leaguesync.Ref{Host: mflhost.Host, LeagueID: mfltest.LeagueID, Season: mfltest.Season, As: me}}}
	if p := r.plan(t, mflSwap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != mflWords.notYourTeam {
		t.Fatalf("another franchise: %+v", p)
	}
	r = newMFLRig(t)
	r.svc.Links = links{leaguesync.Link{ID: linkID, AccountID: me, RosterID: mfltest.Franchise,
		Ref: leaguesync.Ref{Host: mflhost.Host, LeagueID: "30030", Season: mfltest.Season, As: me}}}
	if p := r.plan(t, mflSwap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != mflWords.notYourTeam {
		t.Fatalf("a league MyFantasyLeague does not list: %+v", p)
	}
	r = newMFLRig(t)
	r.svc.MFLMember = mflMember{err: mflhost.ErrReconnect}
	if p := r.plan(t, mflSwap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != mflWords.reconnect {
		t.Fatalf("a refused session: %+v", p)
	}
	if len(r.srv.Imports()) != 0 {
		t.Fatal("a lineup sent")
	}
}

// What the Lineup screen reads for its verb: whether the platform takes
// writes, whether its switch is on for the account, and the one line why
// not, the platform named, for every state.
func TestLineupMoveFields(t *testing.T) {
	ctx := context.Background()
	r := newMFLRig(t)
	check := func(name, host string, open, takes, on bool, reason string) {
		t.Helper()
		got, err := r.svc.LineupMove(ctx, me, host)
		gotReason := ""
		if got.Reason != nil {
			gotReason = *got.Reason
		}
		if err != nil || (got.Lineup == apitypes.LineupMovesLineupAvailable) != open || got.TakesWrites != takes || got.WritesOn != on || gotReason != reason {
			t.Fatalf("%s: %+v (reason %q) %v", name, got, gotReason, err)
		}
	}
	check("on and connected", mflhost.Host, true, true, true, "")
	check("sleeper", "sleeper", false, false, false, "Sleeper does not take lineups from here, so copy the lineup there.")
	check("yahoo", "yahoo", false, false, false, "Yahoo does not take lineups from here, so copy the lineup there.")
	r.svc.MFLLineup = false
	check("switch off", mflhost.Host, false, true, false, "Lineups are not sent to MyFantasyLeague from here yet, so copy the lineup there.")
	r.proofs.allowed[me] = true
	check("switch off, listed", mflhost.Host, true, true, true, "")
	r.svc.Connections = conns{nil}
	check("not connected", mflhost.Host, false, true, true, "Connect MyFantasyLeague on your account page to set your lineup from here.")
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusSignedOut, ConsentVersion: 1}}
	check("signed out", mflhost.Host, false, true, true, mflWords.reconnect)
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 0}}
	check("no consent", mflhost.Host, false, true, true, mflWords.reconsent)
	r.svc.MFLOpen = false
	check("closed here", mflhost.Host, false, true, false, "Lineups are not sent to MyFantasyLeague from here yet, so copy the lineup there.")
	if p := r.plan(t, mflSwap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != "Make this change on MyFantasyLeague." {
		t.Fatalf("closed plan: %+v", p)
	}
	if got, _ := r.svc.ClaimMove(ctx, me, mflhost.Host); got.Claim != apitypes.WaiverMovesClaimUnavailable {
		t.Fatalf("a MyFantasyLeague claim: %+v", got)
	}
}
