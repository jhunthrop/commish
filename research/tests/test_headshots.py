"""Our headshot copies (Lane 241): the addresses, the fetch, the conversion, the throttle, the run's faces,
and the sync and the curation against a stub source and a stub bucket. The ledger tests need
PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped without it,
and run by CI."""

import io
import itertools
import os
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from PIL import Image
from sqlalchemy import Engine, text

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.headshots.__main__ import run_sync
from research.headshots.bucket import ImageBucket, R2ImageBucket
from research.headshots.config import APP_WIDTH, CACHE_CONTROL, SYNC_WORKERS, WIDTHS, copy_key, face_url
from research.headshots.curate import CurationError, curate, curation_lines, refresh
from research.headshots.faces import our_face
from research.headshots.images import MAX_BYTES, FetchFailedError, NoImageError, Source, fetch, webp_widths
from research.headshots.sync import SyncDeps, Throttle, due, error_reason, sync
from research.headshots.table import Candidate, Write, curation_list, faced_ids, write, write_unless_curated
from research.nightly.r2 import R2Credentials, R2RunStore
from research.parity import databases

_DATABASE = "parity_test_headshots"
_NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
_ESPN = "https://a.espncdn.com/i/headshots/nfl/players/full/{}.png"
_NO_PHOTO = "https://a.espncdn.com/combiner/i?img=/i/headshots/nophoto.png&w=200&h=146"
_INTERVAL = 0.5  # the sync's two fetches a second
_MANY = 24
_PAIR = 2


def _png(width: int = 600, height: int = 436) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (width, height), (200, 30, 30, 255)).save(buffer, "PNG")
    return buffer.getvalue()


_IMAGE = _png()


@dataclass
class StubBucket:
    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)

    def put(self, key: str, body: bytes, content_type: str) -> None:
        self.objects[key] = (body, content_type)

    def locate(self, key: str) -> str:
        return f"stub://{key}"


@dataclass
class StubSource:
    """The provider's image host: an image for most ids, a 404 or a 500 for the named ones."""

    gone: frozenset[str] = frozenset()
    broken: frozenset[str] = frozenset()
    requests: list[str] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        name = request.url.path.rsplit("/", 1)[-1]
        if any(name.startswith(g + ".") for g in self.gone):
            return httpx.Response(404)
        if any(name.startswith(b + ".") for b in self.broken):
            return httpx.Response(500)
        return httpx.Response(200, content=_IMAGE, headers={"content-type": "image/png"})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


@dataclass
class FakeClock:
    at: float = 1000.0
    slept: list[float] = field(default_factory=list)

    def now(self) -> float:
        return self.at

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.at += seconds


# The addresses ---------------------------------------------------------------------------------------


def test_a_copy_is_keyed_by_season_player_and_width_on_our_host() -> None:
    # The web (headshot.test.ts) and the API (headshots_test.go) pin this same URL.
    assert face_url(2026, "4429795") == "https://images.trycommish.app/headshots/2026/4429795/320.webp"
    assert APP_WIDTH in WIDTHS
    assert copy_key(2026, "4429795", 48) == "headshots/2026/4429795/48.webp"
    with pytest.raises(ConfigurationError):
        copy_key(2026, "team-def:KC", 48)
    with pytest.raises(ConfigurationError):
        copy_key(2026, "4429795", 50)


# The fetch and the conversion ------------------------------------------------------------------------


def test_the_fetch_reads_an_image_and_names_a_missing_or_failed_one() -> None:
    source = StubSource(gone=frozenset({"2"}), broken=frozenset({"3"}))
    hosts = frozenset({"a.espncdn.com"})
    with source.client() as http:
        assert fetch(http, Source(_ESPN.format(1), hosts)) == _IMAGE
        with pytest.raises(NoImageError):
            fetch(http, Source(_ESPN.format(2), hosts))
        with pytest.raises(FetchFailedError):
            fetch(http, Source(_ESPN.format(3), hosts))
        with pytest.raises(NoImageError):
            fetch(http, Source(_NO_PHOTO, hosts))
        with pytest.raises(NoImageError):
            fetch(http, Source(None, hosts))
        with pytest.raises(FetchFailedError, match="not the provider's image host"):
            fetch(http, Source("https://example.com/1.png", hosts))
        with pytest.raises(FetchFailedError, match="https"):
            fetch(http, Source("http://a.espncdn.com/1.png", None))
    assert source.requests == [_ESPN.format(1), _ESPN.format(2), _ESPN.format(3)]


