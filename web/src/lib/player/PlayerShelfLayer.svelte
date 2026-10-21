<script lang="ts">
	import { onMount } from 'svelte';
	import type PlayerShelfComponent from './PlayerShelf.svelte';
	import { loadShelf } from './shelf-host.ts';
	import type { ShelfHost } from './shelf-state.ts';

	/** Where a screen's player shelf draws (Lane 113): nothing until a row's name is tapped, then the
	 * shelf. Its script is not in the screen's: it loads once the screen is idle (or at a finger on a
	 * name, or at the tap), so the tap draws the row's cells at once. */
	interface Props {
		host: ShelfHost;
	}

	let { host }: Props = $props();

	let Shelf = $state<typeof PlayerShelfComponent | null>(null);
	const slug = $derived(host.slug);

	function load(): void {
		void loadShelf().then((module) => (Shelf = module.default));
	}

	$effect(() => {
		if (slug !== null && Shelf === null) load();
	});

	/** Closed by any way (Escape, back, the verb), the focus goes back to the name tapped. */
	let wasOpen = false;
	$effect(() => {
		const open = slug !== null;
		if (wasOpen && !open) host.refocus();
		wasOpen = open;
	});

	/** How long after the screen's first paint the shelf's script may load at the latest. */
	const IDLE_WAIT_MS = 2000;

	onMount(() => {
		host.restore();
		// Safari has no idle callback: the wait alone stands in.
		if (!('requestIdleCallback' in window)) {
			const timer = setTimeout(load, IDLE_WAIT_MS);
			return () => clearTimeout(timer);
		}
		const idle = window.requestIdleCallback(load, { timeout: IDLE_WAIT_MS });
		return () => window.cancelIdleCallback(idle);
	});
</script>

{#if slug !== null && Shelf !== null}
	{#key slug}
		<Shelf {slug} {host} />
	{/key}
{/if}
