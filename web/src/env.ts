import { defineEnvVars } from '@sveltejs/kit/env';
import { parseApiUrl } from '#lib/api/config.ts';

/** The build's inputs. The API's origin is fixed at build, so a deploy talks to one API. */
export const variables = defineEnvVars({
	PUBLIC_API_URL: {
		public: true,
		static: true,
		schema: parseApiUrl,
		description: 'The request API the user pages call, like https://api.trycommish.app.'
	}
});
