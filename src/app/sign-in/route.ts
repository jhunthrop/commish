import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/** Sends the user to WorkOS's hosted sign-in. Configured as the sign-in endpoint in the WorkOS dashboard. */
export async function GET() {
  redirect(await getSignInUrl());
}
