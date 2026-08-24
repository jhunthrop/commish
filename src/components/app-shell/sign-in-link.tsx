import Link from "next/link";
import type { ReactNode } from "react";

export interface SignInLinkProps {
  /**
   * The path to return to once signed in, already run through `safeReturnTo`
   * (`src/lib/auth/return-to.ts`) by the CALLER — this component trusts what it is given rather
   * than re-validating it, because `/sign-in/route.ts` re-validates regardless (defense in
   * depth belongs at the boundary that actually redirects, not duplicated at every place that
   * spells a link). `null` when there is nothing on this page worth returning to.
   */
  readonly intent: string | null;
  /** Defaults to the plain "Sign in" every caller that does not need a more specific label gets. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly "aria-label"?: string;
}

/**
 * THE ONE way to render "sign in" anywhere in this product (Task 16, F6). Six hand-written
 * `<Link href="/sign-in">` call sites and three copy-pasted signed-out headers all dropped a
 * visitor's intent on the floor before this task; every one of them renders this instead, now.
 */
export function SignInLink({ intent, children = "Sign in", className, "aria-label": ariaLabel }: SignInLinkProps) {
  const href = intent === null ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(intent)}`;
  return (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
