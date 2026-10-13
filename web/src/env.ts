import { defineEnvVars } from '@sveltejs/kit/env';
import { parseBaseUrl, parseRunId } from '#lib/run/config.ts';

/** The build's inputs. The run is chosen at build, so both run variables are static: a deploy is one
 * run, and the Worker never reads a run at request time. The R2 keys are read during the build only. */
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
	R2_ACCESS_KEY_ID: {
		schema: (value) => value,
		description: 'Signs run reads from R2 at build. Unset for a local run directory.'
	},
	R2_SECRET_ACCESS_KEY: {
		schema: (value) => value,
		description: 'Signs run reads from R2 at build. Unset for a local run directory.'
	}
});
