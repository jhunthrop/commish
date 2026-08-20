-- Hand-written: drizzle-orm's index() builder has no way to express an INCLUDE clause, so
-- drizzle-kit generate cannot produce this migration from src/db/schema.ts. See that file's
-- comment on chat_messages_league_id_idx.
--
-- 0017_chat_message_gifs.sql widened chat_messages by six nullable columns. On the same
-- corpus size src/db/index-plans.test.ts proves against, that alone was enough to flip the
-- planner off chat_messages_league_id_idx (an exact range seek on this league's own rows) and
-- onto chat_messages_pkey (a full id-order scan discarding every OTHER league's row along the
-- way) for the paginated "newest N messages in this league" read every chat page load makes —
-- a ratio that gets worse, not better, as total chat volume grows. Adding body to the index
-- lets Postgres answer that read as an Index-Only Scan (no heap fetch at all, once the table has
-- been vacuumed) instead of comparing it against a heap-fetching alternative on the wrong index.
DROP INDEX "chat_messages_league_id_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_league_id_idx" ON "chat_messages" USING btree ("league_id","id") INCLUDE ("body");
