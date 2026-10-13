// The build's glyph guard. Every player name a page renders must be drawable by the core font
// subsets, or that page quietly pays for a second font file on first paint. Fails the build naming
// the first glyph outside the subset. Run by npm run build before the SvelteKit build, with the same
// run inputs the build reads (PUBLIC_RUN_ID, PUBLIC_RUN_BASE_URL, and the R2 keys in CI).
import { FIXTURE_PLAYER_NAMES } from '../src/fixtures/mock-2026-ppr.ts';
import { firstUncoveredGlyph } from '../src/lib/ui/fonts/coverage.ts';
import { runConfigFrom } from '../src/lib/run/config.ts';
import { RUN_PATHS, indexSchema } from '../src/lib/run/schema.ts';
import { openRun } from '../src/lib/run/source.ts';

/** A source of names the pages render. */
interface NameSource {
	label: string;
	names: () => Promise<readonly string[]>;
}

async function runNames(): Promise<readonly string[]> {
	const run = await openRun(runConfigFrom(process.env));
	const entries = await run.read(RUN_PATHS.index, indexSchema);
	return entries.map((entry) => entry.name);
}

const SOURCES: readonly NameSource[] = [
	{
		label: 'src/fixtures/mock-2026-ppr.ts',
		names: () => Promise.resolve(FIXTURE_PLAYER_NAMES)
	},
	{
		label: `the run's ${RUN_PATHS.index}`,
		names: runNames
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
