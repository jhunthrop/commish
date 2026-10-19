package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// A matchup side's points and each starter's leave as the tenth the
// Matchup screen prints (Lane 66k rereview N1), the host's cents rounded
// once by the site's rule.
func TestMatchupPointsLeaveAsTheTenth(t *testing.T) {
	side := players{}.side(HostSleeper, Side{RosterID: 1, Points: 39.15, Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 9.45}})
	if side.Points != 39.2 || side.Starters[0].Points == nil || *side.Starters[0].Points != 9.5 {
		t.Fatalf("side %v starter %v, want 39.2 and 9.5", side.Points, side.Starters[0].Points)
	}
}

// The league read's starters follow the one per-platform rule (Lane 79
// fix 7): a platform's points by player where it gives them, none where
// it gives the side's total alone, and none for an ESPN starter its
// period roster left out (kicked off, unknown), never a 0.0; the side
// says which, and whether its own total is the score.
func TestTheLeagueReadsStartersFollowThePerPlatformRule(t *testing.T) {
	read := Side{RosterID: 1, Points: 40, Starters: []string{"p", "q"}, PlayerPoints: map[string]float64{"p": 9.45}}
	espnSide := players{}.side(HostESPN, read)
	if !espnSide.PlayerPoints || !espnSide.TeamTotal || espnSide.Starters[0].Points == nil || *espnSide.Starters[0].Points != 9.5 || espnSide.Starters[1].Points != nil {
		t.Fatalf("ESPN: %+v", espnSide)
	}
	yahoo := players{}.side(HostYahoo, read)
	if yahoo.PlayerPoints || !yahoo.TeamTotal || yahoo.Starters[0].Points != nil {
		t.Fatalf("Yahoo: %+v", yahoo)
	}
	sl := players{}.side(HostSleeper, read)
	if !sl.PlayerPoints || sl.TeamTotal {
		t.Fatalf("Sleeper: %+v", sl)
	}
}

// The league read's route sends every matchup figure as a tenth.
func TestTheLeagueReadsMatchupIsInTenths(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	me, err := (&auth.Store{Pool: pool}).UpsertAccount(ctx, auth.Identity{UserID: "user_tenths", Email: "tenths@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	svc := replayService(pool)
	a := caller{t, svc, me.ID}
	link := "https://sleeper.com/leagues/" + ReplaySleeperLeague + "/team"
	status, body := a.do(svc.attach, http.MethodPost, "/leagues/attach", apitypes.AttachInput{Link: link, Me: apitypes.AttachSeat{RosterId: intp(1)}}, "")
	var sync apitypes.LeagueSync
	if status != http.StatusCreated || json.Unmarshal(body, &sync) != nil {
		t.Fatalf("attach: %d %s", status, body)
	}
	if sync.Matchup == nil {
		t.Fatal("the recorded league has no matchup this week")
	}
	sides := []apitypes.MatchupSide{sync.Matchup.Mine}
	if sync.Matchup.Opponent != nil {
		sides = append(sides, *sync.Matchup.Opponent)
	}
	for _, s := range sides {
		if s.Points != tenth.Round(s.Points) {
			t.Errorf("side %d points %v is not a tenth", s.RosterId, s.Points)
		}
		for _, st := range s.Starters {
			if st.Points != nil && *st.Points != tenth.Round(*st.Points) {
				t.Errorf("starter %s points %v is not a tenth", st.Player.Name, st.Points)
			}
		}
	}
}
