/** The lobby's WebSocket: a hello with the last seq applied, the welcome with everything since, every
 * batch after it, and a reconnect that picks up exactly where it left off. */
import type { components } from '#lib/api/types.ts';
import type { RoomAction } from './api.ts';

type Command = components['schemas']['RoomCommand'];

interface Frame {
	type: 'welcome' | 'update' | 'error';
	seq?: number;
	now?: string;
	actions?: RoomAction[];
	message?: string;
}

/** Reconnect waits, growing to the last one and staying there. */
const RETRY_MS = [250, 500, 1000, 2000, 5000] as const;

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketHandlers {
	/** New rows, in seq order. */
	onactions: (actions: readonly RoomAction[]) => void;
	/** The server's clock less the browser's, in milliseconds, from each welcome. */
	onclock: (offsetMs: number) => void;
	onstatus: (status: SocketStatus) => void;
	/** A command the room refused, in its own words. */
	onrefused: (message: string) => void;
	/**
	 * Asked when a connection closes before its welcome, since a browser never sees the upgrade's
	 * status: answers why the room will not take this drafter (signed out, not seated, gone), or null
	 * when a retry could work.
	 */
	probe: () => Promise<unknown>;
	/** The retries stopped for good, with the probe's reason. */
	onstopped: (reason: unknown) => void;
}

export class LobbySocket {
	private socket: WebSocket | null = null;
	private seq = 0;
	private attempt = 0;
	private stopped = false;
	private retry: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly url: string,
		private readonly handlers: SocketHandlers
	) {}

	connect(): void {
		this.stopped = false;
		this.handlers.onstatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
		const socket = new WebSocket(this.url);
		this.socket = socket;
		let welcomed = false;
		socket.onopen = () => {
			socket.send(JSON.stringify({ type: 'hello', last_seq: this.seq }));
		};
		socket.onmessage = (event: MessageEvent<string>) => {
			const frame = JSON.parse(event.data) as Frame;
			if (frame.type === 'welcome') welcomed = true;
			this.receive(frame);
		};
		socket.onclose = () => {
			this.socket = null;
			if (this.stopped) {
				this.handlers.onstatus('closed');
				return;
			}
			this.handlers.onstatus('reconnecting');
			if (welcomed) {
				this.schedule();
				return;
			}
			void this.handlers.probe().then((reason) => {
				if (this.stopped) return;
				if (reason === null) {
					this.schedule();
					return;
				}
				this.stopped = true;
				this.handlers.onstatus('closed');
				this.handlers.onstopped(reason);
			});
		};
	}

	private schedule(): void {
		const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
		this.attempt += 1;
		this.retry = setTimeout(() => this.connect(), wait);
	}

	private receive(frame: Frame): void {
		if (frame.type === 'error') {
			this.handlers.onrefused(frame.message ?? 'The room refused that.');
			return;
		}
		if (frame.type === 'welcome') {
			this.attempt = 0;
			this.handlers.onstatus('open');
			if (frame.now) this.handlers.onclock(Date.parse(frame.now) - Date.now());
		}
		const actions = frame.actions ?? [];
		if (actions.length > 0) {
			this.seq = Math.max(this.seq, actions[actions.length - 1]?.seq ?? 0);
			this.handlers.onactions(actions);
		}
	}

	send(command: Command): boolean {
		if (this.socket?.readyState !== WebSocket.OPEN) return false;
		this.socket.send(JSON.stringify(command));
		return true;
	}

	close(): void {
		this.stopped = true;
		if (this.retry !== null) clearTimeout(this.retry);
		this.socket?.close(1000, 'left the page');
	}
}
