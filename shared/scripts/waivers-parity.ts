/** The Waivers screen's parity (Lane 186): what the web's Waivers (WaiverScreen.svelte at 390 over
 * PickupStrip, WaiverTable, MovePanel and BasisBlock) prints for an answer at a clock, in the fixture's
 * zone, as JSON the apps' ports are held to: the strip (the week, the count of pickups, the sum, each
 * card's slot, mark, move, why and gains), the line under the heads, every row's cells as the phone
 * draws them in the table's default order (the rows that gain, then the rest under the divider, then
 * the Stash group with its line), each row's verb and its drop panel, the pinned verb with the line
 * under it, the arrival line, the phone's basis; and the claim's words (move.ts) for each platform
 * and each outcome, the bid's label and its problem. Written by export-parity.ts beside the others. */
import {
  BOX,
  boxNumber,
  positionWord,
} from "../../web/src/lib/league/box/box.ts";
import { drawnText } from "../../web/src/lib/league/box/basis.ts";
import {
  addressedWeek,
  arrivesPart,
  weekProjected,
} from "../../web/src/lib/league/box/next-week.ts";
import { stripMark } from "../../web/src/lib/league/box/strip.ts";
import {
  addVerbWords,
  beatsPlace,
  beatsWeekWord,
  beatsWord,
  cardGains,
  cardName,
  copiedWords,
  DEFAULT_SORT,
  findRows,
  nextSort,
  dropLead,
  dropRows,
  dropTitle,
  dropWhyWords,
  gainGroups,
  gainWord,
  headBasis,
  headBasisText,
  moveWords,
  namesOnScreen,
  pickupCards,
  pickupSum,
  pickupsTitle,
  poolRows,
  sameWeekGain,
  sortRows,
  stashBasis,
  stashRows,
  STASH,
  stripDecision,
  WAIVERS,
  waiverBasis,
  withDrop,
  type PoolRow,
  type Sort,
  type SortKey,
} from "../../web/src/lib/league/box/waivers.ts";
import type { LeagueHost } from "../../web/src/lib/league/api.ts";
import type {
  HostBid,
  HostMoveResult,
  WaiverAdvice,
  WaiverPosition,
} from "../../web/src/lib/league/inseason/api.ts";
import {
  bidLabel,
  bidProblem,
  addKey,
  claimsAdd,
  claimsOnHost,
  hostSaid,
  lostWords,
  moveTitle,
  openHostWords,
  readingWords,
  resultWords,
  settingWords,
} from "../../web/src/lib/league/inseason/move.ts";
import { LINES, verbWords } from "../../web/src/lib/league/inseason/words.ts";
import {
  PANEL,
  panelHasWeek,
  type PanelMode,
} from "../../web/src/lib/league/box/positions.ts";
import {
  atPosition,
  navCards,
  navCounts,
  navLead,
  navSort,
  openingKey,
  yoursRows,
  type NavKey,
} from "../../web/src/lib/league/box/position-nav.ts";
import { cells } from "./lineup-parity.ts";

export const WAIVERS_OUTPUT = "shared/fixtures/parity/waivers.json";

/** One row as the phone's table draws it: the box row's cells (lineup-parity's), the evidence line
 * with A game after it, the clearing day, the Stash row's week in place of his game, the Beats cell,
 * the row's verb and whether it gains. */
function rowOf(
  entry: PoolRow,
  advice: WaiverAdvice,
  host: LeagueHost,
): unknown {
  const stash = entry.stash;
  const box = cells(null, entry.row, stash === null ? null : "slot");
  const more = `${WAIVERS.rest} ${boxNumber(entry.rest)}`;
  return {
    ...box,
    evidence: `${box.evidence}, ${more}`,
    rest: boxNumber(entry.rest),
    clears: entry.clears,
    away: stash?.back ?? null,
    named: entry.named,
    gains: entry.gains,
    beats:
      stash === null
        ? {
            who:
              entry.beats.who === null
                ? null
                : {
                    name: entry.beats.who.name,
                    place: beatsPlace(entry.beats.who),
                  },
            figure: beatsWord(entry.beats),
            loud: entry.gains && (entry.beats.gain ?? 0) > 0,
            week:
              entry.beats.week === null
                ? null
                : beatsWeekWord(entry.beats.week),
          }
        : { who: stash.who, figure: null, loud: false, week: null },
    // The row's own button: the platform's page for a stash an open IR slot takes with no drop, else
    // the drop panel opened by Add or Stash.
    button: stash?.verb === "stash" ? STASH.verb : LINES.add,
    opensPage: stash?.verb === "stash" && !stash.drops,
    verb: addVerbWords(advice.moves, entry.source.add.player.host_id, host),
    claimsHere: claimsAdd(advice.moves, entry.source.add.player.host_id),
  };
}

