"""THE R2 RUN STORE: the bucket `commish-runs` over R2's S3 API, signed with AWS Signature V4.

One credential, the Cloudflare API token the lanes already hold (`CLOUDFLARE_API_TOKEN`): R2's S3
endpoint takes the token's id as the access key and the SHA-256 of the token as the secret
(`web/scripts/r2.ts` derives them the same way), so no second key is minted or stored. The token is
verified against the account before the first write, and never logged.

`claim` is a conditional PUT (`If-None-Match: *`), which R2 answers 412 when the key exists, so a
run id is taken atomically.
"""

import hashlib
import hmac
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final
from urllib.parse import quote

import httpx

from research.errors import ConfigurationError, ResearchError
from research.nightly.run_store import LocalRunStore, RunStore, checked_key

RUNS_BUCKET: Final = "commish-runs"
TOKEN_VARIABLE: Final = "CLOUDFLARE_API_TOKEN"
ACCOUNT_VARIABLE: Final = "CLOUDFLARE_ACCOUNT_ID"
_REGION: Final = "auto"
_SERVICE: Final = "s3"
_ALGORITHM: Final = "AWS4-HMAC-SHA256"
_TIMEOUT_SECONDS: Final = 60.0
_ATTEMPTS: Final = 4
_OK: Final = 200
_NO_CONTENT: Final = 204
_NOT_FOUND: Final = 404
_PRECONDITION_FAILED: Final = 412
_SERVER_ERROR: Final = 500


class R2Error(ResearchError):
    """The bucket answered something other than what the call needs."""


@dataclass(frozen=True, slots=True)
class R2Credentials:
    access_key_id: str
    secret_access_key: str


def credentials_from_token(http: httpx.Client, environ: Mapping[str, str]) -> tuple[str, R2Credentials]:
    """The account id and the S3 credentials the token stands for, verified as an active token."""
    token = environ.get(TOKEN_VARIABLE, "").strip()
    account = environ.get(ACCOUNT_VARIABLE, "").strip()
    if not token or not account:
        raise ConfigurationError(f"Set {TOKEN_VARIABLE} and {ACCOUNT_VARIABLE} to write a run to R2.")
    response = http.get(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/tokens/verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    result = body.get("result") or {}
    if not body.get("success") or result.get("status") != "active":
        raise ConfigurationError(f"{TOKEN_VARIABLE} did not verify as an active token of the account.")
    return account, R2Credentials(str(result["id"]), hashlib.sha256(token.encode()).hexdigest())


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


@dataclass(frozen=True, slots=True)
class Unsigned:
    """A request's signed parts: the method, the host, the encoded path, its headers, its body's hash."""

    method: str
    host: str
    path: str
    headers: Mapping[str, str]
    payload_hash: str


def sign(request: Unsigned, at: datetime, credentials: R2Credentials) -> dict[str, str]:
    """The request's headers with SigV4's `x-amz-date`, `x-amz-content-sha256` and `Authorization`."""
    amz_date = at.strftime("%Y%m%dT%H%M%SZ")
    day = amz_date[:8]
    signed = {**{k.lower(): v.strip() for k, v in request.headers.items()}, "host": request.host}
    signed |= {"x-amz-date": amz_date, "x-amz-content-sha256": request.payload_hash}
    names = sorted(signed)
    header_lines = [f"{name}:{signed[name]}" for name in names]
    canonical = "\n".join([request.method, request.path, "", *header_lines, "", ";".join(names), request.payload_hash])
    scope = f"{day}/{_REGION}/{_SERVICE}/aws4_request"
    to_sign = "\n".join([_ALGORITHM, amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _hmac(
        _hmac(_hmac(_hmac(f"AWS4{credentials.secret_access_key}".encode(), day), _REGION), _SERVICE), "aws4_request"
    )
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"{_ALGORITHM} Credential={credentials.access_key_id}/{scope}, "
        f"SignedHeaders={';'.join(names)}, Signature={signature}"
    )
    return {**{k: v for k, v in signed.items() if k != "host"}, "authorization": authorization}


class R2RunStore:
    """The bucket, path style: `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`."""

    def __init__(self, http: httpx.Client, account: str, credentials: R2Credentials, bucket: str = RUNS_BUCKET) -> None:
        self.http = http
        self.host = f"{account}.r2.cloudflarestorage.com"
        self.bucket = bucket
        self.credentials = credentials

    def _path(self, key: str) -> str:
        return "/" + quote(f"{self.bucket}/{checked_key(key)}", safe="/~")

    def _send(
        self, method: str, key: str, body: bytes = b"", headers: Mapping[str, str] | None = None
    ) -> httpx.Response:
        path = self._path(key)
        unsigned = Unsigned(method, self.host, path, headers or {}, hashlib.sha256(body).hexdigest())
        last: httpx.Response | Exception | None = None
        for _ in range(_ATTEMPTS):
            signed = sign(unsigned, datetime.now(UTC), self.credentials)
            try:
                response = self.http.request(
                    method, f"https://{self.host}{path}", content=body or None, headers=signed, timeout=_TIMEOUT_SECONDS
                )
            except httpx.TransportError as error:
                last = error
                continue
            if response.status_code < _SERVER_ERROR:
                return response
            last = response
        raise R2Error(f"{method} {key} failed after {_ATTEMPTS} attempts: {last}")

    def put(self, key: str, body: bytes, content_type: str) -> None:
        response = self._send("PUT", key, body, {"content-type": content_type})
        if response.status_code != _OK:
            raise R2Error(f"PUT {key} answered {response.status_code}.")

    def claim(self, key: str, body: bytes, content_type: str) -> bool:
        # A claim retried after a lost reply can meet its own first write and answer 412: the id is
        # then orphaned (it holds this run's started.json) and the run takes the next suffix, which
        # is harmless, since an id is only ever given up, never reused.
        response = self._send("PUT", key, body, {"content-type": content_type, "if-none-match": "*"})
        if response.status_code == _PRECONDITION_FAILED:
            return False
        if response.status_code != _OK:
            raise R2Error(f"PUT {key} (claim) answered {response.status_code}.")
        return True

    def get(self, key: str) -> bytes | None:
        response = self._send("GET", key)
        if response.status_code == _NOT_FOUND:
            return None
        if response.status_code != _OK:
            raise R2Error(f"GET {key} answered {response.status_code}.")
        return response.content

    def exists(self, key: str) -> bool:
        response = self._send("HEAD", key)
        if response.status_code not in {_OK, _NOT_FOUND}:
            raise R2Error(f"HEAD {key} answered {response.status_code}.")
        return response.status_code == _OK

    def delete(self, key: str) -> None:
        """An operator's removal (the smoke check's own object); no run deletes anything."""
        response = self._send("DELETE", key)
        if response.status_code not in {_OK, _NO_CONTENT, _NOT_FOUND}:
            raise R2Error(f"DELETE {key} answered {response.status_code}.")

    def locate(self, key: str) -> str:
        return f"r2://{self.bucket}/{key}"


def run_store(out: str | None, http: httpx.Client) -> "RunStore":
    """A local directory when `out` is given, else the bucket (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)."""
    if out is not None:
        return LocalRunStore(Path(out))
    account, credentials = credentials_from_token(http, os.environ)
    return R2RunStore(http, account, credentials)
