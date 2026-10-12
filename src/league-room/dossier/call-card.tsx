import { Card, NOT_STARTED_DASH, PositionBadge } from "@/components/ui";
import type { Position } from "@research-ts/domain/player";
import { ordinal } from "../lib/format";

/** The market's own two readings — never our own board's, which is `CallCardOurBoard` below.
 *  Both `null` on the identical "this product cannot reach it" rule every dash on this product
 *  keeps: an unlisted ADP, or a consensus the crosswalk or the publisher never gave him. */
export interface CallCardMarket {
  readonly adp: number | null;
  readonly expertRank: number | null;
}

/** Our own board's own reading — the season-total half (`position`/`positionRank`/`boardRank`/
 *  `points`) and the per-game half (`perGameRank`/`expectedGames`) the talent-vs-games sentence
 *  needs. `positionRank` is realistically always present for a board-ranked player (the board's
 *  own `scarcity` reason fires for every row — `board.ts`'s own construction), but stays nullable
 *  here rather than asserted, matching `PlayerFactsMarket.positionRank`'s own honest type. */
export interface CallCardOurBoard {
  readonly position: Position;
  readonly positionRank: number | null;
  readonly boardRank: number;
  readonly points: number;
  /** The board's own scoring format (`dossier.basis.scoringLabel`, "PPR") — the both-bases Global
   *  Constraint's own law, applied to the one number on this card that used to carry none:
   *  `points` is our board's season projection, and a bare "225 pts" never named which rules
   *  produced it. Stated in the SAME word `SeasonStrip`'s own per-game fact already uses for the
   *  identical board, never a new label invented for this card alone. */
  readonly scoringLabel: string;
  readonly perGameRank: number | null;
  readonly expectedGames: number | null;
}

export interface CallCardProps {
  /** The Outlook's own opening line (`verdictLine`, `../outlook/verdict.ts`) — composed by the
   *  caller, never here: this component states it, it does not derive it. `null` exactly when
   *  `verdictLine` itself returns `null` (the board never ranked him), which this task's own
   *  contract keeps unreachable in practice (a `CallCard` is only ever composed for a player the
   *  dossier facts exist for), but handled honestly rather than assumed away. */
  readonly verdict: string | null;
  readonly market: CallCardMarket;
  readonly ourBoard: CallCardOurBoard;
  /** The evidence's own season-point gap off the market's price (`PlayerFactsMarket
   *  .marketAnchorDelta`) — the ONE number on this card that carries the verdict channel's
   *  color, by its own sign. `null` when the board never anchored him to a market entry at all. */
  readonly gap: number | null;
  /**
   * THE WRITTEN PER-GAME SENTENCE (`narrativeSlot(capsule, "perGame")`, dossier-voice round §3.5)
   * — the writer's own line about what his games mean, when the sweep produced and validated one.
   * `null`/absent renders the deterministic `talentVsGamesSentence` below instead. Never both: a
   * module states one sentence about one thing, and the template is the floor under the writer,
   * not a second voice beside him.
   */
  readonly perGameSentence?: string | null;
}

/**
 * Verdict-channel tone by `gap`'s own sign: `text-positive` (Live green, the good outcome) above
 * zero, and ORDINARY INK everywhere else.
 *
 * ROSE IS THE RIVAL'S CHANNEL AND THIS IS NOT A RIVAL (Sideline, fix round 1's own H2). The negative
 * branch used to return `text-negative`, which in this palette is Rival rose: your opponent, the
 * swing against you, a clock running out (`TOKENS.color.*.negative`). A player our board rates lower
 * than the drafting room does is none of those. He is a player we would not reach for, and painting
 * that in the colour the product reserves for the opponent made a reader read "bad player" — the
 * identical finding `vsMarketLabel` already rules neutral on the board ("drafters reach N picks
 * early", `tone: "neutral"`, never red, because red implies a bad player and this number never meant
 * that). Nothing is lost by dropping it: `gapSentence` prints the sign itself, which is also what
 * keeps the fact alive for a screen reader and in monochrome.
 *
 * A `null`/zero gap was already ink and stays ink: a tint is a claim about which side of a real
 * number this falls on, and there is no honest side to claim for either.
 */
