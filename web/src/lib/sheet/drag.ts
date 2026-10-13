/**
 * Dragging rows and tier strips with pointer events, built for 60 frames a second on a mid phone
 * (spec §5). The list is read once when a drag starts (one layout pass over every row and strip),
 * and each animation frame after that writes transforms only: the dragged item follows the
 * pointer and the items it passes slide by its height. Nothing reactive runs until the drop, which
 * hands the store one move. The list stays plain markup: rows carry data-row-id, their handles
 * data-grip, strips data-strip-start (the id of the row the tier starts at), their handles
 * data-strip-grip.
 */

export interface RowDrop {
	playerId: string;
	/** How many of the list's other rows end up above him. */
	rowsAbove: number;
	/** He landed just below a tier strip ('below', he joins that tier) or anywhere else ('above',
	 * he joins the tier of the row above him). */
	side: 'above' | 'below';
}

export interface StripDrop {
	startId: string;
	/** The list row the tier now starts at, by its place among the list's rows. */
	rowIndex: number;
}

export interface DragHandlers {
	onRowDrop: (drop: RowDrop) => void;
	onStripDrop: (drop: StripDrop) => void;
	/** The rows a tier's start can move between, by place among the list's rows. */
	stripRange: (startId: string) => { first: number; last: number } | null;
	/** The drag began or ended, for the page to quiet anything else that reacts to the pointer. */
	onActive?: (active: boolean) => void;
}

/** How close to the top or bottom of the view the pointer must be to scroll it, and how fast. */
const EDGE_PX = 56;
const MAX_SCROLL_PX = 18;
/** The shell's sticky top bar and, on the phone, its bottom rail sit over the list. */
const TOP_CHROME_PX = 72;
const BOTTOM_CHROME_PX = 72;
const SLIDE = 'transform 150ms cubic-bezier(0.2, 0, 0, 1)';
const ROW = '[data-row-id]';
const STRIP = '[data-strip-start]';

interface Item {
	el: HTMLElement;
	isRow: boolean;
	/** Document top and height, read once at the start. */
	top: number;
	height: number;
}

interface Drag {
	pointerId: number;
	items: Item[];
	from: number;
	startY: number;
	startScroll: number;
	pointerY: number;
	/** The landing place among the items other than the dragged one. */
	landing: number;
	shifts: number[];
	frame: number;
	strip: { startId: string; first: number; last: number } | null;
}

