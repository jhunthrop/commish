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

-- A member's account on a host we read as them (FFPC). Two ciphertexts
-- under one random data key: the session FFPC handed back (opened for
-- every read) and the sign-in itself (opened only to renew a session,
-- because FFPC offers no other way). The data key is wrapped under
-- HOST_CREDENTIALS_KEY (version key_version) from Secret Manager. Nothing
-- here is readable without that key. Disconnecting deletes the row.
create table app.host_connections (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references app.accounts (id) on delete cascade,
  host            text not null check (host in ('ffpc')),
  wrapped_key     bytea not null check (octet_length(wrapped_key) between 40 and 128),
  session_ct      bytea not null check (octet_length(session_ct) between 16 and 16384),
  signin_ct       bytea not null check (octet_length(signin_ct) between 16 and 4096),
  key_version     smallint not null check (key_version >= 1),
  -- connected: reads work. signed_out: FFPC no longer honors the session
  -- and the one kept sign-in allowed did not mend it (or was refused, or
  -- met a page we do not know); nothing is tried until the member signs in
  -- on our form again.
  status          text not null default 'connected' check (status in ('connected', 'signed_out')),
  -- The last kept sign-in tried for this member: at most one a six hours.
  last_signin_at  timestamptz,
  -- When the member agreed, and to which words (hosts.ConsentVersion).
  consented_at    timestamptz not null,
  consent_version smallint not null check (consent_version >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_read_at    timestamptz,
  unique (account_id, host)
);
create trigger host_connections_touch before update on app.host_connections
  for each row execute function app.touch_updated_at();

-- Each sign-in on our form the host refused, so three in an hour pause
-- connecting for that account across restarts and instances.
create table app.host_connect_refusals (
  account_id uuid not null references app.accounts (id) on delete cascade,
  host       text not null check (host in ('ffpc')),
  at         timestamptz not null default now()
);
create index host_connect_refusals_idx on app.host_connect_refusals (account_id, host, at desc);

-- One request a gap to a host across every process: each request takes
-- the next slot (next_at) in one statement, so the api's instances and the
-- refresh job share one pace.
create table app.host_request_gate (
  host    text primary key check (host in ('ffpc')),
  next_at timestamptz not null default now()
);
insert into app.host_request_gate (host) values ('ffpc');

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
delete from app.companions where host = 'ffpc';
alter table app.companions drop constraint companions_ffpc_key;
alter table app.companions drop column host_team_key;
alter table app.companions drop constraint companions_host_check;
alter table app.companions add constraint companions_host_check check (host in ('sleeper'));
delete from app.league_snapshots where host = 'ffpc';
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl'));
delete from app.league_links where host = 'ffpc';
alter table app.league_links drop constraint league_links_ffpc_key;
alter table app.league_links drop column host_team_key;
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl'));
drop table app.host_request_gate;
drop table app.host_connect_refusals;
drop table app.host_connections;
drop table app.device_pair_codes;
drop table app.devices;
