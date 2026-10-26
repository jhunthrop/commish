// The Rankings' and Our record's parity files (rankings-parity.ts, record-parity.ts) as committed:
// the order's places are the API's ranks under every filter (Review Focus 4), and the record never
// says a weekly model of ours exists. Run with `node --test shared/scripts/*.test.ts`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPOSITORY } from "./generated.ts";
import { ORDER_CASES, WEEK_CASES } from "./rankings-parity.ts";
import { RECORD_CASES } from "./record-parity.ts";

interface Row {
  rank: number;
  place: string;
  bye: boolean;
  status: { mark: string } | null;
}

interface OrderCase {
  file: string;
  sections: { head: string | null; rows: Row[] }[];
}

const parity = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(REPOSITORY, "shared/fixtures/parity", name), "utf8"),
  ) as Record<string, unknown>;

const LIST_WORDS = /^(IR|PUP|NFI|SUSP|Susp\.?)$/;

void test("every order row's place is the player's full-order number or its list's word, a bye's too (Lane 234)", () => {
  const orders = parity("rankings.json").orders as Record<string, OrderCase>;
  assert.deepEqual(
    Object.keys(orders),
    ORDER_CASES.map((c) => c.name),
  );
  let skipped = false;
  for (const [name, order] of Object.entries(orders)) {
    const answer = JSON.parse(
      readFileSync(
        join(REPOSITORY, "shared/fixtures/inseason", order.file),
        "utf8",
      ),
    ) as { data: { rows: { rank: number; overall_rank?: number }[] } };
    const rows = order.sections.flatMap((section) => section.rows);
    assert.deepEqual(
      rows.map((row) => row.rank),
      answer.data.rows.map((row) => row.rank),
      name,
    );
    const overall = new Map(
      answer.data.rows.map((row) => [row.rank, row.overall_rank ?? row.rank]),
    );
    for (const row of rows) {
      if (LIST_WORDS.test(row.place)) continue;
      const number = overall.get(row.rank);
      assert.equal(row.place, String(number), `${name}: ${String(row.rank)}`);
      if (number !== row.rank) skipped = true;
    }
  }
  // The byes-last case numbers its rows from the full order, so somewhere the two differ.
  assert.ok(skipped, "no case has a bye moved last");
});

void test("a search keeps each match at its place in the order, never numbered again", () => {
  const orders = parity("rankings.json").orders as Record<string, OrderCase>;
  const places = (name: string): string[] =>
    (orders[name]?.sections ?? []).flatMap((s) => s.rows).map((r) => r.place);
  assert.notDeepEqual(places("search").slice(0, 3), ["1", "2", "3"]);
  assert.notDeepEqual(places("WR-search").slice(0, 3), ["1", "2", "3"]);
});

void test("the kickers' and defenses' week holds each case", () => {
  const weeks = parity("rankings.json").weeks as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(weeks),
    WEEK_CASES.map((c) => c.name),
  );
});

void test("every order row's strip holds five labelled cells, and the basis beside it heads Opp rank", () => {
  const orders = parity("rankings.json").orders as Record<
    string,
    {
      stripBasis: string;
      sections: { rows: { cells: { head: string }[] }[] }[];
    }
  >;
  for (const [name, order] of Object.entries(orders)) {
    assert.match(order.stripBasis, /Opp rank is points allowed/u, name);
    for (const row of order.sections.flatMap((s) => s.rows))
      assert.equal(
        row.cells.length,
        5,
        `${name}: ${row.cells.map((c) => c.head).join(", ")}`,
      );
  }
});

void test("the record names what it grades and never a weekly model of ours", () => {
  const cases = parity("record.json").cases as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(cases),
    RECORD_CASES.map((c) => c.name),
  );
  assert.doesNotMatch(
    JSON.stringify(cases),
    /weekly model|our model|weekly projection of ours/i,
  );
});
