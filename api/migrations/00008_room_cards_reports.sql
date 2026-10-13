-- +goose Up
-- The rooms lane (docs/design/2026-10-12-mock-room-rethink.md).

-- A mock's branch: every undo starts a new one. A card is stored for the
-- branch it was computed on, so a card that lands after an undo it raced
-- is never read on the new branch.
alter table app.mocks
  add column branch integer not null default 0;

-- The card the solo room showed at each of the drafter's turns: our
-- call and every player's chance of lasting to the next turn. It is
-- written when the card is first read and copied into the pick's
-- MAKE_PICK row when the drafter picks, so the report's hindsight says
-- what the room said at the time.
create table app.mock_cards (
  mock_id    uuid not null references app.mocks (id) on delete cascade,
  branch     integer not null,
  pick_no    smallint not null check (pick_no >= 1),
  card       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (mock_id, branch, pick_no)
);

-- The report of a finished mock, computed once (the standings, the
-- hindsight and the 200 runs) and served from here until an undo
-- reopens the draft.
alter table app.mocks
  add column report    jsonb,
  add column report_at timestamptz;

-- A lobby's fill and its people: how many seats the format holds and
-- whether fewer than three people started it (then the bots pick at the
-- solo room's pace, with no think time).
alter table app.rooms
  add column teams      smallint not null default 12 check (teams between 8 and 14),
  add column solo_pace  boolean not null default false;
create index room_seats_open_idx on app.room_seats (room_id) where account_id is not null and left_at is null;

-- Presence: every socket on a seat stamps last_seen at each ping. A seat
-- not seen within the presence window (or never, past the window after
-- it joined) is gone, whichever instance its socket was on.
alter table app.room_seats
  add column last_seen timestamptz;

-- The card a lobby drafter saw on the clock, written first-wins as the
-- solo room's is, and copied into the pick's row as its odds.
create table app.lobby_cards (
  room_id    uuid not null references app.rooms (id) on delete cascade,
  pick_no    smallint not null check (pick_no >= 1),
  card       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, pick_no)
);
