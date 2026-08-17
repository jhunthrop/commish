import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/** Sends the user to WorkOS's hosted sign-up. */
export async function GET() {
  redirect(await getSignUpUrl());
}
