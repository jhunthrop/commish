/**
 * THE SIMULATOR CLIENT'S OWN COPY of the two closed sets `src/draft-service/sim/config.ts`
 * defines (`SIM_RUN_OPTIONS`, `SIM_SHARPNESS`) — duplicated here, not imported, because
 * `simulator-client.tsx` is a `"use client"` component and `@/draft-service` is this codebase's
 * server-only module group (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`; see
 * `src/mock-draft/config.ts`'s own docblock for the identical reasoning applied to a directory
 * that DOES carry a secret — this one carries none, but the boundary is drawn at the DIRECTORY,
 * not per-file, so the client reads its own copy rather than reaching across it).
 *
 * NEVER DRIFTS SILENTLY: `constants.test.ts` pins both of these byte-for-byte against the
 * service's own values, so a future change to either set fails a test rather than quietly
 * showing the user options the server would reject.
 */
export const SIM_RUN_OPTIONS = [100, 1_000, 10_000] as const;

/** How tightly the room drafts to ADP: casual reaches, sharp takes the board in ADP order. */
export const SIM_SHARPNESS = { casual: 0, mixed: 0.5, sharp: 1 } as const;
export type SimSharpnessName = keyof typeof SIM_SHARPNESS;

export const SIM_SHARPNESS_OPTIONS: readonly { readonly value: SimSharpnessName; readonly label: string }[] = [
  { value: "casual", label: "Casual" },
  { value: "mixed", label: "Mixed" },
  { value: "sharp", label: "Sharp" },
];
