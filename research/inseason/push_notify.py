"""THE STARTER STATUS PUSH: after each hourly capture, ask the API to queue its pushes (Lane 262).

The API records the request and answers 202; the api-notify job does the work each minute: it compares
every pair of injury captures since its last run and queues one push per account, player and change for
the members whose followed league starts a changed player. The job also runs on a new capture without a
request, so this call only hurries it.
This module only calls `POST /internal/notifications/starter-status` with the job's own Google identity:
an OIDC identity token from the Cloud Run metadata server whose audience is the API's URL, which the API
verifies against INTERNAL_CALLERS. No key file, no secret.

The call is advisory, like the week-ahead reads: its line is logged, it never raises, and the capture's
verdict never depends on it (review M5); the push job's own error lines alert. `COMMISH_API_URL`
(https://api.trycommish.app in production) names the API and must be https; unset, the call is skipped.
"""

import os
from typing import Final

import httpx

API_URL_ENV: Final = "COMMISH_API_URL"
STARTER_STATUS_PATH: Final = "/internal/notifications/starter-status"
# The metadata server's identity endpoint (Cloud Run, as on Compute Engine).
METADATA_IDENTITY: Final = "http://metadata.google.internal/computeMetadata/v1/instance/service-account/identity"
TIMEOUT_SECONDS: Final = 30.0
ACCEPTED: Final = (httpx.codes.OK, httpx.codes.ACCEPTED)


def identity_token(client: httpx.Client, audience: str) -> str:
    """The job's Google identity token for the audience, from the metadata server."""
    response = client.get(
        METADATA_IDENTITY, params={"audience": audience, "format": "full"}, headers={"Metadata-Flavor": "Google"}
    )
    response.raise_for_status()
    return response.text.strip()


def notify_starter_status(client: httpx.Client | None = None, api_url: str | None = None) -> str:
    """Ask the API to run the starter status producer; the line to log, whatever happened."""
    base = (api_url if api_url is not None else os.environ.get(API_URL_ENV, "")).strip().rstrip("/")
    if not base:
        return f"starter-status push: skipped, {API_URL_ENV} is not set"
    if not base.startswith("https://"):
        return f"starter-status push: skipped, {API_URL_ENV} must be an https URL"
    own = client is None
    http = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        token = identity_token(http, base)
        response = http.post(base + STARTER_STATUS_PATH, headers={"Authorization": f"Bearer {token}"})
        if response.status_code not in ACCEPTED:
            return f"starter-status push: not requested, the API answered {response.status_code}"
        return "starter-status push: requested"
    except Exception as err:  # advisory: an odd URL (httpx.InvalidURL) or anything else is a line
        return f"starter-status push: not requested, {type(err).__name__}: {err}"
    finally:
        if own:
            http.close()
