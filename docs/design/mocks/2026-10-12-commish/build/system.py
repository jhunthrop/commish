"""system.html: the combined system on one page. Every specimen is rendered by the same code the
screens use, from the same real rows, so the system cannot drift from the screens."""
from html import escape

import board
import lobby
import mock
from data import drafters_gap, heat_class, tier_cliffs
from palette import FAMILIES, NON_TEXT, TEXT, measure, themes
from shell import face, gap_chip, page, signed

ROW_PLAYER = "Chris Olave"
VALUE_EXAMPLES = ["Chris Olave", "Tetairoa McMillan", "Marvin Harrison Jr."]
BAND = ("WR", 3)

RULES = [
    ("The person before the number", "Every row opens on a face and a name. The number comes after."),
    ("One big number that says what it is", "Each screen has one number at display size, and the words under it name its basis."),
    ("One solid verb per viewport", "Burnt orange fills one button on screen. Everything else is quiet."),
    ("Every colored cell names its number", "Green prints its round, rose prints its minus, a tier strip prints its drop."),
    ("No explainer text", "If a label needs a tip, change the label."),
]

FACES = [
    ("Outfit", "font-ui", "Everything a person reads to operate the site: names, labels, chips, the verb, sentences in rows.",
     "Jaxon Smith-Njigba", "Everywhere"),
    ("Big Shoulders Display", "font-num", "Numbers at cell size and up, page titles in capitals, the clock and the odds on the bug.",
     "273.7", "Numbers and capital titles"),
    ("Newsreader", "font-read", "The capsule prose on the player page and the pull figures lifted from it. Nowhere else.",
     "We have nine players left in his tier.", "Player prose only"),
]

SCALE = [
    ("t-xs", 11, "Labels on cells, uppercase, tracked"), ("t-sm", 13, "Secondary text, chips"),
    ("t-md", 15, "Names and body in rows"), ("t-lg", 18, "Section heads"),
    ("t-read", 19, "Capsule prose, Newsreader"), ("t-xl", 26, "Cell numbers, Big Shoulders"),
    ("t-2xl", 44, "Tier numbers, the clock, pull figures"), ("t-3xl", 88, "The one big number on a page"),
]

