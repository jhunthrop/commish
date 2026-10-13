-- +goose Up
-- A solo mock works signed out (coordinator ruling, Lane 6 fix round 1):
-- it is owned by an account or by an anonymous browser token, never
-- both. Only the token's sha256 is stored, as app.sessions stores a
-- session's. Sign-in moves the token's mocks to the account; the sweep
-- deletes the ones nobody claims within 90 days.
alter table app.mocks
  alter column account_id drop not null,
  add column owner_token bytea,
  add constraint mocks_one_owner_ck check ((account_id is null) <> (owner_token is null));
create index mocks_owner_token_idx on app.mocks (owner_token, created_at desc) where owner_token is not null;
create index mocks_unclaimed_idx on app.mocks (updated_at) where owner_token is not null;
