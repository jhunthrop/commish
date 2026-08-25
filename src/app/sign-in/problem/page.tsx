import Link from "next/link";
import { PageTitle, buttonClassName } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { safeReturnTo } from "@/lib/auth/return-to";

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
  const params = await searchParams;
  const intent = safeReturnTo(first(params.returnTo));

  return (
    <>
      <PublicBar intent={intent} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <PageTitle>Sign-in did not go through</PageTitle>
        <p className="text-text-muted">Something interrupted the attempt. Nothing about your account changed.</p>
        <div className="flex flex-wrap gap-3">
          {/* This page's ONE action (rule 5), so it is the view's ink pill; the front-door
              escape below stays a plain text link. */}
          <SignInLink intent={intent} className={buttonClassName("primary", "md")}>
            Try again
          </SignInLink>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-text-primary underline"
          >
            Go to the front door
          </Link>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