function toneClassFor(roundedGap: number | null): string {
  return roundedGap !== null && roundedGap > 0 ? "text-positive" : "text-text-muted";
}

/** "+20 points vs his ADP" / "-20 points vs his ADP" / "0 points vs his ADP" / the honest
 *  absence — the sign is printed, never implied by color alone (the same rule `EdgeCell` keeps),
 *  so the fact survives a screen reader or a monochrome print. "His ADP", never "his price":
 *  fantasy words, not trading words (founder, 2026-09-07). */
function gapSentence(roundedGap: number | null): string {
  if (roundedGap === null) return "No ADP to compare against.";
  const sign = roundedGap > 0 ? "+" : "";
  return `${sign}${roundedGap} points vs his ADP`;
}

/**
 * THE TALENT-VS-GAMES SENTENCE (availability pre-registration UX rider) — ships regardless of any
 * model gate, but honestly: rendered ONLY when BOTH the per-game position rank AND the expected
 * games exist. Either one missing (a player the board never ranked per-game, or one the
 * availability model has no read on) means there is no honest sentence to state, so this returns
 * `null` rather than a half sentence.
 */
function talentVsGamesSentence(position: Position, perGameRank: number | null, expectedGames: number | null): string | null {
  if (perGameRank === null || expectedGames === null) return null;
  return `Per game he projects like a ${position}${perGameRank}. The question is games: our model expects ${Math.round(expectedGames)}.`;
}

/**
 * THE CALL CARD (dossier plan, Task 3) — the dossier's opening statement: a verdict sentence, the
 * three price columns the mock states side by side (the market's own read, our board's own read,
 * the gap between them), and the talent-vs-games sentence when the two facts it needs both exist.
 *
 * EVERY NUMBER NAMES ITS BASIS (global constraint) — "pick" and "experts" name the drafters' own
 * two readings; "overall"/"pts" name our board's; "vs his ADP" names what the gap is measured
 * against. Nothing on this card is a bare number.
 *
 * COLOR DISCIPLINE: the verdict channel (`toneClassFor`) is the ONLY chroma on this card, applied
 * to the verdict sentence and the gap column alike because they state the identical fact twice
 * (prose, then number) — never to the market or our-board columns, which are quiet ink regardless
 * of value, exactly as `EdgeCell`'s own docblock keeps for a leaderboard's non-comparison cells.
 */
export function CallCard({ verdict, market, ourBoard, gap, perGameSentence = null }: CallCardProps) {
  const roundedGap = gap === null ? null : Math.round(gap);
  const tone = toneClassFor(roundedGap);
  const talentSentence = perGameSentence ?? talentVsGamesSentence(ourBoard.position, ourBoard.perGameRank, ourBoard.expectedGames);

  return (
    <Card as="section" aria-label="The call" className="flex flex-col gap-3">
      {verdict === null ? null : (
        <p className={`text-base font-semibold ${tone}`} data-call="verdict">
          {verdict}
        </p>
      )}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm tabular-nums text-text-muted">
        <span data-call="adp">
          pick {market.adp === null ? NOT_STARTED_DASH : market.adp.toFixed(1)} · experts{" "}
          {market.expertRank === null ? NOT_STARTED_DASH : ordinal(market.expertRank)}
        </span>
        <span data-call="our-board" className="flex items-center gap-1.5">
          <PositionBadge position={ourBoard.position} rank={ourBoard.positionRank ?? undefined} size="sm" />
          <span>
            · {ordinal(ourBoard.boardRank)} overall · {Math.round(ourBoard.points)} {ourBoard.scoringLabel} pts
          </span>
        </span>
        <span data-call="gap" className={tone}>
          {gapSentence(roundedGap)}
        </span>
      </div>
      {talentSentence === null ? null : (
        <p className="text-sm text-text-muted" data-call="talent-vs-games">
          {talentSentence}
        </p>
      )}
    </Card>
  );
}
