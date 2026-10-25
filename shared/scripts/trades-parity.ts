/** The Trades screen's parity (Lane 189): what the web's Trades (TradeScreen.svelte at 390 over
 * TradeStrip, TradeFinder, TradeBug, TradeCopied and BasisBlock) prints for the fixture league's trades
 * at each fixture clock, in the fixture's zone, as JSON the apps' ports are held to: the decision, the
 * strip (the week, its title, the platform's reason and each card), the chips' counts, the line under
 * the gain heads, the finder's rows in the web's order (each team's best and every trade, by each gain
 * a phone sorts by) with each row's opened players as the phone draws them, every trade's copied
 * offer (the share text), and the phone's basis with no trade opened and with one. The checks the
 * fixtures post are drawn as the scoreboard draws them (each side's figures before and after, its
 * room) with the answer's sentence and line. The screen draws at the page's clock, the instant the
 * answer was read (InSeasonPage's now), as TradeScreen is passed it. Written by export-parity.ts. */
import { BOX, boxNumber, boxRow } from "../../web/src/lib/league/box/box.ts";
import { drawnText } from "../../web/src/lib/league/box/basis.ts";
import {
  addressedWeek,
  weekProjected,
} from "../../web/src/lib/league/box/next-week.ts";
import { stripMark } from "../../web/src/lib/league/box/strip.ts";
import {
  bugFigures,
  checkRoom,
  copiedTrade,
  finderRows,
  fromWords,
  gainWord,
  heldCheck,
  heldTrades,
  offerText,
  phoneWith,
  proposeVerb,
  roomWords,
  shortSide,
  sideRows,
  sortRows,
  toneOf,
  TRADES,
  tradeBasis,
  weekHeadFor,
  weekLine,
  worthProposing,
  worthTitle,
  type CopiedTrade,
  type FinderRow,
  type SortKey,
} from "../../web/src/lib/league/box/trades.ts";
import type { LeagueHost } from "../../web/src/lib/league/api.ts";
import type {
  PlayerLine,
  TradeAdvice,
  TradeCheck,
} from "../../web/src/lib/league/inseason/api.ts";
import { checkWords } from "../../web/src/lib/league/inseason/builder.ts";
import { tradeDecision } from "../../web/src/lib/league/inseason/words.ts";
import { cells } from "./lineup-parity.ts";

export const TRADES_OUTPUT = "shared/fixtures/parity/trades.json";

/** The site's record page, the basis's last part's link (links.record()). */
const RECORD = "/record";

/** The gains a phone sorts the finder by: its two heads (TradeFinder drops the week's at 390). */
const PHONE_SORTS: readonly SortKey[] = ["mine", "theirs"];

/** One opened row as the phone draws it (BoxLine with season, evidence and shortOnPhone): the box's
 * cells, which way he moves, and his rest-of-season points a game in the last cell. */
function openedRow(
  line: PlayerLine,
  side: string,
  move: "in" | "out",
  zone: string,
  now: number,
) {
  const row = boxRow(line, side, zone, false, now);
  return {
    ...cells(null, row, null),
    move,
    season: boxNumber(row.evidence.season),
  };
}

/** A finder row as the phone draws it closed and opened, and the offer its verb copies. */
function rowOf(
  entry: FinderRow,
  me: string,
  zone: string,
  now: number,
): unknown {
  const { row, team } = entry;
  const sides = sideRows(row);
  const group = (head: string, list: typeof sides.yours) => ({
    head,
    rows: list.map((s) => openedRow(s.line, s.side, s.move, zone, now)),
  });
  return {
    key: entry.key,
    team: team.name,
    rosterId: team.roster_id,
    give: shortSide(row.give),
    get: shortSide(row.get),
    with: phoneWith(team, row),
    need: row.need ?? null,
    mine: { gain: gainWord(row.my_gain), tone: toneOf(row.my_gain) },
    theirs: { gain: gainWord(row.their_gain), tone: toneOf(row.their_gain) },
    offer: offerText(team, row),
    opened: {
      week: weekLine(row),
      dropReason: row.drop_reason,
      groups: [
        group(fromWords(me, true), sides.yours),
        group(fromWords(team.name, false), sides.theirs),
      ],
    },
  };
}

