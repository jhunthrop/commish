/**
 * The empty sheets a visit saved (Lane 117, B84). Until Lane 105 (B52) a browser holding nothing on
 * an account with no sheet created an empty one on its first visit ("My sheet", Oct 13 on the
 * founder's account). Since then an empty sheet is never saved on a visit (sheet/sync.ts). The one
 * such sheet each account may still hold is removed on the next read of the account: a one-shot
 * cleanup inside that same rule, never a migration. A sheet the member made empty on purpose after
 * the fix, or any sheet written to since, is never touched.
 */
import type { components } from '#lib/api/types.ts';

type Sheet = components['schemas']['Sheet'];

/** The instant the web that never saves an empty sheet on a visit was live: its deploy of main
 * 07f11dc4 (Lane 105's merge fd473054 in it) finished at 00:00:35Z. */
export const VISIT_SAVES_ENDED_AT = '2026-10-21T00:01:00Z';

/** Whether a sheet is one a visit saved: no players, made before the visit save ended, and never
 * written to after it was made (a sheet a member made or cleared on purpose was written, review M2). */
export function visitSaved(sheet: Pick<Sheet, 'row_count' | 'created_at' | 'updated_at'>): boolean {
	return (
		sheet.row_count === 0 &&
		sheet.created_at === sheet.updated_at &&
		Date.parse(sheet.updated_at) < Date.parse(VISIT_SAVES_ENDED_AT)
	);
}

/** The account's sheets once the visit-saved ones are removed: each is deleted through `remove`,
 * and one whose delete fails stays listed, so the next read of the account tries it again. */
export async function withoutVisitSaved<
	S extends Pick<Sheet, 'id' | 'row_count' | 'created_at' | 'updated_at'>
>(sheets: readonly S[], remove: (id: string) => Promise<unknown>): Promise<S[]> {
	const saved = sheets.filter(visitSaved);
	const outcomes = await Promise.allSettled(saved.map((sheet) => remove(sheet.id)));
	const removed = new Set(
		saved.filter((_, i) => outcomes[i]?.status === 'fulfilled').map((sheet) => sheet.id)
	);
	return sheets.filter((sheet) => !removed.has(sheet.id));
}
