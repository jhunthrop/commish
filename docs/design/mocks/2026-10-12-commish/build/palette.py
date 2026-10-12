"""Read the token file and measure every color token against the ground it is used on."""
import re

from shell import TOKENS_PATH

HEX = re.compile(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})")


def _block(css, selector):
    start = css.index(selector)
    open_at = css.index("{", start)
    depth, i = 1, open_at + 1
    while depth:
        depth += {"{": 1, "}": -1}.get(css[i], 0)
        i += 1
    return css[open_at + 1 : i - 1]


def themes():
    css = TOKENS_PATH.read_text()
    light = dict(HEX.findall(_block(css, ":root {")))
    dark = {**light, **dict(HEX.findall(_block(css, ':root[data-theme="dark"]')))}
    return {"light": light, "dark": dark}


def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hexv):
    r, g, b = (int(hexv[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(fg, bg, alpha):
    """fg painted at alpha over bg, as a hex."""
    out = [round(int(fg[i : i + 2], 16) * alpha + int(bg[i : i + 2], 16) * (1 - alpha)) for i in (1, 3, 5)]
    return "#" + "".join(f"{v:02x}" for v in out)


# token, what it does, the tokens it is measured against, the bar it must clear.
TEXT, NON_TEXT = 4.5, 3.0
FAMILIES = [
    ("Neutrals", [
        ("bg", "Page ground", ["ink"], TEXT),
        ("surface", "Panels, row hover", ["ink"], TEXT),
        ("surface-2", "Position pills, range tracks", ["ink"], TEXT),
        ("shell", "Rail and top bar", ["ink"], TEXT),
        ("line", "Row rules", ["bg"], None),
        ("line-strong", "Control borders, range spans", ["bg"], None),
        ("ink", "Names and numbers", ["bg", "surface"], TEXT),
        ("ink-2", "Secondary text", ["bg", "surface"], TEXT),
        ("ink-3", "Labels on cells", ["bg", "surface"], TEXT),
    ]),
    ("The one accent", [
        ("accent", "The verb and the brand mark, as a fill", ["accent-ink"], TEXT),
        ("accent-ink", "Text on the verb", ["accent"], TEXT),
        ("accent-text", "Orange as text: the active rail item, You", ["bg", "surface"], TEXT),
        ("accent-wash", "Your rows and your picks", ["ink"], TEXT),
        ("focus", "Keyboard focus ring", ["bg"], NON_TEXT),
    ]),
    ("Magnitude", [
        ("heat-1", "Over replacement, round 1 of 400", ["heat-ink"], TEXT),
        ("heat-2", "Over replacement, round 2", ["heat-ink"], TEXT),
        ("heat-3", "Over replacement, round 3", ["heat-ink"], TEXT),
        ("heat-4", "Over replacement, round 4", ["heat-ink"], TEXT),
        ("heat-neg", "Below replacement", ["heat-ink"], TEXT),
        ("gain-ink", "Drafters take him later, on gain-bg", ["gain-bg"], TEXT),
        ("loss-ink", "Drafters take him earlier, on loss-bg", ["loss-bg"], TEXT),
    ]),
    ("Tiers, hot to cold", [
        (f"tier-{n}", f"Tier {n} strip", ["tier-ink"], TEXT) for n in range(1, 8)
    ]),
    ("Scoreboard, live draft only", [
        ("scoreboard", "Score bug and lower third ground", ["scoreboard-ink"], TEXT),
        ("scoreboard-2", "Raised bug segment, the face backing", ["scoreboard-ink"], TEXT),
        ("scoreboard-ink-2", "Labels on the bug", ["scoreboard", "scoreboard-2"], TEXT),
        ("scoreboard-num", "Clock, odds, the verb on the board", ["scoreboard"], TEXT),
        ("scoreboard-num-ink", "Text on the orange verb", ["scoreboard-num"], TEXT),
        ("scoreboard-line", "Dividers between segments", ["scoreboard"], None),
    ]),
]


def measure(theme, token, against):
    return min(contrast(theme[token], theme[other]) for other in against)
