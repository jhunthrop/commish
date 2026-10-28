"""EVERY CAPSULE TUNABLE, in one place (`research-ts/src/capsules/config.ts`).

The gateway (Vercel AI Gateway, OpenAI-compatible, the key read from `AI_GATEWAY_API_KEY` at call
time and never printed), the two sizes a capsule ships in, the per-player call ceiling, the length
correction, the repetition measures and the sweep's budget. The measured history behind each number
is the oracle's and is not restated; the voice rules live in `voice_rules.py`.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from research.errors import ConfigurationError
from research.pipeline.nflverse.ftn import FTN_SOURCE
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE
from research.pipeline.nflverse.pbp_passers import PBP_PASSER_SOURCE
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE

# The writer's model, the gateway's slug. A setting: `CAPSULE_MODEL` in the environment overrides it
# (`writer_settings`); Lane 24 measured the candidates and the coordinator ruled it stays (2026-10-15).
CAPSULE_MODEL: Final = "zai/glm-5.3-flash"


@dataclass(frozen=True, slots=True)
class Retry:
    max_attempts: int = 2
    base_delay_ms: int = 1_500
    # A 429's backoffs within one call: 30 s in all, so the four calls of one ask (the first and its
    # three re-asks, `throttle_waits_ms`) fit inside an ask's 150 s cap with the re-ask waits (the
    # re-review's N2: at 20, 40 and 80 s the gateway's own backoffs used the cap before any re-ask).
    rate_limit_backoff_ms: tuple[int, ...] = (5_000, 10_000, 15_000)
    # The longest `retry-after` a call waits out (the review's M1): honoured however long up to here,
    # past it the call fails with the reason rather than tying up a writer slot for longer.
    retry_after_cap_ms: int = 300_000


@dataclass(frozen=True, slots=True)
class Gateway:
    base_url: str = "https://ai-gateway.vercel.sh/v1"
    api_key_variable: str = "AI_GATEWAY_API_KEY"
    timeout_ms: int = 20_000
    retry: Retry = Retry()
    # The writer's throughput (Lane 24): at most `concurrency` pages in flight at once, every call
    # drawing a token from one bucket refilled at `calls_per_minute`. The old 12 a minute, strictly
    # sequential, was a guess after one 429 in a trial and made a full in-season night take hours.
    # Each is a setting, overridden by its environment variable (`writer_settings`).
    # The defaults, ruled 2026-10-15: 16 in flight and 600 a minute. The basis: the coordinator's
    # probe that day (96 capsule-sized calls in flight at once to zai/glm-5.3-flash, all answered, no
    # 429, no rate-limit header) and Lane 24's 80-page measurement (four models, 3,247 calls at 8 in
    # flight and 120 a minute, no 429 from the gateway). The gateway states no limit, so the bucket is
    # a safety valve, not a pace.
    concurrency: int = 16
    calls_per_minute: int = 600
    # The widest pool a run may ask for: each slot holds a database connection (`db.engine.pooled_like`).
    max_concurrency: int = 64
    model_variable: str = "CAPSULE_MODEL"
    concurrency_variable: str = "CAPSULE_CONCURRENCY"
    calls_per_minute_variable: str = "CAPSULE_CALLS_PER_MINUTE"
    # The gateway's providers a call may be served by, comma separated (`providerOptions.gateway.only`);
    # unset lets the gateway route. Lane 24 pinned a rapid host with it for the measurement.
    providers_variable: str = "CAPSULE_PROVIDERS"
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
    # The pages landed tonight whose spans the next writer call is told about and a landing page is
    # checked against (`landing.TonightWindow`).
    tonight_window_pages: int = 60
    # The span repair's pages a night, every repair attempt together: the pages carrying the most
    # shared spans first, the rest counted and left (ruled 2026-10-15: the uncapped pass rewrote about
    # 403 of 513 carrier pages a night for $0.81 to $1.01 and never converged). Basis: a span rewrite
    # costs about $0.002 (production 2026-10-15, $1.01 over 509 pages; Lane 24's sample, $0.168 over
    # 83), so 90 pages keep a night's span repair near $0.18, under the ruled $0.20.
    span_repair_pages_per_night: int = 90
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
    # WORN PHRASES FOR NEW WRITES ONLY (the coordinator's ruling of 2026-10-15, Option B). The stems above
    # are set phrases the page gate also refuses on every stored page. A worn phrase added from now on
    # goes here unless a ruling says otherwise: the writer is told it and the validator refuses it on
    # every new write, but a stored page carrying it is not a page-gate repair target, so a new phrase
    # never turns the whole stored board into repair targets on its first night. The week a full
    # rewrite lands (every page's facts move) applies it to every page.
    # The list targets non-stat phrases only ("the run-up to", "on file", "if he is on your roster"). A
    # sentence that restates a number the sheet prints ("our preseason number was 180 points", "we had
    # him down for 180") is a stat sentence, not stock prose, and never goes here (the coordinator's
    # ruling for Lane 50, 2026-10-15).
    validator_only_stems: tuple[str, ...] = (
        # The live review of 2026-10-15 (M1): the old injury label, on 206 live pages.
        "the run-up to",
        # Clerk's language, on 113 live pages; the sheet prints it nowhere.
        "on file",
        # Lane 50: the sentence stems (first six words, numbers as "#") on more than 3% of the 567
        # written pages of the live run 2026-10-15T14-2, less the stat sentences. Held back, each with
        # its live pages: "our preseason number was # points" (155), "our preseason number had him at"
        # (43) and "our preseason number gave him #" (29), which restate the sheet's "Our preseason
        # number:", and "he has not missed a game" (31), the sheet's own sentence. Lane 50's 40-page
        # sample refused them on 26 pages, in the last failing attempt of 6 of its 17 facts blocks.
        # "weeks # through # of #" (27) is the week naming the time rules require.
        "if he is on your roster",  # 27 pages
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
    # A THROTTLE IS NOT A BLOCK (Lane 52): an ask the gateway fails on a rate limit or a transport failure
    # (`GenerationError.transport`, after the client's own retry and 429 backoffs) is asked again with
    # the same prompt after each of these waits, and never counts against the six above. Every re-ask
    # is an HTTP call on the page's bill and the run's budget (`run_budget`), and the night's per-player
    # ceiling counts it. Lane 50's 40-page samples ended 4 of 38 blocks "throttled" on the last ask.
    # Four calls of 30 s of 429 backoffs and these 30 s of re-ask waits make the 150 s cap exactly.
    throttle_waits_ms: tuple[int, ...] = (5_000, 10_000, 15_000)
    # The most one ask waits on throttles, every wait together: the gateway's own 429 backoffs and
    # `retry-after` included (`throttle_waits.AskWaits`, the review's M1).
    throttle_ask_wait_cap_ms: int = 150_000
    # The run's throttle pool, every page together (`throttle_waits.run_wait_cap_s`, ruled for the
    # re-review's N2): an ask's cap for every writer slot, this many times over (4,800 s at 16 slots).
    throttle_run_asks_per_slot: int = 2
    # The heaviest prompt a trial page's start rule assumes (`run_budget.room_for_page`): Lane 50
    # measured 4,517 prompt tokens at most; the dollar reservation itself reads each call's real prompt.
    trial_worst_prompt_tokens: int = 8_000
    # How far over its word cap a read may run once it has been asked for a shorter read: accepted,
    # not failed (ruled in phase C's fix round 3). A first draft is held to the cap itself.
    overrun_percent_after_length_correction: int = 10
    # Corrections one read may take inside that ceiling. The oracle stopped at one; a set phrase or
    # a betting word the first correction leaves (or brings) is worth a second sentence rewrite
    # before the read falls to the facts block, which the nightly counts against its 2% line.
    corrections_per_read: int = 2
    # The share of the board's pages the nightly lets go unwritten (facts blocks, the oracle's template
    # rows and missing pages together), one line per voice, the run's date deciding which.
    # The in-season basis (Lane 73 ruling 4, 2026-10-17; the 3% is the founder's floor and does not
    # move): the night that sets the share is a full-board one, every sheet moved when a week's games
    # land, written under the night's call ceiling (two generations' asks and one grace) and the
    # demotion. 2026-10-17T05 was the first: 25 of 536 pages unwritten (4.7%), 10 at the ceiling, 5
    # written pages lost to a shared-sentence rewrite, 10 demoted. Counting the writer's asks rather than
    # HTTP calls, one retry after the demotion and printed sentences exempt bring that night's numbers
    # to about 14 pages (2.6%), two under the line; a night that rewrites a few pages stays near 0%.
    unwritten_line_preseason: UnwrittenLine = UnwrittenLine("preseason", 0.02, "the share the board was built to")
    unwritten_line_in_season: UnwrittenLine = UnwrittenLine(
        "in-season",
        0.03,
        "a full-board night (every sheet moved) under the call ceiling, the demotion and the retry after it "
        "is expected near 2.6% (2026-10-17's numbers under Lane 73)",
    )
    # A written sentence this long or longer may sit on one page only; shorter ones ("Draft him.",
    # "Let him go.") are the product's vocabulary, not stock prose (ruled in phase C's fix round 3).
    shared_sentence_min_words: int = 4
    # A week read's sentence this long or longer, with every player name, club and number a placeholder
    # (`narrative.ShapeMasks`), may carry its shape on one page only (Lane 265, as Lane 261's bake-off
    # measured repetition); shorter shapes ("Sit [name] for week [number].") are the call's vocabulary.
    shared_shape_min_words: int = 6
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
    # The licence gate, one per source: the stores whose figures may reach the writer's sheet (this
    # season's usage and play, `facts.season_usage`). A counsel ruling on any one is a flip here.
    # - nflverse's own play-by-play and weekly stats (CC-BY 4.0), and Next Gen Stats (the NFL's data)
    #   and PFR advanced stats (Pro Football Reference's), whose nflverse releases state no licence:
    #   flagged for counsel in the Lane 23 report and `docs/research/data-sources.md`.
    # - FTN Data's charting (contested catches, blitz rate, interception-worthy throws), CC-BY-SA 4.0
    #   with attribution "must be made to FTN Data via nflverse": on from Lane 41 (ruled 2026-10-15),
    #   once the site's `/data` page printed the credit and every player page linked it. Its figures
    #   sit inside the four-figure cap's priority order (`season_usage.FIGURE_PRIORITY`), never a
    #   fifth. The share-alike question for a paid page stays with counsel.
    # The ingest stores every source whether or not it is on pages.
    sources_on_pages: frozenset[str] = frozenset({
        PBP_PLAYER_SOURCE,
        PBP_PASSER_SOURCE,
        NflverseSource.PLAYER_WEEK,
        NflverseSource.SNAP_COUNTS,
        NGS_SOURCE,
        PFR_SOURCE,
        FTN_SOURCE,
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


@dataclass(frozen=True, slots=True)
class WriterSettings:
    """The writer's model and throughput for one run, the config's defaults with the environment's
    overrides applied (`writer_settings`)."""

    model: str
    concurrency: int
    calls_per_minute: int
    providers: tuple[str, ...] = ()

    def line(self) -> str:
        routed = ", ".join(self.providers) if self.providers else "the gateway's routing"
        return (
            f"writer {self.model} via {routed}, {self.concurrency} pages at once, "
            f"at most {self.calls_per_minute} calls a minute"
        )


def _positive(environ: Mapping[str, str], variable: str, default: int, maximum: int | None = None) -> int:
    raw = environ.get(variable, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigurationError(f"{variable} must be a whole number, got {raw!r}.") from None
    if value < 1:
        raise ConfigurationError(f"{variable} must be at least 1, got {value}.")
    if maximum is not None and value > maximum:
        raise ConfigurationError(f"{variable} must be at most {maximum}, got {value}.")
    return value


def writer_settings(environ: Mapping[str, str], gateway: Gateway = CAPSULE_CONFIG.gateway) -> WriterSettings:
    """The run's writer settings: each environment variable that is set overrides its default, and a
    malformed one fails the run before any call is made."""
    model = environ.get(gateway.model_variable, "").strip() or CAPSULE_MODEL
    providers = tuple(p.strip() for p in environ.get(gateway.providers_variable, "").split(",") if p.strip())
    return WriterSettings(
        model,
        _positive(environ, gateway.concurrency_variable, gateway.concurrency, gateway.max_concurrency),
        _positive(environ, gateway.calls_per_minute_variable, gateway.calls_per_minute),
        providers,
    )
