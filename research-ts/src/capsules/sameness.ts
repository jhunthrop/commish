import { CAPSULE_CONFIG } from "./config";
import type { NarrativeSlots } from "./narrative-slots";

/**
 * THE BOARD-LEVEL SAMENESS MEASURE (refrains round, 2026-09-07) — what `repetition.ts` cannot see.
 *
 * That check counts whole normalised sentences, so "Let's talk about Bijan, because the price is
 * wrong" and "Let's talk about Gibbs, because the price is wrong" are two different sentences to it
 * and the same tic to a reader. This file measures the three shapes of sameness the founder
 * actually named, each as a share of the llm-written capsules on the board:
 *
 *   OPENER FAMILIES  the first `repetition.openerWords` words of a read, names and numbers masked;
 *   REFRAINS         a curated list of stock stems (`repetition.refrainStems`), each as the share
 *                    of capsules carrying it anywhere (either read or any narrative slot);
 *   SHEET-TOURING    the share of reads that cite all three usage shares with their ranks, which
 *                    is the fact sheet read back rather than a case made from it.
 *
 * TEMPLATE CAPSULES ARE EXCLUDED. A template read is identical across players by design, and the
 * question here is whether the WRITER has a tic, not whether the floor is a floor.
 *
 * PURE. The sweep and the acceptance script do the reading; this file decides nothing but what is
 * the same, and `samenessOverThreshold`/`playersToRegenerateForSameness` say what the configured
 * lines make of it.
 */

export interface SamenessRow {
  readonly playerId: string;
  /** The player's own name, masked out of his opener. `null` when the caller has only the stored
   *  row, in which case a capitalised word is masked by shape instead (see `openerFamily`). */
  readonly name: string | null;
  readonly bodyCompact: string;
  readonly bodyFull: string;
  readonly source: "llm" | "template";
  readonly narrative: NarrativeSlots | null;
}

/** One measured share: the key it was counted under, an example in a player's own words, every
 *  player carrying it (in row order) and the share of the measured board they make. */
export interface ShareFinding {
  readonly key: string;
  readonly example: string;
  readonly playerIds: readonly string[];
  readonly share: number;
}

export interface SamenessReport {
  /** How many llm-written capsules the shares below are over. */
  readonly capsules: number;
  /** Every opener family seen, most common first. */
  readonly openers: readonly ShareFinding[];
  /** One finding per configured stem, in the configured order, at zero when nobody says it. */
  readonly refrains: readonly ShareFinding[];
  readonly sheetTouring: ShareFinding;
}

type RepetitionConfig = typeof CAPSULE_CONFIG.repetition;

const TITLECASE = /^[A-Z][a-z]/;

