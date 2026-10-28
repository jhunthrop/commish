// The API's /run routes (Lane 185, and Lane 188's pages, held pages, record, clubs and schedule)
// against the run's own contract: each Run schema of api/openapi.yaml names the fields this file's zod
// schema does, each one optional and nullable exactly where the zod schema has it and its enum the same
// values, less the provenance the API never sends; and every /run route's example parses with the zod
// schema and names no member, at any depth, its API schema does not, so the apps' contract and the
// web's cannot drift apart. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { z } from 'zod';
import { POSITIONS } from '#lib/types/player.ts';
import { scheduleKickoffs, standingByline } from '#lib/player/read-byline.ts';
import { MARKET_POSITIONS, splitIndex } from './market.ts';
import { runReach } from './reach.ts';
import {
	RUN_PATHS,
	adpSchema,
	adpSourceSchema,
	boardRowSchema,
	boardSchema,
	capsuleSchema,
	clubSchema,
	designationsSchema,
	draftLineSchema,
	draftRecordSchema,
	formatSchema,
	gameSchema,
	heldPageSchema,
	heldSchema,
	indexEntrySchema,
	indexSchema,
	indexSeasonSchema,
	manifestSchema,
	marketEntrySchema,
	marketRowSchema,
	placedPlayerSchema,
	playerFormatSchema,
	playerSchema,
	playerStatusSchema,
	pullFigureSchema,
	reachPartialSchema,
	reachSchema,
	recordLineSchema,
	recordSchema,
	recordWeekSchema,
	restSlateSchema,
	scheduleSchema,
	scoreSchema,
	slateSchema,
	readsDueSchema,
	weekReadSchema,
	weeklyRecordSchema,
	type WeekRead,
	windowSchema
} from './schema.ts';
import { gameLogRowSchema, priorSeasonSchema, seasonSchema, statLineSchema } from './season.ts';

interface Property {
	$ref?: string;
	allOf?: Property[];
	enum?: unknown[];
	nullable?: boolean;
	type?: string;
	items?: Property;
	additionalProperties?: Property | boolean;
}

interface ObjectSchema extends Property {
	required?: string[];
	properties: Record<string, Property>;
}

interface Spec {
	paths: Record<string, { get: { responses: Record<string, Example> } }>;
	components: { schemas: Record<string, ObjectSchema> };
}

interface Example {
	content?: { 'application/json'?: { example?: { data?: Record<string, unknown> } } };
}

const SCHEMAS_REF = '#/components/schemas/';
const spec = parse(
	readFileSync(new URL('../../../../api/openapi.yaml', import.meta.url), 'utf8')
) as Spec;
const { schemas } = spec.components;

type AnyObject = z.ZodObject<z.ZodRawShape>;

