// node shoot.mjs <playwright index.mjs path> <mock dir>
const [, , pwPath, dir] = process.argv;
const { chromium } = await import(pwPath);
const b = await chromium.launch();
const pages = ['front', 'account'];
const shots = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]];
for (const name of pages) {
  for (const [theme, w, h] of shots) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w < 500 ? 2 : 1 });
    const p = await ctx.newPage();
    await p.goto(`file://${dir}/${name}-${theme}.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const basis = await p.evaluate(() => {
      const el = document.querySelector('.basis');
      if (!el) return null;
      let lines = 0;
      for (const para of el.querySelectorAll('p')) {
        const lh = parseFloat(getComputedStyle(para).lineHeight);
        lines += Math.round(para.getBoundingClientRect().height / lh);
      }
      return lines;
    });
    if (w < 500) await p.screenshot({ path: `${dir}/${name}-${theme}-${w}-first-screen.png` });
    if (w < 500) await p.addStyleTag({ content: '.rail{display:none!important}.n-act{position:static!important;box-shadow:none!important}.mx{padding-bottom:24px!important}' });
    await p.screenshot({ path: `${dir}/${name}-${theme}-${w}.png`, fullPage: true });
    console.log(name, theme, w, 'overflowX', over, 'basis lines', basis);
    await ctx.close();
  }
}
await b.close();
