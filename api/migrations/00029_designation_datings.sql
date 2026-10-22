-- +goose Up
-- Lane 133 (B110): the injury capture's dating, shared by every API
-- instance. The dating (each listed player's run start under his status,
-- boards.PGSource.DesignationRuns) is a function of the capture alone and
-- takes seconds to read, so the first instance to date a capture keeps it
-- here and every instance after reads it in a millisecond: a fresh
-- instance serves dated statuses at once instead of pending ones.
-- One row per capture, keyed by its digest (the dating's version, the
-- capture's stamp, each listed player and status); the first writer wins
-- (insert ... on conflict do nothing) and a row is never updated. A row
-- holds NFL players and their injury statuses, never member data.
-- Retention: each write deletes the rows whose capture is over two days
-- older than its own.
create table app.designation_datings (
  capture_digest text primary key check (capture_digest ~ '^[0-9a-f]{64}$'),
  capture_at     timestamptz not null,
  runs           jsonb not null check (jsonb_typeof(runs) = 'array'),
  dated_at       timestamptz not null
);
create index designation_datings_capture_at on app.designation_datings (capture_at);

-- +goose Down
drop table app.designation_datings;
