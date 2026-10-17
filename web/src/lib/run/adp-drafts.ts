/** The drafts behind a format's ADP as a basis names them: "PPR drafts, Sep 9", each source the
 * format blends with its window. One place, for every page that prints an ADP. */
import { windowLabel } from '#lib/format/date.ts';
import type { AdpSource } from './schema.ts';

export function adpDrafts(sources: readonly AdpSource[], formatId: string): string[] {
	return sources
		.filter((source) => source.formats.includes(formatId))
		.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
}
