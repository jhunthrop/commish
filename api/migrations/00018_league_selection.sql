-- +goose Up
-- Founder ruling 2026-10-13: the league is the site's context. One
-- selection per account: a followed league, or a format with no league.
-- No row means no choice was made, and the newest followed league is the
-- context. A selection of a detached league reads as no choice.
create table app.league_selections (
  account_id uuid primary key references app.accounts (id) on delete cascade,
  link_id    uuid references app.league_links (id) on delete cascade,
  format     text check (format in ('ppr', 'half_ppr', 'standard')),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(link_id, format) = 1)
);

-- +goose Down
drop table app.league_selections;
