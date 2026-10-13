import { clubsPage } from '#lib/server/pages/clubs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ page: await clubsPage() });
