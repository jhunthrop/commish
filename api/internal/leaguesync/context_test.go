package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/account"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// The saved league decides a league's scoring and board, superflex by its
// lineup; with none, the last read's rules and lineup do; with no rules
// read at all, PPR.
func TestLeagueScoring(t *testing.T) {
	half := apitypes.ScoringPresetHalfPpr
	tePremium := map[string]float64{"points_per_reception": 1, "te_reception_bonus": 0.5}
	standard := map[string]float64{"points_per_reception": 0}
	// A saved league's own scoring is the 21 ScoringRules (Lane 8 part A).
	savedTE := scoring.Standard()
	savedTE.PointsPerReception, savedTE.TeReceptionBonus = 1, 0.5
	cases := []struct {
		name        string
		saved       *apitypes.LeagueSettings
		rules       map[string]float64
		superFlex   bool
		wantScoring apitypes.ScoringPreset
		wantFormat  apitypes.BoardFormat
	}{
		{"saved preset", &apitypes.LeagueSettings{Scoring: apitypes.Scoring{Preset: &half}, Lineup: apitypes.LineupStandard}, standard, false, half, apitypes.BoardFormatHalfPpr},
		{"saved TE premium reads on PPR", &apitypes.LeagueSettings{Scoring: apitypes.Scoring{Custom: &savedTE}, Lineup: apitypes.LineupStandard}, nil, false, apitypes.ScoringPresetTePremium, apitypes.BoardFormatPpr},
		{"saved superflex lineup", &apitypes.LeagueSettings{Scoring: apitypes.Scoring{Custom: &savedTE}, Lineup: apitypes.LineupSuperflex}, nil, false, apitypes.ScoringPresetTePremium, apitypes.BoardFormatSuperflex},
		{"saved lineup over the read's", &apitypes.LeagueSettings{Scoring: apitypes.Scoring{Preset: &half}, Lineup: apitypes.LineupStandard}, nil, true, half, apitypes.BoardFormatHalfPpr},
		{"read rules", nil, standard, false, apitypes.ScoringPresetStandard, apitypes.BoardFormatStandard},
		{"read TE premium", nil, tePremium, false, apitypes.ScoringPresetTePremium, apitypes.BoardFormatPpr},
		{"read half", nil, map[string]float64{"points_per_reception": 0.5}, false, half, apitypes.BoardFormatHalfPpr},
		{"read superflex", nil, standard, true, apitypes.ScoringPresetStandard, apitypes.BoardFormatSuperflex},
		{"nothing read", nil, nil, false, apitypes.ScoringPresetPpr, apitypes.BoardFormatPpr},
	}
	for _, c := range cases {
		scoring, format := LeagueScoring(c.saved, c.rules, c.superFlex)
		if scoring != c.wantScoring || format != c.wantFormat {
			t.Errorf("%s: %s on %s, want %s on %s", c.name, scoring, format, c.wantScoring, c.wantFormat)
		}
	}
}

// selectAs puts a choice and answers the status and the Account.
func selectAs(t *testing.T, svc *Service, id uuid.UUID, choice any) (int, apitypes.Account) {
	t.Helper()
	status, body := caller{t, svc, id}.do(svc.selectLeague, http.MethodPut, "/me/league", choice, "")
	var out apitypes.Account
	if status == http.StatusOK {
		if err := json.Unmarshal(body, &out); err != nil {
			t.Fatal(err)
		}
	}
	return status, out
}

