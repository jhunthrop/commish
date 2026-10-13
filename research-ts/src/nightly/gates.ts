import { BENCH_SLOT, type RosterSlotConfig } from "@research-ts/domain/roster";
import { ROSTER_SHAPES } from "@research-ts/domain/roster-shape";
import { totalRosterSlots } from "@research-ts/draft-engine/order";
import { voiceRuleHits } from "@research-ts/capsules/voice-rules";
import type { BoardFile, GateRecord, HeldOutScore, PlayerFile } from "./artifacts";
import { figureMatchesValue } from "./build/pull-figures";
import { NIGHTLY_CONFIG } from "./config";

/**
 * THE VALIDATION GATES (spec §4). A run that fails any of them is written and kept for diagnosis,
 * but `runs/latest.json` keeps pointing at the last clean run, so the site never builds from it.
 * Every failure is a named reason (`gate_reason:where:detail`), one per finding, so a manifest can
 * be grepped and two runs diffed.
 */

/** `capsule_missing: 3, capsule_voice_rule: 17`: a failing gate's reasons counted by their name. */
function reasonCounts(reasons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const name = reason.split(":")[0]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => `${name}: ${count}`).join(", ");
}

function gate(name: string, reasons: readonly string[], context: string): GateRecord {
  const summary = reasons.length === 0 ? context : `${reasons.length} failure${reasons.length === 1 ? "" : "s"} (${reasonCounts(reasons)}); ${context}`;
  return { gate: name, passed: reasons.length === 0, reasons, summary };
}

/** 1. The held-out backtest does not regress against its baseline (the newest run whose backtest
 *  passed, `publish.ts`). The first run has nothing to compare with and records the baseline. A season that cannot be scored at all is a failure. */
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

/** A page the writer covers: one with a projection. A page without one (kickers and defenses in
 *  market order, the kdef decision, and a man the board does not project) has nothing for the
 *  writer to ground, so the sweep never writes it a capsule and none is required. */
function writerCovers(player: PlayerFile): boolean {
  return player.formats.some((line) => line.projectedPoints !== null);
}

/** One page's capsule findings. */
function capsuleFindings(player: PlayerFile): readonly string[] {
  if (player.capsule === null) return writerCovers(player) ? [`capsule_missing:${player.id}`] : [];
  const { bodyFull, bodyCompact, pullFigures } = player.capsule;
  const none = writerCovers(player) && pullFigures.length === 0 ? [`pull_figures_none:${player.id}`] : [];
  const absent = pullFigures.filter((figure) => !bodyFull.includes(figure.text)).map((figure) => `pull_figure_not_in_prose:${player.id}:${figure.text}`);
  const offPage = pullFigures.filter((figure) => !figureMatchesValue(figure)).map((figure) => `pull_figure_off_page:${player.id}:${figure.label}:${figure.text}`);
  const voice = [...new Set([...voiceRuleHits(bodyFull), ...voiceRuleHits(bodyCompact)].map((hit) => hit.found))].map((found) => `capsule_voice_rule:${player.id}:${found}`);
  return [...none, ...absent, ...offPage, ...voice];
}

/**
 * 3. Every page the writer covers has a capsule; the capsule prints at least one of the numbers its
 * page shows (its pull figures, drawn from the page's board row, `build/pull-figures.ts`), each
 * word for word and equal to the page's value at the precision printed; and no capsule ships a set
 * phrase or a writer's aside (`capsules/voice-rules.ts`). A capsule that quotes none of its page's
 * numbers is not grounded in the board the page shows.
 */
export function capsuleGate(players: readonly PlayerFile[]): GateRecord {
  const reasons = players.flatMap(capsuleFindings);
  const covered = players.filter(writerCovers);
  const written = covered.filter((player) => player.capsule?.source === "llm").length;
  const unprojected = players.length - covered.length;
  return gate(
    "capsules",
    reasons,
    `${covered.length} pages the writer covers, ${written} written, ${covered.length - written} on the template floor; ${unprojected} pages without a projection, no capsule required`,
  );
}

/** 5. Every format the board ships has tonight's ADP, read from a capture with its source named. */
export function adpGate(formats: readonly { readonly format: string; readonly capturedAt: string | null; readonly players: readonly unknown[] }[]): GateRecord {
  const reasons = formats.flatMap((entry) => (entry.capturedAt === null || entry.players.length === 0 ? [`adp_missing:${entry.format}`] : []));
  return gate("adp", reasons, formats.map((entry) => `${entry.format} ${entry.players.length} players at ${entry.capturedAt}`).join(", "));
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
