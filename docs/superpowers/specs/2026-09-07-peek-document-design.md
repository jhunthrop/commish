# The Peek Document

**Status:** approved by the founder 2026-09-07 ("do it", after "that's still far too many for a production system, how do we get it to 1?" and "can we not have event driven updates of the data if we need?").
**Builds on:** `2026-09-07-peek-facts-precompute-design.md` (shipped the same day: `player_peek_facts`, the peek at 19 queries and about 1 s in production, down from 73 and 14 s).

## 1. Goal

Opening a player peek or the full player page is ONE database round trip: one SQL statement that returns a finished document plus the two live facts the league contributes. Every input that can change a document rebuilds it through an event the product already owns, so the document is as fresh as the data behind it and no request ever assembles a page from live tables again.

## 2. What a league actually contributes

The measured peek assembles about fifteen facts. Only three depend on the league:

- its scoring rules, which score every weekly point the peek shows;
- its schedule length, which caps the chart's week axis;
- who holds the player on a roster right now.

Everything else (identity, seasons and weeks, totals, dossier facts, capsule text, injury designation, news, outlook, peer ranks, prior seasons held) is league-agnostic. Scoring rules repeat across leagues, since most leagues run one of a few presets, so a document keyed by the scoring rules serves every league that shares them.

## 3. Design

### 3.1 The table: `player_peek_documents`

One row per (season, `scoring_hash`, product player id, `as_of`):

- `document` (JSONB): the complete `PlayerSeasonBody` minus the two live fields, with EVERY available season's weeks, totals and log included, so a season switch in the peek is a client-side flip with no fetch.
- `scoring_hash`: a stable hash of the `ScoringSettings` shape (a canonical JSON of the rule weights and tier tables). One function, `scoringHashOf(rules)`, used by the writer, the reader and the settings write path.
- `basis` (JSONB): which inputs and their stamps produced this document (facts row `as_of`, capsule id, harvest capture id, last finalized week), so a document can say what it knows and a rebuild can tell whether anything moved.
- `as_of`, `computed_at`, `source` (`peek_document_v1`).
- Unique index on (`season`, `scoring_hash`, `player_id`, `as_of`); the read is the latest row with `as_of <= now`.

Size: distinct scoring hashes in use times board players, around 700 rows per hash at roughly 5 KB. Twenty hashes is about 70 MB. A pruning rule keeps the latest three `as_of` generations per key.

### 3.2 The reader: one statement

```sql
select d.document, l.season_weeks, h.team_id as holder_team_id
from leagues l
join player_peek_documents d
  on d.season = l.season and d.scoring_hash = l.scoring_hash and d.player_id = $player
left join lateral (
  select rs.team_id from roster_slots rs join teams t on t.id = rs.team_id
  where t.league_id = l.id and rs.player_id = $player limit 1
) h on true
where l.id = $league and d.as_of <= now()
order by d.as_of desc limit 1
```

Written with Drizzle's query builder, not a string; the shape above is the contract. The league row carries its `scoring_hash` as a stored column (written by the settings write path, backfilled once by migration), so the reader never recomputes a hash from the settings table. Whether the league's schedule length lives on the league row or is derived in the same statement is the implementer's call; it must not be a second round trip.

`playerSeason` hydrates the document, applies the two live fields, and returns. The query-count test pins the peek at exactly one statement, using the counting client the timing harness introduced. The full player page uses the same reader.

### 3.3 The writer

One pure function `buildPeekDocument(inputs) -> document` and one writer `writePeekDocuments(db, { season, scoringHash, playerIds })`. The writer reads the same sources the request path reads today, once per batch, and upserts (COALESCE upsert, changed-row counting, `computed_at` excluded from the change comparison, the pattern every ingester uses). The existing `player_peek_facts` row is one of its inputs, not something it recomputes.

### 3.4 Event-driven rebuilds

Every internal event that changes an input enqueues a targeted rebuild through the owned, Postgres-backed job system (`src/jobs`), the way `draft-grades` is enqueued post-commit from the draft store. Never a cron or interval for these; the tick drains them.

| Event | Where it fires | Rebuild scope |
|---|---|---|
| Weekly stats finalize | `season-week-job`, after the finalize step | every hash, players with a changed week |
| Capsule written | the capsule writer (sweep or single) | every hash, that player |
| Peek facts row written | the peek-facts writer | every hash, that player |
| Harvest completes with changes | `capture-harvest-job`, after diffing the capture against the previous one | every hash, players whose injury designation or news changed |
| League scoring settings change | the settings write path | that hash only (a new hash builds all players; a hash still in use by other leagues is untouched) |
| Roster change (add, drop, trade) | nothing | the holder is joined live, documents never change |

The external feed stays polled, since the provider offers no push; the harvest's cadence is a config value (`HARVEST_CONFIG`), set to hourly during the season's waking hours so an injury designation reaches the peek within the hour, with the provider's request budget stated beside it. The harvest already computes "captured vs unchanged"; the diff to player level is new and is what keeps a rebuild targeted.

Rebuild jobs coalesce: enqueueing the same (hash, player) twice before the tick runs is one build. The job records how many documents it built and how many changed.

### 3.5 Miss path and absence

A league whose scoring hash has no documents yet (a new combination nobody has used) triggers a build of that hash for all board players on its first peek open and renders the league-agnostic parts of that build immediately; every open after that is the one read. A player with no document (not on the board, a mid-season signing) renders the existing absence copy. Nothing is ever invented to fill a gap.

### 3.6 Honesty and copy

Every number in the document carries its basis as today (the `basis` field and the existing in-document basis labels). A document states its own `as_of` and the peek surfaces it in the existing "as of" affordance if one exists, else in the footer legend. No em-dashes, no semicolons, no competitor names, no tips. Functions under 50 lines, files under 800, immutability, no `any`.

## 4. Non-goals

- Changing what the peek shows. Parity with today's body is a test, field by field, for a fixture player.
- Push from the stats provider. It does not exist.
- The board, the draft room pool, or the register. They keep their own readers.

## 5. Testing

- `scoringHashOf`: stable across key order, differs when any weight or tier changes, and the preset leagues in the fixture collapse to the expected small set of hashes.
- Writer: builds one document per (hash, player); a second run writes zero changed rows; the changed-row count moves when one input moves.
- Reader: exactly one statement (counting client), correct holder join, latest `as_of` chosen, absence with no document, and a full-body parity test against the pre-change `playerSeason` on the same fixture (byte-compare the JSON minus the two live fields).
- Events: each row of the table in 3.4 has a test that fires the event and asserts the enqueued job's scope; coalescing asserted.
- Miss path: a league with a novel hash triggers one build and the second open is one statement.
- Gates: tsc, eslint, targeted vitest, design guards.
- Timing harness against the dev database before and after; production gets one verification read after rollout, per [[prod-db-is-for-backfills-only]].

## 6. Production rollout

Deploy (migrations in the build: the table and the `leagues.scoring_hash` column with its backfill), run the document build once by hand for every hash in use, take one timing read for the three players in the earlier table, then watch the next finalize and harvest enqueue their rebuilds.
