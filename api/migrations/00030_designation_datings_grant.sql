-- +goose Up
-- Lane 141 (B116): the capture jobs' role dates each injury capture into
-- app.designation_datings (Lane 134), so it holds usage on schema app and
-- select, insert, delete on the table. Granted by hand until now; kept
-- here so a table recreated by 00029 keeps it. Run as the role owning app
-- and the table (api-migrate). Idempotent, and a no-op on a database with
-- no such role (dev, the tests): the grant needs the role, never makes it.
-- It opens no member-data table: usage alone opens none.
-- +goose StatementBegin
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'commish_research') then
    grant usage on schema app to commish_research;
    grant select, insert, delete on app.designation_datings to commish_research;
  end if;
end
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'commish_research') then
    revoke select, insert, delete on app.designation_datings from commish_research;
    revoke usage on schema app from commish_research;
  end if;
end
$$;
-- +goose StatementEnd
