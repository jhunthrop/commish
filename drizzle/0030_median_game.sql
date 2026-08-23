-- Phase 3.5, Task 2: the league median game. Two additive statements, hand-verified against
-- `drizzle-kit generate`'s own output rather than hand-written from scratch, per the sibling
-- migrations in this file's own history.
--
-- `leagues.median_game` is the season-structure toggle (never on `scoring_settings`, which is
-- fifteen `real` columns answering "what is a catch worth" — a median game changes how many
-- results a week produces, not what a stat is worth). `weeks.median_score` is the stored number,
-- written and OVERWRITTEN by `finalizeWeekInTx` (`@/stats-pipeline/finalize`) in the same
-- transaction as the matchup scores it was computed from — `weeks`' primary key is already
-- `(league_id, week_number)`, so no new table is needed for one median per league week.
ALTER TABLE "leagues" ADD COLUMN "median_game" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weeks" ADD COLUMN "median_score" real;
