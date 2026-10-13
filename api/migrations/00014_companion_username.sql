-- +goose Up
-- The Sleeper username a drafter found their seat with, kept so the next
-- draft they follow offers it first (one tap instead of choosing a slot).
alter table app.companions
  add column host_username text check (host_username ~ '^[A-Za-z0-9_]{1,40}$');

-- +goose Down
alter table app.companions drop column host_username;
