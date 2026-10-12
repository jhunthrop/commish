from html import escape

from data import drafters_gap, heat_class, tier_cliffs
from shell import face, gap_chip, page, signed, tier_class

ROWS = 40
POSITIONS = ["QB", "RB", "WR", "TE"]
DEFAULT_VIEW = "WR"
POS_PLURAL = {"QB": "QBs", "RB": "RBs", "WR": "WRs", "TE": "TEs"}
BASIS_LINE = "PPR, full 2026 season · ranked by points over replacement · tiers drawn within each position"
SHEET_TARGETS = ["Nico Collins", "George Pickens", "Tetairoa McMillan", "Chase Brown"]

CSS = """
.board{display:grid;grid-template-columns:minmax(0,1fr) var(--side-w);gap:var(--s-5);padding:var(--s-5)}
.lead{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:var(--s-3);margin-bottom:var(--s-4)}
.lead h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:var(--t-2xl);line-height:0.9;text-transform:uppercase;letter-spacing:0.01em}
.lead p{margin:6px 0 0;color:var(--ink-2);font-size:var(--t-sm)}
.filters{display:flex;flex-wrap:wrap;gap:var(--s-3);margin-bottom:var(--s-4)}
.grid-row{display:grid;grid-template-columns:34px 44px minmax(170px,1fr) 92px 132px minmax(140px,190px) 150px;
  align-items:center;column-gap:var(--s-3)}
.thead{padding:0 var(--s-3) var(--s-2);border-bottom:1px solid var(--line)}
.thead .label{white-space:nowrap}
.thead .r{text-align:right}
.row{min-height:var(--row-h);padding:4px var(--s-3);border-bottom:1px solid var(--line)}
.row:hover{background:var(--surface)}
.rk{font-size:var(--t-sm);color:var(--ink-3);text-align:right;font-variant-numeric:tabular-nums}
.who{min-width:0;display:flex;flex-direction:column;gap:2px}
.who .name{font-weight:600;font-size:var(--t-md);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}
.who .name:hover{text-decoration:underline}
.meta{display:flex;align-items:center;gap:6px;overflow:hidden;font-size:var(--t-sm);color:var(--ink-3);white-space:nowrap}
.m-proj{display:none}
.c{display:flex;flex-direction:column;justify-content:center;height:calc(var(--row-h) - 8px)}
.c b{font-weight:700;font-size:var(--t-xl);line-height:1}
.c .label{font-style:normal;font-size:10px;margin-top:3px;white-space:nowrap}
.proj{align-items:flex-end}
.vor{align-items:flex-end;padding:0 var(--s-3);border-radius:var(--r-sm);color:var(--heat-ink)}
.vor .label{color:inherit}
.range .bar{position:relative;height:8px;border-radius:4px;background:var(--surface-2)}
.range .span{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--line-strong)}
.range .med{position:absolute;top:-4px;width:3px;height:16px;border-radius:2px;background:var(--ink);margin-left:-1px}
.range .label{margin-top:7px}
.adp{align-items:flex-start;gap:3px}
.band{position:relative;display:grid;grid-template-columns:52px 1fr auto;align-items:center;column-gap:var(--s-3);
  margin-top:var(--s-4);padding-right:var(--s-4);min-height:56px;border-radius:var(--r-md) var(--r-md) 0 0;
  background:color-mix(in srgb,var(--tier) var(--tier-wash),var(--bg));border-bottom:2px solid var(--tier)}
.band:first-child{margin-top:0}
.band .strip{align-self:stretch;display:grid;place-items:center;background:var(--tier);color:var(--tier-ink);
  border-radius:var(--r-md) 0 0 0;font-weight:800;font-size:var(--t-2xl);line-height:1}
.band .bl{display:flex;align-items:baseline;gap:var(--s-3)}
.band .bl b{font-size:var(--t-lg);font-weight:700}
.band .bl span{color:var(--ink-2);font-size:var(--t-sm)}
.cliff{display:flex;align-items:baseline;gap:8px}
.cliff b{font-family:var(--font-num);font-weight:800;font-size:34px;line-height:1;font-variant-numeric:tabular-nums}
.cliff span{font-size:var(--t-sm);color:var(--ink-2);white-space:nowrap}
.side{display:flex;flex-direction:column;gap:var(--s-4);align-self:start;position:sticky;top:84px}
.side .panel{padding:var(--s-4)}
.side h3{margin:0 0 var(--s-3);font-size:var(--t-md);font-weight:700;display:flex;justify-content:space-between;align-items:baseline}
.side h3 .label{font-weight:500}
.jump{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.jump a{display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:var(--s-2);padding:6px 4px;border-radius:var(--r-sm);
  text-decoration:none;font-size:var(--t-sm)}
.jump a:hover{background:var(--surface-2)}
.jump .n{display:grid;place-items:center;height:22px;border-radius:var(--r-sm);background:var(--tier);color:var(--tier-ink);
  font-family:var(--font-num);font-weight:800;font-size:15px}
.jump .d{font-family:var(--font-num);font-weight:700;font-size:17px;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.sheet-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s-2)}
.sheet-list li{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:var(--s-2);font-size:var(--t-sm)}
.sheet-list .tag{font-size:var(--t-xs);font-weight:700;color:var(--accent-text);text-transform:uppercase;letter-spacing:var(--track-label)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--s-3)}
.tags .chip{height:28px}
.toggle{display:flex;align-items:center;justify-content:space-between;gap:var(--s-2);padding:6px 0;font-size:var(--t-sm);color:var(--ink-2)}
.toggle input{accent-color:var(--accent);width:16px;height:16px}
.basis{display:grid;grid-template-columns:auto 1fr;gap:6px var(--s-3);margin:0;font-size:var(--t-sm)}
.basis dt{color:var(--ink-3)}
.basis dd{margin:0;color:var(--ink)}
@media (max-width: 1180px){
  .board{grid-template-columns:minmax(0,1fr)}
  .side{position:static;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
}
@media (max-width: 960px){
  .grid-row{grid-template-columns:28px 40px minmax(150px,1fr) 84px 124px 140px}
  .range{display:none!important}
}
@media (max-width: 760px){
  .board{padding:var(--s-4);gap:var(--s-4)}
  .lead h2{font-size:34px}
  .grid-row{grid-template-columns:36px minmax(0,1fr) 110px 90px;column-gap:var(--s-2)}
  .thead{display:none}
  .c .label{letter-spacing:0.03em}
  .rk,.proj,.range{display:none!important}
  .row{padding:4px 0}
  .thead{padding:0 0 var(--s-2)}
  .m-proj{display:inline}
  .m-games,.m-team{display:none}
  .pos-group{order:-1}
  .c b{font-size:22px}
  .vor{padding:0 var(--s-2)}
  .gap{font-size:var(--t-xs);padding:0 6px}
  .band{grid-template-columns:40px 1fr;row-gap:2px;padding:6px var(--s-3) 6px 0}
  .band .strip{grid-row:span 2;font-size:30px}
  .band .bl{gap:var(--s-2)}
  .cliff b{font-size:24px}
  .side{grid-template-columns:minmax(0,1fr)}
  .filters{flex-wrap:nowrap;overflow-x:auto;margin-inline:calc(-1 * var(--s-4));padding-inline:var(--s-4);scrollbar-width:none}
}
"""

