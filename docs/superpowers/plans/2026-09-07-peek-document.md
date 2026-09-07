# The Peek Document — implementation plan

**Spec:** `docs/superpowers/specs/2026-09-07-peek-document-design.md` (approved by the founder 2026-09-07, "do it").
**Builds on:** `docs/superpowers/plans/2026-09-07-peek-facts-precompute.md`, shipped the same day.
**Branch:** this worktree, off `main` at `0993a0f`.
**Ledger:** `.superpowers/sdd/peek-document/progress.md` (gitignored), one line per task and every ruling.

## Global Constraints (copied from the spec)

- **One statement on the request path.** Opening a peek or the full player page is ONE database round
  trip: one SQL statement that returns a finished document plus the live facts the league contributes.
  Written with Drizzle's query builder, not a string. The shape in spec 3.2 is the contract. No second
  round trip for schedule length. A counting-client test asserts exactly one.
- **Honest data is absolute.** A field the writer has not produced renders as ABSENCE, never as a stale
  value presented as current. Every document carries its `as_of` and `basis` (which inputs and their
  stamps produced it). The peek surfaces the document's `as_of`.
- **Events, never crons.** Every rebuild is an enqueued job through the owned Postgres-backed job
  system, with an idempotency key that coalesces duplicate (hash, player) work before the tick runs.
  The external feed stays polled, since the provider offers no push; its cadence is a named config
  value with the provider's request budget stated beside it.
- **Never a parallel system.** The document's inputs are the existing readers (`player_peek_facts`,
  the capsule store, the harvest captures, the observation and stat-line readers). `scoringHashOf` is
  one function used by writer, reader and settings path.
- **Parity is a test.** The hydrated body for a fixture player equals the pre-change `playerSeason`
  body field by field (minus the live league fields), byte-compared as JSON.
- **Point-in-time.** Rows carry `as_of` and `computed_at`. The read is the latest row with
  `as_of <= now`, the same shape every reader in this engine uses.
- **Non-goals:** changing what the peek shows, push from the stats provider, the board, the draft room
  pool, the register.
- **Copy:** no em-dashes, no semicolons, no competitor names, no tips.
- **Code:** functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.

## Gates (every task)

```
npx tsc --noEmit -p .
npx eslint <touched files>
npx vitest run <touched test files>
```
plus `npm run db:migrate:test` once after each migration (five minute cap).

Known pre-existing failures on `main` that this round does not own and does not fix: trade-routes,
trades/page, activity/page, league-rules/page, join hold confirm, public-footer, reading-frame,
account-room/*, admin-room/*, chat-room/*, integrity/*, and
`projections/decide/replay.test.ts` "shuffling it changes no pick".

## Before (recorded, dev database)

| player | pass | ms | queries |
|---|---|---|---|
| Ja'Marr Chase (WR) | cold | 46 | 20 |
| Ja'Marr Chase (WR) | warm | 29 | 17 |
| Jahmyr Gibbs (RB) | cold | 22 | 17 |
| Jahmyr Gibbs (RB) | warm | 22 | 17 |
| Brandon Aubrey (K) | cold | 17 | 19 |
| Brandon Aubrey (K) | warm | 16 | 19 |

## After (same command, same dev database, after one whole build of every hash in use)

| player | pass | ms | queries |
|---|---|---|---|
| Ja'Marr Chase (WR) | cold | 15 | 1 |
| Ja'Marr Chase (WR) | warm | 7 | 1 |
| Jahmyr Gibbs (RB) | cold | 7 | 1 |
| Jahmyr Gibbs (RB) | warm | 6 | 1 |
| Brandon Aubrey (K) | cold | 6 | 1 |
| Brandon Aubrey (K) | warm | 7 | 1 |

The build itself: three scoring hashes in use on the dev database, 1719 documents each, under three
seconds per hash. The store is 16 MB for all three, at about 7 KB a document.

---

## Task 1 — `scoringHashOf` and `leagues.scoring_hash`

**Files**
- new `src/domain/scoring-hash.ts`
- new `src/domain/scoring-hash.test.ts`
- `src/db/schema.ts` (the `leagues.scoringHash` column)
- new `drizzle/00xx_*.sql` (generated)
- new `src/league-service/scoring-hash.ts` (`writeLeagueScoringHash`, `backfillLeagueScoringHashes`)
- new `src/league-service/scoring-hash.test.ts`
- `src/league-service/creation.ts` (write the hash beside the scoring row)
- `src/league-service/settings.ts` (`setScoringSettings` writes the hash in the same transaction)

**Interfaces**

```ts
/** The stable identity of a rule set: a canonical JSON of every scored weight plus the fixed tier
 *  tables the engine applies to DEF lines, sha256'd. One function, used by the writer, the reader
 *  and the settings write path. Key order in the input never changes the answer. */
