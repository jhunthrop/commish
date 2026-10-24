// The research image's copy of the run reader holds the reader's whole import closure (Lane 76): run
// with `npm test`. The nightly's schema gate (research/nightly/schema_gate.py) imports
// `src/lib/server/run.ts` inside the research image, which carries only what research/Dockerfile's
// `web-contract` stage copies. Lane 66s's reader imported `src/lib/format` and the API's words file,
// neither copied, and the image's gate failed on main. This walks every runtime import from the reader
// and holds each one to the Dockerfile's own COPY lines and pins, read here, so the two cannot drift:
// a new import outside the copies fails this test, not the image job.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const WEB_ROOT = resolve(import.meta.dirname, '../../..');
const REPOSITORY = resolve(WEB_ROOT, '..');
const DOCKERFILE = join(REPOSITORY, 'research/Dockerfile');
const RUN_CONTRACT = join(REPOSITORY, 'research/nightly/contract/run-contract.ts');
const STAGE = 'web-contract';
// The named build contexts the stage copies from (research.yml's build-contexts), by repository path.
const CONTEXTS: Readonly<Record<string, string>> = {
	web: WEB_ROOT,
	api: join(REPOSITORY, 'api'),
	shared: join(REPOSITORY, 'shared')
};
// What the gate imports (run-contract.ts loads the reader), and the type module the stage copies beside it.
const ENTRIES = ['src/lib/server/run.ts', 'src/lib/types/player.ts'];
const LIB_PREFIX = '#lib/';

interface Copy {
	readonly source: string;
	readonly destination: string;
}

interface Stage {
	readonly workdir: string;
	readonly copies: readonly Copy[];
	readonly packages: ReadonlySet<string>;
}

interface Edge {
	readonly from: string;
	readonly specifier: string;
}

/** The Dockerfile's instructions with continuation lines joined. */
function instructions(text: string): string[] {
	return text
		.replace(/\\\n/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'));
}

function contractStage(text: string): Stage {
	const lines = instructions(text);
	const start = lines.findIndex((line) => new RegExp(`^FROM \\S+ AS ${STAGE}$`, 'i').test(line));
	assert.ok(start >= 0, `research/Dockerfile has no ${STAGE} stage`);
	const end = lines.findIndex((line, index) => index > start && /^FROM /i.test(line));
	const body = lines.slice(start + 1, end < 0 ? undefined : end);
	const workdir = body.find((line) => /^WORKDIR /i.test(line))?.split(/\s+/)[1];
	if (!workdir?.startsWith('/')) {
		throw new Error(`the ${STAGE} stage sets no absolute WORKDIR`);
	}
	const copies = body.flatMap((line) => {
		const match = /^COPY --from=(\w+) (\S+) (\S+)$/i.exec(line);
		const context = match?.[1];
		if (!match || context === undefined || !(context in CONTEXTS)) return [];
		const [, , from = '', to = ''] = match;
		return [
			{ source: resolve(CONTEXTS[context] ?? '', from), destination: posix.resolve(workdir, to) }
		];
	});
	const packages = new Set(
		[...body.join('\n').matchAll(/pin\("([^"]+)"\)/g)].map((m) => m[1] ?? '')
	);
	return { workdir, copies, packages };
}

/** Where a repository file sits in the image, or null when no COPY carries it. */
function imagePath(stage: Stage, file: string): string | null {
	for (const copy of stage.copies) {
		const inside = relative(copy.source, file);
		if (inside === '') return copy.destination;
		const directory = existsSync(copy.source) && statSync(copy.source).isDirectory();
		if (directory && !inside.startsWith('..') && !inside.startsWith(sep))
			return posix.join(copy.destination, ...inside.split(sep));
	}
	return null;
}

/** The module's runtime imports: static, re-exports and dynamic; `import type` is erased by node. */
function runtimeImports(file: string): string[] {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const specifiers: string[] = [];
	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) &&
				node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) ||
			(ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier)
		) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
				specifiers.push(node.moduleSpecifier.text);
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			assert.ok(
				argument && ts.isStringLiteral(argument),
				`${file}: a dynamic import of a non-literal`
			);
			specifiers.push(argument.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return specifiers;
}

