// The API's /run routes (Lane 185) against the run's own contract: each Run schema of api/openapi.yaml
// names the fields this file's zod schema does, each one optional and nullable exactly where the zod
// schema has it and its enum the same values, less the provenance the API never sends; and every /run
// route's example parses with the zod schema, so the apps' contract and the web's cannot drift apart.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import type { z } from 'zod';
import { POSITIONS } from '#lib/types/player.ts';
import { MARKET_POSITIONS } from './market.ts';
import {
	adpSchema,
	adpSourceSchema,
	boardRowSchema,
	boardSchema,
	designationsSchema,
	formatSchema,
	indexEntrySchema,
	indexSchema,
	indexSeasonSchema,
	manifestSchema,
	marketEntrySchema,
	marketRowSchema,
	playerStatusSchema,
	windowSchema
} from './schema.ts';

interface Property {
	$ref?: string;
	enum?: unknown[];
	nullable?: boolean;
}

interface ObjectSchema {
	required?: string[];
	properties: Record<string, Property>;
	enum?: string[];
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
	RunBoardRow: { zod: boardRowSchema },
	RunMarketRow: { zod: marketRowSchema },
	RunIndexSeason: { zod: indexSeasonSchema },
	RunIndexEntry: { zod: indexEntrySchema },
	RunMarketEntry: { zod: marketEntrySchema },
	RunAdpSource: { zod: adpSourceSchema },
	RunAdp: { zod: adpSchema },
	RunPlayerStatus: { zod: playerStatusSchema },
	RunDesignations: { zod: designationsSchema, withheld: ['source'] }
};

/** The answers' wrappers (their run id and the file's members) and the position enums, held below. */
const WRAPPERS = new Set([
	'RunManifestAnswer',
	'RunBoardAnswer',
	'RunIndexAnswer',
	'RunAdpAnswer',
	'RunDesignationsAnswer',
	'RunPosition',
	'RunMarketPosition'
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

/** A property's enum, inline or through its $ref. */
function specValues(property: Property): unknown[] | null {
	if (property.enum) return property.enum;
	if (property.$ref?.startsWith(SCHEMAS_REF)) {
		return schemas[property.$ref.slice(SCHEMAS_REF.length)]?.enum ?? null;
	}
	return null;
}

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
			if (values !== null && values.length > 0 && values.some((v) => v !== null)) {
				assert.deepEqual(sorted(listed ?? []), sorted(values), `${where} values`);
			}
		}
	}
});

void test('the position enums are the run format positions', () => {
	assert.deepEqual(sorted(schemas.RunPosition?.enum ?? []), sorted(POSITIONS));
	assert.deepEqual(sorted(schemas.RunMarketPosition?.enum ?? []), sorted(MARKET_POSITIONS));
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
