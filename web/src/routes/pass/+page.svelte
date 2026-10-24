<script lang="ts">
	import PassPage from '#lib/pass/PassPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PassPage weekLabel={data.weekLabel} builtFree={data.freeSeason} head={data.head} />