// The context is the newest league until one is chosen; a chosen league
// or a format holds; another account's league, a detached one and a
// choice of both or neither are refused; a detached selection reads as
// no choice.
func TestTheLeagueIsTheContext(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	svc := replayService(pool)
	store := &Store{Pool: pool, Now: svc.Now}
	ents := &entitlements.Store{Pool: pool}
	svc.Selection = store
	svc.Accounts = &account.Viewer{Entitlements: ents, Leagues: store, Now: time.Now}
	accounts := &auth.Store{Pool: pool}
	carol, dave := newAccount(t, accounts, "carol"), newAccount(t, accounts, "dave")
	if err := ents.Grant(ctx, carol, entitlements.ProductMembership, 0, time.Now().AddDate(1, 0, 0), "test"); err != nil {
		t.Fatal(err)
	}
	_, sleeperID, _ := attachAs(t, svc, carol, sleeperLink)
	_, mflID, _ := attachAs(t, svc, carol, mflLink)
	_, daveID, _ := attachAs(t, svc, dave, sleeperLink)

	got, err := store.Context(ctx, carol)
	if err != nil || len(got.Leagues) != 2 || got.League == nil || got.League.Id != mflID || got.Format == nil {
		t.Fatalf("no choice: %+v (%v), want the newest league (%s) of two", got, err, mflID)
	}
	sleeper := got.Leagues[1]
	if sleeper.Id != sleeperID || sleeper.Scoring != apitypes.ScoringPresetTePremium ||
		sleeper.Format != apitypes.BoardFormatPpr || sleeper.SettingsLeagueId == nil || sleeper.Name == "" {
		t.Fatalf("the Sleeper league reads %+v, want TE premium on the PPR board with its saved league", sleeper)
	}
	// Each league's phase, read from its kept snapshot at the store's
	// clock: the recorded Sleeper league is drafted and in week 6 with
	// its playoffs from week 15, the recorded MyFantasyLeague one states
	// no draft and is in week 6 with its playoffs from week 15.
	if sleeper.Phase != apitypes.LeaguePhaseInSeason || sleeper.PhaseBasis != "Sleeper says the draft is done and week 6 is under way." ||
		sleeper.PlayoffStartWeek == nil || *sleeper.PlayoffStartWeek != 15 || !sleeper.WaiversOpen || sleeper.DraftAt != nil {
		t.Fatalf("the Sleeper league's phase: %s %q, playoffs %v, waivers %v", sleeper.Phase, sleeper.PhaseBasis, sleeper.PlayoffStartWeek, sleeper.WaiversOpen)
	}
	if m := got.Leagues[0]; m.Phase != apitypes.LeaguePhaseInSeason || m.PlayoffStartWeek == nil || *m.PlayoffStartWeek != 15 ||
		m.PhaseBasis != "MyFantasyLeague did not state the draft and week 6 is under way." {
		t.Fatalf("the MyFantasyLeague league's phase: %s %q, playoffs %v", m.Phase, m.PhaseBasis, m.PlayoffStartWeek)
	}

	status, me := selectAs(t, svc, carol, apitypes.LeagueChoice{LeagueId: &sleeperID})
	if status != http.StatusOK || me.League == nil || me.League.Id != sleeperID || me.Format == nil ||
		*me.Format != apitypes.BoardFormatPpr || len(me.Leagues) != 2 {
		t.Fatalf("choosing the Sleeper league: %d %+v", status, me)
	}
	half := apitypes.BoardFormatHalfPpr
	status, me = selectAs(t, svc, carol, apitypes.LeagueChoice{Format: &half})
	if status != http.StatusOK || me.League != nil || me.Format == nil || *me.Format != apitypes.BoardFormatHalfPpr {
		t.Fatalf("choosing half PPR with no league: %d %+v", status, me)
	}
	superflex := apitypes.BoardFormatSuperflex
	status, me = selectAs(t, svc, carol, apitypes.LeagueChoice{Format: &superflex})
	if status != http.StatusOK || me.League != nil || me.Format == nil || *me.Format != superflex {
		t.Fatalf("choosing the superflex board with no league: %d %+v", status, me)
	}

	refusals := []struct {
		name   string
		choice any
		want   int
	}{
		{"another account's league", apitypes.LeagueChoice{LeagueId: &daveID}, http.StatusNotFound},
		{"both", apitypes.LeagueChoice{LeagueId: &sleeperID, Format: &half}, http.StatusBadRequest},
		{"neither", apitypes.LeagueChoice{}, http.StatusBadRequest},
		{"a format we have no board for", map[string]string{"format": "quarter_ppr"}, http.StatusBadRequest},
	}
	for _, r := range refusals {
		if status, _ := selectAs(t, svc, carol, r.choice); status != r.want {
			t.Errorf("%s: %d, want %d", r.name, status, r.want)
		}
	}

	if status, _ := selectAs(t, svc, carol, apitypes.LeagueChoice{LeagueId: &sleeperID}); status != http.StatusOK {
		t.Fatalf("choosing the Sleeper league again: %d", status)
	}
	if err := store.Detach(ctx, carol, sleeperID); err != nil {
		t.Fatal(err)
	}
	got, err = store.Context(ctx, carol)
	if err != nil || len(got.Leagues) != 1 || got.League == nil || got.League.Id != mflID {
		t.Fatalf("after detaching the chosen league: %+v (%v), want the newest league left", got, err)
	}
	if status, _ := selectAs(t, svc, carol, apitypes.LeagueChoice{LeagueId: &sleeperID}); status != http.StatusNotFound {
		t.Fatalf("choosing a detached league: %d, want 404", status)
	}
}
