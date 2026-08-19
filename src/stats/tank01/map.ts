import type { Player, Position, StatLine } from "@/domain/player";
import type { GameStatus, GameSummary } from "../provider";
import { TANK01_CONFIG } from "./config";

/**
 * Tank01 returns EVERY value as a JSON string — `statusCode` on the envelope is the only number
 * in a response. So every read goes through here, and anything that is not a finite number
 * becomes 0 rather than NaN: a single NaN reaching the scoring engine turns a whole team's
 * weekly total into NaN, and it would do it silently.
 */
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function group(entry: unknown, name: string): Record<string, unknown> {
  if (typeof entry !== "object" || entry === null) return {};
  const found = (entry as Record<string, unknown>)[name];
  return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : {};
}

function isScoredPosition(value: string): value is Position {
  return (TANK01_CONFIG.scoredPositions as readonly string[]).includes(value);
}

/** `/getNFLPlayerList` → the offensive/kicking players the scoring engine handles. */
export function mapPlayerList(body: unknown): readonly Player[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly Player[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = str(record.playerID);
    const name = str(record.longName);
    const position = str(record.pos);
    const nflTeam = str(record.team);
    // A player missing any of these cannot be drafted, displayed or scored, so it is dropped
    // rather than emitted with a placeholder that would fail a foreign key at seed time.
    if (id === "" || name === "" || nflTeam === "" || !isScoredPosition(position)) return [];
    return [{ id, name, position, nflTeam }];
  });
}

/**
 * `/getNFLTeams` → one synthetic `DEF` player per NFL team.
 *
 * Tank01 has no concept of a team defense as a player; defensive stats arrive per side on a box
 * score. The domain does have a `DEF` position, so the two ends are bridged here — and the id is
 * minted from the SAME `defensePlayerIdPrefix` + `teamAbv` that `mapBoxScoreToStatLines` uses,
 * because a defense whose stat line references an unlisted player id is a foreign-key failure at
 * seed time and an unscored roster slot at runtime.
 */
export function mapTeamsToDefensePlayers(body: unknown): readonly Player[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly Player[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const abbreviation = str(record.teamAbv);
    if (abbreviation === "") return [];
    const city = str(record.teamCity);
    const nickname = str(record.teamName);
    const name = [city, nickname].filter((part) => part !== "").join(" ");
    return [
      {
        id: `${TANK01_CONFIG.defensePlayerIdPrefix}${abbreviation}`,
        name: name === "" ? abbreviation : name,
        position: "DEF",
        nflTeam: abbreviation,
      },
    ];
  });
}

/** `/getNFLGamesForWeek` → the fixtures, with the composite `YYYYMMDD_AWAY@HOME` id the box-score call needs. */
export function mapGames(body: unknown, week: number): readonly GameSummary[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly GameSummary[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const gameId = str(record.gameID);
    const home = str(record.home);
    const away = str(record.away);
    if (gameId === "" || home === "" || away === "") return [];
    return [{ gameId, week, status: mapGameStatus(record.gameStatus), homeNflTeam: home, awayNflTeam: away }];
  });
}

function mapGameStatus(raw: unknown): GameStatus {
  const value = str(raw).toLowerCase();
  if ((TANK01_CONFIG.gameStatuses.final as readonly string[]).includes(value)) return "final";
  if ((TANK01_CONFIG.gameStatuses.scheduled as readonly string[]).includes(value)) return "scheduled";
  // Everything else, INCLUDING an absent or unrecognized value. See `GameStatus`.
  return "in_progress";
}

function emptyStats(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    receptions: 0,
    fumblesLost: 0,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
  };
}

/**
 * `/getNFLBoxScore` → one `StatLine` per player who appeared, plus one per team defense.
 *
 * Four upstream behaviors this has to survive, all of them verified against captured responses:
 *
 * 1. **Stat groups are ABSENT, not empty**, when a player has none of that kind of stat. Every
 *    read goes through `group()`, which yields `{}` for a missing group, so a receiver simply
 *    reads 0 for every passing field rather than throwing on `undefined.passYds`.
 * 2. **`fumblesLost` lives under `Defense`, even for offensive players.** A quarterback who
 *    fumbles gets a `Defense` group containing it. Reading it from anywhere else scores every
 *    lost fumble in the league as zero, which is a silent scoring bug, not a crash.
 * 3. **2022-era responses have no `DST` block at all**, and some have a duplicate-casing bug in
 *    their team-id keys. Nothing here requires `DST` to exist.
 * 4. **A box score's `playerStats` carries no position** — unlike `/getNFLPlayerList`, there is
 *    no `pos` field to filter on here, and it includes every player who appeared, not only the
 *    scored positions `mapPlayerList` keeps (defensive backs, linemen, punters, ...). Emitting a
 *    line for one of those is a foreign-key failure at seed time, because `listPlayers()` never
 *    minted a `players` row for it. `listedPlayerIds` is the single source of truth for "which
 *    ids are allowed to exist" — the SAME ids `mapPlayerList`'s `isScoredPosition` predicate (and
 *    `mapTeamsToDefensePlayers`) already produced — so this function does not re-derive or
 *    duplicate a position list of its own; it only ever intersects against what was already
 *    decided once, upstream.
 */
export function mapBoxScoreToStatLines(
  body: unknown,
  week: number,
  listedPlayerIds: ReadonlySet<string>,
): readonly StatLine[] {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const playerStats = record.playerStats;
  const players: readonly StatLine[] =
    typeof playerStats === "object" && playerStats !== null
      ? Object.entries(playerStats as Record<string, unknown>).flatMap(([key, entry]): readonly StatLine[] => {
          const playerId = str((entry as Record<string, unknown> | null)?.playerID) || key;
          if (playerId === "" || !listedPlayerIds.has(playerId)) return [];
          const passing = group(entry, "Passing");
          const rushing = group(entry, "Rushing");
          const receiving = group(entry, "Receiving");
          const defense = group(entry, "Defense");
          const kicking = group(entry, "Kicking");
          return [
            {
              ...emptyStats(playerId, week),
              passingYards: num(passing.passYds),
              passingTouchdowns: num(passing.passTD),
              interceptions: num(passing.int),
              rushingYards: num(rushing.rushYds),
              rushingTouchdowns: num(rushing.rushTD),
              receivingYards: num(receiving.recYds),
              receivingTouchdowns: num(receiving.recTD),
              receptions: num(receiving.receptions),
              // See behavior (2) above. This is not a typo.
              fumblesLost: num(defense.fumblesLost),
              fieldGoalsMade: num(kicking.fgMade),
              extraPointsMade: num(kicking.xpMade),
              sacks: num(defense.sacks),
              defensiveInterceptions: num(defense.defensiveInterceptions),
              defensiveTouchdowns: num(defense.defTD),
            },
          ];
        })
      : [];

  const dst = record.DST;
  const sides = typeof dst === "object" && dst !== null ? Object.values(dst as Record<string, unknown>) : [];
  const defenses: readonly StatLine[] = sides.flatMap((side): readonly StatLine[] => {
    const entry = typeof side === "object" && side !== null ? (side as Record<string, unknown>) : {};
    const abbreviation = str(entry.teamAbv);
    const defenseId = `${TANK01_CONFIG.defensePlayerIdPrefix}${abbreviation}`;
    if (abbreviation === "" || !listedPlayerIds.has(defenseId)) return [];
    return [
      {
        ...emptyStats(defenseId, week),
        sacks: num(entry.sacks),
        defensiveInterceptions: num(entry.defensiveInterceptions),
        defensiveTouchdowns: num(entry.defTD),
      },
    ];
  });

  return [...players, ...defenses];
}
