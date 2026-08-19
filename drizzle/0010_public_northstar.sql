DROP INDEX "drafts_league_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_league_id_idx" ON "drafts" USING btree ("league_id");