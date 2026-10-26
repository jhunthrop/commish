/** The lobby's parity (Lane 229): what the web's lobby prints at 390 (web/src/lib/room: the lobby list
 * on the setup page, LobbyRoomView with its score bug, seats strip, the strip of picks as they land,
 * the call, the pool, the wall, the team and the dock's line; the room page's notices and leave
 * question; the lobby's report) over the recorded lobby in shared/fixtures/lobby-room, its socket's
 * frames replayed in order through lobby.ts as the page applies them, as JSON the apps' ports are held
 * to. Written by export-parity.ts beside the others. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { REPOSITORY } from "./generated.ts";
import {
  chanceShort,
  clockLabel,
  lastName,
  pickLabel,
  snakeSlot,
} from "../../web/src/lib/format/draft.ts";
import { signed } from "../../web/src/lib/format/number.ts";
import { isMarketPosition } from "../../web/src/lib/run/market.ts";
import {
  callTag,
  callView,
  chanceHead,
  draftWords,
  poolBasis,
} from "../../web/src/lib/room/call.ts";
import {
  applyActions,
  initialLobby,
  pickCredit,
  seatName,
  seatedPeople,
  type LobbyState,
} from "../../web/src/lib/room/lobby.ts";
import {
  LOBBY,
  aboutHead,
  aboutWords,
  byPeopleWords,
  pickClockWords,
  pickWords,
  queueFirstWords,
  roundWords,
  seatLabel,
  seatsWords,
  soloAgainWords,
  waitWords,
  yourPickIn,
} from "../../web/src/lib/room/lobby-words.ts";
import {
  boardOf,
  poolRows,
  seatAt,
  teamSlots,
  turnFrom,
  wallRows,
  type Board,
  type PoolFilter,
  type RoomPlayer,
} from "../../web/src/lib/room/model.ts";
import {
  lobbyFillWords,
  lobbyListHead,
  lobbyTitle,
} from "../../web/src/lib/room/setup/setup.ts";
import {
  chanceMissing,
  poolEmpty,
  poolLine,
  presetWords,
  teamCount,
} from "../../web/src/lib/room/words.ts";
import { botName } from "../../web/src/lib/room/words.ts";
import { MOCK } from "../../web/src/lib/room/mock-words.ts";
import { report } from "./mock-parity.ts";
import type { components } from "../../web/src/lib/api/types.ts";

type Schemas = components["schemas"];
type LobbyRoom = Schemas["LobbyRoom"];
type LobbyFilling = Schemas["LobbyFilling"];
type RoomCard = Schemas["RoomCard"];
type RoomAction = Schemas["RoomAction"];
type MockReport = Schemas["MockReport"];

export const LOBBY_OUTPUT = "shared/fixtures/parity/lobby.json";
const FIXTURES = join(REPOSITORY, "shared/fixtures/lobby-room");

/** LobbyRoomView.svelte FILTERS, Pool.svelte FIRST_ROWS, ScoreBug.svelte SPOKEN_MARKS. */
const FILTERS: readonly PoolFilter[] = [
  "All",
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DST",
  "Queue",
];
const FIRST_ROWS = 14;
const SPOKEN_MARKS = [10, 5] as const;

/** How far before a deadline each drawn state is read: the score bug's clock and the fill's. */
export const CLOCK_LEFT_MS = 27_400;
export const FILL_LEFT_MS = 65_000;

/** The replayed states the parity draws, each the first frame after which the room is at its pick:
 * the room filling, the draft started, your first turn, your turn straight back, between your turns in
 * round 3 and your turn in round 3; then the room at its end. */
export const STATES = [
  { name: "filling", pick: null },
  { name: "started", pick: 1 },
  { name: "yourTurn", pick: 12 },
  { name: "backToBack", pick: 13 },
  { name: "between", pick: 30 },
  { name: "round3", pick: 36 },
] as const;

