// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** The player whose card is open over a screen, by his page's slug (Lane 113, the player
			 * shelf). */
			card?: string;
			/** The block the card is open in, on a page of many (the every-league page, Lane 257). */
			cardIn?: string;
		}
	}
}

export {};
