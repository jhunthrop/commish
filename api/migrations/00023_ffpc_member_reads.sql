-- +goose Up
-- Lane 38: an FFPC league is read as the member who attached it, with
-- their own sign-in, for their attachment alone (ruling 2026-10-15, which
-- withdraws the 2026-10-13 read as whichever connected member read last).
--
-- Every FFPC attachment was made from the member's own list with their own
-- sign-in, and keeps their own league-team id (host_team_key), so each is
-- marked a member read. A member holding no FFPC connection today reads
-- nothing until they connect: their league says to connect FFPC, and
-- connecting mends it with no attach again.
update app.league_links set read_as_member = true where host = 'ffpc' and not read_as_member;

-- The shared FFPC reads were each made as some member, whose team and
-- points they carry, so none is handed to another: each member's own read
-- replaces them at their next view.
delete from app.league_snapshots where host = 'ffpc' and read_as = '00000000-0000-0000-0000-000000000000';

-- +goose Down
delete from app.league_snapshots where host = 'ffpc' and read_as <> '00000000-0000-0000-0000-000000000000';
update app.league_links set read_as_member = false where host = 'ffpc' and read_as_member;
