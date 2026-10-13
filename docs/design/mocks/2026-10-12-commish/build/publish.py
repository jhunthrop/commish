"""Two artifact pages from the screenshots: the mock room rethink, and the combined direction updated."""
import base64
from pathlib import Path

SHOTS = Path(__file__).resolve().parent.parent / "screenshots"
OUT = Path(__file__).resolve().parent.parent / "publish"

HEAD = """<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap"><style>
:root{--bg:#ffffff;--ink:#15120f;--muted:#6b635c;--card:#f7f4f0;--line:#e6e0d9;--accent:#c2470a}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#090807;--ink:#f5f0ea;--muted:#8f857c;--card:#15120f;--line:#2a2522;--accent:#ff7130}}
:root[data-theme="dark"]{--bg:#090807;--ink:#f5f0ea;--muted:#8f857c;--card:#15120f;--line:#2a2522;--accent:#ff7130}
body{background:var(--bg);color:var(--ink);font-family:Outfit,Figtree,system-ui,sans-serif;margin:0;padding:32px 20px;line-height:1.5}
main{max-width:1500px;margin:0 auto}h1{font-size:32px;margin:0 0 6px;letter-spacing:-.01em}p{color:var(--muted);max-width:72ch;margin:0 0 10px}
h2{font-size:21px;margin:40px 0 10px;padding-top:16px;border-top:1px solid var(--line)}
.row{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));margin-bottom:22px}
figure{margin:0;background:var(--card);border-radius:16px;padding:12px;border:1px solid var(--line)}figcaption{font-weight:600;font-size:.9em;margin-bottom:8px}
img{width:100%;height:auto;border-radius:10px;display:block}.phones{grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),240px))}
.three{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin:14px 0 6px}.three div{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}.three b{color:var(--accent);display:block;font-size:.8em;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
table{border-collapse:collapse;width:100%;max-width:900px;font-size:.93em;margin:6px 0 10px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:.8em;text-transform:uppercase;letter-spacing:.04em}
ul{color:var(--muted);max-width:76ch;padding-left:20px}li{margin:4px 0}
</style>"""


def img(name, alt):
    data = base64.b64encode((SHOTS / f"{name}.png").read_bytes()).decode()
    return f'<img src="data:image/png;base64,{data}" alt="{alt}">'


def pair(title, name):
    return (f'<h2>{title}</h2><div class="row"><figure><figcaption>dark</figcaption>{img(f"{name}-dark-1440", f"{title} dark")}</figure>'
            f'<figure><figcaption>light</figcaption>{img(f"{name}-light-1440", f"{title} light")}</figure></div>')


def phones(items):
    figs = "".join(f'<figure><figcaption>{t}</figcaption>{img(f"{n}-{th}-390", f"{t}")}</figure>' for n, th, t in items)
    return f'<h2>Phone</h2><div class="row phones">{figs}</div>'


