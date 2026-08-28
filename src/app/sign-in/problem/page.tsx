import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { buttonClassName } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ReadingFrame } from "@/components/app-shell/reading-frame";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { safeReturnTo } from "@/lib/auth/return-to";

// A5: matches this page's own <h1> exactly.
export const metadata: Metadata = pageTitle("Sign-in did not go through");

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

/**
 * The only screen a failed WorkOS callback is allowed to land on (`callback/route.ts`'s own
 * `onError`, Task 16 Step 4). Legal beside `sign-in/route.ts`: different segments.
 *
 * Says what happened in plain language — no digest, no error text, no provider name, because
 * none of those help the person standing here and every one of them is a detail this product
 * does not owe a stranger. Offers "Try again" (a `SignInLink` carrying the same intent this page
 * itself was reached with, read from `?returnTo=` through `safeReturnTo`) and a way to the front
 * door. Never a dead end.
 *
 * `callback/route.ts`'s own `onError` does not currently populate `?returnTo=` when it redirects
 * here (see that file's docblock for why the SDK does not reliably expose the visitor's original
 * intent on a failed callback) — so in practice `intent` is usually `null` here today, and "Try
 * again" falls back to a plain sign-in. The query-string path stays real and tested regardless:
 * a future caller that DOES hold a trustworthy intent can still link here with one.
 */
export default async function SignInProblemPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const intent = safeReturnTo(first(params.returnTo));

  return (
    // GAMEDAY (2026-08-28): the same `ReadingFrame` the four measured-paragraph pages use. This
    // page is a title, one sentence and one act, which is exactly the frame's masthead — a fifth
    // hand-rolled `mx-auto max-w-md` column was the reason this surface looked like nobody's
    // product. It carries no prose column at all: there is nothing more to say.
    <ReadingFrame
      title="Sign-in did not go through"
      kicker="Sign in"
      lede="Something interrupted the attempt. Nothing about your account changed."
      intent={intent}
      signedIn={user !== null}
      action={
        <>
          {/* This page's ONE action (law 5), so it is the view's ink pill; the front-door escape
              beside it stays a plain text link. */}
          <SignInLink intent={intent} className={buttonClassName("primary", "md")}>
            Try again
          </SignInLink>
          <Link href="/" className="text-sm font-medium text-text-muted underline transition-colors hover:text-text-primary">
            Go to the front door
          </Link>
        </>
      }
    />
  );
}
