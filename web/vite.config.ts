import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SHELL_HREFS } from './src/lib/ui/nav.ts';

const NOT_FOUND = 404;
/** A route's stylesheets under this many characters ride in the HTML, so a prerendered page paints
 * on its first response. The design system's CSS for a whole page sits well under it. */
const INLINE_STYLE_LIMIT = 32_768;
const PRERENDER_CONCURRENCY = 8;
/** A component joins the shared chunk once this many routes use it. Fewer, and every page would
 * carry code only a couple of pages run. */
const SHARED_BY_ROUTES = 4;

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			inlineStyleThreshold: INLINE_STYLE_LIMIT,
			prerender: {
				// Pages read one shared, memoized run, so several can render at once.
				concurrency: PRERENDER_CONCURRENCY,
				// The shell links to every section from day one. A section's route arrives with its
				// lane, so until then a 404 on exactly a shell link is expected. Any other failure fails the build.
				handleHttpError: ({ status, path, message }) => {
					if (status === NOT_FOUND && SHELL_HREFS.includes(path)) return;
					throw new Error(message);
				}
			}
		})
	],
	build: {
		rolldownOptions: {
			output: {
				// Every request carries headers the script budget counts, so the client loads a few
				// larger files instead of thirty small ones: the framework in one, the components two
				// or more routes share in another, and each route's own code in its node.
				codeSplitting: {
					groups: [
						{ name: 'framework', test: /[\\/]node_modules[\\/]svelte[\\/]/, priority: 2 },
						{
							name: 'shared',
							test: (id: string) =>
								/[\\/]src[\\/]lib[\\/]/.test(id) && !/[\\/]ui[\\/]system[\\/]/.test(id),
							minShareCount: SHARED_BY_ROUTES,
							priority: 1
						}
					]
				}
			}
		}
	}
});
