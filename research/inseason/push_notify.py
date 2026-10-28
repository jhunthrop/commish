"""THE STARTER STATUS PUSH: after each hourly capture, ask the API to queue its pushes (Lane 262).

The API compares the two newest injury captures itself and queues one push per account, player and
change for the members whose followed league starts a changed player; a call again queues nothing new.
This module only calls `POST /internal/notifications/starter-status` with the job's own Google identity:
an OIDC identity token from the Cloud Run metadata server whose audience is the API's URL, which the API
verifies against INTERNAL_CALLERS. No key file, no secret.

`COMMISH_API_URL` (https://api.trycommish.app in production) names the API; unset, the call is skipped
with a line, so a run before the route deploys, or on a laptop, never fails for it.
"""

import os
from typing import Final

import httpx

API_URL_ENV: Final = "COMMISH_API_URL"
STARTER_STATUS_PATH: Final = "/internal/notifications/starter-status"
# The metadata server's identity endpoint (Cloud Run, as on Compute Engine).
METADATA_IDENTITY: Final = "http://metadata.google.internal/computeMetadata/v1/instance/service-account/identity"
TIMEOUT_SECONDS: Final = 30.0


def identity_token(client: httpx.Client, audience: str) -> str:
    """The job's Google identity token for the audience, from the metadata server."""
    response = client.get(
        METADATA_IDENTITY, params={"audience": audience, "format": "full"}, headers={"Metadata-Flavor": "Google"}
    )
    response.raise_for_status()
    return response.text.strip()


def notify_starter_status(client: httpx.Client | None = None, api_url: str | None = None) -> tuple[bool, str]:
    """Ask the API to queue the starter status pushes; (ok, the line to log). Skipped, and ok, when
    no API is named."""
    base = (api_url if api_url is not None else os.environ.get(API_URL_ENV, "")).strip().rstrip("/")
    if not base:
        return True, f"starter-status push: skipped, {API_URL_ENV} is not set"
    own = client is None
    http = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        token = identity_token(http, base)
        response = http.post(base + STARTER_STATUS_PATH, headers={"Authorization": f"Bearer {token}"})
        if response.status_code != httpx.codes.OK:
            return False, f"starter-status push: FAILED, the API answered {response.status_code}"
        data = response.json().get("data") or {}
        return True, f"starter-status push: {data.get('changes', 0)} changes, {data.get('queued', 0)} queued"
    except (httpx.HTTPError, ValueError) as err:
        return False, f"starter-status push: FAILED, {type(err).__name__}: {err}"
    finally:
        if own:
            http.close()
