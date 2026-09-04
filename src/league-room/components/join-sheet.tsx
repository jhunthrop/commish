"use client";

import type { ReactNode } from "react";
import type { LeagueTerms } from "@/league";
import { Badge, BottomSheet, SeatMeter } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { SEAT_HOLD } from "@/matchmaking/seat-hold";
import { SIT_AND_GO_GRACE_MINUTES } from "@/matchmaking/config";
import { rollNoticeSentence } from "@/matchmaking/roll";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { moneyIsLive } from "@/money/states";
import { LocalDraftTime } from "./local-draft-time";
import { entryFeeLabel, FormatLine, moneySentence, OpenLeagueCta, potFacts } from "./open-league-shared";
import { PracticeEntryLink } from "./practice-entry-link";

/**
 * THE JOIN SHEET (front door blueprint, 2026-09-02): the whole contract on one surface, read in
 * twenty seconds. `JoinSheetBody` is the presentational core — the fact cards and the
 * what-happens-when-you-sit lines — fed by a normalized `JoinDecisionFacts`, so the lobby door
 * (built from `PublicLeagueSummary` here) and the invite door (`InviteLanding`, built from
 * `LeagueTerms`) render the SAME body and can never phrase the decision two different ways. Each
 * door keeps its OWN action: the lobby's verb rides the existing holds machinery; the invite
 * path takes no seat hold at all (F15, controller-ruled), so its lines never claim one.
 *
 * HONESTY RULES CARRIED:
 * - Money facts render only under `moneyIsLive()` (injectable `live`, the `FrontDoorHero`
 *   idiom); the free season shows the FREE badge and the derived free-season sentence instead —
 *   no fabricated dollar figures, ever.
 * - The pot is `potFacts` — the STORED payout table's own sum, never fee × seats recomputed.
 * - The hold line states the REAL duration (`SEAT_HOLD.minutes`), only on the door that
 *   actually holds (the lobby's signed-out path), and claims nothing about payment the hold
 *   flow does not do today.
 * - The sit-and-go line derives from `SIT_AND_GO_GRACE_MINUTES`; the mock's "90 min" draft
 *   duration is DROPPED — no draft-duration fact is stored anywhere in this product.
 * - Draft times upgrade to the viewer's own timezone post-hydration (`LocalDraftTime`); the
 *   server sentence stays the SSR truth.
 */
export interface JoinFactCell {
  readonly label: string;
  readonly value: ReactNode;
  readonly note?: string;
  /** The one cell allowed to wear the accent frame — the mock gives it to SEATS when the room
   *  is down to the last seat. */
  readonly accent?: boolean;
}

export interface JoinDecisionFacts {
  /** The fact cards, in reading order — money cards simply absent while money is dark. */
  readonly cells: readonly JoinFactCell[];
  /** The three-line contract of what happens when you sit. */
  readonly contract: readonly string[];
}

/** Seats open the way every seat sentence counts them: a seat being claimed is counted. */
function seatsOpen(league: PublicLeagueSummary): number {
  return Math.max(0, league.teamCount - league.filledTeams - league.heldSeats);
}

/** The lobby door's own facts, from the public summary and nothing else. */
export function lobbyJoinFacts(league: PublicLeagueSummary, signedIn: boolean, live: boolean): JoinDecisionFacts {
  const open = seatsOpen(league);
  const pot = live ? potFacts(league) : null;
  const cells: JoinFactCell[] = [];
  if (live) {
    cells.push({ label: "Buy-in", value: entryFeeLabel(league), note: league.entryFeeCents > 0 ? "one payment, before the draft" : "no entry fee" });
    cells.push(
      pot === null
        ? { label: "The pot", value: "Bragging rights", note: "free league" }
        : { label: "The pot", value: pot.potUsd, note: pot.splitLabel },
    );
  }
  cells.push(
    league.startTrigger === "when_full"
      ? { label: "The draft", value: "When the room fills", note: `about ${SIT_AND_GO_GRACE_MINUTES} minutes after the last seat` }
      : {
          label: "The draft",
          value: <LocalDraftTime iso={league.draftAtIso} fallback={league.draftAt} />,
          note: league.kickoffRolls > 0 ? rollNoticeSentence(league.kickoffRolls) : undefined,
        },
  );
  cells.push({
    label: "Seats",
    value: `${open} of ${league.teamCount}`,
    note: open === 1 ? "yours would be the last" : league.heldSeats > 0 ? `${league.heldSeats} being claimed right now` : "open right now",
    accent: open === 1,
  });

  const startClause =
    league.startTrigger === "when_full"
      ? `The draft starts on its own about ${SIT_AND_GO_GRACE_MINUTES} minutes after the last seat fills.`
      : "The draft starts at the listed time, and it rolls a day at a time until the room is full.";
  return {
    cells,
    contract: [
      signedIn
        ? "Press the button and the seat is yours on the spot."
        : `Your seat is held for ${SEAT_HOLD.minutes} minutes while you sign in.`,
      `${startClause} Miss the start and the room picks for you: your queue first, then the best player your roster needs.`,
      `The season runs itself: lineups, waivers, scoring and standings, week 1 through the playoffs.${
        live && pot !== null ? " The pot pays the podium when the season settles." : ""
      }`,
    ],
  };
}

