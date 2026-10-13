<script lang="ts">
	import AbsentFormatView from '#lib/site/AbsentFormatView.svelte';
	import AdpView from '#lib/site/AdpView.svelte';
	import { links } from '#lib/site/links.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.view.kind === 'adp'}
	<AdpView page={data.view.page} run={data.run} />
{:else}
	<AbsentFormatView page={data.view.page} run={data.run} noun="ADP" href={links.adp} />
{/if}
