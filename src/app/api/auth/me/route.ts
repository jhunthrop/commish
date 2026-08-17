import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok } from "@/lib/api/respond";

/** JSON identity check for clients (web fetch, native apps). */
export async function GET() {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  return ok({ user });
}