/** A row's drop panel: its title and lead, each drop's cells, Gain and week, and the pair the verb
 * makes with the first drop chosen. */
function dropsOf(
  entry: PoolRow,
  advice: WaiverAdvice,
  zone: string,
  now: number,
): unknown {
  const drops = dropRows(entry.source, advice.roster, zone, now);
  const week = sameWeekGain(drops);
  const names = namesOnScreen(advice);
  const first = drops[0] ?? null;
  const pair = withDrop(entry.source, first);
  return {
    title: dropTitle(entry.row.name),
    lead: dropLead(week),
    rows: drops.map((d) => ({
      key: d.key,
      cells: cells(
        null,
        d.row,
        d.row.reserve && d.starter === null ? "bench" : null,
      ),
      evidence: `${cells(null, d.row, null).evidence}, ${WAIVERS.rest} ${boxNumber(d.rest)}`,
      gain: gainWord(d.gain),
      week:
        week === null && d.weekGain !== null
          ? `${gainWord(d.weekGain)} ${BOX.proj}`
          : null,
      starter: d.starter === null ? null : d.starter.mark,
    })),
    pair: moveWords({
      add: cardName(pair.add.player.name, names),
      drop: first === null ? null : cardName(first.row.name, names),
    }),
  };
}

/** The sortable heads the phone draws at 390 (WaiverTable.svelte: Player, Proj, Beats), each read
 * both ways. */
const PHONE_SORTS: readonly Sort[] = (
  ["name", "proj", "beats"] as const
).flatMap((key) => [
  { key, down: true },
  { key, down: false },
]);
/** Searches the parity holds: a part of a name in any case, padding, and one that finds no one. */
const FINDS = ["john", "CHIEFS", "  ", "zzz"] as const;
/** The positions the route narrows to, in the board's order (WaiverScreen.svelte POSITIONS). */
const POSITIONS: readonly WaiverPosition[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
];

/** The table's rows by key in a sort, found by a search: the rows that gain, the rest, the Stash group. */
function tableKeys(
  pool: readonly PoolRow[],
  stash: readonly PoolRow[],
  sort: Sort,
  query: string,
): { gaining: string[]; rest: string[]; stash: string[] } {
  const groups = gainGroups(findRows(sortRows(pool, sort), query));
  return {
    gaining: groups.gaining.map((r) => r.key),
    rest: groups.rest.map((r) => r.key),
    stash: findRows(sortRows(stash, sort), query).map((r) => r.key),
  };
}

/** What the cards' figures are, said once in each screen's nav: an app holds the words and the rules,
 * never the stand-in's numbers (Lane 291 review M6). */
const NAV_FIGURES =
  "Card figures come from the fixture's stand-in (web/scripts/inseason-fixture/positions.ts): hold the words and rules, not the numbers. The fixture's board places no defense, so its D/ST card ranks the member's defense against teams given none.";

/** The position cards as the web's Waivers navigates by them (position-nav.ts, Lane 305): the card it
 * opens on, whether the toggle is drawn, and for each figure the toggle reads the row of cards (All
 * first, then a card a position, or a count card a position the rows hold where the answer carries no
 * panel), the line over the comparison and the member's players for every card, and the list's sort;
 * then the page answer's rows at each card, by key, until the position's own read lands. */