function isTitlecase(token: string): boolean {
  return TITLECASE.test(token.replace(/^["'(]+/, ""));
}

/** A token with its surrounding punctuation stripped, lower-cased. Apostrophes stay: "let's" is
 *  one word to a reader and to this measure. */
function bareWord(token: string): string {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, "").toLowerCase();
}

function nameWordsOf(name: string | null): ReadonlySet<string> {
  return new Set((name ?? "").toLowerCase().split(/\s+/).filter((word) => word !== ""));
}

function firstWords(text: string, wordCount: number): readonly string[] {
  return text.trim().split(/\s+/).filter((token) => token !== "").slice(0, wordCount);
}

/**
 * The first `wordCount` words of `text`, masked: the player's own name and any capitalised word
 * past the first become `_`, anything carrying a digit becomes `#`, everything else is lower-cased
 * with its punctuation stripped. The first word is masked by shape only when the word after it is
 * a capitalised word that is NOT the player's name, which is what an unknown two-word name at the
 * start of a sentence looks like ("Justin Jefferson is going") and what "Buy Jahmyr Gibbs" is not.
 */
export function openerFamily(text: string, name: string | null, wordCount: number = CAPSULE_CONFIG.repetition.openerWords): string {
  const tokens = firstWords(text, wordCount);
  const nameWords = nameWordsOf(name);
  const second = tokens[1];
  const firstLooksLikeAName = second !== undefined && isTitlecase(second) && !nameWords.has(bareWord(second));
  return tokens
    .map((token, index) => {
      const word = bareWord(token);
      if (word === "") return "";
      if (nameWords.has(word)) return "_";
      if (/\d/.test(word)) return "#";
      return isTitlecase(token) && (index > 0 || firstLooksLikeAName) ? "_" : word;
    })
    .filter((word) => word !== "")
    .join(" ");
}

/** The first `wordCount` words of a read as a person wrote them, the player's own name replaced by
 *  "[name]" (a run of name words collapsing to one) so the example can be quoted into another
 *  player's prompt without handing that prompt a name its sheet never printed. */
function openerExample(text: string, name: string | null, wordCount: number): string {
  const nameWords = nameWordsOf(name);
  return firstWords(text, wordCount)
    .map((token) => (nameWords.has(bareWord(token)) ? "[name]" : token))
    .join(" ")
    .replace(/(\[name\]\s+)+\[name\]/g, "[name]");
}

/** The comparison form both sides of a stem test are put in: case folded, every non-alphanumeric
 *  run a single space. An apostrophe becomes a space too, so "here's" and "here s" agree. */
function foldForStem(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Whether `text` carries `stem` as whole words, however it is cased or punctuated. */
export function containsStem(text: string, stem: string): boolean {
  return foldForStem(text).includes(foldForStem(stem));
}

/** The three usage shares as a read names them: the sheet's own label, or the plain way a person
 *  says the same thing ("of the snaps", "of the targets"). */
const USAGE_SHARE_CUES = [/\bsnap share\b|\bof (?:the|his team's) snaps\b/i, /\btarget share\b|\bof (?:the|his team's) targets\b/i, /\bred[- ]zone\b/i] as const;
/** A rank stated the way the fact sheet states one: "RB2" or "among 40 qualifying". */
const RANK_CUE = /\b(?:QB|RB|WR|TE)\d{1,2}\b|\bamong \d+\b/gi;
const RANK_CUES_FOR_A_TOUR = 3;

/** A read that names all three usage shares and states at least three ranks beside them. */
export function toursTheSheet(text: string): boolean {
  if (!USAGE_SHARE_CUES.every((cue) => cue.test(text))) return false;
  return (text.match(RANK_CUE) ?? []).length >= RANK_CUES_FOR_A_TOUR;
}

/** Every text one player's capsule carries: both reads and every narrative slot. */
function textsOf(row: SamenessRow): readonly string[] {
  const slots = row.narrative === null ? [] : Object.values(row.narrative).filter((value): value is string => typeof value === "string");
  return [row.bodyCompact, row.bodyFull, ...slots];
}

function finding(key: string, example: string, playerIds: readonly string[], capsules: number): ShareFinding {
  return { key, example, playerIds, share: capsules === 0 ? 0 : playerIds.length / capsules };
}

/** Findings out of a map of key to players, most common first, ties by key. */
function findingsOf(byKey: ReadonlyMap<string, { readonly example: string; readonly playerIds: readonly string[] }>, capsules: number): readonly ShareFinding[] {
  return [...byKey.entries()]
    .map(([key, entry]) => finding(key, entry.example, entry.playerIds, capsules))
    .sort((a, b) => b.playerIds.length - a.playerIds.length || a.key.localeCompare(b.key));
}

/** Adds `playerId` under `key` once, remembering the first example seen for the key. */
function tally(into: Map<string, { example: string; playerIds: string[] }>, key: string, example: string, playerId: string): void {
  const entry = into.get(key);
  if (entry === undefined) into.set(key, { example, playerIds: [playerId] });
  else if (!entry.playerIds.includes(playerId)) entry.playerIds.push(playerId);
}

function openerFindings(rows: readonly SamenessRow[], config: RepetitionConfig): readonly ShareFinding[] {
  const byFamily = new Map<string, { example: string; playerIds: string[] }>();
  for (const row of rows) {
    for (const read of [row.bodyCompact, row.bodyFull]) {
      const family = openerFamily(read, row.name, config.openerWords);
      if (family !== "") tally(byFamily, family, openerExample(read, row.name, config.openerWords), row.playerId);
    }
  }
  return findingsOf(byFamily, rows.length);
}

function refrainFindings(rows: readonly SamenessRow[], config: RepetitionConfig): readonly ShareFinding[] {
  return config.refrainStems.map((stem) => {
    const playerIds = rows.filter((row) => textsOf(row).some((text) => containsStem(text, stem))).map((row) => row.playerId);
    return finding(stem, stem, playerIds, rows.length);
  });
}

function sheetTouringFinding(rows: readonly SamenessRow[]): ShareFinding {
  const touring = rows.filter((row) => toursTheSheet(row.bodyCompact) || toursTheSheet(row.bodyFull));
  const example = touring[0] === undefined ? "" : toursTheSheet(touring[0].bodyCompact) ? touring[0].bodyCompact : touring[0].bodyFull;
  return finding("sheet-touring", example, touring.map((row) => row.playerId), rows.length);
}

/** The three measures over the llm-written capsules in `rows`. */
export function measureSameness(rows: readonly SamenessRow[], config: RepetitionConfig = CAPSULE_CONFIG.repetition): SamenessReport {
  const written = rows.filter((row) => row.source === "llm");
  return {
    capsules: written.length,
    openers: openerFindings(written, config),
    refrains: refrainFindings(written, config),
    sheetTouring: sheetTouringFinding(written),
  };
}

export interface SamenessOverThreshold {
  readonly openers: readonly ShareFinding[];
  readonly refrains: readonly ShareFinding[];
  readonly sheetTouring: boolean;
}

/** What the configured lines make of a report. Strictly over: a share exactly at the line is at
 *  the line, not past it, the same rule `stockSentences` keeps. A family or a stem on a single
 *  player is never flagged, however small the board. */
export function samenessOverThreshold(report: SamenessReport, config: RepetitionConfig = CAPSULE_CONFIG.repetition): SamenessOverThreshold {
  const shared = (finding: ShareFinding): boolean => finding.playerIds.length > 1;
  return {
    openers: report.openers.filter((finding) => shared(finding) && finding.share > config.maxOpenerFamilyShare),
    refrains: report.refrains.filter((finding) => shared(finding) && finding.share > config.maxRefrainShare),
    sheetTouring: shared(report.sheetTouring) && report.sheetTouring.share > config.maxSheetTouringShare,
  };
}

/** Every player the sweep should write again: anyone in a flagged opener family or carrying a
 *  flagged refrain, plus the sheet-tourers when touring itself is over the line. Once each, in
 *  the order the findings list them. */
export function playersToRegenerateForSameness(report: SamenessReport, config: RepetitionConfig = CAPSULE_CONFIG.repetition): readonly string[] {
  const over = samenessOverThreshold(report, config);
  const ids = [...over.openers, ...over.refrains].flatMap((finding) => finding.playerIds);
  return [...new Set([...ids, ...(over.sheetTouring ? report.sheetTouring.playerIds : [])])];
}

/** The phrases the next run's prompt names as worn out on this board: every flagged stem, and one
 *  player's own first words for every flagged opener family. */
export function phrasesToAvoid(report: SamenessReport, config: RepetitionConfig = CAPSULE_CONFIG.repetition): readonly string[] {
  const over = samenessOverThreshold(report, config);
  return [...over.refrains.map((finding) => finding.key), ...over.openers.map((finding) => finding.example)];
}
