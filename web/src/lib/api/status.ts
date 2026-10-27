/** The API's statuses a page branches on, read off an ApiError in one place. */
import { ApiError } from './client.ts';

export const HTTP_STATUS = {
	unauthorized: 401,
	forbidden: 403,
	notFound: 404,
	conflict: 409,
	gone: 410
} as const;

type Status = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/** Whether an error is the API answering with one of these statuses. */
export function hasStatus(error: unknown, ...statuses: readonly Status[]): boolean {
	return error instanceof ApiError && (statuses as readonly number[]).includes(error.status);
}

/** Whether an error is the API saying nobody is signed in. */
export function isSignedOut(error: unknown): boolean {
	return hasStatus(error, HTTP_STATUS.unauthorized);
}

/** Whether an error is the API saying this drafter cannot be in the room at all: signed out, not
 * seated in it, or no such room. A retry never fixes one of these. */
export function isFinalRefusal(error: unknown): boolean {
	return hasStatus(error, HTTP_STATUS.unauthorized, HTTP_STATUS.forbidden, HTTP_STATUS.notFound);
}
