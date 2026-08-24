import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./button";

export interface ButtonLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

/**
 * The anchor form of `Button` (Task 4, closing E8): a navigation that looks like an action —
 * "Take a seat", "Go to the home page", a board row's next step — renders THIS, never a `Link`
 * wearing a hand-rolled copy of the button classes. One class map, two elements:
 * `buttonClassName` (`./button.tsx`) is the single source of truth, so ink pill and quiet pill
 * can never drift between the `<button>` and the `<a>`.
 *
 * Deliberately no `loading`/`disabled`: an anchor has no disabled state — if a navigation is
 * momentarily unavailable, the caller renders something else, rather than a link pretending.
 */
export function ButtonLink({ variant = "primary", size = "md", className = "", ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClassName(variant, size, className)} />;
}
