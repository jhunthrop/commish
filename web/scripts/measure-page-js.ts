// A page's script weight on load, as the budget counts it (spec §2.1): every script the page fetches
// before the network goes quiet, with no interaction, each gzipped at the default level and summed.
// Run against the built site:
//   npm run build && npm run preview:static, then
//   npm run measure:page -- http://localhost:4173/players/puka-nacua [more urls]
// Set VERBOSE=1 to list each script by weight.
import { gzipSync } from 'node:zlib';
import { chromium, type Browser } from 'playwright';

const PHONE = { width: 390, height: 844 };
const KB = 1024;

interface Script {
	name: string;
	gzipped: number;
}

const urls = process.argv.slice(2);
if (urls.length === 0) throw new Error('Usage: npm run measure:page -- <url> [url ...]');

async function measure(browser: Browser, url: string): Promise<Script[]> {
	const page = await browser.newPage({ viewport: PHONE });
	const pending: Promise<Script>[] = [];
	page.on('response', (response) => {
		if (response.request().resourceType() !== 'script') return;
		pending.push(
			response.body().then((body) => ({
				name: new URL(response.url()).pathname.split('/').pop() ?? response.url(),
				gzipped: gzipSync(body).length
			}))
		);
	});
	await page.goto(url, { waitUntil: 'networkidle' });
	const scripts = await Promise.all(pending);
	await page.close();
	return scripts;
}

const browser = await chromium.launch();
try {
	for (const url of urls) {
		const scripts = await measure(browser, url);
		const total = scripts.reduce((sum, script) => sum + script.gzipped, 0);
		process.stdout.write(
			`${url}: ${String(scripts.length)} scripts, ${(total / KB).toFixed(1)} KB gzipped\n`
		);
		if (process.env.VERBOSE) {
			for (const script of [...scripts].sort((a, b) => b.gzipped - a.gzipped)) {
				process.stdout.write(`  ${(script.gzipped / KB).toFixed(1)} KB  ${script.name}\n`);
			}
		}
	}
} finally {
	await browser.close();
}
