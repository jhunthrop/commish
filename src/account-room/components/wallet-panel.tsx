import { EYEBROW, Panel, Stat } from "@/components/ui";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import type { WalletSummary } from "@/money-service/read";
import { formatUsd } from "@/money/config";

export interface WalletPanelProps {
  /**
   * `walletSummary` (`@/money-service/read`), computed server-side and handed down as a plain
   * object — the same "props, not a fetch" shape `ManagerHeader`'s own `seasons`/`tier`/
   * `verified` already use. This panel has no data seam of its own.
   *
   * `null` is the FREE SEASON: real-money play is not open, so there is no balance to read and
   * every figure renders `NOT_STARTED_DASH`. That is the wallet's honest state, not a zero —
   * see this component's own docblock for why the distinction is the whole point.
   */
  readonly summary: WalletSummary | null;
}

interface WalletFigure {
  readonly key: keyof WalletSummary;
  readonly label: string;
  readonly explanation: string;
}

/** The available balance's own sentence, named because it is read twice: under the hero `Stat`,
 *  and inside `WALLET_FIGURES` so the list below stays the complete description of every figure
 *  rather than three of four. */
const AVAILABLE_EXPLANATION = "Ready to spend, or withdraw to your bank.";

/**
 * The four figures, in the SAME order `WalletSummary` declares them — money-first: what the
 * reader can spend right now, then the three reasons the rest of it is not available. One line
 * of plain explanation each, no jargon, no numbers repeated in the sentence (the figure beside it
 * already carries the number).
 */
const WALLET_FIGURES: readonly WalletFigure[] = [
  { key: "availableCents", label: "Available", explanation: AVAILABLE_EXPLANATION },
  { key: "escrowCents", label: "In escrow", explanation: "Entry fees for leagues that have not finished." },
  { key: "heldCents", label: "Held for review", explanation: "A prize the operator is reviewing before it reaches your available balance." },
  { key: "owedCents", label: "Owed", explanation: "A returned deposit left this account owing money. A new deposit settles it." },
];

/** The three figures below the hero — everything in `WALLET_FIGURES` except the available
 *  balance, which `WalletPanel` renders as its own `Stat` above them. Derived rather than a
 *  second hand-maintained list, so adding a figure to `WalletSummary` cannot leave one list
 *  behind. */
const SECONDARY_FIGURES = WALLET_FIGURES.filter((figure) => figure.key !== "availableCents");

/** Every figure on this panel reads its source through here, so the hero and the three rows
 *  below it can never disagree — a formatter that could disagree with itself about a
 *  free-season dash is exactly the drift this centralizes away. */
function figureText(summary: WalletSummary | null, key: keyof WalletSummary): string {
  return summary === null ? NOT_STARTED_DASH : formatUsd(summary[key]);
}

/**
 * The wallet's own four figures (Task 12), each a straight read of `WalletSummary` — the ONE
 * data source (`@/money-service/read`'s own docblock: "no surface invents its own sums").
 *
 * GAMEDAY, LAW 2 ON A MONEY SURFACE. The available balance is the number this page exists to
 * answer, and it used to render as 15px mono in `Panel`'s own `meta` slot, the same size as the
 * three figures explaining why the rest of the money is not available. It is now a `Stat` at
 * `display-lg` over an 11px label, which is the pairing law 2's scale exists for — `lg` and not
 * the top of the scale, because `display-2xl` and `3xl` are a TV board and a matchup hero, and a
 * balance is read carefully rather than shouted. Four times its label is range enough here.
 *
 * The three reasons the rest of the money is not available stay dense hairline rows beneath it,
 * because they are read down a column (law 3's amended test: *a thing you act on or compare
 * against its neighbours may be a card; a thing you read down a column stays a row*). The dormant
 * hero is deliberately not a `Stat` at all — see the branch's own comment below.
 *
 * NO MAGNITUDE TINT, EVER. A balance has no population to be judged against — "top 12% of
 * balances" is a comparison this product does not hold and would be inventing, and it would be
 * a judgement about a person's money besides. The `Stat` takes no `comparison`, so it renders as
 * ordinary ink.
 *
 * **A DASH IS NOT A ZERO, AND THAT IS THE WHOLE FREE-SEASON CONTRACT.** `summary === null` means
 * real-money play is not open, and every figure renders `NOT_STARTED_DASH` — the same glyph the
 * scoreboard uses for a player who has not kicked off, for the same reason the spec gives it
 * there: *"folding 'has not played' into 'scored nothing' is the most common lie a fantasy
 * scoreboard tells."* A wallet in a free season holds no balance; it does not hold $0.00. One
 * component renders both states, so the shape a manager will read when money goes live is the
 * shape they are learning now.
 */
export function WalletPanel({ summary }: WalletPanelProps) {
  return (
    <Panel title="Balance">
      {summary === null ? (
        // THE DORMANT HERO IS NOT A `Stat`, AND THAT IS THE POINT. `Stat` is the primitive for a
        // NUMBER, and its `neutral` step is `textPrimary` by deliberate design — an uncompared
        // number must be indistinguishable from ordinary ink. Rendered, a dash in that ink at
        // 44px is not a dash: it is a solid bar the width of an em, and on the light theme it
        // reads as a redaction over the reader's own balance, which is the opposite of what it
        // says. The same eyebrow, the same display size, faint ink — an absence drawn as an
        // absence. Both branches keep `Stat`'s own label-over-number order so the two states are
        // the same block at the same place, which is the whole reason the dormant page renders
        // this panel at all.
        <div className="flex flex-col gap-1">
          <span className={`${EYEBROW} text-text-faint`}>Available</span>
          <span aria-hidden="true" className="font-display text-display-lg leading-display text-text-faint">
            {NOT_STARTED_DASH}
          </span>
          <span className="sr-only">No balance yet.</span>
        </div>
      ) : (
        <Stat label="Available" value={formatUsd(summary.availableCents)} size="lg" className="font-mono" />
      )}
      <p className="text-sm text-text-muted">{AVAILABLE_EXPLANATION}</p>
      <dl className="flex flex-col">
        {SECONDARY_FIGURES.map((figure) => (
          // `<dl>`'s allowed direct children are `<dt>`/`<dd>` pairs, optionally grouped in a
          // `<div>` whose OWN direct children must themselves be `<dt>`/`<dd>` — `NotificationSummary`'s
          // own precedent (`notification-summary.tsx`): the amount lives INSIDE `<dt>`, beside the
          // label, rather than in a third wrapper `<div>`, so this stays a valid (and axe-clean)
          // description list.
          <div key={figure.key} className="border-t border-line pt-2 pb-2 last:pb-0">
            <dt className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-text-primary">{figure.label}</span>
              <span className="whitespace-nowrap font-mono text-md font-medium tabular-nums text-text-primary">{figureText(summary, figure.key)}</span>
            </dt>
            <dd className="text-sm text-text-muted">{figure.explanation}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
