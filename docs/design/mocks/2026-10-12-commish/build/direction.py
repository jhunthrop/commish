from palette import themes
from shell import page

SENTENCES = [
    "Commish is Press Box: a near-black or paper-white shell with the icon rail and a search that never leaves the top, dense rows that put a face before every number, and one burnt orange for the brand, the one verb and you.",
    "Every other color is a measurement that names itself, green for the round a player's value ranks in, rose below replacement, and hot-to-cold tier strips that print the drop to the next tier.",
    "The league is the site's context: its switch closes the top bar at the right on every page, naming the selected league (or the format with none), and the board, the player page, compare, the sheet and mock setup all read it, with rostered players marked by the league's flag on their face.",
    "Two borrowings have fixed borders: the player page's capsule is set in Newsreader because it is writing, and a mock lobby with people in it wears a score bug on scoreboard black, the only clock on the site.",
]

PAGES = [
    ("board", "Board", "Opens on WR with tier strips and their drops, 40 real rows, the sheet rail"),
    ("player", "Chris Olave", "His capsule in Newsreader with three pull figures, one big number, one verb"),
    ("setup", "New mock", "Your league's shape once, saved, bots or people"),
    ("mock", "Mock room", "Your pick at 5.08, what went since 4.05, our call with real survival odds, no clock"),
    ("lobby", "Lobby", "Five people and seven bots, 30 seconds a pick, the score bug"),
    ("report", "Report", "Your starters against the field, every pick with hindsight odds, 200 more runs"),
    ("system", "System", "Every token in both themes with its contrast, the faces, the anatomy, the rules"),
]

PERSONAS = [
    ("Veteran", [
        "Board: WR tier 3 ends 16.8 points above tier 4, printed on the strip, so I stop doing that subtraction in my head.",
        "Player: Olave's capsule says drafters take him a round later than he should go, and the chip above it says 9 picks later. The writing and the board agree, so I trust both.",
        "Mock: 14 went since 4.05 and four were on my queue, so I know what happened without scrolling the wall. The report tells me Likely at 9.08 would have lasted 96% of the time. That is the lesson I came for.",
    ]),
    ("Casual", [
        "Board: faces, names and green boxes read in two seconds, and \"9 picks later\" says what ADP means without the word.",
        "Player: the serif makes the read feel like a column I would actually finish, and 29%, 49.7% and 16.8 pulled out beside it tell me what to remember.",
        "Mock: no clock, one orange button, Enter takes the call. A whole mock is as long as my own picks. \"Over repl\" is still the one label I would stumble on.",
    ]),
    ("Commissioner", [
        "Board: the line under the title says PPR, ranked over replacement, tiers within each position, so I can check it matches my league before I share it.",
        "Player: one page per player with the prose and the numbers agreeing is something I can link in the group chat without a caveat.",
        "Mock: Tuesday night, 12 PPR is saved with my slot, so a rerun is one tap, and the lobby fills with bots after 90 seconds instead of making my league wait.",
    ]),
    ("First-timer", [
        "Board: the colored strips show me where the drop-offs are before I know a single name.",
        "Player: Add to my sheet is the only orange thing on the page, so I know what to do when I am convinced.",
        "Mock: on the phone the strip of who went and our call come first, and Pick for me to round 8 means I can watch a draft happen before I run one myself.",
    ]),
]

