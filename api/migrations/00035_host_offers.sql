-- +goose Up
-- Lane 279 (B263): the trades another team has offered a member on the
-- host, read with the session the attach flow keeps (ESPN, Yahoo,
-- MyFantasyLeague), for the Trades screen's "Offered to you" presets.
--
-- app.host_offers is the current claim: the offers the member's last good
-- read found, one row each. A read replaces every row of its link in one
-- transaction (the previous claim retired), so an offer the host no longer
-- holds (accepted, declined, withdrawn, lapsed) leaves with the read that
-- no longer finds it; a read with no offers leaves none. A failed read
-- writes nothing, so the last good read stands.
--
-- app.host_offer_reads is the archive: every good read as it was found,
-- appended, never updated. Both tables cascade with the link and the
-- account (a member's own data, deleted with them).
create table app.host_offers (
  link_id        uuid not null references app.league_links (id) on delete cascade,
  account_id     uuid not null references app.accounts (id) on delete cascade,
  offer_id       text not null check (char_length(offer_id) between 1 and 64),
  -- The host's id for the offering team: ESPN's team ids are not capped at
  -- a league's size, so only what every parser guarantees is checked.
  from_roster    integer not null check (from_roster > 0),
  give           text[] not null,
  get            text[] not null,
  drop_players   text[] not null,
  proposed_at    timestamptz,
  expires_at     timestamptz,
  read_at        timestamptz not null,
  primary key (link_id, offer_id)
);
create index host_offers_account_idx on app.host_offers (account_id);

create table app.host_offer_reads (
  id         bigserial primary key,
  link_id    uuid not null references app.league_links (id) on delete cascade,
  account_id uuid not null references app.accounts (id) on delete cascade,
  read_at    timestamptz not null,
  offers     jsonb not null check (jsonb_typeof(offers) = 'array')
);
create index host_offer_reads_link_idx on app.host_offer_reads (link_id, read_at desc);
create index host_offer_reads_account_idx on app.host_offer_reads (account_id);

-- +goose Down
drop table app.host_offer_reads;
drop table app.host_offers;
