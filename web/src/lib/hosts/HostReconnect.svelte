<script lang="ts">
	import ESPNConnect from './ESPNConnect.svelte';
	import FFPCSignIn from './FFPCSignIn.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import type { components } from '#lib/api/types.ts';

	/** The way back in for a league read as a member, on its own host's terms: FFPC's sign-in form
	 * here, Yahoo's own sign-in one verb away, or ESPN's through Disney's. */
	interface Props {
		host: components['schemas']['LeagueHost'];
		/** Connected again here: the league reads now. */
		onconnected: () => void;
		/** The league's page, where Yahoo's sign-in comes back to. */
		returnTo?: string;
	}

	let { host, onconnected, returnTo }: Props = $props();
</script>

{#if host === 'yahoo'}
	<YahooConnect label="Connect Yahoo again" {returnTo} />
{:else if host === 'espn'}
	<ESPNConnect label="Connect ESPN again" onconnected={() => onconnected()} />
{:else}
	<FFPCSignIn onconnected={() => onconnected()} />
{/if}
