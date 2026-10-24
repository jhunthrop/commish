// The iOS client's spec: api/openapi.yaml with every schema enum opened, so an app already installed
// reads a value the API adds later. Run with `node --test apps/ios/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openEnums } from './gen-openapi.ts';

const doc = (): Record<string, unknown> => ({
	openapi: '3.0.3',
	paths: {
		'/x': {
			get: {
				parameters: [{ name: 'client', in: 'query', schema: { type: 'string', enum: ['ios'] } }]
			}
		}
	},
	components: {
		schemas: {
			LeagueHost: { type: 'string', description: 'the platform', enum: ['espn', 'ffpc'] },
			Spot: {
				type: 'object',
				properties: {
					slot: { type: 'string', enum: ['starter', 'bench'] },
					state: { allOf: [{ $ref: '#/components/schemas/LeagueHost' }], nullable: true },
					seeds: { type: 'array', nullable: true, items: { type: 'string', enum: ['record'] } }
				}
			}
		}
	}
});

void test('a named enum becomes its known values or any string, the known ones under a name of their own', () => {
	const schemas = (openEnums(doc()) as { components: { schemas: Record<string, unknown> } })
		.components.schemas;
	assert.deepEqual(schemas.LeagueHostKnown, { type: 'string', enum: ['espn', 'ffpc'] });
	assert.deepEqual(schemas.LeagueHost, {
		description: 'the platform',
		anyOf: [{ $ref: '#/components/schemas/LeagueHostKnown' }, { type: 'string' }]
	});
});

void test('an inline enum opens in place, in properties and in array items', () => {
	const spot = (
		openEnums(doc()) as {
			components: { schemas: { Spot: { properties: Record<string, Record<string, unknown>> } } };
		}
	).components.schemas.Spot.properties;
	assert.deepEqual(spot.slot, {
		anyOf: [{ type: 'string', enum: ['starter', 'bench'] }, { type: 'string' }]
	});
	assert.deepEqual(spot.seeds?.items, {
		anyOf: [{ type: 'string', enum: ['record'] }, { type: 'string' }]
	});
	assert.deepEqual(spot.state, {
		allOf: [{ $ref: '#/components/schemas/LeagueHost' }],
		nullable: true
	});
});

void test('a parameter enum stays closed: what the app sends, it knows', () => {
	const opened = openEnums(doc()) as {
		paths: { '/x': { get: { parameters: { schema: unknown }[] } } };
	};
	assert.deepEqual(opened.paths['/x'].get.parameters[0]?.schema, {
		type: 'string',
		enum: ['ios']
	});
});

void test('the input is left as it was', () => {
	const input = doc();
	const before = JSON.stringify(input);
	openEnums(input);
	assert.equal(JSON.stringify(input), before);
});
