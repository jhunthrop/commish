import { buildWeekLabel } from '#lib/server/build-week.ts';
import type { PageServerLoad } from './$types';

/** The rail's week item named at build, so the prerendered shell paints it (Lane 143, B126). */
export const load: PageServerLoad = buildWeekLabel;
