package hostmoves

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
)

// The claim the tests send: Keenan Allen (on waivers in the derived
// players read) for Danny Amendola off team 1's bench.
const (
	claimAdd  = "15818"
	claimDrop = "11674"
	// claimDays is the derived league's claim days, as recorded.
	claimDays = "Monday, Wednesday, Thursday, Friday, Saturday and Sunday"
)

// claimServer is ESPN's hosts for a claim: the league read (patched per
// test, and after the write when set), the players read, the queue and
// the write.
type claimServer struct {
	mu      sync.Mutex
	league  []byte
	after   []byte
	players []byte
	pending []byte
	status  int
	answer  []byte
	written bool
	// drop closes the connection after a write is taken: the answer lost.
	drop   bool
	writes [][]byte
}

func (h *claimServer) sent() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.writes)
}

func patched(t *testing.T, raw []byte, patch func(map[string]any)) []byte {
	t.Helper()
	if patch == nil {
		return raw
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	patch(doc)
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func acquisitionOf(doc map[string]any) map[string]any {
	return doc["settings"].(map[string]any)["acquisitionSettings"].(map[string]any)
}

func entryOf(doc map[string]any, team, i int) map[string]any {
	return doc["teams"].([]any)[team].(map[string]any)["roster"].(map[string]any)["entries"].([]any)[i].(map[string]any)
}

func noBudget(doc map[string]any) { acquisitionOf(doc)["isUsingAcquisitionBudget"] = false }

// newClaimRig is the rig with the claim switch on and ESPN's hosts
// answering a claim.
func newClaimRig(t *testing.T, status int, answer string, patch func(map[string]any)) (*rig, *claimServer) {
	t.Helper()
	r := newRig(t, http.StatusOK, "", false)
	h := &claimServer{status: status, league: patched(t, testdata(t, "league-write-2026.json"), patch),
		players: testdata(t, "player-status-2026.json"), pending: testdata(t, "pending-claims-2026.json")}
	if answer != "" {
		h.answer = testdata(t, answer)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if req.Method == http.MethodPost {
			body, _ := io.ReadAll(req.Body)
			h.writes = append(h.writes, body)
			h.written = true
			if h.drop {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = conn.Close()
				}
				return
			}
			w.WriteHeader(h.status)
			_, _ = w.Write(h.answer)
			return
		}
		switch strings.Join(req.URL.Query()["view"], ",") {
		case "kona_player_info":
			_, _ = w.Write(h.players)
		case "mPendingTransactions":
			_, _ = w.Write(h.pending)
		default:
			if h.written && h.after != nil {
				_, _ = w.Write(h.after)
				return
			}
			_, _ = w.Write(h.league)
		}
	}))
	t.Cleanup(srv.Close)
	client := &espn.Client{HTTP: srv.Client(), Base: srv.URL, WriteBase: srv.URL}
	r.svc.ESPNClaim, r.svc.ESPNLineup = true, false
	r.svc.Member, r.svc.Writer, r.svc.Claims = member{client: client, cookies: cookies}, client, client
	return r, h
}

func claimMove(drop *string, bid *int) apitypes.HostMoveInput {
	return apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindClaim, Week: week, Changes: []apitypes.HostMoveChange{},
		Claim: &apitypes.HostClaim{Add: claimAdd, Drop: drop, Bid: bid}}
}

func intPtr(n int) *int { return &n }

