-- +goose Up
-- Migrations are forward only: a mistake is fixed by the next file.
-- Accounts and sessions. The app schema itself is created by db.Migrate
-- before goose runs, because goose keeps its version table in it.

-- +goose StatementBegin
create function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
-- +goose StatementEnd

create table app.accounts (
  id             uuid primary key default gen_random_uuid(),
  workos_user_id text not null unique,
  email          text not null,
  first_name     text,
  last_name      text,
  -- The public name in lobbies. internal/names is the rule; this check
  -- is the guard that keeps a bad write out even if a caller skips it.
  handle         text check (handle is null or handle ~ '^[A-Za-z_][A-Za-z0-9_]{2,19}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index accounts_handle_key on app.accounts (lower(handle)) where handle is not null;
create index accounts_email_idx on app.accounts (lower(email));
create trigger accounts_touch before update on app.accounts
  for each row execute function app.touch_updated_at();

-- One row per signed-in browser. The cookie carries a sealed random
-- token; only its sha256 is stored, so a read of this table cannot be
-- replayed as a session.
create table app.sessions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references app.accounts (id) on delete cascade,
  token_hash        bytea not null unique,
  workos_session_id text,
  user_agent        text,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  expires_at        timestamptz not null
);
create index sessions_account_idx on app.sessions (account_id);
create index sessions_expires_idx on app.sessions (expires_at);
