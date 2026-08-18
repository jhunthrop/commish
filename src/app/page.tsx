import Link from "next/link";
import { PageTitle } from "@/components/ui";

/**
 * The signed-out landing page. One idea, one action: say what this is, then send the visitor
 * to hosted sign-in. Everything after that lives behind `/app`.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <PageTitle size="xl">Commish</PageTitle>
      <p className="max-w-prose text-lg text-text-muted">Season-long fantasy football, done right.</p>
      <Link
        href="/sign-in"
        className={
          "inline-flex h-12 items-center justify-center rounded-md bg-accent px-6 text-lg font-medium text-accent-text transition-colors " +
          "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        }
      >
        Sign in
      </Link>
    </main>
  );
}
