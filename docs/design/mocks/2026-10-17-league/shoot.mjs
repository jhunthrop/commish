// node shoot.mjs <playwright index.mjs path> <mock dir>
const [, , pwPath, dir] = process.argv;
const { chromium } = await import(pwPath);
const b = await chromium.launch();
const pages = ['league-sleeper', 'league-espn', 'settings-sleeper'];
const shots = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]];
for (const name of pages) {
  for (const [theme, w, h] of shots) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w < 500 ? 2 : 1 });
    const p = await ctx.newPage();
    await p.goto(`file://${dir}/${name}-${theme}.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (w < 500) await p.screenshot({ path: `${dir}/${name}-${theme}-${w}-first-screen.png` });
    if (w < 500) await p.addStyleTag({ content: '.rail{display:none!important}.rs-verb{position:static!important;box-shadow:none!important}.mx{padding-bottom:24px!important}' });
    await p.screenshot({ path: `${dir}/${name}-${theme}-${w}.png`, fullPage: true });
    console.log(name, theme, w, 'overflowX', over);
    await ctx.close();
  }
}
await b.close();
