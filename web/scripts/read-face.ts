// The week's read's face in season (Lane 126), measured in the browser for the shot scripts: the read
// is set in the UI face, never the reading serif, at the body size rows use (--t-md), and its byline
// is a plain caption the size of the tiles' captions, and no line of it runs past about 60 characters
// (the measure, ruling 1). Returns the faults, none when the read is not drawn under the root (a read
// not written yet), and the characters on each of its rendered lines.
import type { Page } from 'playwright';

/** The UI face's stack (--font-ui) leads with Outfit; the reading serif's with Newsreader. */
const UI_FACE = /^["']?Outfit["']?,/;
/** The body size rows use, the token the read is set at. */
const BODY_TOKEN = '--t-md';
/** The most characters a full line of the read may carry: about 60, a word's slack over it. */
const MOST_PER_LINE = 66;
/** Rounding in a computed size, px. */
const SLACK_PX = 0.5;

interface Face {
	family: string;
	size: number;
	style: string;
}

interface Faces {
	body: Face | null;
	byline: Face | null;
	caption: number | null;
	bodySize: number;
	/** Characters on each rendered line of the read, in order. */
	lines: number[];
}

export interface ReadFace {
	faults: string[];
	lines: number[];
}

export async function readFace(page: Page, root: string): Promise<ReadFace> {
	const faces = await page.evaluate(
		([scope, token]): Faces => {
			const face = (el: Element | null): Face | null => {
				if (el === null) return null;
				const style = getComputedStyle(el);
				return {
					family: style.fontFamily,
					size: parseFloat(style.fontSize),
					style: style.fontStyle
				};
			};
			const probe = document.createElement('span');
			probe.style.fontSize = `var(${token})`;
			document.body.appendChild(probe);
			const bodySize = parseFloat(getComputedStyle(probe).fontSize);
			probe.remove();
			const at = document.querySelector(scope);
			const caption = at?.querySelector('.tile .cap') ?? null;
			// Each character's line by its box's top, counted per line.
			const lines: number[] = [];
			const text = at?.querySelector('.prose.week p:not(.byline)')?.firstChild ?? null;
			if (text !== null && text.nodeType === Node.TEXT_NODE) {
				const range = document.createRange();
				let top: number | null = null;
				for (let i = 0; i < (text.textContent ?? '').length; i += 1) {
					range.setStart(text, i);
					range.setEnd(text, i + 1);
					const box = range.getClientRects()[0];
					if (box === undefined) continue;
					if (top === null || box.top > top + 1) {
						lines.push(0);
						top = box.top;
					}
					lines[lines.length - 1] = (lines[lines.length - 1] ?? 0) + 1;
				}
			}
			return {
				lines,
				body: face(at?.querySelector('.prose.week p:not(.byline)') ?? null),
				byline: face(at?.querySelector('.prose.week p.byline') ?? null),
				caption: caption === null ? null : parseFloat(getComputedStyle(caption).fontSize),
				bodySize
			};
		},
		[root, BODY_TOKEN] as const
	);
	const faults: string[] = [];
	for (const [what, face] of [
		['the read', faces.body],
		['its byline', faces.byline]
	] as const) {
		if (face === null) continue;
		if (!UI_FACE.test(face.family)) faults.push(`${what} is set in ${face.family}`);
		if (face.style !== 'normal') faults.push(`${what} is ${face.style}`);
	}
	if (faces.body !== null && Math.abs(faces.body.size - faces.bodySize) > SLACK_PX)
		faults.push(
			`the read is ${String(faces.body.size)} px, the body size ${String(faces.bodySize)} px`
		);
	if (
		faces.caption !== null &&
		faces.byline !== null &&
		Math.abs(faces.byline.size - faces.caption) > SLACK_PX
	)
		faults.push(
			`the byline is ${String(faces.byline.size)} px, the captions ${String(faces.caption)} px`
		);
	const longest = Math.max(0, ...faces.lines);
	if (longest > MOST_PER_LINE)
		faults.push(
			`a line of the read runs ${String(longest)} characters (lines ${faces.lines.join(', ')})`
		);
	return { faults, lines: faces.lines };
}