JS = """
<script>
(function(){
  var views=document.querySelectorAll('[data-view]');
  var chips=document.querySelectorAll('[data-pos]');
  chips.forEach(function(c){c.addEventListener('click',function(){
    chips.forEach(function(o){o.setAttribute('aria-pressed',o===c?'true':'false');});
    views.forEach(function(v){v.hidden=v.getAttribute('data-view')!==c.getAttribute('data-pos');});
    document.querySelectorAll('[data-jump]').forEach(function(j){j.hidden=j.getAttribute('data-jump')!==c.getAttribute('data-pos');});
  });});
  var q=document.getElementById('q');
  q.addEventListener('input',function(){var s=q.value.trim().toLowerCase();
    document.querySelectorAll('.row').forEach(function(r){r.hidden=s&&r.getAttribute('data-name').indexOf(s)<0;});});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});
})();
</script>
"""


def _range_cell(p, lo, hi):
    def pct(x):
        return (x - lo) / (hi - lo) * 100

    return (
        '<span class="c range"><span class="bar">'
        f'<span class="span" style="left:{pct(p["floor"]):.1f}%;width:{pct(p["ceiling"]) - pct(p["floor"]):.1f}%"></span>'
        f'<span class="med" style="left:{pct(p["median"]):.1f}%"></span></span>'
        f'<i class="label">{p["floor"]:.0f} floor to {p["ceiling"]:.0f} ceiling</i></span>'
    )


