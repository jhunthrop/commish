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
	if got := HostProblemWords("ffpc", ErrSignInAgain); !strings.Contains(got, "FFPC") {
		t.Errorf("FFPC signed out: %q", got)
	}
}