/** Each Run schema with its zod schema and the members the API withholds (provenance, never sent). */
const MIRRORS: Record<string, { zod: AnyObject; withheld?: string[] }> = {
	RunWindow: { zod: windowSchema },
	RunFormat: { zod: formatSchema },
	RunManifest: { zod: manifestSchema, withheld: ['sources'] },
	// The season reach the nightly writes into the manifest (Lane 205).
	RunReach: { zod: reachSchema },
	RunReachPartial: { zod: reachPartialSchema },
	RunBoardRow: { zod: boardRowSchema },
	RunMarketRow: { zod: marketRowSchema },
	RunIndexSeason: { zod: indexSeasonSchema },
	RunIndexEntry: { zod: indexEntrySchema },
	RunMarketEntry: { zod: marketEntrySchema },
	RunAdpSource: { zod: adpSourceSchema },
	RunAdp: { zod: adpSchema },
	RunPlayerStatus: { zod: playerStatusSchema },
	RunDesignations: { zod: designationsSchema, withheld: ['source'] },
	// A player's page (Lane 188), its season block's shapes from season.ts.
	RunPlayer: { zod: playerSchema },
	RunPlayerFormat: { zod: playerFormatSchema },
	RunCapsule: { zod: capsuleSchema },
	RunPullFigure: { zod: pullFigureSchema },
	RunWeekRead: { zod: weekReadSchema },
	RunReadsDue: { zod: readsDueSchema },
	RunSeason: { zod: seasonSchema },
	RunStatLine: { zod: statLineSchema },
	RunGameLogRow: { zod: gameLogRowSchema },
	RunPriorSeason: { zod: priorSeasonSchema },
	RunLastGameClub: { zod: lastGameClubSchema() },
	// The held pages, less what the reader said of each (the run's report).
	RunHeld: { zod: heldSchema },
	RunHeldPage: { zod: heldPageSchema, withheld: ['refusal'] },
	RunHeldCopy: { zod: heldCopySchema() },
	// The record.
	RunRecord: { zod: recordSchema },
	RunRecordStatistic: { zod: recordSchema.shape.statistic },
	RunScore: { zod: scoreSchema },
	RunRecordLine: { zod: recordLineSchema },
	RunPlacedPlayer: { zod: placedPlayerSchema },
	RunRecordWeek: { zod: recordWeekSchema },
	RunWeeklyRecord: { zod: weeklyRecordSchema },
	RunDraftRecord: { zod: draftRecordSchema },
	RunDraftLine: { zod: draftLineSchema },
	RunDraftProgress: { zod: draftRecordSchema.shape.progress.element },
	// The clubs and the schedule.
	RunClub: { zod: clubSchema },
	RunSchedule: { zod: scheduleSchema },
	RunSlate: { zod: slateSchema },
	RunGame: { zod: gameSchema },
	RunRestSlate: { zod: restSlateSchema }
};

/** The object a nullable, optional field holds, under its wrappers. */
function objectOf(field: z.ZodType): AnyObject {
	const { def } = (field as unknown as Schema)._zod;
	if (def.type === 'object') return field as unknown as AnyObject;
	assert.ok(def.innerType, `a ${def.type} holds no object`);
	return objectOf(def.innerType as unknown as z.ZodType);
}

function lastGameClubSchema(): AnyObject {
	return objectOf(playerSchema.shape.lastGameClub);
}

function heldCopySchema(): AnyObject {
	return objectOf(heldPageSchema.shape.copy);
}

/** The answers' wrappers (their run id and the file's members) and the enums, held below. */
const WRAPPERS = new Set([
	'RunManifestAnswer',
	'RunBoardAnswer',
	'RunIndexAnswer',
	'RunAdpAnswer',
	'RunDesignationsAnswer',
	'RunPlayerAnswer',
	'RunHeldAnswer',
	'RunRecordAnswer',
	'RunClubsAnswer',
	'RunScheduleAnswer',
	'RunPosition',
	'RunMarketPosition',
	'RunRecordPosition',
	'RunGameStatus',
	'RunRecordWeekStatus',
	'RunGameState'
]);

interface Def {
	type: string;
	innerType?: Schema;
	entries?: Record<string, string>;
	values?: unknown[];
}

interface Schema {
	_zod: { def: Def };
}

/** The values an enum or a literal field takes, under its optional and nullable wrappers; null when
 * the field is neither. */
function zodValues(field: Schema): unknown[] | null {
	const { def } = field._zod;
	if (def.type === 'enum') return Object.values(def.entries ?? {});
	if (def.type === 'literal') return def.values ?? [];
	return def.innerType ? zodValues(def.innerType) : null;
}

/** The schema a $ref names. */
function named(ref: string): ObjectSchema {
	assert.ok(ref.startsWith(SCHEMAS_REF), ref);
	const schema = schemas[ref.slice(SCHEMAS_REF.length)];
	assert.ok(schema, ref);
	return schema;
}

/** A property's enum, inline, through its $ref, or through a nullable allOf's. */
function specValues(property: Property): unknown[] | null {
	if (property.enum) return property.enum;
	if (property.$ref) return named(property.$ref).enum ?? null;
	const [only] = property.allOf ?? [];
	return only ? specValues(only) : null;
}

/** A field that is always true when sent (zod's literal true) is a boolean on the wire: the apps'
 * generators take no boolean enum. */
