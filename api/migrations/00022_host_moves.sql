-- +goose Up
-- Lane 35: the first move on a host, an ESPN lineup set the member
-- confirms on our screen (spec 2026-10-15 §10.2).
--
-- The accounts allowed a host's move while its switch
-- (HOST_WRITES_ESPN_LINEUP) is off for everyone else: the proof move is
-- made from the founder's account alone. A row is written by hand, one
-- shot, never by the api.
create table app.host_write_accounts (
  account_id uuid not null references app.accounts (id) on delete cascade,
  host       text not null check (host in ('espn')),
  kind       text not null check (kind in ('lineup')),
  allowed_at timestamptz not null default now(),
  primary key (account_id, host, kind)
);

-- Every move sent, or tried, as its proof: what the member confirmed (the
-- plan in words and items), the body sent with no cookie in it, the
-- host's status and answer (bounded), what the answer came to and the
-- read-back. The confirm token's digest is unique, so one confirmation
-- makes one move. Never a cookie, never a SWID.
create table app.host_moves (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references app.accounts (id) on delete cascade,
  -- The attached league; kept when the link goes, so the proof outlives it.
  link_id        uuid references app.league_links (id) on delete set null,
  host           text not null check (host in ('espn')),
  host_league_id text not null check (host_league_id ~ '^[0-9]{1,25}$'),
  host_season    smallint not null check (host_season between 2000 and 2100),
  kind           text not null check (kind in ('lineup')),
  week           smallint not null check (week between 1 and 25),
  confirm_digest bytea not null unique check (octet_length(confirm_digest) = 32),
  plan           jsonb not null,
  request_body   jsonb,
  -- sending: written before the request leaves; not_sent: it never left.
  outcome        text not null default 'sending'
                 check (outcome in ('sending', 'not_sent', 'done', 'refused', 'pending')),
  host_status    smallint,
  host_body      text check (octet_length(host_body) <= 8192),
  host_reason    text check (char_length(host_reason) <= 64),
  host_words     text check (char_length(host_words) <= 300),
  -- matched: the host's state read back holds the move; not_matched: it
  -- does not; not_read: the read-back failed or was not made.
  read_back      text check (read_back in ('matched', 'not_matched', 'not_read')),
  created_at     timestamptz not null default now(),
  answered_at    timestamptz
);
create index host_moves_account_link_idx on app.host_moves (account_id, link_id, created_at desc);

-- +goose Down
drop table app.host_moves;
drop table app.host_write_accounts;
