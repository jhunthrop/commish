import { z } from "zod";
import { getAuthService, setSessionCookie } from "@/lib/auth/current-user";
import { fail, ok, parseJson } from "@/lib/api/respond";

const LoginBody = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, LoginBody);
  if (!parsed.ok) return parsed.response;

  const result = await getAuthService().login(parsed.value);
  if (!result.ok) return fail(result.reason, 401);

  await setSessionCookie(result.sessionId);
  return ok({ user: result.user });
}