const isTrueLiteral = (values: readonly unknown[]): boolean =>
	values.length > 0 && values.every((value) => value === true);

const sorted = (values: readonly unknown[]): string[] => values.map(String).sort();

void test('every Run schema of the API is mirrored here or is an answer wrapper', () => {
	const run = Object.keys(schemas).filter((name) => name.startsWith('Run'));
	for (const name of run) assert.ok(name in MIRRORS || WRAPPERS.has(name), name);
	for (const name of Object.keys(MIRRORS)) assert.ok(name in schemas, name);
});

void test("each Run schema names the zod schema's fields, optional and nullable where it has them", () => {
	for (const [name, { zod, withheld = [] }] of Object.entries(MIRRORS)) {
		const schema = schemas[name];
		assert.ok(schema, name);
		const fields = Object.entries(zod.shape as Record<string, z.ZodType>).filter(
			([key]) => !withheld.includes(key)
		);
		assert.deepEqual(
			Object.keys(schema.properties).sort(),
			fields.map(([key]) => key).sort(),
			`${name}'s fields`
		);
		const required = new Set(schema.required ?? []);
		for (const [key, field] of fields) {
			const property: Property | undefined = schema.properties[key];
			const where = `${name}.${key}`;
			assert.ok(property, where);
			assert.equal(required.has(key), !field.safeParse(undefined).success, `${where} required`);
			assert.equal(property.nullable === true, field.safeParse(null).success, `${where} nullable`);
			const values = zodValues(field);
			const listed = specValues(property);
			if (values !== null && isTrueLiteral(values)) {
				assert.equal(property.type, 'boolean', `${where} is a boolean`);
			} else if (values !== null && values.length > 0 && values.some((v) => v !== null)) {
				assert.deepEqual(sorted(listed ?? []), sorted(values), `${where} values`);
			}
		}
	}
});

void test('the position enums are the run format positions', () => {
	assert.deepEqual(sorted(schemas.RunPosition?.enum ?? []), sorted(POSITIONS));
	assert.deepEqual(sorted(schemas.RunMarketPosition?.enum ?? []), sorted(MARKET_POSITIONS));
	// A record line's position is a position or All (a union, which the field check passes by).
	assert.deepEqual(sorted(schemas.RunRecordPosition?.enum ?? []), sorted([...POSITIONS, 'All']));
	for (const line of [recordLineSchema, draftLineSchema]) {
		for (const value of [...POSITIONS, 'All']) {
			assert.ok(line.shape.position.safeParse(value).success, value);
		}
	}
});

/** A /run route's 200 example's data. */
function exampleData(route: string): Record<string, unknown> {
	const data =
		spec.paths[route]?.get.responses['200']?.content?.['application/json']?.example?.data;
	assert.ok(data, `${route} has an example`);
	assert.equal(typeof data.run_id, 'string', `${route}'s example names its run`);
	return data;
}

const list = (value: unknown): unknown[] => {
	assert.ok(Array.isArray(value));
	return value;
};

void test("each /run route's example parses with the run's zod schema, with no field it does not name", () => {
	const manifest = exampleData('/run/manifest');
	manifestSchema.omit({ sources: true }).strict().parse(manifest.manifest);

	const board = exampleData('/run/boards/{format}');
	const rows = list(board.rows);
	const market = list(board.market);
	for (const row of rows) boardRowSchema.strict().parse(row);
	for (const row of market) marketRowSchema.strict().parse(row);
	boardSchema.parse({ format: board.format, rows: [...rows, ...market] });

	const index = exampleData('/run/index');
	const pages = list(index.pages);
	const entries = list(index.market);
	for (const entry of pages) indexEntrySchema.strict().parse(entry);
	for (const entry of entries) marketEntrySchema.strict().parse(entry);
	indexSchema.parse([...pages, ...entries]);

	adpSchema.strict().parse(exampleData('/run/adp').adp);

	designationsSchema
		.omit({ source: true })
		.strict()
		.parse(exampleData('/run/designations').designations);
});

