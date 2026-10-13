// The sheet's three measurements (spec §5, Lane 7): the drag's frame time on a throttled phone, a
// 400-row CSV import, and the print view's render. Run against the built site:
//   npm run build && npm run preview:static, then npm run measure:sheet -- http://localhost:4173
// The phone profile is Lighthouse's mobile one: a 390 by 844 viewport and the CPU slowed 4x.
import { chromium, type CDPSession, type Page } from 'playwright';

const CPU_SLOWDOWN = 4;
const PHONE = { width: 390, height: 844 };
const FRAME_BUDGET_MS = 1000 / 60;
const DRAG_STEPS = 150;
const DRAG_STEP_PX = Number(process.env.STEP_PX ?? 6);
const STEP_WAIT_MS = 16;
const RUNS = 3;

const base = process.argv[2] ?? 'http://localhost:4173';

interface FrameStats {
	frames: number;
	p50: number;
	p95: number;
	max: number;
	over: number;
	longTasks: number;
}

function quantile(sorted: readonly number[], q: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

async function throttled(page: Page): Promise<CDPSession> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
	return cdp;
}

async function startSheet(page: Page): Promise<void> {
	await page.goto(`${base}/sheet`, { waitUntil: 'networkidle' });
	await page.evaluate(() => localStorage.clear());
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Start from our board' }).click();
	await page.waitForSelector('[data-row-id]');
}

async function measureDrag(page: Page): Promise<FrameStats> {
	await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __long: number; __run: boolean };
		w.__frames = [];
		w.__long = 0;
		w.__run = true;
		new PerformanceObserver((list) => {
			w.__long += list.getEntries().length;
		}).observe({ type: 'longtask' });
		let last = performance.now();
		const loop = (now: number): void => {
			w.__frames.push(now - last);
			last = now;
			if (w.__run) requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
	});
	if (process.env.IDLE) {
		await page.mouse.move(200, 400);
		for (let step = 0; step < DRAG_STEPS; step += 1) {
			await page.mouse.move(200, 400 + (step % 2));
			await page.waitForTimeout(STEP_WAIT_MS);
		}
		return collect(page);
	}
	const grip = page.locator('[data-grip]').nth(2);
	const box = await grip.boundingBox();
	if (!box) throw new Error('No handle to drag.');
	const x = box.x + box.width / 2;
	let y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let step = 0; step < DRAG_STEPS; step += 1) {
		y = Math.min(PHONE.height - 20, y + DRAG_STEP_PX);
		await page.mouse.move(x, y);
		await page.waitForTimeout(STEP_WAIT_MS);
	}
	await page.mouse.up();
	return collect(page);
}

async function collect(page: Page): Promise<FrameStats> {
	const { frames, long } = await page.evaluate(() => {
		const w = window as unknown as { __frames: number[]; __long: number; __run: boolean };
		w.__run = false;
		return { frames: w.__frames.slice(2), long: w.__long };
	});
	const sorted = frames.toSorted((a, b) => a - b);
	return {
		frames: frames.length,
		p50: quantile(sorted, 0.5),
		p95: quantile(sorted, 0.95),
		max: sorted.at(-1) ?? 0,
		over: frames.filter((ms) => ms > FRAME_BUDGET_MS * 1.5).length,
		longTasks: long
	};
}

async function csvOf400(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const response = await fetch('/data/sheet-board/ppr.json');
		const board: {
			i: string;
			n: string;
			p: string;
			t: string | null;
		}[] = await response.json();
		const tags = ['target', 'sleeper', 'breakout, handcuff', 'avoid', ''];
		const lines = board.slice(0, 400).map((player, index) => {
			const note = index % 3 === 0 ? `"Note on ${player.n}, with a comma"` : '';
			return [
				String(index + 1),
				player.i,
				`"${player.n}"`,
				player.p,
				player.t ?? '',
				'',
				`"${tags[index % tags.length] ?? ''}"`,
				note
			].join(',');
		});
		return ['rank,player_id,name,position,team,tier,tags,note', ...lines].join('\n');
	});
}

async function measureImport(page: Page): Promise<{ readMs: number; renderMs: number }> {
	const csv = await csvOf400(page);
	await page.evaluate(() => localStorage.clear());
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Import a sheet' }).click();
	const t0 = await page.evaluate(() => performance.now());
	await page.locator('input[type=file]').setInputFiles({
		name: 'sheet.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv)
	});
	await page.getByText('400 players read').waitFor();
	const t1 = await page.evaluate(() => performance.now());
	await page.getByRole('button', { name: 'Use this sheet' }).click();
	await page.locator('[data-row-id]').nth(399).waitFor({ state: 'attached' });
	const t2 = await page.evaluate(
		() => new Promise<number>((done) => requestAnimationFrame(() => done(performance.now())))
	);
	return { readMs: t1 - t0, renderMs: t2 - t1 };
}

/** A returning drafter: 400 rows already in this browser, the page opened cold. */
async function measureReturn(page: Page): Promise<{ lcpMs: number; rowsMs: number }> {
	await page.goto(`${base}/sheet`, { waitUntil: 'commit' });
	await page.locator('[data-row-id]').nth(399).waitFor({ state: 'attached' });
	return page.evaluate(
		() =>
			new Promise<{ lcpMs: number; rowsMs: number }>((done) => {
				const rowsMs = performance.now();
				new PerformanceObserver((list) => {
					const last = list.getEntries().at(-1);
					done({ lcpMs: last?.startTime ?? 0, rowsMs });
				}).observe({ type: 'largest-contentful-paint', buffered: true });
			})
	);
}

async function measurePrint(
	page: Page
): Promise<{ renderMs: number; pages: number; sections: number }> {
	await page.goto(`${base}/sheet/print`, { waitUntil: 'load' });
	await page.locator('.page').first().waitFor();
	const renderMs = await page.evaluate(
		() => new Promise<number>((done) => requestAnimationFrame(() => done(performance.now())))
	);
	const sections = await page.locator('.page').count();
	await page.emulateMedia({ media: 'print' });
	const pdf = await page.pdf({ format: 'Letter', printBackground: true });
	const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
	return { renderMs, pages, sections };
}

const browser = await chromium.launch();
try {
	const report: string[] = [];
	for (let run = 1; run <= RUNS; run += 1) {
		const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
		const page = await context.newPage();
		await startSheet(page);
		await throttled(page);
		const drag = await measureDrag(page);
		const imported = await measureImport(page);
		const returning = await measureReturn(page);
		const print = await measurePrint(page);
		report.push(
			`run ${String(run)}: drag ${String(drag.frames)} frames, p50 ${drag.p50.toFixed(1)} ms, p95 ${drag.p95.toFixed(1)} ms, max ${drag.max.toFixed(1)} ms, ${String(drag.over)} over 25 ms, ${String(drag.longTasks)} long tasks | import read ${imported.readMs.toFixed(0)} ms, render ${imported.renderMs.toFixed(0)} ms | return visit LCP ${returning.lcpMs.toFixed(0)} ms, 400 rows in ${returning.rowsMs.toFixed(0)} ms | print ${print.renderMs.toFixed(0)} ms to first paint after load, ${String(print.sections)} positions, ${String(print.pages)} PDF pages`
		);
		await context.close();
	}
	process.stdout.write(`${report.join('\n')}\n`);
} finally {
	await browser.close();
}
