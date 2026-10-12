"""One screen before a mock: your league's shape, your slot, bots or people. Saved leagues make a rerun one tap."""
from shell import page

SETUP_CSS = """
.setup{padding:var(--s-5);display:grid;grid-template-columns:minmax(0,1fr) 352px;gap:var(--s-5);max-width:1240px}
.setup h2{margin:0 0 var(--s-2);font-family:var(--font-num);font-weight:800;font-size:38px;line-height:0.95;text-transform:uppercase}
.setup .lede{margin:0 0 var(--s-5);color:var(--ink-2);max-width:60ch}
.f{display:grid;grid-template-columns:150px minmax(0,1fr);gap:var(--s-3) var(--s-4);align-items:center;padding:var(--s-3) 0;border-top:1px solid var(--line)}
.f:last-of-type{border-bottom:1px solid var(--line)}
.f .k{font-weight:600}
.f .k small{display:block;font-weight:400;font-size:var(--t-xs);color:var(--ink-3)}
.slots{display:flex;flex-wrap:wrap;gap:6px}
.slots .chip{min-width:40px;justify-content:center;padding:0 10px}
.roster{display:flex;flex-wrap:wrap;gap:var(--s-2)}
.ro{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 10px;border:1px solid var(--line-strong);border-radius:var(--r-md);font-size:var(--t-sm)}
.ro b{font-family:var(--font-num);font-size:18px;font-weight:700}
.ro button{width:24px;height:24px;border:0;border-radius:4px;background:var(--surface-2);color:var(--ink);cursor:pointer;font-size:14px;line-height:1}
.pass{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:var(--r-sm);background:var(--accent-wash);color:var(--accent-text);font-size:var(--t-xs);font-weight:700;margin-left:6px}
.go{display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center;margin-top:var(--s-5)}
.go .verb{height:48px;padding:0 var(--s-6)}
.saved{padding:var(--s-4)}
.saved h3{margin:0 0 var(--s-3);font-size:var(--t-md)}
.saved ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s-2)}
.saved li{display:flex;justify-content:space-between;align-items:center;gap:var(--s-2);padding:var(--s-2) var(--s-3);border:1px solid var(--line);border-radius:var(--r-md);font-size:var(--t-sm)}
.saved li b{display:block}.saved li span{color:var(--ink-3);font-size:var(--t-xs)}
.lobbies{padding:var(--s-4)}
.lobbies h3{margin:0 0 var(--s-1);font-size:var(--t-md)}
.lobbies p{margin:0 0 var(--s-3);font-size:var(--t-sm);color:var(--ink-2)}
.lobbies ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s-2)}
.lobbies li{display:grid;grid-template-columns:1fr auto;gap:var(--s-2);align-items:center;padding:var(--s-2) var(--s-3);border:1px solid var(--line);border-radius:var(--r-md);font-size:var(--t-sm)}
.lobbies li b{display:block}.lobbies li span{color:var(--ink-3);font-size:var(--t-xs)}
.lobbies .fill{font-family:var(--font-num);font-weight:700;font-size:18px;color:var(--ink-2)}
@media (max-width: 1100px){.setup{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){.setup{padding:var(--s-4)}.setup h2{font-size:30px}.f{grid-template-columns:minmax(0,1fr)}}
"""


def chips(options, on, group):
    return f'<div class="chips" role="group" aria-label="{group}">' + "".join(
        f'<button class="chip" type="button" aria-pressed="{"true" if o == on else "false"}">{o}</button>' for o in options
    ) + "</div>"


def build():
    slots = '<div class="slots" role="group" aria-label="Your slot">' + "".join(
        f'<button class="chip" type="button" aria-pressed="{"true" if i == 8 else "false"}">{i}</button>' for i in range(1, 13)
    ) + '<button class="chip" type="button" aria-pressed="false">Random</button></div>'
    roster = '<div class="roster">' + "".join(
        f'<span class="ro">{slot}<b>{n}</b><button type="button" aria-label="Fewer {slot}">−</button><button type="button" aria-label="More {slot}">+</button></span>'
        for slot, n in (("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("FLEX", 1), ("K", 1), ("D/ST", 1), ("Bench", 6))
    ) + "</div>"
    body = f"""<main class="setup">
<div>
  <h2>New mock</h2>
  <p class="lede">Set it to your league once and save it. Against bots there is no clock, so a mock takes as long as your own picks do. Against people it is 30 seconds a pick.</p>
  <div class="f"><span class="k">Scoring</span>{chips(["PPR", "Half PPR", "Standard", "TE premium"], "PPR", "Scoring")}</div>
  <div class="f"><span class="k">Custom scoring<small>your league's exact points</small></span><div class="chips"><button class="chip" type="button" aria-pressed="false">Import from ESPN, Yahoo or Sleeper</button><span class="pass">Draft Pass</span></div></div>
  <div class="f"><span class="k">Teams</span>{chips(["8", "10", "12", "14"], "12", "Teams")}</div>
  <div class="f"><span class="k">Your slot</span>{slots}</div>
  <div class="f"><span class="k">Roster<small>rounds follow from it: 15</small></span>{roster}</div>
  <div class="f"><span class="k">Lineup</span>{chips(["Standard", "Superflex", "2 flex"], "Standard", "Lineup")}</div>
  <div class="f"><span class="k">Bots<small>how the other 11 draft</small></span>{chips(["From where drafters take players", "Your league's last draft"], "From where drafters take players", "Bots")}</div>
  <div class="f"><span class="k">Keepers</span><div class="chips"><button class="chip" type="button" aria-pressed="false">Add keepers</button></div></div>
  <div class="go"><a class="verb" href="mock.html">Start against bots</a><a class="quiet" href="lobby.html">Join a lobby with people</a><button class="quiet" type="button">Save as a league</button></div>
</div>
<aside class="dock">
  <div class="saved panel"><h3>Your leagues</h3><ul>
    <li><div><b>Tuesday night, 12 PPR</b><span>slot 8 · last mock 2 days ago</span></div><a class="quiet" href="mock.html">Mock</a></li>
    <li><div><b>Work league, 10 half PPR</b><span>slot 3 · superflex</span></div><a class="quiet" href="mock.html">Mock</a></li>
  </ul></div>
  <div class="lobbies panel"><h3>Lobbies filling now</h3><p>A lobby starts when 12 are in, or 90 seconds after the first, with bots in the open seats.</p><ul>
    <li><div><b>12 teams, PPR</b><span>30 seconds a pick</span></div><span class="fill">7 of 12</span></li>
    <li><div><b>12 teams, half PPR, superflex</b><span>30 seconds a pick</span></div><span class="fill">3 of 12</span></li>
    <li><div><b>10 teams, PPR</b><span>45 seconds a pick</span></div><span class="fill">1 of 10</span></li>
  </ul></div>
</aside>
</main>"""
    return page("Commish New Mock", "mock", "Mock draft", "", body, SETUP_CSS)