/**
 * The INVITE door's own facts, from `LeagueTerms` and nothing else — the same body, that door's
 * truths: the invite path takes NO seat hold (F15, controller-ruled), so its lines never claim
 * one, and its money cells read the terms' own server-derived figures (`prizePotUsd` is the
 * stored table's sum, the identical one-source rule the lobby's `potFacts` holds).
 */
export function inviteJoinFacts(terms: LeagueTerms, signedIn: boolean): JoinDecisionFacts {
  const open = Math.max(0, terms.teamCount - terms.filledTeams);
  const paid = terms.entryFeeUsd !== undefined;
  const cells: JoinFactCell[] = [];
  if (paid) {
    cells.push({ label: "Buy-in", value: terms.entryFeeUsd, note: "one payment, before the draft" });
    cells.push({
      label: "The pot",
      value: terms.prizePotUsd ?? "Published in the league",
      note: terms.prizeTable === undefined ? undefined : `pays ${terms.prizeTable.map((entry) => entry.amountUsd).join(" / ")}`,
    });
  }
  cells.push({
    label: "The draft",
    value: <LocalDraftTime iso={terms.draftAtIso} fallback={terms.draftAt} />,
  });
  cells.push({
    label: "Seats",
    value: `${open} of ${terms.teamCount}`,
    note: open === 1 ? "yours would be the last" : "open right now",
    accent: open === 1,
  });

  const startClause =
    terms.draftAtIso === undefined
      ? `The draft starts on its own about ${SIT_AND_GO_GRACE_MINUTES} minutes after the last seat fills.`
      : "The draft starts at the listed time.";
  return {
    cells,
    contract: [
      signedIn
        ? "Press Join and the seat is yours on the spot. This invite came to you; no seat is held for anyone."
        : "Sign in first. This page brings you straight back here to join.",
      `${startClause} Miss the start and the room picks for you: your queue first, then the best player your roster needs.`,
      `The season runs itself: lineups, waivers, scoring and standings, week 1 through the playoffs.${
        paid ? " The pot pays the podium when the season settles." : ""
      }`,
    ],
  };
}

export interface JoinSheetBodyProps {
  readonly facts: JoinDecisionFacts;
  /** The door's own verb row — the lobby's hold-riding CTA, the invite door's join form. A door
   *  whose verb lives in its own strip below the body passes nothing. */
  readonly action?: ReactNode;
}

/** The presentational core both doors render — fact cards, then the contract, then the verb. */
export function JoinSheetBody({ facts, action }: JoinSheetBodyProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {facts.cells.map((cell) => (
          <div
            key={cell.label}
            className={`flex flex-col gap-0.5 rounded-md border p-3 ${cell.accent ? "border-accent" : "border-line"} bg-surface-inset`}
          >
            <span className={`${MICRO_LABEL} ${cell.accent ? "text-accent" : "text-text-faint"}`}>{cell.label}</span>
            <span className="font-display text-xl font-bold tabular-nums leading-display text-text-primary">{cell.value}</span>
            {cell.note === undefined ? null : <span className="text-xs text-text-muted">{cell.note}</span>}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-md bg-surface-inset p-3.5">
        <p className={`${MICRO_LABEL} text-text-faint`}>What happens when you sit</p>
        <ol className="flex list-none flex-col gap-1.5">
          {facts.contract.map((line, index) => (
            <li key={line} className="flex gap-2 text-sm text-text-muted">
              <span aria-hidden="true" className="font-display font-bold tabular-nums text-text-faint">
                {index + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
      {action}
    </div>
  );
}

export interface JoinSheetProps {
  readonly league: PublicLeagueSummary;
  readonly signedIn: boolean;
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live sheet
   *  without editing shipped state. */
  readonly live?: boolean;
  readonly onClose: () => void;
}

/**
 * The lobby's join sheet: `BottomSheet` (the founder's own drawer pattern) around the shared
 * body, with the league's name and format line as the head, the FREE badge while money is dark,
 * and the verb that rides the existing machinery — signed out, `OpenLeagueCta` links to
 * `/join/[leagueId]/hold`, which claims the real hold and puts sign-in on it; signed in, it is
 * the real join button. One solid amber verb per surface: this sheet's own.
 */
export function JoinSheet({ league, signedIn, live = moneyIsLive(), onClose }: JoinSheetProps) {
  const priceSuffix = live && league.entryFeeCents > 0 ? `· ${entryFeeLabel(league)}` : undefined;
  return (
    <BottomSheet label={`Join ${league.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="min-w-0 break-words font-display text-xl font-bold leading-display text-text-primary">{league.name}</h2>
          {live ? null : <Badge tone="neutral">Free</Badge>}
          <FormatLine league={league} />
        </div>
        <JoinSheetBody
          facts={lobbyJoinFacts(league, signedIn, live)}
          action={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PracticeEntryLink signedIn={signedIn} />
              <div className="flex flex-col items-end gap-1">
                <OpenLeagueCta league={league} signedIn={signedIn} emphasis="ink" suffix={priceSuffix} />
                {signedIn ? null : (
                  <p className="text-xs text-text-muted">{`Sign-in rides this tap, with the seat held for ${SEAT_HOLD.minutes} minutes while you do.`}</p>
                )}
              </div>
            </div>
          }
        />
        {live ? null : <p className="text-sm text-text-muted">{moneySentence(live)}</p>}
        <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} srOnlySentence />
      </div>
    </BottomSheet>
  );
}
