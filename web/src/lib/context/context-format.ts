/** The run format the site's context opens pages in, and the figures a page leads with: read by the
 * player page and compare. Apart from follow.svelte.ts, which only the
 * format pages carry. */
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