function navOf(advice: WaiverAdvice, zone: string, at: number): unknown {
  const all = poolRows(
    { rows: advice.rows, pickups: advice.pickups, roster: advice.roster },
    zone,
    at,
  );
  const byPosition = new Map(
    POSITIONS.map(
      (p) =>
        [
          p,
          navCounts(all.filter((r) => r.source.add.player.position === p)),
        ] as const,
    ).filter(([, c]) => c.free > 0),
  );
  const modes: readonly PanelMode[] = panelHasWeek(advice)
    ? ["season", "week"]
    : ["season"];
  const keys: NavKey[] = navCards(
    advice,
    "season",
    navCounts(all),
    byPosition,
  ).map((c) => c.key);
  const byMode = Object.fromEntries(
    modes.map((mode) => [
      mode,
      {
        explain: PANEL.explain[mode],
        sort: navSort(mode),
        cards: navCards(advice, mode, navCounts(all), byPosition),
        leads: Object.fromEntries(
          keys.map((key) => [key, navLead(advice, key, mode)]),
        ),
        yours: Object.fromEntries(
          keys.map((key) => [
            key,
            yoursRows(advice, key, mode, zone, at).map((r) => ({
              key: r.key,
              name: r.row.name,
              rest: r.rest,
              role: r.role,
              starts: r.starts,
            })),
          ]),
        ),
      },
    ]),
  );
  return {
    figures: NAV_FIGURES,
    opening: openingKey(advice),
    hasWeek: panelHasWeek(advice),
    ...byMode,
    atPosition: Object.fromEntries(
      keys.map((key) => {
        const here = atPosition(advice, key);
        return [
          key,
          {
            rows: here.rows.map((r) => addKey(r)),
            stash: (here.stash ?? []).map((r) => addKey(r)),
          },
        ];
      }),
    ),
  };
}

/** The Waivers at one clock, as the web's phone draws it: `advice` the page's answer, `shown` the
 * answer for the chosen position (WaiverScreen's `narrowed ?? advice`), its rows drawn at `now`. */
export function waiversAt(
  advice: WaiverAdvice,
  host: LeagueHost,
  now: string,
  zone: string,
  shown: WaiverAdvice = advice,
): unknown {
  const at = Date.parse(now);
  const pool = poolRows(
    { rows: shown.rows, pickups: advice.pickups, roster: shown.roster },
    zone,
    at,
  );
  const sorted = sortRows(pool, DEFAULT_SORT);
  const groups = gainGroups(sorted);
  const stash = sortRows(
    stashRows({ ...shown, pickups: advice.pickups }, zone, at),
    DEFAULT_SORT,
  );
  const cards = pickupCards(advice);
  const names = namesOnScreen(shown);
  const card = cards[0] ?? null;
  const lines = [...shown.rows.map((r) => r.add), ...shown.roster];
  const sum = pickupSum(advice, cards);
  return {
    now,
    week: addressedWeek(advice),
    title: pickupsTitle(cards.length),
    decision: stripDecision(cards),
    sum,
    cards: cards.map((c, i) => ({
      key: c.key,
      slot: c.slot,
      mark: stripMark(i, cards.length),
      move: moveWords(c),
      why: dropWhyWords(c.dropWhy),
      gains: cardGains(c),
      verb: addVerbWords(shown.moves, c.source.add.player.host_id, host),
    })),
    positions: POSITIONS.filter((p) =>
      advice.rows.some((r) => r.add.player.position === p),
    ).map((p) => ({ position: p, word: positionWord(p) })),
    nav: navOf(advice, zone, at),
    projected: weekProjected(shown),
    arrives: arrivesPart(shown, addressedWeek(shown), zone),
    heads: headBasisText(
      headBasis(shown.projection_previous_read_at, weekProjected(shown), {
        zone,
        zoned: false,
      }),
    ),
    gaining: groups.gaining.map((e) => rowOf(e, shown, host)),
    rest: groups.rest.map((e) => rowOf(e, shown, host)),
    stash: stash.map((e) => rowOf(e, shown, host)),
    stashLine: stashBasis(shown),
    empty: WAIVERS.noneFound,
    sorts: PHONE_SORTS.map((sort) => ({
      ...sort,
      ...tableKeys(pool, stash, sort, ""),
    })),
    finds: FINDS.map((query) => ({
      query,
      ...tableKeys(pool, stash, DEFAULT_SORT, query),
    })),
    drops: Object.fromEntries(
      [...sorted.slice(0, 3), ...stash].map((e) => [
        e.key,
        dropsOf(e, shown, zone, at),
      ]),
    ),
    onHost: claimsOnHost(shown),
    pinned: {
      verb:
        card === null
          ? null
          : addVerbWords(shown.moves, card.source.add.player.host_id, host),
      line: shown.moves.reason ?? shown.host_note ?? shown.moves.note ?? "",
      url: shown.host_waivers_url,
    },
    copied:
      card === null
        ? null
        : copiedWords(host, cardName(card.source.add.player.name, names), true),
    copyFailed:
      card === null
        ? null
        : copiedWords(
            host,
            cardName(card.source.add.player.name, names),
            false,
          ),
    basis: drawnText(
      waiverBasis(
        { ...shown, pickups: advice.pickups },
        lines,
        { zone, zoned: false },
        at,
      ),
      "phone",
    ),
  };
}

