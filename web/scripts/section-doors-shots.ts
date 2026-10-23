// Screenshots of the bare section addresses signed out at 390 (Lane 166, D18, D19): /lobby and
// /companion answer a page (the setup page the rail links, the companion's front), never the 404, and
// the signed-out mock setup page makes no request that answers 401, with a clean console.
//
//   node scripts/section-doors-shots.ts [web origin] [out dir]
// with the site built against PUBLIC_API_URL and the fixture API running there.
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { COMPANION_START, MOCK_SETUP } from '../src/lib/ui/nav.ts';

const WIDTH = 390;
const HEIGHT = 900;
const SETTLE_MS = 1500;
const UNAUTHORIZED = 401;

const web = process.argv[2] ?? 'http://localhost:4196';
const out = new URL(process.argv[3] ?? '../screenshots/section-doors/', import.meta.url);

const DOORS = [
	{ name: 'lobby', path: '/lobby', lands: MOCK_SETUP },
	{ name: 'companion', path: '/companion', lands: COMPANION_START },
	{ name: 'mock-new', path: MOCK_SETUP, lands: MOCK_SETUP }
] as const;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [];

async function shoot(door: (typeof DOORS)[number]): Promise<void> {
	const { name, path, lands } = door;
	const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
	const page: Page = await context.newPage();
	const unauthorized: string[] = [];
	const errors: string[] = [];
	page.on('response', (response) => {
		if (response.status() === UNAUTHORIZED) unauthorized.push(response.url());
	});
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(`${web}${path}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(SETTLE_MS);
	const landed = new URL(page.url()).pathname;
	if (landed !== lands) failures.push(`${path}: landed on ${landed}, wanted ${lands}`);
	if (unauthorized.length > 0) failures.push(`${path}: 401 from ${unauthorized.join(', ')}`);
	if (errors.length > 0) failures.push(`${path}: console errors ${errors.join(' | ')}`);
	await page.screenshot({ path: new URL(`${name}-${String(WIDTH)}.png`, out).pathname });
	process.stdout.write(
		`${path} -> ${landed}, ${String(unauthorized.length)} x 401, ${String(errors.length)} console errors\n`
	);
	await context.close();
}

for (const door of DOORS) await shoot(door);
await browser.close();
if (failures.length > 0) {
	process.stderr.write(`${failures.join('\n')}\n`);
	process.exit(1);
}
