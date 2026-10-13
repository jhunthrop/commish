-- +goose Up
-- A report now marks each pick with who made it (made_by) and gives the
-- picks made for the drafter no hindsight. Reports cached before that
-- carry neither, so they are dropped and computed again on the next read.
update app.mocks set report = null, report_at = null where report is not null;

-- +goose Down
-- Nothing to restore: a dropped report is computed again on its next read.
select 1;
