import { ImageResponse } from "next/og";
import { TOKENS } from "@/design/tokens";
import { TAGLINE } from "@/components/app-shell/page-metadata";

/**
 * THE LINK-UNFURL CARD. Renders once per build (no dynamic segment here, so Next serves this
 * statically), which is exactly right: an unfurl is read by a crawler with no theme preference of
 * its own, so it always wears the dark colorway — the one the founder ships as the flagship —
 * regardless of the viewer's own `data-theme` (`docs/design-system.md`; the theme system's swap
 * only ever applies to a live page).
 *
 * Every color below is a NAME from `TOKENS.color.dark`, not a literal — this file lives under
 * `src/app`, one of the directories `no-raw-color.source.test.ts` sweeps, and the rule ("tokens.ts
 * is the only file allowed to invent a color") applies here exactly as it does to any component.
 * It also keeps this card from silently drifting from the product's own dark palette the next
 * time that palette is re-solved.
 */

const dark = TOKENS.color.dark;

export const alt = "Commish";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: dark.surface,
        }}
      >
        {/* The whistle, transcribed verbatim from the design asset's paths (`commish-mark.svg`)
            and recolored to the dark palette by name, same as `BrandMark` does for the live app. */}
        <svg width={130} height={100} viewBox="0 0 260 200">
          <path
            d="M100 34 l88 0 a16 16 0 0 1 16 16 l0 42 a16 16 0 0 1 -16 16 l-24 0 a66 66 0 1 1 -64 -74z"
            fill={dark.surfaceRaised}
            stroke={dark.textPrimary}
            strokeWidth={10}
            strokeLinejoin="round"
          />
          <circle cx={26} cy={80} r={14} fill="none" stroke={dark.textPrimary} strokeWidth={10} />
          <rect x={140} y={40} width={30} height={12} rx={4} fill={dark.accent} />
          <circle cx={100} cy={112} r={38} fill={dark.accent} />
        </svg>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 800, color: dark.textPrimary }}>
          Commish
          <span style={{ color: dark.accent }}>.</span>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: dark.textMuted }}>{TAGLINE}</div>
      </div>
    ),
    { ...size },
  );
}
