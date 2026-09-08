import { beforeEach, describe, expect, it, vi } from "vitest";
import { advisorCore } from "../advisor";
import { FIXTURE_POOL, FIXTURE_SHAPE, FIXTURE_TEAM_IDS, fixtureAdvance, fixtureStart, fixtureValued } from "../test-fixture";
import type { AdvisorView } from "../view";
import { resetVoiceBudgetForTests, voiceWithinBudget } from "./budget";
import { generateAdvisorVoice, gradeSlot, gradeSlots, groundingFactsFor, reasonSlotKey, STRATEGY_SLOT, voicePromptFor } from "./generate";

const ASKING = FIXTURE_TEAM_IDS[3]!;

/** Real-looking synthetic names (never a real athlete's), so the name grounding is exercised the
 *  way a live room exercises it: multi-word Titlecase runs. */
const NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  FIXTURE_POOL.map((entry, i) => [entry.playerId, `${["Avery", "Blake", "Casey", "Dakota", "Emerson", "Finley", "Harper", "Jordan"][i % 8]} ${["Stone", "Rivers", "Hale", "Brook", "Vale", "Marsh", "Reed", "Cole"][Math.floor(i / 8) % 8]}${Math.floor(i / 64) > 0 ? ` ${["II", "III", "IV"][Math.floor(i / 64) - 1]}` : ""}`]),
);

function view(): AdvisorView {
  const state = fixtureAdvance(fixtureStart(), 12);
  const built = advisorCore({ state, askingTeamId: ASKING, valued: fixtureValued(), shape: FIXTURE_SHAPE, seedNamespace: "voice-test", winningBuilds: null, computedBasis: "replayed", names: NAMES, runs: 30 });
  if (built === null) throw new Error("expected a view");
  return built;
}

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 500, completion_tokens: 120, total_tokens: 620, cost: 0.00004 } }), { status: 200 });
}

describe("groundingFactsFor and gradeSlot", () => {
  it("passes a sentence whose numbers and names are on the ledger, and fails one that invents either", () => {
    const v = view();
    const top = v.now[0]!;
    const name = v.names[top.playerId]!;
    const runs = Math.round(top.makeItBack!.survival * top.makeItBack!.runs);
    expect(gradeSlot(`${name} is the pick, ${runs} of ${top.makeItBack!.runs} runs still have him at your next turn.`, v.ledger, 28)).toEqual([]);
    expect(gradeSlot(`${name} scored 1,234 points last year.`, v.ledger, 28).length).toBeGreaterThan(0);
    expect(gradeSlot("Marcus Nobody is the obvious pick here.", v.ledger, 28).length).toBeGreaterThan(0);
  });

  it("holds the copy laws: no em-dash, no semicolon, no competitor, no tier phrase, the word cap", () => {
    const v = view();
    const name = v.names[v.now[0]!.playerId]!;
    expect(gradeSlot(`${name} is the pick — take him.`, v.ledger, 28)[0]).toMatch(/em-dash/);
    expect(gradeSlot(`${name} is the pick; take him.`, v.ledger, 28)[0]).toMatch(/semicolon/);
    expect(gradeSlot(`${name} is ranked higher on ESPN.`, v.ledger, 28)[0]).toMatch(/competitor/);
    expect(gradeSlot(`${name} is the last man in his tier.`, v.ledger, 28).some((line) => /last man/.test(line))).toBe(true);
    expect(gradeSlot(`${name} ${"is very ".repeat(20)} good.`, v.ledger, 28)[0]).toMatch(/Word count/);
    expect(groundingFactsFor(v.ledger).numberLedger).toBe(v.ledger.numbers);
  });
});

