import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok } from "@/lib/api/respond";

export async function GET() {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  return ok({ user });
}
