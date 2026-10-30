// Shoots the Lane 305 mock: both themes at 1280 by 800 and 390 by 844, the landing (the weakest
// Need), QB chosen, This week, and All; prints any sideways scroll.
//   node shoot.mjs <path to web/node_modules/playwright/index.mjs>
const [, , pwPath] = process.argv;
const { chromium } = await import(pwPath);
const dir = new URL('./', import.meta.url).pathname;
const b = await chromium.launch();
const views = [
	['landing', ''],
	['qb', '?pos=QB'],
	['week', '?mode=week'],
	['dst', '?pos=DEF'],
	['all', '?pos=ALL']
];
for (const theme of ['light', 'dark']) {
	for (const [w, h] of [
		[1280, 800],
		[390, 844]
	]) {
		const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w < 500 ? 2 : 1 });
		const p = await ctx.newPage();
		for (const [name, q] of views) {
			if (theme === 'dark' && name !== 'landing') continue;
			await p.goto(`file://${dir}waivers-cards-${theme}.html${q}`, { waitUntil: 'networkidle' });
			await p.evaluate(() => document.fonts.ready);
			await p.waitForTimeout(200);
			const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			await p.screenshot({ path: `${dir}shots/${theme}-${w}-${name}.png` });
			if (name === 'landing') await p.screenshot({ path: `${dir}shots/${theme}-${w}-${name}-full.png`, fullPage: true });
			console.log(theme, w, name, 'overflowX', over);
		}
		await ctx.close();
	}
}
await b.close();
