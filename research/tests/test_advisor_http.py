"""The advisor's HTTP boundary: the envelope and every status the oracle's server answers with.

The advice itself is proven by `python -m research.parity decide all`; this pins the layer the
parity bypasses: routing, the body cap, strict parsing, the bounds and the readiness probe.
"""

import json
import threading
import time
from collections.abc import Iterator
from http import HTTPStatus
from typing import Any, Final

import pytest
from starlette.testclient import TestClient

from research.advisor import server
from research.advisor.advise import Advice, advise
from research.advisor.request import MAX_POOL, AdviseRequest
from research.advisor.server import MAX_BODY_BYTES, create_app
from research.advisor.warm import shape_only_state
from research.model.decide.survival import SurvivalCurve

_READY_WITHIN_SECONDS: Final = 30.0
_SLOW_CALL_SECONDS: Final = 1.0


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        deadline = time.monotonic() + _READY_WITHIN_SECONDS
        while test_client.get("/readyz").status_code != HTTPStatus.OK:
            assert time.monotonic() < deadline, "the advisor never warmed"
            time.sleep(0.05)
        yield test_client


def _post(client: TestClient, body: object) -> tuple[int, dict[str, Any]]:
    response = client.post("/advise", content=json.dumps(body), headers={"content-type": "application/json"})
    return response.status_code, response.json()


def test_health_and_readiness(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"ok": True, "data": {"status": "ok"}, "error": None}
    assert client.get("/readyz").json() == {"ok": True, "data": {"status": "ready"}, "error": None}


def test_a_room_state_is_advised_with_its_own_time(client: TestClient) -> None:
    response = client.post("/advise", json=shape_only_state())
    envelope = response.json()
    assert response.status_code == HTTPStatus.OK
    assert envelope["ok"] is True
    assert envelope["error"] is None
    assert envelope["data"]["shortlist"]
    assert response.headers["server-timing"].startswith("advise;dur=")


def test_routes_and_methods(client: TestClient) -> None:
    wrong_method = client.get("/advise")
    assert (wrong_method.status_code, wrong_method.headers["allow"]) == (405, "POST")
    assert wrong_method.json() == {"ok": False, "data": None, "error": "use POST"}
    missing = client.post("/healthz")
    assert missing.status_code == HTTPStatus.NOT_FOUND
    assert missing.json()["error"] == "no route POST /healthz"


def test_bodies_that_are_not_room_states(client: TestClient) -> None:
    for raw in (b"", b"nope", b'{"teamCount": NaN}'):
        response = client.post("/advise", content=raw)
        assert (response.status_code, response.json()["error"]) == (400, "the body is not JSON")
    state = shape_only_state()
    status, envelope = _post(client, {**state, "teamCount": "12"})
    assert (status, envelope["ok"]) == (400, False)
    assert envelope["error"].startswith("teamCount:")


def test_the_bounds(client: TestClient) -> None:
    state = shape_only_state()
    pool = [
        {"id": f"X-{n}", "position": "WR", "adp": float(n + 1), "projectedPoints": 1.0} for n in range(MAX_POOL + 1)
    ]
    status, envelope = _post(client, {**state, "pool": pool, "picks": []})
    assert status == HTTPStatus.BAD_REQUEST
    assert envelope["error"].startswith("pool:")
    huge = client.post("/advise", content=b" " * (MAX_BODY_BYTES + 1))
    assert huge.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_a_room_state_that_cannot_be(client: TestClient) -> None:
    status, envelope = _post(client, {**shape_only_state(), "seatOnClock": 1})
    assert (status, envelope["ok"], envelope["data"]) == (422, False, None)


def test_health_answers_while_a_call_is_worked(monkeypatch: pytest.MonkeyPatch) -> None:
    started = threading.Event()

    def slow_advise(request: AdviseRequest, curve: SurvivalCurve) -> Advice:
        started.set()
        time.sleep(_SLOW_CALL_SECONDS)
        return advise(request, curve)

    monkeypatch.setattr(server, "advise", slow_advise)
    with TestClient(create_app()) as test_client:
        while test_client.get("/readyz").status_code != HTTPStatus.OK:
            time.sleep(0.05)
        call = threading.Thread(target=lambda: test_client.post("/advise", json=shape_only_state()))
        call.start()
        assert started.wait(_SLOW_CALL_SECONDS)
        probed = time.perf_counter()
        assert test_client.get("/healthz").status_code == HTTPStatus.OK
        assert time.perf_counter() - probed < _SLOW_CALL_SECONDS / 2
        call.join()
