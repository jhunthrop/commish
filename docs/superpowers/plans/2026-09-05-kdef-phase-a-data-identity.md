# Kicker and Team Defense, Phase A — Data and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The store holds real historical kicking lines and real historical team-defense lines for 2013 through 2025, every product team code resolves to the source's own spelling through one module, every kicker on the league's roster carries a gsis id, and every team defense carries a synthetic historical-universe row a projection can be written against.

**Architecture:** Two new nflverse ingesters in the exact shape `roster-weeks.ts` and `injuries.ts` already take (explicit column allowlist, `assertShape` that refuses a file rather than coarsening it, idempotent COALESCE upsert through `@/db/upsert`, one file per season, regular season only). A third new module, `team-codes.ts`, owns the product-to-source team-code translation and the synthetic defense universe id, and is the only place either mapping is spelled. The crosswalk's unconditional "not an NFL player" answer for DEF becomes a deliberate `team_defense` method edge. Nothing in this plan changes any projected number for any existing position.

**Tech Stack:** TypeScript strict, Drizzle/Postgres (`drizzle-kit generate`, never hand-numbered), vitest, the existing `NflverseClient` CSV reader, the owned Postgres job system for anything recurring (this backfill is a one-shot script, not a job).

**Spec:** `docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §3, §4, §5 Phase A, §6, §7, §8.

## Global Constraints

- Honest data is absolute. Never synthesize a stat, a score or an outcome. Absence renders as absence. A source file missing an allowlisted column fails the ingest loudly rather than coarsening the column to zero.
- Held-out discipline: nothing in this plan fits a parameter, so nothing here reads a held-out season for a fit. The ingest deliberately covers 2013 through 2025 inclusive; 2026 is never ingested by this plan's scripts.
- Regular season only, both tables: `season_type == "REG"`, matching `NFLVERSE_CONFIG.seasonType`.
- Migrations are generated with `npx drizzle-kit generate`, never hand-numbered. The highest existing migration is `drizzle/0077_young_lockjaw.sql`; if drizzle-kit wants a number that already exists, delete its output and regenerate.
- Database work runs against the local dev Postgres named by `.env.local` (`postgres://commish:commish@localhost:5432/commish`). Never a Neon or production URL.
- No em-dashes, no semicolons, no competitor names and no tips in any user-facing string. Nothing in this plan produces user-facing copy; the script console output is operator-facing and follows the existing scripts' style.
- Functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.
- Gates after every task: `npx tsc --noEmit -p .`, `npx eslint <touched dirs>`, `npx vitest run <touched dirs>`.
- Commit messages carry a conventional type prefix and end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS`.

## Verified source facts (checked live, 2026-09-05)

Both releases were fetched and their real headers read before this plan was written.

- `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_<season>.csv`, seasons 1999 through 2025. Carries `player_id` (the gsis id), `player_display_name`, `position`, `season`, `week`, `season_type`, `team`, `opponent_team`, and the kicking block: `fg_made`, `fg_att`, `fg_missed`, `fg_blocked`, `fg_made_0_19`, `fg_made_20_29`, `fg_made_30_39`, `fg_made_40_49`, `fg_made_50_59`, `fg_made_60_`, `fg_missed_0_19`, `fg_missed_20_29`, `fg_missed_30_39`, `fg_missed_40_49`, `fg_missed_50_59`, `fg_missed_60_`, `pat_made`, `pat_att`, `pat_missed`, `pat_blocked`. Kickers are rows whose `position` is exactly `K`. The 2013 header and the 2024 header carry every one of those columns, so there is no schema drift across the covered span.
- `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_<season>.csv`, seasons 1999 through 2025. Carries `season`, `week`, `team`, `season_type`, `opponent_team`, `passing_yards`, `rushing_yards`, `special_teams_tds`, `def_sacks`, `def_interceptions`, `def_tds`, `def_safeties`, `def_punt_blocks`, `def_pat_blocks`, `def_fg_blocks`, `fumble_recovery_opp`. One row per team per game. The 2013 and 2024 headers agree.
- Product team spelling is `NFL_TEAM_ABBREVIATIONS` (`src/projections/capture-feeds.ts`): 32 codes with `LAR` and `WSH`. Source spelling is `CURRENT_32` (`src/projections/nflverse/team-eras.ts`): the same 32 with `LA` and `WAS`. The only two disagreements are those two. `team-eras.ts` additionally knows the historical spellings `STL` (Rams before 2016), `SD` (Chargers before 2017) and `OAK` (Raiders before 2020).

## File map

- Create: `src/projections/nflverse/team-codes.ts` (+ `team-codes.test.ts`) — product/source team-code translation, historical codes, the synthetic defense universe id, and the `DST-` provider id parse. The one module that owns any of it.
- Create: `src/projections/nflverse/kicking-weeks.ts` (+ `kicking-weeks.test.ts`) — the `stats_player` kicking slice.
- Create: `src/projections/nflverse/team-defense-weeks.ts` (+ `team-defense-weeks.test.ts`) — the `stats_team` defense slice, with the opponent join that turns two offense rows into one yards-allowed number.
- Create: `scripts/kdef-backfill.ts` — seeds the 32 synthetic defense universe rows and ingests both releases for 2013 through 2025.
- Modify: `src/projections/nflverse/config.ts` — two new release names.
- Modify: `src/db/schema.ts` — `nflverseKickingWeeks`, `nflverseTeamDefenseWeeks`.
- Modify: `src/projections/crosswalk.ts` — the DEF branch becomes a `team_defense` edge; `crosswalkInputs` reads the synthetic rows.
- Modify: `scripts/build-crosswalk.ts` — seeds the synthetic rows before resolving, and reports the defense edges.
- Modify: `package.json` — one new script, `projections:kdef:backfill`.
- Generate: one migration under `drizzle/`.

---

### Task 1: The team-code module

**Files:**
- Create: `src/projections/nflverse/team-codes.ts`
- Test: `src/projections/nflverse/team-codes.test.ts`

**Interfaces:**
- Consumes: `NFL_TEAM_ABBREVIATIONS` (`@/projections/capture-feeds`), `nflTeamsBySeason` (`./team-eras`), `TANK01_CONFIG.defensePlayerIdPrefix` (`@/stats/tank01/config`).
- Produces:

```typescript
export const TEAM_DEFENSE_UNIVERSE_PREFIX = "team-def:";
export function sourceTeamCode(productCode: string): string;
export function productTeamCode(sourceCode: string): string;
export function teamDefenseUniverseId(sourceCode: string): string;
export function teamDefenseUniverseIdForProviderId(providerId: string): string | null;
export function teamDefenseUniverseIds(): readonly string[];
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";
import { nflTeamsBySeason } from "./team-eras";
import {
  TEAM_DEFENSE_UNIVERSE_PREFIX,
  productTeamCode,
  sourceTeamCode,
  teamDefenseUniverseId,
  teamDefenseUniverseIdForProviderId,
  teamDefenseUniverseIds,
} from "./team-codes";

