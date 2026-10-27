"""THE LEGACY CORRESPONDENCE: how each research table reads out of the legacy `public` tables.

One entry per research table, and the single source both readers of the legacy schema use: the
parity harness (the TypeScript oracle still writes the legacy tables, so its rows are read through
this to compare with what the Python wrote into `research`) and `research.load_legacy` (the
one-shot copy at cutover). A new column reads the legacy column of the same name unless the entry
renames it or derives it; every legacy column must be read or listed as dropped with the reason,
and `unaccounted` is what enforces that, so nothing is lost silently.
"""

from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

from sqlalchemy import Table

from research.db.provenance import board_model_sql
from research.db.schema import METADATA

LEGACY_SCHEMA: Final = "public"
_ALIAS: Final = "legacy"

_SURROGATE_ID: Final = "a sequence draw, not a fact: the natural key is the primary key now"
_TABLE_NAMED_SOURCE: Final = "the same value on every row, the table's own name: the table says it"


@dataclass(frozen=True)
class Derived:
    """A new column computed from the legacy row: `sql` over the alias `legacy`."""

    sql: str
    reads: tuple[str, ...]
    why: str


@dataclass(frozen=True)
class Dropped:
    """A legacy column the research schema does not keep. `constant` names the one value the
    column may hold, which the loader verifies before it drops it."""

    why: str
    constant: str | None = None


@dataclass(frozen=True)
class RowFilter:
    """Legacy rows deliberately not carried over: `sql` keeps a row, `why` says what is left behind."""

    sql: str
    why: str


@dataclass(frozen=True)
class Invariant:
    """A fact about the legacy rows a derivation depends on: `violations` counts the legacy rows
    (alias `legacy`) that break it, and the loader refuses to copy while it is not zero."""

    violations: str
    why: str


@dataclass(frozen=True)
class LegacyTable:
    table: str
    legacy: str
    renamed: Mapping[str, str] = field(default_factory=lambda: MappingProxyType({}))
    derived: Mapping[str, Derived] = field(default_factory=lambda: MappingProxyType({}))
    dropped: Mapping[str, Dropped] = field(default_factory=lambda: MappingProxyType({}))
    keep: RowFilter | None = None
    invariants: tuple[Invariant, ...] = ()

    @property
    def research_table(self) -> Table:
        return METADATA.tables[f"{METADATA.schema}.{self.table}"]

    def expression(self, column: str) -> str:
        """The legacy SQL for one research column."""
        if column in self.derived:
            return self.derived[column].sql
        return f'{_ALIAS}."{self.renamed.get(column, column)}"'

    def select_sql(self, columns: Collection[str], legacy_schema: str = LEGACY_SCHEMA) -> str:
        """The legacy rows as research rows: each column under its research name."""
        listed = ", ".join(f'{self.expression(c)} AS "{c}"' for c in columns)
        where = f" WHERE {self.keep.sql}" if self.keep is not None else ""
        return f'SELECT {listed} FROM "{legacy_schema}"."{self.legacy}" AS {_ALIAS}{where}'

    def violations_sql(self, invariant: Invariant, legacy_schema: str = LEGACY_SCHEMA) -> str:
        return f'SELECT count(*) FROM "{legacy_schema}"."{self.legacy}" AS {_ALIAS} WHERE {invariant.violations}'

    def count_sql(self, legacy_schema: str = LEGACY_SCHEMA) -> str:
        """How many legacy rows the entry carries over."""
        where = f" WHERE {self.keep.sql}" if self.keep is not None else ""
        return f'SELECT count(*) FROM "{legacy_schema}"."{self.legacy}" AS {_ALIAS}{where}'

    def reads(self) -> frozenset[str]:
        """Every legacy column this entry consumes."""
        names = {c.name for c in self.research_table.columns if c.name not in self.derived}
        consumed = {self.renamed.get(name, name) for name in names}
        return frozenset(consumed | {r for d in self.derived.values() for r in d.reads})

    def unaccounted(self, legacy_columns: Collection[str]) -> tuple[str, ...]:
        """Legacy columns neither read nor dropped (a silent loss), and columns this entry reads
        that the legacy table does not have (a stale entry). Empty when the entry is complete."""
        present = frozenset(legacy_columns)
        lost = sorted(present - self.reads() - set(self.dropped))
        stale = sorted((self.reads() | set(self.dropped)) - present)
        return (
            *(f"legacy {self.legacy}.{c} neither read nor dropped" for c in lost),
            *(f"{self.table} names legacy {self.legacy}.{c}, which does not exist" for c in stale),
        )