CSS = """
.sys{padding:var(--s-6) var(--s-6) var(--s-7);display:flex;flex-direction:column;gap:var(--s-7);max-width:1240px;min-width:0}
.sys h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:clamp(3.5rem,8vw,6.5rem);line-height:0.82;text-transform:uppercase}
.sys h3{margin:0 0 var(--s-2);font-family:var(--font-num);font-weight:800;font-size:34px;line-height:1;text-transform:uppercase}
.sys .sub{margin:0 0 var(--s-4);color:var(--ink-2);font-size:var(--t-sm);max-width:72ch}
.sys section{min-width:0}
.tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-md)}
.tbl{width:100%;border-collapse:collapse;min-width:780px;font-size:var(--t-sm)}
.tbl th{text-align:left;font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3);font-weight:600;
  padding:10px var(--s-3);border-bottom:1px solid var(--line);background:var(--surface);white-space:nowrap}
.tbl td{padding:8px var(--s-3);border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr.fam td{background:var(--surface);font-weight:700;font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-2)}
.tbl code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12.5px;white-space:nowrap}
.tbl .role{color:var(--ink-2)}
.sw{display:inline-flex;align-items:center;gap:var(--s-2);white-space:nowrap}
.sw i{display:grid;place-items:center;width:44px;height:30px;border-radius:var(--r-sm);font-style:normal;font-weight:700;font-size:13px;
  box-shadow:inset 0 0 0 1px rgb(128 128 128 / 0.3)}
.sw code{color:var(--ink-2)}
.ratio{font-family:var(--font-num);font-weight:700;font-size:20px;font-variant-numeric:tabular-nums}
.ratio small{font-family:var(--font-ui);font-weight:500;font-size:var(--t-xs);color:var(--ink-3);margin-left:4px}
.faces{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-4)}
.faces .panel{padding:var(--s-5);display:flex;flex-direction:column;gap:var(--s-3);min-width:0}
.faces .spec{font-size:2.25rem;line-height:1.05;overflow-wrap:anywhere}
.faces .font-num{font-family:var(--font-num);font-weight:800;font-size:4.5rem;line-height:0.85}
.faces .font-ui{font-family:var(--font-ui);font-weight:600}
.faces .font-read{font-family:var(--font-read);font-weight:400;font-size:1.9rem;line-height:1.2}
.faces p{margin:0;color:var(--ink-2);font-size:var(--t-sm)}
.faces .where{display:inline-flex;align-self:flex-start;height:24px;align-items:center;padding:0 8px;border-radius:var(--r-sm);
  background:var(--surface-2);font-size:var(--t-xs);font-weight:700;letter-spacing:0.04em;text-transform:uppercase}
.scale{list-style:none;margin:var(--s-4) 0 0;padding:0;border-top:1px solid var(--line)}
.scale li{display:grid;grid-template-columns:72px 48px minmax(0,1fr);gap:var(--s-3);align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line)}
.scale code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12.5px;color:var(--ink-2)}
.scale .px{font-family:var(--font-num);font-weight:700;font-size:18px;color:var(--ink-3)}
.scale span:last-child{min-width:0;overflow-wrap:anywhere;line-height:1}
.specimen{border:1px solid var(--line);border-radius:var(--r-md);background:var(--bg);overflow-x:auto}
.specimen .row{border-bottom:0;min-width:760px}
.specimen .band{margin:0;min-width:520px}
.parts{list-style:none;margin:var(--s-4) 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s-3)}
.parts li{display:flex;flex-direction:column;gap:var(--s-2);padding:var(--s-4);border:1px solid var(--line);border-radius:var(--r-md);min-width:0}
.parts .show{min-height:48px;display:flex;align-items:center;gap:var(--s-2)}
.parts b{font-size:var(--t-md)}
.parts p{margin:0;font-size:var(--t-sm);color:var(--ink-2)}
.parts .c{height:46px;min-width:120px}
.parts .cliff b{font-size:34px}
.parts .strip-demo{display:grid;place-items:center;width:52px;height:48px;border-radius:var(--r-sm);background:var(--tier);color:var(--tier-ink);
  font-family:var(--font-num);font-weight:800;font-size:var(--t-2xl);line-height:1}
.verbs{display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center}
.live{display:flex;flex-direction:column;gap:var(--s-3);padding:var(--s-4);border:1px dashed var(--line-strong);border-radius:var(--r-md);min-width:0}
.live .lower{position:static;margin-top:0}
.live .bug{margin-bottom:0}
.rules{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:var(--s-3)}
.rules li{padding:var(--s-4);border-top:3px solid var(--ink);background:var(--surface);display:flex;flex-direction:column;gap:6px}
.rules b{font-size:var(--t-md)}
.rules span{font-size:var(--t-sm);color:var(--ink-2)}
@media (max-width: 960px){.faces{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){.sys{padding:var(--s-5) var(--s-4) var(--s-6);gap:var(--s-6)}.sys h3{font-size:28px}}
"""


def _swatch(theme, token, against):
    fg = theme[against[0]]
    return (f'<span class="sw"><i style="background:{theme[token]};color:{fg}">Aa</i>'
            f'<code>{theme[token]}</code></span>')


def _ratio(theme, token, against, bar):
    r = measure(theme, token, against)
    if bar is None:
        return f'<span class="ratio">{r:.2f}<small>rule, no text</small></span>'
    kind = "text" if bar == TEXT else "non-text"
    return f'<span class="ratio">{r:.2f}<small>{kind}, {bar:g}:1 bar</small></span>'


def _palette():
    t = themes()
    body = []
    for family, rows in FAMILIES:
        body.append(f'<tr class="fam"><td colspan="5">{family}</td></tr>')
        for token, role, against, bar in rows:
            vs = " or ".join(f"--{a}" for a in against)
            body.append(
                f'<tr><td><code>--{token}</code></td><td class="role">{role}<br><code>against {vs}</code></td>'
                f'<td>{_swatch(t["light"], token, against)}</td><td>{_ratio(t["light"], token, against, bar)}</td>'
                f'<td>{_swatch(t["dark"], token, against)} {_ratio(t["dark"], token, against, bar)}</td></tr>'
            )
    head = ("<tr><th>Token</th><th>Role, and what it is measured against</th><th>Light</th><th>Light ratio</th>"
            "<th>Dark, with ratio</th></tr>")
    return f'<div class="tbl-wrap"><table class="tbl"><thead>{head}</thead><tbody>{"".join(body)}</tbody></table></div>'


