import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SHELL_HREFS } from './src/lib/ui/nav.ts';

const NOT_FOUND = 404;
/** A route's stylesheets under this many characters ride in the HTML, so a prerendered page paints
 * on its first response. The design system's CSS for a whole page sits well under it. */
const INLINE_STYLE_LIMIT = 32_768;
const PRERENDER_CONCURRENCY = 8;
/** A board row and its cells, with the row's sheet mark and its season figures: the board, ADP, a
 * club and the front door draw them, a player page never does, so they load as one file with the
 * pages that draw rows. */
const ROW_PARTS =
	/[\\/]src[\\/]lib[\\/](ui[\\/](Row|RowHead|RangeBar|AdpCell|SheetMark|season-figures)\.|site[\\/]RowSheetMark\.)/;
/** The board and ADP pages' own parts: the views, the tier strip, the rail's jump list and toggles,
 * the follow of the switch's format, the chips, and a missing format's page. One file for those
 * pages. */
const BOARD_PARTS =
	/[\\/]src[\\/]lib[\\/](ui[\\/](TierStrip|TierJump|Toggle|Chip|ChipGroup|chips|FilterBar)\.|site[\\/](BoardView|BoardPageView|AdpView|AbsentFormatView|absent)\.|context[\\/]follow\.)/;
/** What only the user pages run: the mock room and its parts, the account, the pass and the live
 * draft companion, the request API client and the sheet's store. A nightly page never loads any of
 * it with the page; the sheet arrives on a reader's first intent, the rest only on the pages that
 * call the API. */
const USER_PAGE_PARTS =
	/[\\/]src[\\/]lib[\\/](room|account|api|sheet|pass|companion)[\\/]|[\\/]src[\\/]lib[\\/]ui[\\/](CallPanel|TeamPanel|PickStrip|OddsCell|ToneChip|Stepper|TextInput|ScoreBug|SinceStrip|Keys)\./;
/** A followed league's own parts that its page and its three in-season screens all draw: the row,
 * the board read, the tabs and the switch's follow. One file for those four pages. */
const LEAGUE_PARTS =
	/[\\/]src[\\/]lib[\\/]league[\\/](LeagueRow|board|follow-switch\.svelte|inseason[\\/](LeagueTabs|tabs))\./;
/** The in-season screens' own parts (start and sit, waivers, trades): one file for the three, none
 * of it on the league page or anywhere else. */
const IN_SEASON_PARTS = /[\\/]src[\\/]lib[\\/]league[\\/]inseason[\\/]/;
/** What only a followed league's pages, the account's leagues and the attach page run: the league
 * page's words (league/model.ts), the league calls (league/api.ts) and the switch's choice made on
 * opening a league (context/choose). No nightly page loads them with the page, so each stays its
 * own file however many league pages share it. */
const LEAGUE_ALONE = /[\\/]src[\\/]lib[\\/](league[\\/](model|api)\.|context[\\/]choose\.svelte\.)/;
/** A component joins the shared chunk once this many routes use it. Fewer, and every page would
 * carry code only a couple of pages run. */
const SHARED_BY_ROUTES = 4;

export default defineConfig({
	// An explicit, empty PostCSS config: without it Vite walks up from web/ and finds the root Next
	// app's postcss.config.mjs, whose plugin only the root install has, which failed the first CI build.
	css: { postcss: { plugins: [] } },
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
								/[\\/]src[\\/]lib[\\/]/.test(id) &&
								!/[\\/]ui[\\/]system[\\/]/.test(id) &&
								!USER_PAGE_PARTS.test(id) &&
								!ROW_PARTS.test(id) &&
								!BOARD_PARTS.test(id) &&
								!LEAGUE_PARTS.test(id) &&
								!IN_SEASON_PARTS.test(id) &&
								!LEAGUE_ALONE.test(id),
							minShareCount: SHARED_BY_ROUTES,
							priority: 1
						},
						{ name: 'rows', test: ROW_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'board', test: BOARD_PARTS, minShareCount: 2, priority: 1 }
					]
				}
			}
		}
	}
});
