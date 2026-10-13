-- +goose Up
-- Sheet exports written to the private R2 bucket. The object outlives
-- nothing: expires_at matches the bucket's lifecycle rule, and a read
-- past it answers 404.
create table app.exports (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  sheet_id   uuid references app.sheets (id) on delete set null,
  format     text not null check (format in ('csv')),
  object_key text not null unique,
  file_name  text not null,
  bytes      bigint not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index exports_account_idx on app.exports (account_id, created_at desc);
