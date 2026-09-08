// THE ACCEPTANCE MEASUREMENT (capsule acceptance round, 2026-09-07) — what share of board players
// the writer actually gets WRITTEN, and when it fails, why.
//
// Run: npm run capsules:acceptance -- [sample size]     (default 30)
//      npm run capsules:acceptance -- 100 --templates-only
//
// THIS SPENDS GATEWAY MONEY. One `generateCapsule` per sampled player is three calls (the two
// reads plus the narrative), and a run of 100 is roughly a third of a dollar at the measured rate.
// It is a diagnostic an operator runs deliberately, never part of a test run or a job.
//
// WHY IT EXISTS. 446 of 659 players sat on the template and the assumption was a throttled
// gateway. A live sample said otherwise: the gateway answered, and the VALIDATOR rejected roughly
// nine of every ten answers, mostly over numbers that were honest readings of supplied facts. A
// pass rate nobody measures is a pass rate nobody can fix, so this prints the same two things
// every time: the share written, and the rejection tally by category.
//
// THE TALLY IS BY CATEGORY, NOT BY MESSAGE. Every violation string carries the specific number or
// name that failed, so counting raw messages would produce a list as long as the sample.
// `categoryOf` folds them into the handful of causes an engineer can act on.
import { writeFileSync } from "node:fs";
import { createDb, type Db } from "@/db/client";
import { collectBoardFacts } from "@/capsules/collect";
import { CAPSULE_CONFIG, CAPSULE_MODEL } from "@/capsules/config";
import type { PlayerFacts } from "@/capsules/facts";
import { generateCapsule, type CapsuleFallbackReason } from "@/capsules/generate";
import { getStoredCapsulesFor } from "@/capsules/store";

const ARGUMENTS = process.argv.slice(2);
const TEMPLATES_ONLY = ARGUMENTS.includes("--templates-only");
const SAMPLE_SIZE = Number(ARGUMENTS.find((argument) => !argument.startsWith("--")) ?? 30);

/** `--model=zai/glm-5.2-fast` puts another model through the identical prompts, validator and rate
 *  limiter, which is the only way a comparison says anything about the MODEL (task 11). */
const MODEL = ARGUMENTS.find((argument) => argument.startsWith("--model="))?.slice("--model=".length);
/** `--thinking` puts the model's reasoning back on, which is what production ran before task 11
 *  measured it and turned it off. `--no-thinking` is kept as a no-op alias for the default. */
const THINKING = ARGUMENTS.includes("--thinking");
/** `--texts=<path>` writes each player's compact read to a file, for the persona read. */
const TEXTS_PATH = ARGUMENTS.find((argument) => argument.startsWith("--texts="))?.slice("--texts=".length);

/** The causes an engineer can act on. Ordered most-actionable first; `categoryOf` returns the
 *  first that matches, so the order is also the precedence. */
const CATEGORIES: readonly { readonly name: string; readonly test: RegExp }[] = [
  { name: "ungrounded number", test: /The number ".*" does not trace/ },
  { name: "ungrounded name", test: /The name ".*" does not trace/ },
  { name: "word band", test: /outside the required .* word band/ },
  { name: "mixed evidence (downside not cited)", test: /^Mixed evidence:/ },
  { name: "banned vocabulary", test: /banned term/ },
  { name: "competitor named", test: /names a competitor/ },
  { name: "em-dash", test: /contains an em-dash/ },
  { name: "semicolon", test: /contains a semicolon/ },
  { name: "unframed floor claim", test: /says "floor"/ },
  { name: "empty completion", test: /completion was empty/ },
  { name: "throttled (gateway never answered)", test: /^throttled$/ },
];

function categoryOf(violation: string): string {
  return CATEGORIES.find((category) => category.test.test(violation))?.name ?? "other";
}

/** The one violation that decided a size's fallback, or `null` when that size was written. */
function decidingViolation(fallbackReason: CapsuleFallbackReason | null): string | null {
  if (fallbackReason === null) return null;
  return fallbackReason.kind === "throttled" ? "throttled" : fallbackReason.firstViolation;
}

