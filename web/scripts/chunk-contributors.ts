// Which source files make up a built chunk, by the share of its characters each one's code takes.
// Needs source maps, which the shipped build does not write:
//   npx vite build --sourcemap && node scripts/chunk-contributors.ts [chunk-file-prefix] [top]
// The prefix may name a route node (nodes/36) or an entry (entry/app) instead. With none it takes the
// largest chunk. The gzipped size of the chunk is split by those shares,
// so the figures are an estimate that adds up to the real file.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decode } from '@jridgewell/sourcemap-codec';

const IMMUTABLE = '.svelte-kit/output/client/_app/immutable';
const CHUNKS = join(IMMUTABLE, 'chunks');
const DEFAULT_TOP = 25;

interface SourceMap {
	sources: string[];
	mappings: string;
}

function chunkFile(prefix: string | undefined): string {
	if (prefix?.includes('/')) return findIn(join(IMMUTABLE, dirname(prefix)), basename(prefix));
	return findIn(CHUNKS, prefix);
}

function findIn(dir: string, prefix: string | undefined): string {
	const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
	if (prefix) {
		const match = files.find((name) => name.startsWith(prefix));
		if (!match) throw new Error(`No file in ${dir} starts with ${prefix}`);
		return join(dir, match);
	}
	const bySize = files.map((name) => [name, statSync(join(dir, name)).size] as const);
	const largest = bySize.sort((a, b) => b[1] - a[1])[0];
	if (!largest) throw new Error(`No files in ${dir}`);
	return join(dir, largest[0]);
}

function charactersBySource(code: string, map: SourceMap): Map<string, number> {
	const lines = code.split('\n');
	const totals = new Map<string, number>();
	decode(map.mappings).forEach((segments, lineIndex) => {
		const lineLength = lines[lineIndex]?.length ?? 0;
		segments.forEach((segment, index) => {
			const sourceIndex = segment[1];
			if (sourceIndex === undefined) return;
			const end = segments[index + 1]?.[0] ?? lineLength;
			const name = map.sources[sourceIndex] ?? 'unknown';
			totals.set(name, (totals.get(name) ?? 0) + Math.max(0, end - segment[0]));
		});
	});
	return totals;
}

const file = chunkFile(process.argv[2]);
const top = Number(process.argv[3] ?? DEFAULT_TOP);
const code = readFileSync(file, 'utf8');
const map = JSON.parse(readFileSync(`${file}.map`, 'utf8')) as SourceMap;
const gzipTotal = gzipSync(code).length;
const totals = charactersBySource(code, map);
const mapped = [...totals.values()].reduce((sum, value) => sum + value, 0);
process.stdout.write(
	`${basename(file)}: ${String(code.length)} B raw, ${String(gzipTotal)} B gz\n`
);
const ranked = [...totals].sort((a, b) => b[1] - a[1]).slice(0, top);
for (const [source, characters] of ranked) {
	const share = Math.round((characters / mapped) * gzipTotal);
	process.stdout.write(
		`${String(share).padStart(6)} B gz  ${String(characters).padStart(6)} raw  ${source.replace(/^(\.\.\/)+/, '')}\n`
	);
}