function isBuiltin(specifier: string): boolean {
	return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

/** The bare package a specifier names (`zod`, `zod/v4`, `@scope/name/x`). */
function packageName(specifier: string): string {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function runtimeModule(): string {
	const match = /const ENV_MODULE = "([^"]+)"/.exec(readFileSync(RUN_CONTRACT, 'utf8'));
	assert.ok(match?.[1], 'run-contract.ts names no ENV_MODULE');
	return match[1];
}

interface Closure {
	readonly files: ReadonlySet<string>;
	readonly escapes: readonly string[];
}

/** Every file reached from the entries, and each import the image cannot answer, as one line each. */
function closure(stage: Stage, entries: readonly string[] = ENTRIES): Closure {
	const answered = runtimeModule();
	const files = new Set<string>();
	const escapes: string[] = [];
	const queue: Edge[] = entries.map((entry) => ({
		from: WEB_ROOT,
		specifier: join(WEB_ROOT, entry)
	}));
	for (let edge = queue.shift(); edge; edge = queue.shift()) {
		const { from, specifier } = edge;
		if (isBuiltin(specifier) || specifier === answered) continue;
		const where = `${relative(REPOSITORY, from) || 'entry'} imports ${specifier}`;
		const local = specifier.startsWith('.') || specifier.startsWith('/');
		if (!local && !specifier.startsWith(LIB_PREFIX)) {
			if (!stage.packages.has(packageName(specifier)))
				escapes.push(`${where}: a package the image does not pin`);
			continue;
		}
		const target = specifier.startsWith(LIB_PREFIX)
			? join(WEB_ROOT, 'src/lib', specifier.slice(LIB_PREFIX.length))
			: resolve(dirname(from), specifier);
		const inImage = imagePath(stage, target);
		if (inImage === null) {
			escapes.push(`${where}: ${relative(REPOSITORY, target)} is not copied`);
			continue;
		}
		const importer = from === WEB_ROOT ? null : imagePath(stage, from);
		const resolvesTo = specifier.startsWith(LIB_PREFIX)
			? posix.join(stage.workdir, 'src/lib', specifier.slice(LIB_PREFIX.length))
			: importer === null
				? inImage
				: posix.resolve(posix.dirname(importer), specifier);
		if (resolvesTo !== inImage)
			escapes.push(`${where}: resolves to ${resolvesTo} in the image, the file is at ${inImage}`);
		if (files.has(target)) continue;
		files.add(target);
		if (target.endsWith('.ts'))
			for (const next of runtimeImports(target)) queue.push({ from: target, specifier: next });
	}
	return { files, escapes };
}

const stage = contractStage(readFileSync(DOCKERFILE, 'utf8'));

void test("every runtime import of the gate's reader is a file the research image copies", () => {
	const { files, escapes } = closure(stage);
	assert.deepEqual(escapes, []);
	assert.ok(
		files.has(join(WEB_ROOT, 'src/lib/run/schema.ts')),
		'the walk never reached the schema'
	);
});

void test('the image pins the packages the reader imports', () => {
	assert.deepEqual([...stage.packages].sort(), ['aws4fetch', 'zod']);
});

void test('the walk refuses an import the image does not carry', () => {
	const narrowed: Stage = {
		...stage,
		copies: stage.copies.filter((copy) => !copy.source.endsWith(join('src', 'lib', 'format')))
	};
	const { escapes } = closure(narrowed);
	assert.ok(
		escapes.some((line) => line.includes('src/lib/format/') && line.endsWith('is not copied')),
		escapes.join('\n')
	);
});

const WORDS = join('internal', 'figurewords', 'words.json');
// The run's word modules (Lane 66s: rest-words, player-words, board-basis) head their figures from the
// API's words file through this module. The reader does not load them today, but they sit in the copied
// run/ beside it, so the image carries the file where this module's import looks for it.
const WORD_TABLE_READER = ['src/lib/format/figure-words.ts'];

