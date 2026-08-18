"use client";

import { useRouter } from "next/navigation";
import { CreateLeagueForm } from "./create-league-form";

/** The one client wrapper that knows where to go after a league is created. */
export function CreateLeaguePanel() {
  const router = useRouter();
  return (
    <CreateLeagueForm
      onCreated={(created) => {
        router.refresh();
        router.push(`/app/leagues/${created.leagueId}`);
      }}
    />
  );
}
