-- +goose Up
-- Lane 67 review (security M1): every MyFantasyLeague sign-in our connect
-- form sends, across all accounts, so the hour's attempts are capped for
-- the whole site and refusals are counted per username. The username is
-- kept only as a keyed hash of its lowercased form, never as text. Rows
-- older than a day are trimmed on insert.
create table app.host_login_attempts (
  id           bigint generated always as identity primary key,
  host         text not null check (host in ('mfl')),
  username_key bytea not null check (octet_length(username_key) = 32),
  refused      boolean not null default false,
  at           timestamptz not null default now()
);
create index host_login_attempts_host_at_idx on app.host_login_attempts (host, at);
create index host_login_attempts_key_idx on app.host_login_attempts (host, username_key, at);

-- +goose Down
drop table app.host_login_attempts;
