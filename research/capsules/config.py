"""EVERY CAPSULE TUNABLE, in one place (`research-ts/src/capsules/config.ts`).

The gateway (Vercel AI Gateway, OpenAI-compatible, the key read from `AI_GATEWAY_API_KEY` at call
time and never printed), the two sizes a capsule ships in, the per-player call ceiling, the length
correction, the repetition measures and the sweep's budget. The measured history behind each number
is the oracle's and is not restated; the voice rules live in `voice_rules.py`.
"""

from dataclasses import dataclass
from typing import Final

from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE
from research.pipeline.nflverse.pbp_passers import PBP_PASSER_SOURCE
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE

CAPSULE_MODEL: Final = "zai/glm-5.3-flash"
_GATEWAY_CALLS_PER_MINUTE: Final = 12


@dataclass(frozen=True, slots=True)
class Retry:
    max_attempts: int = 2
    base_delay_ms: int = 1_500
    rate_limit_backoff_ms: tuple[int, ...] = (20_000, 40_000, 80_000)


@dataclass(frozen=True, slots=True)
class Gateway:
    base_url: str = "https://ai-gateway.vercel.sh/v1"
    api_key_variable: str = "AI_GATEWAY_API_KEY"
    timeout_ms: int = 20_000
    retry: Retry = Retry()
    calls_per_minute: int = _GATEWAY_CALLS_PER_MINUTE
    min_call_spacing_ms: int = round(60_000 / _GATEWAY_CALLS_PER_MINUTE)
    # The writer does not think before it writes (measured: more written, none throttled, cheaper).
    thinking: bool = False


@dataclass(frozen=True, slots=True)
class Size:
    min_words: int
    max_words: int
    max_tokens: int


@dataclass(frozen=True, slots=True)
class LengthCorrection:
    words_per_sentence: int = 20
    max_sentences_added: int = 3


@dataclass(frozen=True, slots=True)
class Repetition:
    max_share: float = 0.02
    max_quoted_sentences: int = 8
    # The six-word spans shared across pages (`capsules.spans`) a prompt quotes: the board's most
    # widely shared to every writer, and a repaired page its own.
    max_quoted_spans: int = 12
    # The pages written tonight whose spans the next writer call is checked against (`TonightSpans`).
    tonight_window_pages: int = 60
    opener_words: int = 4
    max_opener_family_share: float = 0.1
    max_refrain_share: float = 0.1
    max_sheet_touring_share: float = 0.25
    # The stems the board has worn out, measured across players (the oracle's list, with its history).
    refrain_stems: tuple[str, ...] = (
        "the price is wrong",
        "the stat that sells me",
        "the honest worry",
        "with a plan behind him",
        "let's talk about",
        "so the call",
        "so my call",
        "the band says",
        "the volume case",
        "not a talent read",
        "the books hang",
        "at the bottom he's",
        "our number says",
        "the honest hesitation",
        "at the top he's",
        "the engine of",
        "makes the case",
        "most seasons land",
        "the books set",
        "the market",
        "i'm buying",
        "he's a buy",
        "the depth chart is",
        "it says nothing about whether he can play",
        "nobody is drafting",
        "the number that decides",
        # The live review of 2026-10-14 (M1): stock lines across the board's pages.
        "is the whole story",
        "is the whole case",
        "the call is easy",
        "get cute",
        "cut short by injury",
        "our number puts him at",
        "once injury risk is in",
    )


@dataclass(frozen=True, slots=True)
class UnwrittenLine:
    """The share of the board the nightly lets go unwritten, and why. Ruled for Lane 17: in season a
    gate failure keeps the site on a stale run, which costs more than a few pages without a read that
    the next night retries first; the line still fails a broken writer."""

    voice: str
    share_max: float
    basis: str


