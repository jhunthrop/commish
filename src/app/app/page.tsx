import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { Button } from "@/components/ui";

/** Signed-in landing: the one way into the product is the league list. */
export default async function AppHome() {
  const user = await requireCurrentUser();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <h1 className="font-display text-display-md font-bold leading-display text-text-primary">Welcome, {user.displayName}</h1>
      <p className="text-text-muted">{user.email}</p>
      <Link href="/app/leagues" className="text-accent underline">
        Your leagues
      </Link>
      <form action="/sign-out" method="post">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </main>
  );
}
