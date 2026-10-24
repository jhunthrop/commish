/** Every page's HTML as the hooks finish it (hooks.server.ts), from one definition each: the theme's
 * and the league context's boot scripts (theme.ts, context/boot.ts), the installable app's head tags
 * and the rail's place in every season phase (app-manifest.ts, rail-css.ts), and the rail's glyphs
 * (rail-icons.ts), so no page's script carries them. A prerendered page also names the build's rail
 * on its root (spec 2026-10-16 §2: the static HTML carries the build's rail), so a reader whose boot
 * script never runs sees the season's rail; the boot script still sets it before the first paint
 * for a session's own rail. Pure, so the tests read the HTML the build writes. */
import { RAIL_ATTR, contextBootScript } from '#lib/context/boot.ts';
import { appHeadTags } from '#lib/site/app-manifest.ts';
import type { RailKey } from '#lib/ui/nav.ts';
import { railCss } from '#lib/ui/rail-css.ts';
import { railSprite } from '#lib/ui/rail-icons.ts';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';
const APP_HEAD_PLACEHOLDER = '%commish.appHead%';
const RAIL_SPRITE_PLACEHOLDER = '%commish.railSprite%';
/** The rail's glyphs, once a page at the top of its body. */
const RAIL_SPRITE = railSprite();
/** The manifest link, the chrome's colours and the rail's place in every season phase are the same
 * on every page. */
const APP_HEAD = `${appHeadTags()}<style>${railCss()}</style>`;
/** The document's root element's opening tag, as app.html writes it, its attributes captured. */
const ROOT = /<html((?:\s[^>]*)?)>/;

/** One chunk of a page's HTML, finished. `rail` is the site's rail at build, null for a page drawn
 * at request time, whose root names none (the boot script takes the last build's). `head` is the
 * page's own head for a page the browser draws (server/worker-head.ts), empty for every other. */
export function pageChunk(html: string, rail: RailKey | null, head = ''): string {
	const finished = html
		.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT + contextBootScript(rail))
		.replace(APP_HEAD_PLACEHOLDER, APP_HEAD + head)
		.replace(RAIL_SPRITE_PLACEHOLDER, RAIL_SPRITE);
	return rail === null ? finished : finished.replace(ROOT, `<html$1 ${RAIL_ATTR}="${rail}">`);
}
