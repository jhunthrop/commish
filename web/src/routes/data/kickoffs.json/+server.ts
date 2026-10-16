import { kickoffsOf } from '#lib/run/kickoffs.ts';
import { schedule } from '#lib/server/run.ts';
import type { RequestHandler } from './$types';

/** Every club's games with their kickoffs, from the run's schedule (run/kickoffs.ts): written as a
 * static file at build, fetched only by a league's Matchup screen. */
export const prerender = true;

export const GET: RequestHandler = async () => Response.json(kickoffsOf(await schedule()));
