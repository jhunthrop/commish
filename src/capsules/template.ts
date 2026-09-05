import type { PlayerFacts } from "./facts";

/**
 * THE PERMANENT FLOOR (spec §9 AMENDED) — assembled from the SAME `PlayerFacts` the writer reads,
 * with no gateway call and no chance of ever failing validation: every sentence here is a plain
 * statement of a fact already in `facts`, so a gateway outage or a free-tier throttle never blanks
 * a page or fabricates a word. One template serves BOTH the peek's compact slot and the full
 * page's "Read" slot — a fallback's job is honesty and availability, not matching a stylistic
 * length band a template was never trying to hit.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY (founder card review, 2026-09-05): the rank, the ADP, and
 * the expected-games figure all live on the SAME screen already (the rail above, the evidence
 * chips below), and the first live card read as three surfaces echoing one another. The floor
 * complements its neighbours; it never repeats them. Season points round to whole numbers here
 * for the same reason "p10" never ships: 247.12 is register precision, 247 is a number a
 * manager says out loud.
 */
export function renderTemplateCapsule(facts: PlayerFacts): string {
  const { identity, market, projection, season, byeWeek, injury } = facts;
  const sentences: string[] = [
    `${identity.name} (${identity.position}, ${identity.team}) projects for ${Math.round(projection.projectedPoints)} points this season.`,
    `Most seasons land between ${Math.round(projection.typicalLow)} and ${Math.round(projection.typicalHigh)}; the full range (injury seasons on the low end, smash seasons on the high end) runs ${Math.round(projection.floorPoints)} to ${Math.round(projection.ceilingPoints)}.`,
  ];

  if (market.adp === null) {
    // The one market sentence the floor keeps: an UNPRICED player is a fact no other surface
    // states. A priced player's ADP already sits in the rail above this card.
    sentences.push("The market has not priced him.");
  }

  const strongestLaw = [...facts.evidence].filter((item) => item.kind === "law").sort((a, b) => Math.abs(b.netEffectPoints) - Math.abs(a.netEffectPoints))[0];
  if (strongestLaw !== undefined && strongestLaw.kind === "law") {
    sentences.push(`${strongestLaw.headline} is worth ${strongestLaw.netEffectPoints >= 0 ? "+" : ""}${strongestLaw.netEffectPoints} points a game to his outlook.`);
  }

  if (season !== null) {
    const gameWord = season.gamesPlayed === 1 ? "game" : "games";
    sentences.push(`Through ${season.gamesPlayed} ${gameWord} this season he is averaging ${season.pointsPerGame} points a game.`);
  }

  if (byeWeek !== null) sentences.push(`His bye is week ${byeWeek}.`);

  // THE TRI-STATE READ (fix round 1, CRITICAL 2) — "clean" and "unknown" never share a sentence:
  // an "unknown" read must never claim health, since no snapshot has actually checked.
  if (injury.state === "designated") sentences.push(`The injury report lists him as ${injury.designation} as of ${injury.asOf.slice(0, 10)}.`);
  else if (injury.state === "clean") sentences.push(`The injury report showed no designation for him as of ${injury.asOf.slice(0, 10)}.`);
  else sentences.push("No injury feed has been checked for him yet.");

  return sentences.join(" ");
}