describe("gradeSlots", () => {
  it("keeps grounded slots, drops a fabricated one, and drops a slot that repeats an earlier one on the card", () => {
    const v = view();
    const [a, b] = v.now;
    const nameA = v.names[a!.playerId]!;
    const nameB = v.names[b!.playerId]!;
    const parsed = {
      [STRATEGY_SLOT]: `The seats ahead of you lean receiver in our runs. Take ${nameA} now.`,
      [reasonSlotKey(a!.playerId)]: `${nameA} fills your ${a!.fillsSlot} slot and the board thins fast behind him.`,
      [reasonSlotKey(b!.playerId)]: `${nameB} averaged 99.9 points a game.`,
      [reasonSlotKey(v.now[2]!.playerId)]: `${nameA} fills your ${a!.fillsSlot} slot and the board thins fast behind him.`,
    };
    const graded = gradeSlots(parsed, v);
    expect(Object.keys(graded.accepted)).toEqual([STRATEGY_SLOT, reasonSlotKey(a!.playerId)]);
    expect(graded.rejected.some((line) => line.startsWith(reasonSlotKey(b!.playerId)))).toBe(true);
    expect(graded.rejected.some((line) => line.includes("repeats"))).toBe(true);
  });
});

describe("voicePromptFor", () => {
  it("names the clock, every candidate with its odds as runs, the plan, and the seats ahead with their basis", () => {
    const v = view();
    const prompt = voicePromptFor(v);
    expect(prompt).toContain("4 picks until your turn");
    for (const candidate of v.now) expect(prompt).toContain(v.names[candidate.playerId]!);
    expect(prompt).toMatch(/\d+ of \d+ runs/);
    expect(prompt).toContain("Turn 1, pick");
    expect(prompt).toContain("neutral prior");
    expect(prompt).not.toMatch(/[—;]/);
  });
});

describe("generateAdvisorVoice", () => {
  it("returns the validated slots from one gateway call", async () => {
    const v = view();
    const top = v.now[0]!;
    const name = v.names[top.playerId]!;
    const fetchMock = vi.fn(async () => okResponse(JSON.stringify({ [STRATEGY_SLOT]: `The room is leaning receiver. Take ${name} before it turns.`, [reasonSlotKey(top.playerId)]: `${name} fills your ${top.fillsSlot} slot right now.` })));
    const result = await generateAdvisorVoice(v, { apiKey: "test-key", fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.strategy).toContain(name);
    expect(result.reasons[top.playerId]).toContain(name);
    expect(result.failure).toBeNull();
    expect(result.usage?.totalTokens).toBe(620);
  });

  it("never throws: a refused gateway is a result with no slots and a stated failure", async () => {
    const v = view();
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 }));
    const result = await generateAdvisorVoice(v, { apiKey: "test-key", fetch: fetchMock });
    expect(result.strategy).toBeNull();
    expect(result.reasons).toEqual({});
    expect(result.failure).toMatch(/refused/);
  });
});

describe("voiceWithinBudget", () => {
  beforeEach(() => resetVoiceBudgetForTests());

  it("answers pending when the writer is late, then ready on the next ask once it lands, from one generation", async () => {
    let release: ((result: { strategy: string; reasons: Record<string, string>; rejected: string[]; usage: null; failure: null }) => void) | null = null;
    const factory = vi.fn(() => new Promise<{ strategy: string; reasons: Record<string, string>; rejected: string[]; usage: null; failure: null }>((resolve) => { release = resolve; }));
    const first = await voiceWithinBudget("d:t:1", factory, 5);
    expect(first.status).toBe("pending");
    release!({ strategy: "Take the back.", reasons: {}, rejected: [], usage: null, failure: null });
    await Promise.resolve();
    const second = await voiceWithinBudget("d:t:1", factory, 5);
    expect(second).toEqual({ status: "ready", strategy: "Take the back.", reasons: {} });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("answers absent when the writer landed with nothing usable", async () => {
    const voice = await voiceWithinBudget("d:t:2", async () => ({ strategy: null, reasons: {}, rejected: ["strategy: bad"], usage: null, failure: null }), 50);
    expect(voice.status).toBe("absent");
  });
});