async function answer<T>(file: string): Promise<T> {
  const envelope = JSON.parse(
    await readFile(join(FIXTURES, `${file}.json`), "utf8"),
  ) as { data: T };
  return envelope.data;
}

interface Step {
  client?: Record<string, unknown>;
  server?: { type: string; actions?: RoomAction[] };
}

async function steps(): Promise<Step[]> {
  const exchange = JSON.parse(
    await readFile(join(FIXTURES, "exchange.json"), "utf8"),
  ) as { steps: Step[] };
  return exchange.steps;
}

async function cardAt(pick: number): Promise<RoomCard | null> {
  try {
    return await answer<RoomCard>(`card-${String(pick)}`);
  } catch {
    return null;
  }
}

function valueCell(p: RoomPlayer): { text: string } {
  if (p.vor !== null && p.vorRound !== null) return { text: signed(p.vor) };
  return {
    text: isMarketPosition(p.position)
      ? `Draft order ${String(p.positionRank)}`
      : "no projection",
  };
}

/** LobbyRoomView.svelte at one state, at `now` on the room's clock, nothing marked, no search. */
function room(
  r: LobbyRoom,
  board: Board,
  lobby: LobbyState,
  card: RoomCard | null,
  now: number,
) {
  const teams = r.teams;
  const total = teams * r.rounds;
  const you = r.you;
  const drafted = new Set(lobby.picks.map((p) => p.player_id));
  const mine = lobby.picks.filter((p) => p.seat === you);
  const onClock =
    lobby.drafting && lobby.pickNumber <= total
      ? seatAt(lobby.pickNumber, teams)
      : null;
  const yourTurn = onClock === you;
  const yourPick = lobby.drafting
    ? turnFrom(lobby.pickNumber, you, teams, total)
    : null;
  const queue = lobby.queue.filter((id) => !drafted.has(id));
  const call =
    card && lobby.drafting ? callView(card, board, drafted, teams) : null;
  const chances = card?.still_there ?? {};
  const landing = lobby.picks.slice(-teams).reverse();
  const round = snakeSlot(Math.min(lobby.pickNumber, total), teams).round;
  const secondsLeft =
    lobby.deadline === null
      ? 0
      : Math.max(0, Math.ceil((lobby.deadline - now) / 1000));
  const fillLeft =
    r.fill_deadline === null
      ? 0
      : Math.max(0, Math.ceil((Date.parse(r.fill_deadline) - now) / 1000));
  const started = lobby.drafting || lobby.complete;
  const people = seatedPeople(lobby.seats.values());
  const names = Array.from({ length: teams }, (_, i) => {
    const seat = lobby.seats.get(i + 1);
    return seatName(
      { seat: i + 1, handle: seat?.handle ?? null, kind: seat?.kind ?? "open" },
      you,
    );
  });
  const away = yourPick === null ? 0 : yourPick - lobby.pickNumber;
  const mark = SPOKEN_MARKS.findLast((m) => secondsLeft <= m);
  const chanceLabel = !card
    ? ""
    : card.conditional
      ? `reaches ${pickLabel(card.for_pick, teams)}`
      : card.next_pick
        ? `still there at ${pickLabel(card.next_pick, teams)}`
        : "your last pick";
  const peopleInStrip = landing.filter((p) => p.by === "drafter").length;
  return {
    state: {
      seq: lobby.seq,
      pickNumber: lobby.pickNumber,
      deadline:
        lobby.deadline === null ? null : new Date(lobby.deadline).toISOString(),
      drafting: lobby.drafting,
      complete: lobby.complete,
      soloPace: lobby.soloPace,
      queue: lobby.queue,
      picks: lobby.picks.map((p) => [p.pick, p.seat, p.player_id, p.by]),
      seats: Array.from({ length: teams }, (_, i) => {
        const s = lobby.seats.get(i + 1);
        return [i + 1, s?.handle ?? null, s?.kind ?? null];
      }),
    },
    bug:
      lobby.drafting && yourPick !== null
        ? {
            round: roundWords(snakeSlot(lobby.pickNumber, teams).round),
            pick: pickWords(lobby.pickNumber, teams),
            onClock: onClock === null ? "" : (names[onClock - 1] ?? ""),
            clock: clockLabel(secondsLeft),
            yourPick:
              away === 0 ? LOBBY.now : yourPickIn(yourPick, away, teams),
            spoken:
              away === 0 && mark !== undefined
                ? `${String(mark)} seconds left`
                : null,
          }
        : null,
    seats: Array.from({ length: teams }, (_, i) => {
      const seat = i + 1;
      const kind = lobby.seats.get(seat)?.kind ?? "open";
      const compact = seat !== you && (kind === "bot" || kind === "open");
      const line =
        seat === onClock
          ? LOBBY.seatOnClock
          : kind === "left"
            ? LOBBY.seatLeft
            : kind === "drafter"
              ? LOBBY.seatDrafter
              : LOBBY.seatWaiting;
      return {
        seat,
        name: names[i],
        line,
        compact,
        label: seatLabel(names[i] ?? "", kind === "open", seat === onClock),
      };
    }),
    wait: started
      ? null
      : {
          count: `${lobbyFillWords(people).words}.`,
          words: waitWords(teams, fillLeft),
        },
    landing:
      landing.length === 0
        ? null
        : {
            lead: pickLabel(landing[0]?.pick ?? 1, teams),
            lines: [
              LOBBY.justTaken,
              byPeopleWords(peopleInStrip, landing.length),
            ],
            faces: landing.map((p) => ({
              pick: p.pick,
              id: p.player_id,
              name: lastName(board.byId.get(p.player_id)?.name ?? ""),
              lines: [
                ...pickCredit(p, lobby.seats, you),
                pickLabel(p.pick, teams),
              ],
              strong: p.by === "drafter",
            })),
          },
    call: call
      ? {
          tag: callTag(call),
          chanceHead: chanceHead(call),
          verb: yourTurn
            ? draftWords(call.player.position)
            : queueFirstWords(draftWords(call.player.position, "Queue")),
          rows: call.rows.map((row) => ({
            id: row.player.id,
            chance:
              chanceHead(call) === null || row.chance === null
                ? ""
                : chanceShort(row.chance),
          })),
        }
      : null,
    pool: lobby.complete
      ? null
      : {
          line: poolLine(board.players.length - drafted.size),
          basis: poolBasis(board, card, teams),
          chanceLabel,
          missing: chanceMissing(false, Object.keys(chances).length > 0),
          draftShown: yourTurn,
          filters: FILTERS.map((filter) => {
            const rows = poolRows(board, drafted, filter, queue, "");
            return {
              filter,
              count: rows.length,
              empty: rows.length === 0 ? poolEmpty("", filter) : null,
              rows: rows.slice(0, FIRST_ROWS).map((p) => ({
                id: p.id,
                value: valueCell(p).text,
                chance:
                  card === null || chances[p.id] === undefined
                    ? null
                    : chanceShort(chances[p.id] ?? 0),
                call: p.id === call?.player.id,
                queued: queue.includes(p.id),
              })),
            };
          }),
        },
    wall: {
      names,
      rows: wallRows(
        lobby.picks,
        board,
        teams,
        Math.min(r.rounds, round),
      ).map((row) => row.map((cell) => cell.player?.id ?? null)),
    },
    team: (() => {
      const slots = teamSlots(r.settings, mine, board);
      return {
        count: teamCount(
          slots.filter((s) => s.player !== null).length,
          r.rounds,
        ),
        slots: slots.map((s) => ({
          slot: s.slot,
          id: s.player?.id ?? null,
          pick: s.pick === null ? null : pickLabel(s.pick, teams),
        })),
      };
    })(),
    about: {
      head: aboutHead(teams, presetWords(r.settings.scoring.preset ?? "ppr")),
      words: aboutWords(people, teams, started, r.clock_seconds),
    },
  };
}