function wordsIn(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/** The word count a band violation is complaining about, so the rejected lengths can be measured
 *  alongside the accepted ones without the script holding every rejected body. */
function rejectedWordsOf(violation: string): number | null {
  const match = /^Word count (\d+) is outside/.exec(violation);
  return match === null ? null : Number(match[1]);
}

/** p10/p50/p90 of a sample, for choosing a word band against what the model actually writes. */
function quantiles(values: readonly number[]): string {
  if (values.length === 0) return "no sample";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return `n=${sorted.length} min ${sorted[0]} p10 ${at(0.1)} p50 ${at(0.5)} p90 ${at(0.9)} max ${sorted[sorted.length - 1]}`;
}

/**
 * The counts one run accumulates. A script's own running total, mutated in one loop and printed
 * once — the one place in this repo where a plain counter beats rebuilding a record per player.
 *
 * THROTTLES ARE COUNTED APART FROM QUALITY (task 10). A player the gateway never answered says
 * nothing about the writer or the validator, and folding him into the denominator makes a rate
 * limit look like a quality problem. The headline rate is over ANSWERED players, with the
 * throttled ones reported beside it.
 */
class Tally {
  players = 0;
  written = 0;
  throttled = 0;
  costUsd = 0;
  readonly byCategory = new Map<string, number>();
  /** One example per category, so an engineer can see the actual sentence that failed. */
  readonly examples = new Map<string, string>();
  /** Word counts, for choosing a band against what the model writes rather than against a guess. */
  readonly acceptedWords = new Map<string, number[]>();
  readonly rejectedWords = new Map<string, number[]>();
  /** Every gateway round trip's own milliseconds, for the latency half of a model comparison. */
  readonly latencies: number[] = [];

  record(violation: string): void {
    const category = categoryOf(violation);
    this.byCategory.set(category, (this.byCategory.get(category) ?? 0) + 1);
    if (!this.examples.has(category)) this.examples.set(category, violation);
  }

  recordLength(size: string, words: number, accepted: boolean): void {
    const into = accepted ? this.acceptedWords : this.rejectedWords;
    const list = into.get(size) ?? [];
    list.push(words);
    into.set(size, list);
  }

  print(): void {
    const answered = this.players - this.throttled;
    const rate = answered === 0 ? 0 : (this.written / answered) * 100;
    console.log("");
    console.log(`WRITTEN: ${this.written} of ${answered} answered (${rate.toFixed(0)}%). Throttled: ${this.throttled} of ${this.players}. Spend: $${this.costUsd.toFixed(4)}.`);
    const perPlayer = this.players === 0 ? 0 : this.costUsd / this.players;
    console.log(`Cost a player: $${perPlayer.toFixed(5)}. Call latency: ${quantiles(this.latencies)} (ms).`);
    console.log("");
    console.log("Lengths written (the band should be a range the model lands in):");
    for (const size of ["compact", "full"]) {
      console.log(`  ${size} accepted  ${quantiles(this.acceptedWords.get(size) ?? [])}`);
      console.log(`  ${size} rejected  ${quantiles(this.rejectedWords.get(size) ?? [])}`);
    }
    console.log("");
    console.log("Rejections, most common first:");
    const ordered = [...this.byCategory.entries()].sort((a, b) => b[1] - a[1]);
    if (ordered.length === 0) console.log("  (none)");
    for (const [category, count] of ordered) {
      console.log(`  ${String(count).padStart(4)}  ${category}`);
      console.log(`        e.g. ${this.examples.get(category) ?? ""}`);
    }
  }
}

async function sampleFor(db: Db): Promise<readonly PlayerFacts[]> {
  const pass = await collectBoardFacts(db, new Date());
  if (!TEMPLATES_ONLY) return pass.facts.slice(0, SAMPLE_SIZE);
  // The population the founder is actually looking at: the players still on the template.
  const stored = await getStoredCapsulesFor(db, pass.facts.map((facts) => facts.identity.id));
  const onTemplate = pass.facts.filter((facts) => (stored.get(facts.identity.id)?.source ?? "template") === "template");
  return onTemplate.slice(0, SAMPLE_SIZE);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env[CAPSULE_CONFIG.gateway.envVars.apiKey];
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set. Run through `npm run capsules:acceptance`, which loads .env.local.");
  if (apiKey === undefined || apiKey === "") throw new Error(`${CAPSULE_CONFIG.gateway.envVars.apiKey} is not set; there is no gateway to measure against.`);
  if (!Number.isInteger(SAMPLE_SIZE) || SAMPLE_SIZE < 1) throw new Error(`Sample size must be a positive integer, got ${JSON.stringify(SAMPLE_SIZE)}.`);

  const db = createDb(databaseUrl);
  const sample = await sampleFor(db);
  console.log(
    `capsule acceptance: ${sample.length} player(s)${TEMPLATES_ONLY ? " still on the template" : ""}, ` +
      `model ${MODEL ?? CAPSULE_MODEL}${THINKING ? " thinking" : " not thinking"}, ` +
      `${CAPSULE_CONFIG.gateway.callsPerMinute} calls a minute.`,
  );
  const texts: string[] = [];

  const tally = new Tally();
  let first = true;
  for (const facts of sample) {
    if (!first) await new Promise((resolve) => setTimeout(resolve, CAPSULE_CONFIG.sweepPacingMs));
    first = false;

    const result = await generateCapsule(facts, {
      apiKey,
      ...(MODEL === undefined ? {} : { model: MODEL }),
      ...(THINKING ? { thinking: true } : {}),
      onCallLatency: (ms) => tally.latencies.push(ms),
    });
    const written = result.source === "llm";
    const throttled = [result.compact, result.full].some((size) => size.fallbackReason?.kind === "throttled");
    tally.players += 1;
    if (written) tally.written += 1;
    if (throttled) tally.throttled += 1;
    tally.costUsd += (result.compact.usage?.costUsd ?? 0) + (result.full.usage?.costUsd ?? 0) + (result.narrative.usage?.costUsd ?? 0);

    for (const [name, size] of [["compact", result.compact], ["full", result.full]] as const) {
      const violation = decidingViolation(size.fallbackReason);
      if (violation === null) tally.recordLength(name, wordsIn(size.text), true);
      else {
        tally.record(violation);
        const rejectedWords = rejectedWordsOf(violation);
        if (rejectedWords !== null) tally.recordLength(name, rejectedWords, false);
      }
    }
    // The narrative's own rejections are counted in the same tally, prefixed so a reader can tell
    // a slot's rejection from a read's: the slots are graded by the same validator.
    for (const rejection of result.narrative.rejected) tally.record(rejection.slice(rejection.indexOf(": ") + 2));

    console.log(
      `  ${facts.identity.name.padEnd(24)} ${written ? "written" : throttled ? "THROTTLED" : "template"}  narrative slots ${Object.keys(result.narrative.slots).length}`,
    );
    texts.push(`===== ${facts.identity.name} (${result.compact.source})\n${result.compact.text}\n`);
  }

  tally.print();
  if (TEXTS_PATH !== undefined) writeFileSync(TEXTS_PATH, texts.join("\n"));
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
