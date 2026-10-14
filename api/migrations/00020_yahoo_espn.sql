-- +goose Up
-- Lane 21: Yahoo and ESPN league sync through the machinery FFPC built.
-- A Yahoo connection keeps the OAuth tokens Yahoo handed back (the access
-- token and its expiry as the session, the refresh token as the renewal);
-- an ESPN connection keeps the member's two ESPN cookies as the session
-- and no renewal. Both sit in app.host_connections under the same
-- envelope encryption, opened only by the league reader.

alter table app.host_connections drop constraint host_connections_host_check;
alter table app.host_connections add constraint host_connections_host_check check (host in ('ffpc', 'yahoo', 'espn'));
alter table app.host_connect_refusals drop constraint host_connect_refusals_host_check;
alter table app.host_connect_refusals add constraint host_connect_refusals_host_check check (host in ('ffpc', 'yahoo', 'espn'));
alter table app.host_request_gate drop constraint host_request_gate_host_check;
alter table app.host_request_gate add constraint host_request_gate_host_check check (host in ('ffpc', 'yahoo', 'espn'));
insert into app.host_request_gate (host) values ('yahoo'), ('espn');

alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl', 'ffpc', 'yahoo', 'espn'));
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl', 'ffpc', 'yahoo', 'espn'));

-- One Yahoo sign-in in flight: the state the authorize address carries,
-- bound to the account that asked, ten minutes, one use. Only the state's
-- sha256 is kept, so a read of this table cannot finish anyone's sign-in;
-- the PKCE verifier is useless without the code Yahoo hands the member.
create table app.host_oauth_states (
  state_hash bytea primary key check (octet_length(state_hash) = 32),
  account_id uuid not null references app.accounts (id) on delete cascade,
  host       text not null check (host in ('yahoo')),
  verifier   text not null check (verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index host_oauth_states_account_idx on app.host_oauth_states (account_id, created_at desc);
create index host_oauth_states_expires_idx on app.host_oauth_states (expires_at);

-- +goose Down
drop table app.host_oauth_states;
delete from app.league_snapshots where host in ('yahoo', 'espn');
alter table app.league_snapshots drop constraint league_snapshots_host_check;
alter table app.league_snapshots add constraint league_snapshots_host_check check (host in ('sleeper', 'mfl', 'ffpc'));
delete from app.league_links where host in ('yahoo', 'espn');
alter table app.league_links drop constraint league_links_host_check;
alter table app.league_links add constraint league_links_host_check check (host in ('sleeper', 'mfl', 'ffpc'));
delete from app.host_request_gate where host in ('yahoo', 'espn');
alter table app.host_request_gate drop constraint host_request_gate_host_check;
alter table app.host_request_gate add constraint host_request_gate_host_check check (host in ('ffpc'));
delete from app.host_connect_refusals where host in ('yahoo', 'espn');
alter table app.host_connect_refusals drop constraint host_connect_refusals_host_check;
alter table app.host_connect_refusals add constraint host_connect_refusals_host_check check (host in ('ffpc'));
delete from app.host_connections where host in ('yahoo', 'espn');
alter table app.host_connections drop constraint host_connections_host_check;
alter table app.host_connections add constraint host_connections_host_check check (host in ('ffpc'));
