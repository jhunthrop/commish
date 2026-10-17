// node shoot.mjs <playwright index.mjs path> <mock dir>
// Shoots each screen dark and light at 1440 and dark at 390, and measures the basis block in rendered
// lines at 1440 (the brief's cap is five), never in paragraphs.
const [, , pwPath, dir] = process.argv;
const { chromium } = await import(pwPath);
const BASIS_CAP = 5;
const b = await chromium.launch();
const pages = ['rest', 'players', 'record'];
const shots = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]];
let failed = false;
for (const name of pages) {
  for (const [theme, w, h] of shots) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: w < 500 ? 2 : 1 });
    const p = await ctx.newPage();
    await p.goto(`file://${dir}/${name}-${theme}.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const lines = await p.evaluate(() => {
      let n = 0;
      for (const para of document.querySelectorAll('[data-basis] p')) {
        const lh = parseFloat(getComputedStyle(para).lineHeight);
        n += Math.round(para.getBoundingClientRect().height / lh);
      }
      return n;
    });
    if (w < 500) {
      await p.screenshot({ path: `${dir}/${name}-${theme}-${w}-first-screen.png` });
      await p.addStyleTag({ content: '.rail{display:none!important}' });
    }
    await p.screenshot({ path: `${dir}/${name}-${theme}-${w}.png`, fullPage: true });
    const capped = w < 500 || lines <= BASIS_CAP;
    if (!capped || over > 0) failed = true;
    console.log(name, theme, w, 'overflowX', over, 'basis lines', lines, capped ? '' : `OVER ${BASIS_CAP}`);
    await ctx.close();
  }
}
await b.close();
process.exit(failed ? 1 : 0);
