package hostmoves

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// The ESPN fixtures (api/internal/espn/testdata): a league derived for the
// write tests, where the member's SWID owns team 1, before and after the
// swap, and ESPN's answers as third parties captured them live.
const (
	leagueID = "48153503"
	season   = 2026
	week     = 7
)

var (
	swid    = "{00000011-0000-4000-8000-000000000011}"
	s2      = strings.Repeat("AEB", 30) + "%2B%3D"
	cookies = espn.Cookies{SWID: swid, S2: s2}
	me      = uuid.MustParse("6f1d1c52-2626-4a26-9a26-0000000000a1")
	linkID  = uuid.MustParse("6f1d1c52-2626-4a26-9a26-000000000035")
)

func testdata(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "espn", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// espnHost is ESPN's read and write hosts in one test server: a write
// answers status and the fixture; a read answers the league before the
// swap, or after it once applied says so.
type espnHost struct {
	mu sync.Mutex
	// status and answer are the write's answer.
	status int
	answer []byte
	// applies is whether a write changes what the reads answer.
	applies bool
	applied bool
	writes  [][]byte
	cookies []string
	before  []byte
	after   []byte
}

func newHost(t *testing.T, status int, answer string, applies bool) (*espn.Client, *espnHost) {
	t.Helper()
	h := &espnHost{status: status, applies: applies, before: testdata(t, "league-write-2026.json"), after: testdata(t, "league-write-2026-after.json")}
	if answer != "" {
		h.answer = testdata(t, answer)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			h.writes = append(h.writes, body)
			h.cookies = append(h.cookies, r.Header.Get("Cookie"))
			h.applied = h.applies
			w.WriteHeader(h.status)
			_, _ = w.Write(h.answer)
			return
		}
		if h.applied {
			_, _ = w.Write(h.after)
			return
		}
		_, _ = w.Write(h.before)
	}))
	t.Cleanup(srv.Close)
	return &espn.Client{HTTP: srv.Client(), Base: srv.URL, WriteBase: srv.URL}, h
}

func (h *espnHost) sent() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.writes)
}

// member reads the league with the kept cookies.
type member struct {
	client  *espn.Client
	cookies espn.Cookies
	err     error
}

func (m member) Cookies(context.Context, uuid.UUID) (espn.Cookies, error) { return m.cookies, m.err }

func (m member) ReadLeague(ctx context.Context, _ uuid.UUID, id string, yr int) (espn.FullLeague, error) {
	if m.err != nil {
		return espn.FullLeague{}, m.err
	}
	c := m.cookies
	return m.client.Read(ctx, id, yr, &c)
}

type links struct{ link leaguesync.Link }

func (l links) Get(_ context.Context, accountID, id uuid.UUID) (leaguesync.Link, error) {
	if accountID != l.link.AccountID || id != l.link.ID {
		return leaguesync.Link{}, leaguesync.ErrLinkNotFound
	}
	return l.link, nil
}

type conns struct{ conn *hosts.Connection }

func (c conns) Get(context.Context, uuid.UUID, string) (hosts.Connection, error) {
	if c.conn == nil {
		return hosts.Connection{}, hosts.ErrNotConnected
	}
	return *c.conn, nil
}

// proofs is the allow list and the proof records in memory.
type proofs struct {
	mu      sync.Mutex
	allowed map[uuid.UUID]bool
	used    map[string]bool
	records map[uuid.UUID]Record
	answers map[uuid.UUID]Answer
	order   []uuid.UUID
}

func newProofs() *proofs {
	return &proofs{allowed: map[uuid.UUID]bool{}, used: map[string]bool{}, records: map[uuid.UUID]Record{}, answers: map[uuid.UUID]Answer{}}
}

func (p *proofs) Allowed(_ context.Context, accountID uuid.UUID, host, kind string) (bool, error) {
	return p.allowed[accountID] && host == "espn" && (kind == kindLineup || kind == kindClaim), nil
}

func (p *proofs) Used(_ context.Context, _ uuid.UUID, digest []byte) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.used[string(digest)], nil
}

