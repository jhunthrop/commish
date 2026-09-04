import { z } from "zod";

/** Every schema the sheet CRUD API validates a request body against
 * (`/api/draft/sheets/**`). Kept beside the service's own types rather than in the route files,
 * the same "the contract lives with the domain, the route just parses" split every other API
 * surface in this codebase keeps. */

const NAME = z.string().trim().min(1, "A sheet needs a name.").max(80, "A sheet's name can be at most 80 characters.");
const NOTE = z.string().trim().max(500, "A note can be at most 500 characters.");
const TAG = z.enum(["target", "avoid", "never"]);

export const createSheetSchema = z.object({
  name: NAME,
  leagueId: z.string().nullish(),
});

export const renameSheetSchema = z.object({ name: NAME });

export const duplicateSheetSchema = z.object({ name: NAME });

export const upsertEntrySchema = z.object({
  playerId: z.string().min(1),
  tierLabel: z.string().trim().max(60).nullish(),
  note: NOTE.nullish(),
  tag: TAG.nullish(),
});

export const reorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1),
});

export const replaceEntriesSchema = z.object({
  entries: z.array(
    z.object({
      playerId: z.string().min(1),
      tierLabel: z.string().trim().max(60).nullish(),
      note: NOTE.nullish(),
      tag: TAG.nullish(),
    }),
  ),
});

export const seedSheetSchema = z.object({
  source: z.enum(["board", "mocks"]),
  /** How many board players to seed when `source` is `"board"` — the evidence board can carry
   *  hundreds of names and a sheet is a working list, not a mirror of the whole board. */
  limit: z.number().int().min(1).max(500).optional(),
});
