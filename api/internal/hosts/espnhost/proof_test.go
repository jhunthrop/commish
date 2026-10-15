package espnhost

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// liftedPair is another member's SWID, which is not secret, with an
// espn_s2 made up: the fan list answers it, a private league does not.
var liftedPair = apitypes.ESPNConnectInput{Swid: goodSWID, EspnS2: strings.Repeat("Z", 60), Consent: true}

// errorOf is an error answer's sentence.
func errorOf(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Error struct{ Message string } `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatalf("body %s: %v", body, err)
	}
	return e.Error.Message
}

// M1 at connect: a list whose private league's public check ESPN does not
// answer still reads that league with the cookies, so a lifted SWID with
// a made-up espn_s2 is refused and nothing is kept.
func TestConnectReadsAnUnansweredLeagueWithTheCookies(t *testing.T) {
	r := setup(t)
	r.client.unanswered = map[string]bool{agbo: true}
	status, body := call(t, r.s.connect, r.me, liftedPair)
	if status != http.StatusUnprocessableEntity || errorOf(t, body) != refusedWords || r.store.conn != nil || r.store.refusals != 1 {
		t.Fatalf("lifted pair over an unanswered private league: %d %s, kept %v", status, body, r.store.conn != nil)
	}
	// The member's own pair over the same list connects, unproven: a read
	// of an unanswered league proves nothing.
	status, body = call(t, r.s.connect, r.me, goodPair)
	if status != http.StatusOK || r.store.conn == nil || r.store.conn.Proven {
		t.Fatalf("own pair: %d %s", status, body)
	}
}

// M1 on the list: a lifted pair kept unproven while every league was
// public is refused once the list holds a private league: 409 in the
// never-accepted words, the session signed out, and the private league's
// name never answered.
func TestListWithAPrivateLeagueRefusesALiftedPair(t *testing.T) {
	r := setup(t)
	r.client.private = map[string]bool{}
	if status, body := call(t, r.s.connect, r.me, liftedPair); status != http.StatusOK || r.store.conn.Proven {
		t.Fatalf("lifted pair over a public list: %d %s", status, body)
	}
	r.client.fan, r.client.private = fanFixture(t, public), map[string]bool{public: true}
	status, body := call(t, r.s.leagues, r.me, nil)
	if status != http.StatusConflict || errorOf(t, body) != notAcceptedWords || !r.store.signedOut {
		t.Fatalf("list: %d %s, signed out %v", status, body, r.store.signedOut)
	}
	if strings.Contains(string(body), "League "+public) || strings.Contains(string(body), public) {
		t.Fatalf("the private league was answered: %s", body)
	}
	if status, body := call(t, r.s.leagues, r.me, nil); status != http.StatusConflict || errorOf(t, body) != notAcceptedWords {
		t.Fatalf("after sign out: %d %s", status, body)
	}
}

// The member's own unproven session is proven by the list's read of its
// private league, and answers the list.
func TestListProvesAnUnprovenSession(t *testing.T) {
	r := setup(t)
	r.client.private = map[string]bool{}
	call(t, r.s.connect, r.me, goodPair)
	r.client.fan, r.client.private = fanFixture(t, public), map[string]bool{public: true}
	if status, body := call(t, r.s.leagues, r.me, nil); status != http.StatusOK || !r.store.conn.Proven {
		t.Fatalf("list: %d %s, proven %v", status, body, r.store.conn.Proven)
	}
	reads := r.client.reads
	call(t, r.s.leagues, r.me, nil)
	if r.client.reads != reads {
		t.Fatal("a proven session read a league again to list")
	}
}

// L3: a connect past its deadline answers that ESPN is not answering and
// keeps nothing.
func TestConnectPastItsDeadlineKeepsNothing(t *testing.T) {
	r := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	status, body := callIn(t, ctx, r.s.connect, r.me, goodPair)
	if status != http.StatusBadGateway || errorOf(t, body) != notAnswering || r.store.puts != 0 {
		t.Fatalf("past the deadline: %d %s, %d puts", status, body, r.store.puts)
	}
}

// L1: a league with no mark says why: past the checked first ten, or
// ESPN did not answer its check.
func TestUnmarkedLeaguesSayWhy(t *testing.T) {
	r := setup(t)
	extra := make([]string, 0, 11)
	for i := range 11 {
		extra = append(extra, strconv.Itoa(2000+i))
	}
	r.client.fan, r.client.private = fanFixture(t, extra...), map[string]bool{}
	r.client.unanswered = map[string]bool{"2000": true}
	call(t, r.s.connect, r.me, goodPair)
	_, body := call(t, r.s.leagues, r.me, nil)
	var list struct {
		Data []apitypes.HostLeague `json:"data"`
	}
	if err := json.Unmarshal(body, &list); err != nil || len(list.Data) != 12 {
		t.Fatalf("list %s", body)
	}
	why := map[string]string{}
	for i, l := range list.Data {
		switch {
		case l.Public != nil && l.Unmarked == nil:
		case l.Public == nil && l.Unmarked != nil:
			why[l.LeagueId] = string(*l.Unmarked)
		default:
			t.Fatalf("league %d both or neither marked: %+v", i, l)
		}
	}
	if len(why) != 3 || why["2000"] != unmarkedNoAnswer || why[list.Data[10].LeagueId] != unmarkedPastLimit || why[list.Data[11].LeagueId] != unmarkedPastLimit {
		t.Fatalf("unmarked %v", why)
	}
}
