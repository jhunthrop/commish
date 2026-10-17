package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// The front door's list is the account's leagues, each in season with the
// read the in-season routes make and the fresh standing; the attached
// list carries the link's last read once the league has been read.
func TestWeekReadsEachLeagueInSeason(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	alice, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_week", Email: "week@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	svc := replayService(pool)
	a := caller{t, svc, alice.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	if status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}}, ""); status != http.StatusCreated {
		t.Fatalf("attach: %d %s", status, body)
	}

	list, err := svc.Week(ctx, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("%d leagues, want 1", len(list))
	}
	got := list[0]
	if got.Host != HostSleeper || got.Name == "" || got.Problem != "" {
		t.Fatalf("%+v, want the Sleeper league with no problem", got)
	}
	if !inWeek(got.Phase.Phase) || (got.Followed == nil || got.Standing == nil || got.Followed.Link.RosterID != 1) {
		t.Fatalf("in season %s: followed %v standing %v, want the read and the standing", got.Phase.Phase, got.Followed != nil, got.Standing)
	}

	var attached []apitypes.AttachedLeague
	status, body := a.do(svc.attached, http.MethodGet, "/leagues/attached", nil, "")
	if status != http.StatusOK || json.Unmarshal(body, &attached) != nil || len(attached) != 1 {
		t.Fatalf("attached: %d %s", status, body)
	}
	if attached[0].LastReadAt == nil {
		t.Fatalf("the attached league carries no last read after its attach read it: %s", body)
	}
}

// downBoard fails every valuation, a failure on our side.
type downBoard struct{}

func (downBoard) For(context.Context, apitypes.LeagueSettings) (boards.Board, error) {
	return boards.Board{}, errors.New("board store down")
}

// A league whose read fails on our side keeps its row with the sentence and
// its last read (Lane 66k M1): the list still answers.
func TestWeekKeepsALeagueThatFailsOnOurSide(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	me, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_week_down", Email: "down@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	svc := replayService(pool)
	a := caller{t, svc, me.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	if status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}}, ""); status != http.StatusCreated {
		t.Fatalf("attach: %d %s", status, body)
	}
	svc.Boards = downBoard{}
	list, err := svc.Week(ctx, me.ID)
	if err != nil {
		t.Fatalf("one league's failure failed the list: %v", err)
	}
	if len(list) != 1 || list[0].Problem != ReadFailedWords || list[0].Followed != nil || list[0].Name == "" || list[0].LastReadAt == nil {
		t.Fatalf("%+v, want the row with its name, last read and the sentence", list)
	}
}

// panicBoard panics on every valuation, a bad snapshot on our side.
type panicBoard struct{}

func (panicBoard) For(context.Context, apitypes.LeagueSettings) (boards.Board, error) {
	panic("bad snapshot")
}

// A league whose read panics keeps its row with the sentence; the list
// answers and the process carries on (Lane 66k rereview N2).
func TestWeekRecoversALeaguesPanic(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	me, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_week_panic", Email: "panic@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	svc := replayService(pool)
	a := caller{t, svc, me.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	if status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}}, ""); status != http.StatusCreated {
		t.Fatalf("attach: %d %s", status, body)
	}
	svc.Boards = panicBoard{}
	list, err := svc.Week(ctx, me.ID)
	if err != nil || len(list) != 1 || list[0].Problem != ReadFailedWords || list[0].Followed != nil {
		t.Fatalf("%+v %v, want the row with the sentence", list, err)
	}
}

// A read the platform stopped is said in one sentence naming it, with
// what the member does where there is something to do.
func TestHostProblemWordsNameThePlatform(t *testing.T) {
	cases := map[string]error{
		"ESPN asks you to connect again":    ErrSignInAgain,
		"Connect ESPN":                      ErrNotConnected,
		"ESPN is busy":                      ErrBusy,
		"ESPN is not answering right now":   ErrUnavailable,
		"ESPN is not answering right now. ": errors.New("other"),
	}
	for want, err := range cases {
		if got := HostProblemWords(HostESPN, err); !strings.HasPrefix(got, strings.TrimSpace(want)) {
			t.Errorf("%v: %q, want it to start %q", err, got, want)
		}
	}
	// The page names the last read beside the sentence once (rereview N4): the sentence never does.
	for _, err := range []error{ErrBusy, ErrUnavailable} {
		if got := HostProblemWords(HostESPN, err); strings.Contains(strings.ToLower(got), "last read") {
			t.Errorf("%v: %q names the last read", err, got)
		}
	}
	if got := HostProblemWords("ffpc", ErrSignInAgain); !strings.Contains(got, "FFPC") {
		t.Errorf("FFPC signed out: %q", got)
	}
}
