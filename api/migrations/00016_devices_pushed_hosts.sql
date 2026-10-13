-- +goose Up
-- The browser extension (Lane 14): a paired device sends the pages of a
-- host the member already has open in their own browser (FFPC first),
-- never a login. A device carries a bearer token minted at pairing; only
-- its sha256 is stored, so a read of this table cannot be replayed.
create table app.devices (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references app.accounts (id) on delete cascade,
  -- What the member's browser called itself at pairing, cleaned.
  name         text not null check (char_length(name) between 1 and 60),
  token_hash   bytea not null unique check (octet_length(token_hash) = 32),
  scopes       text[] not null check (scopes <@ array['league:write', 'draft:write']::text[] and cardinality(scopes) >= 1),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index devices_account_idx on app.devices (account_id, created_at desc) where revoked_at is null;

-- The one-time pairing code an account page shows: six words, ten
-- minutes, one use. One live code per account; a new one replaces it.
create table app.device_pair_codes (
  account_id uuid primary key references app.accounts (id) on delete cascade,
  code_hash  bytea not null unique check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- FFPC is a pushed host: its league pages arrive from the member's own
-- browser through the extension instead of a host read.
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl', 'ffpc'));
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl', 'ffpc'));

-- A pushed league's pages as one snapshot per attachment, never shared
-- between members: what one member's browser sends is shown to that
-- member only. pages_read_at is when each page family last arrived.
create table app.pushed_snapshots (
  link_id       uuid primary key references app.league_links (id) on delete cascade,
  snapshot      jsonb not null,
  pages_read_at jsonb not null default '{}',
  read_at       timestamptz not null
);

-- A pushed companion: the draft's settings and picks as the member's
-- browser last read the draft room, and when.
alter table app.companions drop constraint companions_host_check;
alter table app.companions add constraint companions_host_check check (host in ('sleeper', 'ffpc'));
alter table app.companions add column pushed jsonb;
alter table app.companions add column pushed_at timestamptz;

-- +goose Down
alter table app.companions drop column pushed_at;
alter table app.companions drop column pushed;
alter table app.companions drop constraint companions_host_check;
alter table app.companions add constraint companions_host_check check (host in ('sleeper'));
drop table app.pushed_snapshots;
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl'));
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl'));
drop table app.device_pair_codes;
drop table app.devices;
