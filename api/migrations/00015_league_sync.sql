-- +goose Up
-- League sync (spec §2.9, Lane 11): a drafter's own league on another
-- host, attached to their account and to the saved league settings a
-- mock reruns from. Several members of one league each attach it and
-- each sees their own seat; the host is read once for all of them.
create table app.league_links (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references app.accounts (id) on delete cascade,
  -- The saved league (app.leagues) made from the league's roster and
  -- scoring, null when a mock room cannot draft its shape.
  league_id      uuid references app.leagues (id) on delete set null,
  host           text not null check (host in ('sleeper', 'mfl')),
  host_league_id text not null check (host_league_id ~ '^[0-9]{1,25}$'),
  -- The league's season on a host whose ids outlive a season
  -- (MyFantasyLeague), 0 on Sleeper.
  host_season    smallint not null check (host_season = 0 or host_season between 2000 and 2100),
  -- The drafter's team in the league, by the host's roster id.
  roster_id      smallint not null check (roster_id between 1 and 32),
  attached_at    timestamptz not null default now(),
  last_read_at   timestamptz
);
create unique index league_links_account_league_key on app.league_links (account_id, host, host_league_id, host_season);
create index league_links_account_idx on app.league_links (account_id, attached_at desc);

-- The last good read of each host league, whole, so a restart or a host
-- outage answers what was last seen with how old it is. One row per
-- host league whatever the number of members attached.
create table app.league_snapshots (
  host           text not null check (host in ('sleeper', 'mfl')),
  host_league_id text not null check (host_league_id ~ '^[0-9]{1,25}$'),
  host_season    smallint not null,
  snapshot       jsonb not null,
  read_at        timestamptz not null,
  primary key (host, host_league_id, host_season)
);

-- Each host's player directory, read at most once a day, so a host's
-- player ids name players and land on our board.
create table app.host_players (
  host      text not null check (host in ('sleeper', 'mfl')),
  player_id text not null check (player_id ~ '^[A-Za-z0-9_]{1,16}$'),
  name      text not null check (char_length(name) between 1 and 80),
  position  text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  team      text not null default '' check (char_length(team) <= 40),
  espn_id   text check (espn_id ~ '^[0-9]{1,12}$'),
  read_at   timestamptz not null,
  primary key (host, player_id)
);

-- The in-season tier's features (spec §2.9), granted by the Membership.
-- Data only: no screen is gated on them until their tools ship.
insert into app.product_features (product, feature) values
  ('membership', 'start_sit'),
  ('membership', 'waiver_ranks'),
  ('membership', 'trade_finder');

-- +goose Down
delete from app.product_features where feature in ('start_sit', 'waiver_ranks', 'trade_finder');
drop table app.host_players;
drop table app.league_snapshots;
drop table app.league_links;