def board_row(p, lo, hi, show_tier):
    tier = (
        f'<span class="tier-chip {tier_class(p["tier"])}">T{p["tier"]}</span>' if show_tier else ""
    )
    adp = f'ADP {p["adp"]:.1f}' if p["adp"] is not None else "Not in ADP"
    return f"""<div class="row grid-row" data-name="{escape(p['name'].lower())}">
  <span class="rk">{p['our_rank']}</span>{face(p, 40)}
  <span class="who"><a class="name" href="player.html">{escape(p['name'])}</a>
    <span class="meta"><span class="pos">{p['pos']} {p['pos_rank']}</span>{tier}<span class="m-team">{p['team']}</span>
    <span class="m-games">{p['games']:.1f} games</span><span class="m-proj">{p['proj']:.1f} pts</span></span></span>
  <span class="c proj"><b class="num">{p['proj']:.1f}</b><i class="label">PPR pts</i></span>
  <span class="c vor {heat_class(p)}"><b class="num">{signed(p['vor'])}</b><i class="label">over repl{' · rd ' + str(p['vor_round']) if p['vor'] >= 0 and p['vor_round'] <= 4 else ''}</i></span>
  {_range_cell(p, lo, hi)}
  <span class="c adp">{gap_chip(drafters_gap(p))}<i class="label">{adp}</i></span>
</div>"""


def tier_band(pos, tier, cliffs, counts):
    cliff = cliffs.get(tier)
    right = (
        f'<span class="cliff"><b>{cliff["drop"]:.1f}</b><span>PPR pts down to tier {cliff["next"]}</span></span>'
        if cliff
        else '<span class="cliff"><span>Last tier</span></span>'
    )
    return (
        f'<div class="band {tier_class(tier)}" id="{pos.lower()}-tier-{tier}"><span class="strip num">{tier}</span>'
        f'<span class="bl"><b>Tier {tier}</b><span>{counts[tier]} {POS_PLURAL[pos]}</span></span>{right}</div>'
    )


THEAD = """<div class="thead grid-row" aria-hidden="true">
  <span class="rk"></span><span class="fc"></span><span class="label">Player</span><span class="label r proj">Projected</span>
  <span class="label r">Over replacement</span><span class="label range">Floor to ceiling</span><span class="label">Drafters vs us</span>
</div>"""


def _view(players, pos):
    rows = (
        [p for p in players if p["pos"] == pos][:ROWS]
        if pos != "All"
        else players[:ROWS]
    )
    rows = sorted(rows, key=lambda p: p["pos_rank"]) if pos != "All" else rows
    lo = min(p["floor"] for p in rows) // 25 * 25
    hi = max(p["ceiling"] for p in rows)
    parts = [THEAD]
    if pos == "All":
        parts += [board_row(p, lo, hi, show_tier=True) for p in rows]
    else:
        cliffs, counts = tier_cliffs(players, pos)
        current = None
        for p in rows:
            if p["tier"] != current:
                current = p["tier"]
                parts.append(tier_band(pos, current, cliffs, counts))
            parts.append(board_row(p, lo, hi, show_tier=False))
    hidden = "" if pos == DEFAULT_VIEW else " hidden"
    return f'<section data-view="{pos}"{hidden}>{"".join(parts)}</section>'


