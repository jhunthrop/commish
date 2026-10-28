/** The shared sources' drift check: regenerates every file the shared generators write (the tokens,
 * the words, the fixtures, the mark, the readers' parity, the iOS client's spec) into a temp dir and
 * compares each, byte for byte, with the file in the repository, which git must track. A generated
 * file edited by hand, one never regenerated after its source changed, one missing, untracked, or left behind in a generated folder fails it: it prints
 * each path and exits 1. `make -C api check-gen` runs it in CI, `npm run check:shared` in web/.
 *
 *   node shared/scripts/check-gen.ts */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { generate as exportFixtures } from './export-fixtures.ts';
import { generate as genMark } from './gen-mark.ts';
import { generate as exportParity } from './export-parity.ts';
import { generate as exportRun } from './export-run.ts';
import { generate as exportRecord } from './export-record.ts';
import { generate as genOpenapi } from '../../apps/ios/scripts/gen-openapi.ts';
import { generate as genTokens } from './gen-tokens.ts';
import { generate as genWords } from './gen-words.ts';
import { REPOSITORY, writeOutputs, type Outputs } from './generated.ts';

/** Folders whose every file a generator writes, so a file in them it did not write is stale. */
const GENERATED_FOLDERS = [
	'shared/fixtures',
	'shared/fixtures/inseason',
	'shared/fixtures/parity',
	'shared/fixtures/record'
];
/** Folders whose every file, at any depth, a generator writes: the fixture run's bucket layout. */
const GENERATED_TREES = [
	'shared/fixtures/run',
	'shared/fixtures/build-run',
	'shared/fixtures/one-value-run'
];

export interface Drift {
	path: string;
	why: 'differs' | 'missing' | 'untracked' | 'stale';
}

async function readOrNull(file: string): Promise<string | null> {
	try {
		return await readFile(file, 'utf8');
	} catch {
		return null;
	}
}

function tracked(paths: readonly string[], root: string): Set<string> {
	const listed = execFileSync('git', ['ls-files', '-z', '--', ...paths], {
		cwd: root,
		encoding: 'utf8'
	});
	return new Set(listed.split('\0').filter((path) => path !== ''));
}

/** Every way the repository at `root` differs from what the generators wrote into `fresh`. */
export async function drift(
	outputs: Outputs,
	fresh: string,
	root: string = REPOSITORY
): Promise<Drift[]> {
	const paths = [...outputs.keys()];
	const inGit = tracked(paths, root);
	const found: Drift[] = [];
	for (const path of paths) {
		const committed = await readOrNull(join(root, path));
		const regenerated = await readFile(join(fresh, path), 'utf8');
		if (committed === null) found.push({ path, why: 'missing' });
		else if (committed !== regenerated) found.push({ path, why: 'differs' });
		else if (!inGit.has(path)) found.push({ path, why: 'untracked' });
	}
	for (const folder of GENERATED_FOLDERS) {
		const entries = await readdir(join(root, folder), {
			withFileTypes: true
		}).catch(() => []);
		for (const entry of entries) {
			const path = `${folder}/${entry.name}`;
			if (entry.isFile() && !outputs.has(path)) found.push({ path, why: 'stale' });
		}
	}
	for (const tree of GENERATED_TREES) {
		const entries = await readdir(join(root, tree), {
			recursive: true,
			withFileTypes: true
		}).catch(() => []);
		for (const entry of entries) {
			const path = relative(root, join(entry.parentPath, entry.name));
			if (entry.isFile() && !outputs.has(path)) found.push({ path, why: 'stale' });
		}
	}
	return found;
}

async function main(): Promise<number> {
	const outputs: Outputs = new Map([
		...(await genTokens()),
		...(await genWords()),
		...(await exportFixtures()),
		...(await genMark()),
		...(await exportParity()),
		...(await exportRun()),
		...(await exportRecord()),
		...(await genOpenapi())
	]);
	const fresh = await mkdtemp(join(tmpdir(), 'commish-check-gen-'));
	try {
		await writeOutputs(outputs, fresh);
		const found = await drift(outputs, fresh);
		if (found.length === 0) {
			process.stdout.write(
				`check-gen: ${String(outputs.size)} shared generated files match their sources\n`
			);
			return 0;
		}
		process.stderr.write(
			'check-gen: generated files differ from their sources (run `npm run gen:shared` in web/):\n'
		);
		for (const { path, why } of found) process.stderr.write(`  ${why}: ${path}\n`);
		return 1;
	} finally {
		await rm(fresh, { recursive: true, force: true });
	}
}

if (import.meta.main) process.exitCode = await main();