func (p *proofs) Begin(_ context.Context, r Record) (uuid.UUID, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.used[string(r.Digest)] {
		return uuid.Nil, ErrUsed
	}
	p.used[string(r.Digest)] = true
	id := uuid.New()
	p.records[id] = r
	p.order = append(p.order, id)
	return id, nil
}

func (p *proofs) Answered(ctx context.Context, _, id uuid.UUID, a Answer, _ time.Time) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	p.answers[id] = a
	return nil
}

func (p *proofs) List(context.Context, uuid.UUID, uuid.UUID) ([]Kept, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := []Kept{}
	for i := len(p.order) - 1; i >= 0; i-- {
		id := p.order[i]
		outcome := OutcomeSending
		if a, ok := p.answers[id]; ok {
			outcome = a.Outcome
		}
		out = append(out, Kept{ID: id, Kind: "lineup", Week: p.records[id].Week, Outcome: outcome})
	}
	return out, nil
}

func (p *proofs) last(t *testing.T) (Record, Answer) {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.order) == 0 {
		t.Fatal("no move kept")
	}
	id := p.order[len(p.order)-1]
	return p.records[id], p.answers[id]
}

type rig struct {
	svc    *Service
	host   *espnHost
	proofs *proofs
	logs   *bytes.Buffer
	now    time.Time
}

func newRig(t *testing.T, status int, answer string, applies bool) *rig {
	t.Helper()
	client, host := newHost(t, status, answer, applies)
	logs := &bytes.Buffer{}
	r := &rig{host: host, proofs: newProofs(), logs: logs, now: time.Date(2026, 10, 18, 15, 0, 0, 0, time.UTC)}
	r.svc = &Service{
		ESPNOpen:   true,
		ESPNLineup: true,
		Links: links{leaguesync.Link{ID: linkID, AccountID: me, RosterID: 1,
			Ref: leaguesync.Ref{Host: espnhost.Host, LeagueID: leagueID, Season: season, As: me}}},
		Connections: conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: hosts.ESPNConsentVersion, Proven: true}},
		Member:      member{client: client, cookies: cookies},
		Writer:      client,
		Proofs:      r.proofs,
		Signer:      Signer{Key: []byte("a test key of thirty-two bytes!!")},
		Now:         func() time.Time { return r.now },
		Log:         slog.New(slog.NewTextHandler(logs, nil)),
	}
	return r
}

func ptr(s string) *string { return &s }

// The swap the screen sends: Mattison over Washington at RB, Miller over
// Lewis in the flex.
func swap() apitypes.HostMoveInput {
	return apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotRB, In: "4048244", Out: ptr("2577654")},
	}}
}

func (r *rig) call(t *testing.T, h http.HandlerFunc, account uuid.UUID, body any) (int, apitypes.Envelope, []byte) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", linkID.String())
	req = req.WithContext(auth.WithAccount(context.Background(), auth.Account{ID: account}))
	rec := httptest.NewRecorder()
	h(rec, req)
	var env apitypes.Envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	data, _ := json.Marshal(env.Data)
	return rec.Code, env, data
}

