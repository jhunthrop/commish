// Lane 66n mock shots: dark and light at 1440, dark at 390 (full page and first screen).
// Prints, per shot, the sideways overflow and the basis in rendered lines.
// Usage: node shoot.mjs <playwright index.mjs> <this directory>
const [, , pwPath, dir] = process.argv;
const { chromium } = await import(pwPath);
const pages = ['board-all', 'board-wr', 'adp', 'club-dal', 'compare'];
const shots = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]];
const b = await chromium.launch();
for (const name of pages) {
  for (const [theme, w, h] of shots) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
    const p = await ctx.newPage();
    await p.goto(`file://${dir}/${name}-${theme}.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const lines = await p.evaluate(() => [...document.querySelectorAll('.basis')].map((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return Math.round(el.getBoundingClientRect().height / lh);
    }));
    const base = `${dir}/${name}-${theme}-${w}`;
    if (w < 500) {
      await p.screenshot({ path: `${base}-first-screen.png` });
      await p.addStyleTag({ content: '.tabbar{display:none!important}.app{padding-bottom:0!important}' });
    }
    await p.screenshot({ path: `${base}.png`, fullPage: true });
    console.log(name, theme, w, 'overflowX', over, 'basis lines', lines.join(','));
    await ctx.close();
  }
}
await b.close();
