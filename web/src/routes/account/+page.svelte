<script lang="ts">
	import AccountPage from '#lib/account/AccountPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AccountPage weekLabel={data.weekLabel} />
