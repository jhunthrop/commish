// The fixture run (shared/fixtures/run, written by export-run.ts): its files where the bucket holds
// them, the run's own files byte for byte, and its designations held to the index. Run with
// `node --test shared/scripts/*.test.ts`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  PPR_FORMAT,
  RUN_FIXTURE,
  heldToIndex,
  pageIds,
  runFiles,
  withReach,
} from "./export-run.ts";
import { REPOSITORY } from "./generated.ts";

const RUN_ID = "2026-10-21T12-ros";
const CONTRACT = join(
  REPOSITORY,
  "research/nightly/contract/fixture/runs",
  RUN_ID,
);
const fixture = (path: string): string =>
  readFileSync(join(REPOSITORY, RUN_FIXTURE, path), "utf8");
/** Every player the contract run's index gives a page. */
const PLAYERS = pageIds(
  JSON.parse(readFileSync(join(CONTRACT, "index.json"), "utf8")) as unknown[],
);

void test("the fixture holds the pointer and each file the run routes answer, once", () => {
  const files = runFiles(RUN_ID, PLAYERS);
  const paths = files.map((f) => f.path);
  assert.deepEqual(paths, [
    "runs/latest.json",
    `runs/${RUN_ID}/manifest.json`,
    `runs/${RUN_ID}/boards/${PPR_FORMAT}.json`,
    `runs/${RUN_ID}/index.json`,
    `runs/${RUN_ID}/adp.json`,
    `runs/${RUN_ID}/designations.json`,
    ...PLAYERS.map((id) => `runs/${RUN_ID}/players/${id}.json`),
    `runs/${RUN_ID}/record.json`,
    `runs/${RUN_ID}/clubs.json`,
    `runs/${RUN_ID}/schedule.json`,
  ]);
  const readme = fixture("README.md");
  for (const file of files) assert.ok(readme.includes(file.path), file.path);
});

void test("the latest pointer names the run, whose manifest says it is that run", () => {
  const pointer = JSON.parse(fixture("runs/latest.json")) as { runId: string };
  assert.equal(pointer.runId, RUN_ID);
  const manifest = JSON.parse(fixture(`runs/${RUN_ID}/manifest.json`)) as {
    runId: string;
  };
  assert.equal(manifest.runId, RUN_ID);
});

void test("the manifest is the run's byte for byte with the season reach after its last member", () => {
  const written = fixture(`runs/${RUN_ID}/manifest.json`);
  const run = readFileSync(join(CONTRACT, "manifest.json"), "utf8");
  const { reach } = JSON.parse(written) as { reach: unknown };
  assert.ok(reach, "the fixture's manifest carries the reach");
  assert.equal(
    written,
    `${run.slice(0, -1)},"reach":${JSON.stringify(reach)}}`,
  );
});

void test("a reach goes after the manifest's last member and nothing else moves", () => {
  const reach = {
    format: "ppr-12",
    scoring: "PPR",
    through: "through week 5",
    complete: 5,
    partial: null,
  };
  assert.equal(
    withReach('{"runId":"r","players":4}\n', reach),
    `{"runId":"r","players":4,"reach":${JSON.stringify(reach)}}\n`,
  );
  assert.throws(() => withReach('{"reach":{}}', reach), /already carries/);
  assert.throws(() => withReach("[]", reach), /not one JSON object/);
});

void test("the board, the index, the ADP, the pages, the record, the clubs and the schedule are the run's files byte for byte", () => {
  const copied = [
    `boards/${PPR_FORMAT}.json`,
    "index.json",
    "adp.json",
    ...PLAYERS.map((id) => `players/${id}.json`),
    "record.json",
    "clubs.json",
    "schedule.json",
  ];
  for (const path of copied) {
    assert.equal(
      fixture(`runs/${RUN_ID}/${path}`),
      readFileSync(join(CONTRACT, path), "utf8"),
      path,
    );
  }
});

void test("the fixture carries a page for every player its index gives one", () => {
  assert.ok(PLAYERS.length > 0);
  for (const id of PLAYERS) {
    const page = JSON.parse(fixture(`runs/${RUN_ID}/players/${id}.json`)) as {
      id: string;
    };
    assert.equal(page.id, id);
  }
});

void test("a page is every index entry's but a kicker's or a defense's", () => {
  assert.deepEqual(
    pageIds([
      { id: "a" },
      { id: "b", orderBasis: "projection" },
      { id: "K-1", orderBasis: "market" },
    ]),
    ["a", "b"],
  );
});

void test("the designations key only players the index names", () => {
  const index = JSON.parse(fixture(`runs/${RUN_ID}/index.json`)) as {
    id: string;
  }[];
  const indexed = new Set(index.map((entry) => entry.id));
  const designations = JSON.parse(
    fixture(`runs/${RUN_ID}/designations.json`),
  ) as {
    players: Record<string, unknown>;
  };
  const keyed = Object.keys(designations.players);
  assert.ok(keyed.length > 0, "the capture lists a player the run indexes");
  for (const id of keyed) assert.ok(indexed.has(id), id);
});

void test("a capture held to the index keeps its stamps and drops every other player", () => {
  const capture = {
    readAt: "r",
    players: { a: { status: "out" }, b: { status: "pup" } },
  };
  assert.deepEqual(heldToIndex(capture, new Set(["b"])), {
    readAt: "r",
    players: { b: { status: "pup" } },
  });
  assert.deepEqual(
    Object.keys(capture.players),
    ["a", "b"],
    "the capture is not changed",
  );
});