def _type():
    faces = "".join(
        f'<div class="panel"><span class="where">{where}</span><span class="spec {tok}">{escape(spec)}</span>'
        f'<b>{name}</b><p>{escape(use)}</p></div>'
        for name, tok, use, spec, where in FACES
    )
    face_of = {"t-read": "font-read", "t-xl": "font-num", "t-2xl": "font-num", "t-3xl": "font-num"}
    scale = "".join(
        f'<li><code>--{tok}</code><span class="px">{px}</span>'
        f'<span style="font-family:var(--{face_of.get(tok, "font-ui")});font-size:min({px}px,12vw)">{escape(use)}</span></li>'
        for tok, px, use in SCALE
    )
    return f'<div class="faces">{faces}</div><ul class="scale">{scale}</ul>'


def _row_anatomy(by_name, players):
    p = by_name[ROW_PLAYER]
    wrs = [x for x in players if x["pos"] == "WR"][:40]
    lo, hi = min(x["floor"] for x in wrs) // 25 * 25, max(x["ceiling"] for x in wrs)
    row = board.board_row(p, lo, hi, show_tier=False)
    parts = [
        (face(p, 40), "Face", "A 40px headshot on every row, before anything else."),
        (f'<b>{escape(p["name"])}</b>', "Name", "Outfit 600 at 15px. It truncates only after the face and pill fit."),
        (f'<span class="pos">{p["pos"]} {p["pos_rank"]}</span>', "Position pill",
         "Position and rank at that position. Monochrome, because color is spent on numbers."),
        (f'<span class="c vor heat-{p["vor_round"]}"><b class="num">{signed(p["vor"])}</b><i class="label">over repl · rd {p["vor_round"]}</i></span>',
         "The one number, with its basis", "Points over replacement in Big Shoulders. The label under it says what it is."),
        (gap_chip(drafters_gap(p)) + f'<span class="label">ADP {p["adp"]:.1f}</span>', "The ADP sentence",
         "Where drafters take him against our rank, in words. Green when later, rose when earlier."),
    ]
    items = "".join(f'<li><span class="show">{show}</span><b>{t}</b><p>{d}</p></li>' for show, t, d in parts)
    return f'<div class="specimen">{row}</div><ul class="parts">{items}</ul>'


def _band_anatomy(players):
    pos, tier = BAND
    cliffs, counts = tier_cliffs(players, pos)
    cliff = cliffs[tier]
    band = board.tier_band(pos, tier, cliffs, counts)
    parts = [
        (f'<span class="strip-demo t{tier}">{tier}</span>', "The strip",
         "Tier number on the tier's hue. Hot red at the top of a position, cold slate at the bottom. The number is printed, so hue is never the only channel."),
        (f'<b>Tier {tier}</b> <span class="label">{counts[tier]} WRs</span>', "The name and the count", "How many players share the tier."),
        (f'<span class="cliff"><b>{cliff["drop"]:.1f}</b><span>PPR pts down to tier {cliff["next"]}</span></span>', "The drop label",
         "Projected PPR points from the last player in this tier to the first in the next. The reason tiers exist, printed."),
    ]
    items = "".join(f'<li><span class="show t{tier}">{show}</span><b>{t}</b><p>{d}</p></li>' for show, t, d in parts)
    return f'<div class="specimen">{band}</div><ul class="parts">{items}</ul>'


def _value_cells(by_name):
    def cell(p):
        heat = heat_class(p)
        rd = f" · rd {p['vor_round']}" if p["vor"] >= 0 and p["vor_round"] <= 4 else ""
        return f'<span class="c vor {heat}"><b class="num">{signed(p["vor"])}</b><i class="label">over repl{rd}</i></span>'

    notes = {
        "Chris Olave": "Round 1 green. His points over replacement rank in the first 12 of our 400.",
        "Tetairoa McMillan": "Round 3 green, paler. Four greens, one per round, then no tint.",
        "Marvin Harrison Jr.": "Rose with a minus. Below replacement, a bench player in PPR this year.",
    }
    items = "".join(
        f'<li><span class="show">{cell(by_name[n])}</span><b>{escape(n)}</b><p>{notes[n]}</p></li>' for n in VALUE_EXAMPLES
    )
    return f'<ul class="parts">{items}</ul>'


