<script lang="ts">
	import BoardPageView from '#lib/site/BoardPageView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<BoardPageView page={data.page} run={data.run} />
