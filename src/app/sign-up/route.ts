import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/lib/auth/return-to";

/**
 * Sends the user to WorkOS's hosted sign-up. The identical shape as `sign-in/route.ts` over
 * `getSignUpUrl` — see that file's own docblock for why `returnTo` is validated here rather than
 * forwarded as-is.
 */
export async function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  redirect(await getSignUpUrl(returnTo === null ? {} : { returnTo }));
}
