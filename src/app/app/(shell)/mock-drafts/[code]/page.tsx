import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * A SHARE LINK MINTED BEFORE THE LOBBY MOVED (2026-09-12). Every code the product has ever put
 * in somebody's hands is `/app/mock-drafts/<code>`; the room it names is unchanged, only the
 * path is, so this hands the code to its new address and nothing else.
 */
export default async function MockShareMoved({ params }: { readonly params: Promise<{ readonly code: string }> }) {
  const { code } = await params;
  permanentRedirect(`/app/draft/mock-drafts/${encodeURIComponent(code)}`);
}
