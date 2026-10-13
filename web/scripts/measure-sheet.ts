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

async function startFrameProbe(page: Page): Promise<void> {
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
}

/** One finger or the mouse, pressed, moved and lifted at a point. */
interface Pointer {
	down(x: number, y: number): Promise<void>;
	move(x: number, y: number): Promise<void>;
	up(): Promise<void>;
	cancel(): Promise<void>;
}

function mouse(page: Page): Pointer {
	return {
		down: async (x, y) => {
			await page.mouse.move(x, y);
			await page.mouse.down();
		},
		move: (x, y) => page.mouse.move(x, y),
		up: () => page.mouse.up(),
		cancel: () => page.keyboard.press('Escape')
	};
}

/** A finger through CDP touch events, which the page sees as pointerType touch. */
function finger(cdp: CDPSession): Pointer {
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
		x = 0,
		y = 0
	): Promise<unknown> =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }]
		});
	return {
		down: async (x, y) => {
			await touch('touchStart', x, y);
		},
		move: async (x, y) => {
			await touch('touchMove', x, y);
		},
		up: async () => {
			await touch('touchEnd');
		},
		cancel: async () => {
			await touch('touchCancel');
		}
	};
}

const rowOrder = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]')).map(
			(el) => el.dataset.rowId ?? ''
		)
	);

const handleCenter = async (page: Page, index: number): Promise<{ x: number; y: number }> => {
	const box = await page.locator('[data-grip]').nth(index).boundingBox();
	if (!box) throw new Error('No handle to drag.');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Drags the third row down past the bottom edge, so the list auto-scrolls, and lifts. */
async function measureDrag(page: Page, pointer: Pointer): Promise<FrameStats & { moved: number }> {
	await page.evaluate(() => {
		window.scrollTo(0, 0);
	});
	const before = await rowOrder(page);
	await startFrameProbe(page);
	const { x, y: start } = await handleCenter(page, 2);
	let y = start;
	await pointer.down(x, y);
	for (let step = 0; step < DRAG_STEPS; step += 1) {
		y = Math.min(PHONE.height - 20, y + DRAG_STEP_PX);
		await pointer.move(x, y);
		await page.waitForTimeout(STEP_WAIT_MS);
	}
	await pointer.up();
	const stats = await collect(page);
	const after = await rowOrder(page);
	return { ...stats, moved: after.indexOf(before[2] ?? '') + 1 };
}

/** A drag the browser cancels part way leaves the order and every row where they were. */
async function checkCancel(page: Page, pointer: Pointer): Promise<boolean> {
	const before = await rowOrder(page);
	const { x, y } = await handleCenter(page, 1);
	await pointer.down(x, y);
	for (let step = 1; step <= 10; step += 1) {
		await pointer.move(x, y + step * 12);
		await page.waitForTimeout(STEP_WAIT_MS);
	}
	await pointer.cancel();
	await page.waitForTimeout(50);
	const after = await rowOrder(page);
	const transformed = await page.evaluate(
		() =>
			Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]')).filter(
				(el) => el.style.transform !== ''
			).length
	);
	return before.join() === after.join() && transformed === 0;
}

/** A finger on a row's name scrolls the page and moves no one. */
async function checkPan(page: Page, pointer: Pointer): Promise<boolean> {
	await page.evaluate(() => {
		window.scrollTo(0, 400);
	});
	const before = await rowOrder(page);
	const scrollBefore = await page.evaluate(() => window.scrollY);
	const box = await page.locator('[data-row-id] button[aria-expanded]').nth(8).boundingBox();
	if (!box) throw new Error('No row to pan on.');
	const x = box.x + 20;
	await pointer.down(x, box.y + 200);
	for (let step = 1; step <= 10; step += 1) {
		await pointer.move(x, box.y + 200 - step * 20);
		await page.waitForTimeout(STEP_WAIT_MS);
	}
	await pointer.up();
	await page.waitForTimeout(300);
	const after = await rowOrder(page);
	const scrollAfter = await page.evaluate(() => window.scrollY);
	return before.join() === after.join() && scrollAfter > scrollBefore;
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

function dragLine(label: string, d: FrameStats & { moved: number }): string {
	return `${label} drag ${String(d.frames)} frames, p50 ${d.p50.toFixed(1)} ms, p95 ${d.p95.toFixed(1)} ms, max ${d.max.toFixed(1)} ms, ${String(d.over)} over 25 ms, ${String(d.longTasks)} long tasks, row 3 landed at ${String(d.moved)}`;
}

const browser = await chromium.launch();
try {
	const report: string[] = [];
	for (let run = 1; run <= RUNS; run += 1) {
		const context = await browser.newContext({
			viewport: PHONE,
			deviceScaleFactor: 2,
			hasTouch: true,
			isMobile: true
		});
		const page = await context.newPage();
		await startSheet(page);
		const cdp = await throttled(page);
		const drag = await measureDrag(page, mouse(page));
		const touch = await measureDrag(page, finger(cdp));
		const cancelled = await checkCancel(page, finger(cdp));
		const panned = await checkPan(page, finger(cdp));
		const imported = await measureImport(page);
		const returning = await measureReturn(page);
		const print = await measurePrint(page);
		report.push(
			`run ${String(run)}: ${dragLine('mouse', drag)} | ${dragLine('touch', touch)} | touch cancel restores: ${String(cancelled)}, pan on a row scrolls: ${String(panned)} | import read ${imported.readMs.toFixed(0)} ms, render ${imported.renderMs.toFixed(0)} ms | return visit LCP ${returning.lcpMs.toFixed(0)} ms, 400 rows in ${returning.rowsMs.toFixed(0)} ms | print ${print.renderMs.toFixed(0)} ms to first paint after load, ${String(print.sections)} positions, ${String(print.pages)} PDF pages`
		);
		await context.close();
	}
	process.stdout.write(`${report.join('\n')}\n`);
} finally {
	await browser.close();
}
