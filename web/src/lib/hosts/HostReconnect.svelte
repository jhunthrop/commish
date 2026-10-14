<script lang="ts">
	import FFPCSignIn from './FFPCSignIn.svelte';
	import YahooConnect from './YahooConnect.svelte';
	import type { components } from '#lib/api/types.ts';

	/** The way back in for a league read as a member, on its own host's terms: FFPC's sign-in form
	 * here, or Yahoo's own sign-in one verb away. */
	interface Props {
		host: components['schemas']['LeagueHost'];
		/** FFPC signed in again here: the league reads now. */
		onconnected: () => void;
	}

	let { host, onconnected }: Props = $props();
</script>

{#if host === 'yahoo'}
	<YahooConnect label="Connect Yahoo again" />
{:else}
	<FFPCSignIn onconnected={() => onconnected()} />
{/if}
