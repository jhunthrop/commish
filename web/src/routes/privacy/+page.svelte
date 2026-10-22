<script lang="ts">
	import LegalPage from '#lib/legal/LegalPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<LegalPage doc={data.doc} hrefs={data.hrefs} weekLabel={data.weekLabel} />
