"use client";

import { Button } from "@/components/ui";
import { openCreateLeagueSheet } from "./create-league-sheet";

/**
 * THE CREATE DOOR, BESIDE THE PAGE'S OWN HEADING (fix round 1, HIGH 2). It used to live only
 * inside `OpenRooms`, which returns `null` when the lobby is empty — so a manager with no leagues
 * and no open house rooms, or one already seated in every room there is, landed on `/app`, saw
 * the title and nothing else, and had no route anywhere in the product to create a league. The
 * three links that promise exactly that delivered them to that blank page.
 *
 * It is the QUIET door at every state (P3: the page's one solid verb belongs to the league that
 * needs this manager, or to the lobby's featured room when there are no leagues at all), and
 * `OpenRooms` keeps its own copy beside the rooms it makes one of — two doors to one act is a
 * placement question, not a competition, because neither is ever solid.
 *
 * A BUTTON, not a link: the create flow is the one bottom sheet the whole signed-in app mounts
 * (`openCreateLeagueSheet`, founder ruling 2026-09-05). The `id` rides the control itself so the
 * fragment lands on the thing it names, and `AppShell`'s `CreateLeagueSheetHost` opens the sheet
 * on hash arrival.
 *
 * `id="create-league"` IS SPELLED AS A LITERAL, deliberately. It is the target of four links
 * across the app (`/browse`, the lobby's own empty state, the league rail's `+`, and the create
 * sheet's signed-out `SignInLink` intent), and `link-integrity.source.test.ts` proves every one of
 * them lands by sweeping source for a literal `id=`. A constant here would read as tidier and
 * would make that sweep blind, which is the opposite of what a link guard is for.
 */
export function CreateLeagueDoor() {
  return (
    <Button id="create-league" variant="secondary" size="sm" onClick={() => openCreateLeagueSheet()}>
      Create a league
    </Button>
  );
}