func (r *rig) plan(t *testing.T, mv apitypes.HostMoveInput) apitypes.HostMovePlan {
	t.Helper()
	code, env, data := r.call(t, r.svc.plan, me, mv)
	if code != http.StatusOK {
		t.Fatalf("plan %d %+v", code, env.Error)
	}
	var p apitypes.HostMovePlan
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func (r *rig) move(t *testing.T, mv apitypes.HostMoveInput, token string) (int, apitypes.Envelope, apitypes.HostMoveResult) {
	t.Helper()
	code, env, data := r.call(t, r.svc.move, me, apitypes.HostMoveConfirm{Move: mv, Confirm: token})
	var res apitypes.HostMoveResult
	_ = json.Unmarshal(data, &res)
	return code, env, res
}

func (r *rig) noSecrets(t *testing.T) {
	t.Helper()
	for _, rec := range r.proofs.records {
		for _, b := range [][]byte{rec.Body, rec.Plan} {
			if bytes.Contains(b, []byte(s2)) || bytes.Contains(b, []byte(swid)) {
				t.Fatalf("a cookie in the proof: %s", b)
			}
		}
	}
	bare := strings.ToLower(strings.Trim(swid, "{}"))
	for _, a := range r.proofs.answers {
		for _, field := range []string{a.Outcome, a.TransactionID, a.HostReason, a.HostWords, a.ReadBack, a.Member} {
			if strings.Contains(field, s2) || strings.Contains(strings.ToLower(field), bare) {
				t.Fatalf("a cookie in the proof's answer: %+v", a)
			}
		}
	}
	logs := strings.ToLower(r.logs.String())
	if strings.Contains(r.logs.String(), s2) || strings.Contains(logs, bare) {
		t.Fatalf("a cookie in the logs: %s", r.logs.String())
	}
}

// The whole move: the plan names it and sends nothing; the confirmed
// move is sent once with the cookies and the captured body, read back
// and kept as its proof, done.
func TestPlanThenMoveDone(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	mv := swap()
	mv.Changes = append(mv.Changes, apitypes.HostMoveChange{Slot: apitypes.HostMoveChangeSlotFLEX, In: "3050487", Out: ptr("14198")})
	p := r.plan(t, mv)
	want := "Start Alexander Mattison over DeAndre Washington at RB, and Anthony Miller over Dion Lewis in the flex, on ESPN now."
	if p.Status != apitypes.HostMovePlanStatusReady || p.Sentence != want || p.Confirm == nil || p.ExpiresAt == nil ||
		!p.ExpiresAt.Equal(r.now.Add(ConfirmFor)) || !strings.Contains(p.HostUrl, "leagueId="+leagueID) {
		t.Fatalf("plan %+v", p)
	}
	if r.host.sent() != 0 {
		t.Fatal("a plan sent a move")
	}
	code, env, res := r.move(t, mv, *p.Confirm)
	if code != http.StatusOK || res.Outcome != apitypes.HostMoveResultOutcomeDone || res.Sentence != doneWords || res.MoveId == nil {
		t.Fatalf("move %d %+v %+v", code, env.Error, res)
	}
	if r.host.sent() != 1 || r.host.cookies[0] != "SWID="+swid+"; espn_s2="+s2 {
		t.Fatalf("%d writes", r.host.sent())
	}
	var body struct {
		TeamID int `json:"teamId"`
		Items  []struct {
			PlayerID int `json:"playerId"`
			From     int `json:"fromLineupSlotId"`
			To       int `json:"toLineupSlotId"`
		} `json:"items"`
	}
	if err := json.Unmarshal(r.host.writes[0], &body); err != nil || body.TeamID != 1 || len(body.Items) != 4 {
		t.Fatalf("body %s", r.host.writes[0])
	}
	rec, ans := r.proofs.last(t)
	if rec.Week != week || rec.Host != "espn" || rec.HostLeagueID != leagueID || rec.LinkID != linkID || !bytes.Contains(rec.Plan, []byte(want)) ||
		ans.Outcome != OutcomeDone || ans.ReadBack != readMatched || ans.HostStatus != http.StatusOK {
		t.Fatalf("proof %+v %+v", rec, ans)
	}
	r.noSecrets(t)
}

// The token: made for one account, one league, one move, ten minutes, and
// used once. Anything else sends nothing.
func TestTokenBindsTheMove(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	mv := swap()
	token := *r.plan(t, mv).Confirm

	other := uuid.New()
	if code, _, _ := r.call(t, r.svc.move, other, apitypes.HostMoveConfirm{Move: mv, Confirm: token}); code != http.StatusNotFound {
		t.Fatalf("another account: %d", code)
	}
	forged, _ := r.svc.Signer.Sign(me, uuid.New(), mv, r.now.Add(ConfirmFor))
	changed := swap()
	changed.Changes[0].Out = ptr("14198")
	cases := map[string]struct {
		mv    apitypes.HostMoveInput
		token string
		words string
	}{
		"another league":  {mv, forged, tokenOtherWords},
		"changed content": {changed, token, tokenOtherWords},
		"garbled":         {mv, "not-a-token", tokenOtherWords},
	}
	for name, tc := range cases {
		code, env, _ := r.move(t, tc.mv, tc.token)
		if code != http.StatusBadRequest || env.Error == nil || env.Error.Fields == nil || (*env.Error.Fields)[fieldConfirm] != tc.words {
			t.Fatalf("%s: %d %+v", name, code, env.Error)
		}
	}
	signedForOther, _ := r.svc.Signer.Sign(other, linkID, mv, r.now.Add(ConfirmFor))
	if code, _, _ := r.move(t, mv, signedForOther); code != http.StatusBadRequest {
		t.Fatalf("a token for another account: %d", code)
	}
	r.now = r.now.Add(ConfirmFor)
	if code, env, _ := r.move(t, mv, token); code != http.StatusBadRequest || (*env.Error.Fields)[fieldConfirm] != tokenExpiredWords {
		t.Fatalf("expired: %d %+v", code, env.Error)
	}
	r.now = r.now.Add(-time.Minute)
	if code, _, res := r.move(t, mv, token); code != http.StatusOK || res.Outcome != apitypes.HostMoveResultOutcomeDone {
		t.Fatalf("in time: %d %+v", code, res)
	}
	if code, env, _ := r.move(t, mv, token); code != http.StatusConflict || env.Error.Message != tokenUsedWords {
		t.Fatalf("used again: %d %+v", code, env.Error)
	}
	if r.host.sent() != 1 {
		t.Fatalf("%d writes", r.host.sent())
	}
}

// No move without a token: the plan alone sends nothing, and a move with
// an empty token is the form refused.
func TestNoMoveWithoutAToken(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	if code, _, _ := r.move(t, swap(), ""); code != http.StatusBadRequest {
		t.Fatalf("no token: %d", code)
	}
	if r.host.sent() != 0 || len(r.proofs.order) != 0 {
		t.Fatal("a move without a token")
	}
}

// ESPN's refusal comes back in its own words under ours, kept, never
// retried; the read-back is not made.
func TestRefusedInESPNsWords(t *testing.T) {
	r := newRig(t, http.StatusConflict, "write-lineup-locked.json", false)
	mv := swap()
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomeRefused || res.Sentence != refusedWords || res.HostWords == nil ||
		*res.HostWords != "Lineup transaction could not be completed, Alexander Mattison is locked" {
		t.Fatalf("refused %+v", res)
	}
	_, ans := r.proofs.last(t)
	if ans.Outcome != OutcomeRefused || ans.HostReason != "TRAN_LINEUP_LOCKED" || ans.HostStatus != http.StatusConflict || ans.ReadBack != readNotRead {
		t.Fatalf("proof %+v", ans)
	}
	if r.host.sent() != 1 {
		t.Fatalf("%d writes", r.host.sent())
	}
	r.noSecrets(t)
}

// A move ESPN took whose read-back does not show it is pending: the
// member is told to check ESPN, and nothing is sent again.
func TestPendingWhenTheReadBackDoesNotConfirm(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", false)
	mv := swap()
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != pendingWords || res.HostWords != nil {
		t.Fatalf("pending %+v", res)
	}
	if _, ans := r.proofs.last(t); ans.Outcome != OutcomePending || ans.ReadBack != readNotMatched {
		t.Fatalf("proof %+v", ans)
	}
	if r.host.sent() != 1 {
		t.Fatalf("%d writes", r.host.sent())
	}
}

// A lost answer is read back, not retried: the move ESPN made is done.
func TestALostAnswerIsReadBack(t *testing.T) {
	r := newRig(t, http.StatusBadGateway, "", true)
	mv := swap()
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomeDone || r.host.sent() != 1 {
		t.Fatalf("read back %+v, %d writes", res, r.host.sent())
	}
}

// A move that never left is kept as not sent and answered 502.
func TestNotSent(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	mv := swap()
	token := *r.plan(t, mv).Confirm
	r.svc.Writer = refusing{}
	code, env, _ := r.move(t, mv, token)
	if code != http.StatusBadGateway || env.Error.Message != notSentWords {
		t.Fatalf("not sent: %d %+v", code, env.Error)
	}
	if _, ans := r.proofs.last(t); ans.Outcome != OutcomeNotSent {
		t.Fatalf("proof %+v", ans)
	}
}

type refusing struct{}

func (refusing) SetLineup(context.Context, espn.Cookies, espn.LineupSet) (espn.WriteAnswer, error) {
	return espn.WriteAnswer{}, espn.ErrNotSent
}

func (refusing) Applied(context.Context, espn.Cookies, espn.LineupSet) (bool, error) {
	return false, errors.New("never read")
}

// The guard: a league whose seat is another manager's team (a
// commissioner's cookies would let ESPN take it) is unavailable, said as
// not the member's team, before any POST.
func TestAnotherTeamIsRefusedBeforeAnyPost(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	l := r.svc.Links.(links)
	l.link.RosterID = 2
	r.svc.Links = l
	mv := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotRB, In: "17359", Out: ptr("4047365")},
	}}
	if p := r.plan(t, mv); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != notYourTeamWords || p.Confirm != nil {
		t.Fatalf("another team: %+v", p)
	}
	token, _ := r.svc.Signer.Sign(me, linkID, mv, r.now.Add(ConfirmFor))
	if _, _, res := r.move(t, mv, token); res.Outcome != apitypes.HostMoveResultOutcomeUnavailable || res.Sentence != notYourTeamWords {
		t.Fatalf("another team, a good token: %+v", res)
	}
	if r.host.sent() != 0 || len(r.proofs.order) != 0 {
		t.Fatal("a move on another team")
	}
}

