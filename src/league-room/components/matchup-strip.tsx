import type { ReactNode } from "react";
import type { MatchupDetail, MatchupSide } from "../contract";
import { Crest, NOT_STARTED_DASH } from "@/components/ui";
import { LiveMarker } from "@/components/ui/live-marker";
import { Icon } from "@/components/ui/icon";
import { formatPoints } from "../lib/format";
import { yetToPlayCount } from "../lib/matchup-facts";

/** The score, or the product's one glyph for "there is no number yet". */
function scoreText(score: number | null): string {
  return score === null ? NOT_STARTED_DASH : formatPoints(score);
}

/**
 * One side of a strip row: crest, name, score. Mirrored on the away side so the two scores meet in
 * the middle and a reader's eye runs down one column of figures rather than hunting across a row.
 *
 * The score is `text-xl` and the name is `text-sm`, which is law 2's ordering at a register that
 * fits twelve of these on a screen. The hero above spends 84px on the game a manager came for;
 * these are the ones they are keeping an eye on, and the same 84px twelve times over would be law
 * 2 shouted rather than spoken.
 */
function StripSide({ side, leading, align }: { readonly side: MatchupSide; readonly leading: boolean; readonly align: "left" | "right" }) {
  // The mirror is a DESKTOP treatment only. Below `sm` the row stacks (see the root), so both
  // sides read left-to-right there and the away side's reversal would put its score on the wrong
  // edge of its own line — the two sides no longer face each other once they are on top of each
  // other. Literal class strings, never built from a variable: Tailwind's scanner reads source
  // text and a template-built `sm:flex-row-${x}` ships no rule at all.
  const order = align === "right" ? "sm:flex-row-reverse sm:text-right" : "text-left";
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-2 ${order}`}>
      <Crest id={side.teamId} name={side.teamName} size={24} />
      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{side.teamName}</span>
      <span className={`shrink-0 font-mono text-xl tabular-nums ${leading ? "text-text-primary" : "text-text-muted"}`}>{scoreText(side.score)}</span>
    </span>
  );
}

/**
 * THE REST OF THE LEAGUE, IN THE HEIGHT ONE OLD MATCHUP CARD TOOK.
 *
 * Law 4, density is respect: *"a manager on Sunday wants more true facts per screen, not fewer."*
 * This page used to be six identical panels of the same weight, so a manager's own game was the
 * fifth thing on a four-thousand-pixel scroll and every other matchup cost seven hundred pixels to
 * say two numbers. Now the manager's own matchup is the hero and the other five are one row each.
 *
 * NOTHING IS LOST, WHICH IS WHY THIS IS A `<details>` AND NOT A LINK. Collapsing a matchup to two
 * scores would delete the lineups that were on the page before, and a redesign that removes facts
 * is not the density law 4 asks for — it is the same page with less on it. The row is a
 * `<summary>`, the lineups are the disclosure, and the browser's own widget does the work: no
 * JavaScript, no state, no animation, and a real keyboard control with a real expanded state that
 * assistive tech already understands. Law 6 permits it under its fifth clause, *"a control
 * responding to being pressed"* — nothing here moves on mount, on scroll or on hover.
 *
 * The yet-to-play chip rides the closed row deliberately. It is the one fact that decides whether
 * a manager cares about somebody else's game at all — a five point lead with three still to play
 * is a different afternoon from the same lead with none — and burying it inside the disclosure
 * would make you open every row to find the one that matters.
 */
export function MatchupStrip({ matchups, children }: {
  readonly matchups: readonly MatchupDetail[];
  /** Each matchup's own lineups, rendered by the caller — this component owns the row, never the
   *  contents of the disclosure, so it never learns what a starters table is. Keyed the same way
   *  the rows are, so the two lists cannot drift apart. */
  readonly children: (matchup: MatchupDetail) => ReactNode;
}) {
  if (matchups.length === 0) return null;
  return (
    <ul className="flex flex-col rounded-lg border border-line bg-surface-elevated">
      {matchups.map((matchup) => {
        const { home, away } = matchup;
        const decided = home.score !== null && away.score !== null;
        const left = yetToPlayCount(home) + yetToPlayCount(away);
        return (
          <li key={`${home.teamId}:${away.teamId}`} className="border-b border-line last:border-b-0">
            <details className="group">
              {/* `list-none` plus an explicit chevron, rather than the browser's own marker: the
                  marker is a bullet-position glyph that a flex `<summary>` renders inconsistently
                  and that carries no rotation on some engines, so a reader could not tell these
                  rows opened. The chevron is `aria-hidden` — `<details>` already exposes its own
                  expanded state, and a second announcement of it would be noise. It rotates on
                  `open`, which is law 6's fifth permission (a control responding to being
                  pressed) and not an ambient one: nothing here moves until somebody presses it. */}
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevron-right"
                  size={14}
                  className="shrink-0 text-text-faint group-open:rotate-90"
                />
                {/* STACKS BELOW `sm`, and that is a defect fix rather than a preference: at the
                    360px floor the two names, two crests and two scores on one line squeezed both
                    truncating names to zero characters, so a phone read five rows of anonymous
                    numbers. Law 2's own answer applies here exactly as it does to the hero — the
                    layout moves, the figures do not shrink. The `vs` goes with the single line it
                    belongs to; stacked, the two rows are already obviously a pair. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <StripSide side={home} align="left" leading={decided && (home.score ?? 0) >= (away.score ?? 0)} />
                  <span className="hidden shrink-0 font-mono text-xs text-text-faint sm:inline">vs</span>
                  <StripSide side={away} align="right" leading={decided && (away.score ?? 0) >= (home.score ?? 0)} />
                </span>
                {left === 0 ? null : <LiveMarker mono>{`${left} to play`}</LiveMarker>}
              </summary>
              <div className="border-t border-line px-3 pb-3 pt-2">{children(matchup)}</div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