def mock_room():
    return f"""<title>Mock Room Rethink</title>{HEAD}<main>
<h1>The mock room, rethought</h1>
<p>Nobody drafts for real in our tool, so a mock is an experiment, not an event. Two rooms on one surface, built from the real 2026 PPR board with the product&rsquo;s own survival code on the remaining pool. The clock exists in only one of them.</p>
<div class="three"><div><b>Solo, against bots</b>No clock and no reveal. The bots have already picked when the page paints, what went since your last pick lands as one strip, and Enter drafts our call. A mock is as long as your own picks. The mock is a function of settings, seed and your picks, so undo, branch, replay and a share link come for free.</div>
<div><b>Lobby, with people</b>Queue by format, start at twelve or 90 seconds after the first drafter with bots in the open seats, 30 seconds a pick, your queue drafts if you step away, a bot takes any seat that closes the tab. The score bug is the one Broadcast borrowing that survives, because only here is anyone on a clock.</div>
<div><b>The report</b>Your starters against the field by our projections with the basis named, every pick with its ADP gap and hindsight odds, and the same draft run 200 more times: the spread of starting points and who you end up with from this slot.</div></div>
<table><tr><th></th><th>Solo</th><th>Lobby</th></tr>
<tr><td>Clock</td><td>None</td><td>30 or 45 seconds a pick</td></tr>
<tr><td>Reveal</td><td>None, one strip of what went</td><td>Picks land as made</td></tr>
<tr><td>Undo, branch, replay</td><td>Yes, by seed</td><td>No, it is other people&rsquo;s draft too</td></tr>
<tr><td>Who owns time</td><td>The request</td><td>A Go room process on Cloud Run</td></tr></table>
{pair("New mock: your league once, saved", "setup")}
{pair("The solo room at your pick, 5.08", "mock")}
{pair("The lobby, jpk88 on the clock, your pick in two", "lobby")}
{pair("The report: the field, pick by pick, 200 more runs", "report")}
{phones([("mock", "dark", "Room, dark"), ("mock", "light", "Room, light"), ("lobby", "dark", "Lobby, dark"), ("report", "light", "Report, light"), ("setup", "dark", "Setup, dark")])}
<h2>What the engine already does, from a read of the code</h2>
<ul><li>The reducer is pure and carries no clock. Bots are seeded draws, one stream per team, with replay pins as a byte-for-byte oracle. The batch that resolves every bot pick until your turn already runs inside your own pick&rsquo;s transaction, measured at 32 ms p50 for a 12-team room. The reveal delay is one line.</li>
<li>The 200-run sim continues the real room with the real bots in about 250 ms. Post-draft grading exists with projected points and rank. The letter grade is dropped.</li>
<li>What does not exist: autopick from a whole sheet, a queue-based lobby, a process that owns a human room&rsquo;s clock, undo, a share link.</li></ul>
<h2>What the build must settle</h2>
<ul><li>Tiers in the data are per position, so the pool shows no tier chip until the projections lane settles a board-wide tier.</li>
<li>The data pulled for these screens has no kickers or defenses. The real room has them.</li>
<li>With ADP-only bots the drafter leads 174 of 200 runs by our own projections, which the page says in its first paragraph. The real bots reach and chase positions, which widens the band. Re-measure once they are in.</li>
<li>Lobby handles are shown to strangers, so they pass the account-name filter, and there is no chat at launch.</li></ul>
<p>Design doc: docs/design/2026-10-12-mock-room-rethink.md on main.</p></main>"""


def combined():
    return f"""<title>Commish Direction</title>{HEAD}<main><h1>Commish, the combined direction</h1>
<p>Press Box as the system, Scout&rsquo;s serif on the prose, Broadcast&rsquo;s score bug in the lobby. Built from the real 2026 PPR board and a real written capsule; the survival odds in the rooms come from the product&rsquo;s own survival code run on the remaining pool. Updated 2026-10-12 with the mock room rethink.</p>
<div class="three"><div><b>The system</b>Press Box. A near-black or paper-white shell with the icon rail and a search that never leaves the top, dense rows that put a face before every number, and one burnt orange for the brand, the one verb and you.</div><div><b>Every other color is a measurement</b>Green for the round a player&#x27;s value ranks in, rose below replacement, and hot-to-cold tier strips that print the drop to the next tier. A colored cell always says what its number is.</div><div><b>Two borrowings with fixed borders</b>The player page&#x27;s capsule is set in Newsreader because it is writing. A mock lobby with people in it wears a score bug on scoreboard black, the only clock on the site. The lower third is retired: our call is a Press Box panel above the pool.</div></div>
{pair("The board", "board")}
{pair("A player page, Chris Olave", "player")}
{pair("New mock", "setup")}
{pair("The solo mock room, your pick at 5.08, no clock", "mock")}
{pair("The lobby with people, the score bug", "lobby")}
{pair("The report after a mock", "report")}
{pair("The system: palette, type, anatomy, rules", "system")}
{phones([("board", "dark", "Board, dark"), ("board", "light", "Board, light"), ("player", "dark", "Player, dark"), ("player", "light", "Player, light"), ("mock", "dark", "Mock room, dark"), ("mock", "light", "Mock room, light"), ("lobby", "dark", "Lobby, dark"), ("report", "light", "Report, light")])}
<h2>What the build should settle, found while making this</h2><ul>
<li>Tiers in the data are drawn within each position, so the board opens on a position and the All view shows the tier as a chip. A board-wide tier is a product decision for the projections lane.</li>
<li>Two capsules show pipeline defects the writer must catch: one quotes a rank from the projected-points sort rather than the board, and one carries an unedited aside. Both are left as they are here because capsules are real data.</li>
<li>The report ranks you by our projections, the same numbers the board ranks by, so a team drafted off the board leads in 174 of 200 runs against ADP-only bots. The page says so. The real bots widen the band.</li>
<li>The Basis panel on the board reads close to explainer text and is the first thing to cut if the persona panel calls it a tip.</li></ul></main>"""


(OUT / "mock-room.html").write_text(mock_room())
(OUT / "commish.html").write_text(combined())
for n in ("mock-room.html", "commish.html"):
    print(n, (OUT / n).stat().st_size // 1024, "KB")
