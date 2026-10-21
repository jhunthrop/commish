// The week's read's face in season (Lane 126), measured in the browser for the shot scripts: the read
// is set in the UI face, never the reading serif, at most one type step over the tiles' captions, and
// its byline is a plain caption the size of theirs. Returns the faults, none when the read is not
// drawn under the root (a read not written yet).
import type { Page } from 'playwright';

/** One step on the type scale over the tiles' 11 px captions (--t-sm), in px. */
const ONE_STEP_PX = 2;
/** The UI face's stack (--font-ui) leads with Outfit; the reading serif's with Newsreader. */
const UI_FACE = /^["']?Outfit["']?,/;
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
}

export async function readFaceFaults(page: Page, root: string): Promise<string[]> {
	const faces = await page.evaluate((scope): Faces => {
		const face = (el: Element | null): Face | null => {
			if (el === null) return null;
			const style = getComputedStyle(el);
			return {
				family: style.fontFamily,
				size: parseFloat(style.fontSize),
				style: style.fontStyle
			};
		};
		const at = document.querySelector(scope);
		const caption = at?.querySelector('.tile .cap') ?? null;
		return {
			body: face(at?.querySelector('.prose.week p:not(.byline)') ?? null),
			byline: face(at?.querySelector('.prose.week p.byline') ?? null),
			caption: caption === null ? null : parseFloat(getComputedStyle(caption).fontSize)
		};
	}, root);
	const faults: string[] = [];
	for (const [what, face] of [
		['the read', faces.body],
		['its byline', faces.byline]
	] as const) {
		if (face === null) continue;
		if (!UI_FACE.test(face.family)) faults.push(`${what} is set in ${face.family}`);
		if (face.style !== 'normal') faults.push(`${what} is ${face.style}`);
	}
	if (
		faces.caption !== null &&
		faces.body !== null &&
		faces.body.size > faces.caption + ONE_STEP_PX + SLACK_PX
	)
		faults.push(
			`the read is ${String(faces.body.size)} px over ${String(faces.caption)} px captions`
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
