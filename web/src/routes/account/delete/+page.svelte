<script lang="ts">
	import DeletePage from '#lib/account/DeletePage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DeletePage weekLabel={data.weekLabel} head={data.head} />
