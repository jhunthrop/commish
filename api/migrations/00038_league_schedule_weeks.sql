-- +goose Up
-- Lane 298 (B292): the season's schedule, week by week, for the hosts whose
-- league read carries none (Sleeper, Yahoo, MyFantasyLeague): each week's
-- games with both sides' points once the host has scored it, so playoff
-- chance and points against the median read every week without asking the
-- host for each played week again. One row per league read (shared, or one
-- account's member read) and week. A read of a week replaces its row in one
-- transaction (a score the host corrects replaces the old one); a failed
-- read writes nothing. Rows are kept only for a league an account has
-- linked. Additive: nothing reads it until this lane's API ships.
create table app.league_schedule_weeks (
  host           text not null check (host in ('sleeper', 'mfl', 'yahoo')),
  host_league_id text not null check (host_league_id ~ '^[0-9]{1,25}$'),
  host_season    smallint not null,
  read_as        uuid not null default '00000000-0000-0000-0000-000000000000',
  week           smallint not null check (week between 1 and 25),
  games          jsonb not null check (jsonb_typeof(games) = 'array'),
  final          boolean not null,
  read_at        timestamptz not null,
  primary key (host, host_league_id, host_season, read_as, week)
);

-- +goose Down
drop table app.league_schedule_weeks;
