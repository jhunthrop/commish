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
	side := players{}.side(Side{RosterID: 1, Points: 39.15, Starters: []string{"p"}, PlayerPoints: map[string]float64{"p": 9.45}})
	if side.Points != 39.2 || side.Starters[0].Points != 9.5 {
		t.Fatalf("side %v starter %v, want 39.2 and 9.5", side.Points, side.Starters[0].Points)
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
			if st.Points != tenth.Round(st.Points) {
				t.Errorf("starter %s points %v is not a tenth", st.Player.Name, st.Points)
			}
		}
	}
}
