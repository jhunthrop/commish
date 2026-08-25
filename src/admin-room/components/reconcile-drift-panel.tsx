"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";

interface DriftFindingBody {
  readonly code: string;
  readonly message: string;
}

/**
 * The wire shape `GET /api/admin/money/reconcile` answers with (`ReconcileDriftBody`,
 * `src/app/api/admin/money/reconcile/route.ts`) — duplicated here rather than imported, the same
 * "cross the boundary via a locally-typed body, never a shared import" idiom `DissolveLeagueBody`
 * and `SettleLeagueBody` already use (`./dissolve-league-control.tsx`, `./settle-league-control
 * .tsx`): `src/admin-room/**` may not value-import `@/money-service` at all (the client boundary,
 * `eslint.config.mjs`), and a route module is server-only regardless. Every figure below is a
 * number this component only ever DISPLAYS through `formatUsd` — it computes no drift, no
 * threshold comparison and no "is this clean" decision of its own; `findings` is the server's
 * own answer to that question (`moneyDriftFindings`), so the panel and the operator's cron-able
 * script (`scripts/money-reconcile.ts`) can never disagree about what counts as an alarm.
 */
interface ReconcileDriftBody {
  readonly ledgerFboPoolCents: number;
  readonly providerPooledBalanceCents: number;
  readonly drift: number;
  readonly findings: readonly DriftFindingBody[];
}

type LoadState = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly report: ReconcileDriftBody };

/**
 * The admin-room reconciliation panel (Phase 4, Task 11): the operator's own view of the drift
 * report Task 5's webhook translator built its unresolvable alarms
 * (`DEPOSIT_ALARMS.unknownTransferRef`/`transferDisagreement`) FOR — this is where those logged
 * discrepancies finally become a visible fact instead of a line in a server log nobody is
 * watching. Level-triggered, per the brief's own ruling (no scheduler): loads once on mount so an
 * operator who opens this page sees the current state immediately, and the "Refresh" button reruns
 * the identical `GET` — there is no cached "last reconciled" state anywhere, on either side of the
 * wire, to grow stale between the two.
 *
 * Money-first copy, and the one discipline this panel holds to strictly: a clean report says so
 * plainly, and a dirty one states WHAT drifted and BY HOW MUCH, in the server's own words
 * (`finding.message`) — never a guess at WHY, which is the operator's own job once they see the
 * number.
 */
export function ReconcileDriftPanel() {
  const { fetchJson } = useAdminRoomDeps();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ status: "loading" });
    try {
      const response = await fetchJson("/api/admin/money/reconcile");
      const envelope = (await response.json()) as ApiEnvelope<ReconcileDriftBody>;
      if (!envelope.ok) {
        setState({ status: "error", message: envelope.error });
        return;
      }
      setState({ status: "ready", report: envelope.data });
    } catch {
      setState({ status: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  }, [fetchJson]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" loading={state.status === "loading"} disabled={state.status === "loading"} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-negative">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Ledger pooled balance {formatUsd(state.report.ledgerFboPoolCents)}. Bank pooled balance {formatUsd(state.report.providerPooledBalanceCents)}.
          </p>
          {state.report.findings.length === 0 ? (
            <p className="text-sm text-positive">No drift found. The ledger agrees with the bank, and every internal check is clean.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.report.findings.map((finding) => (
                <li key={finding.code} role="alert" className="text-sm text-negative">
                  {finding.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
