package boards

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// gameFactsSchema builds the tables the week facts read: the team-week
// observations with a kickoff, two hourly reads of the figures before it
// and one after, a forecast; and, with venues, the game table and the
// stadiums.
func gameFactsSchema(t *testing.T, pool *pgxpool.Pool, schema string, venues bool) {
	t.Helper()
	ctx := context.Background()
	qs := []string{
		`drop schema if exists ` + schema + ` cascade`,
		`create schema ` + schema,
		`create table ` + schema + `.team_week_observations (season int, week int, team text, source text, metric text, as_of timestamptz, value float8)`,
		`insert into ` + schema + `.team_week_observations values
			(2026, 7, 'LA', 'nflverse_kickoff', 'kickoff_instant', '2026-10-25 20:25:00+00', 1),
			(2026, 7, 'LA', 'tank01_lines', 'point_spread', '2026-10-20 13:00:00+00', 2.5),
			(2026, 7, 'LA', 'tank01_lines', 'game_total', '2026-10-20 13:00:00+00', 46.5),
			(2026, 7, 'LA', 'tank01_lines', 'point_spread', '2026-10-25 14:05:00+00', 3),
			(2026, 7, 'LA', 'tank01_lines', 'game_total', '2026-10-25 14:05:00+00', 47.5),
			(2026, 7, 'LA', 'tank01_lines', 'books', '2026-10-25 14:05:00+00', 8),
			(2026, 7, 'LA', 'tank01_lines', 'point_spread', '2026-10-25 21:00:00+00', 10),
			(2026, 7, 'LA', 'tank01_lines', 'game_total', '2026-10-25 21:00:00+00', 60),
			(2026, 7, 'LV', 'nflverse_kickoff', 'kickoff_instant', '2026-10-25 20:25:00+00', 1),
			(2026, 7, 'LV', 'tank01_lines', 'point_spread', '2026-10-25 14:05:00+00', -3),
			(2026, 7, 'LV', 'tank01_lines', 'game_total', '2026-10-25 14:05:00+00', 47.5),
			(2026, 7, 'SEA', 'nws_forecast', 'temperature_f', '2026-10-24 13:05:00+00', 51),
			(2026, 7, 'SEA', 'nws_forecast', 'wind_mph', '2026-10-24 13:05:00+00', 9.2),
			(2026, 7, 'SEA', 'nws_forecast', 'temperature_f', '2026-10-25 14:05:00+00', 49),
			(2026, 7, 'SEA', 'nws_forecast', 'wind_mph', '2026-10-25 14:05:00+00', 14.1),
			(2026, 7, 'SEA', 'nws_forecast', 'sky_cover_pct', '2026-10-25 14:05:00+00', 90),
			(2026, 7, 'SEA', 'nws_forecast', 'precipitation_kind', '2026-10-25 14:05:00+00', 3),
			(2026, 7, 'WAS', 'tank01_lines', 'point_spread', '2026-10-25 14:05:00+00', 1)`,
	}
	if venues {
		qs = append(qs,
			`create table `+schema+`.nflverse_games (season int, week int, home_team text, away_team text, stadium_id text, stadium text)`,
			`create table `+schema+`.stadiums (stadium_id text, aliases text[], roof_type text, international boolean)`,
			`insert into `+schema+`.stadiums values
				('VEG00', '{Allegiant Stadium}', 'dome', false), ('SEA00', '{CenturyLink Field,Lumen Field}', 'outdoors', false),
				('PAR00', '{Stade de France}', 'outdoors', true), ('JAX00', '{EverBank Stadium}', 'outdoors', false)`,
			`insert into `+schema+`.nflverse_games values
				(2026, 7, 'LV', 'LA', 'VEG00', 'Allegiant Stadium'), (2026, 7, 'SEA', 'KC', 'SEA00', 'Lumen Field'),
				(2026, 7, 'NO', 'PIT', 'PAR00', 'Stade de France'), (2026, 5, 'JAX', 'PHI', 'JAX00', 'Tottenham Hotspur Stadium')`)
	}
	for _, q := range qs {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
}

func TestGameFactsReadTheNewestBeforeKickoffWithTheVenue(t *testing.T) {
	pool := dbtest.Pool(t)
	const schema = "gamefacts_test"
	gameFactsSchema(t, pool, schema, true)
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	facts, err := src.GameFacts(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	read := time.Date(2026, 10, 25, 14, 5, 0, 0, time.UTC)
	rams := facts[ClubWeek{7, "LAR"}]
	if f := rams.Figures; f == nil || f.Total != 47.5 || f.Spread != 3 || !f.ReadAt.Equal(read) {
		t.Fatalf("the Rams' figures %+v: the newest read before kickoff, never the one after", rams.Figures)
	}
	if v := rams.Venue; v == nil || v.Roof != RoofDome || v.Abroad {
		t.Fatalf("the Rams' venue %+v: the away club takes the home venue", rams.Venue)
	}
	if f := facts[ClubWeek{7, "LV"}].Figures; f == nil || f.Spread != -3 {
		t.Fatalf("Las Vegas's figures %+v", f)
	}
	sea := facts[ClubWeek{7, "SEA"}]
	if w := sea.Forecast; w == nil || *w.TemperatureF != 49 || *w.WindMph != 14.1 || w.PrecipitationChance != nil || w.PrecipitationKind == nil || *w.PrecipitationKind != "snow" || !w.ReadAt.Equal(read) {
		t.Fatalf("Seattle's forecast %+v: one read's values, a chance it did not hold left nil", sea.Forecast)
	}
	if sea.Figures != nil || sea.Venue == nil || sea.Venue.Roof != RoofOutdoors {
		t.Fatalf("Seattle %+v", sea)
	}
	if facts[ClubWeek{7, "WSH"}].Figures != nil {
		t.Fatalf("a read with a spread and no total is no figures: %+v", facts[ClubWeek{7, "WSH"}].Figures)
	}
	if v := facts[ClubWeek{7, "PIT"}].Venue; v == nil || !v.Abroad {
		t.Fatalf("Pittsburgh in Paris %+v", v)
	}
	if v, ok := facts[ClubWeek{5, "JAX"}]; ok && v.Venue != nil {
		t.Fatalf("a game filed under a venue it was not played at has no venue: %+v", v.Venue)
	}
}

func TestGameFactsWithoutTheVenueTablesCarryNoRoof(t *testing.T) {
	pool := dbtest.Pool(t)
	const schema = "gamefacts_novenue_test"
	gameFactsSchema(t, pool, schema, false)
	src, err := NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	facts, err := src.GameFacts(context.Background(), 2026)
	if err != nil {
		t.Fatal(err)
	}
	if rams := facts[ClubWeek{7, "LAR"}]; rams.Figures == nil || rams.Venue != nil {
		t.Fatalf("the Rams %+v: figures still read, no venue", rams)
	}
}