// Before anything is sent, a move is refused in the member's words when
// ESPN moved on: another week, a starter no longer in the slot, a locked
// player.
func TestPlanRefusals(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	otherWeek := swap()
	otherWeek.Week = 8
	stale := swap()
	stale.Changes[0].Out = ptr("14198")
	locked := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotFLEX, In: "3050487", Out: ptr("16733")},
	}}
	tooMany := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotRB, In: "4048244", Out: nil},
	}}
	ineligible := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindLineup, Week: week, Changes: []apitypes.HostMoveChange{
		{Slot: apitypes.HostMoveChangeSlotQB, In: "4048244", Out: ptr("2969939")},
	}}
	cases := map[string]struct {
		mv    apitypes.HostMoveInput
		words string
	}{
		"another week": {otherWeek, "ESPN is on week 7 now. Reload your lineup to see it."},
		"stale":        {stale, staleWords},
		"locked":       {locked, "ESPN has locked Odell Beckham Jr., whose game has started."},
		"too many":     {tooMany, staleWords},
		"ineligible":   {ineligible, "ESPN does not let Alexander Mattison start in that spot."},
	}
	for name, tc := range cases {
		code, env, _ := r.call(t, r.svc.plan, me, tc.mv)
		if code != http.StatusUnprocessableEntity || env.Error == nil || env.Error.Message != tc.words {
			t.Fatalf("%s: %d %+v", name, code, env.Error)
		}
	}
	bad := swap()
	bad.Changes[0].In = "Robert'); drop table"
	if code, _, _ := r.call(t, r.svc.plan, me, bad); code != http.StatusBadRequest {
		t.Fatalf("a bad id: %d", code)
	}
	if r.host.sent() != 0 {
		t.Fatal("a refused plan sent a move")
	}
}

