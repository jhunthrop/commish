/** The origins the build is served from, in one place.
 *
 * SITE_ORIGIN is the site: its pages carry the member's session (the API's cookies are set for
 * `.trycommish.app`). ESPN_SIGN_IN_ORIGIN is the same build on the Worker's workers.dev address
 * (web/wrangler.jsonc `name`, the account's workers.dev subdomain, deployed by web.yml's "workers.dev
 * preview" step): no Commish cookie is ever set there, so Disney's ESPN sign-in runs on it, in a
 * window of its own, and hands the two ESPN values to the site by postMessage (Lane 21 review, M2). */
export const SITE_ORIGIN = 'https://trycommish.app';
export const ESPN_SIGN_IN_ORIGIN = 'https://commish-web.jhunthrop.workers.dev';