def test_the_fetch_follows_no_redirect_and_stops_past_its_bound() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("moved.png"):
            return httpx.Response(302, headers={"location": "https://elsewhere.example/x.png"})
        return httpx.Response(200, content=b"x" * (MAX_BYTES + 1))

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(FetchFailedError, match="HTTP 302"):
            fetch(http, Source("https://a.espncdn.com/moved.png", None))
        with pytest.raises(FetchFailedError, match="passed"):
            fetch(http, Source("https://a.espncdn.com/big.png", None))


def test_every_kept_width_is_webp_at_the_sources_aspect() -> None:
    copies = webp_widths(_IMAGE)
    assert sorted(copies) == list(WIDTHS)
    for width, body in copies.items():
        with Image.open(io.BytesIO(body)) as image:
            assert image.format == "WEBP"
            assert image.size == (width, round(436 * width / 600))
    with pytest.raises(FetchFailedError):
        webp_widths(b"<html>not an image</html>")


# The throttle and the rules --------------------------------------------------------------------------


def test_the_throttle_lets_two_fetches_a_second() -> None:
    clock = FakeClock()
    throttle = Throttle(0.5, clock.now, clock.sleep)
    throttle.wait()
    throttle.wait()
    clock.at += 0.2
    throttle.wait()
    clock.at += 1.0
    throttle.wait()
    assert clock.slept == [0.5, pytest.approx(0.3)]


def test_a_copy_from_the_same_source_and_a_curated_one_are_never_fetched() -> None:
    url = _ESPN.format(1)
    assert due(Candidate("1", url, None, None))
    assert not due(Candidate("1", url, "copied", url))
    assert due(Candidate("1", _ESPN.format(2), "copied", url))  # the source moved
    assert not due(Candidate("1", url, "curated", "https://chosen.example/1.png"))
    assert due(Candidate("1", url, "refresh", url))
    assert due(Candidate("1", url, "failed", url))
    assert due(Candidate("1", url, "missing", url))  # a 404 is asked again
    assert not due(Candidate("1", None, "missing", None))  # no source: once, until it changes


def test_the_runs_face_is_our_address_never_the_providers() -> None:
    faced = frozenset({"7"})
    assert our_face(2026, "1", _ESPN.format(1), frozenset()) == face_url(2026, "1")
    assert our_face(2026, "7", None, faced) == face_url(2026, "7")  # curated with no provider image
    assert our_face(2026, "8", None, faced) is None
    assert our_face(2026, "team-def:KC", None, faced) is None


def test_the_r2_bucket_writes_the_year_long_cache_rule() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        store = R2RunStore(http, "acct", R2Credentials("id", "secret"), "commish-images")
        R2ImageBucket(store, "headshots-lane241/").put("headshots/2026/1/48.webp", b"w", "image/webp")
    assert seen[0].url.path == "/commish-images/headshots-lane241/headshots/2026/1/48.webp"
    assert seen[0].headers["cache-control"] == CACHE_CONTROL == "public, max-age=31536000, immutable"
    assert seen[0].headers["content-type"] == "image/webp"


# The sync and the curation against the ledger --------------------------------------------------------


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _players(engine: Engine, rows: list[tuple[str, str, str | None]]) -> None:
    with engine.begin() as conn:
        conn.execute(text("delete from research.headshot_copies"))
        conn.execute(text("delete from research.provider_players"))
        for adp, (pid, position, url) in enumerate(rows, start=1):
            conn.execute(
                text(
                    "insert into research.provider_players (id, name, position, adp, headshot_url) "
                    "values (:id, :name, :position, :adp, :url)"
                ),
                {"id": pid, "name": f"Player {pid}", "position": position, "adp": float(adp), "url": url},
            )


