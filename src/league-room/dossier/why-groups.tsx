"use client";

import { useState } from "react";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Position } from "@/domain/player";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { rosterStatusObservation, rosterStatusPhrase } from "@/projections/preseason/roster-status-copy";
import { narrativeSlot, whyGroupSlotKey, type NarrativeCarrier } from "@/capsules/narrative-slots";
import { signedPoints } from "@/components/ui/event-feed-row";
import { countWordCapitalized, formatTenth } from "../lib/format";
import { groupReasons, type EvidenceGroup, type FactReason } from "../outlook/groups";

export interface WhyGroupsProps {
  readonly reasons: readonly BoardReason[];
  readonly laws: readonly Law[];
  /** Not read by this component's own copy — no group here states a position-qualified fact the
   *  way `Outlook`'s own verdict line does ("he sits RB4"), and that sentence stays `CallCard`'s
   *  alone. Kept in the prop list anyway for drop-in parity with `OutlookProps`'s own
   *  `reasons`/`laws`/`position` triple, and because a future group is more likely to need it than
   *  not (a share fact phrased "24% of RB touches", say). */
  readonly position: Position;
  /** `undefined` (the full page's own posture) — every group, no expander. A number (the peek's
   *  own `5`) — the strongest groups up to that count, with a "The full case (N)" expander for the
   *  rest, the identical cap/expander UX `Outlook` used before this task, parameterized rather
   *  than a fixed five. */
  readonly cap?: number;
  /**
   * THE WRITTEN EVIDENCE LINES (dossier-voice round §3.5) — the capsule, read one slot per group
   * through `narrativeSlot(capsule, whyGroupSlotKey(group.key))`. The bold LEAD stays the group's
   * own headline (a stated quantity, which is the engine's to state); the EXPLANATION is the
   * writer's sentence when he wrote a valid one for that group, and the deterministic sentence
   * below otherwise. Never both.
   */
  readonly capsule?: NarrativeCarrier | null;
}

/** A fraction as a signed whole-number percent: "+4%", "-12%" — the same shape
 *  `reason-chip.tsx`'s own private `signedPercent` keeps, redefined here rather than exported
 *  across a client/client boundary for three lines with no other caller. */
