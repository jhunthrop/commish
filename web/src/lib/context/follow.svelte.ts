/** A format page follows the site's context: the board and ADP open in the context's format, and a
 * switch in the shell turns the page into that format's in place, from the run's own prerendered
 * data (no reload, the scroll and focus kept). The page's format chooser no longer owns the choice. */
import { goto } from '$app/navigation';
import { runFormatId } from '#lib/run/format-ids.ts';
import { siteContext } from './context.svelte.ts';

/** The run format id the context opens pages in, null when it names none or the run does not carry
 * it (the page stays in its own, and its basis line says the run has no board in the league's). */
export function contextFormatId(carried: readonly string[]): string | null {
	const format = siteContext.format;
	if (format === null) return null;
	const id = runFormatId(format);
	return carried.includes(id) ? id : null;
}

/** Of a page's figures in every format, the ones it leads with: the context's format when the run
 * carries it, else the first (the run's default). Read inside a $derived, it turns with the switch. */
export function contextLine<T extends { format: { id: string } }>(
	lines: readonly T[]
): T | undefined {
	const id = contextFormatId(lines.map((line) => line.format.id));
	return lines.find((line) => line.format.id === id) ?? lines[0];
}

/** Call from a format page's script: `current` is the run format id on the page, `carried` every
 * format the run carries, `href` the same view's page in another format. */
export function followFormat(
	current: () => string,
	carried: () => readonly string[],
	href: (formatId: string) => string
): void {
	$effect(() => {
		const id = contextFormatId(carried());
		if (id !== null && id !== current()) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from links.ts, built with resolve().
			void goto(href(id), { replace: true, reset: false });
		}
	});
}