def _deps(
    engine: Engine,
    http: httpx.Client,
    bucket: ImageBucket,
    clock: FakeClock,
    *,
    workers: int = SYNC_WORKERS,
) -> SyncDeps:
    ticks = iter(range(10_000))
    return SyncDeps(
        engine=engine,
        http=http,
        bucket=bucket,
        throttle=Throttle(_INTERVAL, clock.now, clock.sleep),
        now=lambda: _NOW + timedelta(seconds=next(ticks)),
        log=lambda line: None,
        workers=workers,
    )


def _rows(engine: Engine) -> dict[str, tuple[str, str | None, str | None]]:
    with engine.connect() as conn:
        found = conn.execute(text("select player_id, status, source_url, curated_by from research.headshot_copies"))
        return {r.player_id: (r.status, r.source_url, r.curated_by) for r in found}


def _keys(bucket: StubBucket, pid: str) -> set[str]:
    return {k for k in bucket.objects if k.startswith(f"headshots/2026/{pid}/")}


def test_the_sync_copies_lists_and_never_refetches(engine: Engine) -> None:
    _players(
        engine,
        [
            ("1", "RB", _ESPN.format(1)),
            ("2", "WR", _NO_PHOTO),
            ("3", "TE", _ESPN.format(3)),  # 404
            ("4", "QB", _ESPN.format(4)),  # 500
            ("5", "K", None),
            ("6", "DEF", None),  # a defense: never a copy
        ],
    )
    source = StubSource(gone=frozenset({"3"}), broken=frozenset({"4"}))
    bucket = StubBucket()
    clock = FakeClock()
    with source.client() as http:
        counts = sync(_deps(engine, http, bucket, clock), 2026)
    assert counts.line() == "1 copied, 0 skipped, 3 missing, 1 failed"
    # 1, 3 and 4; no request for the placeholder or the empty source.
    assert sorted(source.requests) == [_ESPN.format(1), _ESPN.format(3), _ESPN.format(4)]
    assert clock.slept == [0.5, 0.5]  # two fetches a second
    assert _keys(bucket, "1") == {f"headshots/2026/1/{w}.webp" for w in WIDTHS}
    assert all(content_type == "image/webp" for _, content_type in bucket.objects.values())
    rows = _rows(engine)
    assert {pid: status for pid, (status, _, _) in rows.items()} == {
        "1": "copied",
        "2": "missing",
        "3": "missing",
        "4": "failed",
        "5": "missing",
    }
    with engine.connect() as conn:
        assert faced_ids(conn, 2026) == {"1"}
        listed = curation_list(conn, 2026)
    assert [r.player_id for r in listed] == ["2", "3", "4", "5"]
    assert curation_lines(listed)[2].startswith("4\tPlayer 4\tQB\tfailed\tHTTP 500")

    # Again: the copy is not fetched, the empty and placeholder sources are not either; the 404 and
    # the failure are asked again.
    source.requests.clear()
    with source.client() as http:
        again = sync(_deps(engine, http, bucket, FakeClock()), 2026)
    assert again.line() == "0 copied, 3 skipped, 1 missing, 1 failed"
    assert sorted(source.requests) == [_ESPN.format(3), _ESPN.format(4)]


def test_a_curated_copy_is_never_overwritten_and_a_refresh_is_fetched(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("9", "WR", None)])
    bucket = StubBucket()
    source = StubSource()
    with source.client() as http:
        deps = _deps(engine, http, bucket, FakeClock())
        curate(deps, 2026, "9", "https://chosen.example/9.jpg", " coordinator ")
        assert _rows(engine)["9"] == ("curated", "https://chosen.example/9.jpg", "coordinator")
        assert _keys(bucket, "9") == {f"headshots/2026/9/{w}.webp" for w in WIDTHS}

        # A curated row is never overwritten, even when the provider's source changes.
        with engine.begin() as conn:
            conn.execute(
                text("update research.provider_players set headshot_url = :u where id = '9'"), {"u": _ESPN.format(9)}
            )
        source.requests.clear()
        counts = sync(deps, 2026)
        assert counts.line() == "1 copied, 1 skipped, 0 missing, 0 failed"
        assert source.requests == [_ESPN.format(1)]
        assert _rows(engine)["9"][0] == "curated"

        # A refresh mark is fetched by the next sync, and the row becomes a copy again.
        refresh(deps, 2026, "1")
        assert _rows(engine)["1"][0] == "refresh"
        source.requests.clear()
        sync(deps, 2026)
        assert source.requests == [_ESPN.format(1)]
        assert _rows(engine)["1"][0] == "copied"

        with pytest.raises(CurationError, match="not a provider player"):
            curate(deps, 2026, "404", "https://chosen.example/x.png", "coordinator")
        with pytest.raises(CurationError, match="--by"):
            curate(deps, 2026, "9", "https://chosen.example/x.png", " ")
        with pytest.raises(CurationError, match="no row"):
            refresh(deps, 2026, "12345")


