import { defineEnvVars } from '@sveltejs/kit/env';
import { parseApiUrl } from '#lib/api/config.ts';
import { parseBaseUrl, parseRunId } from '#lib/run/config.ts';

/** The build's inputs. The run is chosen at build, so both run variables are static: a deploy is one
 * run, and the Worker never reads a run at request time. The API's origin is fixed at build too, so a
 * deploy talks to one API. The R2 keys that sign the build's reads are not app env at all:
 * src/lib/server/run.ts reads them from the build's environment. */
export const variables = defineEnvVars({
	PUBLIC_RUN_ID: {
		public: true,
		static: true,
		schema: parseRunId,
		description: 'The nightly run the build prerenders, like 2026-10-12T05, or latest.'
	},
	PUBLIC_RUN_BASE_URL: {
		public: true,
		static: true,
		schema: parseBaseUrl,
		description: 'The folder holding runs/: an https URL, or a directory relative to web/.'
	},
	PUBLIC_API_URL: {
		public: true,
		static: true,
		schema: parseApiUrl,
		description: 'The request API the user pages call, like https://api.trycommish.app.'
	}
});
