import { BENCH_SLOT, type RosterSlotConfig } from "@research-ts/domain/roster";
import { ROSTER_SHAPES } from "@research-ts/domain/roster-shape";
import { totalRosterSlots } from "@research-ts/draft-engine/order";
import { voiceRuleHits } from "@research-ts/capsules/voice-rules";
import type { BoardFile, GateRecord, HeldOutScore, PlayerFile } from "./artifacts";
import { NIGHTLY_CONFIG } from "./config";

/**
 * THE VALIDATION GATES (spec §4). A run that fails any of them is written and kept for diagnosis,
 * but `runs/latest.json` keeps pointing at the last clean run, so the site never builds from it.
 * Every failure is a named reason (`gate_reason:where:detail`), one per finding, so a manifest can
 * be grepped and two runs diffed.
 */

function gate(name: string, reasons: readonly string[], passedSummary: string): GateRecord {
  return { gate: name, passed: reasons.length === 0, reasons, summary: reasons.length === 0 ? passedSummary : `${reasons.length} failure${reasons.length === 1 ? "" : "s"}` };
}

/** 1. The held-out backtest does not regress against the last clean run. The first run has nothing
 *  to compare with and records the baseline. A season that cannot be scored at all is a failure. */
export function heldOutGate(current: readonly HeldOutScore[], previous: readonly HeldOutScore[] | null): GateRecord {
  const reasons: string[] = [];
  for (const score of current) {
    if (score.rankCorrelation === null || score.sampleSize === 0) {
      reasons.push(`held_out_unscored:${score.season}`);
      continue;
    }
    const before = previous?.find((prior) => prior.season === score.season)?.rankCorrelation ?? null;
    if (before !== null && before - score.rankCorrelation > NIGHTLY_CONFIG.gates.maxHeldOutRankCorrelationDrop) {
      reasons.push(`held_out_regressed:${score.season}:${before.toFixed(4)}->${score.rankCorrelation.toFixed(4)}`);
    }
  }
  const baseline = previous === null ? ", first run, recorded as the baseline" : "";
  return gate("held_out_backtest", reasons, `${current.map((s) => `${s.season} rho ${s.rankCorrelation?.toFixed(4)} n=${s.sampleSize}`).join(", ")}${baseline}`);
}

/** The starting slots whose eligible positions all fall inside `eligible`: the demand a pool of
 *  those positions has to cover by itself. */
function demandWithin(eligible: readonly string[], slots: readonly RosterSlotConfig[]): number {
  return slots
    .filter((slot) => slot.slot !== BENCH_SLOT && slot.eligiblePositions.every((position) => eligible.includes(position)))
    .reduce((sum, slot) => sum + slot.count, 0);
}

/** One board's depth findings: every starting slot's eligible pool must cover every league slot it
 *  alone can fill, across the whole league, and the board as a whole must fill every roster spot. */
function depthFindings(board: BoardFile): readonly string[] {
  const slots = ROSTER_SHAPES[board.shape];
  const countIn = (eligible: readonly string[]): number => board.rows.filter((row) => eligible.includes(row.position)).length;
  const findings = slots
    .filter((slot) => slot.slot !== BENCH_SLOT)
    .flatMap((slot) => {
      const need = board.teamCount * demandWithin(slot.eligiblePositions, slots) * NIGHTLY_CONFIG.gates.depthPlayersPerRosterSpot;
      const have = countIn(slot.eligiblePositions);
      return have < need ? [`board_depth_short:${board.key}:${slot.slot}:${have}/${need}`] : [];
    });
  const rosterNeed = board.teamCount * totalRosterSlots(slots) * NIGHTLY_CONFIG.gates.depthPlayersPerRosterSpot;
  return board.rows.length < rosterNeed ? [...findings, `board_depth_short:${board.key}:roster:${board.rows.length}/${rosterNeed}`] : findings;
}

/** 2. Every board has every roster slot filled to the depth its league size needs. */
export function boardDepthGate(boards: readonly BoardFile[]): GateRecord {
  return gate("board_depth", boards.flatMap(depthFindings), `${boards.length} boards, every slot covered`);
}

/** 3. Every player page has a capsule, every pull figure is in its prose word for word, and no
 *  capsule ships a set phrase or a writer's aside (`capsules/voice-rules.ts`). */
export function capsuleGate(players: readonly PlayerFile[]): GateRecord {
  const reasons = players.flatMap((player) => {
    if (player.capsule === null) return [`capsule_missing:${player.id}`];
    const { bodyFull, bodyCompact, pullFigures } = player.capsule;
    const figures = pullFigures.filter((figure) => !bodyFull.includes(figure.text)).map((figure) => `pull_figure_not_in_prose:${player.id}:${figure.text}`);
    const voice = [...voiceRuleHits(bodyFull), ...voiceRuleHits(bodyCompact)].map((hit) => `capsule_voice_rule:${player.id}:${hit.found}`);
    return [...figures, ...new Set(voice)];
  });
  const written = players.filter((player) => player.capsule?.source === "llm").length;
  return gate("capsules", reasons, `${players.length} pages with a capsule, ${written} written, ${players.length - written} on the template floor`);
}

/** 4. Every number carries its basis in the same object: the board's two basis sentences, each
 *  format line's basis, each ADP reading's source. */
export function basisGate(boards: readonly BoardFile[], players: readonly PlayerFile[]): GateRecord {
  const blank = (text: string): boolean => text.trim().length === 0;
  const reasons = [
    ...boards.flatMap((board) => [
      ...(blank(board.pointsBasis) ? [`basis_missing:board:${board.key}:points`] : []),
      ...(blank(board.valueBasis) ? [`basis_missing:board:${board.key}:value`] : []),
    ]),
    ...players.flatMap((player) => [
      ...player.formats.filter((line) => blank(line.basis)).map((line) => `basis_missing:player:${player.id}:${line.format}`),
      ...player.adp.filter((line) => blank(line.source)).map((line) => `basis_missing:player:${player.id}:adp-${line.format}`),
    ]),
  ];
  return gate("basis", reasons, "every number names its basis");
}