describe("team codes", () => {
  it("translates the only two clubs the two feeds spell differently", () => {
    expect(sourceTeamCode("LAR")).toBe("LA");
    expect(sourceTeamCode("WSH")).toBe("WAS");
    expect(productTeamCode("LA")).toBe("LAR");
    expect(productTeamCode("WAS")).toBe("WSH");
  });

  it("is the identity for the other thirty", () => {
    for (const code of NFL_TEAM_ABBREVIATIONS) {
      if (code === "LAR" || code === "WSH") continue;
      expect(sourceTeamCode(code)).toBe(code);
      expect(productTeamCode(code)).toBe(code);
    }
  });

  it("round trips every product code through the source spelling", () => {
    for (const code of NFL_TEAM_ABBREVIATIONS) {
      expect(productTeamCode(sourceTeamCode(code))).toBe(code);
    }
  });

  it("maps the three historical spellings onto the franchise's current product code", () => {
    expect(productTeamCode("STL")).toBe("LAR");
    expect(productTeamCode("SD")).toBe("LAC");
    expect(productTeamCode("OAK")).toBe("LV");
  });

  it("covers every code the source itself used in the ingested span", () => {
    for (let season = 2013; season <= 2025; season += 1) {
      for (const code of nflTeamsBySeason(season)) {
        expect(() => productTeamCode(code)).not.toThrow();
      }
    }
  });

  it("refuses an unknown code on both sides rather than passing it through", () => {
    expect(() => sourceTeamCode("XXX")).toThrow(/XXX/);
    expect(() => productTeamCode("XXX")).toThrow(/XXX/);
  });

  it("mints one synthetic universe id per source code and parses the provider id back", () => {
    expect(teamDefenseUniverseId("LA")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}LA`);
    expect(teamDefenseUniverseIdForProviderId("DST-LAR")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}LA`);
    expect(teamDefenseUniverseIdForProviderId("DST-WSH")).toBe(`${TEAM_DEFENSE_UNIVERSE_PREFIX}WAS`);
    expect(teamDefenseUniverseIdForProviderId("DST-XXX")).toBeNull();
    expect(teamDefenseUniverseIdForProviderId("4362628")).toBeNull();
  });

  it("holds exactly thirty two synthetic universe ids, all distinct", () => {
    const ids = teamDefenseUniverseIds();
    expect(ids).toHaveLength(32);
    expect(new Set(ids).size).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/nflverse/team-codes.test.ts`
Expected: FAIL, "Failed to resolve import ./team-codes".

- [ ] **Step 3: Write minimal implementation**

```typescript
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";

/**
 * THE ONE PLACE THE TWO TEAM SPELLINGS MEET.
 *
 * Two feeds name the same 32 clubs and disagree about exactly two of them: the product's stats
 * provider spells the Rams `LAR` and Washington `WSH` (`NFL_TEAM_ABBREVIATIONS`,
 * `capture-feeds.ts`), and nflverse spells them `LA` and `WAS` (`CURRENT_32`, `team-eras.ts`).
 * Every other code is identical on both sides. Until this module existed there was no join between
 * the two lists at all, so a team-level historical fact could not be attached to the defense a
 * manager drafts.
 *
 * IT ALSO CARRIES THE THREE HISTORICAL SPELLINGS, in one direction only. nflverse's files use the
 * contemporary code (`STL` through 2015, `SD` through 2016, `OAK` through 2019) and the product has
 * no spelling for a franchise's old city at all, so `productTeamCode` folds them onto the current
 * code and `sourceTeamCode` never emits one. That asymmetry is deliberate: a 2014 Rams defense row
 * belongs to today's `DST-LAR`, and there is no question the other way round to answer.
 *
 * AND THE SYNTHETIC UNIVERSE ID. A team defense is not a person, so nflverse has no row for it and
 * `nfl_players` (whose id is a gsis id) has nowhere to hang one. `preseason_projections` has a
 * foreign key into that table and every reader joins through `player_crosswalk`, so the path of
 * least surgery is a synthetic universe row per club rather than a parallel projection store. The
 * id is `team-def:<source code>` and it is minted HERE so `crosswalk.ts`, the backfill script and
 * any future reader cannot disagree about its shape.
 */
export const TEAM_DEFENSE_UNIVERSE_PREFIX = "team-def:";

/** Product spelling to source spelling. Only two clubs differ; the rest are the identity. */
const PRODUCT_TO_SOURCE: Readonly<Record<string, string>> = { LAR: "LA", WSH: "WAS" };

/**
 * Source spelling to product spelling, INCLUDING the three franchises that played the early part of
 * the ingested span under a different city. `team-eras.ts` is the authority on which seasons each
 * applies to; this map does not need the season because no two franchises ever shared a code.
 */
const SOURCE_TO_PRODUCT: Readonly<Record<string, string>> = {
  LA: "LAR",
  WAS: "WSH",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
};

const PRODUCT_CODES: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

export function sourceTeamCode(productCode: string): string {
  if (!PRODUCT_CODES.has(productCode)) {
    throw new Error(
      `${productCode} is not one of the 32 product team codes (\`NFL_TEAM_ABBREVIATIONS\`). A team code that maps to nothing would silently drop a whole club's history.`,
    );
  }
  return PRODUCT_TO_SOURCE[productCode] ?? productCode;
}

export function productTeamCode(sourceCode: string): string {
  const mapped = SOURCE_TO_PRODUCT[sourceCode];
  if (mapped !== undefined) return mapped;
  if (!PRODUCT_CODES.has(sourceCode)) {
    throw new Error(
      `${sourceCode} is not a team code either feed uses. nflverse's own spelling for the covered span is \`nflTeamsBySeason\` (\`team-eras.ts\`); a code outside it means the release changed.`,
    );
  }
  return sourceCode;
}

export function teamDefenseUniverseId(sourceCode: string): string {
  return `${TEAM_DEFENSE_UNIVERSE_PREFIX}${sourceCode}`;
}

/**
 * The synthetic universe id for one product defense id (`DST-LAR`), or `null` for anything that is
 * not one. `null` rather than a throw because this is called over the whole provider roster, where
 * a non-defense id is the normal case and not an error.
 */
export function teamDefenseUniverseIdForProviderId(providerId: string): string | null {
  const prefix = TANK01_CONFIG.defensePlayerIdPrefix;
  if (!providerId.startsWith(prefix)) return null;
  const productCode = providerId.slice(prefix.length);
  if (!PRODUCT_CODES.has(productCode)) return null;
  return teamDefenseUniverseId(sourceTeamCode(productCode));
}

/** All 32 synthetic ids, in the source's own spelling, sorted. What the backfill seeds. */
export function teamDefenseUniverseIds(): readonly string[] {
  return NFL_TEAM_ABBREVIATIONS.map((code) => teamDefenseUniverseId(sourceTeamCode(code))).sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/nflverse/team-codes.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .` then `npx eslint src/projections/nflverse`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/nflverse/team-codes.ts src/projections/nflverse/team-codes.test.ts
git commit -m "$(cat <<'EOF'
feat(projections): one module owns the product and source team spellings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 2: The two history tables

**Files:**
- Modify: `src/db/schema.ts` (append after `nflverseRosterWeeks`, around line 2368)
- Modify: `src/projections/nflverse/config.ts` (`releases`)
- Generate: `drizzle/00NN_*.sql`

**Interfaces:**
- Consumes: `pgTable`, `integer`, `text`, `real`, `timestamp`, `primaryKey`, `index` already imported by `schema.ts`; `nflPlayers` for the kicking table's foreign key.
- Produces: `nflverseKickingWeeks`, `nflverseTeamDefenseWeeks` exported from `@/db/schema`; `NFLVERSE_CONFIG.releases.statsPlayer` and `NFLVERSE_CONFIG.releases.statsTeam`.

- [ ] **Step 1: Add the two release names**

In `src/projections/nflverse/config.ts`, inside `releases`, after `draftPicks`:

```typescript
    /**
     * PER-PLAYER WEEKLY LINES, the modern release (1999 to 2025). This adapter already reads
     * `player_stats` for the four skill positions; this entry names the SAME family under its
     * current asset spelling because the kicking block (`fg_made`, the six made-by-distance
     * buckets, the six missed-by-distance buckets, `pat_made`/`pat_att`/`pat_missed`/`pat_blocked`)
     * is what a kicker's projection is composed from and no other file carries it. Read by
     * `kicking-weeks.ts`, which keeps ONLY rows whose `position` is `K` and only the kicking
     * columns: this is not a second opinion about who is projectable, it is a different STATISTIC
     * about a different position.
     */
    statsPlayer: "stats_player",
    /**
     * PER-TEAM WEEKLY LINES (1999 to 2025) — the only place a TEAM defense's own counting stats
     * exist in the right shape. The per-player defensive columns this adapter already refuses are
     * refused for a good reason (a linebacker's sacks are not a team stat); this release publishes
     * the team's own totals directly. Read by `team-defense-weeks.ts`, which also uses each row's
     * `passing_yards` and `rushing_yards` as the OPPONENT's yards allowed.
     */
    statsTeam: "stats_team",
```

- [ ] **Step 2: Write the failing test**

Create `src/db/kdef-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { nflverseKickingWeeks, nflverseTeamDefenseWeeks } from "./schema";

describe("the kicking and team-defense history tables", () => {
  it("keys a kicking row on season, week and player", () => {
    const config = getTableConfig(nflverseKickingWeeks);
    expect(config.name).toBe("nflverse_kicking_weeks");
    const key = config.primaryKeys[0];
    expect(key?.columns.map((column) => column.name)).toEqual(["season", "week", "player_id"]);
  });

  it("stores every distance bucket the release publishes, made and missed alike", () => {
    const columns = new Set(getTableConfig(nflverseKickingWeeks).columns.map((column) => column.name));
    for (const bucket of ["0_19", "20_29", "30_39", "40_49", "50_59", "60"]) {
      expect(columns.has(`fg_made_${bucket}`)).toBe(true);
      expect(columns.has(`fg_missed_${bucket}`)).toBe(true);
    }
  });

  it("keys a team-defense row on season, week and team", () => {
    const config = getTableConfig(nflverseTeamDefenseWeeks);
    expect(config.name).toBe("nflverse_team_defense_weeks");
    const key = config.primaryKeys[0];
    expect(key?.columns.map((column) => column.name)).toEqual(["season", "week", "team"]);
  });

  it("carries yards allowed as its own column, already in the defense frame", () => {
    const columns = new Set(getTableConfig(nflverseTeamDefenseWeeks).columns.map((column) => column.name));
    expect(columns.has("passing_yards_allowed")).toBe(true);
    expect(columns.has("rushing_yards_allowed")).toBe(true);
    expect(columns.has("opponent_team")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/kdef-schema.test.ts`
Expected: FAIL, `nflverseKickingWeeks` is not exported.

- [ ] **Step 4: Add the tables to `src/db/schema.ts`**

```typescript
/**
 * THE HISTORICAL KICKING RECORD, one row per (season, week, kicker), exactly as the release
 * published it.
 *
 * WHY IT DID NOT ALREADY EXIST. `player_week_observations` is built by a mapper that reads the
 * skill-position columns of the same file and nothing else, so a kicker has never had a row in this
 * store at all. A preseason board that ranks kickers needs the four quantities a kicker's fantasy
 * season decomposes into (field-goal attempts, field-goal make rate, extra-point attempts,
 * extra-point make rate) and every one of them is in this file and nowhere else we hold.
 *
 * THE DISTANCE BUCKETS ARE STORED AND NOT YET SCORED, deliberately (spec §2, §9). The product's
 * scoring shape carries ONE flat field-goal weight and the live in-season feed carries no distance
 * at all, so a distance-weighted preset would be a projection nothing could ever be scored against.
 * The history does carry the buckets, storing them costs one column each, and NOT storing them
 * would mean re-ingesting thirteen seasons the day the scoring shape widens. `fg_made` is the sum
 * of the six made buckets in every row of the real files checked; the buckets are archived beside
 * it rather than derived from it, because a derived total that disagreed with the published one
 * would be silently wrong in exactly the direction nobody checks.
 *
 * REGULAR SEASON ONLY (`NFLVERSE_CONFIG.seasonType`), matching every other ingester here.
 */
export const nflverseKickingWeeks = pgTable(
  "nflverse_kicking_weeks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => nflPlayers.id, { onDelete: "cascade" }),
    /** The club the row lists him with. nflverse's own team code, UNMAPPED — `team-codes.ts` is
     *  where a reader translates it, so the archive stays a verbatim copy of what was published. */
    team: text("team").notNull(),
    fieldGoalsMade: integer("fg_made").notNull(),
    fieldGoalsAttempted: integer("fg_att").notNull(),
    fieldGoalsMissed: integer("fg_missed").notNull(),
    fieldGoalsBlocked: integer("fg_blocked").notNull(),
    fieldGoalsMade0To19: integer("fg_made_0_19").notNull(),
    fieldGoalsMade20To29: integer("fg_made_20_29").notNull(),
    fieldGoalsMade30To39: integer("fg_made_30_39").notNull(),
    fieldGoalsMade40To49: integer("fg_made_40_49").notNull(),
    fieldGoalsMade50To59: integer("fg_made_50_59").notNull(),
    fieldGoalsMade60Plus: integer("fg_made_60").notNull(),
    fieldGoalsMissed0To19: integer("fg_missed_0_19").notNull(),
    fieldGoalsMissed20To29: integer("fg_missed_20_29").notNull(),
    fieldGoalsMissed30To39: integer("fg_missed_30_39").notNull(),
    fieldGoalsMissed40To49: integer("fg_missed_40_49").notNull(),
    fieldGoalsMissed50To59: integer("fg_missed_50_59").notNull(),
    fieldGoalsMissed60Plus: integer("fg_missed_60").notNull(),
    extraPointsMade: integer("pat_made").notNull(),
    extraPointsAttempted: integer("pat_att").notNull(),
    extraPointsMissed: integer("pat_missed").notNull(),
    extraPointsBlocked: integer("pat_blocked").notNull(),
    source: text("source").notNull().default("nflverse_kicking_weeks"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The natural key IS the primary key, for the identical reason `nflverse_roster_weeks` gives:
     *  the writer upserts on conflict and a surrogate rewritten on every re-ingested row would be
     *  worse than none. `ingested_at` is excluded from the update set by the writer. */
    primaryKey({ columns: [t.season, t.week, t.playerId] }),
    /** The component fit's own read: every week one kicker played, one season at a time. */
    index("nflverse_kicking_weeks_player_season_idx").on(t.playerId, t.season, t.week),
    /** The team-opportunity read: every kicking week a club produced, whoever kicked it. */
    index("nflverse_kicking_weeks_team_season_idx").on(t.team, t.season, t.week),
  ],
);

/**
 * THE HISTORICAL TEAM-DEFENSE RECORD, one row per (season, week, team), already in the frame a
 * fantasy defense is scored in.
 *
 * WHY THE PER-PLAYER FILE COULD NOT ANSWER THIS. `map.ts` deliberately refuses the per-person
 * defensive columns, and it is right to: a linebacker's three sacks are a fact about him, and
 * summing a roster's worth of them back into a team total would depend on every man on that
 * defense having a row in a file built for fantasy skill positions. The team release publishes the
 * team's own totals directly, which is the quantity being projected.
 *
 * YARDS ALLOWED IS COMPUTED AT INGEST, NOT AT READ TIME. The release's `passing_yards` and
 * `rushing_yards` on a row are that team's OWN offense. A defense's yards allowed is its
 * opponent's, so the ingester joins each game's two rows and writes the opponent's numbers here
 * under names that say whose they are. Doing it once at ingest rather than on every read is what
 * keeps a later reader from having to know the join exists and getting it backwards.
 *
 * POINTS ALLOWED IS NOT HERE. It already exists: the schedule ingester (`schedule.ts`) stores every
 * game's score as team observations, so a defense's points allowed is a join away and duplicating
 * it would create a second number that could disagree with the first.
 *
 * NO FOREIGN KEY, because a team code is not a `nfl_players.id` and the 32 synthetic universe rows
 * (`team-codes.ts`'s `teamDefenseUniverseId`) exist for the PROJECTION store's key, not this one.
 * This table is an archive of a published file and is keyed the way the file is.
 */
export const nflverseTeamDefenseWeeks = pgTable(
  "nflverse_team_defense_weeks",
  {
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    /** nflverse's own team code, UNMAPPED, contemporary to the season (`STL`, `SD`, `OAK` appear in
     *  the early seasons of the covered span). `team-codes.ts` translates on read. */
    team: text("team").notNull(),
    /** Who they played. Carried so the yards-allowed join is auditable after the fact. */
    opponentTeam: text("opponent_team").notNull(),
    sacks: real("def_sacks").notNull(),
    interceptions: integer("def_interceptions").notNull(),
    fumbleRecoveries: integer("fumble_recovery_opp").notNull(),
    defensiveTouchdowns: integer("def_tds").notNull(),
    safeties: integer("def_safeties").notNull(),
    puntBlocks: integer("def_punt_blocks").notNull(),
    extraPointBlocks: integer("def_pat_blocks").notNull(),
    fieldGoalBlocks: integer("def_fg_blocks").notNull(),
    specialTeamsTouchdowns: integer("special_teams_tds").notNull(),
    /** THE OPPONENT's passing yards in this game. See the table docblock. */
    passingYardsAllowed: integer("passing_yards_allowed").notNull(),
    /** THE OPPONENT's rushing yards in this game. See the table docblock. */
    rushingYardsAllowed: integer("rushing_yards_allowed").notNull(),
    source: text("source").notNull().default("nflverse_team_defense_weeks"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.week, t.team] }),
    index("nflverse_team_defense_weeks_team_season_idx").on(t.team, t.season, t.week),
  ],
);
```

`def_sacks` is `real` and not `integer` because a shared sack is credited as a half in the
published file. Every other column is a whole count in every row of the real files checked.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/kdef-schema.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`
Expected: one new file `drizzle/0078_*.sql` creating both tables. Read it. If drizzle-kit chose a
number that already exists under `drizzle/`, delete the generated file and its journal entry and
rerun rather than renaming anything by hand.

- [ ] **Step 7: Apply it to the dev database**

Run: `npm run db:migrate`
Expected: applies cleanly. Confirm with
`npx dotenv -e .env.local -- npx drizzle-kit check` reporting no drift.

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit -p .` then `npx eslint src/db src/projections/nflverse` then
`npx vitest run src/db`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/kdef-schema.test.ts src/projections/nflverse/config.ts drizzle
git commit -m "$(cat <<'EOF'
feat(db): kicking and team-defense weekly history tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 3: The kicking ingester

**Files:**
- Create: `src/projections/nflverse/kicking-weeks.ts`
- Test: `src/projections/nflverse/kicking-weeks.test.ts`

**Interfaces:**
- Consumes: `CsvRow` (`./csv`), `NFLVERSE_CONFIG` (`./config`), `NflverseClient` (`./client`), `Db`/`ReadonlyDb` (`@/db/client`), `nflverseKickingWeeks`/`nflPlayers` (`@/db/schema`), `changedRowWhere`/`excludedSetFor` (`@/db/upsert`).
- Produces:

```typescript
export interface KickingWeekRow {
  readonly season: number; readonly week: number; readonly playerId: string; readonly team: string;
  readonly fieldGoalsMade: number; readonly fieldGoalsAttempted: number;
  readonly fieldGoalsMissed: number; readonly fieldGoalsBlocked: number;
  readonly fieldGoalsMade0To19: number; readonly fieldGoalsMade20To29: number;
  readonly fieldGoalsMade30To39: number; readonly fieldGoalsMade40To49: number;
  readonly fieldGoalsMade50To59: number; readonly fieldGoalsMade60Plus: number;
  readonly fieldGoalsMissed0To19: number; readonly fieldGoalsMissed20To29: number;
  readonly fieldGoalsMissed30To39: number; readonly fieldGoalsMissed40To49: number;
  readonly fieldGoalsMissed50To59: number; readonly fieldGoalsMissed60Plus: number;
  readonly extraPointsMade: number; readonly extraPointsAttempted: number;
  readonly extraPointsMissed: number; readonly extraPointsBlocked: number;
}
export const KICKING_WEEK_SOURCE = "nflverse_kicking_weeks";
export function mapKickingWeekRows(rows: readonly CsvRow[]): readonly KickingWeekRow[];
export async function recordKickingWeekRows(db: Db, rows: readonly KickingWeekRow[]): Promise<number>;
export interface KickingWeekIngestReport {
  readonly season: number; readonly rowsRead: number; readonly kickerRows: number;
  readonly written: number; readonly unknownToUniverse: number;
}
export async function ingestKickingWeeks(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<readonly KickingWeekIngestReport[]>;
export async function kickingWeekRowsFor(db: ReadonlyDb, playerId: string, seasons: readonly number[]): Promise<readonly KickingWeekRow[]>;
export async function kickingWeekRowsForSeasons(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly KickingWeekRow[]>;
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { mapKickingWeekRows } from "./kicking-weeks";

const KICKING_COLUMNS = [
  "fg_made", "fg_att", "fg_missed", "fg_blocked",
  "fg_made_0_19", "fg_made_20_29", "fg_made_30_39", "fg_made_40_49", "fg_made_50_59", "fg_made_60_",
  "fg_missed_0_19", "fg_missed_20_29", "fg_missed_30_39", "fg_missed_40_49", "fg_missed_50_59", "fg_missed_60_",
  "pat_made", "pat_att", "pat_missed", "pat_blocked",
] as const;

function row(overrides: Partial<CsvRow> = {}): CsvRow {
  const base: Record<string, string> = {
    player_id: "00-0023853",
    position: "K",
    season: "2024",
    week: "1",
    season_type: "REG",
    team: "ARI",
  };
  for (const column of KICKING_COLUMNS) base[column] = "0";
  return { ...base, ...overrides };
}

describe("mapKickingWeekRows", () => {
  it("keeps a kicker's regular-season week and reads every published column", () => {
    const mapped = mapKickingWeekRows([
      row({ fg_made: "2", fg_att: "2", fg_made_20_29: "1", fg_made_30_39: "1", pat_made: "2", pat_att: "2" }),
    ]);
    expect(mapped).toEqual([
      {
        season: 2024, week: 1, playerId: "00-0023853", team: "ARI",
        fieldGoalsMade: 2, fieldGoalsAttempted: 2, fieldGoalsMissed: 0, fieldGoalsBlocked: 0,
        fieldGoalsMade0To19: 0, fieldGoalsMade20To29: 1, fieldGoalsMade30To39: 1,
        fieldGoalsMade40To49: 0, fieldGoalsMade50To59: 0, fieldGoalsMade60Plus: 0,
        fieldGoalsMissed0To19: 0, fieldGoalsMissed20To29: 0, fieldGoalsMissed30To39: 0,
        fieldGoalsMissed40To49: 0, fieldGoalsMissed50To59: 0, fieldGoalsMissed60Plus: 0,
        extraPointsMade: 2, extraPointsAttempted: 2, extraPointsMissed: 0, extraPointsBlocked: 0,
      },
    ]);
  });

  it("drops every row that is not a kicker", () => {
    expect(mapKickingWeekRows([row({ player_id: "00-0023459", position: "QB" })])).toEqual([]);
  });

  it("drops the postseason", () => {
    expect(mapKickingWeekRows([row({ season_type: "POST" })])).toEqual([]);
  });

  it("drops a kicker with no gsis id rather than refusing the file", () => {
    expect(mapKickingWeekRows([row({ player_id: "" })])).toEqual([]);
  });

  it("refuses a file missing an allowlisted column rather than reading it as zero", () => {
    const missing = { ...row() };
    delete (missing as Record<string, string | undefined>).fg_made_50_59;
    expect(() => mapKickingWeekRows([missing])).toThrow(/fg_made_50_59/);
  });

  it("refuses a row whose counting column is not a number, rather than coarsening it", () => {
    expect(() => mapKickingWeekRows([row({ fg_made: "n/a" })])).toThrow(/fg_made/);
  });

  it("reads an empty counting cell as zero, which is what the release means by it", () => {
    expect(mapKickingWeekRows([row({ fg_blocked: "" })])[0]?.fieldGoalsBlocked).toBe(0);
  });

  it("takes the last row for a duplicated key and returns season, week, player order", () => {
    const mapped = mapKickingWeekRows([
      row({ week: "2", fg_made: "1" }),
      row({ week: "1", fg_made: "3" }),
      row({ week: "1", fg_made: "4" }),
    ]);
    expect(mapped.map((r) => [r.week, r.fieldGoalsMade])).toEqual([[1, 4], [2, 1]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/nflverse/kicking-weeks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflverseKickingWeeks, nflPlayers } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import { NFLVERSE_CONFIG } from "./config";
import type { NflverseClient } from "./client";
import type { CsvRow } from "./csv";

/**
 * THE HISTORICAL KICKING RECORD, ARCHIVED VERBATIM — one row per (season, week, gsis id).
 *
 * VERIFIED AGAINST THE LIVE RELEASE (2026-09-05), NOT ASSUMED. The asset family is `stats_player`,
 * one file per season, `stats_player_week_<season>.csv`. The 2013 header and the 2024 header were
 * both fetched and both carry every column in `REQUIRED_COLUMNS` below, so there is no schema drift
 * across the span this module ingests.
 *
 * A DELIBERATELY DIFFERENT SLICE OF A FILE THIS ADAPTER ALREADY READS, the same split
 * `roster-weeks.ts` describes against `preseason/rosters.ts`. `map.ts` reads the skill-position
 * columns of this same family and gates its rows through `isProjectedCandidate`, which narrows to
 * QB, RB, WR and TE and therefore has never emitted a single kicker row. This module reads the
 * KICKING columns of the same file for the rows the other one drops. The two never write the same
 * table and never disagree, because they do not overlap at all.
 *
 * KICKERS ARE `position == "K"`, THE FILE'S OWN SPELLING, and that is not the second-opinion defect
 * `players.ts` retired. That defect was two DIFFERENT vocabularies narrowing the same population
 * twice, where the file's ran first and silently won. There is one narrowing here and no universe
 * position to disagree with it: a kicking line belongs to whoever kicked, and every kicking row in
 * the real files carries `K`. A row with kicking numbers under any other spelling would be a
 * position player who attempted a field goal in a blowout, which is not a fantasy kicker and is
 * correctly dropped.
 */

export interface KickingWeekRow {
  readonly season: number;
  readonly week: number;
  /** The gsis id, matching `nfl_players.id`. */
  readonly playerId: string;
  /** nflverse's own team code, unmapped. `team-codes.ts` translates on read. */
  readonly team: string;
  readonly fieldGoalsMade: number;
  readonly fieldGoalsAttempted: number;
  readonly fieldGoalsMissed: number;
  readonly fieldGoalsBlocked: number;
  readonly fieldGoalsMade0To19: number;
  readonly fieldGoalsMade20To29: number;
  readonly fieldGoalsMade30To39: number;
  readonly fieldGoalsMade40To49: number;
  readonly fieldGoalsMade50To59: number;
  readonly fieldGoalsMade60Plus: number;
  readonly fieldGoalsMissed0To19: number;
  readonly fieldGoalsMissed20To29: number;
  readonly fieldGoalsMissed30To39: number;
  readonly fieldGoalsMissed40To49: number;
  readonly fieldGoalsMissed50To59: number;
  readonly fieldGoalsMissed60Plus: number;
  readonly extraPointsMade: number;
  readonly extraPointsAttempted: number;
  readonly extraPointsMissed: number;
  readonly extraPointsBlocked: number;
}

/** The file's own column name for each numeric field this module reads. One table so the allowlist,
 *  the parse and the shape assertion can never drift apart. */
const NUMERIC_COLUMNS: Readonly<Record<keyof Omit<KickingWeekRow, "season" | "week" | "playerId" | "team">, string>> = {
  fieldGoalsMade: "fg_made",
  fieldGoalsAttempted: "fg_att",
  fieldGoalsMissed: "fg_missed",
  fieldGoalsBlocked: "fg_blocked",
  fieldGoalsMade0To19: "fg_made_0_19",
  fieldGoalsMade20To29: "fg_made_20_29",
  fieldGoalsMade30To39: "fg_made_30_39",
  fieldGoalsMade40To49: "fg_made_40_49",
  fieldGoalsMade50To59: "fg_made_50_59",
  fieldGoalsMade60Plus: "fg_made_60_",
  fieldGoalsMissed0To19: "fg_missed_0_19",
  fieldGoalsMissed20To29: "fg_missed_20_29",
  fieldGoalsMissed30To39: "fg_missed_30_39",
  fieldGoalsMissed40To49: "fg_missed_40_49",
  fieldGoalsMissed50To59: "fg_missed_50_59",
  fieldGoalsMissed60Plus: "fg_missed_60_",
  extraPointsMade: "pat_made",
  extraPointsAttempted: "pat_att",
  extraPointsMissed: "pat_missed",
  extraPointsBlocked: "pat_blocked",
};

/** The position spelling a fantasy kicker carries in this release, every row of every file checked. */
const KICKER_POSITION = "K";

/**
 * Every column this module reads, checked against the file's own header before a single row is
 * mapped — the identical discipline `roster-weeks.ts` applies and for the identical reason: a column
 * silently missing would read as `undefined`, coarsen to 0, and produce a kicker who never attempted
 * a field goal from a season in which he attempted thirty. That is indistinguishable from a real
 * backup, so it would never be caught by looking at the output.
 */
const REQUIRED_COLUMNS: readonly string[] = [
  "player_id", "position", "season", "week", "season_type", "team",
  ...Object.values(NUMERIC_COLUMNS),
];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse stats_player file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would read every missing column as zero and produce a kicker who never kicked.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/**
 * One counting cell. An EMPTY cell is 0 — that is what the release means by it, and every kicking
 * cell on a non-kicker's row is empty or zero. Anything else that is not a finite number THROWS,
 * because a count this module cannot read is a count it must not guess at.
 */
function count(row: CsvRow, column: string): number {
  const raw = trimmed(row[column]);
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse stats_player row has an unreadable ${column} (${JSON.stringify(row[column])}).`);
  }
  return value;
}

export function mapKickingWeekRows(rows: readonly CsvRow[]): readonly KickingWeekRow[] {
  assertShape(rows);
  const byKey = new Map<string, KickingWeekRow>();
  for (const row of rows) {
    if (trimmed(row.season_type) !== NFLVERSE_CONFIG.seasonType) continue;
    if (trimmed(row.position) !== KICKER_POSITION) continue;
    const playerId = trimmed(row.player_id);
    if (playerId === "") continue;

    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(
        `nflverse stats_player row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`,
      );
    }
    const team = trimmed(row.team);
    if (team === "") continue;

    const numbers = Object.fromEntries(
      Object.entries(NUMERIC_COLUMNS).map(([field, column]) => [field, count(row, column)]),
    ) as Omit<KickingWeekRow, "season" | "week" | "playerId" | "team">;
    byKey.set(`${season}|${week}|${playerId}`, { season, week, playerId, team, ...numbers });
  }
  return [...byKey.values()].sort(
    (a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId),
  );
}

/** Postgres's bound-parameter ceiling, matching every other writer in this adapter. */
const INSERT_CHUNK_ROWS = 1_000;

/** `nflverseKickingWeeks`'s natural key, plus `ingestedAt`, which names when a row was FIRST
 *  written and must never be overwritten by a re-ingestion. */
const NATURAL_KEYS: readonly string[] = ["season", "week", "playerId", "ingestedAt"];

export const KICKING_WEEK_SOURCE = "nflverse_kicking_weeks";

/** Upserts, never `onConflictDoNothing`: nflverse republishes a corrected week and freezing whichever
 *  backfill ran first would make the archive a record of an operator's timing. `changedRowWhere`
 *  keeps a re-run over unchanged rows a true no-op, so a landed season reports 0 written. */
export async function recordKickingWeekRows(db: Db, rows: readonly KickingWeekRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row, source: KICKING_WEEK_SOURCE }));
    const result = await db
      .insert(nflverseKickingWeeks)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseKickingWeeks.season, nflverseKickingWeeks.week, nflverseKickingWeeks.playerId],
        set: excludedSetFor(nflverseKickingWeeks, NATURAL_KEYS),
        where: changedRowWhere(nflverseKickingWeeks, NATURAL_KEYS),
      })
      .returning({ season: nflverseKickingWeeks.season });
    written += result.length;
  }
  return written;
}

async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

export interface KickingWeekIngestReport {
  readonly season: number;
  /** Every row the file carried, before any filter. */
  readonly rowsRead: number;
  /** Rows that were a kicker's regular-season week. */
  readonly kickerRows: number;
  readonly written: number;
  /** Kickers the historical universe does not hold, reported and never silently lost. */
  readonly unknownToUniverse: number;
}

export async function ingestKickingWeeks(
  db: Db,
  client: NflverseClient,
  seasons: readonly number[],
): Promise<readonly KickingWeekIngestReport[]> {
  const known = await knownPlayerIds(db);
  const reports: KickingWeekIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.statsPlayer, `stats_player_week_${season}.csv`);
    const mapped = mapKickingWeekRows(rows);
    const insertable = mapped.filter((row) => known.has(row.playerId));
    const written = await recordKickingWeekRows(db, insertable);
    reports.push({
      season,
      rowsRead: rows.length,
      kickerRows: mapped.length,
      written,
      unknownToUniverse: mapped.length - insertable.length,
    });
  }
  return reports;
}

const SELECTION = {
  season: nflverseKickingWeeks.season,
  week: nflverseKickingWeeks.week,
  playerId: nflverseKickingWeeks.playerId,
  team: nflverseKickingWeeks.team,
  fieldGoalsMade: nflverseKickingWeeks.fieldGoalsMade,
  fieldGoalsAttempted: nflverseKickingWeeks.fieldGoalsAttempted,
  fieldGoalsMissed: nflverseKickingWeeks.fieldGoalsMissed,
  fieldGoalsBlocked: nflverseKickingWeeks.fieldGoalsBlocked,
  fieldGoalsMade0To19: nflverseKickingWeeks.fieldGoalsMade0To19,
  fieldGoalsMade20To29: nflverseKickingWeeks.fieldGoalsMade20To29,
  fieldGoalsMade30To39: nflverseKickingWeeks.fieldGoalsMade30To39,
  fieldGoalsMade40To49: nflverseKickingWeeks.fieldGoalsMade40To49,
  fieldGoalsMade50To59: nflverseKickingWeeks.fieldGoalsMade50To59,
  fieldGoalsMade60Plus: nflverseKickingWeeks.fieldGoalsMade60Plus,
  fieldGoalsMissed0To19: nflverseKickingWeeks.fieldGoalsMissed0To19,
  fieldGoalsMissed20To29: nflverseKickingWeeks.fieldGoalsMissed20To29,
  fieldGoalsMissed30To39: nflverseKickingWeeks.fieldGoalsMissed30To39,
  fieldGoalsMissed40To49: nflverseKickingWeeks.fieldGoalsMissed40To49,
  fieldGoalsMissed50To59: nflverseKickingWeeks.fieldGoalsMissed50To59,
  fieldGoalsMissed60Plus: nflverseKickingWeeks.fieldGoalsMissed60Plus,
  extraPointsMade: nflverseKickingWeeks.extraPointsMade,
  extraPointsAttempted: nflverseKickingWeeks.extraPointsAttempted,
  extraPointsMissed: nflverseKickingWeeks.extraPointsMissed,
  extraPointsBlocked: nflverseKickingWeeks.extraPointsBlocked,
} as const;

/** Every archived kicking week for one kicker across the given seasons, in season and week order.
 *  No `as_of` gate, matching `rosterWeekRowsFor`: this is a retrospective archive, and the
 *  point-in-time discipline lives in the preseason loader that decides which SEASONS to ask for. */
export async function kickingWeekRowsFor(
  db: ReadonlyDb,
  playerId: string,
  seasons: readonly number[],
): Promise<readonly KickingWeekRow[]> {
  if (seasons.length === 0) return [];
  return db
    .select(SELECTION)
    .from(nflverseKickingWeeks)
    .where(and(eq(nflverseKickingWeeks.playerId, playerId), inArray(nflverseKickingWeeks.season, [...seasons])))
    .orderBy(asc(nflverseKickingWeeks.season), asc(nflverseKickingWeeks.week));
}

/** Every archived kicking week in the given seasons, for every kicker. The component fit's own read. */
export async function kickingWeekRowsForSeasons(
  db: ReadonlyDb,
  seasons: readonly number[],
): Promise<readonly KickingWeekRow[]> {
  if (seasons.length === 0) return [];
  return db
    .select(SELECTION)
    .from(nflverseKickingWeeks)
    .where(inArray(nflverseKickingWeeks.season, [...seasons]))
    .orderBy(asc(nflverseKickingWeeks.season), asc(nflverseKickingWeeks.week), asc(nflverseKickingWeeks.playerId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/nflverse/kicking-weeks.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/nflverse`,
`npx vitest run src/projections/nflverse`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/nflverse/kicking-weeks.ts src/projections/nflverse/kicking-weeks.test.ts
git commit -m "$(cat <<'EOF'
feat(projections): ingest the historical kicking record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 4: The team-defense ingester, with the yards-allowed join

**Files:**
- Create: `src/projections/nflverse/team-defense-weeks.ts`
- Test: `src/projections/nflverse/team-defense-weeks.test.ts`

**Interfaces:**
- Consumes: the same set Task 3 consumes, plus `nflverseTeamDefenseWeeks` from `@/db/schema`.
- Produces:

```typescript
export interface TeamDefenseWeekRow {
  readonly season: number; readonly week: number; readonly team: string; readonly opponentTeam: string;
  readonly sacks: number; readonly interceptions: number; readonly fumbleRecoveries: number;
  readonly defensiveTouchdowns: number; readonly safeties: number;
  readonly puntBlocks: number; readonly extraPointBlocks: number; readonly fieldGoalBlocks: number;
  readonly specialTeamsTouchdowns: number;
  readonly passingYardsAllowed: number; readonly rushingYardsAllowed: number;
}
export const TEAM_DEFENSE_WEEK_SOURCE = "nflverse_team_defense_weeks";
export function mapTeamDefenseWeekRows(rows: readonly CsvRow[]): readonly TeamDefenseWeekRow[];
export async function recordTeamDefenseWeekRows(db: Db, rows: readonly TeamDefenseWeekRow[]): Promise<number>;
export interface TeamDefenseWeekIngestReport {
  readonly season: number; readonly rowsRead: number; readonly written: number; readonly unpaired: number;
}
export async function ingestTeamDefenseWeeks(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<readonly TeamDefenseWeekIngestReport[]>;
export async function teamDefenseWeekRowsForSeasons(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly TeamDefenseWeekRow[]>;
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { mapTeamDefenseWeekRows } from "./team-defense-weeks";

const COLUMNS = [
  "def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "def_safeties",
  "def_punt_blocks", "def_pat_blocks", "def_fg_blocks", "special_teams_tds",
  "passing_yards", "rushing_yards",
] as const;

function row(overrides: Partial<CsvRow> = {}): CsvRow {
  const base: Record<string, string> = {
    season: "2024", week: "1", team: "ARI", season_type: "REG", opponent_team: "BUF",
  };
  for (const column of COLUMNS) base[column] = "0";
  return { ...base, ...overrides };
}

describe("mapTeamDefenseWeekRows", () => {
  it("writes each team's yards allowed from its OPPONENT's own offense row", () => {
    const mapped = mapTeamDefenseWeekRows([
      row({ team: "ARI", opponent_team: "BUF", passing_yards: "162", rushing_yards: "124", def_sacks: "2" }),
      row({ team: "BUF", opponent_team: "ARI", passing_yards: "232", rushing_yards: "88", def_sacks: "4" }),
    ]);
    const arizona = mapped.find((r) => r.team === "ARI");
    const buffalo = mapped.find((r) => r.team === "BUF");
    expect(arizona?.passingYardsAllowed).toBe(232);
    expect(arizona?.rushingYardsAllowed).toBe(88);
    expect(arizona?.sacks).toBe(2);
    expect(buffalo?.passingYardsAllowed).toBe(162);
    expect(buffalo?.rushingYardsAllowed).toBe(124);
    expect(buffalo?.sacks).toBe(4);
  });

  it("reads every defensive column the release publishes", () => {
    const [mapped] = mapTeamDefenseWeekRows([
      row({
        def_sacks: "3.5", def_interceptions: "2", fumble_recovery_opp: "1", def_tds: "1",
        def_safeties: "1", def_punt_blocks: "1", def_pat_blocks: "1", def_fg_blocks: "1",
        special_teams_tds: "1",
      }),
      row({ team: "BUF", opponent_team: "ARI" }),
    ]);
    expect(mapped).toEqual({
      season: 2024, week: 1, team: "ARI", opponentTeam: "BUF",
      sacks: 3.5, interceptions: 2, fumbleRecoveries: 1, defensiveTouchdowns: 1, safeties: 1,
      puntBlocks: 1, extraPointBlocks: 1, fieldGoalBlocks: 1, specialTeamsTouchdowns: 1,
      passingYardsAllowed: 0, rushingYardsAllowed: 0,
    });
  });

  it("drops a row whose opponent has no row in the file, rather than inventing a zero", () => {
    expect(mapTeamDefenseWeekRows([row({ team: "ARI", opponent_team: "BUF" })])).toEqual([]);
  });

  it("drops the postseason", () => {
    expect(mapTeamDefenseWeekRows([
      row({ season_type: "POST" }),
      row({ team: "BUF", opponent_team: "ARI", season_type: "POST" }),
    ])).toEqual([]);
  });

  it("refuses a file missing an allowlisted column rather than reading it as zero", () => {
    const missing = { ...row() };
    delete (missing as Record<string, string | undefined>).def_fg_blocks;
    expect(() => mapTeamDefenseWeekRows([missing])).toThrow(/def_fg_blocks/);
  });

  it("refuses an unreadable counting cell", () => {
    expect(() => mapTeamDefenseWeekRows([row({ def_sacks: "n/a" })])).toThrow(/def_sacks/);
  });

  it("returns season, week, team order", () => {
    const mapped = mapTeamDefenseWeekRows([
      row({ week: "2", team: "BUF", opponent_team: "ARI" }),
      row({ week: "2", team: "ARI", opponent_team: "BUF" }),
      row({ week: "1", team: "BUF", opponent_team: "ARI" }),
      row({ week: "1", team: "ARI", opponent_team: "BUF" }),
    ]);
    expect(mapped.map((r) => [r.week, r.team])).toEqual([[1, "ARI"], [1, "BUF"], [2, "ARI"], [2, "BUF"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/nflverse/team-defense-weeks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { asc, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflverseTeamDefenseWeeks } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import { NFLVERSE_CONFIG } from "./config";
import type { NflverseClient } from "./client";
import type { CsvRow } from "./csv";

/**
 * THE HISTORICAL TEAM-DEFENSE RECORD, ARCHIVED IN THE DEFENSE'S OWN FRAME.
 *
 * VERIFIED AGAINST THE LIVE RELEASE (2026-09-05), NOT ASSUMED. The asset family is `stats_team`,
 * one file per season, `stats_team_week_<season>.csv`. The 2013 and 2024 headers were both fetched
 * and both carry every column in `REQUIRED_COLUMNS`.
 *
 * THE ONE TRANSFORMATION THIS MODULE MAKES, AND WHY IT MAKES IT AT INGEST. A row's `passing_yards`
 * and `rushing_yards` are that team's OWN offense. A fantasy defense is scored on the yards it
 * ALLOWED, which is the other row of the same game. Joining the pair here, once, and storing the
 * result under names that say whose yards they are (`passing_yards_allowed`) is what stops a later
 * reader from having to know the join exists. A reader who got it backwards would produce a defense
 * that is graded on how good its own offense was, and nothing downstream would look wrong.
 *
 * AN UNPAIRED ROW IS DROPPED AND COUNTED, NEVER ZEROED. A game with only one team's row in the file
 * cannot say what that team allowed, and writing 0 would be a shutout this module invented. Measured
 * against the real 2013 through 2025 files every regular-season row pairs; the branch exists so a
 * future partial file degrades to a missing row rather than to a fabricated one.
 *
 * POINTS ALLOWED IS DELIBERATELY ABSENT. `schedule.ts` already stores every game's score as team
 * observations, so a defense's points allowed is a join away from a fact this store already holds.
 * A second copy is a second number that can disagree with the first.
 */

export interface TeamDefenseWeekRow {
  readonly season: number;
  readonly week: number;
  /** nflverse's own team code, unmapped and contemporary to the season. */
  readonly team: string;
  readonly opponentTeam: string;
  /** A shared sack is credited as a half, so this is not an integer. */
  readonly sacks: number;
  readonly interceptions: number;
  readonly fumbleRecoveries: number;
  readonly defensiveTouchdowns: number;
  readonly safeties: number;
  readonly puntBlocks: number;
  readonly extraPointBlocks: number;
  readonly fieldGoalBlocks: number;
  readonly specialTeamsTouchdowns: number;
  /** THE OPPONENT's passing yards in this game. See the module docblock. */
  readonly passingYardsAllowed: number;
  /** THE OPPONENT's rushing yards in this game. */
  readonly rushingYardsAllowed: number;
}

/** The defense's own columns, read off its own row. */
const OWN_COLUMNS: Readonly<Record<
  "sacks" | "interceptions" | "fumbleRecoveries" | "defensiveTouchdowns" | "safeties"
  | "puntBlocks" | "extraPointBlocks" | "fieldGoalBlocks" | "specialTeamsTouchdowns",
  string
>> = {
  sacks: "def_sacks",
  interceptions: "def_interceptions",
  fumbleRecoveries: "fumble_recovery_opp",
  defensiveTouchdowns: "def_tds",
  safeties: "def_safeties",
  puntBlocks: "def_punt_blocks",
  extraPointBlocks: "def_pat_blocks",
  fieldGoalBlocks: "def_fg_blocks",
  specialTeamsTouchdowns: "special_teams_tds",
};

/** The two columns read off the OPPONENT's row. */
const OPPONENT_COLUMNS = { passingYardsAllowed: "passing_yards", rushingYardsAllowed: "rushing_yards" } as const;

const REQUIRED_COLUMNS: readonly string[] = [
  "season", "week", "team", "season_type", "opponent_team",
  ...Object.values(OWN_COLUMNS),
  ...Object.values(OPPONENT_COLUMNS),
];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse stats_team file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would read every missing column as zero and grade a defense on a game it never played.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

function count(row: CsvRow, column: string): number {
  const raw = trimmed(row[column]);
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse stats_team row has an unreadable ${column} (${JSON.stringify(row[column])}).`);
  }
  return value;
}

interface ParsedRow {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly opponentTeam: string;
  readonly row: CsvRow;
}

function parse(rows: readonly CsvRow[]): readonly ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    if (trimmed(row.season_type) !== NFLVERSE_CONFIG.seasonType) continue;
    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(
        `nflverse stats_team row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`,
      );
    }
    const team = trimmed(row.team);
    const opponentTeam = trimmed(row.opponent_team);
    if (team === "" || opponentTeam === "") continue;
    parsed.push({ season, week, team, opponentTeam, row });
  }
  return parsed;
}

export function mapTeamDefenseWeekRows(rows: readonly CsvRow[]): readonly TeamDefenseWeekRow[] {
  assertShape(rows);
  const parsed = parse(rows);
  const byKey = new Map(parsed.map((entry) => [`${entry.season}|${entry.week}|${entry.team}`, entry] as const));

  const mapped: TeamDefenseWeekRow[] = [];
  for (const entry of byKey.values()) {
    const opponent = byKey.get(`${entry.season}|${entry.week}|${entry.opponentTeam}`);
    if (opponent === undefined) continue;
    const own = Object.fromEntries(
      Object.entries(OWN_COLUMNS).map(([field, column]) => [field, count(entry.row, column)]),
    ) as Pick<TeamDefenseWeekRow, keyof typeof OWN_COLUMNS>;
    mapped.push({
      season: entry.season,
      week: entry.week,
      team: entry.team,
      opponentTeam: entry.opponentTeam,
      ...own,
      passingYardsAllowed: count(opponent.row, OPPONENT_COLUMNS.passingYardsAllowed),
      rushingYardsAllowed: count(opponent.row, OPPONENT_COLUMNS.rushingYardsAllowed),
    });
  }
  return mapped.sort((a, b) => a.season - b.season || a.week - b.week || a.team.localeCompare(b.team));
}

const INSERT_CHUNK_ROWS = 1_000;
const NATURAL_KEYS: readonly string[] = ["season", "week", "team", "ingestedAt"];

export const TEAM_DEFENSE_WEEK_SOURCE = "nflverse_team_defense_weeks";

export async function recordTeamDefenseWeekRows(db: Db, rows: readonly TeamDefenseWeekRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows
      .slice(start, start + INSERT_CHUNK_ROWS)
      .map((row) => ({ ...row, source: TEAM_DEFENSE_WEEK_SOURCE }));
    const result = await db
      .insert(nflverseTeamDefenseWeeks)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseTeamDefenseWeeks.season, nflverseTeamDefenseWeeks.week, nflverseTeamDefenseWeeks.team],
        set: excludedSetFor(nflverseTeamDefenseWeeks, NATURAL_KEYS),
        where: changedRowWhere(nflverseTeamDefenseWeeks, NATURAL_KEYS),
      })
      .returning({ season: nflverseTeamDefenseWeeks.season });
    written += result.length;
  }
  return written;
}

export interface TeamDefenseWeekIngestReport {
  readonly season: number;
  readonly rowsRead: number;
  readonly written: number;
  /** Regular-season rows whose opponent had no row in the same file. Reported, never zeroed. */
  readonly unpaired: number;
}

export async function ingestTeamDefenseWeeks(
  db: Db,
  client: NflverseClient,
  seasons: readonly number[],
): Promise<readonly TeamDefenseWeekIngestReport[]> {
  const reports: TeamDefenseWeekIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.statsTeam, `stats_team_week_${season}.csv`);
    const mapped = mapTeamDefenseWeekRows(rows);
    const regularSeasonRows = rows.filter((row) => (row.season_type ?? "").trim() === NFLVERSE_CONFIG.seasonType).length;
    const written = await recordTeamDefenseWeekRows(db, mapped);
    reports.push({ season, rowsRead: rows.length, written, unpaired: regularSeasonRows - mapped.length });
  }
  return reports;
}

/** Every archived team-defense week in the given seasons. The component fit's own read. */
export async function teamDefenseWeekRowsForSeasons(
  db: ReadonlyDb,
  seasons: readonly number[],
): Promise<readonly TeamDefenseWeekRow[]> {
  if (seasons.length === 0) return [];
  return db
    .select({
      season: nflverseTeamDefenseWeeks.season,
      week: nflverseTeamDefenseWeeks.week,
      team: nflverseTeamDefenseWeeks.team,
      opponentTeam: nflverseTeamDefenseWeeks.opponentTeam,
      sacks: nflverseTeamDefenseWeeks.sacks,
      interceptions: nflverseTeamDefenseWeeks.interceptions,
      fumbleRecoveries: nflverseTeamDefenseWeeks.fumbleRecoveries,
      defensiveTouchdowns: nflverseTeamDefenseWeeks.defensiveTouchdowns,
      safeties: nflverseTeamDefenseWeeks.safeties,
      puntBlocks: nflverseTeamDefenseWeeks.puntBlocks,
      extraPointBlocks: nflverseTeamDefenseWeeks.extraPointBlocks,
      fieldGoalBlocks: nflverseTeamDefenseWeeks.fieldGoalBlocks,
      specialTeamsTouchdowns: nflverseTeamDefenseWeeks.specialTeamsTouchdowns,
      passingYardsAllowed: nflverseTeamDefenseWeeks.passingYardsAllowed,
      rushingYardsAllowed: nflverseTeamDefenseWeeks.rushingYardsAllowed,
    })
    .from(nflverseTeamDefenseWeeks)
    .where(inArray(nflverseTeamDefenseWeeks.season, [...seasons]))
    .orderBy(asc(nflverseTeamDefenseWeeks.season), asc(nflverseTeamDefenseWeeks.week), asc(nflverseTeamDefenseWeeks.team));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/nflverse/team-defense-weeks.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/nflverse`,
`npx vitest run src/projections/nflverse`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/nflverse/team-defense-weeks.ts src/projections/nflverse/team-defense-weeks.test.ts
git commit -m "$(cat <<'EOF'
feat(projections): ingest team defense weeks with the yards-allowed join

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 5: Identity — kickers join the crosswalk, defenses get an edge

**Files:**
- Modify: `src/projections/crosswalk.ts`
- Modify: `src/projections/crosswalk.test.ts`
- Modify: `scripts/build-crosswalk.ts`

**Interfaces:**
- Consumes: `teamDefenseUniverseIdForProviderId`, `teamDefenseUniverseIds` (`./nflverse/team-codes`).
- Produces: `CROSSWALK_METHOD.teamDefense = "team_defense"`; `UnmatchedReason` gains `"no_team_defense_row"`; `resolveCrosswalk(providers, universe, teamDefenseUniverseIds)` takes a third argument (a `ReadonlySet<string>`, defaulting to an empty set); `crosswalkInputs` returns a third field `teamDefenses: ReadonlySet<string>`; `seedTeamDefenseUniverse(db: Db): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Append to `src/projections/crosswalk.test.ts`:

```typescript
import { teamDefenseUniverseIds } from "./nflverse/team-codes";
import { CROSSWALK_METHOD, resolveCrosswalk } from "./crosswalk";

describe("team defenses", () => {
  const defenses = new Set(teamDefenseUniverseIds());

  it("places a product defense on its synthetic universe row", () => {
    const resolution = resolveCrosswalk(
      [{ id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" }],
      [],
      defenses,
    );
    expect(resolution.unmatched).toEqual([]);
    expect(resolution.matched).toEqual([
      {
        playerId: "DST-LAR",
        nflPlayerId: "team-def:LA",
        method: CROSSWALK_METHOD.teamDefense,
        nameAgrees: true,
        providerName: "Los Angeles Rams",
        universeName: "team-def:LA",
      },
    ]);
  });

  it("records a defense whose synthetic row has not been seeded, rather than claiming an edge", () => {
    const resolution = resolveCrosswalk(
      [{ id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" }],
      [],
      new Set(),
    );
    expect(resolution.matched).toEqual([]);
    expect(resolution.unmatched[0]?.reason).toBe("no_team_defense_row");
  });

  it("still records a defense id no team code answers to", () => {
    const resolution = resolveCrosswalk(
      [{ id: "DST-XXX", name: "Nowhere", position: "DEF" }],
      [],
      defenses,
    );
    expect(resolution.unmatched[0]?.reason).toBe("not_an_nfl_player");
  });

  it("counts a placed defense in the all-players rate and leaves the people rate alone", () => {
    const resolution = resolveCrosswalk(
      [
        { id: "DST-LAR", name: "Los Angeles Rams", position: "DEF" },
        { id: "9", name: "A Kicker", position: "K" },
      ],
      [{ id: "00-0000009", espnId: "9", name: "A Kicker" }],
      defenses,
    );
    expect(resolution.matchRate).toBe(1);
    expect(resolution.matchRateOfPeople).toBe(1);
  });

  it("places a kicker through the same espn id join every other person uses", () => {
    const resolution = resolveCrosswalk(
      [{ id: "3055899", name: "Justin Tucker", position: "K" }],
      [{ id: "00-0029597", espnId: "3055899", name: "Justin Tucker" }],
      defenses,
    );
    expect(resolution.matched[0]?.method).toBe(CROSSWALK_METHOD.espnId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/crosswalk.test.ts`
Expected: FAIL, `CROSSWALK_METHOD.teamDefense` does not exist and `resolveCrosswalk` takes two arguments.

- [ ] **Step 3: Change `src/projections/crosswalk.ts`**

Replace the `UnmatchedReason` union, `CROSSWALK_METHOD`, and the `TEAM_DEFENSE_POSITION` block with:

```typescript
/** Why a league player has no counterpart in the historical universe. */
export type UnmatchedReason =
  /**
   * NO LONGER REACHED BY A REAL TEAM DEFENSE (Phase A). It used to be every defense's answer,
   * unconditionally, on the true-but-useless grounds that there is no person behind one. There is
   * still no person, and there is now a deliberate synthetic universe row per club
   * (`team-codes.ts`'s `teamDefenseUniverseId`) that the projection store's foreign key and every
   * reader can key on. What still lands here is a provider id shaped like a defense whose team code
   * is not one of the 32 — a seed row or a renamed club, which is a real absence rather than a
   * philosophical one.
   */
  | "not_an_nfl_player"
  /** A real product defense whose synthetic universe row has not been seeded. `build-crosswalk.ts`
   *  seeds all 32 before resolving, so this means the seed step was skipped or failed. */
  | "no_team_defense_row"
  /** Nobody in the universe carries this ESPN id — a fringe or undrafted man the release has not
   *  listed, or a fabricated seed row that was never an NFL player at all. */
  | "no_espn_id"
  /** Two universe rows claim the id. `nfl_players_espn_id_idx` makes this impossible today; it is
   *  recorded rather than resolved if the release ever breaks that promise. */
  | "ambiguous_espn_id";

/** How a matched player was placed. */
export const CROSSWALK_METHOD = {
  espnId: "espn_id",
  /** A team defense, placed on its own synthetic universe row by team code rather than by any id
   *  join, because there is no person and therefore no shared id to join on. */
  teamDefense: "team_defense",
} as const;
```

Then, inside `resolveCrosswalk`, replace the DEF branch:

```typescript
export function resolveCrosswalk(
  providers: readonly ProviderPlayer[],
  universe: readonly UniversePlayer[],
  /**
   * Every synthetic team-defense universe id that actually exists in `nfl_players`. Defaults to
   * empty so a caller that has not seeded them gets `no_team_defense_row` — an honest "the row is
   * not there" — rather than an edge pointing at a foreign key that would fail on write.
   */
  teamDefenseUniverseIds: ReadonlySet<string> = new Set(),
): CrosswalkResolution {
  // ... byEspnId construction unchanged ...

  for (const provider of providers) {
    if (provider.position === TEAM_DEFENSE_POSITION) {
      const universeId = teamDefenseUniverseIdForProviderId(provider.id);
      if (universeId === null) {
        unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "not_an_nfl_player" });
        continue;
      }
      if (!teamDefenseUniverseIds.has(universeId)) {
        unmatched.push({ playerId: provider.id, name: provider.name, position: provider.position, reason: "no_team_defense_row" });
        continue;
      }
      matched.push({
        playerId: provider.id,
        nflPlayerId: universeId,
        method: CROSSWALK_METHOD.teamDefense,
        // A synthetic row's "name" is its id, so the two sides can never be compared the way two
        // spellings of a person's name are. TRUE rather than false, because false is the audit
        // signal that says a human should look at a pair, and there is nothing here to look at.
        nameAgrees: true,
        providerName: provider.name,
        universeName: universeId,
      });
      continue;
    }
    // ... the espn-id path unchanged ...
  }

  // `people` unchanged: a defense is still not a person, so `matchRateOfPeople` still excludes it.
  // `matchRate` now legitimately reaches 1, which it never could before.
```

Add the import at the top:

```typescript
import { teamDefenseUniverseIdForProviderId, teamDefenseUniverseIds as everyTeamDefenseUniverseId } from "./nflverse/team-codes";
```

Widen `crosswalkInputs` and add the seeder:

```typescript
/** Reads all three sides of the join out of the database, in the shape `resolveCrosswalk` takes. */
export async function crosswalkInputs(db: ReadonlyDb): Promise<{
  readonly providers: readonly ProviderPlayer[];
  readonly universe: readonly UniversePlayer[];
  readonly teamDefenses: ReadonlySet<string>;
}> {
  const providers = await db.select({ id: players.id, name: players.name, position: players.position }).from(players);
  const universe = await db
    .select({ id: nflPlayers.id, espnId: nflPlayers.espnId, name: nflPlayers.name })
    .from(nflPlayers)
    .where(isNotNull(nflPlayers.espnId));
  const seeded = await db
    .select({ id: nflPlayers.id })
    .from(nflPlayers)
    .where(inArray(nflPlayers.id, [...everyTeamDefenseUniverseId()]));
  return { providers, universe, teamDefenses: new Set(seeded.map((row) => row.id)) };
}

/**
 * Writes the 32 synthetic team-defense universe rows, or confirms they are already there.
 *
 * A SYNTHETIC ROW IN A TABLE OF REAL PEOPLE, and it is labelled as one from every angle: the id
 * carries the `team-def:` prefix nothing else uses, the position is `DEF` which no real
 * `nfl_players` row carries (nflverse spells defenders `DE`, `LB`, `CB`), and the name is the
 * source's own team code rather than a person's name. Nothing that reads this table for a person
 * can pick one of these up by accident, and the projection store's foreign key now has somewhere to
 * point for the one position that has no person behind it.
 *
 * `onConflictDoNothing`: these rows carry no fact that can be corrected, so a re-run is a no-op.
 */
export async function seedTeamDefenseUniverse(db: Db): Promise<number> {
  const rows = everyTeamDefenseUniverseId().map((id) => ({
    id,
    pfrId: null,
    espnId: null,
    name: id,
    position: TEAM_DEFENSE_POSITION,
    latestTeam: id.slice(TEAM_DEFENSE_UNIVERSE_PREFIX.length),
    rookieSeason: null,
    lastSeason: null,
  }));
  const written = await db.insert(nflPlayers).values(rows).onConflictDoNothing().returning({ id: nflPlayers.id });
  return written.length;
}
```

`TEAM_DEFENSE_UNIVERSE_PREFIX` joins the import from `./nflverse/team-codes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/crosswalk.test.ts`
Expected: PASS, including every pre-existing case (they call `resolveCrosswalk` with two arguments and the third defaults).

- [ ] **Step 5: Update `scripts/build-crosswalk.ts`**

Add the seed call and the new reason's meaning:

```typescript
const REASON_MEANING: Readonly<Record<UnmatchedReason, string>> = {
  not_an_nfl_player: "a defense id no team code answers to, or a seed row that was never a player",
  no_team_defense_row: "a real defense whose synthetic universe row is missing; the seed step did not run",
  no_espn_id: "nobody in the universe carries this id — fringe, undrafted, or a fabricated seed row",
  ambiguous_espn_id: "two universe rows claim the id; refused rather than guessed at",
};
```

and in `main`, immediately after `ingestPlayerUniverse`:

```typescript
  console.log("seeding the 32 synthetic team-defense universe rows...");
  const seeded = await seedTeamDefenseUniverse(db);
  console.log(`  ${seeded} written (0 means they were already there)`);

  const { providers, universe, teamDefenses } = await crosswalkInputs(db);
  const resolution = resolveCrosswalk(providers, universe, teamDefenses);
```

and after the match-rate block:

```typescript
  const defenseEdges = resolution.matched.filter((match) => match.method === CROSSWALK_METHOD.teamDefense).length;
  console.log(`team defenses placed                ${defenseEdges} of 32`);
  const kickers = new Set(providers.filter((provider) => provider.position === "K").map((provider) => provider.id));
  const kickersPlaced = resolution.matched.filter((match) => kickers.has(match.playerId)).length;
  console.log(`kickers placed                      ${kickersPlaced} of ${kickers.size}`);
```

- [ ] **Step 6: Run it against the dev database**

Run: `npm run projections:crosswalk`
Expected: `team defenses placed 32 of 32`, and a kicker count well above 0 (it was 0 of 71 before
this task). Record both numbers in the ledger.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections scripts`,
`npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/projections/crosswalk.ts src/projections/crosswalk.test.ts scripts/build-crosswalk.ts
git commit -m "$(cat <<'EOF'
feat(projections): team defenses get a universe row and a crosswalk edge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 6: The backfill script

**Files:**
- Create: `scripts/kdef-backfill.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createDb` (`@/db/client`), `createNflverseClient` (`@/projections/nflverse/client`), `ingestKickingWeeks`, `ingestTeamDefenseWeeks`, `seedTeamDefenseUniverse`.
- Produces: `npm run projections:kdef:backfill [season ...]`.

- [ ] **Step 1: Write the script**

```typescript
// Backfills the two history tables a kicker's and a team defense's projection are composed from.
// Run: npm run projections:kdef:backfill [season ...]   (defaults to 2013 through 2025)
//
// A ONE-SHOT BACKFILL, NOT A JOB, deliberately. Every other recurring ingestion in this product
// registers in the owned Postgres job system; this one covers a fixed, closed span of completed
// seasons that will never change again, so a scheduled re-run would be work that can only ever
// report zero. The current season's own kicking and defense lines arrive through the live stats
// feed, not through here.
//
// 2026 IS NOT IN THE DEFAULT SPAN AND MUST NOT BE ADDED TO IT. The data year is held out
// (`docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §5 Phase B); ingesting
// it would put a pristine season one query away from a fit.
import { createDb } from "@/db/client";
import { createNflverseClient } from "@/projections/nflverse/client";
import { seedTeamDefenseUniverse } from "@/projections/crosswalk";
import { ingestKickingWeeks } from "@/projections/nflverse/kicking-weeks";
import { ingestTeamDefenseWeeks } from "@/projections/nflverse/team-defense-weeks";

const FIRST_SEASON = 2013;
const LAST_SEASON = 2025;

const REQUESTED = process.argv.slice(2).map(Number);
const SEASONS =
  REQUESTED.length > 0
    ? REQUESTED
    : Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:kdef:backfill\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  for (const season of SEASONS) {
    if (!Number.isInteger(season) || season < 1999 || season > LAST_SEASON) {
      throw new Error(`${season} is not a season this backfill covers (1999 to ${LAST_SEASON}).`);
    }
  }

  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();

  console.log("seeding the 32 synthetic team-defense universe rows...");
  console.log(`  ${await seedTeamDefenseUniverse(db)} written (0 means they were already there)`);

  console.log(`\n${"=".repeat(88)}`);
  console.log(`KICKING WEEKS, ${SEASONS[0]} to ${SEASONS[SEASONS.length - 1]}`);
  console.log(`${"=".repeat(88)}`);
  for (const report of await ingestKickingWeeks(db, client, SEASONS)) {
    console.log(
      `  ${report.season}  file ${String(report.rowsRead).padStart(6)} rows   kicker weeks ${String(report.kickerRows).padStart(4)}   ` +
        `written ${String(report.written).padStart(4)}   not in the universe ${report.unknownToUniverse}`,
    );
  }

  console.log(`\n${"=".repeat(88)}`);
  console.log(`TEAM DEFENSE WEEKS, ${SEASONS[0]} to ${SEASONS[SEASONS.length - 1]}`);
  console.log(`${"=".repeat(88)}`);
  for (const report of await ingestTeamDefenseWeeks(db, client, SEASONS)) {
    console.log(
      `  ${report.season}  file ${String(report.rowsRead).padStart(6)} rows   written ${String(report.written).padStart(4)}   ` +
        `unpaired (dropped, never zeroed) ${report.unpaired}`,
    );
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 2: Register the npm script**

In `package.json`, beside the other `projections:` entries:

```json
    "projections:kdef:backfill": "dotenv -e .env.local -- tsx scripts/kdef-backfill.ts",
```

- [ ] **Step 3: Run one season first**

Run: `npm run projections:kdef:backfill 2024`
Expected: 32 defense universe rows written or already present, roughly 40 to 60 kicker weeks per
week of the season written, 544 team-defense rows for a 17-game 18-week season with byes, and
`unpaired 0`.

- [ ] **Step 4: Run the whole span**

Run: `npm run projections:kdef:backfill`
Expected: thirteen lines in each block, `unpaired 0` throughout. Record the totals in the ledger.

- [ ] **Step 5: Confirm the store**

Run a read-only check that the two tables hold what the reports claimed and that the yards-allowed
join is the right way round for a game whose result is independently known:

```bash
npx dotenv -e .env.local -- npx tsx -e "
import { createDb } from '@/db/client';
import { sql } from 'drizzle-orm';
const db = createDb(process.env.DATABASE_URL!);
console.log(await db.execute(sql\`select min(season) a, max(season) b, count(*) n from nflverse_kicking_weeks\`));
console.log(await db.execute(sql\`select min(season) a, max(season) b, count(*) n from nflverse_team_defense_weeks\`));
console.log(await db.execute(sql\`select team, opponent_team, passing_yards_allowed, rushing_yards_allowed from nflverse_team_defense_weeks where season = 2024 and week = 1 and team in ('ARI','BUF') order by team\`));
await db.\$client.end();
"
```

Expected: both spans read 2013 to 2025, and the week-1 2024 Arizona row's yards allowed equal
Buffalo's own passing and rushing yards for that game and not Arizona's.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint scripts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/kdef-backfill.ts package.json
git commit -m "$(cat <<'EOF'
feat(projections): backfill 2013-2025 kicking and team defense history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

## Self-review

**Spec coverage.** §5 Phase A names four things and each has a task: the two new source assets and
their tables (Tasks 2, 3, 4), team codes in one module (Task 1), kicker and defense identity (Task
5), and the kicker job's roster anchor — which needs no new work, because `nflverse_roster_weeks` is
already ingested and Phase B reads it. §7's four error-handling clauses land in: `assertShape`
(Tasks 3, 4), the unmatched report in `build-crosswalk.ts` (Task 5), `team-codes.test.ts`'s
round-trip and unknown-code cases (Task 1), and the existing replacement-level behavior which needs
no change. §8's unit-test list is covered by Tasks 1, 3, 4 and 5; the composition and candidate-builder
tests belong to Phase B and the autopick and board tests to Phase C.

**No placeholders.** Every step carries the real code or the real command.

**Type consistency.** `KickingWeekRow` and `TeamDefenseWeekRow` field names match the Drizzle column
properties in Task 2 exactly, so the `.select(SELECTION)` shapes type-check against the row
interfaces without a mapper. `resolveCrosswalk`'s third parameter is a `ReadonlySet<string>` in the
test, the signature and the `crosswalkInputs` return type alike.