// The whole claim on a league that bids: the plan names the add, the drop
// and the bid (the league's least, 0, until one is typed) with the
// bounds, and sends nothing; the confirmed claim goes once as WAIVER with
// the bid, is found in ESPN's queue by its id, and is pending with when
// ESPN runs it. Kept as its proof, kind claim, with no cookie.
func TestClaimPlanThenPending(t *testing.T) {
	r, h := newClaimRig(t, http.StatusOK, "write-claim-pending.json", nil)
	mv := claimMove(ptr(claimDrop), nil)
	p := r.plan(t, mv)
	want := "Add Keenan Allen, drop Danny Amendola, bid $0. He is on waivers, so ESPN runs the claim on " + claimDays + "."
	if p.Status != apitypes.HostMovePlanStatusReady || p.Sentence != want || p.Confirm == nil || p.Bid == nil ||
		*p.Bid != (apitypes.HostBid{Amount: 0, Min: 0, Max: 500}) || !strings.Contains(p.HostUrl, "leagueId="+leagueID) {
		t.Fatalf("plan %+v %+v", p, p.Bid)
	}
	if h.sent() != 0 {
		t.Fatal("a plan sent a claim")
	}
	// The plan's token binds no bid: the move needs the bid the member saw,
	// planned again as a number (the screen does so before its verb opens).
	if code, env, _ := r.move(t, mv, *p.Confirm); code != http.StatusUnprocessableEntity || env.Error.Message != bidUnboundWords || h.sent() != 0 {
		t.Fatalf("a move with no bid where the league bids: %d %+v", code, env.Error)
	}
	mv = claimMove(ptr(claimDrop), intPtr(0))
	p = r.plan(t, mv)
	code, env, res := r.move(t, mv, *p.Confirm)
	if code != http.StatusOK || res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != claimPendingWords(claimDays) ||
		res.ProcessesAt == nil || !res.ProcessesAt.Equal(time.UnixMilli(1792134000000)) || res.MoveId == nil {
		t.Fatalf("move %d %+v %+v", code, env.Error, res)
	}
	want = `{"isLeagueManager":false,"teamId":1,"type":"WAIVER","scoringPeriodId":7,"executionType":"EXECUTE",` +
		`"items":[{"playerId":15818,"type":"ADD","toTeamId":1},{"playerId":11674,"type":"DROP","fromTeamId":1}],"bidAmount":0}`
	if h.sent() != 1 || string(h.writes[0]) != want {
		t.Fatalf("sent %d %s", h.sent(), h.writes)
	}
	rec, ans := r.proofs.last(t)
	if rec.Kind != kindClaim || !bytes.Contains(rec.Plan, []byte(`"bid":0`)) || !bytes.Contains(rec.Plan, []byte(`"waiver":true`)) ||
		ans.Outcome != OutcomePending || ans.ReadBack != readMatched || ans.ProcessAt == nil || ans.TransactionID == "" {
		t.Fatalf("proof %+v %s %+v", rec, rec.Plan, ans)
	}
	r.noSecrets(t)
}

// The token binds the bid: the same claim with another bid sends nothing.
func TestClaimTokenBindsTheBid(t *testing.T) {
	r, h := newClaimRig(t, http.StatusOK, "write-claim-pending.json", nil)
	p := r.plan(t, claimMove(ptr(claimDrop), intPtr(12)))
	if p.Bid == nil || p.Bid.Amount != 12 || !strings.Contains(p.Sentence, "bid $12.") {
		t.Fatalf("plan %+v", p)
	}
	code, env, _ := r.move(t, claimMove(ptr(claimDrop), intPtr(13)), *p.Confirm)
	if code != http.StatusBadRequest || (*env.Error.Fields)[fieldConfirm] != tokenOtherWords || h.sent() != 0 {
		t.Fatalf("another bid: %d %+v, %d sent", code, env.Error, h.sent())
	}
	if code, _, res := r.move(t, claimMove(ptr(claimDrop), intPtr(12)), *p.Confirm); code != http.StatusOK || res.Outcome != apitypes.HostMoveResultOutcomePending {
		t.Fatalf("the bid planned: %d %+v", code, res)
	}
	if code, env, _ := r.move(t, claimMove(ptr(claimDrop), intPtr(12)), *p.Confirm); code != http.StatusConflict || env.Error.Message != claimTokenUsedWords {
		t.Fatalf("used again: %d %+v", code, env.Error)
	}
	if h.sent() != 1 {
		t.Fatalf("%d sent", h.sent())
	}
}

// ESPN's refusal in its own words under ours, kept, never retried.
func TestClaimRefusedInESPNsWords(t *testing.T) {
	r, h := newClaimRig(t, http.StatusConflict, "write-claim-not-freeagent.json", nil)
	mv := claimMove(nil, intPtr(0))
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomeRefused || res.Sentence != claimRefusedWords || res.HostWords == nil ||
		*res.HostWords != "Player 15818 is not a free agent" || res.ProcessesAt != nil {
		t.Fatalf("refused %+v", res)
	}
	if _, ans := r.proofs.last(t); ans.Outcome != OutcomeRefused || ans.HostReason != "TRAN_PLAYER_NOT_FREEAGENT" || h.sent() != 1 {
		t.Fatalf("proof %+v, %d sent", ans, h.sent())
	}
	r.noSecrets(t)
}

