<script lang="ts">
	import { onMount } from 'svelte';
	import type PlayerShelfComponent from './PlayerShelf.svelte';
	import type { ShelfHost } from './shelf-state.ts';

	/** Where a screen's player shelf draws (Lane 113): nothing until a row's name is tapped, then the
	 * shelf, loaded the first time, so a screen carries none of its script before. */
	interface Props {
		host: ShelfHost;
	}

	let { host }: Props = $props();

	let Shelf = $state<typeof PlayerShelfComponent | null>(null);
	const slug = $derived(host.slug);

	$effect(() => {
		if (slug !== null && Shelf === null)
			void import('./PlayerShelf.svelte').then((module) => (Shelf = module.default));
	});

	/** Closed by any way (Escape, back, the verb), the focus goes back to the name tapped. */
	let wasOpen = false;
	$effect(() => {
		const open = slug !== null;
		if (wasOpen && !open) host.refocus();
		wasOpen = open;
	});

	onMount(() => host.restore());
</script>

{#if slug !== null && Shelf !== null}
	{#key slug}
		<Shelf {slug} {host} />
	{/key}
{/if}
