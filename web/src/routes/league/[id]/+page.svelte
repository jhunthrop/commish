<script lang="ts">
	import { page } from '$app/state';
	import LeaguePage from '#lib/league/LeaguePage.svelte';
</script>

{#key page.params.id}
	<LeaguePage id={page.params.id ?? ''} />
{/key}
