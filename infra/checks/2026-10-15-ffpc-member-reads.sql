-- One-shot check after the deploy that applies migration 00023 (Lane 38):
-- every FFPC attachment is read as the member who attached it. Read only;
-- run once on production with psql through the proxy (infra/README.md).
--
-- Expected: no row with read_as_member false; shared FFPC reads 0. The
-- attachments with no connection, or signed out, are the members told
-- to connect FFPC on their league page.

-- Live FFPC attachments by state.
select
  l.read_as_member,
  coalesce(c.status, 'no connection') as connection,
  count(*) as attachments,
  count(sn.read_as) as with_own_read
from app.league_links l
left join app.host_connections c on c.account_id = l.account_id and c.host = 'ffpc'
left join app.league_snapshots sn
  on sn.host = l.host and sn.host_league_id = l.host_league_id and sn.host_season = l.host_season
  and sn.read_as = l.account_id
where l.host = 'ffpc' and l.detached_at is null
group by 1, 2
order by 1, 2;

-- FFPC reads kept with no reader (the shared reads 00023 dropped): want 0.
select count(*) as shared_ffpc_reads
from app.league_snapshots
where host = 'ffpc' and read_as = '00000000-0000-0000-0000-000000000000';
