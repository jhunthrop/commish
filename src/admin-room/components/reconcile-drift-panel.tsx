"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, BigNumber, Button, LedgerRow } from "@/components/ui";
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

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly report: ReconcileDriftBody; readonly asOf: string };

function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/**
 * The admin-room reconciliation panel (Phase 4, Task 11; rebuilt as a statement per the operator
 * review, 2026-08-27, findings D4/E1): the operator's own view of the drift report Task 5's
 * webhook translator built its unresolvable alarms FOR. The review measured zero `.font-mono`
 * anywhere on this page and the `drift` field the API returns and the page is literally named for
 * going unrendered — a book holding nothing and a book balanced to the cent printed the identical
 * green sentence. This version prints ledger, bank and drift as their own mono rows (cents stay
 * aligned, `.font-mono` carries `tabular-nums` in this product, `globals.css`), stamps the instant
 * THIS component received the report (there is no server-side "last reconciled" timestamp to
 * read — the module's own docblock says so, level-triggered by design), and tells "the book holds
 * nothing yet" apart from "the book is balanced" rather than printing one green sentence for
 * both.
 *
 * Level-triggered, per the brief's own ruling (no scheduler): loads once on mount so an operator
 * who opens this page sees the current state immediately, and "Refresh" reruns the identical
 * `GET` — there is no cached state anywhere, on either side of the wire, to grow stale between
 * the two.
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
      setState({ status: "ready", report: envelope.data, asOf: new Date().toISOString() });
    } catch {
      setState({ status: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  }, [fetchJson]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-negative">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <div role="status" className="flex flex-col gap-3">
          {/* THE ONE NUMBER THIS TOOL EXISTS TO REPORT, at the size of the question it answers.
              An operator opens money reconciliation to learn one thing: does the book agree with
              the bank. Drift used to render at 13px as the third of three identical rows, so the
              answer was the same size as the two figures it is derived FROM. This is the single
              place the spec's "laws 2 and 6 are spent sparingly here" gets spent on this page —
              one figure, no motion, and the two inputs stay dense rows below it.

              SIDELINE (2026-09-11): `BigNumber`, not `Stat`, and the swap makes the refusal
              structural. `Stat` exists for the heat map and its whole contract is the
              `comparison` seam; a drift has no population to be judged against, so leaving that
              seam empty was the correct call made by habit. `BigNumber` cannot be tinted at all,
              and it carries the one thing this figure was missing: what it is the difference
              BETWEEN. Green-for-zero would be a verdict the `Badge` beside it already states in a
              word, which is also the only channel a screen reader gets.

              THE ALARM STAYS NEGATIVE, NOT LIVE. A book that disagrees with the bank is a
              FAILURE, and the failure channel is warm red as text; the live channel means
              happening right now and a reconciliation report is a statement about a moment that
              has already passed. */}
          <div className="flex flex-wrap items-center gap-3">
            <BigNumber align="start" size="lg" value={formatUsd(state.report.drift)} basis="drift, the book minus the bank" />
            <Badge tone={state.report.drift === 0 ? "neutral" : "negative"}>{state.report.drift === 0 ? "Agrees" : "Off the bank"}</Badge>
          </div>

          <div className="flex flex-col">
            <LedgerRow label="Ledger pooled balance">
              <span className="font-mono text-text-primary">{formatUsd(state.report.ledgerFboPoolCents)}</span>
            </LedgerRow>
            <LedgerRow label="Bank pooled balance">
              <span className="font-mono text-text-primary">{formatUsd(state.report.providerPooledBalanceCents)}</span>
            </LedgerRow>
          </div>

          {state.report.findings.length === 0 ? (
            state.report.ledgerFboPoolCents === 0 && state.report.providerPooledBalanceCents === 0 ? (
              <p className="text-sm text-text-muted">The book holds no money yet. There is nothing to check.</p>
            ) : (
              <p className="text-sm text-positive">The ledger agrees with the bank to the cent, and every internal check passed.</p>
            )
          ) : (
            <ul className="flex flex-col gap-2">
              {state.report.findings.map((finding) => (
                <li key={finding.code} role="alert" className="text-sm text-negative">
                  {finding.message}
                </li>
              ))}
            </ul>
          )}

          {/* The re-read, and the page's quietest control by design (law 5: the loud action
              belongs to ACTS only). "Refresh" moves no money and decides nothing — it reruns the
              same `GET` — so it is a quiet pill sitting with the timestamp it replaces, rather
              than the ink pill standing above the report it used to introduce. That leaves this
              operator page with no ink action at all, which is the correct answer for a tool
              whose whole job is to state a fact. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
            <p className="text-xs text-text-muted">
              As of <time dateTime={state.asOf}>{formatInstant(state.asOf)}</time>.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
      ) : null}

      {state.status !== "ready" ? (
        <div>
          <Button type="button" variant="secondary" size="sm" loading={state.status === "loading"} disabled={state.status === "loading"} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      ) : null}
    </div>
  );
}
