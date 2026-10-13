<script lang="ts">
	import { page } from '$app/state';
	import CompanionPage from '#lib/companion/CompanionPage.svelte';
</script>

{#key page.params.id}
	<CompanionPage id={page.params.id ?? ''} />
{/key}
