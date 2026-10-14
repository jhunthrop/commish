"""THE BOARDS SERVICE: `POST /boards/custom`, `GET /healthz`, `GET /readyz`.

Called only by `api` with a Google identity token, never by a browser: Cloud Run's invoker check
admits only api-runtime. Every response is the product's envelope, `{ ok, data, error }`, with the
advisor's statuses: 400 for a body that is not a custom board request (the field named), 404 for a
season with no stored board, 405, 413 over 64 KB, 503 while the served generation has no candidate
set kept (`research.boards keep-candidates` has not run), 500 with the detail only in the log.
`server-timing` is the call's own time and says whether the answer was the cache's.

The build is CPU and database work, so it runs on the service's worker threads, never on the event
loop. `/readyz` answers once the pinned artifacts (the game-variance priors the board reads) are
loaded, so no call reaches an instance that would pay for them.

    RESEARCH_DATABASE_URL=... uv run python -m research.boards        PORT defaults to 8080
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Final

from sqlalchemy import Engine, create_engine
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from research.boards.custom import CandidateMemo, NoBoardError, custom_board
from research.boards.request import RequestError, parse_request
from research.model.arithmetic import model_version
from research.model.preseason.board import GameVariancePriors
from research.model.preseason.candidate_store import MissingCandidatesError
from research.model.priors import load_game_variance

MAX_BODY_BYTES: Final = 64_000
_OK: Final = 200
_MEDIA_TYPE: Final = "application/json; charset=utf-8"
_LOG: Final = logging.getLogger("research.boards")


def _body(data: Any = None, error: str | None = None) -> bytes:
    return json.dumps(
        {"ok": error is None, "data": data, "error": error}, separators=(",", ":"), allow_nan=False
    ).encode()


def _envelope(
    status: int, data: Any = None, error: str | None = None, headers: dict[str, str] | None = None
) -> Response:
    return Response(_body(data, error), status_code=status, media_type=_MEDIA_TYPE, headers=headers)


def service_engine(url: str, workers: int) -> Engine:
    """A pooled engine, one connection a worker: a service call must not pay a connect each time."""
    return create_engine(
        url, pool_size=workers, max_overflow=0, pool_pre_ping=True, connect_args={"prepare_threshold": None}
    )


@dataclass(slots=True)
class BoardsState:
    engine: Engine
    workers: int
    game_variance: GameVariancePriors | None = None
    candidates: CandidateMemo = field(default_factory=CandidateMemo)
    pool: ThreadPoolExecutor = field(init=False)

    def __post_init__(self) -> None:
        self.pool = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="boards")


def _answer(raw: bytes, state: BoardsState) -> tuple[int, bytes, bool]:
    """(status, serialised envelope, whether the cache answered) for a raw body."""
    try:
        request = parse_request(raw)
        assert state.game_variance is not None
        with state.engine.begin() as conn:
            board = custom_board(conn, request, state.game_variance, model_version(), state.candidates)
        data = {
            "season": board.season,
            "source": board.source,
            "as_of": board.as_of.isoformat(),
            "rules_hash": request.rules_hash,
            "rows": board.rows,
        }
        return _OK, _body(data=data), board.cached
    except RequestError as error:
        return 400, _body(error=str(error)), False
    except NoBoardError as error:
        return 404, _body(error=str(error)), False
    except MissingCandidatesError as error:
        _LOG.error("boards: %s", error)
        return 503, _body(error="the served board's candidate set is not kept yet"), False
    except Exception:
        _LOG.exception("boards: custom board failed")
        return 500, _body(error="internal error"), False


async def _read_body(request: Request) -> bytes | None:
    size = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _custom_handler(state: BoardsState) -> Callable[[Request], Awaitable[Response]]:
    async def handle(request: Request) -> Response:
        if request.method != "POST":
            return _envelope(405, error="use POST", headers={"allow": "POST"})
        if state.game_variance is None:
            return _envelope(503, error="warming up")
        started = time.perf_counter()
        raw = await _read_body(request)
        if raw is None:
            return _envelope(413, error=f"request body is over {MAX_BODY_BYTES} bytes")
        status, body, cached = await asyncio.get_running_loop().run_in_executor(state.pool, _answer, raw, state)
        elapsed = (time.perf_counter() - started) * 1000
        headers = {"server-timing": f"{'hit' if cached else 'build'};dur={elapsed:.2f}"} if status == _OK else None
        return Response(body, status_code=status, media_type=_MEDIA_TYPE, headers=headers)

    return handle


def _not_found(request: Request, exc: Exception) -> Response:
    del exc
    return _envelope(404, error=f"no route {request.method} {request.url.path}")


def _not_allowed(request: Request, exc: Exception) -> Response:
    del request, exc
    return _envelope(405, error="use POST", headers={"allow": "POST"})


def _load_priors(state: BoardsState) -> None:
    """The pinned game-variance priors, the only artifact a board reads here (two catalog rows, not
    the whole catalog); a failure is logged and the instance stays unready, so the platform's
    startup probe replaces it rather than routing a call to it."""
    try:
        with state.engine.connect() as conn:
            state.game_variance = load_game_variance(conn)
    except Exception:
        _LOG.exception("boards: the pinned artifacts could not be loaded")
        raise


def create_app(engine: Engine, workers: int) -> Starlette:
    """The service over one engine, its state built here (nothing module-global)."""
    state = BoardsState(engine, workers)

    async def healthz(request: Request) -> Response:
        del request
        return _envelope(_OK, data={"status": "ok"})

    async def readyz(request: Request) -> Response:
        del request
        if state.game_variance is None:
            return _envelope(503, error="warming up")
        return _envelope(_OK, data={"status": "ready"})

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        del app
        warming = asyncio.get_running_loop().run_in_executor(state.pool, _load_priors, state)
        try:
            yield
        finally:
            warming.cancel()
            state.pool.shutdown(wait=False, cancel_futures=True)
            state.engine.dispose()

    routes = [
        Route("/healthz", healthz, methods=["GET"]),
        Route("/readyz", readyz, methods=["GET"]),
        Route("/boards/custom", _custom_handler(state), methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
    ]
    return Starlette(routes=routes, lifespan=lifespan, exception_handlers={404: _not_found, 405: _not_allowed})
