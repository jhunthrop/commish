-- The dual-track register (Round D): one freeze instant records every tracked board's claim, so
-- `board_source` joins both fact indexes and `register_grade_rows` grows one. The bare NOT NULL
-- with no default or backfill is safe because `register_grade_rows` is EMPTY everywhere it exists —
-- table 0066 created it days ago and the first grading has not run (2026 has no outcomes yet).
-- `register_freeze_rows` is NOT empty (546 rows, the week-1 v7 freeze) and needs no backfill: it
-- has carried `board_source` since 0066, and widening a unique index over an existing column cannot
-- fail here because those 546 rows already hold one source and one player each.
DROP INDEX "register_freeze_rows_fact_idx";--> statement-breakpoint
DROP INDEX "register_grade_rows_fact_idx";--> statement-breakpoint
ALTER TABLE "register_grade_rows" ADD COLUMN "board_source" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "register_freeze_rows_fact_idx" ON "register_freeze_rows" USING btree ("season","week","frozen_at","board_source","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "register_grade_rows_fact_idx" ON "register_grade_rows" USING btree ("season","week","frozen_at","graded_at","board_source","player_id");