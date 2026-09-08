// THE ACCEPTANCE MEASUREMENT (capsule acceptance round, 2026-09-07) — what share of board players
// the writer actually gets WRITTEN, and when it fails, why.
//
// Run: npm run capsules:acceptance -- [sample size] [--cap=0.60] [--texts=out.json] [--rejections=out.json]   (default 30)
//      npm run capsules:acceptance -- 100 --templates-only
//
// THIS SPENDS GATEWAY MONEY. One `generateCapsule` per sampled player is one gateway call (plus a
// correction call for a part that failed), and a run of 100 is a few cents at the measured rate.
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
import { generateCapsule, type CapsuleFallbackReason, type CapsuleGenerationResult, type ReadAttempt } from "@/capsules/generate";
import { renderFactsForModel } from "@/capsules/render";
import { measureSameness, samenessOverThreshold, type SamenessReport, type SamenessRow } from "@/capsules/sameness";
import { wordCount, type CapsuleSize } from "@/capsules/validate";
import type { GatewayResponseInfo } from "@/capsules/write";
import { getStoredCapsulesFor } from "@/capsules/store";

const ARGUMENTS = process.argv.slice(2);
const TEMPLATES_ONLY = ARGUMENTS.includes("--templates-only");
const SAMPLE_SIZE = Number(ARGUMENTS.find((argument) => !argument.startsWith("--")) ?? 30);
/** `--cap=0.60` stops the run once the gateway has billed that many dollars, whatever the sample
 *  size asked for: a diagnostic's spend is decided before it starts, never discovered after. */
const COST_CAP_USD = Number(ARGUMENTS.find((argument) => argument.startsWith("--cap="))?.slice("--cap=".length) ?? Number.POSITIVE_INFINITY);
/** How many opener families the sameness printout lists. */
const OPENER_FAMILIES_PRINTED = 6;

/** `--model=zai/glm-5.2-fast` puts another model through the identical prompts, validator and rate
 *  limiter, which is the only way a comparison says anything about the MODEL (task 11). */
const MODEL = ARGUMENTS.find((argument) => argument.startsWith("--model="))?.slice("--model=".length);
/** `--thinking` puts the model's reasoning back on, which is what production ran before task 11
 *  measured it and turned it off. `--no-thinking` is kept as a no-op alias for the default. */
const THINKING = ARGUMENTS.includes("--thinking");
/** `--texts=<path>` writes every player's parts (both reads, the narrative, each part's own
 *  source) as JSON, for the persona read and for mining the board's own refrains. */
const TEXTS_PATH = ARGUMENTS.find((argument) => argument.startsWith("--texts="))?.slice("--texts=".length);
/** `--rejections=<path>` writes every player's fact sheet, every attempt at each read (stage,
 *  words, body, violations) and every refused narrative slot as JSON: the material for classifying
 *  a rejection by hand rather than by its category alone (written rate round, 2026-09-08). */
const REJECTIONS_PATH = ARGUMENTS.find((argument) => argument.startsWith("--rejections="))?.slice("--rejections=".length);

const SIZES: readonly CapsuleSize[] = ["compact", "full"];

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

const BAND_VIOLATION = /outside the required .* word band/;

/** Words over (+) or under (-) the size's band, zero inside it. */
function bandOffset(size: CapsuleSize, words: number): number {
  const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];
  if (words > maxWords) return words - maxWords;
  if (words < minWords) return words - minWords;
  return 0;
}

/** One attempt as the shape printout states it: "trim 122 (+2)", or the first violation's
 *  category when the attempt failed on something other than the band. */
function describeAttempt(size: CapsuleSize, attempt: ReadAttempt): string {
  const offset = bandOffset(size, attempt.words);
  const band = offset === 0 ? "" : ` (${offset > 0 ? "+" : ""}${offset})`;
  const first = attempt.violations[0];
  const failedOn = first === undefined ? "" : BAND_VIOLATION.test(first) ? "" : ` [${categoryOf(first)}]`;
  return `${attempt.stage} ${attempt.words}${band}${failedOn}`;
}

/** One read's whole attempt log on a line: "compact: draft 123 (+3) -> trim 122 (+2)". */
function describeAttempts(size: CapsuleSize, attempts: readonly ReadAttempt[]): string {
  return `${size}: ${attempts.map((attempt) => describeAttempt(size, attempt)).join(" -> ")}`;
}