def _surrogate() -> Mapping[str, Dropped]:
    return MappingProxyType({"id": Dropped(_SURROGATE_ID)})


def _table_named_source(table: str) -> Mapping[str, Dropped]:
    return MappingProxyType({"source": Dropped(_TABLE_NAMED_SOURCE, constant=table)})


def _float4_widened(column: str) -> Derived:
    """A legacy `real` read as the decimal it was written from: a float4's text is the shortest
    decimal that round-trips it (Postgres 12 on), so `12.3`, stored as 12.300000190734863, reads
    back as 12.3, which is what the provider published and what a double holds."""
    return Derived(
        f'{_ALIAS}."{column}"::text::double precision',
        (column,),
        "real widened to double precision through its shortest decimal text, the value as published",
    )


# The Tank01 store held one season, 2026, before the season column existed.
LEGACY_PROVIDER_SEASON: Final = 2026
_PROVIDER_SEASON: Final = Derived(
    str(LEGACY_PROVIDER_SEASON), (), "the legacy store held the current season, 2026, and named no season"
)

_REASONS_BOARD: Final = Derived(
    sql=(
        f'(SELECT max(p."as_of") FROM "{LEGACY_SCHEMA}"."preseason_projections" AS p '
        f'WHERE p."season" = {_ALIAS}."season" AND p."source" = {_ALIAS}."source")'
    ),
    reads=("season", "source"),
    why=(
        "a legacy reason belongs to the one board generation its (season, source) holds: the writer "
        "deleted and replaced both together, so the reasons are the stored generation's"
    ),
)
_REASON_ORDINAL: Final = Derived(
    sql=(
        f'(row_number() OVER (PARTITION BY {_ALIAS}."season", {_ALIAS}."source", {_ALIAS}."player_id" '
        f"ORDER BY {_ALIAS}.ctid) - 1)"
    ),
    reads=("season", "source", "player_id"),
    why=(
        "the order the legacy readers took a player's reasons in: the heap's physical order, which is "
        "the writer's emission order (revision 0003 stores it)"
    ),
)
_ONE_GENERATION: Final = Invariant(
    violations=(
        f'(SELECT count(DISTINCT p."as_of") FROM "{LEGACY_SCHEMA}"."preseason_projections" AS p '
        f'WHERE p."season" = {_ALIAS}."season" AND p."source" = {_ALIAS}."source") <> 1'
    ),
    why="a reason's board is only known when its (season, source) holds exactly one generation",
)
_BOARD_MODEL_VERSION: Final = Derived(
    board_model_sql(f'{_ALIAS}."source"', f'{_ALIAS}."as_of"', "model_version"),
    ("source", "as_of"),
    "the model that made the board, where research.db.provenance establishes it; NULL where nothing rebuilt it",
)
_BOARD_ARITHMETIC: Final = Derived(
    board_model_sql(f'{_ALIAS}."source"', f'{_ALIAS}."as_of"', "arithmetic"),
    ("source", "as_of"),
    "the floating point the board was made in, where a bit-for-bit rebuild established it",
)
_FREEZE_MODEL_VERSION: Final = Derived(
    board_model_sql(f'{_ALIAS}."board_source"', f'{_ALIAS}."board_as_of"', "model_version"),
    ("board_source", "board_as_of"),
    "the model of the board the freeze quotes (research.db.provenance)",
)
_FREEZE_MODEL_KNOWN: Final = Invariant(
    violations=f"{_FREEZE_MODEL_VERSION.sql} IS NULL",
    why="every legacy freeze quotes a board research.db.provenance names; a freeze without a model cannot be carried",
)
_GRADE_FREEZE_MODEL: Final = board_model_sql('f."board_source"', 'f."board_as_of"', "model_version")
_GRADE_MODEL_VERSION: Final = Derived(
    (
        f'(SELECT {_GRADE_FREEZE_MODEL} FROM "{LEGACY_SCHEMA}"."register_freeze_rows" AS f '
        f'WHERE f."season" = {_ALIAS}."season" AND f."week" = {_ALIAS}."week" AND f."frozen_at" = {_ALIAS}."frozen_at" '
        f'AND f."board_source" = {_ALIAS}."board_source" AND f."player_id" = {_ALIAS}."player_id")'
    ),
    ("season", "week", "frozen_at", "board_source", "player_id"),
    "the model of the freeze the grade grades",
)
_ONE_SEASON_OF_GAMES: Final = Invariant(
    violations=(
        f"left({_ALIAS}.\"game_id\", 8) NOT BETWEEN '{LEGACY_PROVIDER_SEASON}0301' "
        f"AND '{LEGACY_PROVIDER_SEASON + 1}0228'"
    ),
    why="every legacy fixture is dated inside the 2026 season the store is said to hold",
)

