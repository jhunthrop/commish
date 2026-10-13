-- +goose Up
-- The Sleeper username a drafter found their seat with, kept so the next
-- draft they follow offers it first (one tap instead of choosing a slot).
alter table app.companions
  add column host_username text check (host_username ~ '^[A-Za-z0-9_]{1,40}$');

-- Each slot's name in the host league (its members' display names, read
-- once when the companion is made), so a league's seats read as people.
-- Empty for a mock draft, which has no league; a slot with no member is ''.
alter table app.companions
  add column seat_names text[] not null default '{}' check (cardinality(seat_names) <= 32);

-- The draft's own name on the host, so a list of followed drafts reads as
-- leagues and not as ids.
alter table app.companions
  add column draft_name text not null default '' check (char_length(draft_name) <= 80);

-- +goose Down
alter table app.companions drop column draft_name;
alter table app.companions drop column seat_names;
alter table app.companions drop column host_username;
