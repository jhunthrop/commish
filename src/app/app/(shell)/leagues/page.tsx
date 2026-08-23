import { redirect } from "next/navigation";

/**
 * The league list IS the signed-in home now (`/app`) — one page, not two near-duplicates.
 * The route stays so every old link and bookmark keeps working.
 */
export default function LeaguesPage() {
  redirect("/app");
}