/** p10/p50/p90 of a sample, for choosing a word band against what the model actually writes. */
function quantiles(values: readonly number[]): string {
  if (values.length === 0) return "no sample";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return `n=${sorted.length} min ${sorted[0]} p10 ${at(0.1)} p50 ${at(0.5)} p90 ${at(0.9)} max ${sorted[sorted.length - 1]}`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

/** One generated player as the sameness measure reads him: the same shape the sweep builds from
 *  a stored row, built here from the fresh result so the measure never needs the database. */
function samenessRowOf(facts: PlayerFacts, result: CapsuleGenerationResult): SamenessRow {
  return {
    playerId: facts.identity.id,
    name: facts.identity.name,
    bodyCompact: result.compact.text,
    bodyFull: result.full.text,
    source: result.source,
    narrative: Object.keys(result.narrative.slots).length === 0 ? null : result.narrative.slots,
  };
}

/**
 * THE SAMENESS PRINTOUT (refrains round, 2026-09-07) — the three board-level measures over this
 * run's own written capsules, each beside its configured line, with a verdict a reader can scan.
 */
function printSameness(report: SamenessReport): void {
  const { maxOpenerFamilyShare, maxRefrainShare, maxSheetTouringShare } = CAPSULE_CONFIG.repetition;
  const over = samenessOverThreshold(report);
  const verdict = (flag: boolean): string => (flag ? "OVER" : "ok");
  console.log("");
  console.log(`Sameness over ${report.capsules} written capsule(s):`);
  const worstOpener = report.openers[0];
  console.log(
    `  opener families: max share ${worstOpener === undefined ? "n/a" : percent(worstOpener.share)} (line ${percent(maxOpenerFamilyShare)}), ` +
      `${over.openers.length} over the line`,
  );
  for (const finding of report.openers.slice(0, OPENER_FAMILIES_PRINTED)) {
    console.log(`    ${percent(finding.share).padStart(4)}  ${finding.playerIds.length} player(s)  "${finding.key}"  e.g. "${finding.example}"`);
  }
  console.log(`  refrains (line ${percent(maxRefrainShare)}):`);
  for (const finding of report.refrains) {
    console.log(`    ${percent(finding.share).padStart(4)}  ${String(finding.playerIds.length).padStart(3)} player(s)  ${verdict(finding.share > maxRefrainShare && finding.playerIds.length > 1).padEnd(4)}  "${finding.key}"`);
  }
  console.log(`  sheet-touring: ${percent(report.sheetTouring.share)} (${report.sheetTouring.playerIds.length} player(s), line ${percent(maxSheetTouringShare)}) ${verdict(over.sheetTouring)}`);
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
  /** Wall-clock milliseconds per PLAYER, calls, retries and pacing included: the number the sweep's
   *  own budget geometry is built on, and the one a one-call-per-player change should move. */
  readonly playerLatencies: number[] = [];
  /** Gateway calls made per player, so "one call per player" is a measured count, not a claim. */
  readonly callsPerPlayer: number[] = [];
  /** Every read that fell to the template on the word band, with its whole attempt log, so the
   *  shape of the failure (an ignored trim, a draft far out, a correction that moved the wrong
   *  way) is visible rather than inferred (written rate round, 2026-09-08). */
  readonly bandFallbacks: { readonly player: string; readonly size: CapsuleSize; readonly attempts: readonly ReadAttempt[] }[] = [];
  /** How often each kind of correction was asked for, and how often it landed. */
  readonly corrections = new Map<string, { asked: number; landed: number }>();

  recordAttempts(player: string, size: CapsuleSize, attempts: readonly ReadAttempt[], written: boolean): void {
    const last = attempts[attempts.length - 1];
    if (!written && last !== undefined && last.violations[0] !== undefined && BAND_VIOLATION.test(last.violations[0])) {
      this.bandFallbacks.push({ player, size, attempts });
    }
    for (const attempt of attempts) {
      if (attempt.stage === "draft") continue;
      const entry = this.corrections.get(attempt.stage) ?? { asked: 0, landed: 0 };
      entry.asked += 1;
      if (attempt.violations.length === 0) entry.landed += 1;
      this.corrections.set(attempt.stage, entry);
    }
  }

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
    console.log(`Player latency: ${quantiles(this.playerLatencies)} (ms). Calls a player: ${quantiles(this.callsPerPlayer)}.`);
    console.log("");
    console.log("Lengths written (the band should be a range the model lands in):");
    for (const size of SIZES) {
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
    this.printAttemptShapes();
  }

  /** The word band's own printout: every fallback's attempts, then the over/under split at each
   *  stage, then how every kind of correction fared. */
  private printAttemptShapes(): void {
    console.log("");
    console.log("Word band fallbacks, every attempt (words, +over/-under the band):");
    if (this.bandFallbacks.length === 0) console.log("  (none)");
    for (const { player, size, attempts } of this.bandFallbacks) console.log(`  ${player.padEnd(24)} ${describeAttempts(size, attempts)}`);
    const split = (pick: (attempts: readonly ReadAttempt[]) => ReadAttempt | undefined): string => {
      const offsets = this.bandFallbacks.map(({ size, attempts }) => {
        const attempt = pick(attempts);
        return attempt === undefined ? null : bandOffset(size, attempt.words);
      });
      const over = offsets.filter((offset) => offset !== null && offset > 0).length;
      const under = offsets.filter((offset) => offset !== null && offset < 0).length;
      const inside = offsets.filter((offset) => offset === 0).length;
      return `${over} over, ${under} under, ${inside} inside`;
    };
    console.log(`  after the draft: ${split((attempts) => attempts[0])}; after the correction: ${split((attempts) => attempts[1])}`);
    console.log("Corrections by kind (asked, landed):");
    for (const [kind, { asked, landed }] of [...this.corrections.entries()].sort((a, b) => b[1].asked - a[1].asked)) {
      console.log(`  ${kind.padEnd(8)} ${String(asked).padStart(3)} asked, ${String(landed).padStart(3)} landed`);
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
  const texts: { readonly name: string; readonly result: CapsuleGenerationResult }[] = [];
  const samenessRows: SamenessRow[] = [];
  const rejections: {
    readonly name: string;
    readonly sheet: string;
    readonly compact: readonly ReadAttempt[];
    readonly full: readonly ReadAttempt[];
    readonly refusedSlots: CapsuleGenerationResult["narrative"]["refused"];
  }[] = [];

  const tally = new Tally();
  // THE THROTTLE'S OWN WORDS (founder, 2026-09-07) — every 429 verbatim, and one success to
  // compare its headers against.
  const throttleReports: GatewayResponseInfo[] = [];
  const successSamples: GatewayResponseInfo[] = [];
  const onGatewayResponse = (info: GatewayResponseInfo): void => {
    if (info.status === 429) throttleReports.push(info);
    else if (successSamples.length === 0 && info.status < 400) successSamples.push(info);
  };
  let first = true;
  for (const facts of sample) {
    if (tally.costUsd >= COST_CAP_USD) {
      console.log(`  stopped at the $${COST_CAP_USD.toFixed(2)} cap after ${tally.players} player(s).`);
      break;
    }
    if (!first) await new Promise((resolve) => setTimeout(resolve, CAPSULE_CONFIG.sweepPacingMs));
    first = false;

    const startedAt = Date.now();
    let calls = 0;
    const result = await generateCapsule(facts, {
      apiKey,
      ...(MODEL === undefined ? {} : { model: MODEL }),
      ...(THINKING ? { thinking: true } : {}),
      onCallLatency: (ms) => {
        calls += 1;
        tally.latencies.push(ms);
      },
      onGatewayResponse,
    });
    tally.playerLatencies.push(Date.now() - startedAt);
    tally.callsPerPlayer.push(calls);
    const written = result.source === "llm";
    const throttled = [result.compact, result.full].some((size) => size.fallbackReason?.kind === "throttled");
    tally.players += 1;
    if (written) tally.written += 1;
    if (throttled) tally.throttled += 1;
    tally.costUsd += result.usage?.costUsd ?? 0;

    for (const size of SIZES) {
      const read = result[size];
      const violation = decidingViolation(read.fallbackReason);
      tally.recordAttempts(facts.identity.name, size, read.attempts, violation === null);
      if (violation === null) tally.recordLength(size, wordCount(read.text), true);
      else {
        tally.record(violation);
        const last = read.attempts[read.attempts.length - 1];
        if (BAND_VIOLATION.test(violation) && last !== undefined) tally.recordLength(size, last.words, false);
      }
    }
    // The narrative's own rejections are counted in the same tally, prefixed so a reader can tell
    // a slot's rejection from a read's: the slots are graded by the same validator.
    for (const rejection of result.narrative.rejected) tally.record(rejection.slice(rejection.indexOf(": ") + 2));

    console.log(
      `  ${facts.identity.name.padEnd(24)} ${written ? "written" : throttled ? "THROTTLED" : "template"}  narrative slots ${Object.keys(result.narrative.slots).length}`,
    );
    texts.push({ name: facts.identity.name, result });
    samenessRows.push(samenessRowOf(facts, result));
    rejections.push({ name: facts.identity.name, sheet: renderFactsForModel(facts), compact: result.compact.attempts, full: result.full.attempts, refusedSlots: result.narrative.refused });
  }

  tally.print();
  printSameness(measureSameness(samenessRows));
  console.log("");
  console.log(`Pacing in force: ${CAPSULE_CONFIG.gateway.callsPerMinute} calls a minute. Reasoning: ${THINKING ? "on" : "off"}.`);
  console.log(`One successful response's limit headers: ${JSON.stringify(successSamples[0]?.limitHeaders ?? null)}`);
  console.log(`429s seen: ${throttleReports.length}`);
  for (const report of throttleReports.slice(0, 5)) {
    console.log(`  status ${report.status} "${report.statusText}" headers ${JSON.stringify(report.limitHeaders)}`);
    console.log(`  body ${JSON.stringify(report.body ?? "")}`);
  }
  if (TEXTS_PATH !== undefined) {
    const dump = texts.map(({ name, result }) => ({
      name,
      source: result.source,
      compact: { source: result.compact.source, text: result.compact.text },
      full: { source: result.full.source, text: result.full.text },
      narrative: result.narrative.slots,
    }));
    writeFileSync(TEXTS_PATH, JSON.stringify(dump, null, 2));
  }
  if (REJECTIONS_PATH !== undefined) writeFileSync(REJECTIONS_PATH, JSON.stringify(rejections, null, 2));
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
