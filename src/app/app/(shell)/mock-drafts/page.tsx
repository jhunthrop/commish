import { redirect, permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * THE MOCK LOBBY MOVED UNDER THE DRAFT AREA (2026-09-12). Practice belongs beside the board and
 * the sheet, under one word, so the lobby is now the Draft area's third stop. This route stays
 * behind as a redirect and nothing else: every share link the product has ever minted points at
 * `/app/mock-drafts/<code>`, texted to people who have no idea a nav changed, and a link that
 * 404s is a room somebody cannot get into.
 *
 * `?create=solo` survives the hop (`DraftRoom`'s own restart contract) — a query dropped here
 * would silently turn "start me another one" into "show me a lobby".
 */
export default async function MockDraftsMoved({ searchParams }: { readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>> }) {
  const params = await searchParams;
  const create = params.create;
  const solo = (typeof create === "string" ? create : create?.[0]) === "solo";
  // A query-carrying hop is a temporary one: the destination differs by request, and a browser
  // that cached a permanent redirect for this path would carry the wrong query forever.
  if (solo) redirect("/app/draft/mock-drafts?create=solo");
  permanentRedirect("/app/draft/mock-drafts");
}