// A queued claim the queue read does not show is pending, sent to check
// ESPN; nothing is sent again.
func TestClaimNotSeenInTheQueue(t *testing.T) {
	r, h := newClaimRig(t, http.StatusOK, "write-claim-pending.json", nil)
	h.pending = []byte(`{"id":48153503,"pendingTransactions":[]}`)
	mv := claimMove(ptr(claimDrop), intPtr(0))
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != claimNotSeenWords || res.ProcessesAt != nil || h.sent() != 1 {
		t.Fatalf("not seen %+v", res)
	}
	if _, ans := r.proofs.last(t); ans.ReadBack != readNotMatched {
		t.Fatalf("proof %+v", ans)
	}
}

// A free agent in a league that does not bid: no bid, FREEAGENT, made at
// once, and done when the roster read back holds him and not the drop.
func TestFreeAgentDoneOnTheRoster(t *testing.T) {
	r, h := newClaimRig(t, http.StatusOK, "write-lineup-executed.json", func(doc map[string]any) {
		noBudget(doc)
		entryOf(doc, 0, 10)["playerPoolEntry"].(map[string]any)["rosterLocked"] = false
	})
	h.players = bytes.Replace(h.players, []byte(`"WAIVERS"`), []byte(`"FREEAGENT"`), 1)
	h.after = patched(t, h.league, func(doc map[string]any) {
		e := entryOf(doc, 0, 10)
		e["playerId"] = 15818
		e["playerPoolEntry"].(map[string]any)["player"].(map[string]any)["id"] = 15818
	})
	mv := claimMove(ptr(claimDrop), nil)
	p := r.plan(t, mv)
	if p.Bid != nil || p.Sentence != "Add Keenan Allen, drop Danny Amendola, on ESPN now. He is a free agent, so the add is made at once." {
		t.Fatalf("plan %+v", p)
	}
	_, _, res := r.move(t, mv, *p.Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomeDone || res.Sentence != claimDoneWords || !bytes.Contains(h.writes[0], []byte(`"type":"FREEAGENT"`)) ||
		bytes.Contains(h.writes[0], []byte("bidAmount")) {
		t.Fatalf("done %+v %s", res, h.writes)
	}
}

// Before anything is sent, a claim is refused in the member's words:
// another week, a player another team holds, one already the member's, a
// drop ESPN does not let go, a bid outside the league's bounds, a bid
// where the league does not bid, a drop no longer on the team.
func TestClaimRefusalsBeforeSending(t *testing.T) {
	cases := []struct {
		name    string
		patch   func(map[string]any)
		players func([]byte) []byte
		mv      apitypes.HostMoveInput
		words   string
	}{
		{"another week", nil, nil, func() apitypes.HostMoveInput { m := claimMove(nil, nil); m.Week = 8; return m }(),
			"ESPN is on week 7 now. Reload the waivers to see it."},
		{"on another team", nil, func(b []byte) []byte {
			return bytes.Replace(bytes.Replace(b, []byte(`"WAIVERS"`), []byte(`"ONTEAM"`), 1), []byte(`"onTeamId":0`), []byte(`"onTeamId":3`), 1)
		}, claimMove(nil, nil), "Keenan Allen is on another team in this league now."},
		{"already his", nil, func(b []byte) []byte {
			return bytes.Replace(bytes.Replace(b, []byte(`"WAIVERS"`), []byte(`"ONTEAM"`), 1), []byte(`"onTeamId":0`), []byte(`"onTeamId":1`), 1)
		}, claimMove(nil, nil), "Keenan Allen is already on your team."},
		{"undroppable", func(doc map[string]any) {
			entryOf(doc, 0, 10)["playerPoolEntry"].(map[string]any)["player"].(map[string]any)["droppable"] = false
		}, nil, claimMove(ptr(claimDrop), nil), "ESPN does not let you drop Danny Amendola."},
		{"over the budget", nil, nil, claimMove(nil, intPtr(501)), "ESPN takes bids from $0 to $500 in this league."},
		{"over what is left", func(doc map[string]any) {
			doc["teams"].([]any)[0].(map[string]any)["transactionCounter"] = map[string]any{"acquisitionBudgetSpent": 480}
		}, nil, claimMove(nil, intPtr(21)), "ESPN takes bids from $0 to $20 in this league."},
		{"a bid where the league does not bid", noBudget, nil, claimMove(nil, intPtr(5)), noBidsWords},
		{"a drop gone", nil, nil, claimMove(ptr("15795"), nil), claimStaleWords},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, h := newClaimRig(t, http.StatusOK, "write-claim-pending.json", tc.patch)
			if tc.players != nil {
				h.players = tc.players(h.players)
			}
			code, env, _ := r.call(t, r.svc.plan, me, tc.mv)
			if code != http.StatusUnprocessableEntity || env.Error == nil || env.Error.Message != tc.words {
				t.Fatalf("%d %+v", code, env.Error)
			}
			if h.sent() != 0 {
				t.Fatal("a refused claim was sent")
			}
		})
	}
}

