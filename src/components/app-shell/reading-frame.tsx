import type { ReactNode } from "react";
import { PageTitle } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { PublicBar, STOREFRONT_NAV } from "./public-bar";
import { PublicFooter } from "./public-footer";

/**
 * The measured column, used by BOTH bands so the masthead's title and the paragraphs under it
 * begin on the same vertical line. They did not, before this was one constant: the two blocks
 * carried different gutters and the h1 sat fifteen pixels left of every sentence it introduced.
 *
 * LEFT-ALIGNED to the page gutter, not centred. "Full-bleed frames, measured paragraphs" is the
 * layout rule (`docs/design-system.md`), and these four pages were centring the FRAME along with
 * the words — a 768px column floating in the middle of a 1440px page, under a nav pinned to the
 * left edge, which is most of why they read as somebody else's website. `sm:px-10` is the same
 * desktop gutter the front door's own bands use, so the storefront begins at one line throughout.
 */
const COLUMN = "flex w-full max-w-3xl flex-col px-4 sm:px-10";

export interface ReadingFrameProps {
  /** The page's own `<h1>`, and the same string its `metadata` title uses (A5). */
  readonly title: string;
  /**
   * The one sentence that answers "what is this page" before a reader commits to the column
   * beneath it. In INK, one step up the body scale — it is the only sentence on the page that is
   * not muted, which is what gives a wall of prose an entry point.
   *
   * Required, and deliberately not defaulted: every one of these pages already opened with a
   * sentence doing exactly this job, set at the same size and colour as the eleven behind it. The
   * fix is promoting that sentence, never writing a second one.
   */
  readonly lede: string;
  /** The mono key over the title — the page's KIND, not a restatement of its name ("Legal" over
   *  "Terms"). Optional, because a page whose name already is its kind gains nothing from one. */
  readonly kicker?: string;
  /** Where this frame's `PublicBar` sign-in link returns the visitor (Task 16, F6). */
  readonly intent: string | null;
  readonly signedIn: boolean;
  /** The page's one action, in the masthead beside the lede rather than buried under the prose —
   *  for the surfaces whose whole content IS an act (`/sign-in/problem`). Most reading pages have
   *  none: a paragraph is not a control, and inventing a CTA for one is decoration. */
  readonly action?: ReactNode;
  /** The measured paragraph column. */
  readonly children?: ReactNode;
}

/**
 * THE READING PAGE, ONCE (Gameday, 2026-08-28).
 *
 * `/support`, `/league-rules`, `/legal/terms` and `/legal/privacy` are the product's four
 * measured-paragraph pages (`docs/design-system.md`, "Layout"), and all four had independently
 * hand-rolled the identical shape: a BARE `PublicBar`, `mx-auto flex w-full max-w-3xl flex-col
 * gap-4 p-4`, a `PageTitle`, and then between four and eight `<p className="text-text-muted">` in
 * a row. Four copies of one layout is the duplication a design system exists to end, and the
 * result was the founder's verdict rendered literally: *"It feels like a legal website and not a
 * fantasy site."* These pages WERE the legal website.
 *
 * Three things this frame fixes that no amount of care at four call sites would have:
 *
 * **The nav.** Every one of these pages rendered `PublicBar` with no `nav` at all — a wordmark
 * and a sign-in link. A stranger who lands on `/support` from a search result had exactly one
 * door back into the product, and it was the logo. They now carry the SAME storefront nav the
 * front door does (`STOREFRONT_NAV`), which is also the fix for the audit's own way-out law
 * applied above the fold rather than only in the footer.
 *
 * **The entry point.** Every sentence on these pages was `text-text-muted` at body size, so
 * there was no first sentence, only twelve equal ones. The lede is promoted to ink one step up
 * the scale, in the masthead, above the hairline — the shape a magazine has always used and the
 * one thing law 2 can honestly spend on a page whose content is words rather than numbers.
 *
 * **The frame.** The masthead is a full-bleed band on `surfaceElevated` bounded by a hairline;
 * the column beneath it is the measured `max-w-3xl` the layout rule requires. Full-bleed frames,
 * measured paragraphs — the rule was already written, and these four pages were centring the
 * frame along with the words, which is why every one of them read as a column adrift in an empty
 * page.
 *
 * NOT a `Card`, and no motion of any kind: law 6 forbids anything that animates on mount, and a
 * reading page has no event to report.
 */
export function ReadingFrame({ title, lede, kicker, intent, signedIn, action, children }: ReadingFrameProps) {
  return (
    <>
      <PublicBar intent={intent} signedIn={signedIn} nav={STOREFRONT_NAV} />
      <main className="flex w-full flex-col">
        <div className="w-full border-b border-line bg-surface-elevated">
          <div className={`${COLUMN} gap-3 py-8 sm:py-10`}>
            {kicker === undefined ? null : <p className={`${MICRO_LABEL} text-text-faint`}>{kicker}</p>}
            <PageTitle>{title}</PageTitle>
            <p className="max-w-prose text-lg leading-relaxed text-text-primary">{lede}</p>
            {action === null || action === undefined ? null : <div className="flex flex-wrap items-center gap-3 pt-1">{action}</div>}
          </div>
        </div>
        {/* The measured column. `leading-relaxed` is the one concession law 4's tight leading
            makes: density is respect on a Sunday board of numbers, and a paragraph a person reads
            line by line is the other kind of surface entirely. */}
        {children === undefined ? null : <div className={`${COLUMN} gap-4 py-8 leading-relaxed text-text-muted`}>{children}</div>}
      </main>
      <PublicFooter />
    </>
  );
}