def test_a_curation_from_a_url_with_no_image_is_refused_and_writes_nothing(engine: Engine) -> None:
    _players(engine, [("1", "RB", None)])
    bucket = StubBucket()
    with StubSource(gone=frozenset({"x"})).client() as http:
        deps = _deps(engine, http, bucket, FakeClock())
        with pytest.raises(CurationError, match="no usable image"):
            curate(deps, 2026, "1", "https://chosen.example/x.png", "coordinator")
    assert bucket.objects == {}
    assert _rows(engine) == {}


class RecordingThrottle(Throttle):
    """The sync's throttle, recording the time each fetch was let through."""

    def __init__(self, clock: FakeClock) -> None:
        super().__init__(_INTERVAL, clock.now, clock.sleep)
        self.granted: list[float] = []
        self._seen = threading.Lock()

    def wait(self) -> float:
        at = super().wait()
        with self._seen:
            self.granted.append(at)
        return at


def test_a_sync_over_many_players_at_once_starts_at_most_two_fetches_a_second(engine: Engine) -> None:
    players: list[tuple[str, str, str | None]] = [(str(n), "WR", _ESPN.format(n)) for n in range(1, _MANY + 1)]
    _players(engine, players)
    source = StubSource()
    clock = FakeClock()
    throttle = RecordingThrottle(clock)
    with source.client() as http:
        counts = sync(replace(_deps(engine, http, StubBucket(), clock), throttle=throttle), 2026)
    assert counts.line() == f"{_MANY} copied, 0 skipped, 0 missing, 0 failed"
    assert len(source.requests) == len(throttle.granted) == _MANY
    granted = sorted(throttle.granted)
    assert all(later - earlier >= _INTERVAL for earlier, later in itertools.pairwise(granted))
    # No one-second window holds a third fetch.
    assert all(granted[i + 2] - granted[i] >= 2 * _INTERVAL for i in range(len(granted) - 2))
    assert clock.at - FakeClock().at == pytest.approx(_INTERVAL * (_MANY - 1))


def test_the_syncs_bucket_writes_share_its_one_client_and_run_for_two_players_at_once(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2))])
    # Every R2 PUT waits for a PUT from another thread: a sync that wrote one player at a time breaks
    # the barrier (its first PUT waits alone) and fails the pass.
    paired = threading.Barrier(2, timeout=10)
    puts: list[str] = []
    fetches: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "acct.r2.cloudflarestorage.com":
            paired.wait()
            puts.append(request.url.path)
            return httpx.Response(200)
        fetches.append(str(request.url))
        return httpx.Response(200, content=_IMAGE, headers={"content-type": "image/png"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        bucket = R2ImageBucket(R2RunStore(http, "acct", R2Credentials("id", "secret"), "commish-images"))
        counts = sync(_deps(engine, http, bucket, FakeClock(), workers=2), 2026)
    assert counts.line() == "2 copied, 0 skipped, 0 missing, 0 failed"
    assert sorted(fetches) == [_ESPN.format(1), _ESPN.format(2)]
    assert sorted(puts) == sorted(f"/commish-images/headshots/2026/{p}/{w}.webp" for p in ("1", "2") for w in WIDTHS)


# One worker's failure, the worker count, and a curation that lands mid-sync --------------------------


@dataclass
class ExplodingBucket(StubBucket):
    """A bucket that raises an unmapped error for the named players."""

    bad: frozenset[str] = frozenset()

    def put(self, key: str, body: bytes, content_type: str) -> None:
        if key.split("/")[2] in self.bad:
            raise RuntimeError("R2 refused https://acct.example/x?X-Amz-Signature=abc123 for the write")
        super().put(key, body, content_type)


def test_one_worker_raising_an_unmapped_error_fails_only_his_row(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2)), ("3", "TE", _ESPN.format(3))])
    bucket = ExplodingBucket(bad=frozenset({"2"}))
    lines: list[str] = []
    source = StubSource()
    with source.client() as http:
        deps = replace(_deps(engine, http, bucket, FakeClock()), log=lines.append)
        counts = sync(deps, 2026)
    assert counts.line() == "2 copied, 0 skipped, 0 missing, 1 failed"
    assert not counts.systemic
    assert {pid: status for pid, (status, _, _) in _rows(engine).items()} == {
        "1": "copied",
        "2": "failed",
        "3": "copied",
    }
    assert len(lines) == 1
    assert lines[0] == "headshots: 2 failed, RuntimeError (https://acct.example)"
    assert "abc123" not in lines[0]
    with engine.connect() as conn:
        reason = conn.execute(text("select reason from research.headshot_copies where player_id = '2'")).scalar()
    assert reason is not None
    assert "abc123" not in reason
    assert reason == "RuntimeError (https://acct.example)"


