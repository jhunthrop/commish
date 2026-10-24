<script lang="ts">
	import PrintSheet from '#lib/sheet/PrintSheet.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PrintSheet head={data.head} />
