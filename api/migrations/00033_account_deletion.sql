-- +goose Up
-- Lane 233 (B230): a member deletes their own account (POST /me/delete).
-- Almost every table keyed to an account cascades with it; two things
-- here are what that delete still needs.
--
-- A group pass outlives the member who bought it: the people who claimed
-- a seat keep their passes, and the payment keeps its record. Its buyer
-- was "on delete restrict", which would refuse the delete, so the buyer
-- is cleared instead. A binary before this one reads the buyer as a
-- non-null id; it meets a cleared one only after this binary deletes an
-- account, and no group pass is sold while the season is free.
alter table app.group_passes alter column purchaser_id drop not null;
alter table app.group_passes drop constraint group_passes_purchaser_id_fkey;
alter table app.group_passes add constraint group_passes_purchaser_id_fkey
  foreign key (purchaser_id) references app.accounts (id) on delete set null;

-- The sign-in provider's users still to delete. The account's delete
-- writes the row in its own transaction, so a provider that fails, or a
-- process that stops before the call, leaves the row for the daily sweep
-- (cmd/api jobs.go) to try again. former_account_id is the deleted
-- account's id, kept for the log; it references nothing. A row the
-- provider refused deletion.MaxAttempts times is dead (dead_at): the sweep
-- stops trying it and logs it once for a hand, so a permanent refusal
-- never loops nor holds the queue. While a row is pending, a sign-in as
-- its user is refused (auth: the account is being deleted).
create table app.workos_user_deletions (
  workos_user_id    text primary key check (char_length(workos_user_id) between 1 and 200),
  former_account_id uuid not null,
  attempts          integer not null default 0 check (attempts >= 0),
  last_error        text check (last_error is null or char_length(last_error) <= 500),
  created_at        timestamptz not null default now(),
  last_tried_at     timestamptz,
  dead_at           timestamptz
);
create index workos_user_deletions_queue_idx on app.workos_user_deletions (last_tried_at nulls first, created_at)
  where dead_at is null;

-- +goose Down
-- A cleared buyer cannot be restored; the not-null fails while one exists.
drop table app.workos_user_deletions;
alter table app.group_passes drop constraint group_passes_purchaser_id_fkey;
alter table app.group_passes add constraint group_passes_purchaser_id_fkey
  foreign key (purchaser_id) references app.accounts (id) on delete restrict;
alter table app.group_passes alter column purchaser_id set not null;