// The claim's form: an add that is not an id, a drop the same as the add,
// a negative bid, a claim with lineup changes, a lineup with a claim.
func TestClaimForm(t *testing.T) {
	r, _ := newClaimRig(t, http.StatusOK, "write-claim-pending.json", nil)
	withChanges := claimMove(nil, nil)
	withChanges.Changes = swap().Changes
	lineupWithClaim := swap()
	lineupWithClaim.Claim = &apitypes.HostClaim{Add: claimAdd}
	for name, mv := range map[string]apitypes.HostMoveInput{
		"a bad add":         {Kind: apitypes.HostMoveInputKindClaim, Week: week, Claim: &apitypes.HostClaim{Add: "x"}},
		"drop is the add":   claimMove(ptr(claimAdd), nil),
		"a negative bid":    claimMove(nil, intPtr(-1)),
		"no claim":          {Kind: apitypes.HostMoveInputKindClaim, Week: week},
		"with changes":      withChanges,
		"lineup with claim": lineupWithClaim,
	} {
		code, env, _ := r.call(t, r.svc.plan, me, mv)
		if code != http.StatusBadRequest || env.Error == nil {
			t.Fatalf("%s: %d", name, code)
		}
	}
	code, env, _ := r.call(t, r.svc.plan, me, claimMove(ptr(claimAdd), nil))
	if code != http.StatusBadRequest || (*env.Error.Fields)[fieldMove] != claimFormWords {
		t.Fatalf("the claim's form words: %+v", env.Error)
	}
}

// The claim's own switch and allow list: the lineup's switch does not
// open a claim; the claim's does, or the allow list; a connection at the
// old consent is asked to connect again in a claim's words; another team
// is unavailable, nothing sent.
func TestClaimSwitchAndGuards(t *testing.T) {
	r, h := newClaimRig(t, http.StatusOK, "write-claim-pending.json", nil)
	ctx := context.Background()
	r.svc.ESPNClaim, r.svc.ESPNLineup = false, true
	if got, err := r.svc.ClaimMove(ctx, me, espnhost.Host); err != nil || got.Claim != apitypes.WaiverMovesClaimUnavailable || got.Note != nil {
		t.Fatalf("claim switch off: %+v %v", got, err)
	}
	if p := r.plan(t, claimMove(nil, nil)); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != offWords ||
		!strings.Contains(p.HostUrl, "leagueId=") {
		t.Fatalf("claim switch off, plan %+v", p)
	}
	r.proofs.allowed[me] = true
	if got, _ := r.svc.ClaimMove(ctx, me, espnhost.Host); got.Claim != apitypes.WaiverMovesClaimAvailable {
		t.Fatalf("listed: %+v", got)
	}
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: 2}}
	if got, _ := r.svc.ClaimMove(ctx, me, espnhost.Host); got.Note == nil || *got.Note != claimReconsentWords {
		t.Fatalf("version 2: %+v", got)
	}
	r.svc.Connections = conns{&hosts.Connection{Status: hosts.StatusConnected, ConsentVersion: hosts.ESPNConsentVersion}}
	for _, host := range []string{"sleeper", "yahoo", "ffpc", "mfl"} {
		if got, _ := r.svc.ClaimMove(ctx, me, host); got.Claim != apitypes.WaiverMovesClaimUnavailable {
			t.Fatalf("%s: %+v", host, got)
		}
	}
	l := r.svc.Links.(links)
	l.link.RosterID = 2
	r.svc.Links = l
	if p := r.plan(t, claimMove(nil, nil)); p.Status != apitypes.HostMovePlanStatusUnavailable || p.Sentence != claimNotYourTeamWords {
		t.Fatalf("another team: %+v", p)
	}
	token, _ := r.svc.Signer.Sign(me, linkID, claimMove(nil, nil), r.now.Add(ConfirmFor))
	if _, _, res := r.move(t, claimMove(nil, nil), token); res.Outcome != apitypes.HostMoveResultOutcomeUnavailable {
		t.Fatalf("another team, a good token: %+v", res)
	}
	if h.sent() != 0 || len(r.proofs.order) != 0 {
		t.Fatal("a claim past the guards")
	}
}

