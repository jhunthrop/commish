-- +goose Up
-- The global ceiling on signed-out mocks (Lane 6 fix round 2): every
-- instance counts each anonymous start into its hour, and a start past
-- the hour's ceiling is refused. The sweep drops hours older than a day.
create table app.anon_mock_hours (
  hour    timestamptz primary key,
  started integer not null default 0 check (started >= 0)
);

-- The sweep's second rule: an anonymous mock nothing happened in after
-- its create is deleted after a day.
create index mocks_unclaimed_created_idx on app.mocks (created_at) where owner_token is not null;
