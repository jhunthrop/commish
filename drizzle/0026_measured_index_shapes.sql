-- Three index corrections, each MEASURED against a seeded corpus rather than reasoned about.
-- The measurements are recorded here because a future reader deciding whether one of these is
-- still worth its write cost needs the number, not the argument. `src/db/index-plans.test.ts`
-- re-runs all three against the REAL production query builders, so a regression reddens the
-- build instead of waiting to be rediscovered by a review.
--
-- The first statement pair is hand-written, the same way 0018 and 0024 were and for the inverse
-- reason: drizzle-orm's `index()` builder has no `.include()` API, so drizzle's snapshots never
-- recorded that `chat_messages_league_id_idx` carried an INCLUDE list and `db:generate` sees no
-- diff when it goes away. The other two statement pairs are generated.

-- 1. `chat_messages_league_id_idx`: keep the key, drop the INCLUDE list.
--
-- The key `(league_id, id)` is right and load-bearing: `chatPageQuery` (`@/chat-service/chat`)
-- is `WHERE league_id = $1 [AND id < $2] ORDER BY id DESC LIMIT 51`, which this index serves as a
-- backward Index Scan with an Index Cond and nothing discarded.
--
-- The INCLUDE list is INERT, and was measured so. Covering columns can only pay for themselves
-- in an Index-Only Scan, and this query can never have one: it selects eleven more
-- `chat_messages` columns than the index carried, and joins `users` and `teams`. Measured over a
-- 100,000-row corpus at production-like selectivity (one league holding ~0.4% of all chat), the
-- plan is an Index Scan Backward with a heap fetch either way. The INCLUDE list changed nothing
-- about the plan and everything about the size: 8,480 kB with, 3,104 kB without -- 2.7x of write
-- amplification on the one table in this product that grows without bound, bought for nothing.
--
-- Final review, HIGH 3. The gate test that "proved" an Index-Only Scan measured a four-column,
-- join-free, `ORDER BY id ASC` stand-in production never issues, over a corpus that gave one
-- league 2% of the table; the real query fell to a `chat_messages_pkey` scan-and-discard. The
-- test now EXPLAINs the exported builder itself, over a corpus whose league spread is realistic.
DROP INDEX "chat_messages_league_id_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_league_id_idx" ON "chat_messages" USING btree ("league_id","id");--> statement-breakpoint

-- 2. `integrity_flags_queue_idx`: add the cursor's second key.
--
-- `pendingFlagQuery` (`@/integrity-service/flags`) orders by `(raised_at, id)` and seeks on the
-- row comparison `(raised_at, id) > ($1, $2)`. A one-column `(raised_at)` index is only a
-- PRESORTED PREFIX of that, so over 60,000 flags (1,200 open) page one planned an Index Scan
-- plus an `Incremental Sort (Sort Key: raised_at, id)`, and a cursor page landed the comparison
-- as `Filter: (ROW(raised_at, id) > ROW(...))` -- re-walking from the oldest open flag and
-- discarding, on every page. With both keys, page one is a plain Index Scan with no sort node
-- above it and the cursor page's comparison is an `Index Cond`. The partial predicate is
-- unchanged, and is what keeps this index proportional to the OPEN queue rather than to every
-- flag ever raised.
--
-- Final review, HIGH 4.
DROP INDEX "integrity_flags_queue_idx";--> statement-breakpoint

-- 3. `session_signals_user_occurred_idx`: drop the dead second column.
--
-- The sole reader, `signalsForUsers` (`@/integrity-service/session-signals`), is
-- `WHERE user_id = ANY($1) ORDER BY occurred_at DESC` -- ordered GLOBALLY across every requested
-- user, so a per-user `occurred_at` ordering cannot serve it and never could. Measured over
-- 100,000 rows for ten users: identical plan shape both ways (a Sort above a Bitmap Heap Scan
-- above a Bitmap Index Scan), with the Bitmap Index Scan's estimated cost falling from 197.53 to
-- 80.27 once the index stops carrying a column nothing reads. The index keeps its name for
-- continuity with the migration that created it.
--
-- Final review, MEDIUM 10.
DROP INDEX "session_signals_user_occurred_idx";--> statement-breakpoint
CREATE INDEX "integrity_flags_queue_idx" ON "integrity_flags" USING btree ("raised_at","id") WHERE "integrity_flags"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "session_signals_user_occurred_idx" ON "session_signals" USING btree ("user_id");
