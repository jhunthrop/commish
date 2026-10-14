"""The transfer meter connects only to a loopback Postgres named by the URL's host (review HIGH-2)."""

import pytest

from research.transfer.target import RefusedTargetError, Target, checked_target, through_relay

_LOCAL = "postgresql+psycopg://commish:commish@localhost:5432/commish"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://u:p@ep-cool-name.us-east-2.aws.neon.tech/commish",
        "postgresql+psycopg://u:p@10.0.0.5:5432/commish",
        f"{_LOCAL}?host=ep-cool-name.us-east-2.aws.neon.tech&port=5432",
        f"{_LOCAL}?hostaddr=35.190.191.181",
        f"{_LOCAL}?service=prod",
        f"{_LOCAL}?host=/cloudsql/trycommish:us-east1:commish",
        f"{_LOCAL}?sslmode=require",
        "postgresql+psycopg://u:p@/commish",
    ],
)
def test_anything_but_a_bare_loopback_url_is_refused(url: str) -> None:
    with pytest.raises(RefusedTargetError):
        checked_target(url)


@pytest.mark.parametrize(
    ("url", "target"),
    [
        (_LOCAL, Target("localhost", 5432)),
        ("postgresql+psycopg://u:p@127.0.0.1:5433/commish_test", Target("127.0.0.1", 5433)),
        ("postgresql+psycopg://u:p@[::1]:5432/commish", Target("::1", 5432)),
        ("postgresql+psycopg://u:p@127.0.0.2/commish", Target("127.0.0.2", 5432)),
    ],
)
def test_a_loopback_url_is_accepted(url: str, target: Target) -> None:
    assert checked_target(url) == target


def test_the_relayed_url_names_only_the_relay() -> None:
    assert through_relay(_LOCAL, 61000) == "postgresql+psycopg://commish:commish@127.0.0.1:61000/commish"
