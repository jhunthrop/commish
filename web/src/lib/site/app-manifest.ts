/**
 * The installable app: the web manifest (served at MANIFEST_PATH, src/routes/manifest.webmanifest)
 * and the head tags every page carries (put in by hooks.server.ts, so no page's script holds them).
 * The colours are the design tokens' (tokens.css, held equal by app-manifest.test.ts): the browser's
 * chrome takes the top bar's colour, the splash the page's. A manifest holds one colour, so it
 * carries the dark flagship; the theme-color tags give each operating-system theme its own.
 */

export const APP_NAME = 'Commish';
export const MANIFEST_PATH = '/manifest.webmanifest';
/** Where the installed app opens: the board, the site's front page for a drafter. */
const START_PATH = '/board';

interface ThemeColors {
	/** The top bar and rail, --shell. */
	chrome: string;
	/** The page, --bg. */
	page: string;
}

export const APP_COLORS: Readonly<Record<'light' | 'dark', ThemeColors>> = {
	light: { chrome: '#ffffff', page: '#ffffff' },
	dark: { chrome: '#050404', page: '#090807' }
};

export interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose: 'any' | 'maskable';
}

const PNG = 'image/png';

/** The mark on the dark page colour (scripts/app-icons.ts draws them from ui/mark.ts). */
export const APP_ICONS = {
	small: { src: '/icons/icon-192.png', sizes: '192x192', type: PNG, purpose: 'any' },
	large: { src: '/icons/icon-512.png', sizes: '512x512', type: PNG, purpose: 'any' },
	maskable: { src: '/icons/maskable-512.png', sizes: '512x512', type: PNG, purpose: 'maskable' },
	appleTouch: { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: PNG, purpose: 'any' }
} as const satisfies Record<string, ManifestIcon>;

export interface WebManifest {
	name: string;
	short_name: string;
	description: string;
	id: string;
	start_url: string;
	scope: string;
	display: 'standalone';
	theme_color: string;
	background_color: string;
	icons: ManifestIcon[];
}

export function webManifest(): WebManifest {
	return {
		name: APP_NAME,
		short_name: APP_NAME,
		description:
			'Fantasy football all season: your lineup, matchup, waivers and trades, our board, every player, mock drafts and your sheet.',
		id: START_PATH,
		start_url: START_PATH,
		scope: '/',
		display: 'standalone',
		theme_color: APP_COLORS.dark.chrome,
		background_color: APP_COLORS.dark.page,
		icons: [APP_ICONS.small, APP_ICONS.large, APP_ICONS.maskable]
	};
}

/** The tags in every page's head: the manifest, the chrome's colour per theme, the iOS icon. */
export function appHeadTags(): string {
	return [
		`<link rel="manifest" href="${MANIFEST_PATH}">`,
		`<meta name="theme-color" media="(prefers-color-scheme: light)" content="${APP_COLORS.light.chrome}">`,
		`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${APP_COLORS.dark.chrome}">`,
		`<link rel="apple-touch-icon" href="${APP_ICONS.appleTouch.src}">`
	].join('\n\t\t');
}
