<script lang="ts">
	import AdpView from '#lib/site/AdpView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AdpView page={data.page} run={data.run} />
