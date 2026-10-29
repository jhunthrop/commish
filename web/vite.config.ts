import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { shellHrefs } from './src/lib/ui/nav.ts';

const NOT_FOUND = 404;
const SHELL_HREFS = shellHrefs();
/** A route's stylesheets under this many characters ride in the HTML, so a prerendered page paints
 * on its first response. The design system's CSS for a whole page sits well under it. */
const INLINE_STYLE_LIMIT = 32_768;
const PRERENDER_CONCURRENCY = 8;
/** A board row and its cells, with the row's sheet mark and tags, its framing, the table that sets
 * its columns and their sort, the basis line and its words (Lane 66n), and the words of the pages
 * that draw rows and follow the season: the board, ADP, a club and the front door draw them, a
 * player page never does, so they load as one file with the pages that draw rows. */
const ROW_PARTS =
	/[\\/]src[\\/]lib[\\/](ui[\\/](Row|RowHead|BoardTable|BasisLine|board-columns|board-sort|RangeBar|SheetMark|ValueCell|NameWords|Place)\.|site[\\/](RowSheetMark|RowSheetTags|season-words|shown-rail\.svelte|verb-links)\.|run[\\/](row-framing|board-basis|adp-drafts)\.|format[\\/]gap\.)/;
/** The board and ADP pages' own parts: the views, the tier strip, the rail's jump list and toggles,
 * the follow of the switch's format, the chips, and a missing format's page. One file for those
 * pages. */
const BOARD_PARTS =
	/[\\/]src[\\/]lib[\\/](ui[\\/](TierStrip|TierJump|Toggle|Chip|ChipGroup|chips|FilterBar|BasisList)\.|site[\\/](BoardView|BoardPageView|AdpView|AbsentFormatView|absent)\.|context[\\/]follow\.)/;
/** What only the user pages run: the mock room and its parts (the call card and the facts strip the
 * setup, the report and the pass draw), the account, the pass and the live
 * draft companion, the connected hosts (FFPC, Yahoo, ESPN), the request API client and the sheet's
 * store. A nightly page never loads any of it with the page; the sheet arrives on a reader's first
 * intent, the rest only on the pages that call the API. The league's held places, their marks' words and
 * their forgetting (context/held.ts, held-marks.ts, ui/HeldMark, forget.ts) ride here too (the marks named since Lane
 * 284: the old pattern missed it, so every page carried the marks' words): the league pages, the account and its delete page load
 * them, and the shell only ever imports the held places on demand (Lane 233). */
const USER_PAGE_PARTS =
	/[\\/]src[\\/]lib[\\/](room|account|api|sheet|pass|companion|hosts)[\\/]|[\\/]src[\\/]lib[\\/]ui[\\/](CallPanel|FactStrip|facts|TeamPanel|PickStrip|StillThereCell|ToneChip|Stepper|TextInput|ScoreBug|SinceStrip|Keys|HeldMark)\.|[\\/]src[\\/]lib[\\/]run[\\/]market\.|[\\/]src[\\/]lib[\\/]context[\\/](held|held-marks|forget)\./;
/** What the player, club and compare pages draw and the others never do: a player's line, the
 * crumb, the outcome bar, the tier mates, the capsule and a fact. One file for those pages. */
const PLAYER_PARTS =
	/[\\/]src[\\/]lib[\\/]ui[\\/](PlayerLine|EmptyState|Crumb|OutcomeBar|TierMates|Capsule|Fact)\./;
/** What the front door, the club, player and record pages draw and the board and ADP pages never do:
 * the table and its line list, the hero card and the footnote. One file for those pages. */
const FIGURE_PARTS = /[\\/]src[\\/]lib[\\/]ui[\\/](Table|LineList|HeroCard|Footnote)\./;
/** The forms' parts, which only the user pages draw: the menu, the field, the tag chip, the action
 * bar, the problem line, the consent, the live region, the theme switch, the held height, the
 * sentence joiner, the list joiner and the site's flags. One file for the pages that draw them. */
const FORM_PARTS =
	/[\\/]src[\\/]lib[\\/](ui[\\/](Menu|Field|TagChip|ActionBar|ProblemLine|Consent|LiveRegion|theme|hold-height)\.|format[\\/](sentence|list)\.|site[\\/]flags\.)/;
/** What only a followed league's pages (the league page and its three in-season screens), the
 * account's leagues and the attach page run: the league row, the board read, the league's words and
 * calls, the in-season screens, the season's words, the member's clock and the rail's order a
 * league's tabs read, the switch's choice made on opening a league, and the box score's parts with
 * the club's mark and nickname (Lane 66d, the mark shared with the draft room), and the game's facts in
 * words, which the player card's week reads too, and Lane 63's status pill, which the player card
 * draws too (Lane 66h), the League page's board parts and the front door's week band (Lane 66k,
 * loaded on demand), and the order's screens the board and Players pages load after their first
 * paint (Lane 66j), and the player shelf those screens open with the card's words and parts it
 * shares with his page (Lane 113). Four league pages
 * share them, so they are kept out of the shared chunk by name, and the bundler splits them among
 * the pages that load them. (A group of their own would pull in everything they import, the API
 * client too, and land it on every page that reads the API.) */
const LEAGUE_PAGE_PARTS =
	/[\\/]src[\\/]lib[\\/](league[\\/](LeagueRow|board|model|api|follow-switch\.svelte|phase-words|sheet-tags)\.|league[\\/](inseason|box|home)[\\/]|front[\\/]|order[\\/]|context[\\/]choose\.svelte\.|player[\\/](shelf|shelf-context|shelf-state|shelf-host|PlayerShelfLayer|PlayerShelf|card|card-source|CardTiles|CardNext)\.|format[\\/](clock|clubs|game-facts)\.|ui[\\/](rail-order|club-mark|ClubMark|StatusPill|StatusChip)\.)/;