def test_a_pass_where_every_player_dies_unmapped_is_systemic(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2))])
    bucket = ExplodingBucket(bad=frozenset({"1", "2"}))
    source = StubSource()
    with source.client() as http:
        counts = sync(_deps(engine, http, bucket, FakeClock()), 2026)
    assert counts.line() == "0 copied, 0 skipped, 0 missing, 2 failed"
    assert counts.systemic


@pytest.mark.parametrize("workers", [0, -1, 17, 2.5, True, "4"])
def test_a_bad_worker_count_is_refused_not_clamped(engine: Engine, workers: object) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1))])
    source = StubSource()
    with source.client() as http:
        deps = replace(_deps(engine, http, StubBucket(), FakeClock()), workers=workers)  # type: ignore[arg-type]
        with pytest.raises(ConfigurationError, match="SYNC_WORKERS"):
            sync(deps, 2026)
    assert source.requests == []


def test_a_curation_landing_during_the_sync_is_not_overwritten(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2))])
    bucket = StubBucket()
    curated_once = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.rsplit("/", 1)[-1].startswith("1.") and not curated_once.is_set():
            curated_once.set()
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "insert into research.headshot_copies (season, player_id, status, curated_by, updated_at) "
                        "values (2026, '1', 'curated', 'coordinator', now())"
                    )
                )
        return httpx.Response(200, content=_IMAGE, headers={"content-type": "image/png"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        counts = sync(_deps(engine, http, bucket, FakeClock(), workers=1), 2026)
    assert counts.line() == "1 copied, 1 skipped, 0 missing, 0 failed"
    assert _rows(engine)["1"] == ("curated", None, "coordinator")
    assert _keys(bucket, "1") == set()
    assert _keys(bucket, "2")


def test_the_ledger_write_leaves_a_curated_row_alone(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1))])
    at = _NOW
    with engine.begin() as conn:
        assert write_unless_curated(conn, 2026, "1", Write("copied", "a", None, at), at)
        write(conn, 2026, "1", Write("curated", "b", None, at, "coordinator", at), at)
        assert not write_unless_curated(conn, 2026, "1", Write("failed", "a", "x", at), at)
    assert _rows(engine)["1"] == ("curated", "b", "coordinator")


# Fix round 1: exits, interrupts, secrets, and the curate race -----------------------------------------

_LEAKS = [
    ("boom https://cdn.example.com/sig/TOKEN123/x.png", "https://cdn.example.com", "TOKEN123"),
    ("refused https://user:pw123@host.example/p", "https://host.example", "pw123"),
    ("refused https://h.example/a?X-Amz-Signature=SECRET1 then", "https://h.example", "SECRET1"),
    ("refused https://h.example/a#frag-SECRET2", "https://h.example", "SECRET2"),
    ("Authorization: Bearer SECRET3 sent to https://h.example/a", "https://h.example", "SECRET3"),
]


