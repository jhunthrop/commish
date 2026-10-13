-- +goose Up
-- Lane 14. Two things: paired devices (the bearer path, spec §2.8, for
-- the extension and the phone app later) and connected host accounts
-- (FFPC read server side as the member, founder ruling 2026-10-13).

-- A paired device carries a bearer token minted at pairing; only its
-- sha256 is stored, so a read of this table cannot be replayed.
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

-- A member's account on a host we read as them (FFPC). What the host
-- handed back at sign-in, and the sign-in itself because FFPC offers no
-- other way to renew a session, are envelope encrypted (internal/hosts):
-- ciphertext under a random data key, the data key wrapped under
-- HOST_CREDENTIALS_KEY from Secret Manager. Nothing here is readable
-- without that key. Disconnecting deletes the row.
create table app.host_connections (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references app.accounts (id) on delete cascade,
  host           text not null check (host in ('ffpc')),
  wrapped_key    bytea not null check (octet_length(wrapped_key) between 40 and 128),
  ciphertext     bytea not null check (octet_length(ciphertext) between 16 and 16384),
  key_version    smallint not null check (key_version >= 1),
  -- connected: reads work. signed_out: FFPC refused the kept sign-in
  -- once; the member signs in again. locked: three refusals in a row; no
  -- more sign-ins are tried until the member connects again.
  status         text not null default 'connected' check (status in ('connected', 'signed_out', 'locked')),
  failed_signins smallint not null default 0 check (failed_signins between 0 and 3),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_read_at   timestamptz,
  unique (account_id, host)
);
create trigger host_connections_touch before update on app.host_connections
  for each row execute function app.touch_updated_at();

-- FFPC leagues attach like the others; their member's own league-team id
-- (FFPC's ltuid, the key every league page's address takes) rides on the
-- link. FFPC league ids keep across seasons, so the season is in the key.
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl', 'ffpc'));
alter table app.league_links add column host_team_key text check (host_team_key ~ '^[0-9A-F]{3}-[0-9A-F]{12}$');
alter table app.league_links add constraint league_links_ffpc_key check (host <> 'ffpc' or host_team_key is not null);
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl', 'ffpc'));

-- An FFPC draft is followed through the same connection: the league id
-- names the draft, the league-team id the page.
alter table app.companions drop constraint companions_host_check;
alter table app.companions add constraint companions_host_check check (host in ('sleeper', 'ffpc'));
alter table app.companions add column host_team_key text check (host_team_key ~ '^[0-9A-F]{3}-[0-9A-F]{12}$');
alter table app.companions add constraint companions_ffpc_key check (host <> 'ffpc' or host_team_key is not null);

-- +goose Down
alter table app.companions drop constraint companions_ffpc_key;
alter table app.companions drop column host_team_key;
alter table app.companions drop constraint companions_host_check;
alter table app.companions add constraint companions_host_check check (host in ('sleeper'));
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl'));
alter table app.league_links drop constraint league_links_ffpc_key;
alter table app.league_links drop column host_team_key;
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl'));
drop table app.host_connections;
drop table app.device_pair_codes;
drop table app.devices;
