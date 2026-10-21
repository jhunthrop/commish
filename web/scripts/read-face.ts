// The week's read's face in season (Lane 126), measured in the browser for the shot scripts: the read
// is set in the UI face, never the reading serif, at the body size rows use (--t-md), and its byline
// is a plain caption the size of the tiles' captions. Returns the faults, none when the read is not
// drawn under the root (a read not written yet).
import type { Page } from 'playwright';

/** The UI face's stack (--font-ui) leads with Outfit; the reading serif's with Newsreader. */
const UI_FACE = /^["']?Outfit["']?,/;
/** The body size rows use, the token the read is set at. */
const BODY_TOKEN = '--t-md';
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
}

export async function readFaceFaults(page: Page, root: string): Promise<string[]> {
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
			return {
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
	return faults;
}