@dataclass
class LeakyBucket(StubBucket):
    message: str = ""

    def put(self, key: str, body: bytes, content_type: str) -> None:
        raise RuntimeError(self.message)


@pytest.mark.parametrize(("message", "origin", "secret"), _LEAKS)
def test_an_unmapped_errors_message_never_reaches_the_row_or_the_log(
    engine: Engine, message: str, origin: str, secret: str
) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1))])
    lines: list[str] = []
    with StubSource().client() as http:
        deps = replace(_deps(engine, http, LeakyBucket(message=message), FakeClock()), log=lines.append)
        sync(deps, 2026)
    with engine.connect() as conn:
        reason = conn.execute(text("select reason from research.headshot_copies where player_id = '1'")).scalar()
    assert reason == f"RuntimeError ({origin})"
    assert lines == [f"headshots: 1 failed, {reason}"]
    assert secret not in f"{reason}{lines}"


def test_an_error_with_no_url_is_its_class_alone() -> None:
    assert error_reason(KeyError("secret-key")) == "KeyError"


@dataclass
class ExitingBucket(StubBucket):
    def put(self, key: str, body: bytes, content_type: str) -> None:
        raise SystemExit(3)


def _many(engine: Engine, count: int = 12) -> None:
    _players(engine, [(str(n), "WR", _ESPN.format(n)) for n in range(1, count + 1)])


class GatedPool(ThreadPoolExecutor):
    """A pool whose shutdown first cancels the queue without waiting, then opens the gate, then waits:
    a worker blocked on the gate (a player mid-work) can only finish after the queue is cancelled."""

    gate = threading.Event()

    def shutdown(self, wait: bool = True, *, cancel_futures: bool = False) -> None:
        super().shutdown(wait=False, cancel_futures=cancel_futures)
        self.gate.set()
        super().shutdown(wait=wait)


