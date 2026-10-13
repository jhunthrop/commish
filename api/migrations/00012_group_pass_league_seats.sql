-- +goose Up
-- A Group Draft Pass is one pass per team in a league, so its seats are
-- the league's team bounds (internal/leagues, 8 to 14), not 1 to 32.
alter table app.group_passes drop constraint group_passes_seats_check;
alter table app.group_passes add constraint group_passes_seats_check check (seats between 8 and 14);

-- +goose Down
alter table app.group_passes drop constraint group_passes_seats_check;
alter table app.group_passes add constraint group_passes_seats_check check (seats between 1 and 32);
