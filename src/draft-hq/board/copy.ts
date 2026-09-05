/**
 * THE BOARD'S OWN MANAGER-LANGUAGE COPY (board persona-review fix round, 2026-09-04) — pure
 * sentence builders for the cells the founder session flagged as jargon, kept here (not inline
 * in `board-view.tsx`) so each one is independently testable and never re-derived at a second
 * call site.
 */
import { lawGroupLabel, type EvidenceGroup } from "@/league-room/outlook/groups";

/**
 * FIX 3 — the retired "Strongest law" column's own sentence, moved to the why drawer's top line.
 * `groups` is already sorted strongest-first, law groups before fact groups (`groupReasons`'s own
 * contract), so the first `"law"` group IS the strongest evidence; `null` when nothing fired (a
 * fact-only reason list, or none at all) rather than a fabricated sentence.
 */
export function strongestEvidenceSentence(groups: readonly EvidenceGroup[]): string | null {
  const strongest = groups.find((group): group is Extract<EvidenceGroup, { kind: "law" }> => group.kind === "law");
  return strongest === undefined ? null : lawGroupLabel(strongest);
}

/**
 * FIX 2 — "Vs market": whole picks, in words, never a bare signed number. The value case
 * ("market takes him 25 picks later") is the one that earns green ink — the market underrating
 * him relative to our own rank is real value. The overpriced case ("priced 17 picks early") is
 * NEUTRAL ink, never red: red implies a bad player, and this number never meant that — it means
 * the market reaches for him earlier than the evidence does, which is a fact about the market,
 * not a verdict on the man.
 *
 * `gap` is the caller's own `marketAdp - rank` (positive: market drafts him later than we rank
 * him). Rounds to the nearest whole pick, since a market ADP is fractional but nobody drafts a
 * fraction of a pick; a gap that rounds to exactly zero reads as "even with the market" — neither
 * color, because agreeing with the market is information, not a verdict, the same law `EdgeCell`
 * already keeps for a zero gap.
 */
export interface VsMarketLabel {
  readonly text: string;
  readonly tone: "positive" | "neutral";
}

export function vsMarketLabel(gap: number | null): VsMarketLabel | null {
  if (gap === null) return null;
  const wholePicks = Math.round(gap);
  if (wholePicks === 0) return { text: "even with the market", tone: "neutral" };
  if (wholePicks > 0) return { text: `market takes him ${wholePicks} pick${wholePicks === 1 ? "" : "s"} later`, tone: "positive" };
  const early = Math.abs(wholePicks);
  return { text: `priced ${early} pick${early === 1 ? "" : "s"} early`, tone: "neutral" };
}

/**
 * FIX 4 — the tier band's own sentence, replacing the old jargon fragment ("4 left, 6.4 pt
 * cliff") with a full, plain sentence that names the tier grade and the position out loud rather
 * than making a reader decode the badge beside it: "Tier S · one RB left before a 6.4 point
 * drop". `"one"` is spelled out for the singular count (the founder's own example), every other
 * count prints as a numeral — the same "spell out only the one that reads as a word" convention
 * this product uses nowhere else because no other count-of-one sentence existed before this one.
 *
 * `dropToNextTier` of zero or less means this is the board's last tier at this position: there is
 * no next drop to name, so the sentence states the count alone rather than inventing a drop.
 */
export function tierBandSentence(grade: "S" | "A" | "B" | "C", position: string, playersLeftInTier: number, dropToNextTier: number): string {
  const count = playersLeftInTier === 1 ? "one" : String(playersLeftInTier);
  const left = `${count} ${position} left`;
  if (dropToNextTier <= 0) return `Tier ${grade} · ${left}`;
  return `Tier ${grade} · ${left} before a ${dropToNextTier.toFixed(1)} point drop`;
}