// The switches: with HOST_WRITES_ESPN_LINEUP off, only an account on the
// allow list may move; on, every connected member may. A host with no
// write path is the host's page either way.
func TestSwitchesAndTheAllowList(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	ctx := context.Background()
	check := func(name string, want apitypes.HostMovePlanStatus, wantMove apitypes.LineupMovesLineup) {
		t.Helper()
		p := r.plan(t, swap())
		got, err := r.svc.LineupMove(ctx, me, espnhost.Host)
		if err != nil || p.Status != want || got.Lineup != wantMove {
			t.Fatalf("%s: plan %+v, moves %+v %v", name, p, got, err)
		}
		if want == apitypes.HostMovePlanStatusUnavailable && (p.Confirm != nil || p.Sentence != offWords || p.HostUrl == "") {
			t.Fatalf("%s: unavailable %+v", name, p)
		}
	}
	check("switch on", apitypes.HostMovePlanStatusReady, apitypes.LineupMovesLineupAvailable)
	r.svc.ESPNLineup = false
	check("switch off, not listed", apitypes.HostMovePlanStatusUnavailable, apitypes.LineupMovesLineupUnavailable)
	if got, _ := r.svc.LineupMove(ctx, me, espnhost.Host); got.Reason == nil || *got.Reason != "Lineup writes to ESPN are not on yet." ||
		!got.TakesWrites || got.WritesOn {
		t.Fatalf("switch off, not listed, says why: %+v", got)
	}
	r.proofs.allowed[me] = true
	check("switch off, listed", apitypes.HostMovePlanStatusReady, apitypes.LineupMovesLineupAvailable)

	token := *r.plan(t, swap()).Confirm
	r.proofs.allowed[me] = false
	if _, _, res := r.move(t, swap(), token); res.Outcome != apitypes.HostMoveResultOutcomeUnavailable || res.HostUrl == "" {
		t.Fatalf("a token after the account left the list: %+v", res)
	}
	if r.host.sent() != 0 {
		t.Fatal("a move past the switch")
	}
	r.svc.ESPNOpen, r.proofs.allowed[me] = false, true
	if got, _ := r.svc.LineupMove(ctx, me, espnhost.Host); got.Lineup != apitypes.LineupMovesLineupUnavailable {
		t.Fatalf("ESPN closed here: %+v", got)
	}
	if got, _ := r.svc.LineupMove(ctx, me, espnhost.Host); got.Note != nil || got.Reason == nil ||
		*got.Reason != "Lineup writes to ESPN are not on yet." || !got.TakesWrites || got.WritesOn {
		t.Fatalf("ESPN closed here says its writes are not on: %+v", got)
	}
	// A platform with no write path says so in one line, by its name.
	for host, name := range map[string]string{"sleeper": "Sleeper", "yahoo": "Yahoo", "ffpc": "FFPC", "mfl": "MyFantasyLeague"} {
		got, _ := r.svc.LineupMove(ctx, me, host)
		if got.Lineup != apitypes.LineupMovesLineupUnavailable || got.Note != nil || got.TakesWrites || got.WritesOn ||
			got.Reason == nil || *got.Reason != name+" takes no lineup from outside." {
			t.Fatalf("%s: %+v", host, got)
		}
	}
}

