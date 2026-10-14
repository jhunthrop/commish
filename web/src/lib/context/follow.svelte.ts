/** A format page follows the site's context. A page whose address names no format (/board, the
 * rail's Board) opens in the context's format; a page whose address names one shows that format for
 * the visit, so a shared link and the back button mean what they say; and every format page turns
 * with the switch when the reader uses it, in place, from the run's own prerendered data (no
 * reload, the scroll and focus kept). */
import { goto } from '$app/navigation';
import { page as route } from '$app/state';
import { contextFormatId } from './context-format.ts';
import { siteContext } from './context.svelte.ts';
/** Call from a format page's script: `current` is the run format id on the page, `carried` every
 * format the run carries, `href` the same view's page in another format. An address that names the
 * format (a `[format]` route) moves only with a choice made in the switch. */
export function followFormat(
	current: () => string,
	carried: () => readonly string[],
	href: (formatId: string) => string
): void {
	// The choices made when this page's format arrived: a new address is a new arrival.
	let page = '';
	let arrivedAt = 0;
	$effect(() => {
		const here = current();
		if (here !== page) {
			page = here;
			arrivedAt = siteContext.choices;
		}
		const id = contextFormatId(carried());
		if (id === null || id === here) return;
		if (route.params.format !== undefined && siteContext.choices === arrivedAt) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from links.ts, built with resolve().
		void goto(href(id), { replace: true, reset: false });
	});
}
