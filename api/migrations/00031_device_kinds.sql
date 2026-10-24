-- +goose Up
-- Lane 172 (mobile foundation, Task B): the phone apps pair on the
-- extension's bearer path. A device says what it is, and a pairing code
-- says what it may pair: the account page's code pairs the extension,
-- the code an app's sign-in comes back with pairs that app alone, so a
-- code read off the account page never mints the session scope. Every
-- row that exists is the extension's, the default. The session scope is
-- an app's alone, held here as well as in the code.
alter table app.devices add column kind text not null default 'extension';
alter table app.devices add constraint devices_kind_check check (kind in ('extension', 'ios', 'android'));
alter table app.devices drop constraint devices_scopes_check;
alter table app.devices add constraint devices_scopes_check check (
  scopes <@ array['league:write', 'draft:write', 'session']::text[] and cardinality(scopes) >= 1
  and (kind <> 'extension' or not ('session' = any (scopes)))
);

alter table app.device_pair_codes add column kind text not null default 'extension';
alter table app.device_pair_codes add constraint device_pair_codes_kind_check check (kind in ('extension', 'ios', 'android'));

-- +goose Down
alter table app.device_pair_codes drop column kind;
delete from app.devices where kind <> 'extension';
alter table app.devices drop constraint devices_scopes_check;
alter table app.devices add constraint devices_scopes_check check (
  scopes <@ array['league:write', 'draft:write']::text[] and cardinality(scopes) >= 1
);
alter table app.devices drop column kind;