UNRECONCILED = [
    "Press Box shipped a two-state Light/Dark toggle, not Auto/Light/Dark. Every Commish page now carries a three-state Auto/Light/Dark switch, the pattern Broadcast built, remembered per browser.",
    "Survival odds are the product's model (src/projections/decide/survival.ts and normal.ts), ported by Broadcast and reused unchanged on Press Box's remaining pool at pick 56 to pick 65. Two gaps remain. Players with no ADP queue behind everyone at ADP 250 because the TypeScript requires an ADP. Which player gets the call (value times the chance he is gone) is Press Box's rule, not the advisor's own ranking, which is not ported.",
    "The closed form prints 0 for Williams at 5.08, so the room says under 1%. Bots take ADP blurred by the survival spread, seeded, so the same seed replays the same room.",
    "Chase Brown was dropped. His capsule calls him 32nd overall, which is the projected-points sort in the CSV, while our board ranks him 14th, and its second paragraph carries an unedited writer aside (\"not that word, let me say it plainly\"). Both are capsule pipeline defects to fix before launch.",
    "Olave's capsule quotes +28.3 points over receivers drafted at his spot, a different basis from the +93.7 over replacement on the same page. Each names its basis, but a reader sees two plus numbers. The capsule also says \"the honest worry\", a set phrase the copy rules would cut. Capsules are real data, so neither was edited.",
    "The board's Basis panel in the right rail is Press Box's and reads close to explainer text. It stays because each line names the basis of a color, and it is the first thing to cut if the persona panel calls it a tip.",
    "The lower third is gone. Our call is a Press Box panel above the pool, so nothing covers the rows. The score bug survives only in the lobby, where someone is on a clock.",
    "The report ranks you by our projections, the same numbers the board ranks by, so a team drafted off the board leads the field in 174 of 200 runs. The page says so in its first paragraph. The real room's bots reach and chase positions, which widens the band.",
    "Tiers in the data are drawn within each position, so the room's pool shows no tier chip until the projections lane settles a board-wide tier.",
    "The system and direction pages load Newsreader for their type specimens. Those specimens are the only exception to player prose only.",
]
SWATCHES = [("Ground", "bg", "ink"), ("Surface", "surface", "ink"), ("Line", "line-strong", "ink"),
            ("Ink", "ink", "bg"), ("Quiet ink", "ink-3", "bg"), ("Orange", "accent", "accent-ink"),
            ("Your wash", "accent-wash", "ink"), ("Round 1", "heat-1", "heat-ink"), ("Round 2", "heat-2", "heat-ink"),
            ("Round 3", "heat-3", "heat-ink"), ("Round 4", "heat-4", "heat-ink"), ("Below repl", "heat-neg", "heat-ink")]


def _spec(theme):
    return {"ground": (theme["bg"], theme["ink"]),
            "rows": [(label, theme[tok], theme[ink]) for label, tok, ink in SWATCHES],
            "tiers": [theme[f"tier-{n}"] for n in range(1, 8)]}


PALETTES = {name.title(): _spec(t) for name, t in themes().items()}


def _palette(name, spec):
    bg, fg = spec["ground"]
    rows = "".join(
        f'<li><span class="sw" style="background:{hexv};color:{ink}">{hexv}</span><span>{label}</span></li>'
        for label, hexv, ink in spec["rows"]
    )
    tiers = "".join(
        f'<span class="ts" style="background:{h}">{i}</span>' for i, h in enumerate(spec["tiers"], start=1)
    )
    return (
        f'<div class="pal" style="background:{bg};color:{fg}"><h4>{name}</h4><ul>{rows}</ul>'
        f'<div class="tierrow"><span>Tiers, hot to cold</span><div>{tiers}</div></div></div>'
    )


