-- +goose Up
-- Lane 33: one ESPN connect for a public or a private league. The
-- member's ESPN session is kept whatever their leagues are; proven says
-- whether a league the public cannot read has been read with it yet
-- (what proves espn_s2). FFPC and Yahoo prove themselves on connect, and
-- every ESPN connection kept before this lane was proven on connect, so
-- every row already here is proven.
alter table app.host_connections add column proven boolean not null default true;

-- +goose Down
alter table app.host_connections drop column proven;
