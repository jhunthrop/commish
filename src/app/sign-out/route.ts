import { signOut } from "@workos-inc/authkit-nextjs";

/** Ends the WorkOS session and clears the sealed cookie, then redirects to "/". */
export async function POST() {
  await signOut({ returnTo: "/" });
}
