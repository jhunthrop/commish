with listed_caps as materialized (
  select payload, captured_at, (
    select count(distinct btrim(e->>'playerID')) from jsonb_array_elements(payload->'injList') as e
    where btrim(coalesce(e->>'playerID', '')) <> '' and btrim(coalesce(e->>'designation', '')) <> ''
  ) as n_listed
  from {{capture_snapshots}}
  where source = :source and captured_at <= :newest and captured_at > :oldest and jsonb_typeof(payload->'injList') = 'array'
), floored as (
  select payload, captured_at, n_listed, lead(n_listed) over (order by captured_at desc) as n_before
  from listed_caps where n_listed > 0
), caps as (
  select payload, captured_at, row_number() over (order by captured_at desc) as n
  from floored
  where n_before is null or 2 * n_listed >= n_before
  order by captured_at desc limit :most
), listed as (
  select c.n, c.captured_at, btrim(e->>'playerID') as player_id, m.status
  from caps c cross join lateral jsonb_array_elements(c.payload->'injList') as e
  join unnest(cast(:codes as text[]), cast(:statuses as text[])) as m(code, status) on m.code = upper(btrim(e->>'designation'))
  where btrim(coalesce(e->>'playerID', '')) <> ''
), runs as (
  select player_id, status, n, captured_at, n - row_number() over (partition by player_id, status order by n) as gap
  from listed
)
select player_id, status, min(captured_at) as since
from runs where gap = 0 group by player_id, status
having max(n) < (select count(*) from caps)
