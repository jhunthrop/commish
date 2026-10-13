"""THE ADVISOR SERVICE: `POST /advise`, `GET /healthz`, `GET /readyz`.

Called only by `api` and `room` (spec §2.3), over Cloud Run's internal ingress with an identity
token, never by a browser. Every response is the product's envelope, `{ ok, data, error }`, with
the oracle's statuses (`research-ts/src/advisor/server.ts`): 400 for a body that is not JSON or not
a room state (each issue named), 405, 404, 413 over 1 MB, 422 for a room state that cannot be, 500
with the detail only in the log. `server-timing` carries the advice's own time.

`/healthz` answers while the process lives; `/readyz` answers once the closed form has answered a
built-in room state (`warm_up`), so the platform routes no call to a cold instance.

    uv run python -m research.advisor              PORT defaults to 8080
"""

import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
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
_LOG: Final = logging.getLogger("research.advisor")


def _envelope(
    status: int, data: Any = None, error: str | None = None, headers: dict[str, str] | None = None
) -> Response:
    body = json.dumps({"ok": error is None, "data": data, "error": error}, separators=(",", ":"), allow_nan=False)
    return Response(body, status_code=status, media_type="application/json; charset=utf-8", headers=headers)


@dataclass(slots=True)
class AdvisorState:
    """What one process holds: its arithmetic, its survival memo, and whether it has warmed."""

    curve: SurvivalCurve
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


def _answer(body: object, state: AdvisorState) -> tuple[int, Any, str | None]:
    """(status, data, error) for a parsed body."""
    try:
        return 200, advice_json(advise(parse_request(body), state.curve)), None
    except RequestError as error:
        return 400, None, str(error)
    except RoomStateError as error:
        return 422, None, str(error)
    except Exception:
        _LOG.exception("advisor: advise failed")
        return 500, None, "internal error"


def _advise_handler(state: AdvisorState) -> Callable[[Request], Any]:
    async def handle(request: Request) -> Response:
        if request.method != "POST":
            return _envelope(405, error="use POST", headers={"allow": "POST"})
        started = time.perf_counter()
        raw = await _read_body(request)
        if raw is None:
            return _envelope(413, error=f"request body is over {MAX_BODY_BYTES} bytes")
        try:
            body = json.loads(raw)
        except ValueError:
            return _envelope(400, error="the body is not JSON")
        status, data, error = _answer(body, state)
        if error is not None:
            return _envelope(status, error=error)
        elapsed = (time.perf_counter() - started) * 1000
        return _envelope(200, data=data, headers={"server-timing": f"advise;dur={elapsed:.2f}"})

    return handle


def _not_found(request: Request, exc: Exception) -> Response:
    del exc
    return _envelope(404, error=f"no route {request.method} {request.url.path}")


def create_app(arithmetic: Arithmetic = ARM64_BOARDS) -> Starlette:
    """The service, its state built here and handed to the handlers (nothing module-global)."""
    state = AdvisorState(SurvivalCurve(arithmetic))

    async def healthz(request: Request) -> Response:
        del request
        return _envelope(200, data={"status": "ok"})

    async def readyz(request: Request) -> Response:
        del request
        if not state.ready:
            return _envelope(503, error="warming up")
        return _envelope(200, data={"status": "ready"})

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        del app
        warm_up(state.curve)
        state.ready = True
        yield

    routes = [
        Route("/healthz", healthz, methods=["GET"]),
        Route("/readyz", readyz, methods=["GET"]),
        Route("/advise", _advise_handler(state), methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
    ]
    return Starlette(routes=routes, lifespan=lifespan, exception_handlers={404: _not_found, 405: _not_found})
