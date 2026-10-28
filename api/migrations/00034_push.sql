-- +goose Up
-- Lane 262 (mobile foundation phase 3, spec §5.3): push, the server side.
--
-- A paired app registers its push token on its own device row (PUT
-- /devices/{id}/push). The columns go last on the table and are nullable,
-- so the binary before this one reads and writes devices as it did. A
-- token belongs to one device: the unique index refuses a second holder,
-- and registering moves it. The extension never carries one.
alter table app.devices add column push_platform text check (push_platform in ('apns', 'fcm'));
alter table app.devices add column push_token text
  check (push_token ~ '^[A-Za-z0-9_:.-]+$' and char_length(push_token) between 16 and 4096);
alter table app.devices add column push_registered_at timestamptz;
alter table app.devices add constraint devices_push_check check (
  (push_platform is null) = (push_token is null) and (push_token is null) = (push_registered_at is null)
  and (push_token is null or kind <> 'extension')
);
create unique index devices_push_token_key on app.devices (push_platform, push_token) where push_token is not null;

-- The outbox. Producers insert rows; nothing sends inline. The notify job
-- (cmd/api notify, Cloud Run job api-notify) drains the due rows by lease:
-- a claim moves send_after past the lease and counts the attempt, so a
-- job that stops mid-send leaves the row to the next run. device_id null
-- is every device the account has registered. A row is sent (sent_at),
-- waiting a retry (failed_at with attempts under the bound), or dead
-- (attempts at the bound and never sent). data is the payload the device
-- receives; its "key", when present, is the producer's dedupe key: one
-- row per account, kind and key, so a producer run again adds nothing.
create table app.notifications (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  device_id  uuid references app.devices (id) on delete cascade,
  kind       text not null check (kind in ('starter_status', 'week_reads', 'waiver_claims')),
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 400),
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2048),
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at    timestamptz,
  failed_at  timestamptz,
  attempts   integer not null default 0 check (attempts >= 0)
);
create index notifications_due_idx on app.notifications (send_after) where sent_at is null;
create index notifications_account_idx on app.notifications (account_id, created_at desc);
create unique index notifications_key on app.notifications (account_id, kind, (data ->> 'key')) where data ? 'key';

-- A member's push preferences: quiet hours in their own time zone and one
-- switch per kind. No row is the defaults (23:00 to 08:00 New York time,
-- every kind on); GET and PATCH /me carry them. Minutes after midnight;
-- a start equal to its end is no quiet hours.
create table app.notification_preferences (
  account_id  uuid primary key references app.accounts (id) on delete cascade,
  time_zone   text not null default 'America/New_York' check (char_length(time_zone) between 1 and 64),
  quiet_start smallint not null default 1380 check (quiet_start between 0 and 1439),
  quiet_end   smallint not null default 480 check (quiet_end between 0 and 1439),
  kinds_off   text[] not null default '{}' check (kinds_off <@ array['starter_status', 'week_reads', 'waiver_claims']::text[]),
  updated_at  timestamptz not null default now()
);

-- The APNs provider token (the ES256 JWT signed with the .p8), one per key
-- id: every notify run is a new process, and Apple refuses a token
-- refreshed more often than every twenty minutes, so the runs share it
-- here and sign a new one only when it is older than its life.
create table app.apns_provider_tokens (
  key_id    text primary key check (char_length(key_id) between 1 and 40),
  token     text not null check (char_length(token) between 1 and 2048),
  issued_at timestamptz not null
);

-- The producers' marks: when a producer was last asked to run, and the
-- newest input it has finished (the starter status producer's newest
-- capture compared). The internal route writes requested_at and answers;
-- the work runs off the request, one instance at a time.
create table app.notify_marks (
  producer     text primary key check (producer in ('starter_status')),
  requested_at timestamptz,
  finished_at  timestamptz,
  done_through timestamptz
);

-- +goose Down
drop table app.notify_marks;
drop table app.apns_provider_tokens;
drop table app.notification_preferences;
drop table app.notifications;
drop index app.devices_push_token_key;
alter table app.devices drop constraint devices_push_check;
alter table app.devices drop column push_registered_at;
alter table app.devices drop column push_token;
alter table app.devices drop column push_platform;
