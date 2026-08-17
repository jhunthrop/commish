export type ThemeName = "light" | "dark";

export type ColorRole =
  | "surface"
  | "surfaceElevated"
  | "border"
  | "textPrimary"
  | "textMuted"
  | "accent"
  | "accentText"
  | "positive"
  | "negative"
  | "negativeText"
  | "warning"
  | "scrim";

type Palette = Readonly<Record<ColorRole, string>>;

const light: Palette = {
  surface: "#F4F6F5",
  surfaceElevated: "#FFFFFF",
  border: "#6B7D75",
  textPrimary: "#171B19",
  textMuted: "#586159",
  accent: "#0B6B47",
  accentText: "#FFFFFF",
  // Hue ≈105° (leaf/grass green) — deliberately distinct from accent's ≈158° teal-green
  // so "good outcome" (positive) never reads as the same color as the brand/interactive accent.
  positive: "#2A6E14",
  negative: "#B0342A",
  negativeText: "#FFFFFF",
  warning: "#8A5A00",
  /** Modal backdrop overlay. Not text — excluded from the contrast-on-surface checks below. */
  scrim: "#0F1412",
};

const dark: Palette = {
  surface: "#0F1412",
  surfaceElevated: "#171D1A",
  border: "#5C6A62",
  textPrimary: "#ECEFEC",
  textMuted: "#A3AEA7",
  accent: "#4FC08D",
  accentText: "#0B1A12",
  // Hue ≈94° (leaf/grass green) — deliberately distinct from accent's ≈153° teal-green.
  positive: "#8FD35A",
  negative: "#F07C70",
  negativeText: "#2A0F0C",
  warning: "#E5B054",
  scrim: "#000000",
};

export const TOKENS = {
  color: { light, dark },
  /** 4px-based spacing scale, px. */
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 },
  font: {
    /** px */
    size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, "2xl": 28, "3xl": 36 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeight: { tight: 1.2, base: 1.5 },
  },
  motion: {
    /** ms */
    duration: { fast: 120, base: 200, slow: 320 },
    easing: { standard: "cubic-bezier(0.2, 0, 0, 1)", emphasized: "cubic-bezier(0.3, 0, 0, 1)" },
  },
  /** Minimum supported viewport width, px (mobile-first baseline). */
  minViewport: 360,
} as const;
