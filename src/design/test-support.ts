/**
 * Test support for the design-token GATE: the WCAG contrast/hue math `tokens.test.ts` asserts
 * the palette against, and the source-file walker `no-raw-color.source.test.ts` uses to find
 * what it sweeps. Test-only despite living in `src/design`: no production code computes a
 * contrast ratio or walks the filesystem at runtime, so this follows the repo's
 * `test-support.ts` naming convention rather than reading as a production module (was
 * `contrast.ts`).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex: string): readonly [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`Expected a hex color like #1a2b3c, got "${hex}".`);
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 .. 21. Order of arguments doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Standard RGB→HSL hue, degrees, 0 (inclusive) .. 360 (exclusive). Gray (zero saturation) is 0. */
export function hueDegrees(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** Shortest arc between two hues (degrees), 0 .. 180. */
export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const REPO_ROOT = process.cwd();

/**
 * Every non-test source file under the given repo-root-relative directories, recursively, with
 * the given extension. Paths come back repo-root-relative, so a failure names its own file.
 *
 * Directory-derived on purpose, the same reasoning `src/integrity/test-support.ts`'s copy
 * sweeps already established: a hand-maintained list of files misses the one nobody remembered
 * to add, and a walker sweeps a new component the moment it exists.
 */
export function sourceFilesIn(dirs: readonly string[], extension: string): readonly string[] {
  function walk(dir: string): readonly string[] {
    const full = join(REPO_ROOT, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!entry.name.endsWith(extension) || entry.name.includes(".test.") || entry.name.startsWith("test-")) return [];
      return [path];
    });
  }
  return dirs.flatMap(walk);
}
