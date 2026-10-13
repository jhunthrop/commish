-- +goose Up
-- The sheet's tags become a short list, from the fixed set or the
-- drafter's own words, and each row keeps the face the drafter saw
-- (lane 7). internal/sheets validates both before a write; the checks
-- here are the floor under it.

-- +goose StatementBegin
create function app.sheet_tags_valid(tags text[]) returns boolean
  language sql immutable parallel safe
  as $$
    select cardinality(tags) <= 4
      and coalesce(bool_and(char_length(t) between 1 and 20), true)
    from unnest(tags) as t
  $$;
-- +goose StatementEnd

alter table app.sheet_rows
  add column tags text[] not null default '{}' check (app.sheet_tags_valid(tags)),
  add column headshot text check (char_length(headshot) between 9 and 300 and headshot like 'https://%');

update app.sheet_rows set tags = array[tag] where tag is not null;

alter table app.sheet_rows drop column tag;
