import { buildWeekLabel } from '#lib/server/build-week.ts';
import type { PageServerLoad } from './$types';

/** The rail's week item named at build, so the prerendered not-found page paints it (Lane 148). */
export const load: PageServerLoad = buildWeekLabel;