def _jump(players, pos):
    cliffs, counts = tier_cliffs(players, pos)
    shown = sorted({p["tier"] for p in players if p["pos"] == pos and p["pos_rank"] <= ROWS})
    items = "".join(
        f'<li><a class="{tier_class(t)}" href="#{pos.lower()}-tier-{t}"><span class="n">{t}</span>'
        f'<span>{counts[t]} {POS_PLURAL[pos]}</span>'
        f'<span class="d">{"" if t not in cliffs else "−" + format(cliffs[t]["drop"], ".1f")}</span></a></li>'
        for t in shown
    )
    hidden = "" if pos == DEFAULT_VIEW else " hidden"
    return f'<ul class="jump" data-jump="{pos}"{hidden}>{items}</ul>'


def build(players):
    by_name = {p["name"]: p for p in players}
    views = "".join(_view(players, pos) for pos in ["All"] + POSITIONS)
    jumps = "".join(_jump(players, pos) for pos in POSITIONS)
    sheet = "".join(
        f'<li>{face(by_name[n], 32)}<span>{escape(n)}<br><span class="label">{by_name[n]["pos"]} {by_name[n]["pos_rank"]}</span></span>'
        f'<span class="tag">Target</span></li>'
        for n in SHEET_TARGETS
    )
    pos_chips = "".join(
        f'<button class="chip" type="button" data-pos="{p}" aria-pressed="{"true" if p == DEFAULT_VIEW else "false"}">{p}</button>'
        for p in ["All"] + POSITIONS
    )
    body = f"""<main class="board">
<div class="content" style="min-width:0">
  <div class="lead">
    <div><h2>2026 Board</h2><p>{BASIS_LINE}</p></div>
  </div>
  <div class="filters">
    <div class="chip-group" role="group" aria-label="Scoring">
      <button class="chip" type="button" aria-pressed="true">PPR</button><button class="chip" type="button" aria-pressed="false">Half PPR</button>
      <button class="chip" type="button" aria-pressed="false">Standard</button><button class="chip" type="button" aria-pressed="false">Superflex</button>
    </div>
    <div class="chip-group pos-group" role="group" aria-label="Position">{pos_chips}</div>
  </div>
  {views}
</div>
<aside class="side">
  <div class="panel"><h3>Tiers <span class="label">drop to next</span></h3>{jumps}</div>
  <div class="panel"><h3>Your sheet <span class="label">4 targets</span></h3><ul class="sheet-list">{sheet}</ul>
    <div class="tags"><button class="chip" type="button" aria-pressed="true">Targets</button><button class="chip" type="button" aria-pressed="false">Sleepers</button><button class="chip" type="button" aria-pressed="false">Avoid</button><button class="chip" type="button" aria-pressed="false">Notes</button></div></div>
  <div class="panel"><h3>Show</h3>
    <label class="toggle" for="t-below">Players below replacement<input id="t-below" type="checkbox" checked></label>
    <label class="toggle" for="t-range">Floor to ceiling<input id="t-range" type="checkbox" checked></label>
    <label class="toggle" for="t-sheet">Only my sheet<input id="t-sheet" type="checkbox"></label></div>
  <div class="panel"><h3>Basis</h3><dl class="basis">
    <dt>Scoring</dt><dd>PPR, full 2026 season</dd>
    <dt>Green</dt><dd>The round his points over replacement rank in, among 400</dd>
    <dt>Rose</dt><dd>Below replacement</dd>
    <dt>Drafters</dt><dd>Their ADP against our rank</dd></dl></div>
</aside>
</main>"""
    return page(
        "Commish Board",
        "board",
        "Board",
        '<a class="verb" href="draft.html">Start a mock draft</a>',
        body,
        CSS,
        JS,
    )
