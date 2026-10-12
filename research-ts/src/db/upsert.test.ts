import { describe, it, expect } from "vitest";
import { integer, pgTable, text, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { players } from "@research-ts/db/schema";
import { changedRowWhere, excludedSetFor } from "./upsert";

/** Renders a whole `SQL` fragment to real Postgres text — `changedRowWhere` mixes `sql.raw`
 *  identifiers with column-reference chunks, so a plain "read the first chunk" helper (like
 *  `rawTextOf` below) can't capture enough of it; the dialect is what the real query builder
 *  itself uses to do this, so it's the one source of truth for what actually reaches Postgres. */
const dialect = new PgDialect();
function fullTextOf(fragment: SQL): string {
  return dialect.sqlToQuery(fragment).sql;
}

/** A composite-keyed table in the shape of the league app's `roster_slots`, declared here because
 *  the research schema owns no table keyed on three columns and the helpers are schema-agnostic. */
const rosterSlots = pgTable("roster_slots", {
  teamId: text("team_id").notNull(),
  slot: text("slot").notNull(),
  slotIndex: integer("slot_index").notNull(),
  playerId: text("player_id"),
});

/** Reads the raw SQL text out of a `sql.raw(...)` fragment, for assertion purposes only. */
function rawTextOf(fragment: unknown): string {
  const chunks = (fragment as { queryChunks: { value: readonly string[] }[] }).queryChunks;
  return chunks[0]!.value[0]!;
}

describe("excludedSetFor", () => {
  it("maps every non-key column to its excluded.<column> reference", () => {
    const set = excludedSetFor(players, ["id"]);
    expect(Object.keys(set).sort()).toEqual(["adp", "headshotUrl", "name", "nflTeam", "posAdp", "position"].sort());
    expect(rawTextOf(set.name)).toBe("excluded.name");
    expect(rawTextOf(set.nflTeam)).toBe("excluded.nfl_team");
    expect(rawTextOf(set.position)).toBe("excluded.position");
    expect(rawTextOf(set.adp)).toBe("excluded.adp");
    expect(rawTextOf(set.headshotUrl)).toBe("excluded.headshot_url");
  });

  it("excludes every key column, even when there is more than one", () => {
    const set = excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]);
    expect(Object.keys(set)).toEqual(["playerId"]);
    expect(rawTextOf(set.playerId)).toBe("excluded.player_id");
  });

  it("never produces a no-op self-assignment for the value it replaced", () => {
    // The defect this module fixes: `{ set: { playerId: rosterSlots.playerId } }` assigns a
    // column to itself. Every value here must instead be an `excluded.*` SQL reference.
    const set = excludedSetFor(rosterSlots, ["teamId", "slot", "slotIndex"]);
    expect(rawTextOf(set.playerId)).not.toBe("player_id");
  });

  it("throws a clear error instead of interpolating an unsafe column identifier into raw SQL", () => {
    // `excludedSetFor` builds its `excluded.<name>` fragment with `sql.raw`, which is not
    // parameterized — a column name that doesn't look like a plain SQL identifier must never
    // reach it unchecked.
    const unsafeTable = pgTable("upsert_test_unsafe", {
      id: text("id").primaryKey(),
      bad: text("bad; DROP TABLE users; --"),
    });
    expect(() => excludedSetFor(unsafeTable, ["id"])).toThrow(/unsafe|identifier/i);
  });
});

describe("changedRowWhere", () => {
  it("compares every non-key column between the table and excluded via IS DISTINCT FROM", () => {
    const where = changedRowWhere(players, ["id"]);
    expect(fullTextOf(where)).toBe(
      '("players"."name", "players"."position", "players"."nfl_team", "players"."adp", "players"."pos_adp", "players"."headshot_url") IS DISTINCT FROM (excluded.name, excluded.position, excluded.nfl_team, excluded.adp, excluded.pos_adp, excluded.headshot_url)',
    );
  });

  it("excludes every key column, even when there is more than one", () => {
    const where = changedRowWhere(rosterSlots, ["teamId", "slot", "slotIndex"]);
    expect(fullTextOf(where)).toBe('("roster_slots"."player_id") IS DISTINCT FROM (excluded.player_id)');
  });

  it("throws a clear error instead of interpolating an unsafe column identifier into raw SQL", () => {
    const unsafeTable = pgTable("upsert_test_unsafe_where", {
      id: text("id").primaryKey(),
      bad: text("bad; DROP TABLE users; --"),
    });
    expect(() => changedRowWhere(unsafeTable, ["id"])).toThrow(/unsafe|identifier/i);
  });
});