CSS = """
.dir{padding:var(--s-6) var(--s-6) var(--s-7);display:flex;flex-direction:column;gap:var(--s-7);max-width:1240px}
.dir h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:clamp(4rem,10vw,9rem);line-height:0.8;text-transform:uppercase;letter-spacing:0.005em}
.dir h2 i{font-style:normal;color:var(--accent-text)}
.thesis{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s-6);align-items:end}
.thesis ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--s-3);max-width:62ch}
.thesis li{font-size:var(--t-lg);line-height:1.5}
.dir h3{margin:0 0 var(--s-4);font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3);font-weight:600}
.pals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4)}
.pal{border-radius:var(--r-md);padding:var(--s-5);border:1px solid var(--line)}
.pal h4{margin:0 0 var(--s-4);font-size:var(--t-lg)}
.pal ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-3)}
.pal li{display:flex;flex-direction:column;gap:6px;font-size:var(--t-sm)}
.pal .sw{height:56px;border-radius:var(--r-sm);display:flex;align-items:flex-end;padding:6px 8px;font-size:var(--t-xs);font-weight:600;
  box-shadow:inset 0 0 0 1px rgb(128 128 128 / 0.25)}
.tierrow{margin-top:var(--s-4);display:flex;flex-direction:column;gap:var(--s-2);font-size:var(--t-sm)}
.tierrow div{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.ts{height:40px;display:grid;place-items:center;border-radius:var(--r-sm);color:#ffffff;font-family:var(--font-num);font-weight:800;font-size:22px}
.type{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-4)}
.spec-read{font-family:var(--font-read);font-size:1.75rem;line-height:1.25}
.more{margin:var(--s-3) 0 0;font-size:var(--t-sm)}
.type .panel{padding:var(--s-5);display:flex;flex-direction:column;gap:var(--s-3)}
.spec-num{font-family:var(--font-num);font-weight:800;font-size:7rem;line-height:0.8;font-variant-numeric:tabular-nums}
.spec-ui{font-family:var(--font-ui);font-weight:600;font-size:2.4rem;line-height:1.05}
.type p{margin:0;color:var(--ink-2)}
.screens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4)}
.screens a{display:flex;flex-direction:column;gap:var(--s-2);text-decoration:none}
.screens img{width:100%;max-width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top left;border-radius:var(--r-md);border:1px solid var(--line)}
.screens b{font-size:var(--t-lg)}
.screens span{font-size:var(--t-sm);color:var(--ink-2)}
.shot-dark{display:none}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .shot-dark{display:block}:root:not([data-theme="light"]) .shot-light{display:none}}
:root[data-theme="dark"] .shot-dark{display:block}:root[data-theme="dark"] .shot-light{display:none}
.walk{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4)}
.walk .panel{padding:var(--s-5)}
.walk h4{margin:0 0 var(--s-3);font-size:var(--t-lg)}
.walk ul,.dep{margin:0;padding-left:1.1em;display:flex;flex-direction:column;gap:var(--s-2);color:var(--ink-2)}
.dep{max-width:80ch}
@media (max-width: 900px){.pals,.why,.type,.walk,.screens{grid-template-columns:minmax(0,1fr)}.thesis{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){.dir{padding:var(--s-5) var(--s-4) var(--s-6);gap:var(--s-6)}.pal ul{grid-template-columns:repeat(2,minmax(0,1fr))}.spec-num{font-size:5rem}}
"""


def build():
    thesis = "".join(f"<li>{x}</li>" for x in SENTENCES)
    pals = "".join(_palette(n, sp) for n, sp in PALETTES.items())
    screens = "".join(
        f'<a href="{n}.html"><img class="shot-light" src="screenshots/{n}-light-1440.png" alt="{t} in light">'
        f'<img class="shot-dark" src="screenshots/{n}-dark-1440.png" alt="{t} in dark"><b>{t}</b><span>{d}</span></a>'
        for n, t, d in PAGES
    )
    walk = "".join(
        f'<div class="panel"><h4>{who}</h4><ul>{"".join(f"<li>{line}</li>" for line in lines)}</ul></div>'
        for who, lines in PERSONAS
    )
    deps = "".join(f"<li>{d}</li>" for d in UNRECONCILED)
    body = f"""<main class="dir">
  <section class="thesis"><h2>Com<br><i>mish</i></h2><ol>{thesis}</ol></section>
  <section><h3>The four pages</h3><div class="screens">{screens}</div></section>
  <section><h3>Persona walk: board, player, draft room</h3><div class="walk">{walk}</div></section>
  <section><h3>Palette, both themes as equals</h3><div class="pals">{pals}</div><p class="more"><a href="system.html">Every token with its contrast ratio is on the system page</a></p></section>
  <section><h3>Three faces</h3><div class="type">
    <div class="panel"><span class="spec-ui">Jaxon Smith-Njigba<br>WR 3 · 2 picks later</span><p><b>Outfit</b> for everything a person reads to operate the site.</p></div>
    <div class="panel"><span class="spec-num">273.7</span><p><b>Big Shoulders Display</b> for numbers and capital titles, the scoreboard face.</p></div>
    <div class="panel"><span class="spec-read">Nine players left in his tier before a 16.8-point cliff.</span><p><b>Newsreader</b> for the capsule on the player page and its pull figures. Nowhere else.</p></div>
  </div></section>
  <section><h3>What did not reconcile</h3><ul class="dep">{deps}</ul></section>
</main>"""
    return page("Commish Direction", "record", "Direction", "", body, CSS, with_read=True)