void test("the API's words file is copied where the figure words' import resolves in the image", () => {
	const { files, escapes } = closure(stage, WORD_TABLE_READER);
	assert.deepEqual(escapes, []);
	assert.ok(files.has(join(REPOSITORY, 'api', WORDS)));
});

void test("the walk refuses the API's words file left out, or copied where the import does not look", () => {
	const without: Stage = {
		...stage,
		copies: stage.copies.filter((copy) => !copy.source.endsWith(WORDS))
	};
	assert.ok(
		closure(without, WORD_TABLE_READER).escapes.some((line) =>
			line.endsWith('api/internal/figurewords/words.json is not copied')
		)
	);
	const misplaced: Stage = {
		...stage,
		copies: stage.copies.map((copy) =>
			copy.source.endsWith(WORDS)
				? { ...copy, destination: posix.join(stage.workdir, 'api/internal/figurewords/words.json') }
				: copy
		)
	};
	assert.ok(
		closure(misplaced, WORD_TABLE_READER).escapes.some((line) => line.includes('resolves to'))
	);
});

// The writer reads the site's one banned list from the web contract (research/capsules/site_words.py
// LIST_PATH under WEB_CONTRACT_DIR, review 81 finding 6), on import: no reader imports it, so it is
// held here.
const SITE_WORDS = readFileSync(join(REPOSITORY, 'research/capsules/site_words.py'), 'utf8');
const LIST_PATH = /LIST_PATH: Final = Path\("([^"]+)"\)/.exec(SITE_WORDS)?.[1] ?? '';

void test("the site's banned list is copied where the writer reads it in the image", () => {
	// Beside the web's copy, where the repository holds it (shared/words, Lane 171).
	assert.equal(LIST_PATH, '../shared/words/banned-words.json');
	assert.ok(existsSync(join(WEB_ROOT, LIST_PATH)), LIST_PATH);
	assert.equal(imagePath(stage, join(WEB_ROOT, LIST_PATH)), posix.join(stage.workdir, LIST_PATH));
	const without: Stage = {
		...stage,
		copies: stage.copies.filter((copy) => !copy.source.endsWith('banned-words.json'))
	};
	assert.equal(imagePath(without, join(WEB_ROOT, LIST_PATH)), null);
});

void test('the final image keeps the contract stage whole, so its relative paths hold', () => {
	const root = posix.dirname(stage.workdir);
	assert.notEqual(root, '/', `the ${STAGE} stage's WORKDIR sits in a directory of its own`);
	const whole = instructions(readFileSync(DOCKERFILE, 'utf8')).some((line) => {
		const [instruction, from, source] = line.split(/\s+/);
		return instruction === 'COPY' && from === `--from=${STAGE}` && source === root;
	});
	assert.ok(whole, `the final stage copies ${root}, the root of ${STAGE}, whole`);
});

const WORKFLOW = join(REPOSITORY, '.github/workflows/research.yml');
const THIS_TEST = relative(WEB_ROOT, import.meta.filename)
	.split(sep)
	.join(posix.sep);

/** The lines of one job of a workflow, by its two-space key, up to the next job. */
function jobLines(workflow: string, job: string): string[] {
	const lines = workflow.split('\n');
	const start = lines.indexOf(`  ${job}:`);
	assert.notEqual(start, -1, `research.yml has an ${job} job`);
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^ {2}\S/.test(line));
	return end === -1 ? rest : rest.slice(0, end);
}

void test("research.yml's image job runs this test before the image builds (Lane 77)", () => {
	const image = jobLines(readFileSync(WORKFLOW, 'utf8'), 'image');
	const runs = image.findIndex((line) => line.includes(`node --test ${THIS_TEST}`));
	const builds = image.findIndex((line) => line.includes('docker/build-push-action'));
	assert.notEqual(runs, -1, `the image job runs node --test ${THIS_TEST}`);
	assert.ok(runs < builds, 'a COPY change is caught before the image builds');
	assert.ok(
		image.slice(0, runs).some((line) => line.includes('npm ci')),
		'the web packages the test reads (typescript) are installed first'
	);
});