_CAPSULE_PLAYER: Final = Derived(
    sql=(
        f'(SELECT x."nfl_player_id" FROM "{LEGACY_SCHEMA}"."player_crosswalk" AS x '
        f'WHERE x."player_id" = {_ALIAS}."player_id")'
    ),
    reads=("player_id",),
    why="capsules key on the universe now; the legacy key was the provider id, mapped through the crosswalk",
)

_HOST_ID_WHY: Final = "the oracle's universe never kept the hosts' ids; `pipeline host-ids` fills them (revision 0005)"

_ENTRIES: Final = (
    LegacyTable(
        "players",
        "nfl_players",
        derived=MappingProxyType(
            {column: Derived("NULL", (), _HOST_ID_WHY) for column in ("sleeper_id", "yahoo_id", "mfl_id")}
        ),
    ),
    LegacyTable(
        "provider_players",
        "players",
        renamed=MappingProxyType({"team": "nfl_team"}),
        derived=MappingProxyType({"adp": _float4_widened("adp")}),
    ),
    LegacyTable(
        "player_crosswalk",
        "player_crosswalk",
        renamed=MappingProxyType({"provider_player_id": "player_id", "player_id": "nfl_player_id"}),
    ),
    LegacyTable("props_player_map", "props_player_map", dropped=_surrogate()),
    LegacyTable(
        "provider_stat_lines",
        "player_stat_lines",
        renamed=MappingProxyType({"provider_player_id": "player_id"}),
        derived=MappingProxyType(
            {
                "season": _PROVIDER_SEASON,
                "sacks": _float4_widened("sacks"),
                "offensive_snap_share": _float4_widened("offensive_snap_share"),
            }
        ),
    ),
    LegacyTable(
        "provider_games",
        "nfl_games",
        renamed=MappingProxyType({"home_team": "home_nfl_team", "away_team": "away_nfl_team"}),
        derived=MappingProxyType(
            {
                "season": _PROVIDER_SEASON,
                "game_date": Derived(
                    f"to_date(nullif({_ALIAS}.\"game_date\", ''), 'YYYYMMDD')",
                    ("game_date",),
                    "the provider's YYYYMMDD text as a date; the empty string the legacy default held is no date",
                ),
                "kickoff_et": Derived(
                    f"nullif({_ALIAS}.\"kickoff_et\", '')",
                    ("kickoff_et",),
                    "the empty string the legacy default held is no kickoff time",
                ),
                "superseded_by": Derived("NULL", (), "the legacy schedule never marked a moved game (B77b)"),
            }
        ),
        invariants=(_ONE_SEASON_OF_GAMES,),
    ),
    LegacyTable("provider_weeks", "stat_weeks", derived=MappingProxyType({"season": _PROVIDER_SEASON})),
    LegacyTable(
        "capture_snapshots",
        "capture_snapshots",
        derived=MappingProxyType(
            {"asked_game_id": Derived("NULL", (), "the legacy capture never asked a per-game box score (B86)")}
        ),
    ),
    LegacyTable("player_prop_observations", "player_prop_observations"),
    LegacyTable("player_week_observations", "player_week_observations", dropped=_surrogate()),
    LegacyTable("team_week_observations", "team_week_observations", dropped=_surrogate()),
    LegacyTable("player_week_teams", "player_week_teams", dropped=_surrogate()),
    LegacyTable("nflverse_injuries", "nflverse_injuries", dropped=_table_named_source("nflverse_injuries")),
    LegacyTable(
        "nflverse_kicking_weeks", "nflverse_kicking_weeks", dropped=_table_named_source("nflverse_kicking_weeks")
    ),
    LegacyTable("nflverse_roster_weeks", "nflverse_roster_weeks", dropped=_table_named_source("nflverse_roster_weeks")),
    LegacyTable(
        "nflverse_team_defense_weeks",
        "nflverse_team_defense_weeks",
        derived=MappingProxyType({"def_sacks": _float4_widened("def_sacks")}),
        dropped=_table_named_source("nflverse_team_defense_weeks"),
    ),
    LegacyTable("nfl_draft_picks", "nfl_draft_picks", dropped=_surrogate()),
    LegacyTable("coaches", "coaches", dropped=_surrogate()),
    LegacyTable(
        "preseason_rosters",
        "preseason_rosters",
        derived=MappingProxyType(
            {
                "birth_date": Derived(
                    f'{_ALIAS}."birth_date"::date', ("birth_date",), "nflverse's ISO date text as a date"
                )
            }
        ),
        dropped=_surrogate(),
    ),
    LegacyTable("preseason_rankings", "preseason_rankings", dropped=_surrogate()),
    LegacyTable(
        "adp_snapshots",
        "adp_snapshots",
        derived=MappingProxyType({"adp": _float4_widened("adp")}),
        dropped=_surrogate(),
    ),
    LegacyTable("model_artifacts", "model_artifacts", dropped=_surrogate()),
    LegacyTable(
        "preseason_projections",
        "preseason_projections",
        derived=MappingProxyType({"model_version": _BOARD_MODEL_VERSION, "arithmetic": _BOARD_ARITHMETIC}),
        dropped=_surrogate(),
    ),
    LegacyTable(
        "preseason_board_reasons",
        "preseason_board_reasons",
        derived=MappingProxyType({"as_of": _REASONS_BOARD, "ordinal": _REASON_ORDINAL}),
        invariants=(_ONE_GENERATION,),
    ),
    LegacyTable(
        "register_freeze_rows",
        "register_freeze_rows",
        renamed=MappingProxyType({"adp": "adp_rank", "ecr": "ecr_rank"}),
        # A MAPPING RULE, not a fact the legacy row states: the legacy table has no such column, and
        # every row in it was frozen by the TypeScript (2026 weeks 1 and 2). When phase B compares
        # `register_freeze_rows` in parity, the Python side writes 'python' for the same freeze, so
        # that case must exclude this column with this reason (`TableSpec.also_excluded`).
        derived=MappingProxyType(
            {
                "implementation": Derived(
                    "'typescript'", (), "every legacy freeze was taken by the TypeScript (2026 weeks 1 and 2)"
                ),
                "model_version": _FREEZE_MODEL_VERSION,
                "published_points": Derived(
                    "NULL::double precision",
                    (),
                    "no legacy freeze kept the week's published projection (revision 0013)",
                ),
                "espn_points": Derived(
                    "NULL::double precision",
                    (),
                    "no legacy freeze kept ESPN's weekly projection (revision 0017)",
                ),
                "espn_read_at": Derived(
                    "NULL::timestamptz",
                    (),
                    "no legacy freeze kept an ESPN read, so none names its instant (revision 0019)",
                ),
            }
        ),
        dropped=_surrogate(),
        invariants=(_FREEZE_MODEL_KNOWN,),
    ),
    LegacyTable(
        "register_grade_rows",
        "register_grade_rows",
        derived=MappingProxyType(
            {
                "implementation": Derived("'typescript'", (), "every legacy grade was taken by the TypeScript"),
                "model_version": _GRADE_MODEL_VERSION,
            }
        ),
        dropped=_surrogate(),
    ),
    LegacyTable(
        "player_capsules",
        "player_capsules",
        derived=MappingProxyType({"player_id": _CAPSULE_PLAYER}),
        keep=RowFilter(
            f"{_CAPSULE_PLAYER.sql} IS NOT NULL",
            "a capsule whose provider player the crosswalk never matched has no universe player to key on",
        ),
    ),
)

