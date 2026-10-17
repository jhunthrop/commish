/** The front door's one in-season read (Lane 66k): GET /me/week, every followed league's week. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { MemberWeek } from './week.ts';

const client = apiClient(PUBLIC_API_URL);

export const weekApi = {
	week: () => client.call<MemberWeek>('/me/week')
};