// The consent: a connection that agreed to words older than the moves
// (version 2) is unavailable with a sentence asking to connect again; so
// is a signed-out one. No connection is the host's page.
func TestConsentVersionGatesTheMove(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	ctx := context.Background()
	cases := []struct {
		name string
		conn *hosts.Connection
		note string
	}{
		{"version 2", &hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 2}, reconsentWords},
		{"signed out", &hosts.Connection{Status: hosts.StatusSignedOut, ConsentVersion: 3}, reconnectWords},
		{"none", nil, ""},
	}
	// The line under the copy verb is true in each state, the platform named.
	reasons := map[string]string{
		"version 2":  "Your ESPN connection needs renewing.",
		"signed out": "Your ESPN connection needs renewing.",
		"none":       "Connect ESPN on your account page to set your lineup from here.",
	}
	for _, tc := range cases {
		r.svc.Connections = conns{tc.conn}
		got, err := r.svc.LineupMove(ctx, me, espnhost.Host)
		if err != nil || got.Lineup != apitypes.LineupMovesLineupUnavailable || got.Reason == nil || *got.Reason != reasons[tc.name] ||
			(tc.note == "") != (got.Note == nil) || (got.Note != nil && *got.Note != tc.note) || !got.TakesWrites || !got.WritesOn {
			t.Fatalf("%s: %+v %v", tc.name, got, err)
		}
		p := r.plan(t, swap())
		want := tc.note
		if tc.conn == nil {
			want = offWords
		}
		if p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != want {
			t.Fatalf("%s: plan %+v", tc.name, p)
		}
	}
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 3}}
	r.svc.Member = member{err: espnhost.ErrReconnect}
	if p := r.plan(t, swap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != reconnectWords {
		t.Fatalf("ESPN refused the cookies: %+v", p)
	}
	if r.host.sent() != 0 {
		t.Fatal("a move without consent")
	}
}

