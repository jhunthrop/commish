/** A lobby as its log replays in the browser: who sits where, every pick with who made it, the pick on
 * the clock and when its clock runs out, your queue. Built from the room's own rows, so a reconnect
 * that sends the rows since the last seq brings the page to exactly where the room is. */
import { botName } from './words.ts';
import type { LobbyRoom, RoomAction, RoomPick } from './api.ts';

export type SeatKind = 'drafter' | 'bot' | 'left' | 'open';

export interface LobbySeatState {
	handle: string | null;
	kind: SeatKind;
}

/** Who made a pick: a drafter's own hand, a bot, a stand-in for a drafter who left, an expired clock. */
export type PickBy = 'drafter' | 'bot' | 'queue' | 'clock';

export interface LobbyPick extends RoomPick {
	by: PickBy;
}

export interface LobbyState {
	seq: number;
	seats: ReadonlyMap<number, LobbySeatState>;
	picks: readonly LobbyPick[];
	/** The pick on the clock, 1 until the draft starts. */
	pickNumber: number;
	/** When the turn on the clock runs out, in milliseconds on the server's clock. */
	deadline: number | null;
	drafting: boolean;
	complete: boolean;
	/** The room closed before it drafted: nobody was here when it filled. */
	abandoned: boolean;
	soloPace: boolean;
	/** Your queue, best first, as the room last stored it. */
	queue: readonly string[];
}

/** A seat as both the API's seat list and the log's replay name it. */
interface SeatLike {
	handle: string | null;
	kind: SeatKind;
}

/** A seat's name everywhere a lobby lists seats: You, a drafter's handle (kept after he leaves, since
 * the seat is still his), or Bot and its seat number. */
export function seatName(seat: SeatLike & { seat: number }, you: number): string {
	if (seat.seat === you) return 'You';
	if (seat.kind === 'open') return openSeatName(seat.seat);
	if (seat.kind === 'bot' || seat.handle === null) return botName(seat.seat);
	return seat.handle;
}

/** A seat nobody holds yet, while the lobby fills: a bot takes it only when the draft starts. */
export function openSeatName(seat: number): string {
	return `Seat ${seat}`;
}

/** The people a lobby drafted with: everyone who held a seat when it started, whether he is still
 * here or left and his stand-in drafts. */
export function seatedPeople(seats: Iterable<SeatLike>): number {
	let n = 0;
	for (const s of seats) if (s.kind === 'drafter' || s.kind === 'left') n += 1;
	return n;
}

/** Who made a pick, in the strip's words: a person by handle, a bot by seat, and a stand-in by whose
 * seat it drafted for ("bot for jpk88", "clock for you"), so a pick nobody made is never credited to
 * a person. */
export function pickCredit(
	pick: LobbyPick,
	seats: ReadonlyMap<number, LobbySeatState>,
	you: number
): readonly string[] {
	const seat = seats.get(pick.seat);
	const owner = pick.seat === you ? 'you' : (seat?.handle ?? botName(pick.seat));
	// A stand-in's credit is two lines, so the seat's handle reads whole under a face.
	switch (pick.by) {
		case 'drafter':
			return [owner];
		case 'queue':
			return ['bot for', owner];
		case 'clock':
			return ['clock for', owner];
		default:
			return [botName(pick.seat)];
	}
}

export function initialLobby(room: LobbyRoom): LobbyState {
	return {
		seq: 0,
		seats: new Map(),
		picks: [],
		pickNumber: 1,
		deadline: null,
		drafting: false,
		complete: room.status === 'complete',
		abandoned: room.status === 'abandoned',
		soloPace: room.solo_pace,
		queue: []
	};
}

interface EnginePayload {
	action?: { playerIds?: string[]; teamId?: string };
	pick?: LobbyPick;
	deadline?: string;
}

function teamOf(seat: number): string {
	return `seat${String(seat).padStart(2, '0')}`;
}

/** The log's rows applied in order; rows already applied are passed over. */
export function applyActions(
	state: LobbyState,
	actions: readonly RoomAction[],
	you: number
): LobbyState {
	let next = state;
	for (const action of actions) {
		if (action.seq <= next.seq) continue;
		next = applyOne({ ...next, seq: action.seq }, action, you);
	}
	return next;
}

function withSeat(state: LobbyState, seat: number, patch: Partial<LobbySeatState>): LobbyState {
	const seats = new Map(state.seats);
	const current = seats.get(seat) ?? { handle: null, kind: 'open' as const };
	seats.set(seat, { ...current, ...patch });
	return { ...state, seats };
}

function applyOne(state: LobbyState, action: RoomAction, you: number): LobbyState {
	const seat = action.seat;
	const payload = action.payload as EnginePayload & {
		handle?: string;
		bots?: number[];
		solo_pace?: boolean;
		freed?: boolean;
	};
	switch (action.kind) {
		case 'SEAT_JOINED':
			return seat === null
				? state
				: withSeat(state, seat, { handle: payload.handle ?? null, kind: 'drafter' });
		case 'SEAT_LEFT':
			return seat === null
				? state
				: withSeat(state, seat, { kind: payload.freed ? 'open' : 'left' });
		case 'SEAT_RETURNED':
			return seat === null ? state : withSeat(state, seat, { kind: 'drafter' });
		case 'ROOM_STARTED': {
			let next: LobbyState = { ...state, soloPace: payload.solo_pace ?? false };
			for (const bot of payload.bots ?? [])
				next = withSeat(next, bot, { handle: null, kind: 'bot' });
			return next;
		}
		case 'START_DRAFT':
			return { ...state, drafting: true, pickNumber: 1, deadline: deadlineOf(payload) };
		case 'SET_QUEUE':
			return seat === you || payload.action?.teamId === teamOf(you)
				? { ...state, queue: payload.action?.playerIds ?? [] }
				: state;
		case 'MAKE_PICK':
		case 'TIMER_EXPIRE': {
			const pick = payload.pick;
			if (!pick) return state;
			return {
				...state,
				picks: [...state.picks, pick],
				pickNumber: pick.pick + 1,
				deadline: deadlineOf(payload)
			};
		}
		case 'ROOM_ABANDONED':
			return { ...state, abandoned: true, drafting: false, deadline: null };
		case 'ROOM_COMPLETE':
			return { ...state, complete: true, drafting: false, deadline: null };
		default:
			return state;
	}
}

function deadlineOf(payload: EnginePayload): number | null {
	return payload.deadline ? Date.parse(payload.deadline) : null;
}
