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
 *
 * ONE COLOR SENTENCE, AT MOST (spec §9 AMENDED 2026-09-05) — last season's own finish and points
 * per game, when the store carries one, so the floor benefits from the same color the writer gets
 * without turning a fallback into a second capsule: never the props lines, the Vegas win total, or
 * the usage shares, which stay the writer's own material.
 */
/**
 * THE LAW SENTENCE, SAID OUT LOUD (dossier-voice round §3.2, founder: "this needs to feel like a
 * human made it"). It used to read "22.7% red-zone touch share is worth -6.4 points a game to his
 * outlook" — a signed number with the direction hidden inside its own minus sign and no statement
 * of what the number does to him. The direction is now a verb, the magnitude is unsigned because
 * the verb already carries the sign, and the sentence says whose outlook it moves. Nothing about
 * the fact changes: the same headline, the same figure, to the same one decimal.
 */
function lawSentence(headline: string, netEffectPoints: number): string {
  const magnitude = Math.abs(netEffectPoints).toFixed(1);
  return netEffectPoints >= 0
    ? `${headline} adds ${magnitude} points a game to what we expect from him.`
    : `${headline} costs him ${magnitude} points a game against what we would otherwise expect.`;
}

export function renderTemplateCapsule(facts: PlayerFacts): string {
  const { identity, market, projection, season, byeWeek, injury, lastSeasonStory } = facts;
  const sentences: string[] = [
    `${identity.name} (${identity.position}, ${identity.team}) projects for ${Math.round(projection.projectedPoints)} points this season.`,
    `Most seasons land between ${Math.round(projection.typicalLow)} and ${Math.round(projection.typicalHigh)}. The full range runs ${Math.round(projection.floorPoints)} to ${Math.round(projection.ceilingPoints)}, where the low end is what an injury year looks like and the high end is the smash case.`,
  ];

  if (lastSeasonStory !== null) {
    sentences.push(`Last season he finished ${identity.position}${lastSeasonStory.pointsRank.positionRank} at the position, averaging ${lastSeasonStory.pointsPerGame} points a game.`);
  }

  if (market.adp === null) {
    // The one ADP sentence the floor keeps: a player with NO ADP is a fact no other surface
    // states. A player who has one already shows it in the rail above this card. "He has no ADP",
    // never "the market has not priced him": fantasy words, not trading words (founder 2026-09-07).
    sentences.push("He has no ADP.");
  }

  const strongestLaw = [...facts.evidence].filter((item) => item.kind === "law").sort((a, b) => Math.abs(b.netEffectPoints) - Math.abs(a.netEffectPoints))[0];
  if (strongestLaw !== undefined && strongestLaw.kind === "law") {
    sentences.push(lawSentence(strongestLaw.headline, strongestLaw.netEffectPoints));
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
  else sentences.push("We have not checked an injury feed for him yet.");

  return sentences.join(" ");
}
