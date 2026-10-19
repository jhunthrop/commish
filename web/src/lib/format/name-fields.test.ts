// The copy guard's NAME_FIELDS against the contracts it reads (Lane 77, review 66x): every field
// the API's answers (api/types.ts, generated from api/openapi.yaml) or the run's files (run/schema.ts)
// type as a string and name as a name (a name, a city, a nickname, an owner, a username, who shared
// it) is on the list, so a name the API or the run hands a page is skipped as data and never read
// as copy. A field that holds a name and is missing fails here, and so does a listed field neither
// contract carries any more. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as run from '#lib/run/schema.ts';
import { NAME_FIELDS } from './copy-guard.ts';

/** A field named as a name: `name` and `*_name(s)`, a city, a nickname, an owner, a username, and
 * `*_by`, the person a thing is by. Only its string-typed fields hold one. */
const NAMED = /^(?:.*_)?(?:names?|nickname|city|owner|username)$|^[a-z]+_by$/;

/** One property of the generated contract: `key?: type;` on its own line. */
const PROPERTY = /^\s*(?:readonly\s+)?'?([a-z][a-z0-9_]*)'?\??:\s*([^;{]+);$/gm;
/** A string, a nullable one or a list of them; an enum is a union of literals and is not one. */
const STRING_TYPE = /^(?:string|string\[\]|\(string \| null\)\[\])(?: \| null)?$/;

function apiNameFields(): Set<string> {
	const contract = readFileSync(new URL('../api/types.ts', import.meta.url), 'utf8');
	const schemas = contract.slice(contract.indexOf('export interface components'));
	return new Set(
		[...schemas.matchAll(PROPERTY)]
			.filter(([, key, type]) => NAMED.test(key ?? '') && STRING_TYPE.test((type ?? '').trim()))
			.map(([, key]) => key ?? '')
	);
}

/** The part of a zod schema's definition the walk reads. */
interface Def {
	type: string;
	shape?: Record<string, Schema>;
	innerType?: Schema;
	element?: Schema;
	options?: readonly Schema[];
	valueType?: Schema;
	in?: Schema;
	out?: Schema;
	left?: Schema;
	right?: Schema;
	items?: readonly Schema[];
	getter?: () => Schema;
}

interface Schema {
	_zod: { def: Def };
}

function isSchema(value: unknown): value is Schema {
	return typeof value === 'object' && value !== null && '_zod' in value;
}

/** Whether a field's schema is a string, or a list of them, under its wrappers. */
function holdsString(schema: Schema): boolean {
	const { def } = schema._zod;
	if (def.type === 'string') return true;
	const inner = def.innerType ?? def.element ?? def.in;
	return inner !== undefined && holdsString(inner);
}

/** Every string field a schema names as a name, at any depth. */
function runNames(schema: Schema, seen: Set<Schema>): string[] {
	if (seen.has(schema)) return [];
	seen.add(schema);
	const { def } = schema._zod;
	const fields = Object.entries(def.shape ?? {}).flatMap(([key, child]) => [
		...(NAMED.test(key) && holdsString(child) ? [key] : []),
		...runNames(child, seen)
	]);
	const children = [
		def.innerType,
		def.element,
		def.valueType,
		def.in,
		def.out,
		def.left,
		def.right,
		def.getter?.(),
		...(def.options ?? []),
		...(def.items ?? [])
	].filter((child): child is Schema => child !== undefined);
	return [...fields, ...children.flatMap((child) => runNames(child, seen))];
}

function runNameFields(): Set<string> {
	const seen = new Set<Schema>();
	return new Set(
		// Every export, read as unknown: the walk narrows each to the part of a schema it reads.
		Object.values(run as Readonly<Record<string, unknown>>)
			.filter(isSchema)
			.flatMap((schema) => runNames(schema, seen))
	);
}

void test('every field the contracts type as a name is on the copy guard’s NAME_FIELDS', () => {
	const named = new Set([...apiNameFields(), ...runNameFields()]);
	assert.deepEqual(
		[...named].filter((field) => !NAME_FIELDS.has(field)).sort(),
		[],
		'add the field to NAME_FIELDS (format/copy-guard.ts), or the guard reads its names as copy'
	);
});

void test('every NAME_FIELDS entry is a field one of the contracts still carries', () => {
	const named = new Set([...apiNameFields(), ...runNameFields()]);
	assert.deepEqual([...NAME_FIELDS].filter((field) => !named.has(field)).sort(), []);
});

void test('the walk finds names in both contracts, and leaves an enum or an object alone', () => {
	const api = apiNameFields();
	for (const field of ['name', 'team_name', 'host_username', 'seat_names'])
		assert.ok(api.has(field), field);
	// made_by is an enum of who made the pick and held_by a map of roster ids: neither is a name.
	assert.equal(api.has('made_by'), false);
	assert.equal(api.has('held_by'), false);
	const runs = runNameFields();
	for (const field of ['name', 'city', 'nickname']) assert.ok(runs.has(field), field);
});
