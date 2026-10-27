// Lighthouse on the sheet as a drafter returns to it: 400 rows already in this browser. The seed
// script writes them into localStorage before each run, and storage is kept between the seed and
// the audit. Same profile, method and user-page budgets as lighthouserc.json.
const { Launcher } = require('chrome-launcher');
const { ORIGIN, PAINT_HOLDING_OFF, SCRIPT_BUDGETS } = require('./lighthouse-shared.cjs');

const RUNS = 7;
const [chromePath] = Launcher.getInstallations();
if (!chromePath) {
	throw new Error('No Chrome found for Lighthouse. Install Chrome or set CHROME_PATH.');
}

module.exports = {
	ci: {
		collect: {
			startServerCommand: 'npm run preview:static',
			startServerReadyPattern: 'Accepting connections',
			// LHCI runs the seed script once per listed URL, not once per run, so the URL is listed
			// once per run: every run is seeded and cold. LH_SHEET_URL points at a build already served.
			url: Array.from({ length: RUNS }, () => process.env.LH_SHEET_URL ?? `${ORIGIN}/sheet`),
			numberOfRuns: 1,
			chromePath: process.env.CHROME_PATH ?? chromePath,
			puppeteerScript: './scripts/lighthouse-seed-sheet.cjs',
			// A puppeteer run launches Chrome itself, so the switch goes in as a launch argument.
			puppeteerLaunchOptions: { args: [PAINT_HOLDING_OFF] },
			settings: {
				preset: 'perf',
				formFactor: 'mobile',
				throttlingMethod: 'devtools',
				disableStorageReset: true
			}
		},
		assert: {
			assertions: {
				'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
				'resource-summary:script:size': ['error', { maxNumericValue: SCRIPT_BUDGETS.tool }],
				'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }]
			},
			aggregationMethod: 'median'
		},
		upload: { target: 'filesystem', outputDir: '.lighthouseci-sheet' }
	}
};
