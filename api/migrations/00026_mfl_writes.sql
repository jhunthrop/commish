-- +goose Up
-- Lane 67: a MyFantasyLeague lineup set the member confirms on our
-- screen. The member's session (MFL_USER_ID, never the password) is kept
-- as any host connection is; the allow list and the proof take the host
-- mfl for a lineup alone; the switch for it is HOST_WRITES_MFL_LINEUP.
alter table app.host_connections drop constraint host_connections_host_check;
alter table app.host_connections add constraint host_connections_host_check check (host in ('ffpc', 'yahoo', 'espn', 'mfl'));
alter table app.host_connect_refusals drop constraint host_connect_refusals_host_check;
alter table app.host_connect_refusals add constraint host_connect_refusals_host_check check (host in ('ffpc', 'yahoo', 'espn', 'mfl'));

alter table app.host_write_accounts drop constraint host_write_accounts_host_check;
alter table app.host_write_accounts add constraint host_write_accounts_host_check
  check (host in ('espn', 'mfl') and (host = 'espn' or kind = 'lineup'));
alter table app.host_moves drop constraint host_moves_host_check;
alter table app.host_moves add constraint host_moves_host_check
  check (host in ('espn', 'mfl') and (host = 'espn' or kind = 'lineup'));

-- +goose Down
delete from app.host_moves where host = 'mfl';
alter table app.host_moves drop constraint host_moves_host_check;
alter table app.host_moves add constraint host_moves_host_check check (host in ('espn'));
delete from app.host_write_accounts where host = 'mfl';
alter table app.host_write_accounts drop constraint host_write_accounts_host_check;
alter table app.host_write_accounts add constraint host_write_accounts_host_check check (host in ('espn'));
delete from app.host_connect_refusals where host = 'mfl';
alter table app.host_connect_refusals drop constraint host_connect_refusals_host_check;
alter table app.host_connect_refusals add constraint host_connect_refusals_host_check check (host in ('ffpc', 'yahoo', 'espn'));
delete from app.host_connections where host = 'mfl';
alter table app.host_connections drop constraint host_connections_host_check;
alter table app.host_connections add constraint host_connections_host_check check (host in ('ffpc', 'yahoo', 'espn'));
