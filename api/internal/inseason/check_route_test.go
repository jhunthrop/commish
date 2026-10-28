package inseason

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

func post(t *testing.T, s *Service, path, body string) (int, envelope) {
	t.Helper()
	mux := http.NewServeMux()
	for _, rt := range s.Routes() {
		mux.HandleFunc(rt.Method+" "+rt.Path, rt.Handler)
	}
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithAccount(req.Context(), auth.Account{ID: uuid.MustParse("00000000-0000-0000-0000-00000000000a")}))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("%s: %v: %s", path, err, rec.Body.String())
	}
	return rec.Code, env
}

func checkBody(t *testing.T, team int, give, get []string) string {
	t.Helper()
	b, err := json.Marshal(apitypes.TradeCheckInput{Team: team, Give: give, Get: get})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func hostIDs(lines []apitypes.PlayerLine) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = l.Player.HostId
	}
	return out
}

// Every trade the finder lists checks to the finder's numbers and drop,
// both rosters filling every slot; and each team carries its roster for
// the builder's columns.
func TestTradeCheckAgreesWithTheFinder(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	_, env := serve(t, s, leaguePath+"trades")
	var advice apitypes.TradeAdvice
	if err := json.Unmarshal(env.Data, &advice); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, team := range advice.Teams {
		if len(team.Roster) == 0 {
			t.Fatalf("%s carries no roster", team.Name)
		}
		for _, row := range team.Trades {
			code, env := post(t, s, leaguePath+"trades/check", checkBody(t, team.RosterId, hostIDs(row.Give), hostIDs(row.Get)))
			if code != http.StatusOK {
				t.Fatalf("%d %+v", code, env.Error)
			}
			var got apitypes.TradeCheck
			if err := json.Unmarshal(env.Data, &got); err != nil {
				t.Fatal(err)
			}
			if got.Trade.MyGain != row.MyGain || got.Trade.TheirGain != row.TheirGain || got.Trade.CloseForThem != row.CloseForThem ||
				(got.Trade.Drop == nil) != (row.Drop == nil) || (row.Drop != nil && got.Trade.Drop.Player.HostId != row.Drop.Player.HostId) {
				t.Fatalf("%s: checked %+v, the finder %+v", team.Name, got.Trade, row)
			}
			if !got.Fills.Yours || !got.Fills.Theirs || got.Fills.YoursOpen != nil || got.Basis == "" || got.HostTradesUrl != advice.HostTradesUrl {
				t.Fatalf("%s: %+v %q %q", team.Name, got.Fills, got.Basis, got.HostTradesUrl)
			}
			// The rest-of-season figures agree too, and the finder lists
			// only trades the other side takes (Lane 269).
			if !sameFigure(got.Trade.MyRestOfSeason, row.MyRestOfSeason) || !sameFigure(got.Trade.TheirRestOfSeason, row.TheirRestOfSeason) ||
				got.Acceptable == nil || !got.Acceptable.Theirs || !got.Acceptable.Yours || got.RestOfSeasonBasis == nil {
				t.Fatalf("%s: rest of season checked %v/%v, the finder %v/%v, acceptable %+v", team.Name,
					got.Trade.MyRestOfSeason, got.Trade.TheirRestOfSeason, row.MyRestOfSeason, row.TheirRestOfSeason, got.Acceptable)
			}
			checked++
		}
	}
	if advice.RestOfSeasonBasis == nil || !strings.HasPrefix(*advice.RestOfSeasonBasis, "Rest of season is ") {
		t.Fatalf("the finder's rest-of-season line %v", advice.RestOfSeasonBasis)
	}
	if checked == 0 {
		t.Fatal("the fixture's finder found no trade to check")
	}
}

// A trade that loses is answered as a loss; a lineup it leaves short
// names the slot.
func TestTradeCheckAnswersAnyTrade(t *testing.T) {
	f := newFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	// The member's quarterback (p000) for team 2's backup (p025): one
	// quarterback each way, every slot still filled.
	code, env := post(t, s, leaguePath+"trades/check", checkBody(t, 2, []string{"h000"}, []string{"h025"}))
	var got apitypes.TradeCheck
	if code != http.StatusOK || json.Unmarshal(env.Data, &got) != nil || !got.Fills.Yours || !got.Fills.Theirs {
		t.Fatalf("%d %+v %+v", code, env.Error, got.Fills)
	}
	// Both his tight ends (p006, p013) for a receiver leave his TE open.
	code, env = post(t, s, leaguePath+"trades/check", checkBody(t, 2, []string{"h006", "h013"}, []string{"h018"}))
	got = apitypes.TradeCheck{}
	if code != http.StatusOK || json.Unmarshal(env.Data, &got) != nil {
		t.Fatalf("%d %+v", code, env.Error)
	}
	if got.Fills.Yours || got.Fills.YoursOpen == nil || *got.Fills.YoursOpen != "TE" || !got.Fills.Theirs {
		t.Fatalf("fills %+v", got.Fills)
	}
}

