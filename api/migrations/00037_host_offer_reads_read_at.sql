-- +goose Up
-- Lane 285 (B278 review M2): the sweep's archive prune finds reads by age
-- in batches; this index keeps each batch off a scan of the whole archive.
-- The table is small (one row per change of a member's offers), so a
-- plain create holds its lock for moments.
create index host_offer_reads_read_at_idx on app.host_offer_reads (read_at);

-- +goose Down
drop index app.host_offer_reads_read_at_idx;
