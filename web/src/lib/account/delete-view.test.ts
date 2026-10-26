// The delete account page's states as they render (Lane 233 review L7) and the one-time mark behind
// the page after (L6): the verb waits for the typed email, each state says its own words, and
// "Your account is deleted" shows only to the tab that just deleted. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { compiled } from '#lib/testing/svelte-ssr.ts';
import type { DeleteState } from './delete-api.ts';
import { DELETE_WORDS } from './delete-words.ts';
import { DELETED_KEY, markDeleted, takeDeleted } from './deleted-flag.ts';

const EMAIL = 'pat@example.invalid';
/** A render never calls the verbs; a call would fail the test. */
const unused = (): void => {
	throw new Error('a render called a verb');
};
const SIGN_IN = 'https://api.example.test/auth/login?return_to=%2Faccount%2Fdelete';

interface ViewProps {
	view: DeleteState;
	typed?: string;
	busy?: boolean;
	problem?: string | null;
	signInHref: string;
	homeHref: string;
	onremove: () => void;
	onretry: () => void;
}

async function view(props: Omit<ViewProps, 'signInHref' | 'homeHref' | 'onremove' | 'onretry'>) {
	const mod = (await import(compiled(new URL('./DeleteView.svelte', import.meta.url)))) as {
		default: Component<ViewProps>;
	};
	return render(mod.default, {
		props: { signInHref: SIGN_IN, homeHref: '/', onremove: unused, onretry: unused, ...props }
	}).body;
}

/** The verb's button: its whole tag, to read whether it is disabled. */
function verbTag(html: string): string {
	const tag = [...html.matchAll(/<button[^>]*>/g)]
		.map((m) => m[0])
		.find((t) => t.includes('submit'));
	assert.ok(tag, 'no submit button');
	return tag;
}

void test('signed in: both lists, the email named, and the verb waits for the email to match', async () => {
	const blank = await view({ view: { kind: 'signed-in', email: EMAIL } });
	assert.ok(blank.includes(DELETE_WORDS.heading));
	for (const line of [...DELETE_WORDS.deleted, ...DELETE_WORDS.kept])
		assert.ok(blank.includes(line), line);
	assert.ok(blank.includes(EMAIL));
	assert.ok(blank.includes(DELETE_WORDS.verb));
	assert.match(verbTag(blank), /disabled/);
	assert.match(
		verbTag(await view({ view: { kind: 'signed-in', email: EMAIL }, typed: 'pat@' })),
		/disabled/
	);
	const typed = await view({
		view: { kind: 'signed-in', email: EMAIL },
		typed: ' PAT@example.invalid'
	});
	assert.doesNotMatch(verbTag(typed), /disabled/);
	const busy = await view({ view: { kind: 'signed-in', email: EMAIL }, typed: EMAIL, busy: true });
	assert.match(verbTag(busy), /disabled/);
});

void test("a delete that did not go through shows the API's sentence", async () => {
	const html = await view({
		view: { kind: 'signed-in', email: EMAIL },
		typed: EMAIL,
		problem: 'Cancel your membership first, so your card is not charged again'
	});
	assert.match(html, /role="alert"[^>]*>Cancel your membership first/);
});

void test('deleted: the page after says so and leads back, with no form', async () => {
	const html = await view({ view: { kind: 'deleted' } });
	assert.ok(html.includes(DELETE_WORDS.doneTitle));
	assert.ok(html.includes(DELETE_WORDS.doneLine));
	assert.ok(html.includes(DELETE_WORDS.home));
	assert.ok(!html.includes('<form'));
});

void test('signed out: sign in comes back to this page, and nothing says deleted', async () => {
	const html = await view({ view: { kind: 'signed-out' } });
	assert.ok(html.includes(DELETE_WORDS.signedOutTitle));
	assert.ok(html.includes(`href="${SIGN_IN.replaceAll('&', '&amp;')}"`));
	assert.ok(!html.includes(DELETE_WORDS.doneTitle));
});

void test('offline and unreachable say their own words, and nothing was deleted', async () => {
	assert.ok((await view({ view: { kind: 'offline' } })).includes(DELETE_WORDS.offlineTitle));
	const down = await view({ view: { kind: 'unreachable' } });
	assert.ok(
		down.includes(DELETE_WORDS.unreachableTitle) && down.includes(DELETE_WORDS.unreachableLine)
	);
});

/** A session storage in memory; throwing makes every call throw, as a browser that keeps nothing. */
function memoryStore(throwing = false): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	const items = new Map<string, string>();
	const guard = (): void => {
		if (throwing) throw new Error('storage off');
	};
	return {
		getItem: (key) => (guard(), items.get(key) ?? null),
		setItem: (key, value) => (guard(), void items.set(key, value)),
		removeItem: (key) => (guard(), void items.delete(key))
	};
}

void test('the page after shows once per delete, and never to a cold ?deleted', () => {
	const store = memoryStore();
	assert.equal(takeDeleted(store), false, 'a cold ?deleted');
	assert.equal(markDeleted(store), true);
	assert.equal(store.getItem(DELETED_KEY), '1');
	assert.equal(takeDeleted(store), true, 'the tab that just deleted');
	assert.equal(takeDeleted(store), false, 'the mark is spent on its read');
});

void test('a browser that keeps nothing says deleted in place, never on a reload', () => {
	const off = memoryStore(true);
	assert.equal(markDeleted(off), false);
	assert.equal(takeDeleted(off), false);
});
