"""THE ADVISOR SERVICE: `POST /advise`, `GET /healthz`, `GET /readyz`.

Called only by `api` and `room` (spec §2.3) with a Google identity token, never by a browser: the
service takes traffic from anywhere and Cloud Run's invoker check admits only the rooms' runtime
account. Every response is the product's envelope, `{ ok, data, error }`, with the oracle's
statuses (`research-ts/src/advisor/server.ts`): 400 for a body that is not JSON or not a room state
(each issue named), 405, 404, 413 over 1 MB, 422 for a room state that cannot be, 500 with the
detail only in the log. `server-timing` is the call's own time, from the first byte read through
the response body serialised.

The closed form is CPU work, so it runs on the process's one advise thread, never on the event
loop: `/healthz` and `/readyz` answer while a call is being worked. `/readyz` answers once the
closed form has answered a built-in room state (`warm_up`), so the platform routes no call to a
cold instance.

    uv run python -m research.advisor              PORT defaults to 8080
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

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from research.advisor.advise import RoomStateError, advise
from research.advisor.request import RequestError, parse_request
from research.advisor.warm import warm_up
from research.advisor.wire import advice_json
from research.model.arithmetic import ARM64_BOARDS, Arithmetic
from research.model.decide.survival import SurvivalCurve

MAX_BODY_BYTES: Final = 1_000_000
_OK: Final = 200
_MEDIA_TYPE: Final = "application/json; charset=utf-8"
_LOG: Final = logging.getLogger("research.advisor")


def _envelope_body(data: Any = None, error: str | None = None) -> bytes:
    envelope = {"ok": error is None, "data": data, "error": error}
    return json.dumps(envelope, separators=(",", ":"), allow_nan=False).encode()


def _envelope(
    status: int, data: Any = None, error: str | None = None, headers: dict[str, str] | None = None
) -> Response:
    return Response(_envelope_body(data, error), status_code=status, media_type=_MEDIA_TYPE, headers=headers)


def _advise_thread() -> ThreadPoolExecutor:
    return ThreadPoolExecutor(max_workers=1, thread_name_prefix="advise")


@dataclass(slots=True)
class AdvisorState:
    """What one process holds: its survival memo, the one thread the closed form runs on (so the
    memo is only ever touched from it), and whether it has warmed."""

    curve: SurvivalCurve
    advise_thread: ThreadPoolExecutor = field(default_factory=_advise_thread)
    ready: bool = False


async def _read_body(request: Request) -> bytes | None:
    size = 0
    chunks: list[bytes] = []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _answer(raw: bytes, state: AdvisorState) -> tuple[int, bytes]:
    """(status, serialised envelope) for a raw body: parsed, advised and encoded on the advise thread."""
    try:
        return _OK, _envelope_body(data=advice_json(advise(parse_request(raw), state.curve)))
    except RequestError as error:
        return 400, _envelope_body(error=str(error))
    except RoomStateError as error:
        return 422, _envelope_body(error=str(error))
    except Exception:
        _LOG.exception("advisor: advise failed")
        return 500, _envelope_body(error="internal error")


def _advise_handler(state: AdvisorState) -> Callable[[Request], Awaitable[Response]]:
    async def handle(request: Request) -> Response:
        if request.method != "POST":
            return _envelope(405, error="use POST", headers={"allow": "POST"})
        started = time.perf_counter()
        raw = await _read_body(request)
        if raw is None:
            return _envelope(413, error=f"request body is over {MAX_BODY_BYTES} bytes")
        loop = asyncio.get_running_loop()
        status, body = await loop.run_in_executor(state.advise_thread, _answer, raw, state)
        elapsed = (time.perf_counter() - started) * 1000
        headers = {"server-timing": f"advise;dur={elapsed:.2f}"} if status == _OK else None
        return Response(body, status_code=status, media_type=_MEDIA_TYPE, headers=headers)

    return handle


def _not_found(request: Request, exc: Exception) -> Response:
    del exc
    return _envelope(404, error=f"no route {request.method} {request.url.path}")


def create_app(arithmetic: Arithmetic = ARM64_BOARDS) -> Starlette:
    """The service, its state built here and handed to the handlers (nothing module-global)."""
    state = AdvisorState(SurvivalCurve(arithmetic))

    async def healthz(request: Request) -> Response:
        del request
        return _envelope(_OK, data={"status": "ok"})

    async def readyz(request: Request) -> Response:
        del request
        if not state.ready:
            return _envelope(503, error="warming up")
        return _envelope(_OK, data={"status": "ready"})

    async def warm() -> None:
        await asyncio.get_running_loop().run_in_executor(state.advise_thread, warm_up, state.curve)
        state.ready = True

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        del app
        warming = asyncio.create_task(warm())
        try:
            yield
        finally:
            warming.cancel()
            state.advise_thread.shutdown(wait=False, cancel_futures=True)

    routes = [
        Route("/healthz", healthz, methods=["GET"]),
        Route("/readyz", readyz, methods=["GET"]),
        Route("/advise", _advise_handler(state), methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
    ]
    return Starlette(routes=routes, lifespan=lifespan, exception_handlers={404: _not_found, 405: _not_found})
