import type { PlayerFactsBooksNumbers } from "@/capsules/facts";
import { PROP_MARKET_LABELS } from "@/capsules/prop-market-labels";
import { Card } from "@/components/ui";
import { formatLine } from "../lib/format";

export interface BooksModuleProps {
  readonly books: PlayerFactsBooksNumbers;
  /**
   * THE WRITTEN LINE (`narrativeSlot(capsule, "books")`) — what the books are saying about him. It
   * ACCOMPANIES the numbers rather than replacing them: the chips and the win total are stats, and
   * a stat is stated by the engine.
   */
  readonly sentence?: string | null;
  /**
   * THE WRITTEN ABSENCE (`narrativeSlot(capsule, "absence:books")`), a SEPARATE slot from the one
   * above (review I6). Folding the two together put the books sentence into the props-absence line
   * for a player who has a win total but no props line, which is a sentence about numbers that
   * are not there. This one replaces the templated "No props line posted for him yet.", and only
   * that.
   */
  readonly absence?: string | null;
}

/**
 * THE BOOKS MODULE (dossier plan, Task 4) — the sportsbooks' own pre-kickoff numbers, phrased as
 * what they hang on him, never this engine's own claim (`render.ts`'s own "color facts" rule,
 * group b, carried into the client-facing module).
 *
 * `PROP_MARKET_LABELS` is IMPORTED from `@/capsules/prop-market-labels`, never re-typed here — one
 * label map for both the model-facing prose (`capsules/render.ts`) and this client component. That
 * module holds nothing but a `Record` keyed by a type, so a client bundle importing it costs
 * nothing (see its own docblock for why this is a separate file from `render.ts`, which pulls in
 * `node:crypto` transitively through `facts.ts`'s `factsHash`).
 *
 * THE ADP SPARKLINE RENDERS NOTHING, ON PURPOSE, in this task — it arrives once `adp_snapshots`
 * holds real multi-day depth for the player (a later task's own honest gate), and an explanatory
 * sentence in its place would be exactly the placeholder this product's honesty rule forbids.
 */
export function BooksModule({ books, sentence = null, absence = null }: BooksModuleProps) {
  return (
    <Card as="section" aria-label="The books" className="flex flex-col gap-3">
      {books.propsLines.length === 0 ? (
        <p className="text-sm text-text-faint" data-books="props-empty">
          {absence ?? "No props line posted for him yet."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {books.propsLines.map((line) => (
            <span key={line.market} className="rounded-pill bg-surface-inset px-3 py-1 text-sm tabular-nums text-text-primary" data-books-chip={line.market}>
              {formatLine(line.medianLine)} {PROP_MARKET_LABELS[line.market]} a game
            </span>
          ))}
        </div>
      )}
      <p className="text-sm text-text-muted" data-books="win-total">
        {books.teamVegasWinTotal === null ? "Team win total: not posted yet." : `Team win total: ${formatLine(books.teamVegasWinTotal)} wins.`}
      </p>
      {sentence === null || books.propsLines.length === 0 ? null : (
        <p className="text-sm text-text-primary" data-books="written">
          {sentence}
        </p>
      )}
    </Card>
  );
}