/** waivers.ts nextSort from the default through each phone head and on: a head chosen again turns it
 * around, a new head starts highest first, a name A to Z, a game soonest first. */
export function sortSteps(): Sort[] {
  const keys: readonly SortKey[] = [
    "name",
    "name",
    "proj",
    "proj",
    "beats",
    "game",
  ];
  return keys.reduce<Sort[]>(
    (steps, key) => [...steps, nextSort(steps.at(-1) ?? DEFAULT_SORT, key)],
    [],
  );
}

/** The Stash group's and a clearing day's cases (Lane 186 review M1), over the inputs of
 * web/src/lib/league/box/stash.test.ts: the stand-in's stored answer with the sense check's IR case and
 * an open IR slot (Achane Stash naming his drop, Royer Add), with none (both Add), and with a bench spot
 * open as well (Achane Stash naming the slot, opening the platform's page); each with a clearing day on
 * its first add and its first stash. */
export function stashCases(
  withSlot: WaiverAdvice,
  noSlot: WaiverAdvice,
): Record<string, WaiverAdvice> {
  const benchOpen: WaiverAdvice = {
    ...withSlot,
    stash: (withSlot.stash ?? []).map((r) => ({ ...r, drop: null, drops: [] })),
  };
  const clearing = (a: WaiverAdvice): WaiverAdvice => ({
    ...a,
    rows: a.rows.map((r, i) => (i === 0 ? { ...r, clears: "2026-10-21" } : r)),
    stash: (a.stash ?? []).map((r, i) =>
      i === 0 ? { ...r, clears: "2026-10-22" } : r,
    ),
  });
  return {
    withSlot: clearing(withSlot),
    noSlot: clearing(noSlot),
    benchOpen: clearing(benchOpen),
  };
}

/** A claim's outcomes as the API words them, for the words built over them: the fixture's three
 * and a pending claim with no time the platform runs it. */
function results(claims: readonly HostMoveResult[]): HostMoveResult[] {
  const pending = claims.find((r) => r.outcome === "pending");
  return pending === undefined
    ? [...claims]
    : [...claims, { ...pending, processes_at: null }];
}

/** The bids the label and the problem are held to. */
const BIDS: readonly HostBid[] = [
  { amount: 0, min: 0, max: 87, left_known: true },
  { amount: 1, min: 1, max: 1000, left_known: false },
];
const TYPED = ["", "0", "5", "87", "88", "1.5", "abc", " 12 "];

/** The claim's words (move.ts) for each platform: the panel's title, the verb, its reading and
 * sending lines, the platform's page, a claim that never answered, each outcome's line in the zone
 * with the platform's own words under a refusal; and the bid's label and its problem for each typed
 * bid. */
export function claimWords(
  claims: readonly HostMoveResult[],
  zone: string,
): unknown {
  const hosts: readonly LeagueHost[] = [
    "espn",
    "mfl",
    "sleeper",
    "yahoo",
    "ffpc",
  ];
  return {
    title: moveTitle("claim"),
    hosts: hosts.map((host) => ({
      host,
      verb: verbWords("waivers", host),
      reading: readingWords(host, "claim"),
      setting: settingWords(host, "claim"),
      open: openHostWords(host),
      lost: lostWords(host, "claim"),
      results: results(claims).map((result) => ({
        outcome: result.outcome,
        sentence: result.sentence,
        processesAt: result.processes_at,
        hostWords: result.host_words,
        words: resultWords(host, result, zone),
        said:
          result.host_words === null ? null : hostSaid(host, result.host_words),
      })),
      bids: BIDS.map((bid) => ({
        bid,
        label: bidLabel(bid),
        problems: TYPED.map((typed) => ({
          typed,
          problem: bidProblem(host, typed, bid),
        })),
      })),
    })),
  };
}