/** The strip as TradeStrip draws it: the week, its title, the platform's reason, each card. */
function stripOf(advice: TradeAdvice, host: LeagueHost): unknown {
  const worth = worthProposing(advice.teams);
  return {
    week: `${TRADES.weekWord} ${String(addressedWeek(advice))}`,
    title: worthTitle(worth.length),
    reason: advice.moves.reason,
    verb: proposeVerb(advice.moves, host),
    cards: worth.map((entry, index) => ({
      key: entry.key,
      mark: stripMark(index, worth.length),
      team: entry.team.name,
      give: shortSide(entry.row.give),
      get: shortSide(entry.row.get),
      mine: gainWord(entry.row.my_gain),
      theirs: gainWord(entry.row.their_gain),
      need: entry.row.need ?? null,
      week: weekLine(entry.row),
      drop: entry.row.drop ? roomWords(entry.row).yours : null,
      dropReason: entry.row.drop_reason,
    })),
  };
}

/** The Trades at one clock as the web's phone draws it, the page's clock its read. */
export function tradesAt(
  answer: TradeAdvice,
  host: LeagueHost,
  me: string,
  clock: string,
  zone: string,
): unknown {
  const now = Date.parse(clock);
  const advice = heldTrades(answer, now);
  const worth = worthProposing(advice.teams);
  const lines = [
    ...advice.roster,
    ...advice.teams.flatMap((t) => [
      ...t.roster,
      ...t.trades.flatMap((r) => [...r.give, ...r.get]),
    ]),
  ];
  const basis = (opened: "none" | "trade"): string =>
    drawnText(
      tradeBasis(
        advice,
        host,
        lines,
        opened,
        { record: RECORD },
        { zone, zoned: false },
        now,
      ),
      "phone",
    );
  const finder = (every: boolean) =>
    Object.fromEntries(
      PHONE_SORTS.map((by) => [
        by,
        sortRows(finderRows(advice.teams, every), by).map((entry) =>
          rowOf(entry, me, zone, now),
        ),
      ]),
    );
  return {
    clock,
    decision: tradeDecision(
      worth[0] ? { row: worth[0].row, team: worth[0].team.name } : null,
    ),
    strip: worth.length > 0 ? stripOf(advice, host) : null,
    chips: {
      best: `${TRADES.best}, ${String(advice.teams.filter((t) => t.trades.length > 0).length)}`,
      every: `${TRADES.every}, ${String(advice.teams.reduce((n, t) => n + t.trades.length, 0))}`,
    },
    heads: {
      mine: TRADES.yourGain,
      theirs: TRADES.theirGain,
      give: TRADES.give,
    },
    gainBasis: advice.gain_basis ?? null,
    weekHead: weekHeadFor(advice),
    weekShown: weekProjected(advice),
    verb: proposeVerb(advice.moves, host),
    reason: advice.host_trades_url === "" ? advice.host_note : null,
    finder: { best: finder(false), every: finder(true) },
    basis: { closed: basis("none"), opened: basis("trade") },
  };
}

/** A check as the scoreboard draws it (TradeBug over bugFigures and checkRoom) with the answer's
 * sentence (checkWords) and its line, held at the page's clock (heldCheck). */
export function checkAt(
  answer: TradeCheck,
  me: string,
  team: string,
  clock: string,
): unknown {
  const check = heldCheck(answer, Date.parse(clock));
  const room = checkRoom(check);
  const side = (name: string, mine: boolean) => ({
    label: mine ? TRADES.yourSide : TRADES.theirSide,
    name,
    figures: mine
      ? bugFigures(
          check.totals.yours,
          check.trade.my_gain,
          check.trade.my_proj_change,
        )
      : bugFigures(
          check.totals.theirs,
          check.trade.their_gain,
          check.trade.their_proj_change,
        ),
    room: mine ? room.yours : room.theirs,
  });
  return {
    clock,
    heads: {
      week: TRADES.weekHead,
      gain: TRADES.gainHead,
      room: TRADES.room,
      to: TRADES.to,
    },
    yours: side(me, true),
    theirs: side(team, false),
    sentence: checkWords(check),
    basis: check.basis,
  };
}

/** The line under a pressed verb as TradeCopied reads: copied, or not, then where to propose it. */
export function copiedWords(host: LeagueHost): Record<string, string> {
  const words = (line: CopiedTrade): string =>
    `${line.said} ${TRADES.proposeItOn} ${line.page}.`;
  return {
    done: words(copiedTrade(host, true)),
    failed: words(copiedTrade(host, false)),
  };
}