// The owners check: the stored SWID must own the team the attached league
// names as the member's, as ESPN answers the teams to these cookies. A
// pasted SWID that owns another team (team 2 in the fixture) cannot move
// team 1, whatever espn_s2 rides with it: unavailable, nothing sent. An
// unproven connection is enough when the SWID owns the team.
func TestTheStoredSWIDMustOwnTheTeam(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	m := r.svc.Member.(member)
	r.svc.Member = member{client: m.client, cookies: espn.Cookies{SWID: "{0000000D-0000-4000-8000-00000000000D}", S2: s2}}
	if p := r.plan(t, swap()); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != notYourTeamWords {
		t.Fatalf("a SWID that owns another team: %+v", p)
	}
	token, _ := r.svc.Signer.Sign(me, linkID, swap(), r.now.Add(ConfirmFor))
	if _, _, res := r.move(t, swap(), token); res.Outcome != apitypes.HostMoveResultOutcomeUnavailable {
		t.Fatalf("a good token, another member's team: %+v", res)
	}
	if r.host.sent() != 0 || len(r.proofs.order) != 0 {
		t.Fatal("a move on a team the SWID does not own")
	}
	r.svc.Member = m
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: hosts.ESPNConsentVersion, Proven: false}}
	if p := r.plan(t, swap()); p.Status != apitypes.HostMovePlanStatusReady {
		t.Fatalf("an unproven connection whose SWID owns the team: %+v", p)
	}
}

// ESPN's answer may echo the member's SWID (memberId): the proof keeps
// only the parsed fields, notes the member matched, and neither the row
// nor any log holds the SWID or a cookie.
func TestTheAnswerNeverKeepsTheSWID(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed-member.json", true)
	mv := swap()
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomeDone {
		t.Fatalf("done %+v", res)
	}
	_, ans := r.proofs.last(t)
	if ans.Member != string(espn.MemberMatched) || ans.TransactionID == "" || ans.HostStatus != http.StatusOK {
		t.Fatalf("proof %+v", ans)
	}
	r.noSecrets(t)
}

// A slow ESPN spends the send's budget: the member is told pending and
// the proof's last write still lands on its own deadline, so no row is
// left at sending. A row a crash left at sending lists as pending.
func TestTheProofIsKeptWhenESPNIsSlow(t *testing.T) {
	r := newRig(t, http.StatusOK, "write-lineup-executed.json", true)
	mv := swap()
	token := *r.plan(t, mv).Confirm
	r.svc.Writer, r.svc.SendBudget = slow{}, 20*time.Millisecond
	_, _, res := r.move(t, mv, token)
	if res.Outcome != apitypes.HostMoveResultOutcomePending {
		t.Fatalf("slow: %+v", res)
	}
	if _, ans := r.proofs.last(t); ans.Outcome != OutcomePending || ans.ReadBack != readNotRead {
		t.Fatalf("proof %+v", ans)
	}
	if _, err := r.proofs.Begin(context.Background(), Record{Digest: []byte("a crash")}); err != nil {
		t.Fatal(err)
	}
	code, _, data := r.call(t, r.svc.list, me, nil)
	var moves []apitypes.HostMove
	if err := json.Unmarshal(data, &moves); err != nil || code != http.StatusOK || len(moves) != 2 {
		t.Fatalf("list %d %s %v", code, data, err)
	}
	for _, m := range moves {
		if m.Outcome != apitypes.HostMoveOutcome(OutcomePending) {
			t.Fatalf("listed %+v", m)
		}
	}
}

// slow is ESPN past the send's budget: the write's answer is lost and the
// read-back never comes.
type slow struct{}

func (slow) SetLineup(ctx context.Context, _ espn.Cookies, _ espn.LineupSet) (espn.WriteAnswer, error) {
	<-ctx.Done()
	return espn.WriteAnswer{Outcome: espn.WriteUnknown, Member: espn.MemberAbsent}, nil
}

func (slow) Applied(ctx context.Context, _ espn.Cookies, _ espn.LineupSet) (bool, error) {
	<-ctx.Done()
	return false, ctx.Err()
}