@dataclass
class GatedSource(StubSource):
    """Player 1 answers at once; every other player's source waits on the pool's gate."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        if not request.url.path.rsplit("/", 1)[-1].startswith("1."):
            assert GatedPool.gate.wait(timeout=30)
        return super().handler(request)


def _gated(monkeypatch: pytest.MonkeyPatch) -> None:
    GatedPool.gate = threading.Event()
    monkeypatch.setattr("research.headshots.sync.ThreadPoolExecutor", GatedPool)


def test_a_worker_raising_system_exit_propagates_and_later_players_never_start(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _gated(monkeypatch)
    _many(engine)
    source = GatedSource()
    lines: list[str] = []
    with source.client() as http:
        deps = replace(_deps(engine, http, ExitingBucket(), FakeClock(), workers=1), log=lines.append)
        with pytest.raises(SystemExit):
            sync(deps, 2026)
    started = {request.rsplit("/", 1)[-1] for request in source.requests}
    assert started <= {"1.png", "2.png"}  # the one in flight when the exit came, never a third
    assert _rows(engine).get("1") is None


def test_an_interrupt_leaving_the_collection_cancels_the_queue_and_logs_the_player_in_flight(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _gated(monkeypatch)
    _many(engine)
    source = GatedSource(broken=frozenset({"1", "2"}))
    lines: list[str] = []

    def interrupt_first(line: str) -> None:
        if not lines:
            lines.append(line)
            raise KeyboardInterrupt
        lines.append(line)

    with source.client() as http:
        deps = replace(_deps(engine, http, StubBucket(), FakeClock(), workers=1), log=interrupt_first)
        with pytest.raises(KeyboardInterrupt):
            sync(deps, 2026)
    started = {request.rsplit("/", 1)[-1] for request in source.requests}
    assert started <= {"1.png", "2.png"}
    assert lines[0].startswith("headshots: 1 failed, HTTP 500")
    # The second player, when a worker had taken him before the cancel, ran to the end and is logged.
    assert (len(lines) == _PAIR) == ("2.png" in started)


def test_a_mapped_and_an_unmapped_failure_in_one_run_each_keep_their_line(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2)), ("3", "TE", _ESPN.format(3))])
    lines: list[str] = []
    source = StubSource(gone=frozenset({"1"}), broken=frozenset({"2"}))
    with source.client() as http:
        deps = replace(_deps(engine, http, ExplodingBucket(bad=frozenset({"3"})), FakeClock()), log=lines.append)
        counts = sync(deps, 2026)
    assert counts.line() == "0 copied, 0 skipped, 1 missing, 2 failed"
    assert sorted(lines) == [
        "headshots: 2 failed, HTTP 500",
        "headshots: 3 failed, RuntimeError (https://acct.example)",
    ]
    assert not counts.systemic


def test_a_ledger_write_that_itself_fails_is_logged_and_does_not_stop_the_pass(
    engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    def down(*args: object, **kwargs: object) -> bool:
        raise RuntimeError("ledger down postgres://u:pw@dbhost/x")

    monkeypatch.setattr("research.headshots.sync.write_unless_curated", down)
    _players(engine, [("1", "RB", _ESPN.format(1)), ("2", "WR", _ESPN.format(2))])
    lines: list[str] = []
    with StubSource().client() as http:
        counts = sync(replace(_deps(engine, http, StubBucket(), FakeClock()), log=lines.append), 2026)
    assert counts.line() == "0 copied, 0 skipped, 0 missing, 2 failed"
    assert counts.systemic
    assert len(lines) == _PAIR
    assert all("his row was not written: RuntimeError" in line for line in lines)
    assert all("pw" not in line for line in lines)
    assert _rows(engine) == {}


def _exit_code(engine: Engine, bad: frozenset[str], players: int, source: StubSource | None = None) -> int:
    _many(engine, players)
    with (source or StubSource()).client() as http:
        return run_sync(_deps(engine, http, ExplodingBucket(bad=bad), FakeClock()), 2026, None)


def test_the_exit_status_is_one_only_when_every_worked_player_died_unmapped(engine: Engine) -> None:
    assert _exit_code(engine, frozenset(), 0) == 0  # no players
    assert _exit_code(engine, frozenset({"1", "2"}), 2) == 1  # all unmapped
    assert _exit_code(engine, frozenset({"2"}), 2) == 0  # one of two
    assert _exit_code(engine, frozenset({"3", "4"}), 4) == 0  # an outage after successes
    assert _exit_code(engine, frozenset({"2"}), 2, StubSource(broken=frozenset({"1"}))) == 0  # mapped plus unmapped
    assert _exit_code(engine, frozenset(), 2, StubSource(broken=frozenset({"1", "2"}))) == 0  # only mapped failures


def test_a_curation_landing_mid_sync_waits_for_his_lock_and_wins(engine: Engine) -> None:
    _players(engine, [("1", "RB", _ESPN.format(1))])
    chosen = io.BytesIO()
    Image.new("RGBA", (600, 436), (20, 20, 220, 255)).save(chosen, "PNG")
    chosen_widths = webp_widths(chosen.getvalue())
    started: list[threading.Thread] = []
    blocked: list[bool] = []

    @dataclass
    class CurateOnFirstPut(StubBucket):
        deps: SyncDeps | None = None

        def put(self, key: str, body: bytes, content_type: str) -> None:
            if not started and self.deps is not None:
                curator = threading.Thread(
                    target=curate, args=(self.deps, 2026, "1", "https://chosen.example/1.png", "coordinator")
                )
                started.append(curator)
                curator.start()
                curator.join(timeout=0.5)
                blocked.append(curator.is_alive())  # held at his lock while the sync writes
            super().put(key, body, content_type)

    bucket = CurateOnFirstPut()
    other = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, content=chosen.getvalue(), headers={"content-type": "image/png"})
        )
    )
    with other, StubSource().client() as http:
        bucket.deps = _deps(engine, other, bucket, FakeClock())
        sync(_deps(engine, http, bucket, FakeClock(), workers=1), 2026)
        started[0].join(timeout=30)
    assert blocked == [True]
    assert not started[0].is_alive()
    assert _rows(engine)["1"] == ("curated", "https://chosen.example/1.png", "coordinator")
    for width, webp in chosen_widths.items():
        assert bucket.objects[copy_key(2026, "1", width)][0] == webp
