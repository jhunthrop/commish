<script lang="ts">
	import AbsentFormatView from '#lib/site/AbsentFormatView.svelte';
	import BoardPageView from '#lib/site/BoardPageView.svelte';
	import { links } from '#lib/site/links.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.view.kind === 'board'}
	<BoardPageView page={data.view.page} run={data.run} />
{:else}
	<AbsentFormatView page={data.view.page} run={data.run} noun="Board" href={links.board} />
{/if}
