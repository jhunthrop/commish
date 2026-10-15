-- +goose Up
-- Lane 39: the second move on a host, an ESPN claim (an add with its drop
-- and the bid where the league bids) the member confirms on our screen.
--
-- The allow list and the proof take the kind claim beside lineup; the
-- switch for it is HOST_WRITES_ESPN_CLAIM. A pending claim keeps when
-- ESPN's queue says it runs (processDate), never anything else of the
-- queue's row.
alter table app.host_write_accounts drop constraint host_write_accounts_kind_check;
alter table app.host_write_accounts add constraint host_write_accounts_kind_check check (kind in ('lineup', 'claim'));

alter table app.host_moves drop constraint host_moves_kind_check;
alter table app.host_moves add constraint host_moves_kind_check check (kind in ('lineup', 'claim'));
alter table app.host_moves add column host_process_at timestamptz;

-- +goose Down
alter table app.host_moves drop column host_process_at;
delete from app.host_moves where kind = 'claim';
alter table app.host_moves drop constraint host_moves_kind_check;
alter table app.host_moves add constraint host_moves_kind_check check (kind in ('lineup'));
delete from app.host_write_accounts where kind = 'claim';
alter table app.host_write_accounts drop constraint host_write_accounts_kind_check;
alter table app.host_write_accounts add constraint host_write_accounts_kind_check check (kind in ('lineup'));
