// The Worker answers a missing page with the prerendered not-found page and a 404 (Lane 148). Run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOT_FOUND_PATH, asksForPage, notFoundPage, type Assets } from './not-found.ts';

const PAGE = '<html><body>Page not found</body></html>';

function assets(status: number, asked: string[]): Assets {
	return {
		fetch: (request) => {
			asked.push(new URL(request.url).pathname);
			return Promise.resolve(
				new Response(status === 200 ? PAGE : null, {
					status,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
			);
		}
	};
}

const page = (path: string, accept = 'text/html,application/xhtml+xml'): Request =>
	new Request(`https://trycommish.app${path}`, { headers: { accept } });

void test('a missing page is the prerendered not-found page, with a 404 and its html', async () => {
	const asked: string[] = [];
	const answer = await notFoundPage(assets(200, asked), page('/no-such-page'));
	assert.ok(answer);
	assert.equal(answer.status, 404);
	assert.equal(answer.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(await answer.text(), PAGE);
	assert.deepEqual(asked, [NOT_FOUND_PATH]);
});

void test('with no build behind the Worker the error page answers instead', async () => {
	assert.equal(await notFoundPage(undefined, page('/no-such-page')), null);
	assert.equal(await notFoundPage(assets(404, []), page('/no-such-page')), null);
});

void test('only a page request is answered with the page, never a missing script or a post', () => {
	assert.equal(asksForPage(page('/no-such-page')), true);
	assert.equal(asksForPage(page('/_app/immutable/chunks/gone.js', '*/*')), false);
	assert.equal(
		asksForPage(
			new Request('https://trycommish.app/x', { method: 'POST', headers: { accept: 'text/html' } })
		),
		false
	);
});
