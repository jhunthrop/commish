"use client";

import { Select } from "@/components/ui";
import { US_STATE_CODES, type StateCode } from "@/money/states";

/** `Select`'s own options list, built here rather than imported from `@/account-room/components/
 *  money-copy` — that module lives in a DIFFERENT client boundary (`src/account-room/**`), and
 *  `src/league-room/**` cannot value-import across it, the same reasoning `DEAD_CODE_TEXT`/
 *  `SCORING_LABEL_TERM` already duplicate across their own boundaries for. `US_STATE_CODES`
 *  itself is browser-safe (`@/money`), so only the four-line mapping is repeated, not the list. */
const STATE_OPTIONS = [{ value: "", label: "Choose your state" }, ...US_STATE_CODES.map((code) => ({ value: code, label: code }))];

export interface PaidJoinConfirmationProps {
  /** `LeagueTerms.entryFeeUsd`, verbatim — already `formatUsd`'d at the one place `leagueTerms`
   *  does it, never re-derived here. */
  readonly entryFeeUsd: string;
  /**
   * The member's wallet balance AFTER this fee, `formatUsd`'d server-side (`walletSummary`,
   * `@/money-service/read`, minus the league's own `entryFeeCents`) by this component's caller's
   * own caller — the arithmetic happens once, server-side, where both raw cent figures already
   * live; this component only ever renders words, never subtracts money itself.
   */
  readonly balanceAfterUsd: string;
  readonly stateOfEntry: StateCode | null;
  readonly onStateOfEntryChange: (state: StateCode) => void;
}

/**
 * The paid join's own confirmation step (Phase 4, Task 13 — the T8 carry: "wiring a real
 * attestation control into the join doors is the money-live UI's job", `@/league-service/join`'s
 * `JoinMoneyContext` docblock). Three sentences, money-first, sweep-clean: what this join costs,
 * what remains after paying it, and when it comes back — plus the state-of-entry attestation the
 * fee gate's own first question (`moneyGates`, `@/money-service/gates`) requires before it can
 * pass, asked HERE rather than only discovered as a refusal after "Join" is pressed.
 *
 * No league on this platform can reach this component while `moneyIsLive()` stays false
 * (`leagueMoneyOrRefuse`, `@/league-service/creation` refuses every paid creation until the
 * founder names a launch state) — built and proven now, through injected props, ahead of the day
 * a real fee and a real balance reach it. Rendered by `JoinForm` only when `terms.entryFeeUsd` is
 * defined.
 */
export function PaidJoinConfirmation({ entryFeeUsd, balanceAfterUsd, stateOfEntry, onStateOfEntryChange }: PaidJoinConfirmationProps) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-elevated p-3">
      <p className="text-sm text-text-primary">{`This league charges ${entryFeeUsd} to join.`}</p>
      <p className="text-sm text-text-primary">
        {"Your balance after: "}
        <span className="font-semibold text-positive">{balanceAfterUsd}</span>
        {"."}
      </p>
      <p className="text-sm text-text-muted">
        {"Refunded in full if you leave before the draft or the league dissolves before it starts."}
      </p>
      <Select
        label="State of entry"
        options={STATE_OPTIONS}
        value={stateOfEntry ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value !== "") onStateOfEntryChange(value as StateCode);
        }}
      />
    </div>
  );
}