export function scoringHashOf(rules: Omit<ScoringSettings, "leagueId">): string;

/** Writes `leagues.scoring_hash` for one league from its own rules. Called by league creation and
 *  by the settings write path, inside whatever transaction the caller already holds. */
export async function writeLeagueScoringHash(db: Db, leagueId: string, rules: Omit<ScoringSettings, "leagueId">): Promise<string>;

/** Fills `leagues.scoring_hash` for every league whose stored value is absent or stale, from its
 *  own `scoring_settings` row (falling back to `PPR_SCORING` for a league with no row, the same
 *  fallback `playerSeason` has always used). Idempotent; returns how many rows moved. */
export async function backfillLeagueScoringHashes(db: Db): Promise<number>;
```

**Steps**

1. RED. `src/domain/scoring-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HALF_PPR_SCORING, PPR_SCORING, SCORING_PRESETS, STANDARD_SCORING, TE_PREMIUM_SCORING } from "./scoring";
import { scoringHashOf } from "./scoring-hash";

describe("scoringHashOf", () => {
  it("does not depend on key order", () => {
    const reversed = Object.fromEntries(Object.entries(PPR_SCORING).reverse()) as typeof PPR_SCORING;
    expect(scoringHashOf(reversed)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("ignores a leagueId that rides along", () => {
    expect(scoringHashOf({ ...PPR_SCORING, leagueId: "abc" } as never)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("moves when any weight moves", () => {
    expect(scoringHashOf({ ...PPR_SCORING, pointsPerReception: 0.9 })).not.toBe(scoringHashOf(PPR_SCORING));
    expect(scoringHashOf({ ...PPR_SCORING, pointsPerSafety: 3 })).not.toBe(scoringHashOf(PPR_SCORING));
  });

  it("collapses the four presets to four hashes and no fewer", () => {
    const hashes = new Set(Object.values(SCORING_PRESETS).map(scoringHashOf));
    expect(hashes.size).toBe(4);
    expect(scoringHashOf(STANDARD_SCORING)).not.toBe(scoringHashOf(HALF_PPR_SCORING));
    expect(scoringHashOf(PPR_SCORING)).not.toBe(scoringHashOf(TE_PREMIUM_SCORING));
  });

  it("is a stable hex digest", () => {
    expect(scoringHashOf(PPR_SCORING)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

2. GREEN. `src/domain/scoring-hash.ts`: take the weight keys from `STANDARD_SCORING`'s own keys
   (so a widened vocabulary can never be silently left out of the hash), sort them, build
   `[[key, value], ...]`, append the engine's fixed DEF tier tables under a `tiers` entry, and
   `createHash("sha256").update(JSON.stringify(canonical)).digest("hex")`. Numbers go in as numbers.
   A key present in `STANDARD_SCORING` and missing from the input is an explicit thrown error, not a
   silent `undefined` in the digest.

3. RED. Add `scoringHash: text("scoring_hash")` (nullable, see the ruling below) to `leagues` in
   `src/db/schema.ts`, then `src/league-service/scoring-hash.test.ts`:

```ts
it("fills a league's hash from its own scoring row", async () => {
  const moved = await backfillLeagueScoringHashes(db);
  expect(moved).toBe(1);
  const [row] = await db.select({ hash: leagues.scoringHash }).from(leagues).where(eq(leagues.id, leagueId));
  expect(row!.hash).toBe(scoringHashOf(PPR_SCORING));
});

it("is idempotent", async () => {
  await backfillLeagueScoringHashes(db);
  expect(await backfillLeagueScoringHashes(db)).toBe(0);
});

it("moves when the settings move", async () => {
  await setScoringSettings(db, { leagueId, rules: HALF_PPR_SCORING });
  const [row] = await db.select({ hash: leagues.scoringHash }).from(leagues).where(eq(leagues.id, leagueId));
  expect(row!.hash).toBe(scoringHashOf(HALF_PPR_SCORING));
});
```

4. GREEN. Write `src/league-service/scoring-hash.ts`. `backfillLeagueScoringHashes` reads every
   league joined to its `scoring_settings` row in one statement, computes each hash in TypeScript,
   and writes only the rows whose stored value differs (a `changed rows` count, never a blanket
   update). Wire `writeLeagueScoringHash` into `createLeague` beside the `scoring_settings` insert
   and into a new `setScoringSettings` in `src/league-service/settings.ts`.

5. `npm run db:generate`, then `npm run db:migrate:test`.
6. `git commit -m "feat(scoring): scoringHashOf and leagues.scoring_hash, one identity for a rule set"`

**Ruling to record:** the column is NULLABLE and backfilled in TypeScript, not in the migration's SQL.
Reproducing the digest in SQL would mean reproducing JavaScript's own float formatting of `real`
columns inside Postgres, which is the kind of agreement that holds until the day it does not. A null
hash is an honest miss the reader already handles (Task 5), and `backfillLeagueScoringHashes` runs
from the rebuild job so production self-heals on the first event. Cost if wrong: a league whose hash
never fills keeps paying the miss path, which is the pre-round cost and not a wrong answer.

---

## Task 2 — `buildPeekDocument`, the inputs collector, and `player_peek_documents`

**Files**
- new `src/capsules/peek-document-row.ts` (types and the source constant, the shape
  `peek-facts-row.ts` already set)
- new `src/league-service/player-season-stats.ts` (the pure per-season arithmetic, extracted from
  `player.ts` so the writer and the live path cannot drift)
- new `src/capsules/peek-document.ts` (`buildPeekDocument`, `hydratePeekDocument`, both pure)
- new `src/capsules/peek-document.test.ts`
- new `src/capsules/peek-document-inputs.ts` (every read, batched over the whole player list)
- new `src/capsules/peek-document-store.ts` (`writePeekDocuments`, `readPeekDocumentRow`)
- new `src/capsules/peek-document-store.test.ts`
- `src/db/schema.ts` (`playerPeekDocuments`)
- new `drizzle/00xx_*.sql` (generated)

**Interfaces**

```ts
export const PEEK_DOCUMENT_SOURCE = "peek_document_v1";

/** One season of the document: exactly the fields of `PlayerSeasonBody` that vary by season. Every
 *  available season is present, so a season switch in the peek is a client-side flip. */
export interface PeekDocumentSeason {
  readonly season: number;
  readonly weeks: readonly PlayerWeekView[];
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  readonly kdefSeason: KdefSeasonLine | null;
}

/** WHICH INPUTS PRODUCED THIS DOCUMENT AND WHEN. A rebuild can tell whether anything moved and a
 *  reader can see what the document knows. Every field is an absence when its input is absent. */
export interface PeekDocumentBasis {
  readonly scoringHash: string;
  readonly factsAsOf: string | null;
  readonly capsuleGeneratedAt: string | null;
  readonly capsuleFactsHash: string | null;
  readonly injuryCaptureId: number | null;
  readonly newsCaptureId: number | null;
  readonly lastFinalizedWeek: number | null;
  readonly sourceKeys: readonly string[];
}

/** The complete `PlayerSeasonBody` minus the fields one league contributes live. */
export interface PeekDocument {
  readonly player: Player;
  readonly availableSeasons: readonly number[];
  readonly isRookie: boolean;
  readonly positionRank: number | null;
  readonly adpPercentile: number | null;
  readonly expertRank: number | null;
  readonly modelRank: number | null;
  readonly injuryDesignation: string | null;
  readonly news: readonly { readonly title: string; readonly link: string }[];
  readonly reasons: readonly BoardReason[];
  readonly capsule: PlayerCapsuleView | null;
  readonly dossier: PlayerDossierFacts | null;
  readonly seasons: readonly PeekDocumentSeason[];
  readonly asOf: string;
  readonly basis: PeekDocumentBasis;
}

export interface PeekDocumentRow {
  readonly playerId: string;
  readonly season: number;
  readonly scoringHash: string;
  readonly document: PeekDocument;
  readonly basis: PeekDocumentBasis;
  readonly asOf: Date;
}

/** PURE. Every read it needs has already happened. */
export function buildPeekDocument(input: PeekDocumentInput): PeekDocument;

/** PURE. The document plus the three things one league contributes, as the screen's own body. */
export function hydratePeekDocument(document: PeekDocument, live: PeekDocumentLiveFacts): PlayerSeasonBody;

export interface PeekDocumentLiveFacts {
  readonly ownedBy: string | null;
  readonly isMockLeague: boolean;
  /** The league's own regular season length. Caps the CURRENT season's week axis and nothing else. */
  readonly seasonWeeks: number;
  readonly requestedSeason: number | undefined;
}

/** Every read the documents need, batched over the whole player list once. */
export async function collectPeekDocumentInputs(db: Db, request: PeekDocumentRequest): Promise<readonly PeekDocumentInput[]>;

export interface PeekDocumentRequest {
  readonly season: number;
  readonly scoringHash: string;
  readonly rules: ScoringRules;
  /** `null` means every board-relevant player, which is what a whole-hash build asks for. */
  readonly playerIds: readonly string[] | null;
  readonly asOf: Date;
}

/** Builds and upserts, COALESCE-free, `computed_at` excluded from the change comparison, the
 *  changed-row counting every ingester here keeps. Returns how many were built and how many moved. */
export async function writePeekDocuments(db: Db, request: PeekDocumentRequest): Promise<PeekDocumentWrite>;

export interface PeekDocumentWrite {
  readonly players: number;
  readonly changed: number;
}
```

**Schema**

```ts
export const playerPeekDocuments = pgTable(
  "player_peek_documents",
  {
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    scoringHash: text("scoring_hash").notNull(),
    document: jsonb("document").$type<PeekDocument>().notNull(),
    basis: jsonb("basis").$type<PeekDocumentBasis>().notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("player_peek_documents_document_idx").on(t.season, t.scoringHash, t.playerId, t.asOf),
  ],
);
```

The unique index is also THE read index, leading with the three columns the reader equals on and
ending with the one it orders by, exactly as `player_peek_facts` does.

**Steps**

1. Extract, no behaviour change: move `percentileOf`, `weekViews`, `peerPointsPerGame`,
   `totalsFromLog`, `PlayerWeekView`, `PlayerGameLogRow`, `PlayerSeasonTotals`, `PlayerSeasonStats`,
   plus a new `statsFromLines` that both the current-season and prior-season shapes call, into
   `src/league-service/player-season-stats.ts`. `player.ts` re-exports the three view types so no
   consumer import changes. Run the existing `player.test.ts` to prove nothing moved.

2. RED. `src/capsules/peek-document.test.ts` for the two pure functions:

```ts
it("carries every available season, so a switch needs no fetch", () => {
  const document = buildPeekDocument(inputWithSeasons([2026, 2025, 2024]));
  expect(document.seasons.map((s) => s.season)).toEqual([2026, 2025, 2024]);
});

it("states its own as_of and basis", () => {
  const document = buildPeekDocument(inputWithSeasons([2025]));
  expect(document.asOf).toBe("2026-09-07T12:00:00.000Z");
  expect(document.basis.scoringHash).toBe(HASH);
});

it("hydrates the requested season when the document offers it", () => {
  const body = hydratePeekDocument(document, { ownedBy: "Team One", isMockLeague: false, seasonWeeks: 14, requestedSeason: 2024 });
  expect(body.season).toBe(2024);
  expect(body.weeks).toEqual(document.seasons[2]!.weeks);
});

it("falls back to the newest available season for a season it does not hold", () => {
  const body = hydratePeekDocument(document, { ...live, requestedSeason: 1999 });
  expect(body.season).toBe(2026);
});

it("caps the current season's week axis at the league's own schedule length", () => {
  const body = hydratePeekDocument(document, { ...live, seasonWeeks: 2, requestedSeason: PRODUCT_SEASON });
  expect(body.weeks.map((w) => w.week)).toEqual([1, 2]);
  expect(body.log.every((row) => row.week <= 2)).toBe(true);
  expect(body.totals!.games).toBe(2);
  expect(body.pointsPerGamePercentile).toBeNull();
});

it("leaves a prior season uncapped, since a finished season has no future to cap against", () => {
  const body = hydratePeekDocument(document, { ...live, seasonWeeks: 2, requestedSeason: 2024 });
  expect(body.weeks.length).toBeGreaterThan(2);
});

it("applies the two live league facts", () => {
  const body = hydratePeekDocument(document, { ownedBy: null, isMockLeague: true, seasonWeeks: 14, requestedSeason: undefined });
  expect(body.ownedBy).toBeNull();
  expect(body.isMockLeague).toBe(true);
});
```

3. GREEN. `src/capsules/peek-document.ts`. `hydratePeekDocument` picks the season, applies the cap by
   filtering `weeks` and `log`, recomputes `totals` through the shared `totalsFromLog` and
   `pointsPerGame` from what remains, and sets `pointsPerGamePercentile` to `null` whenever a week was
   dropped (see the ruling below). `laws` stays `chipEligibleLaws(registry())` at hydrate time: it is
   an in-memory registry read, never a query, and a document that froze it would go stale for no gain.

4. RED. `src/capsules/peek-document-store.test.ts` against the test database:

```ts
it("writes one document per player for the hash", async () => {
  const written = await writePeekDocuments(db, request);
  expect(written.players).toBe(2);
  expect(written.changed).toBe(2);
});

it("writes zero changed rows on a second run at the same moment", async () => {
  await writePeekDocuments(db, request);
  expect((await writePeekDocuments(db, request)).changed).toBe(0);
});

it("counts a changed row when one input moves", async () => {
  await writePeekDocuments(db, request);
  await upsertCapsule(db, "rb1", "hash2", capsuleResult("A new capsule."));
  expect((await writePeekDocuments(db, request)).changed).toBe(1);
});

it("keeps two hashes apart", async () => {
  await writePeekDocuments(db, { ...request, scoringHash: pprHash, rules: PPR_SCORING });
  await writePeekDocuments(db, { ...request, scoringHash: stdHash, rules: STANDARD_SCORING });
  const rows = await db.select().from(playerPeekDocuments);
  expect(new Set(rows.map((r) => r.scoringHash)).size).toBe(2);
});

it("scores the weeks under the hash's own rules", async () => {
  // the same week is worth more under PPR than under standard for a receiver
});
```

5. GREEN. `src/capsules/peek-document-inputs.ts` batches: the `players` universe (one read, serving
   identity, `positionRank` and `adpPercentile` for every player at once), the crosswalk, the peek
   facts rows, the capsules, one injury snapshot, one news snapshot, the board reasons, the expert
   and board ranks by gsis id list, the `stat_weeks` played list, the current-season stat lines per
   position, the prior-season lines per (position, season), the kicker and defense archive lines per
   season, and `nfl_players.rookie_season` for the gsis ids. Nothing is read once per player.
   `src/capsules/peek-document-store.ts` maps those onto `buildPeekDocument` and upserts with
   `excludedSetFor`/`changedRowWhere` over the natural key plus `computedAt`.

6. `npm run db:generate`, `npm run db:migrate:test`.
7. `git commit -m "feat(peek): player_peek_documents, one finished document per scoring hash and player"`

**Ruling to record:** the document holds the FULL played-week set and the hydrator applies the
league's schedule cap. When the cap actually drops a week, `pointsPerGamePercentile` becomes absence
rather than the uncapped figure: the percentile's population is every peer's own points per game over
the same weeks, and this reader does not hold that population to recompute it. Storing it would mean
storing every peer's weekly line inside every player's document, which is tens of megabytes per hash
for a comparison that only differs in the last weeks of a short-schedule league's season. Cost if
wrong: a fourteen-week league in NFL week fifteen or later sees an untinted points-per-game number
instead of a tinted one, and no wrong number at any point.

---

## Task 3 — The one-statement reader in `playerSeason`

**Files**
- `src/league-service/player.ts`
- new `src/league-service/player.document.test.ts`
- new `src/league-service/__fixtures__/peek-body-parity.json` (recorded from the pre-change function)

**Interfaces**

```ts
/** The one statement (spec 3.2), written with the query builder. Returns the finished document plus
 *  the live facts one league contributes, or `null` when this league has no document for him. */
async function readPeekDocumentForLeague(db: Db, leagueId: string, playerId: string, season: number, now: Date): Promise<DocumentRead | null>;

interface DocumentRead {
  readonly document: PeekDocument;
  readonly isMockLeague: boolean;
  readonly seasonWeeks: number;
  readonly ownedBy: string | null;
}
```

The statement is one `select` from `leagues`, inner joined to `player_peek_documents` on
`(season, scoring_hash, player_id)`, with two `lateral` joins: the holder (`roster_slots` joined to
`teams` for this league, limit 1) and the league's own schedule length
(`select count(distinct week_number) from matchups where league_id = l.id`, coalesced to
`LEAGUE_CONFIG.regularSeasonWeeks`, which is exactly what `seasonProgress().totalWeeks` answers).
`where l.id = $league and d.as_of <= now`, `order by d.as_of desc limit 1`.

**Steps**

1. Record the parity fixture BEFORE touching `player.ts`: a new test seeds the fixture league and
   players (the shape `player.peek-facts.test.ts` already seeds), calls the current `playerSeason`,
   and writes the JSON to `__fixtures__/peek-body-parity.json` when `PEEK_PARITY_RECORD=1` is set.
   Run it once with the flag, commit the fixture. Without the flag the same test READS the fixture
   and byte-compares, which is the parity assertion for every run after this one.

2. RED. `src/league-service/player.document.test.ts`:

```ts
it("opens a peek in exactly one statement", async () => {
  counting.reset();
  const body = await playerSeason(counting.db, leagueId, "rb1", clock);
  expect(body).not.toBeNull();
  expect(counting.count()).toBe(1);
});

it("returns the same body the pre-change function returned, field by field", async () => {
  const body = await playerSeason(db, leagueId, "rb1", clock);
  const recorded = JSON.parse(readFileSync(PARITY_FIXTURE, "utf8")) as unknown;
  expect(JSON.parse(JSON.stringify(body))).toEqual(recorded);
});

it("names the holder from the live roster, with no document rebuild", async () => {
  await assignSlot(db, { teamId, playerId: "rb1", slot: "RB" });
  const body = await playerSeason(db, leagueId, "rb1", clock);
  expect(body!.ownedBy).toBe("Team One");
  expect(counting.count()).toBe(1);
});

it("reads the latest document at or before now and never a later one", async () => {
  await writePeekDocuments(db, { ...request, asOf: LATER });
  const body = await playerSeason(db, leagueId, "rb1", { now: () => EARLIER.toISOString() });
  expect(body!.capsule!.bodyCompact).toBe(theEarlierCapsule);
});

it("surfaces the document's own as_of", async () => {
  const body = await playerSeason(db, leagueId, "rb1", clock);
  expect(body!.asOf).toBe(NOW.toISOString());
});
```

3. GREEN. Rewrite `playerSeason` as: one statement, `hydratePeekDocument`, return. Add
   `asOf: string` to `PlayerSeasonBody` (the document's own stamp, spec 3.6) and surface it in the
   peek's existing footer legend. Delete from `player.ts` everything the collector now owns
   (`currentSeasonStats`, `priorSeasonStats`, `kdefSeasonStats`, `preseasonReadings`,
   `injuryDesignationFor`, `priorSeasonsWithDataFor`, `isConfirmedRookie`): they moved, they are not
   duplicated.

4. `git commit -m "feat(peek): playerSeason is one statement over a finished document"`

---

## Task 4 — The event enqueues

**Files**
- new `src/jobs/defs/peek-document-job.ts`
- new `src/jobs/defs/peek-document-job.test.ts`
- `src/jobs/registry.ts`
- `src/jobs/defs/season-week-job.ts` (after the finalize and peek-facts steps)
- `src/jobs/defs/capsule-sweep-job.ts` (after the capsule and peek-facts writes)
- `src/capsules/peek-facts.ts` (after `writePeekFacts`)
- `src/league-service/settings.ts` (the scoring settings write path)

**Interfaces**

```ts
export const PEEK_DOCUMENT_JOB_NAME = "peek-document";

export interface PeekDocumentJobPayload {
  readonly scoringHash: string;
  /** `null` means every board-relevant player for this hash. */
  readonly playerIds: readonly string[] | null;
  /** WHY this rebuild exists and WHICH generation of its input asked for it. It is half the
   *  idempotency key, which is what makes two enqueues of the same work before the tick one build. */
  readonly reason: string;
}

/** Every scoring hash a live league is currently using — the "every hash" of the event table. One
 *  read, `select distinct scoring_hash from leagues where scoring_hash is not null`. */
export async function scoringHashesInUse(db: Db): Promise<readonly string[]>;

/** Enqueues one rebuild per hash in use. Swallows its own failures, the discipline
 *  `enqueueDraftGradesJobQuietly` set: a queue insert must never fail the event that caused it. */
export async function enqueuePeekDocumentRebuildsQuietly(db: Db, clock: Clock, scope: PeekRebuildScope): Promise<number>;

export interface PeekRebuildScope {
  readonly playerIds: readonly string[] | null;
  /** The event's own generation stamp: the facts `as_of`, the capsule's facts hash, the finalized
   *  week and its version, the capture id, the new scoring hash. */
  readonly reason: string;
  /** Omitted for a league-agnostic event, which rebuilds every hash in use. Set by the settings
   *  path, which rebuilds exactly one. */
  readonly scoringHashes?: readonly string[];
}
```

Idempotency key: `peek-document:<scoringHash>:<reason>`. Two enqueues naming the same hash and the
same input generation are one row, so the (hash, player) work coalesces before the tick runs.

**The event table, and the test that pins each row**

| Event | Where it fires | Reason stamp | Test |
|---|---|---|---|
| Weekly stats finalize | `season-week-job`, after `peek-facts` | `finalize:<season>:w<week>` | "a finalize enqueues one rebuild per hash in use" |
| Capsule written | `capsule-sweep-job`, after `upsertCapsule` | `capsule:<playerId>:<factsHash>` | "a written capsule enqueues that player for every hash" |
| Peek facts row written | `peek-facts.ts` `writeRefresh` | `facts:<asOf>` | "a facts write enqueues the changed players for every hash" |
| Harvest with changes | `capture-harvest-job`, after the diff | `harvest:<captureId>` | "a harvest that moved an injury enqueues only the players it moved" |
| League scoring settings change | `setScoringSettings` | `settings:<leagueId>:<newHash>` | "a settings change enqueues that hash and no other" |
| Roster change | nothing | none | "an add, a drop and a trade enqueue no rebuild" |

**Steps**

1. RED. `src/jobs/defs/peek-document-job.test.ts` writes the six rows above plus:

```ts
it("coalesces two enqueues of the same hash and generation into one job", async () => {
  await enqueuePeekDocumentRebuildsQuietly(db, clock, scope);
  await enqueuePeekDocumentRebuildsQuietly(db, clock, scope);
  const rows = await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME));
  expect(rows).toHaveLength(1);
});

it("does not coalesce a later generation of the same input", async () => {
  await enqueuePeekDocumentRebuildsQuietly(db, clock, { ...scope, reason: "facts:2026-09-07T04:00:00.000Z" });
  await enqueuePeekDocumentRebuildsQuietly(db, clock, { ...scope, reason: "facts:2026-09-08T04:00:00.000Z" });
  expect(await countJobs(db)).toBe(2);
});

it("enqueues one job per hash in use", async () => {
  await seedLeagueWithHash(db, stdHash);
  await enqueuePeekDocumentRebuildsQuietly(db, clock, scope);
  expect(await hashesEnqueued(db)).toEqual(new Set([pprHash, stdHash]));
});

it("builds the documents the payload names when it runs", async () => {
  const outcome = await runPeekDocumentStep(db, clock, { scoringHash: pprHash, playerIds: ["rb1"], reason: "test" });
  expect(outcome.summary).toContain("1 document");
});
```

2. GREEN. Write the job: one step that backfills any missing league hash (so a fresh deploy
   self-heals), then calls `writePeekDocuments` for the payload's hash and player list. A DB failure
   is ordinary retryable weather; a payload that does not parse dead-letters through the contract's
   own terminal path.
3. Register it, wire the five enqueues.
4. `git commit -m "feat(jobs): peek-document rebuilds, one per input event, coalesced by generation"`

---

## Task 5 — The miss path

**Files**
- `src/league-service/player.ts`
- `src/league-service/player.document.test.ts`

**Steps**

1. RED:

```ts
it("renders a league whose hash has no documents, and asks for the build", async () => {
  await db.delete(playerPeekDocuments);
  const body = await playerSeason(db, leagueId, "rb1", clock);
  expect(body!.player.name).toBe("Volume Back");
  const [job] = await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME));
  expect(job!.payload).toMatchObject({ scoringHash: pprHash, playerIds: null });
});

it("is one statement again on the second open once the build has run", async () => {
  await db.delete(playerPeekDocuments);
  await playerSeason(db, leagueId, "rb1", clock);
  await runPeekDocumentStep(db, clock, { scoringHash: pprHash, playerIds: null, reason: "miss" });
  counting.reset();
  await playerSeason(counting.db, leagueId, "rb1", clock);
  expect(counting.count()).toBe(1);
});

it("returns null for a player who does not exist", async () => {
  expect(await playerSeason(db, leagueId, "nobody", clock)).toBeNull();
});

it("renders absence for a real player with no document", async () => {
  const body = await playerSeason(db, leagueId, "signed-in-october", clock);
  expect(body!.dossier).toBeNull();
  expect(body!.capsule).toBeNull();
  expect(body!.availableSeasons).toEqual([]);
});
```

2. GREEN. On a miss, `playerSeason` builds THAT ONE player's document through the same
   `collectPeekDocumentInputs` and `buildPeekDocument` the writer uses (never a second assembly), and
   enqueues the whole-hash rebuild through `enqueuePeekDocumentRebuildsQuietly`. A player the
   collector produces nothing for returns the existing absence body; a player id that is not in
   `players` at all still returns `null`.
3. `git commit -m "feat(peek): the miss path builds one document through the writer's own builder"`

---

## Task 6 — Harvest cadence and the player-level diff

**Files**
- new `src/projections/harvest-config.ts` (`HARVEST_CONFIG`)
- `src/jobs/schedules.ts` (the harvest cadence reads the config)
- `src/jobs/defs/capture-harvest-job.ts` (the diff and the enqueue)
- `src/jobs/defs/capture-harvest-job.test.ts`
- new `src/projections/harvest-diff.ts` and `src/projections/harvest-diff.test.ts`

**Interfaces**

```ts
/** THE ONE PLACE THE HARVEST'S CADENCE IS SET, with the provider's budget stated beside it. The
 *  provider offers no push, so this feed is polled; hourly through the season's waking hours is what
 *  puts an injury designation on a peek within the hour. */
export const HARVEST_CONFIG = {
  /** Hourly, 07:00 through 23:00 America/New_York. */
  cron: "0 7-23 * * *",
  timezone: "America/New_York",
  /** 17 fires a day times 5 single-request feeds is 85 upstream requests a day at the worst case,
   *  against the purchased Tank01 tier's own daily allowance. */
  firesPerDay: 17,
  requestsPerFire: 5,
  requestsPerDay: 85,
} as const;

/** Which players an injuries or news capture actually moved, against the previous capture of the
 *  same source. Absence of a previous capture is not "everything changed": the first capture of a
 *  source enqueues nothing, since there is no claim it contradicts. */
export function harvestPlayerDiff(previous: HarvestCapture | null, next: HarvestCapture): readonly string[];
```

**Steps**

1. RED. `src/projections/harvest-diff.test.ts`:

```ts
it("names only the players whose designation moved", () => {
  expect(harvestPlayerDiff(injuries({ a: "Q", b: "O" }), injuries({ a: "O", b: "O" }))).toEqual(["a"]);
});

it("names a player the feed dropped, since absence is now the claim", () => {
  expect(harvestPlayerDiff(injuries({ a: "Q" }), injuries({}))).toEqual(["a"]);
});

it("names a player the feed added", () => {
  expect(harvestPlayerDiff(injuries({}), injuries({ a: "Q" }))).toEqual(["a"]);
});

it("returns nothing for an unchanged capture", () => {
  expect(harvestPlayerDiff(injuries({ a: "Q" }), injuries({ a: "Q" }))).toEqual([]);
});

it("returns nothing for a first capture", () => {
  expect(harvestPlayerDiff(null, injuries({ a: "Q" }))).toEqual([]);
});
```

2. GREEN. Write the diff over both harvested feeds a document reads (`tank01_injuries_by_date` for
   the designation and `tank01_news` for the headlines). The news arm diffs the set of story links
   per named player, since that is exactly what the document carries.
3. RED then GREEN in `capture-harvest-job.test.ts`: a captured injuries feed whose designation moved
   for one player enqueues a rebuild naming that player and no other, and an unchanged capture
   enqueues nothing.
4. Point the `capture-harvest-nightly` schedule at `HARVEST_CONFIG` and rename it for its new
   cadence. The nightly pre-dawn fire the capsule sweep depends on stays inside the hourly window.
5. `git commit -m "feat(harvest): hourly cadence in config, player-level diff drives the rebuilds"`

---

## Task 7 — The numbers and the gates

**Files**
- `.superpowers/sdd/peek-document/progress.md`
- `docs/superpowers/plans/2026-09-07-peek-document.md` (the after table)

**Steps**

1. Run `backfillLeagueScoringHashes` and one whole-hash build against the dev database through the
   job's own step function, never a hand-written second writer.
2. `npm run peek:timing <league> <WR> <RB> <K>`, record cold and warm milliseconds and query counts
   beside the before table.
3. Full gates: `npx tsc --noEmit -p .`, `npx eslint` over every touched directory, `npx vitest run`
   over every touched test file plus `player.test.ts`, `player.peek-facts.test.ts`,
   `registry.test.ts` and the job definition tests.
4. `git commit -m "docs(peek-document): before and after harness numbers, gate counts"`
