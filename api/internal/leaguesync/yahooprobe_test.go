package leaguesync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
)

// probeAPI serves the probe's recorded shapes (testdata/yahoo-probe) to the
// kept token, and answers the ranks read with refuseRanks when it is set.
func probeAPI(t *testing.T, refuseRanks int) (*yahoo.Client, *[]string) {
	t.Helper()
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join("testdata", "yahoo-probe", name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	var mu sync.Mutex
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		asked = append(asked, r.URL.Path)
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer probe-access" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		p := r.URL.Path
		switch {
		case strings.Contains(p, "games;game_codes=nfl"):
			_, _ = w.Write(yahooReaderFixture(t, "yahoo-games-2026.xml"))
		case strings.HasSuffix(p, "/scoreboard"):
			_, _ = w.Write(read("scoreboard.xml"))
		case strings.Contains(p, ";out=ranks,percent_owned") && refuseRanks != 0:
			w.WriteHeader(refuseRanks)
		case strings.Contains(p, ";out=ranks,percent_owned"):
			_, _ = w.Write(read("players-ranks.xml"))
		case strings.Contains(p, "/stats;type=week;week=7"):
			_, _ = w.Write(read("players-stats-week.xml"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	c := yahoo.New()
	c.Base = srv.URL
	c.Pace = yahoo.LocalPace(time.Microsecond)
	return c, &asked
}

// yahooReaderFixture reads one of the Yahoo reader's own fixtures.
func yahooReaderFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "hosts", "yahoo", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// probeLeague attaches the fixture league for a connected member, beside
// leagues the probe must pass over, and answers the member reader.
func probeLeague(t *testing.T, client *yahoo.Client, now time.Time) (*Store, *yahoo.Member) {
	t.Helper()
	pool := dbtest.Pool(t)
	ctx := context.Background()
	ids := map[string]uuid.UUID{}
	for _, name := range []string{"lane130_member", "lane130_unconnected", "lane130_signedout"} {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `insert into app.accounts (workos_user_id, email) values ($1, $1 || '@example.invalid') returning id`,
			name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids[name] = id
	}
	vault, err := hosts.NewVault(hosts.OneKey(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	conns := &hosts.Store{Pool: pool}
	for _, name := range []string{"lane130_member", "lane130_signedout"} {
		sealed, err := yahoo.Seal(vault, ids[name], yahoo.Tokens{Access: "probe-access", Refresh: "r", Expiry: now.Add(time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conns.Put(ctx, ids[name], yahoo.Host, sealed, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := conns.SignedOut(ctx, ids["lane130_signedout"], yahoo.Host); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into app.league_links (account_id, host, host_league_id, host_season, roster_id, read_as_member, detached_at)
		values ($1, 'yahoo', '128934', 2026, 1, true, null), ($2, 'yahoo', '200', 2026, 1, true, null),
		       ($3, 'yahoo', '300', 2026, 1, true, null), ($1, 'yahoo', '400', 2026, 1, true, now()),
		       ($1, 'yahoo', '500', 2025, 1, true, null), ($1, 'espn', '600', 2026, 1, true, null)`,
		ids["lane130_member"], ids["lane130_unconnected"], ids["lane130_signedout"]); err != nil {
		t.Fatal(err)
	}
	m := &yahoo.Member{Client: client, Store: conns, Vault: vault, Now: func() time.Time { return now }, Log: quietLog()}
	return &Store{Pool: pool}, m
}

// The probe reads the attached league as its connected member through the
// sync client: the week's scoreboard, the players with their ranks and
// percent owned, and those players' stats for the week Yahoo named. Its
// record is the answers' shapes: every field, one example row with member
// data blanked, and the rank types, seasons, weeks and coverage seen.
func TestYahooProbeRecordsTheShapes(t *testing.T) {
	now := time.Date(2026, 10, 22, 17, 30, 0, 0, time.UTC)
	client, asked := probeAPI(t, 0)
	store, member := probeLeague(t, client, now)
	ctx := context.Background()

	refs, err := store.YahooMemberLeagues(ctx, 2026)
	if err != nil || len(refs) != 1 || refs[0].LeagueID != "128934" || refs[0].As == uuid.Nil || refs[0].Season != 2026 {
		t.Fatalf("the leagues a probe may read: %+v %v", refs, err)
	}
	got, err := ProbeYahoo(ctx, store, member, 2026, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Probe != YahooProbeName || got.Week != 7 || got.Season != 2026 || len(got.Answers) != 3 {
		t.Fatalf("the record: %+v", got)
	}
	if want := "/league/470.l.128934/players;player_keys=470.p.30977,470.p.33536/stats;type=week;week=7"; !slices.Contains(*asked, want) {
		t.Fatalf("the week's stats were not asked for the ranked players: %v", *asked)
	}
	board, ranks, stats := got.Answers[0], got.Answers[1], got.Answers[2]
	if board.Name != yahoo.ProbeScoreboard || board.Path != "league/{league_key}/scoreboard" || board.Rows != 2 || board.Error != "" {
		t.Fatalf("the scoreboard: %+v", board)
	}
	if !slices.Equal(board.RankOrProjection, []string{
		"league/scoreboard/matchups/matchup/teams/team/team_projected_points/coverage_type",
		"league/scoreboard/matchups/matchup/teams/team/team_projected_points/total",
		"league/scoreboard/matchups/matchup/teams/team/team_projected_points/week",
	}) {
		t.Fatalf("the scoreboard's projection fields: %v", board.RankOrProjection)
	}
	if v := board.Example["league/scoreboard/matchups/matchup/teams/team/team_projected_points/total"]; v != "112.40" {
		t.Fatalf("the team's projected points: %q", v)
	}

	if ranks.Rows != 2 || !slices.Contains(ranks.Fields, "league/players/player/player_ranks/player_rank/rank_value") {
		t.Fatalf("the ranks: %+v", ranks)
	}
	if v := ranks.Values["league/players/player/player_ranks/player_rank/rank_type"]; !slices.Equal(v, []string{"OR", "S"}) {
		t.Fatalf("the rank types: %v", v)
	}
	if v := ranks.Values["league/players/player/player_ranks/player_rank/rank_season"]; !slices.Equal(v, []string{"2025"}) {
		t.Fatalf("the rank seasons: %v", v)
	}
	if v := ranks.Values["league/players/player/percent_owned/coverage_type"]; !slices.Equal(v, []string{"week"}) {
		t.Fatalf("percent owned's coverage: %v", v)
	}
	if ranks.Example["league/players/player/player_key"] != "470.p.30977" || ranks.Example["league/players/player/name/full"] != "" {
		t.Fatalf("the example row keeps the player key and blanks the name: %v", ranks.Example)
	}

	if v := stats.Values["league/players/player/player_points/coverage_type"]; !slices.Equal(v, []string{"week"}) || len(stats.RankOrProjection) != 0 {
		t.Fatalf("the week's stats: %v, rank or projection %v", v, stats.RankOrProjection)
	}

	// Nothing of a member, a team or the league is in the record.
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"Justin", "Maya", "GUID0001", "member@example.invalid", "Gridiron Gurus", "128934", "logo-1", "Josh Allen", "headshot-30977"} {
		if strings.Contains(string(b), private) {
			t.Fatalf("the record carries %q: %s", private, b)
		}
	}
}

// An answer Yahoo refuses is kept as its error and the probe reads on; the
// week's stats are not asked without player keys to ask them for.
func TestYahooProbeKeepsARefusedAnswer(t *testing.T) {
	now := time.Date(2026, 10, 22, 17, 30, 0, 0, time.UTC)
	client, _ := probeAPI(t, http.StatusBadRequest)
	store, member := probeLeague(t, client, now)
	got, err := ProbeYahoo(context.Background(), store, member, 2026, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Answers) != 3 || got.Answers[0].Error != "" || !strings.Contains(got.Answers[1].Error, "status 400") ||
		!strings.Contains(got.Answers[2].Error, "no player keys") {
		t.Fatalf("answers %+v", got.Answers)
	}
}

// With no connected member's league the probe says so.
func TestYahooProbeNeedsAConnectedMember(t *testing.T) {
	now := time.Date(2026, 10, 22, 17, 30, 0, 0, time.UTC)
	client, _ := probeAPI(t, 0)
	store, member := probeLeague(t, client, now)
	if _, err := ProbeYahoo(context.Background(), store, member, 2024, now); err == nil || !strings.Contains(err.Error(), "no Yahoo league of 2024") {
		t.Fatalf("a season with no attached league: %v", err)
	}
}
