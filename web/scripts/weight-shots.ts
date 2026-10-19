// The visitor pages' weight on load (the sweep's C15): /adp and a club page, dark at 1440 and 390 (the
// phone at 2x, as the sweep measured), every byte the page fetches before the network goes quiet with
// no scroll (body and headers, as the browser counts them), split by kind, held to a budget, and shot.
// Headshots load from our image route at the drawn size (server/image-route.ts, Lane 66w), so a face
// never fetches more than its circle draws. Exits non-zero on any page over its budget, or any
// headshot fetched past the route.
//
//   node scripts/weight-shots.ts [web origin] [out dir, from scripts/]
// with the site built and served (npm run build, then npm run preview).
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { THEME_STORAGE_KEY } from '../src/lib/ui/theme.ts';
import { HEADSHOT_ROUTE } from '../src/lib/ui/headshot.ts';

const web = process.argv[2] ?? 'http://localhost:4173';
const out = new URL(process.argv[3] ?? '../screenshots/weight/', import.meta.url);
const KB = 1024;
const PHONE_MAX = 760;
const SETTLE_MS = 600;
/** The widths, each with its viewport height and pixel ratio, as the sweep measured. */
const SHOTS = [
	{ width: 1440, height: 900, scale: 1 },
	{ width: 390, height: 844, scale: 2 }
] as const;
/** Each page's budget in KB at 1440 and at 390. The sweep measured /adp at 451 and 928 and the club
 * page at 549 and 702 on live; the club page's excess was one college face at its 305 KB full file.
 * /adp's faces already come at their drawn size, about 11 KB each at 2x, so its phone budget holds
 * today's figure: under it needs the faces transcoded at the edge (the lane's report). */
const PAGES = [
	{ name: 'adp', path: '/adp', ready: 'ADP', budget: { 1440: 460, 390: 940 } },
	{ name: 'club', path: '/clubs/kc', ready: 'Kansas City', budget: { 1440: 300, 390: 420 } }
] as const;
/** The most one face may weigh: a face at its drawn size at 2x is about 11 KB, the full file 300. */
const FACE_MOST_KB = 24;

type Kind = 'document' | 'script' | 'style' | 'font' | 'image' | 'fetch' | 'other';

function kindOf(type: string): Kind {
	if (type === 'document' || type === 'script' || type === 'font' || type === 'image') return type;
	if (type === 'stylesheet') return 'style';
	if (type === 'fetch' || type === 'xhr') return 'fetch';
	return 'other';
}

const faults: string[] = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
	for (const page of PAGES) {
		for (const shot of SHOTS) {
			const ctx = await browser.newContext({
				viewport: { width: shot.width, height: shot.height },
				deviceScaleFactor: shot.scale,
				colorScheme: 'dark'
			});
			await ctx.addInitScript(
				([key, value]: readonly [string, string]) => localStorage.setItem(key, value),
				[THEME_STORAGE_KEY, 'dark'] as const
			);
			const tab = await ctx.newPage();
			const bytes = new Map<Kind, number>();
			const pending: Promise<void>[] = [];
			const strays: string[] = [];
			const heavy: string[] = [];
			tab.on('response', (response) => {
				const request = response.request();
				const kind = kindOf(request.resourceType());
				const url = new URL(response.url());
				if (
					kind === 'image' &&
					url.pathname.includes('headshot') &&
					url.origin !== new URL(web).origin
				)
					strays.push(response.url());
				pending.push(
					request
						.sizes()
						.then((sizes) => {
							bytes.set(
								kind,
								(bytes.get(kind) ?? 0) + sizes.responseBodySize + sizes.responseHeadersSize
							);
							if (kind === 'image' && sizes.responseBodySize > FACE_MOST_KB * KB)
								heavy.push(`${url.pathname} ${(sizes.responseBodySize / KB).toFixed(0)} KB`);
						})
						.catch(() => undefined)
				);
			});
			await tab.goto(`${web}${page.path}`, { waitUntil: 'networkidle' });
			await tab.getByText(page.ready).filter({ visible: true }).first().waitFor();
			await tab.evaluate(() => document.fonts.ready);
			await tab.waitForTimeout(SETTLE_MS);
			await Promise.all(pending);
			const faces = await tab.evaluate(
				(route) =>
					[...document.querySelectorAll<HTMLImageElement>('main img')]
						.filter((img) => img.currentSrc.includes(route) && img.complete)
						.map((img) => ({
							drawn: Math.round(img.getBoundingClientRect().width * window.devicePixelRatio),
							fetched: img.naturalWidth
						})),
				HEADSHOT_ROUTE
			);
			const total = [...bytes.values()].reduce((sum, n) => sum + n, 0);
			const kb = (n: number): string => (n / KB).toFixed(0);
			const split = [...bytes.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([kind, n]) => `${kind} ${kb(n)}`)
				.join(', ');
			const budget = page.budget[shot.width];
			process.stdout.write(
				`weight ${page.name} ${String(shot.width)}: ${kb(total)} KB (budget ${String(budget)}): ${split}; ${String(faces.length)} faces loaded\n`
			);
			if (total > budget * KB)
				faults.push(
					`${page.name} ${String(shot.width)} is ${kb(total)} KB, over ${String(budget)}`
				);
			for (const stray of strays) faults.push(`${page.name}: a headshot past our route: ${stray}`);
			for (const image of heavy)
				faults.push(`${page.name}: an image over ${String(FACE_MOST_KB)} KB: ${image}`);
			// A face fetched wider than its circle draws (the overfill and the 2x step aside) is waste.
			const wide = faces.filter((face) => face.fetched > face.drawn * 2);
			if (wide.length > 0)
				faults.push(
					`${page.name} ${String(shot.width)}: ${String(wide.length)} faces fetched past twice their drawn width`
				);
			const file = new URL(`${page.name}-dark-${String(shot.width)}.png`, out);
			await tab.screenshot({ path: file.pathname, fullPage: shot.width > PHONE_MAX });
			process.stdout.write(`${file.pathname}\n`);
			await ctx.close();
		}
	}
} finally {
	await browser.close();
}
if (faults.length > 0) {
	process.stderr.write(`${faults.join('\n')}\n`);
	process.exit(1);
}
