// Serves the built site the way production does, for Lighthouse and screenshots: the prerendered
// pages and assets as compressed static files with clean URLs (Workers static assets), and the
// request-time club mark route, answered by the same upstream the Worker uses. Faces come from our
// images host (src/lib/ui/headshot.ts), as they do in production.
// Usage: npm run preview:static   (port 4173, or PORT)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import compression from 'compression';
import handler from 'serve-handler';
import { upstreamClubMarkUrl } from '../src/lib/ui/headshot-provider.ts';
import { clubMarkPath } from '../src/lib/server/image-route.ts';

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = new URL('../.svelte-kit/cloudflare/', import.meta.url).pathname;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
// compression is typed for Express, and it is plain Node middleware underneath.
const compress = compression() as unknown as NodeMiddleware;

/** An image from the provider, answered as the Worker answers it. */
async function image(res: ServerResponse, url: string): Promise<void> {
	const upstream = await fetch(url);
	if (!upstream.ok) {
		res.writeHead(upstream.status === 404 ? 404 : 502).end();
		return;
	}
	res.writeHead(200, {
		'content-type': upstream.headers.get('content-type') ?? 'image/png',
		'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`
	});
	res.end(Buffer.from(await upstream.arrayBuffer()));
}

function serve(req: IncomingMessage, res: ServerResponse): void {
	const path = new URL(req.url ?? '/', 'http://localhost').pathname;
	const mark = clubMarkPath(path);
	if (mark) {
		image(res, upstreamClubMarkUrl(mark.league, mark.club, mark.width)).catch(() =>
			res.writeHead(502).end()
		);
		return;
	}
	compress(req, res, () => {
		void handler(req, res, { public: ROOT, cleanUrls: true });
	});
}

createServer(serve).listen(PORT, () => {
	process.stdout.write(`Accepting connections at http://localhost:${String(PORT)}\n`);
});
