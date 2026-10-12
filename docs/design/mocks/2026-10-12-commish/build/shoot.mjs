import { chromium } from '../brand-mocks/../flock/node_modules/playwright/index.mjs';
const dir = new URL('../brand-mocks/commish/', import.meta.url).pathname;
const pages = (process.argv[2] || 'board,player,setup,mock,lobby,report,system,direction').split(',');
const b = await chromium.launch();
for (const theme of ['dark','light']) for (const [w,h] of [[1440,900],[390,844]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, colorScheme: theme, deviceScaleFactor: w<500?2:1 });
  await ctx.addInitScript(t => document.documentElement.setAttribute('data-theme', t), theme);
  const p = await ctx.newPage();
  for (const n of pages) {
    await p.goto('file://' + dir + n + '.html', { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: `${dir}screenshots/${n}-${theme}-${w}.png`, fullPage: ['system','direction','report'].includes(n) });
    const fonts = await p.evaluate(() => [...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight).join(', '));
    console.log(n, theme, w, 'overflowX', over, fonts.slice(0,140));
  }
  await ctx.close();
}
await b.close();