function signedPercent(fraction: number): string {
  const rounded = Math.round(fraction * 100);
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded)}%`;
}

/**
 * One law group's sentence pair — the bold lead is the group's own headline (`groupReasons`'
 * `headlineSourceOf`, already the "one honest statement of the quantity" `groups.ts` picks), and
 * the explanation says what the group DOES to him.
 *
 * SAID OUT LOUD (dossier-voice round §3.7, from the founder's own McCaffrey read). This used to
 * print "Together, 10 laws measure -15.6 points per game." five times down one page: a signed
 * number whose direction hid inside a minus sign, in the lab register ("measure") this product
 * bans from every other piece of prose it writes. The direction is now the verb, the magnitude is
 * unsigned because the verb carries it, and the count is spoken. The figure itself is untouched.
 */
function lawSentence(group: Extract<EvidenceGroup, { kind: "law" }>): { readonly lead: string; readonly explanation: string } {
  const magnitude = formatTenth(Math.abs(group.netEffect));
  const together = group.members.length > 1 ? `${countWordCapitalized(group.members.length)} laws together ` : "";
  const verb = group.netEffect < 0 ? "cost him" : "add";
  const explanation =
    together === ""
      ? group.netEffect < 0
        ? `Costs him ${magnitude} points a game.`
        : `Adds ${magnitude} points a game.`
      : `${together}${verb} ${magnitude} points a game.`;
  return { lead: group.headline, explanation };
}

/** One non-law fact's sentence pair. Every `FactReason` code gets its own bold lead and plain
 *  explanation — the same facts `reason-chip.tsx`'s own `copyFor` states as one chip line, split
 *  here into the mock's two-clause shape rather than duplicating that switch verbatim. */
function factSentence(reason: FactReason): { readonly lead: string; readonly explanation: string } {
  switch (reason.code) {
    case "availability":
      return { lead: "Availability", explanation: `Expected ${Math.round(reason.expectedGames)} games, ${Math.round(reason.floorGames)} to ${Math.round(reason.ceilingGames)}.` };
    case "offseason_share_gained":
      return { lead: "Offseason share gained", explanation: `Targets ${signedPercent(reason.targetShare)}, carries ${signedPercent(reason.carryShare)}.` };
    case "offseason_share_lost":
      return { lead: "Offseason share lost", explanation: `Targets ${signedPercent(-reason.targetShare)}, carries ${signedPercent(-reason.carryShare)}.` };
    case "changed_team":
      return { lead: "Changed team", explanation: `${reason.from} to ${reason.to}.` };
    case "new_play_caller":
      return { lead: "New play caller", explanation: `At ${reason.team}.` };
    case "rookie":
      return { lead: "Rookie", explanation: reason.overallPick === null ? "Undrafted." : `Pick ${reason.overallPick}.` };
    case "market_unlisted":
      return { lead: "No ADP", explanation: "The feed carries no ADP for him." };
    // The kicker and team defence reasons (the 2026-09-05 round): components a reader can argue
    // with, the same facts `reason-chip.tsx` states as one line, split into lead and explanation.
    case "kicker_no_history":
      return { lead: "No kicking record yet", explanation: "Uses his club's volume and the league's make rates." };
    case "kicker_opportunity":
      return {
        lead: "Kicking opportunity",
        explanation: `${reason.fieldGoalAttemptsPerGame.toFixed(1)} field goal and ${reason.extraPointAttemptsPerGame.toFixed(1)} extra point tries a game, ${Math.round(reason.fieldGoalMakeRate * 100)}% made.`,
      };
    case "defense_no_history":
      return { lead: "No defensive record in these seasons", explanation: "Uses the league's own rates." };
    case "defense_takeaways":
      return {
        lead: "Takeaways and pressure",
        explanation: `${reason.sacksPerGame.toFixed(1)} sacks and ${reason.takeawaysPerGame.toFixed(1)} takeaways a game, ${signedPoints(reason.tierPointsPerGame)} points from what it allows.`,
      };
    // The roster-status gate (2026-09-08): the status is the lead, the dated observation behind it
    // is the explanation. Same words as every other surface (`roster-status-copy.ts`).
    case "roster_status":
      return { lead: rosterStatusPhrase(reason.status), explanation: `${rosterStatusObservation(reason)}.` };
    default: {
      // Exhaustiveness guard: a future `BoardReason` variant with no case above fails `tsc` here
      // rather than rendering silently wrong copy.
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function sentenceFor(group: EvidenceGroup): { readonly lead: string; readonly explanation: string } {
  return group.kind === "law" ? lawSentence(group) : factSentence(group.reason);
}

/**
 * THE WHY, AS SENTENCES (dossier plan, Task 6) — the Outlook's grouped evidence
 * (`../outlook/groups.ts`'s `groupReasons`, reused unchanged: no new grouping logic lives here)
 * restyled as the approved mock's own shape: a bold lead clause plus a plain explanation, one
 * group per line, strongest first ("The market disagrees with us by -20 points. His price implies
 * 217. Our number is 197." is the mock's own worked example of the STYLE — a market gap, which
 * `groupReasons` itself never surfaces here since `market_anchor` feeds `CallCard`'s verdict
 * instead; every group this component actually renders is a law or a structural fact).
 *
 * NEVER A VERDICT LINE. `Outlook` used to open with `verdictLine`'s own sentence before this
 * task; this component prints none — `CallCard` states the verdict once, from the identical
 * `reasons`/`position`, and a second copy here would be the exact duplication ruling R-d2 closed.
 *
 * `cap` IS THE ONLY SIZE KNOB: `undefined` renders every group (the full page's own posture);
 * a number renders the strongest that many, with a "The full case (N)" expander for the rest —
 * the peek passes `5`, unchanged from `Outlook`'s own prior fixed cap.
 */
export function WhyGroups({ reasons, laws, cap, capsule = null }: WhyGroupsProps) {
  const [showFullCase, setShowFullCase] = useState(false);

  if (reasons.length === 0) return null;

  const groups = groupReasons(reasons, laws);
  const visible = cap !== undefined && !showFullCase ? groups.slice(0, cap) : groups;
  const hiddenCount = groups.length - visible.length;

  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>Why</h3>
      <div className="flex flex-col gap-1.5">
        {visible.map((group) => {
          const { lead, explanation } = sentenceFor(group);
          const written = narrativeSlot(capsule, whyGroupSlotKey(group.key));
          return (
            // THE FIGURE STAYS STATED (review I4) — the bold lead is the quantity, the plain
            // explanation is what it does to him in points, and the written sentence follows both
            // rather than standing in for the number. A page that drops a measured effect the
            // moment a writer has something to say about it is a page that says less.
            <p key={group.key} className="text-sm" data-why-group={group.key}>
              <span className="font-semibold text-text-primary">{lead}.</span> <span className="text-text-muted">{explanation}</span>
              {written === null ? null : <span className="text-text-muted" data-why-written={group.key}> {written}</span>}
            </p>
          );
        })}
      </div>
      {hiddenCount <= 0 ? null : (
        <button
          type="button"
          onClick={() => setShowFullCase(true)}
          aria-expanded={showFullCase}
          className={`${MICRO_LABEL} w-fit text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        >
          {`The full case (${groups.length})`}
        </button>
      )}
    </div>
  );
}
