import { requireCurrentUser } from "@/lib/auth/current-user";

/** Signed-in landing. Real dashboard arrives with the league steps; this proves the auth seam. */
export default async function AppHome() {
  const user = await requireCurrentUser();
  return (
    <main>
      <h1>Welcome, {user.displayName}</h1>
      <p>{user.email}</p>
      <form action="/sign-out" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
