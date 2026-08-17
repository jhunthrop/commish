import { z } from "zod";
import { getAuthService, setSessionCookie } from "@/lib/auth/current-user";
import { AUTH_CONFIG } from "@/lib/auth/config";
import { fail, ok, parseJson } from "@/lib/api/respond";

const RegisterBody = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(AUTH_CONFIG.minPasswordLength, `Password must be at least ${AUTH_CONFIG.minPasswordLength} characters.`),
  displayName: z.string().trim().min(1, "Choose a display name.").max(40, "Display name must be 40 characters or fewer."),
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, RegisterBody);
  if (!parsed.ok) return parsed.response;

  const result = await getAuthService().register(parsed.value);
  if (!result.ok) return fail(result.reason, 409);

  await setSessionCookie(result.sessionId);
  return ok({ user: result.user }, { status: 201 });
}