@dataclass(frozen=True, slots=True)
class CapsuleConfig:
    gateway: Gateway = Gateway()
    compact: Size = Size(75, 120, 500)
    full: Size = Size(240, 300, 1600)
    # A player's gateway calls: the bundle, its retry, and the corrections, never more (the oracle
    # had four; ruled up to six in phase C's fix round 3).
    max_gateway_calls_per_player: int = 6
    # How far over its word cap a read may run once it has been asked for a shorter read: accepted,
    # not failed (ruled in phase C's fix round 3). A first draft is held to the cap itself.
    overrun_percent_after_length_correction: int = 10
    # Corrections one read may take inside that ceiling. The oracle stopped at one; a set phrase or
    # a betting word the first correction leaves (or brings) is worth a second sentence rewrite
    # before the read falls to the facts block, which the nightly counts against its 2% line.
    corrections_per_read: int = 2
    # The share of the board's pages the nightly lets go unwritten (facts blocks, the oracle's template
    # rows and missing pages together), one line per voice, the run's date deciding which.
    unwritten_line_preseason: UnwrittenLine = UnwrittenLine("preseason", 0.02, "the share the board was built to")
    unwritten_line_in_season: UnwrittenLine = UnwrittenLine(
        "in-season",
        0.03,
        "a full in-season rewrite's estimate tops out near 2.5% (Lane 17's 80-page sample), "
        "and one page moves an 80-page rate by 1.25 points",
    )
    # A written sentence this long or longer may sit on one page only; shorter ones ("Draft him.",
    # "Let him go.") are the product's vocabulary, not stock prose (ruled in phase C's fix round 3).
    shared_sentence_min_words: int = 4
    narrative_voice_rewrites_per_slot: int = 1
    length_correction: LengthCorrection = LengthCorrection()
    narrative_target_share_of_cap: float = 0.75
    bundle_max_tokens: int = 3000
    repetition: Repetition = Repetition()
    # A law group's |net effect| at or above this is a real, citable downside.
    tension_threshold_points: float = 1.0
    # Pages one night may write, every pass together (raised from 700 by the Lane 17 fix-round ruling so a
    # full rewrite leaves room for the retries and repairs). Measured in Lane 17 (2026-10-14, the
    # in-season floor): a page costs $0.0027 to $0.0038, so a full night is expected at about $2.70 to
    # $3.80 (ruled about $3.50). The hard bound is 1,000 pages at six calls each, about $4.15 at the board
    # run's $0.00069 a call (a page's one generation past the call ceiling comes out of the same budget). In season every page's sheet moves on the morning a week lands (about 536
    # pages, $1.60 to $2.00 before retries and repairs), injury designations move pages through the week,
    # and the span repairs rewrite two-page carriers every night, so steady nights spend real budget too,
    # up to the same ceiling. The board-scale measurement is in the Lane 17 report.
    sweep_generation_budget: int = 1000
    # Zero: every gateway call is spaced at `gateway.min_call_spacing_ms`, which paces the sweep.
    sweep_pacing_ms: int = 0
    # The licence gate, one per source: the stores whose figures may reach the writer's sheet (this
    # season's usage and play, `facts.season_usage`). A counsel ruling on any one is a flip here.
    # - On: nflverse's own play-by-play and weekly stats (CC-BY 4.0), and Next Gen Stats (the NFL's
    #   data) and PFR advanced stats (Pro Football Reference's), whose nflverse releases state no
    #   licence: flagged for counsel in the Lane 23 report and `docs/research/data-sources.md`.
    # - Off: FTN Data's charting (contested catches, blitz rate, interception-worthy throws), CC-BY-SA
    #   4.0 with attribution "must be made to FTN Data via nflverse"; the page carries no such credit,
    #   and the share-alike term is unruled for a paid page. The ingest stores every source either way.
    sources_on_pages: frozenset[str] = frozenset({
        PBP_PLAYER_SOURCE,
        PBP_PASSER_SOURCE,
        NflverseSource.PLAYER_WEEK,
        NflverseSource.SNAP_COUNTS,
        NGS_SOURCE,
        PFR_SOURCE,
    })  # fmt: skip

    def unwritten_line(self, *, in_season: bool) -> UnwrittenLine:
        """The line in use for a run: in season from the season's first kickoff on, preseason before."""
        return self.unwritten_line_in_season if in_season else self.unwritten_line_preseason

    def size(self, name: str) -> Size:
        if name == "compact":
            return self.compact
        if name == "full":
            return self.full
        raise ValueError(f"no capsule size {name!r}")


CAPSULE_CONFIG: Final = CapsuleConfig()
