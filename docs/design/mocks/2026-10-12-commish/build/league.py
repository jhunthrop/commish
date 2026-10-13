"""The league page as shipped (Lane 11 and UX fix 5): standings, this week's matchup, your roster, the waiver
pool and the moves, every row carrying his season beside the projection and opening his game log. Drawn from
data/league-sleeper.json, a recorded Sleeper league read through a local api and joined to the run's board.

The page has no solid verb: start and sit and the waiver lane bring its one verb (UX review 5 L13)."""
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from inseason import LEAGUE_ROW_CSS, league_data, league_row
from shell import page

EASTERN = ZoneInfo("America/New_York")
SLOT_WORDS = {"starter": "Start", "bench": "Bench", "reserve": "IR", "taxi": "Taxi"}
ROSTER_ROWS = 14

CSS = LEAGUE_ROW_CSS + """
.league{display:flex;flex-direction:column;gap:var(--s-4);padding:var(--s-4) var(--s-5) var(--s-6)}
.lead{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s-3);flex-wrap:wrap}
.lead h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:var(--t-display);line-height:1;text-transform:uppercase}
.lead p{margin:var(--s-1) 0 0;color:var(--ink-2)}
.lead .read{color:var(--ink-3);font-size:var(--t-sm)}
.stand{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--surface)}
.stand div{display:grid;grid-template-columns:auto 1fr;column-gap:var(--s-2);padding:var(--s-2) var(--s-3);border-right:1px solid var(--line);border-bottom:1px solid var(--line);min-width:0}
.stand div.me{background:var(--accent-wash)}
.stand b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stand .n{font-family:var(--font-num);color:var(--ink-3)}
.stand small{grid-column:1 / -1;display:flex;justify-content:space-between;font-family:var(--font-num);color:var(--ink-3)}
.grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--s-4);align-items:start}
.col{display:flex;flex-direction:column;gap:var(--s-4);min-width:0}
.pane{padding:0}
.pane .hd{padding:var(--s-3) var(--s-3) var(--s-2)}
.pane h3{margin:0;display:flex;justify-content:space-between;align-items:baseline;font-size:var(--t-md)}
.pane .basis{margin:var(--s-1) 0 0;font-size:var(--t-xs);color:var(--ink-3)}
.sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4);padding:var(--s-2) 0 var(--s-3)}
.side header{display:flex;justify-content:space-between;padding:var(--s-2) var(--s-3);border-bottom:2px solid var(--line-strong);font-weight:700}
.side.mine header{border-bottom-color:var(--accent)}
.moves{list-style:none;margin:0;padding:0 var(--s-3) var(--s-2)}
.moves li{display:grid;grid-template-columns:4.5em minmax(0,1fr);gap:var(--s-3);align-items:baseline;padding:var(--s-3) 0;border-bottom:1px solid var(--line)}
.moves b{font-weight:600}
.moves span{color:var(--ink-2)}
.foot{display:flex;flex-direction:column;gap:var(--s-2);align-items:flex-start;font-size:var(--t-sm);color:var(--ink-3)}
@media (max-width: 1100px){.grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){.league{padding:var(--s-3) var(--s-4) var(--s-5)}.sides{grid-template-columns:minmax(0,1fr)}
  .stand{grid-template-columns:repeat(12,minmax(132px,1fr));overflow-x:auto}
}
"""


def _day(iso):
    at = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(EASTERN)
    return f"{at:%b} {at.day}"


def _move(m):
    adds = ", ".join(name for _, name in m["adds"])
    drops = ", ".join(m["drops"])
    if m["kind"] == "trade":
        a, b = m["teams"]
        got = lambda t: ", ".join(n for who, n in m["adds"] if who == t) or "nobody"
        return f"{a} and {b} traded. {a} got {got(a)}, {b} got {got(b)}"
    how = "claimed" if m["kind"] == "waiver" else "picked up"
    parts = [f"{how} {adds}" if adds else "", f"dropped {drops}" if drops else ""]
    return f"{m['teams'][0]} {' and '.join(x for x in parts if x)}"


def build():
    d = league_data()
    me = next(t for t in d["teams"] if t["roster_id"] == d["me"])
    place = [t["roster_id"] for t in d["teams"]].index(d["me"]) + 1
    standings = "".join(
        f'<div class="{"me" if t["roster_id"] == d["me"] else ""}"><span class="n">{i}</span><b>{escape(t["name"])}</b>'
        f'<small><span>{t["wins"]}-{t["losses"]}</span><span>{t["points_for"]:.1f} pts</span></small></div>'
        for i, t in enumerate(d["teams"], start=1)
    )
    basis = d["season_basis"]
    season_line = f"Games and points a game are this season's, {basis['scoring']}, through week {basis['through']}."
    row_basis = f"{season_line} Proj and over repl are our preseason board's: {', '.join(d['board_basis'])}."

    def side(s, mine):
        rows = "".join(league_row(p, trailing="") for p in s["starters"])
        return f'<section class="side{" mine" if mine else ""}"><header><span>{escape(s["team"])}</span></header>{rows}</section>'

    roster = "".join(league_row(r["player"], slot=SLOT_WORDS[r["slot"]]) for r in d["roster"][:ROSTER_ROWS])
    pool = "".join(league_row(p, ends_on_value=True) for p in d["pool"])
    moves = "".join(f"<li><b>{_day(m['at'])}</b><span>{escape(_move(m))}.</span></li>" for m in d["moves"])
    body = f"""<main class="league">
  <header class="lead"><div><h2>{escape(d['name'])}</h2>
    <p>{escape(me['name'])}, {me['wins']}-{me['losses']}, {place} of {len(d['teams'])}. <span class="read">Read from Sleeper just now.</span></p></div>
    <a class="quiet" href="#">Read Sleeper now</a></header>
  <section class="stand" aria-label="Standings">{standings}</section>
  <div class="grid">
    <div class="col">
      <section class="pane panel"><div class="hd"><h3><span>Week {d['week']}</span><span class="label">No games played yet</span></h3></div>
        <div class="sides">{side(d['matchup']['mine'], True)}{side(d['matchup']['opponent'], False)}</div></section>
      <section class="pane panel"><div class="hd"><h3><span>Your roster</span><span class="label">Points a game</span></h3>
        <p class="basis">{escape(row_basis)}</p></div>{roster}</section>
    </div>
    <div class="col">
      <section class="pane panel"><div class="hd"><h3><span>Waiver pool</span><span class="label">{d['pool_size']} players</span></h3>
        <p class="basis">Unrostered in your league. {escape(row_basis)}</p></div>{pool}</section>
      <section class="pane panel"><div class="hd"><h3><span>Moves</span><span class="label">This week and last</span></h3></div>
        <ul class="moves">{moves}</ul></section>
    </div>
  </div>
  <footer class="foot"><span>Your league's roster and scoring are saved for mock drafts, under its name in your saved leagues.</span>
    <a class="quiet" href="setup.html">Start a mock draft</a></footer>
</main>"""
    return page(
        "Commish League",
        "league",
        "League",
        '<a class="quiet" href="#">Follow another league</a>',
        body,
        CSS,
        search=False,
    )