// A waiver claim whose answer was lost (a 502, or the connection dropped
// after the request left) is read back in ESPN's queue by the member's
// team and the claim's players, never on the roster: queued is pending
// with when ESPN runs it. Never sent twice.
func TestALostWaiverClaimIsFoundInTheQueue(t *testing.T) {
	for _, lost := range []string{"502", "dropped"} {
		t.Run(lost, func(t *testing.T) {
			r, h := newClaimRig(t, http.StatusBadGateway, "", nil)
			h.drop = lost == "dropped"
			mv := claimMove(ptr(claimDrop), intPtr(0))
			_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
			if res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != claimPendingWords(claimDays) ||
				res.ProcessesAt == nil || !res.ProcessesAt.Equal(time.UnixMilli(1792134000000)) || h.sent() != 1 {
				t.Fatalf("lost %+v, %d sent", res, h.sent())
			}
			if _, ans := r.proofs.last(t); ans.ReadBack != readMatched || ans.ProcessAt == nil {
				t.Fatalf("proof %+v", ans)
			}
			// Not in the queue: pending, the claims named as what was read.
			h.pending = []byte(`{"id":48153503,"pendingTransactions":[]}`)
			mv = claimMove(ptr(claimDrop), intPtr(1))
			_, _, res = r.move(t, mv, *r.plan(t, mv).Confirm)
			if res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != claimNotSeenWords || h.sent() != 2 {
				t.Fatalf("lost, not queued %+v", res)
			}
		})
	}
}

// A free agent's add whose answer was lost is read back on the roster,
// and the sentence names the roster.
func TestALostFreeAgentAddIsReadOnTheRoster(t *testing.T) {
	r, h := newClaimRig(t, http.StatusBadGateway, "", func(doc map[string]any) {
		noBudget(doc)
		entryOf(doc, 0, 10)["playerPoolEntry"].(map[string]any)["rosterLocked"] = false
	})
	h.players = bytes.Replace(h.players, []byte(`"WAIVERS"`), []byte(`"FREEAGENT"`), 1)
	mv := claimMove(ptr(claimDrop), nil)
	_, _, res := r.move(t, mv, *r.plan(t, mv).Confirm)
	if res.Outcome != apitypes.HostMoveResultOutcomePending || res.Sentence != claimNotOnRosterWords || h.sent() != 1 {
		t.Fatalf("lost free agent %+v", res)
	}
}

// The claim route takes ESPN's ids as the waivers answer carries them: a
// player's board id and a defense's negative D/ST id.
func TestClaimFormTakesESPNIds(t *testing.T) {
	for _, add := range []string{"4429795", "-16010"} {
		mv := apitypes.HostMoveInput{Kind: apitypes.HostMoveInputKindClaim, Week: week, Changes: []apitypes.HostMoveChange{},
			Claim: &apitypes.HostClaim{Add: add}}
		if !checkMove(mv) {
			t.Fatalf("%s refused", add)
		}
	}
}
