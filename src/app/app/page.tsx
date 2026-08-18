import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { Button, PageTitle } from "@/components/ui";

/** Signed-in landing: the one way into the product is the league list. */
export default async function AppHome() {
  const user = await requireCurrentUser();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <PageTitle>Welcome, {user.displayName}</PageTitle>
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
