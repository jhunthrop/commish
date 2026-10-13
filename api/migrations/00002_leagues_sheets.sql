-- +goose Up
-- Saved leagues and sheets.

-- A saved league is the setup screen saved under a name, so a rerun is
-- one tap. settings is the API's LeagueSettings, validated by
-- internal/leagues before it is written; settings_version lets the
-- shape change later with a data migration instead of a guess.
create table app.leagues (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references app.accounts (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 60),
  settings         jsonb not null,
  settings_version smallint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index leagues_account_idx on app.leagues (account_id, updated_at desc);
create trigger leagues_touch before update on app.leagues
  for each row execute function app.touch_updated_at();

create table app.sheets (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  format     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sheets_account_idx on app.sheets (account_id, updated_at desc);
create trigger sheets_touch before update on app.sheets
  for each row execute function app.touch_updated_at();

-- name, position and team are the player as the drafter saw him when
-- the row was added, so an export reads without a join into the
-- research schema, which this lane never touches.
create table app.sheet_rows (
  sheet_id  uuid not null references app.sheets (id) on delete cascade,
  player_id text not null check (char_length(player_id) between 1 and 64),
  rank      integer not null check (rank >= 1),
  name      text not null check (char_length(name) between 1 and 80),
  position  text not null check (char_length(position) between 1 and 8),
  team      text check (char_length(team) <= 8),
  tier      smallint check (tier between 1 and 50),
  tag       text,
  note      text check (char_length(note) <= 500),
  primary key (sheet_id, player_id),
  constraint sheet_rows_rank_key unique (sheet_id, rank) deferrable initially deferred
);
