import { z } from "zod";

/**
 * `POST /api/notices/read`'s body. Named `noticeIds`, not `ids`, so a rejection names the exact
 * field a caller sent — `parseJson`'s 400 quotes the first Zod issue's path, and a generic `ids`
 * would leave the caller guessing which of several possible bodies this route wanted.
 *
 * At least one id, for the same "a PATCH that asks for nothing is a 400, not a silent success"
 * reasoning `updateProfileSchema` uses (`@/identity-service/schemas`): a bare `{}` or an empty
 * array is a caller mistake worth naming, not a same-shaped no-op `markNoticesRead` would
 * quietly return 0 for anyway.
 */
export const markNoticesReadSchema = z.object({
  noticeIds: z.array(z.string()).min(1, "Send at least one notice id."),
});

export type MarkNoticesReadInput = z.infer<typeof markNoticesReadSchema>;
