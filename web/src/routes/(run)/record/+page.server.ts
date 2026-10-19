import { buildInstant } from '#lib/server/build-clock.ts';
import { recordPage } from '#lib/server/pages/record.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ page: await recordPage(buildInstant()) });
