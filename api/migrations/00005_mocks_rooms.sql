-- +goose Up
-- Mocks, rooms and the lobby pick log (docs/design/2026-10-12-mock-room-rethink.md).
-- The engine lane writes the actions; this lane owns the shape. Both
-- logs keep the semantics of the league platform's draft_actions: one
-- row per action, seq from 1 with no gaps, state rebuilt by replay.

-- A solo mock is a function of its settings, its seed and the human's
-- picks, so the seed is stored and the bots replay byte for byte.
create table app.mocks (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references app.accounts (id) on delete cascade,
  league_id    uuid references app.leagues (id) on delete set null,
  settings     jsonb not null,
  seed         bigint not null check (seed between 0 and 4294967295),
  status       text not null default 'active' check (status in ('active', 'complete')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index mocks_account_idx on app.mocks (account_id, created_at desc);
create trigger mocks_touch before update on app.mocks
  for each row execute function app.touch_updated_at();

create table app.mock_actions (
  mock_id uuid not null references app.mocks (id) on delete cascade,
  seq     bigint not null check (seq >= 1),
  kind    text not null,
  payload jsonb not null default '{}',
  at      timestamptz not null default now(),
  primary key (mock_id, seq)
);

-- A lobby with people. queue is the format the drafter queued for
-- (12 PPR, 12 half PPR superflex, 10 PPR). owner_instance and
-- lease_until are the room process's claim: a sweep adopts a room whose
-- lease lapsed because its instance died.
create table app.rooms (
  id             uuid primary key default gen_random_uuid(),
  queue          text not null,
  settings       jsonb not null,
  seed           bigint not null check (seed between 0 and 4294967295),
  clock_seconds  smallint not null check (clock_seconds between 10 and 300),
  status         text not null default 'filling' check (status in ('filling', 'drafting', 'complete', 'abandoned')),
  owner_instance text,
  lease_until    timestamptz,
  fill_deadline  timestamptz,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create index rooms_filling_idx on app.rooms (queue, created_at) where status = 'filling';
create index rooms_lease_idx on app.rooms (lease_until) where status in ('filling', 'drafting');
create trigger rooms_touch before update on app.rooms
  for each row execute function app.touch_updated_at();

-- Who sits where. A drafter who leaves is replaced by a bot in the same
-- seat: left_at is stamped and is_bot set, the handle kept for the log.
create table app.room_seats (
  room_id    uuid not null references app.rooms (id) on delete cascade,
  seat       smallint not null check (seat >= 1),
  account_id uuid references app.accounts (id) on delete set null,
  handle     text,
  is_bot     boolean not null default false,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  primary key (room_id, seat)
);
create unique index room_seats_account_key on app.room_seats (room_id, account_id) where account_id is not null;
create index room_seats_account_idx on app.room_seats (account_id) where account_id is not null;

create table app.room_actions (
  room_id uuid not null references app.rooms (id) on delete cascade,
  seq     bigint not null check (seq >= 1),
  kind    text not null,
  seat    smallint,
  payload jsonb not null default '{}',
  at      timestamptz not null default now(),
  primary key (room_id, seq)
);

-- Every pick made in a lobby, flattened for the nightly job: the start
-- of our own ADP and a public check on the bots. by_bot separates a
-- drafter's pick from a bot's, so the ADP reads only people.
create table app.lobby_picks (
  room_id    uuid not null references app.rooms (id) on delete cascade,
  pick_no    smallint not null check (pick_no >= 1),
  round      smallint not null check (round >= 1),
  seat       smallint not null check (seat >= 1),
  player_id  text not null,
  account_id uuid references app.accounts (id) on delete set null,
  by_bot     boolean not null,
  queue      text not null,
  scoring    text not null,
  teams      smallint not null,
  picked_at  timestamptz not null,
  primary key (room_id, pick_no)
);
create index lobby_picks_player_idx on app.lobby_picks (player_id, picked_at);
create index lobby_picks_picked_idx on app.lobby_picks (picked_at);
