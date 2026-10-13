import { frontPage } from '#lib/server/pages/front.ts';
import type { PageServerLoad } from './$types';

/** The front door, built from the run like every nightly page. */
export const load: PageServerLoad = async () => ({ page: await frontPage() });