void test("the board's example carries every field the Board draws", () => {
	const [row] = list(exampleData('/run/boards/{format}').rows) as Record<string, unknown>[];
	for (const key of ['tier', 'tierDrop', 'ourRank', 'vorRound', 'adp', 'gap', 'restFromWeek']) {
		assert.ok(row && key in row, key);
	}
	const [format] = list(
		(exampleData('/run/manifest').manifest as Record<string, unknown>).formats
	) as Record<string, unknown>[];
	for (const key of ['rosFromWeek', 'rosFromWeekPartial', 'refreshedAt', 'marketOrder']) {
		assert.ok(format && key in format, key);
	}
});

/** The object schemas a property may hold: its own, its $ref's, or its nullable allOf's. */
function resolve(property: Property): Property {
	if (property.$ref) return named(property.$ref);
	const [only] = property.allOf ?? [];
	return only ? resolve(only) : property;
}

/** Every member of value, at every depth, is one its API schema names: the zod parse holds what each
 * value is, this holds that the API's contract names it, so an example cannot carry a field the apps'
 * decoders were never told of. */
function assertNamed(value: unknown, property: Property, where: string): void {
	if (value === null || typeof value !== 'object') return;
	const schema = resolve(property);
	if (Array.isArray(value)) {
		const { items } = schema;
		assert.ok(items, `${where} is a list`);
		value.forEach((item: unknown, i) => {
			assertNamed(item, items, `${where}[${String(i)}]`);
		});
		return;
	}
	const members = Object.entries(value as Record<string, unknown>);
	const { additionalProperties } = schema;
	if (typeof additionalProperties === 'object') {
		for (const [key, member] of members) {
			assertNamed(member, additionalProperties, `${where}.${key}`);
		}
		return;
	}
	const { properties } = schema as Partial<ObjectSchema>;
	assert.ok(properties, `${where} is an object`);
	for (const [key, member] of members) {
		const inner = properties[key];
		assert.ok(inner, `${where}.${key} is not in the API's schema`);
		assertNamed(member, inner, `${where}.${key}`);
	}
}

/** A route's 200 example, its data held at every depth to the answer's API schema. */
function namedExample(route: string, answer: string): Record<string, unknown> {
	const data = exampleData(route);
	assertNamed(data, { $ref: `${SCHEMAS_REF}${answer}` }, route);
	return data;
}

void test("Lane 188's examples parse with the run's zod schemas and name nothing the API does not", () => {
	const { player } = namedExample('/run/players/{id}', 'RunPlayerAnswer');
	playerSchema.strict().parse(player);

	const { held } = namedExample('/run/held', 'RunHeldAnswer');
	const pages = list((held as { pages?: unknown }).pages);
	// The API withholds each page's refusal: the run's report, never on a screen.
	heldSchema.parse({ pages: pages.map((page) => ({ ...(page as object), refusal: 'withheld' })) });
	for (const page of pages) heldPageSchema.omit({ refusal: true }).strict().parse(page);

	const { record } = namedExample('/run/record', 'RunRecordAnswer');
	recordSchema.strict().parse(record);

	// The examples carry two of the 32 clubs and slates, so the files' lengths are not held here.
	const { clubs } = namedExample('/run/clubs', 'RunClubsAnswer');
	for (const club of list(clubs)) clubSchema.strict().parse(club);
	const { schedule } = namedExample('/run/schedule', 'RunScheduleAnswer');
	const { slates, ...rest } = schedule as { slates: unknown };
	const parsed = list(slates).map((slate) => slateSchema.strict().parse(slate));
	const top = z.object(scheduleSchema.shape).omit({ slates: true }).strict().parse(rest);
	for (const game of parsed.flatMap((slate) => slate.games)) {
		assert.ok(game.opponent in top.opponentValues, `${game.opponent} has a value`);
	}
});