LEGACY_TABLES: Final[Mapping[str, LegacyTable]] = MappingProxyType({entry.table: entry for entry in _ENTRIES})

# Research tables with no legacy counterpart at all, and why: nothing to copy or compare.
NEW_IN_RESEARCH: Final[Mapping[str, str]] = MappingProxyType(
    {
        "preseason_candidates": "each board's candidate set, kept from revision 0005 so a custom board can be built",
        "custom_boards": "the custom-scoring board cache (revision 0005), rebuilt on demand from the candidates",
        "published_boards": "the published run's board rows (revision 0006), rewritten by every publish",
        "nflverse_games": "nflverse's game table (revision 0010), one row per game, updated as a game's facts move",
        "nflverse_game_reads": "each game-table pass's read of a game's venue and kickoff (revision 0010), append-only",
        "game_voids": "an operator's void of one game so it never blocks its week's grade (revision 0023), append-only",
        "stadiums": "the venues from the reviewed Wikidata seed (revision 0010), rewritten by its validating ingest",
        "nws_grid_points": "the weather service's grid cell per stadium and season (revision 0010), the forecast job's cache",
        "nflverse_pbp_plays": "the play-level play-by-play the weekly round 4 fits on (revision 0009), from nflverse",
        "nflverse_depth_chart_weeks": "nflverse's weekly depth charts (revision 0009); legacy held week 1 only",
        "game_weather": "the recorded kickoff weather with each value's source (revision 0009)",
        "tank01_projection_rows": "Tank01's weekly projection parsed per player (revision 0009), a benchmark",
        "espn_projection_rows": "ESPN's public weekly projection per player (revision 0017), a yardstick, append-only",
        "espn_kdef_archive_rows": "ESPN's archived 2023-2024 kicker and D/ST projections (revision 0021), a benchmark",
        "headshot_copies": "our headshot copies per player and season (revision 0022), the images bucket's ledger",
        "player_td_prop_observations": "the anytime-touchdown market (revision 0009), a benchmark",
        "capture_checks": "each capture feed's last successful check (revision 0008), rewritten by every capture pass",
        "register_weekly_rows": "the weekly number frozen per game before its kickoff (revision 0011), append-only",
        "player_week_reads": "the week-ahead read per player and week (revision 0012), rewritten on the read's cadence",
        "player_week_read_runs": "each week-read pass's spend (revision 0012), append-only",
    }
)

# Legacy tables the research schema does not carry at all, and why.
NOT_CARRIED: Final[Mapping[str, str]] = MappingProxyType(
    {
        "player_peek_documents": "the old app's peek page cache; research-ts neither reads nor writes it",
        "player_peek_facts": "the old app's peek facts; the capsule sweep recomputes facts from the store",
    }
)


def check_complete() -> None:
    """Every research table has exactly one entry. Run at import by the two readers."""
    research = {t.name for t in METADATA.tables.values()}
    missing = sorted(research - set(LEGACY_TABLES) - set(NEW_IN_RESEARCH))
    extra = sorted(set(LEGACY_TABLES) - research)
    if missing or extra:
        raise LookupError(f"research.db.legacy is out of step with the schema: missing {missing}, unknown {extra}")
