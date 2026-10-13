-- +goose Up
-- The live-draft companion (spec §2.7, Lane 8): a drafter's seat in a
-- draft running on another host, read from the host on every poll. The
-- host's picks are never stored here; the row keeps what the drafter
-- chose, what the host's draft settings mapped to, and how far the host
-- had got at the last read.
create table app.companions (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references app.accounts (id) on delete cascade,
  host           text not null check (host in ('sleeper')),
  host_draft_id  text not null check (host_draft_id ~ '^[0-9]{1,25}$'),
  -- A development replay of a recorded draft (COMPANION_REPLAY), never
  -- on in production.
  replay         boolean not null default false,
  -- The drafter's 1-based draft slot.
  seat           smallint not null check (seat between 1 and 32),
  -- The league settings the host's draft mapped to (LeagueSettings), and
  -- the host league it came from, if any.
  settings       jsonb not null,
  host_league_id text check (host_league_id ~ '^[0-9]{1,25}$'),
  status         text not null check (status in ('pre_draft', 'drafting', 'paused', 'complete')),
  last_host_pick integer not null default 0 check (last_host_pick >= 0),
  -- The finished draft's report, computed once.
  report         jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create unique index companions_account_draft_key on app.companions (account_id, host, host_draft_id, replay);
create index companions_account_idx on app.companions (account_id, created_at desc);
create trigger companions_touch before update on app.companions
  for each row execute function app.touch_updated_at();

-- The card the companion showed at each of the drafter's turns: our
-- call and every player's chance of lasting to the next turn, kept so
-- every viewer sees one card per pick and the report's hindsight says
-- what the companion said at the time.
create table app.companion_cards (
  companion_id uuid not null references app.companions (id) on delete cascade,
  pick_no      smallint not null check (pick_no >= 1),
  card         jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (companion_id, pick_no)
);

-- +goose Down
drop table app.companion_cards;
drop table app.companions;
