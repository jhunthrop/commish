// Lighthouse CI: the spec's budgets (§2.1) on the pages a run builds. The audited pages come from the
// build itself, so a new run needs no edit here: the front door, the rail's board (the run's default
// format), the first player in the run's index (our top-ranked player), and the record. Read after
// the build.
const { readFileSync } = require('node:fs');
const { ORIGIN, PAINT_HOLDING_OFF, SCRIPT_BUDGETS } = require('./lighthouse-shared.cjs');

const INDEX = '.svelte-kit/cloudflare/data/index.json';

/** The first player in the built index, the run's top-ranked player. */
function firstPlayerPath() {
	const [first] = JSON.parse(readFileSync(INDEX, 'utf8'));
	if (!first || typeof first.slug !== 'string') {
		throw new Error(`${INDEX} has no first player. Build before running Lighthouse.`);
	}
	return `/players/${first.slug}`;
}

module.exports = {
	ci: {
		collect: {
			startServerCommand: 'npm run preview:static',
			startServerReadyPattern: 'Accepting connections',
			url: [`${ORIGIN}/`, `${ORIGIN}/board`, `${ORIGIN}${firstPlayerPath()}`, `${ORIGIN}/record`],
			// Nine runs, asserted on the median (the fifth). Chrome's paint holding used to land runs
			// near 1.65 s or 2.67 s on some machines (lighthouse-shared.cjs); nine runs are kept
			// as margin. The budgets themselves are unchanged.
			numberOfRuns: 9,
			settings: {
				chromeFlags: PAINT_HOLDING_OFF,
				preset: 'perf',
				formFactor: 'mobile',
				throttlingMethod: 'devtools'
			}
		},
		assert: {
			assertMatrix: [
				{
					matchingUrlPattern:
						'^https?://[^/]+/(board|players|record|clubs|adp|schedule|compare)?(/.*)?$',
					assertions: {
						'largest-contentful-paint': [
							'error',
							{
								maxNumericValue: 1200
							}
						],
						'resource-summary:script:size': [
							'error',
							{
								maxNumericValue: SCRIPT_BUDGETS.reading
							}
						],
						'cumulative-layout-shift': [
							'error',
							{
								maxNumericValue: 0.05
							}
						]
					},
					aggregationMethod: 'median'
				},
				{
					matchingUrlPattern: '^https?://[^/]+/(sheet|mock|lobby|report|account|pass)(/.*)?$',
					assertions: {
						'largest-contentful-paint': [
							'error',
							{
								maxNumericValue: 2000
							}
						],
						'resource-summary:script:size': [
							'error',
							{
								maxNumericValue: SCRIPT_BUDGETS.tool
							}
						],
						'cumulative-layout-shift': [
							'error',
							{
								maxNumericValue: 0.05
							}
						]
					},
					aggregationMethod: 'median'
				}
			]
		},
		upload: {
			target: 'filesystem',
			outputDir: '.lighthouseci'
		}
	}
};
