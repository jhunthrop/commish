-- +goose Up
-- Lane 93 (ruling 1b): ESPN's own projection for every player rostered in
-- an attached ESPN league, read before the register sets the week's order,
-- and his points once the week is played, both in the league's scoring.
-- One read of a league asks for a scoring period and carries that period
-- and the one before it (read_period says which was asked); a player's row
-- names the team and slot he held at the read. Append-only: each read is
-- its own read_at, never an update. The league record grades our order's
-- lineup against ESPN's projected lineup from them (internal/leaguerecord).
-- Retention: a season's rows are kept through the season after it (the
-- record compares like with like a year on), then deleted by hand with the
-- season's other league reads; nothing here ties a row to an account.
create table app.espn_week_reads (
  league_id   text not null check (league_id ~ '^[0-9]{1,12}$'),
  season      int not null check (season between 2000 and 2100),
  week        int not null check (week between 1 and 25),
  read_at     timestamptz not null,
  read_period int not null check (read_period between 1 and 25),
  player_id   text not null check (length(player_id) between 1 and 16),
  team_id     int not null,
  slot        int not null,
  position    text not null,
  pro_team    text not null,
  status      text not null,
  projected   double precision,
  actual      double precision,
  primary key (league_id, season, week, read_at, player_id)
);

-- +goose Down
drop table app.espn_week_reads;
