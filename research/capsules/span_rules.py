"""WHAT THE SPAN GATE JUDGES AGAINST, built at run time from the store and the night's sheets.

The names that break a span (every player's name in the store, every club's spelling) and the
exemption the coordinator ruled for Lane 17: a span the sheets' labelled stats print (the case and
the color, `render.label_sections`) is a label or a stat name copied word for word, not stock prose.
The sheets' framing sentences (the day, the board line, the season so far, the bye, the injury
line) are not exempt: a read that echoes them is the stock language the gate exists for.
"""

from collections.abc import Iterable
from typing import TYPE_CHECKING

from sqlalchemy import Connection, text

from research.capsules.render import label_sections
from research.capsules.spans import SpanRules, name_words, sheet_spans

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts


def span_names(conn: Connection) -> frozenset[str]:
    """The words that break a span: every player's name in the store, and every club's."""
    return name_words(str(name) for name in conn.execute(text("select name from research.provider_players")).scalars())


def span_rules_for(conn: Connection, sheets: Iterable["PlayerFacts"]) -> SpanRules:
    """The names, and every span the sheets' labelled stats print."""
    names = span_names(conn)
    labels = (section for facts in sheets for section in label_sections(facts))
    return SpanRules(names, sheet_spans(labels, names))
