<script lang="ts">
	import SheetPage from '#lib/sheet/SheetPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SheetPage weekLabel={data.weekLabel} />
