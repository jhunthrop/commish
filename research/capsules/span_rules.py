"""WHAT THE SPAN GATE JUDGES AGAINST, built at run time from the store and the night's sheets.

The names that break a span (every player's name in the store, every club's spelling), and the
spans the facts themselves print, which are exempt: a read that states a figure with its basis as the
sheet renders it ("left in his tier before a", "on every report since the run-up to", "missed to
injury or a reserve list") shares those words with every page whose sheet prints the same basis, and
that is the fact's own phrasing, not stock prose. The coordinator's ruling of 2026-10-15 widened the
exemption from Lane 17's (the labelled stats only, `render.label_sections`) to every span a rendered
sheet (`render.render_facts_for_model`) or a facts block (`facts_block.render_facts_block`) prints.
A writer's paraphrase of a basis ("he beat the position's weekly median in", against the sheet's
"scored above the position's own weekly median in") is its own words and is still judged.

Lane 29 narrowed it (the live review of 2026-10-15, M1: "report since the run-up to week" on 122
pages, exempt as the sheet's words): the exemption covers a figure with its basis only. The sheet's
section labels (`render_words.SHEET_LABELS`: "on file", "in our records", ...) are
cut from the facts before their spans are read, so a span holding a label is judged like any other,
and a label in a read is a validator failure besides (`prose_checks.label_copies`).
"""

from collections.abc import Iterable
from typing import TYPE_CHECKING

from sqlalchemy import Connection, text

from research.capsules.facts_block import render_facts_block
from research.capsules.render import render_facts_for_model
from research.capsules.render_words import SHEET_LABELS
from research.capsules.spans import SpanRules, cut_phrases, name_words, sheet_spans

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts


def span_names(conn: Connection) -> frozenset[str]:
    """The words that break a span: every player's name in the store, and every club's."""
    return name_words(str(name) for name in conn.execute(text("select name from research.provider_players")).scalars())


def facts_texts(facts: "PlayerFacts") -> tuple[str, str]:
    """Everything the facts print for one player: his whole sheet, and his facts block."""
    return render_facts_for_model(facts), render_facts_block(facts)


def span_rules_for(conn: Connection, sheets: Iterable["PlayerFacts"]) -> SpanRules:
    """The names, and every span the night's sheets and facts blocks print with their labels cut out:
    a figure with its basis is exempt, a label never is (`render_words.SHEET_LABELS`)."""
    names = span_names(conn)
    texts = (cut_phrases(text, SHEET_LABELS) for facts in sheets for text in facts_texts(facts))
    return SpanRules(names, sheet_spans(texts, names))