func TestTradeCheckRefusals(t *testing.T) {
	f := newFixture(t)
	league := f.league
	// Team 2's p019 sits in its injured reserve spot; team 2's p016 is
	// marked on injured reserve by the host but on its roster.
	teams := append([]leaguesync.Team(nil), league.Snap.Teams...)
	teams[1].Reserve = []string{"h019"}
	league.Snap.Teams = teams
	player := league.Player
	league.Player = func(id string) apitypes.LeaguePlayer {
		lp := player(id)
		if id == "h016" {
			lp.InjuredReserve = true
		}
		return lp
	}
	cases := []struct {
		name  string
		body  string
		code  int
		words string
	}{
		{"his player on another roster", checkBody(t, 2, []string{"h020"}, []string{"h018"}), http.StatusUnprocessableEntity, "Player 020 is not on your roster"},
		{"their player not on theirs", checkBody(t, 2, []string{"h001"}, []string{"h031"}), http.StatusUnprocessableEntity, "Player 031 is not on Team 2's roster"},
		{"a player on no roster", checkBody(t, 2, []string{"h999"}, []string{"h018"}), http.StatusUnprocessableEntity, "That player is not on your roster"},
		{"a kicker", checkBody(t, 2, []string{"h008"}, []string{"h018"}), http.StatusUnprocessableEntity, "Player 008 is a kicker"},
		{"a defense", checkBody(t, 2, []string{"h001"}, []string{"h024"}), http.StatusUnprocessableEntity, "Player 024 is a defense"},
		{"an injured reserve spot", checkBody(t, 2, []string{"h001"}, []string{"h019"}), http.StatusUnprocessableEntity, "Player 019 is on injured reserve"},
		{"the host's injured reserve mark", checkBody(t, 2, []string{"h001"}, []string{"h016"}), http.StatusUnprocessableEntity, "Player 016 is on injured reserve"},
		{"his own team", checkBody(t, 1, []string{"h001"}, []string{"h002"}), http.StatusUnprocessableEntity, "Pick another team"},
		{"a team not in the read", checkBody(t, 40, []string{"h001"}, []string{"h018"}), http.StatusUnprocessableEntity, "Pick another team"},
		{"three a side", checkBody(t, 2, []string{"h001", "h002", "h003"}, []string{"h018"}), http.StatusBadRequest, ""},
		{"nobody a side", checkBody(t, 2, nil, []string{"h018"}), http.StatusBadRequest, ""},
		{"a player twice", checkBody(t, 2, []string{"h001", "h001"}, []string{"h018"}), http.StatusBadRequest, ""},
		{"an id too long", checkBody(t, 2, []string{strings.Repeat("9", 65)}, []string{"h018"}), http.StatusBadRequest, ""},
		{"a body that is not one", `{"team": 2`, http.StatusBadRequest, ""},
	}
	for _, c := range cases {
		code, env := post(t, fixtureService(t, league, f.data, &fakeHolds{}), leaguePath+"trades/check", c.body)
		if code != c.code || env.Ok || env.Error == nil {
			t.Fatalf("%s: %d %+v", c.name, code, env)
		}
		if c.words != "" && !strings.HasPrefix(env.Error.Message, c.words) {
			t.Fatalf("%s: %q", c.name, env.Error.Message)
		}
	}
}

// The answer says when the member's roster has no room for two in: every
// player he could drop is held. With one free it has room and names him.
// The finder's answer carries the builder's honesty line, the one the
// check answers with.
func TestTradeCheckSaysWhenThereIsNoRoom(t *testing.T) {
	f := newFixture(t)
	held := map[string]bool{}
	for n := 0; n < 15; n++ {
		held[fmt.Sprintf("p%03d", n)] = true
	}
	body := checkBody(t, 2, []string{"h001"}, []string{"h016", "h017"})
	code, env := post(t, fixtureService(t, f.league, f.data, &fakeHolds{held: held}), leaguePath+"trades/check", body)
	var got apitypes.TradeCheck
	if code != http.StatusOK || json.Unmarshal(env.Data, &got) != nil {
		t.Fatalf("%d %+v", code, env.Error)
	}
	if got.Fills.YoursRoom || got.Trade.Drop != nil || !got.Fills.TheirsRoom {
		t.Fatalf("all held: %+v drop %v", got.Fills, got.Trade.Drop)
	}
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	_, env = post(t, s, leaguePath+"trades/check", body)
	got = apitypes.TradeCheck{}
	if json.Unmarshal(env.Data, &got) != nil || !got.Fills.YoursRoom || got.Trade.Drop == nil {
		t.Fatalf("none held: %+v drop %v", got.Fills, got.Trade.Drop)
	}
	_, env = serve(t, s, leaguePath+"trades")
	var advice apitypes.TradeAdvice
	if json.Unmarshal(env.Data, &advice) != nil || advice.CheckBasis == "" || advice.CheckBasis != got.Basis {
		t.Fatalf("check basis %q, the check's %q", advice.CheckBasis, got.Basis)
	}
}

// The check answers as the finder does with no saved scoring, out of
// season, and with the member's team missing from the read.
func TestTradeCheckLeagueErrors(t *testing.T) {
	f := newFixture(t)
	unsaved := f.league
	unsaved.Saved, unsaved.SettingsNote = nil, "A mock draft cannot rerun this league yet: its lineup has IDP."
	noTeam := f.league
	noTeam.Me = 99
	body := checkBody(t, 2, []string{"h001"}, []string{"h018"})
	if code, env := post(t, fixtureService(t, unsaved, f.data, &fakeHolds{}), leaguePath+"trades/check", body); code != http.StatusUnprocessableEntity || env.Error.Message != unsaved.SettingsNote {
		t.Fatalf("unsaved: %d %+v", code, env.Error)
	}
	if code, env := post(t, fixtureService(t, noTeam, f.data, &fakeHolds{}), leaguePath+"trades/check", body); code != http.StatusNotFound {
		t.Fatalf("no team: %d %+v", code, env.Error)
	}
}

// sameFigure is two optional figures both present and equal.
func sameFigure(a, b *float64) bool { return a != nil && b != nil && *a == *b }
