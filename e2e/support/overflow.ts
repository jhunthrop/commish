import type { Page } from "@playwright/test";

/**
 * WHAT "IT FITS A 360px PHONE" ACTUALLY MEANS, measured (P10, and the minimum viewport
 * `TOKENS.minViewport` names).
 *
 * The naive sweep — every element in `main` whose right edge is past the viewport — reports two
 * things at once and only one of them is a defect. A cell that says `truncate` lays out at its full
 * text width and is CLIPPED by its own parent: the reader sees an ellipsis, the page does not
 * scroll, and nothing is wrong. The Sideline research rows are full of those, and on the draft
 * board the naive sweep named ten of them while the real 35px of sideways scroll came from the app
 * shell's own header, which is not the surface under test.
 *
 * So this answers the two questions separately:
 * - `scroll` is the document's own horizontal overflow, the thing a reader can actually do; and
 * - `offenders` are only the elements inside `scope` that stick out with NO clipping ancestor
 *   between them and `scope`, which is the list worth naming when a surface really is too wide.
 *
 * A caller asserts on `offenders` for its own surface and reports `scroll` as an annotation when
 * the two disagree, exactly as `league-front.spec.ts` reports shell overflow as shell debt.
 */
export interface OverflowReport {
  /** Document-level horizontal overflow in px, `<= 0` when the page does not scroll sideways. */
  readonly scroll: number;
  /** Elements inside `scope` that visibly stick out past the viewport, nearest-first, capped. */
  readonly offenders: readonly string[];
}

export async function overflowAt(page: Page, scope = "main"): Promise<OverflowReport> {
  return page.evaluate((selector) => {
    const width = document.documentElement.clientWidth;
    const root = document.querySelector(selector);
    const clipped = (node: Element): boolean => {
      for (let parent = node.parentElement; parent !== null && parent !== root; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") return true;
      }
      return false;
    };
    const offenders =
      root === null
        ? []
        : Array.from(root.querySelectorAll<HTMLElement>("*"))
            .filter((node) => node.getBoundingClientRect().right > width + 1 && !clipped(node))
            .slice(0, 8)
            .map((node) => `${node.tagName.toLowerCase()}.${node.className.toString().split(" ").slice(0, 3).join(".")}@${Math.round(node.getBoundingClientRect().right)}`);
    return { scroll: document.documentElement.scrollWidth - width, offenders };
  }, scope);
}