def _verb():
    return """<div class="verbs"><a class="verb" href="setup.html">Start a mock draft</a>
  <button class="quiet" type="button">Queue</button>
  <span class="chip-group"><button class="chip" type="button" aria-pressed="true">WR</button><button class="chip" type="button" aria-pressed="false">RB</button></span></div>
  <ul class="parts"><li><b>Solid orange, one per viewport</b><p>The verb is the next thing to do, named with what it does: Start a mock draft, Add to my sheet, Draft Odunze.</p></li>
  <li><b>Quiet outline for the rest</b><p>Queue, Theme and every secondary action share one outlined style.</p></li>
  <li><b>Ink for the chosen chip</b><p>A pressed chip fills with ink, never orange, so orange keeps meaning the verb, the brand and you.</p></li></ul>"""


def _borrowed(players):
    st = mock.state(players)
    since = mock.since_strip(st["since"], st["queued"], st["prev"])
    call = mock.call_panel(st["call"], st["runner"], st["odds"], st["nxt"])
    bug = """<div class="bug" role="status" aria-live="polite"><div><small>Round 5</small><b>Pick 5.06</b></div>
      <div class="grow"><small>On the clock</small><b>jpk88</b></div><div class="clock"><small>Clock</small><b>0:19</b></div>
      <div class="you"><small>Your pick</small><b>5.08, in 2</b></div></div>"""
    return f"""<div class="live">{since}{call}{bug}</div>
  <ul class="parts"><li><b>What went since your pick</b><p>Against bots there is no clock and no reveal. The picks between your turns land as one strip with faces, and anyone from your queue is ringed in orange. It replaces the ticker.</p></li>
  <li><b>Our call</b><p>His face, the survival odds as the one big number, the runner-up in a sentence, the verb with its key. A Press Box panel with an orange edge, not a lower third, so it never covers the pool.</p></li>
  <li><b>Score bug, lobby only</b><p>The one Broadcast borrowing that survives. It appears only in a room with people in it, because only there is anyone on a clock. A solo mock never shows a clock.</p></li></ul>"""


def build(players):
    by_name = {p["name"]: p for p in players}
    rules = "".join(f"<li><b>{escape(r)}</b><span>{escape(d)}</span></li>" for r, d in RULES)
    body = f"""<main class="sys">
  <h2>System</h2>
  <section><h3>Rules</h3><ol class="rules">{rules}</ol></section>
  <section><h3>Palette</h3><p class="sub">Every color token in both themes, with its contrast against the ground it is used on. Text clears {TEXT:g}:1, the focus ring clears {NON_TEXT:g}:1, rules carry no text.</p>{_palette()}</section>
  <section><h3>Type</h3><p class="sub">Three faces, each with a place it is allowed. One scale from an 11px label to the 88px number.</p>{_type()}</section>
  <section><h3>Row</h3><p class="sub">A real board row, Chris Olave in the WR view, taken apart.</p>{_row_anatomy(by_name, players)}</section>
  <section><h3>Tier strip</h3><p class="sub">Tiers are drawn within each position. The All view carries the tier as a chip instead.</p>{_band_anatomy(players)}</section>
  <section><h3>Value cell</h3><p class="sub">Points over replacement, PPR 2026, tinted by the round it ranks in among our 400.</p>{_value_cells(by_name)}</section>
  <section><h3>The verb</h3>{_verb()}</section>
  <section><h3>Mock room parts</h3><p class="sub">The solo room at pick 5.08 of a 12-team PPR mock, with real survival odds, and the lobby score bug.</p>{_borrowed(players)}</section>
</main>"""
    return page("Commish System", "", "System", "", body, board.CSS + mock.ROOM_CSS + lobby.LOBBY_CSS + CSS, with_read=True)
