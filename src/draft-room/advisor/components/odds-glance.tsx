"use client";

import { survivalBand } from "@/domain/draft-odds";
import { Badge } from "@/components/ui";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { MOTION } from "@/design/motion";
import { useChangeKey } from "@/design/use-change-key";
import { oddsTooltipText, percentText, runsOverRuns } from "../format";

/** `percent` is a pool row's glance ("46%"), `runs` is the advisor's own row ("57 of 200"),
 *  `count` is a sheet row's stacked figure: the survived count large, "of 100" small under it. */
export type OddsGlanceForm = "percent" | "runs" | "count";

export interface OddsFigureProps {
  /** Runs in which the player was still there at the viewer's next turn. */
  readonly survived: number;
  readonly runs: number;
  /** @default "percent" */
  readonly form?: OddsGlanceForm;
}

export interface OddsGlanceProps {
  readonly odds: SurvivalOdds;
  readonly playerId: string;
  /** @default "percent" */
  readonly form?: OddsGlanceForm;
}

const TEST_ID: Readonly<Record<OddsGlanceForm, string>> = { percent: "advisor-odds-pct", runs: "advisor-odds-runs", count: "advisor-odds-count" };

/** The three bands as ink, for the stacked form (the chip forms wear the positive chip on safe). */
const BAND_INK: Readonly<Record<ReturnType<typeof survivalBand>, string>> = {
  safe: "text-positive",
  middle: "text-text-muted",
  reach: "text-negative",
};

/**
 * The figure itself, from two numbers — the memoizable half (fluidity round, 2026-09-10): a
 * list row hands this its own two primitives, so a recompute that left this player's odds where
 * they were re-renders nothing here, and one that moved them cross-fades the new figure in
 * (`MOTION.swap`, keyed on `useChangeKey` so the CSS animation replays only on a change and
 * never on mount). Three bands (coordinator's ruling, fix round): the safe band is a soft
 * positive chip so good reads as good in both themes, the middle band is the product's secondary
 * ink (never the warning or live roles, which are the clock's alarm channel), and a reach keeps
 * the critical ink.
 */
export function OddsFigure({ survived, runs, form = "percent" }: OddsFigureProps) {
  const survival = survived / runs;
  const band = survivalBand(survival);
  const tooltip = oddsTooltipText(survived, runs);
  const text = form === "percent" ? percentText(survival) : form === "count" ? String(survived) : runsOverRuns(survived, runs);
  const changeKey = useChangeKey(text);
  const shared = { "data-testid": TEST_ID[form], "data-band": band, title: tooltip } as const;
  const label = (
    <>
      <span key={changeKey} aria-hidden="true" className={changeKey === 0 ? undefined : MOTION.swap.className}>
        {text}
      </span>
      <span className="sr-only">{tooltip}</span>
    </>
  );
  if (form === "count") {
    return (
      <span {...shared} className={`flex shrink-0 flex-col items-end leading-none ${BAND_INK[band]}`}>
        <span className="font-display text-md font-extrabold tabular-nums">{label}</span>
        <span aria-hidden="true" className="text-[9px] text-text-faint">
          of {runs}
        </span>
      </span>
    );
  }
  if (band === "safe") {
    return (
      <Badge tone="positive" soft {...shared} className="font-mono tabular-nums">
        {label}
      </Badge>
    );
  }
  const width = form === "percent" ? "w-10" : "w-20";
  return (
    <span {...shared} className={`${width} shrink-0 text-right font-mono text-xs tabular-nums ${band === "reach" ? "text-negative" : "text-text-muted"}`}>
      {label}
    </span>
  );
}

/**
 * A player's next-turn odds at a glance, looked up from the whole odds table. Renders nothing
 * for a player the odds do not cover (already gone), and the caller renders nothing at all when
 * the viewer has no next turn. Rows that re-render per pick take `OddsFigure` with their own two
 * numbers instead, so an unchanged figure costs no render.
 */
export function OddsGlance({ odds, playerId, form = "percent" }: OddsGlanceProps) {
  const survived = odds.survived[playerId];
  if (survived === undefined || odds.runs === 0) return null;
  return <OddsFigure survived={survived} runs={odds.runs} form={form} />;
}
