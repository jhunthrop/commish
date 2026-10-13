import { defineEnvVars } from '@sveltejs/kit/env';

/** The site's environment, read from `$app/env/public`. Every variable is public and set at build:
 * the site holds no secret. */
export const variables = defineEnvVars({
	PUBLIC_API_BASE_URL: {
		public: true,
		static: true,
		description:
			'The Go API the user pages call, https://api.trycommish.app in production. Set http://localhost:8080 to develop against a local api.',
		schema: (value) => (value === undefined || value === '' ? 'https://api.trycommish.app' : value)
	}
});
