<script lang="ts">
	import { page } from '$app/state';
	import ClaimPage from '#lib/pass/ClaimPage.svelte';
</script>

{#key page.params.code}
	<ClaimPage code={page.params.code ?? ''} />
{/key}
