const [, , pwPath, dir] = process.argv;
const { chromium } = await import(pwPath);
const b = await chromium.launch();
const shots = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844], ['light', 390, 844]];
for (const [theme, w, h] of shots) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  await p.goto(`file://${dir}/waivers-${theme}.html`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w < 500) {
    await p.screenshot({ path: `${dir}/waivers-${theme}-${w}-first-screen.png` });
    await p.addStyleTag({ content: '.rail{display:none!important}.app{padding-bottom:0!important}' });
  }
  await p.screenshot({ path: `${dir}/waivers-${theme}-${w}.png`, fullPage: true });
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(','));
  console.log(theme, w, 'overflowX', over, fonts.slice(0, 100));
  await ctx.close();
}
await b.close();
