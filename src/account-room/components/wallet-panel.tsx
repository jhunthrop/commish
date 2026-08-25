import { Panel } from "@/components/ui";
import type { WalletSummary } from "@/money-service/read";
import { formatUsd } from "@/money/config";

export interface WalletPanelProps {
  /** `walletSummary` (`@/money-service/read`), computed server-side and handed down as a plain
   *  object — the same "props, not a fetch" shape `StandingPanel`'s own `seasons`/`tier`/
   *  `verified` already use. This panel has no data seam of its own. */
  readonly summary: WalletSummary;
}

interface WalletFigure {
  readonly key: keyof WalletSummary;
  readonly label: string;
  readonly explanation: string;
}

/**
 * The four figures, in the SAME order `WalletSummary` declares them — money-first: what the
 * reader can spend right now, then the three reasons the rest of it is not available. One line
 * of plain explanation each, no jargon, no numbers repeated in the sentence (the figure beside it
 * already carries the number).
 */
const WALLET_FIGURES: readonly WalletFigure[] = [
  { key: "availableCents", label: "Available", explanation: "Ready to spend, or withdraw to your bank." },
  { key: "escrowCents", label: "In escrow", explanation: "Entry fees for leagues that have not finished." },
  { key: "heldCents", label: "Held for review", explanation: "A prize the operator is reviewing before it reaches your available balance." },
  { key: "owedCents", label: "Owed", explanation: "A returned deposit left this account owing money. A new deposit settles it." },
];

/**
 * The wallet's own four figures (Task 12), each a straight read of `WalletSummary` — the ONE
 * data source (`@/money-service/read`'s own docblock: "no surface invents its own sums"). Money
 * first, twice over: `Panel`'s `meta` puts the available balance beside the title before a reader
 * scans a single row, and the rows below render in `WalletSummary`'s own declared order —
 * available first, then the three reasons the rest is not available yet. `formatUsd` on every
 * figure, `tabular-nums` so four stacked amounts align on the decimal the way a ledger always
 * does; no raw cents number ever reaches the DOM.
 */
export function WalletPanel({ summary }: WalletPanelProps) {
  return (
    <Panel title="Balance" meta={formatUsd(summary.availableCents)}>
      <dl className="flex flex-col gap-3">
        {WALLET_FIGURES.map((figure) => (
          // `<dl>`'s allowed direct children are `<dt>`/`<dd>` pairs, optionally grouped in a
          // `<div>` whose OWN direct children must themselves be `<dt>`/`<dd>` — `NotificationSummary`'s
          // own precedent (`notification-summary.tsx`): the amount lives INSIDE `<dt>`, beside the
          // label, rather than in a third wrapper `<div>`, so this stays a valid (and axe-clean)
          // description list.
          <div key={figure.key} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
            <dt className="flex items-center justify-between gap-4">
              <span className="font-medium text-text-primary">{figure.label}</span>
              <span className="whitespace-nowrap font-mono text-md font-medium tabular-nums text-text-primary">{formatUsd(summary[figure.key])}</span>
            </dt>
            <dd className="text-sm text-text-muted">{figure.explanation}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