/** Lane 63's status pill and its chip, which the board row (Lane 66n), the player card, the league's
 * rows and the front door's week draw: a group of its own, listed ahead of the rows group, so the rows
 * group does not pull it in and a player page never loads the board row's chunk for it. The chip's
 * styles are base.css's, so every prerendered page paints it styled (review 66n finding 1). */
const PILL_PARTS = /[\\/]src[\\/]lib[\\/]ui[\\/](StatusPill|StatusChip)\./;
/** A player's injury status in words on the member's clock (Lane 63): the designation's words, which
 * the league's screens import and the board, player and record pages load after their first paint.
 * The held places' pill rank joins them now the player card draws the status pill (Lane 66h), and the
 * tiers the held places draw without a held player (run/tiers.ts, Lane 66q). Kept out of the shared
 * chunk by name, as the league's parts are. */
/** The live clock the board, player and record pages call to say their status words again on the
 * member's clock: a few lines with no import but the words' own lazy one, in a file of its own, so
 * neither the shared chunk nor a page's group carries it for the others. */
const LIVE_STATUS = /[\\/]src[\\/]lib[\\/]run[\\/]live-status\./;
/** The list joiner (format/list.ts), five lines the board's absent format, the record's league
 * lineup, the league pages and the user pages say lists with: a file of its own, so the record's
 * league code never loads the board's chunk for it (Lane 253). */
const LIST_WORDS = /[\\/]src[\\/]lib[\\/]format[\\/]list\./;
/** The site's one word per figure (format/figure-words.ts, the sweep's X1 and X2): the board row's
 * heads, the order's, the box score's and the player card's read it (with its table, the API's
 * words.json), and no shell part does. It rides
 * in the pill's group, which every page that draws those heads already loads, so neither the shared
 * chunk nor a page's own group carries it for the others. */
const FIGURE_WORDS =
	/[\\/]src[\\/]lib[\\/]format[\\/]figure-words\.|[\\/]api[\\/]internal[\\/]figurewords[\\/]words\.json/;
const STATUS_PARTS =
	/[\\/]src[\\/]lib[\\/](format[\\/]designation\.|run[\\/](status-view|held-places|tiers)\.)/;
/** The board's status rule (Lane 63), which the board page draws on its first paint and the order's
 * screens after theirs (Lane 66j): kept out of the shared chunk by name, so loading the order's
 * screens never hoists it onto every page. */
const WEEK_PARTS = /[\\/]src[\\/]lib[\\/]run[\\/]board-status\./;
/** The counts' pool words (format/pool-words.ts, the sweep's M4): the order's hits, the sheet's start
 * and the room's pool name their pools with them, and no shell part does (the front door's count is
 * worded at build). Kept out of the shared chunk by name, so the room naming its pool never hoists them
 * onto every page. */
const POOL_WORDS = /[\\/]src[\\/]lib[\\/]format[\\/]pool-words\./;
/** The basis block under a box score or an order (ui/BasisBlock): the record's sections, the order's
 * screens and the league's box screens draw it, and the front door never does. Kept out of the shared
 * chunk by name, so the every-league Lineup (Lane 257), a fourth route that draws it, never hoists it
 * onto every page. */
const BASIS_PARTS = /[\\/]src[\\/]lib[\\/]ui[\\/]BasisBlock\./;
/** A component joins the shared chunk once this many routes use it. Fewer, and every page would
 * carry code only a couple of pages run. */
const SHARED_BY_ROUTES = 4;

export default defineConfig({
	// An explicit, empty PostCSS config: without it Vite walks up from web/ and finds the root Next
	// app's postcss.config.mjs, whose plugin only the root install has, which failed the first CI build.
	css: { postcss: { plugins: [] } },
	// The sources the web shares with the apps (shared/: the banned list, Lane 171) sit beside web/, so
	// the dev server may serve them; the workspace root stays allowed, as it is when nothing is listed.
	server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../shared'] } },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Absolute asset paths on every page (Lane 148 fix round 1): the not-found page is one
			// file the Worker serves at any depth (/players/no-such-player), where relative ones
			// would resolve under the missing page's folder and its scripts would never load.
			paths: { relative: false },
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
								!FORM_PARTS.test(id) &&
								!ROW_PARTS.test(id) &&
								!BOARD_PARTS.test(id) &&
								!PLAYER_PARTS.test(id) &&
								!FIGURE_PARTS.test(id) &&
								!STATUS_PARTS.test(id) &&
								!LIVE_STATUS.test(id) &&
								!FIGURE_WORDS.test(id) &&
								!WEEK_PARTS.test(id) &&
								!POOL_WORDS.test(id) &&
								!BASIS_PARTS.test(id) &&
								!LEAGUE_PAGE_PARTS.test(id),
							minShareCount: SHARED_BY_ROUTES,
							priority: 1
						},
						{
							name: 'pill',
							test: (id: string) => PILL_PARTS.test(id) || FIGURE_WORDS.test(id),
							minShareCount: 2,
							priority: 1
						},
						{ name: 'rows', test: ROW_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'board', test: BOARD_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'player', test: PLAYER_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'figure', test: FIGURE_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'forms', test: FORM_PARTS, minShareCount: 2, priority: 1 },
						{ name: 'live', test: LIVE_STATUS, minShareCount: 2, priority: 2 },
						{ name: 'list', test: LIST_WORDS, minShareCount: 2, priority: 2 }
					]
				}
			}
		}
	}
});
