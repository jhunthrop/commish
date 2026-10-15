<script lang="ts">
	import { page } from '$app/state';
	import ErrorView from '#lib/site/ErrorView.svelte';

	const NOT_FOUND = 404;
</script>

<ErrorView missing={page.status === NOT_FOUND} />
