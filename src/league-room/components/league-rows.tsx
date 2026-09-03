"use client";

import Link from "next/link";
import { ButtonLink, Crest } from "@/components/ui";
import { monogramsFor } from "@/components/ui/monogram";
import { UI_CONFIG } from "@/components/ui/config";
import { RailDot, RailWords } from "@/components/app-shell/rail-row";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { orderByUrgency, railPageLine, railStateFor, type RailLeagueState } from "../lib/rail-line";
import type { HomeLeagueCard } from "../contract";
import { actionHref } from "../lib/action-href";
import { formatRecord, ordinal } from "../lib/format";

/** "8-6 · 4th of 12" beside a LIVE row's name (its line is the margin), "8-6" alone beside a
 *  needs-you row (its line already carries the standing, `railPageLine`'s own ladder), nothing
 *  beside a quiet row (same reason) — the old board's record and standing columns folded into
 *  the name line (law 4), with no figure ever printed twice on one row. */
function nameDetailFor(league: HomeLeagueCard, state: RailLeagueState): string | undefined {
  if (state === "quiet" || league.record === null) return undefined;
  const record = formatRecord(league.record);
  if (state !== "live" || league.myRank === null) return record;
  return `${record} · ${ordinal(league.myRank)} of ${league.filledTeams}`;
}

/**
 * The row's one verb (laws 3 and 5, under the amber budget):
 * - THE single most-urgent league on the page — the first needs-you row — gets the page's one
 *   SOLID amber verb (`variant="verb"`). Every further needs-you row keeps the same real label
 *   in the quiet outline: the order already said which one is first.
 * - A live row gets WATCH-the-scores in the red channel's outline (`variant="live"`, the
 *   blueprint's WATCH LIVE) — the label stays `NEXT_ACTION_COPY`'s own words (C2: one string
 *   owns the copy).
 * - A quiet row gets a plain Open affordance — nothing on it is asking for more weight.
 */
function RowVerb({ league, state, topUrgent }: { readonly league: HomeLeagueCard; readonly state: RailLeagueState; readonly topUrgent: boolean }) {
  if (state === "needs-you") {
    return (
      <ButtonLink
        href={actionHref(league)}
        variant={topUrgent ? "verb" : "secondary"}
        size="sm"
        aria-label={`${league.nextAction!.label} for ${league.name}`}
      >
        {league.nextAction!.label}
      </ButtonLink>
    );
  }
  if (state === "live" && league.nextAction !== null) {
    return (
      <ButtonLink href={actionHref(league)} variant="live" size="sm" aria-label={`${league.nextAction.label} for ${league.name}`}>
        {league.nextAction.label}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={`/app/leagues/${league.id}`} variant="ghost" size="sm" aria-label={`Open ${league.name}`}>
      Open
    </ButtonLink>
  );
}

export interface LeagueRowsProps {
  /** The home read's leagues in their OWN order (`createdAt` asc) — monogram assignment runs
   *  over this order (law 1's stability rule) before the urgency sort reorders the rows. */
  readonly leagues: readonly HomeLeagueCard[];
}

/**
 * THE RAIL AT FULL PAGE (law 3's third size — the rail redesign, 2026-09-03; the blueprint's
 * third panel): the same row model the flyout renders (`RailWords` + `Crest` chip + typed dot),
 * with per-row verbs and the record folded into the name line. Ordered by the same
 * `orderByUrgency` the shell read uses, divider between urgent and quiet, state lines from
 * `railPageLine` — the rich tier, because this page's own server read carries the score cache,
 * so live rows speak real margins here.
 *
 * This page replaced the old board (`AttentionQueue` + `LeagueBoard` + `BoardLowerThird`) —
 * what each column became is accounted line by line in the spec
 * (`docs/superpowers/specs/2026-09-03-league-rail-design.md`, law 4). The rail itself never
 * renders beside this page (`railHiddenOn`); the open-lobby teaser (`OpenSeatsPanel`) and the
 * create affordance are `HomeBoard`'s to keep, exactly where they already were.
 */
export function LeagueRows({ leagues }: LeagueRowsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const crestSize = UI_CONFIG.shell.crestSizePx;
  const monogramById = new Map(monogramsFor(leagues.map((league) => league.name)).map((mark, index) => [leagues[index]!.id, mark]));
  const ordered = orderByUrgency(leagues);
  const states = ordered.map((league) => railStateFor(league.nextAction?.kind, league.weekStatus));
  const firstQuietIndex = states.indexOf("quiet");
  const topUrgentIndex = states.indexOf("needs-you");

  return (
    <ul aria-label="Your leagues" data-testid="league-rows-page" className="flex flex-col">
      {ordered.map((league, index) => {
        const state = states[index]!;
        return (
          <li
            key={league.id}
            className={`flex items-center gap-3 border-t border-line py-2.5 first:border-t-0 ${
              index === firstQuietIndex && index > 0 ? "mt-3 border-t-2" : ""
            }`}
          >
            <Link
              href={`/app/leagues/${league.id}`}
              // The same accessible-name rule as the flyout: the league's REAL name plus its one
              // state line — the visible words are `aria-hidden`, so this is the one announcement.
              aria-label={`${league.name}. ${railPageLine(league)}.`}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="relative shrink-0" style={{ width: crestSize, height: crestSize }}>
                <Crest id={league.id} name={league.name} mark={monogramById.get(league.id)} size={crestSize} />
                <RailDot state={state} reducedMotion={reducedMotion} />
              </span>
              <RailWords
                name={league.name}
                stateLine={railPageLine(league)}
                state={state}
                nameDetail={nameDetailFor(league, state)}
                className="flex"
              />
            </Link>
            <RowVerb league={league} state={state} topUrgent={index === topUrgentIndex} />
          </li>
        );
      })}
    </ul>
  );
}
