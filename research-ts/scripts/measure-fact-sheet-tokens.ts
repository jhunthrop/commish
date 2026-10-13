// Measures the model-facing fact sheet's size, before and after the depth section.
// Run: npx tsx scripts/measure-fact-sheet-tokens.ts
//
// THE METHOD, STATED RATHER THAN IMPLIED. There is no tokenizer in this repository and adding a
// dependency to answer "did the prompt get much bigger" would be the wrong trade, so the estimate
// is CHARACTERS DIVIDED BY FOUR, the standard rough tokens-per-character ratio for English prose.
// It is an estimate and is reported as one; what the measurement is actually for is the RATIO
// between before and after, and that ratio is unaffected by the constant.
//
// THE "BEFORE" IS THE SAME RENDER WITH THE APPENDED SECTION REMOVED, not a checkout of the previous
// commit. The change is additive by construction — one section appended last, every earlier section
// byte-identical — so slicing the appended heading off reproduces the old output exactly, and does
// it against the same five players rather than against whatever a second run happened to collect.
import { getDb } from "@research-ts/db/client";
import { collectAllPlayerFacts } from "@research-ts/capsules/collect";
import { renderFactsForModel } from "@research-ts/capsules/render";
import { renderDepthSection } from "@research-ts/capsules/render-depth";

const SAMPLE_SIZE = 5;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN);
}

const db = getDb();
const facts = await collectAllPlayerFacts(db);
if (facts.length === 0) throw new Error("No board facts on this database: nothing to measure.");

// The top of the board by our own rank, which is the population a capsule is actually written for.
const sample = [...facts].sort((a, b) => a.market.boardRank - b.market.boardRank).slice(0, SAMPLE_SIZE);

let beforeTotal = 0;
let afterTotal = 0;
for (const player of sample) {
  const after = renderFactsForModel(player);
  const depth = renderDepthSection(player);
  const before = depth === null ? after : after.slice(0, after.length - depth.length - "\n\n".length);
  beforeTotal += estimateTokens(before);
  afterTotal += estimateTokens(after);
  console.log(
    [
      player.identity.name.padEnd(24),
      `before ${String(estimateTokens(before)).padStart(5)}`,
      `after ${String(estimateTokens(after)).padStart(5)}`,
      `depth lines ${depth === null ? 0 : depth.split("\n").length - 1}`,
    ].join("  "),
  );
}

console.log("");
console.log(`mean before ${Math.round(beforeTotal / sample.length)} tokens, mean after ${Math.round(afterTotal / sample.length)} tokens`);
console.log(`growth ${Math.round(((afterTotal - beforeTotal) / beforeTotal) * 100)}%, estimated at ${CHARS_PER_TOKEN} characters per token`);

// The connection pool keeps the event loop alive after the last read, so a plain return would leave
// this script running forever with nothing to do. Every write is done by here.
process.exit(0);