void test("the player's and the record's examples carry every optional block the apps draw", () => {
	const { player } = exampleData('/run/players/{id}') as { player: Record<string, unknown> };
	for (const key of ['capsule', 'weekRead', 'priorSeasons', 'lastGameClub']) {
		assert.ok(player[key] !== undefined && player[key] !== null, key);
	}
	const { record } = exampleData('/run/record') as { record: Record<string, unknown> };
	for (const key of ['weekly', 'draft']) assert.ok(record[key], key);
	const statuses = new Set(list(record.weeks).map((week) => (week as { status: string }).status));
	for (const status of ['graded', 'frozen', 'missed']) assert.ok(statuses.has(status), status);
});

void test("the read's byline is drawn from the API's answers alone, as the apps draw it (Lane 222)", () => {
	// The write's stamp rides on /run/players; the status read the byline names is /run/designations' check,
	// newer than the write; the next read is from /run/schedule's kickoffs, on the morning of its home game
	// (the examples' dates are each their own: the case holds the composition, not one day's run).
	const { player } = exampleData('/run/players/{id}') as { player: { weekRead: WeekRead } };
	const read = weekReadSchema.parse(player.weekRead);
	const { designations } = exampleData('/run/designations') as { designations: unknown };
	const capture = designationsSchema.omit({ source: true }).parse(designations);
	const { schedule } = exampleData('/run/schedule') as { schedule: { slates: unknown } };
	const slates = list(schedule.slates).map((slate) => slateSchema.parse(slate));
	const statusRead = Date.parse(capture.checkedAt ?? capture.readAt);
	assert.ok(statusRead > Date.parse(read.writtenAt), 'the example read is newer than the write');
	const gameMorning = Date.parse('2026-09-13T12:20:00.000Z');
	assert.equal(
		standingByline(read, statusRead, scheduleKickoffs(slates), gameMorning),
		'Written Fri Oct 23, 9:00 pm CT, for week 8. Status read Sun Oct 25, 11:04 am CT, no change; next before the Sun 12:00 pm CT game'
	);
});

void test('the walker refuses a member the API does not name, at any depth', () => {
	const { player } = exampleData('/run/players/{id}') as { player: { season: object } };
	const stray = { ...player, season: { ...player.season, internalNote: 'x' } };
	assert.throws(() => {
		assertNamed(stray, { $ref: `${SCHEMAS_REF}RunPlayer` }, 'player');
	}, /season\.internalNote/);
});

/** The shared fixture run as the bucket holds it (shared/scripts/export-run.ts), the one the API's
 * own test reads and the /run/manifest example names. */
const FIXTURE_RUNS = new URL('../../../../shared/fixtures/run/runs/', import.meta.url);

function fixtureRunFile<T>(runId: string, path: string, schema: z.ZodType<T>): T {
	return schema.parse(JSON.parse(readFileSync(new URL(`${runId}/${path}`, FIXTURE_RUNS), 'utf8')));
}

void test("the reach the fixture run's manifest carries is the one the web counts over it (Lane 205)", () => {
	const { runId } = z
		.object({ runId: z.string() })
		.parse(JSON.parse(readFileSync(new URL('latest.json', FIXTURE_RUNS), 'utf8')));
	const run = fixtureRunFile(runId, RUN_PATHS.manifest, manifestSchema);
	const { pages } = splitIndex(fixtureRunFile(runId, RUN_PATHS.index, indexSchema));
	// The fixture run holds no page, so every page the index gives is its own (server/run.ts ownPages).
	const players = pages.map((entry) =>
		fixtureRunFile(runId, RUN_PATHS.player(entry.id), playerSchema)
	);
	const { slates } = fixtureRunFile(runId, RUN_PATHS.schedule, scheduleSchema);
	const counted = runReach(players, slates, run.formats);

	// Counted once and written: the written reach is the counted one, and the example sends it.
	assert.deepEqual(run.reach, counted);
	const data = namedExample('/run/manifest', 'RunManifestAnswer');
	assert.equal(data.run_id, runId, 'the example is the fixture run');
	assert.deepEqual((data.manifest as { reach?: unknown }).reach, counted);
	assert.ok(!(schemas.RunManifest?.required ?? []).includes('reach'), 'reach is optional');
});
