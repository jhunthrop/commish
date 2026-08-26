-- Founder directive 2026-08-26: the whole house shelf is sit-and-go. New spawns already are
-- (HOUSE_CATALOG); this is the ONE-TIME transition for house leagues that already exist as rows.
-- Without it, a legacy scheduled house league occupies its rung's shelf slot indefinitely:
-- roll-until-full keeps re-scheduling a short room forever, so the reconciler (which counts the
-- legacy row as open) never spawns the when_full replacement — the directive would never take
-- effect on any database with existing rows (found live by e2e/formats-and-lobby against the
-- shared dev database).
--
-- Scope: house-owned (leagues.house_rung IS NOT NULL), still 'scheduled' (never started — a
-- draft that already ran keeps its history untouched), currently 'scheduled'-triggered. Each
-- becomes when_full with the identical far-future placeholder kickoffFor writes for a fresh
-- spawn (now + 7 days: LEAGUE_CONFIG.defaults.draftDaysFromCreation — restated here because a
-- migration cannot import TypeScript; drift risk accepted for a one-time transition).
-- fireWhenFullInTx stamps the real kickoff the moment the last seat fills, exactly as for a
-- fresh spawn.
UPDATE "drafts"
SET "start_trigger" = 'when_full',
    "kickoff_at" = now() + interval '7 days'
FROM "leagues"
WHERE "drafts"."league_id" = "leagues"."id"
  AND "leagues"."house_rung" IS NOT NULL
  AND "drafts"."status" = 'scheduled'
  AND "drafts"."start_trigger" = 'scheduled';