/** The room's frames replayed in order, the state after each frame that carried rows. */
function replay(
  r: LobbyRoom,
  frames: Step[],
): { lobby: LobbyState; frame: number }[] {
  let lobby = initialLobby(r);
  const after: { lobby: LobbyState; frame: number }[] = [];
  frames.forEach((step, frame) => {
    const actions = step.server?.actions ?? [];
    if (actions.length === 0) return;
    lobby = applyActions(lobby, actions, r.you);
    after.push({ lobby, frame });
  });
  return after;
}

export async function renderLobby(about: string): Promise<string> {
  const filling = await answer<LobbyRoom>("room-filling");
  const complete = await answer<LobbyRoom>("room-complete");
  const lobbies = await answer<LobbyFilling[]>("lobbies");
  const board = boardOf(filling.board, filling.teams);
  const frames = await steps();
  const replayed = replay(filling, frames);
  const states: Record<string, unknown> = {};
  for (const { name, pick } of STATES) {
    const at = replayed.find((s) =>
      pick === null
        ? !s.lobby.drafting
        : s.lobby.drafting && s.lobby.pickNumber === pick,
    );
    if (!at) throw new Error(`The recorded lobby never reached ${name}.`);
    const deadline =
      pick === null
        ? Date.parse(filling.fill_deadline ?? "") - FILL_LEFT_MS
        : (at.lobby.deadline ?? 0) - CLOCK_LEFT_MS;
    const card = pick === null ? null : await cardAt(pick);
    states[name] = {
      frame: at.frame,
      now: new Date(deadline).toISOString(),
      card: card === null ? null : pick,
      room: room(filling, board, at.lobby, card, deadline),
    };
  }
  const last = replayed.at(-1);
  if (!last) throw new Error("The recorded lobby has no rows.");
  const names = (r: LobbyRoom) =>
    Array.from({ length: r.teams }, (_, i) => {
      const seat = r.seats.find((s) => s.seat === i + 1);
      return seat ? seatName(seat, r.you) : botName(i + 1);
    });
  const people = seatedPeople(complete.seats);
  const youReport = await answer<MockReport>("report-you");
  const maraReport = await answer<MockReport>("report-mara");
  const maraNames = names({
    ...complete,
    you: maraReport.slot,
  });
  const parity = {
    about,
    landing: {
      head: lobbyListHead(lobbies),
      cards: lobbies.map((l) => {
        const fill = lobbyFillWords(l.filling);
        return {
          format: l.format,
          title: lobbyTitle(l.teams, l.scoring, l.lineup),
          clock: pickClockWords(l.clock_seconds),
          fill: fill.words,
          empty: fill.empty,
          verb: LOBBY.join,
        };
      }),
      /** Every count a card can say, and a list's head with nobody in. */
      fills: [0, 1, 2, 11].map((n) => lobbyFillWords(n).words),
      emptyHead: lobbyListHead([{ filling: 0 }]),
    },
    states,
    end: {
      frames: frames.length,
      room: room(filling, board, last.lobby, null, 0),
    },
    leave: { filling: LOBBY.leaveFilling, drafting: LOBBY.leaveDrafting },
    reports: {
      you: {
        names: names(complete),
        ...report(youReport, names(complete), undefined, seatsWords(people, complete.teams)),
        verbs: [LOBBY.joinAnother, soloAgainWords(youReport.slot)],
      },
      down: {
        names: maraNames,
        ...report(maraReport, maraNames, undefined, seatsWords(people, complete.teams)),
        verbs: [LOBBY.joinAnother, soloAgainWords(maraReport.slot)],
      },
    },
    reshuffled: MOCK.reshuffled,
  };
  return `${JSON.stringify(parity, null, "\t")}\n`;
}
