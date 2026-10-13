"""WHAT A CARRY-ON LOOP MAY CATCH.

Several TypeScript ingests catch a failure per feed, per format or per board, record it, and carry
on to the next (the capture pass, the ADP capture, the preseason boards). The Python ports catch
exactly the failures those loops exist to tolerate, inside a savepoint per item so a database
error rolls back only that item: a provider that answered badly or not at all, a payload that did
not parse, a database refusal. Anything else (a TypeError, a KeyError, an assertion) is a bug in
this code and is re-raised, never recorded as an outcome.
"""

import json

import httpx
from sqlalchemy.exc import DBAPIError

from research.errors import ResearchError

TOLERATED_FAILURES: tuple[type[Exception], ...] = (ResearchError, httpx.HTTPError, json.JSONDecodeError, DBAPIError)
