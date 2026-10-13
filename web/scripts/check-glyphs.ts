// The build's glyph guard. Every player name a page renders must be drawable by the core font
// subsets, or that page quietly pays for a second font file on first paint. Fails the build naming
// the first glyph outside the subset. Run by npm run build before the SvelteKit build.
import { FIXTURE_PLAYER_NAMES } from '../src/fixtures/mock-2026-ppr.ts';
import { firstUncoveredGlyph } from '../src/lib/ui/fonts/coverage.ts';

/** A source of names the pages render. The nightly run's index.json joins this list when the
 * board lane reads it, through the same check. */
interface NameSource {
	label: string;
	names: () => Promise<readonly string[]>;
}

const SOURCES: readonly NameSource[] = [
	{
		label: 'src/fixtures/mock-2026-ppr.ts',
		names: () => Promise.resolve(FIXTURE_PLAYER_NAMES)
	}
];

export async function checkGlyphs(sources: readonly NameSource[]): Promise<void> {
	for (const source of sources) {
		const names = await source.names();
		const miss = firstUncoveredGlyph(names);
		if (miss) {
			throw new Error(
				`Glyph guard: "${miss.glyph}" (${miss.codePoint}) in "${miss.text}" from ${source.label} is outside the core font subset. Widen src/lib/ui/fonts/coverage.ts and run npm run fonts.`
			);
		}
		process.stdout.write(
			`Glyph guard: ${String(names.length)} names from ${source.label} covered.\n`
		);
	}
}

await checkGlyphs(SOURCES);