function readItems(container: HTMLElement): Item[] {
	const scroll = window.scrollY;
	return Array.from(container.querySelectorAll<HTMLElement>(`${ROW}, ${STRIP}`)).map((el) => {
		const rect = el.getBoundingClientRect();
		return { el, isRow: el.matches(ROW), top: rect.top + scroll, height: rect.height };
	});
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachDrag(container: HTMLElement, handlers: DragHandlers): () => void {
	let drag: Drag | null = null;

	const others = (d: Drag): Item[] => d.items.filter((_, i) => i !== d.from);

	function landingFor(d: Drag): number {
		const moving = d.items[d.from];
		if (!moving) return 0;
		const dy = d.pointerY - d.startY + (window.scrollY - d.startScroll);
		const center = moving.top + moving.height / 2 + dy;
		const rest = others(d);
		if (d.strip) {
			const rows = rest.filter((item) => item.isRow);
			const passed = rows.filter((item) => item.top + item.height / 2 < center).length;
			const rowIndex = Math.max(d.strip.first, Math.min(d.strip.last, passed));
			const target = rows[rowIndex];
			return target ? rest.indexOf(target) : rest.length;
		}
		let landing = rest.filter((item) => item.top + item.height / 2 < center).length;
		// A row never lands above the first tier's strip.
		if (landing === 0 && rest[0] && !rest[0].isRow) landing = 1;
		return landing;
	}

	function paint(d: Drag): void {
		const moving = d.items[d.from];
		if (!moving) return;
		const dy = d.pointerY - d.startY + (window.scrollY - d.startScroll);
		moving.el.style.transform = `translate3d(0, ${String(dy)}px, 0)`;
		d.landing = landingFor(d);
		d.items.forEach((item, i) => {
			if (i === d.from) return;
			const without = i < d.from ? i : i - 1;
			let shift = 0;
			if (i > d.from && without < d.landing) shift = -moving.height;
			if (i < d.from && without >= d.landing) shift = moving.height;
			if (d.shifts[i] !== shift) {
				d.shifts[i] = shift;
				item.el.style.transform = shift === 0 ? '' : `translate3d(0, ${String(shift)}px, 0)`;
			}
		});
	}

	function autoScroll(d: Drag): void {
		const top = TOP_CHROME_PX + EDGE_PX;
		const bottom = window.innerHeight - BOTTOM_CHROME_PX - EDGE_PX;
		let speed = 0;
		if (d.pointerY < top) speed = -Math.min(MAX_SCROLL_PX, (top - d.pointerY) / 3);
		if (d.pointerY > bottom) speed = Math.min(MAX_SCROLL_PX, (d.pointerY - bottom) / 3);
		if (speed !== 0) window.scrollBy(0, speed);
	}

	function tick(): void {
		if (!drag) return;
		autoScroll(drag);
		paint(drag);
		drag.frame = requestAnimationFrame(tick);
	}

	function clear(d: Drag): void {
		cancelAnimationFrame(d.frame);
		for (const item of d.items) {
			item.el.style.transform = '';
			item.el.style.transition = '';
			item.el.style.willChange = '';
			delete item.el.dataset.dragging;
		}
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', onCancel);
		window.removeEventListener('keydown', onKey);
		container.style.pointerEvents = '';
		drag = null;
		handlers.onActive?.(false);
	}

	function drop(d: Drag): void {
		const moving = d.items[d.from];
		const rest = others(d);
		const landing = landingFor(d);
		clear(d);
		if (!moving) return;
		if (d.strip) {
			const rowsAbove = rest.slice(0, landing).filter((item) => item.isRow).length;
			handlers.onStripDrop({ startId: d.strip.startId, rowIndex: rowsAbove });
			return;
		}
		const playerId = moving.el.dataset.rowId ?? '';
		const above = rest[landing - 1];
		handlers.onRowDrop({
			playerId,
			rowsAbove: rest.slice(0, landing).filter((item) => item.isRow).length,
			side: above && !above.isRow ? 'below' : 'above'
		});
	}

	function onMove(event: PointerEvent): void {
		if (drag?.pointerId === event.pointerId) drag.pointerY = event.clientY;
	}

	function onUp(event: PointerEvent): void {
		if (drag?.pointerId === event.pointerId) drop(drag);
	}

	function onCancel(event: PointerEvent): void {
		if (drag?.pointerId === event.pointerId) clear(drag);
	}

	function onKey(event: KeyboardEvent): void {
		if (drag && event.key === 'Escape') {
			event.preventDefault();
			clear(drag);
		}
	}

	function start(event: PointerEvent, el: HTMLElement, strip: Drag['strip']): void {
		const items = readItems(container);
		const from = items.findIndex((item) => item.el === el);
		if (from === -1) return;
		event.preventDefault();
		const slide = reducedMotion() ? '' : SLIDE;
		items.forEach((item, i) => {
			item.el.style.transition = i === from ? '' : slide;
		});
		el.dataset.dragging = '';
		el.style.willChange = 'transform';
		// The pointer is captured by the window, so the list need not hit-test or restyle hovers
		// under a moving finger.
		container.style.pointerEvents = 'none';
		drag = {
			pointerId: event.pointerId,
			items,
			from,
			startY: event.clientY,
			startScroll: window.scrollY,
			pointerY: event.clientY,
			landing: from,
			shifts: items.map(() => 0),
			frame: requestAnimationFrame(tick),
			strip
		};
		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		window.addEventListener('keydown', onKey);
		handlers.onActive?.(true);
	}

	function onDown(event: PointerEvent): void {
		if (drag || !event.isPrimary || event.button !== 0) return;
		const target = event.target instanceof Element ? event.target : null;
		const rowGrip = target?.closest<HTMLElement>('[data-grip]');
		if (rowGrip) {
			const row = rowGrip.closest<HTMLElement>(ROW);
			if (row) start(event, row, null);
			return;
		}
		const stripGrip = target?.closest<HTMLElement>('[data-strip-grip]');
		const strip = stripGrip?.closest<HTMLElement>(STRIP);
		const startId = strip?.dataset.stripStart;
		if (!strip || !startId) return;
		const range = handlers.stripRange(startId);
		if (range) start(event, strip, { startId, ...range });
	}

	container.addEventListener('pointerdown', onDown);
	return () => {
		container.removeEventListener('pointerdown', onDown);
		if (drag) clear(drag);
	};
}
