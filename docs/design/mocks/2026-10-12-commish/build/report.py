"""The report after a mock: your lineup and where it stands, every pick with hindsight odds,
and the same draft run 200 more times with your picks on autopick from the board."""
from html import escape

from data import TEAMS_PER_ROUND, adp_or_sentinel, snake_seat
from mock import MY_SEAT, SEED, next_turn
from mocksim import lineup, lineup_points, many_runs, run_draft, standings
from roomparts import ROOM_CSS, last_name, odds_short, pick_label
from shell import face, page, signed
from survival import survival_probabilities

RUNS = 200
WAIT_LINE = 0.6
EXPOSURE_ROWS = 8

REPORT_CSS = """
.report{padding:var(--s-4) var(--s-5) var(--s-7);display:grid;grid-template-columns:minmax(0,1fr) 352px;gap:var(--s-5)}
.hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s-5);align-items:end;padding:var(--s-4) 0 var(--s-5);border-bottom:1px solid var(--line)}
.hero .big b{display:block;font-family:var(--font-num);font-weight:800;font-size:var(--t-3xl);line-height:0.8;font-variant-numeric:tabular-nums}
.hero .big span{display:block;margin-top:8px;font-size:var(--t-sm);color:var(--ink-2);max-width:30ch}
.hero h2{margin:0 0 6px;font-family:var(--font-num);font-weight:800;font-size:38px;line-height:0.95;text-transform:uppercase}
.hero p{margin:0;color:var(--ink-2);max-width:62ch}
.hero .acts{display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-3)}
.sec h3{margin:var(--s-5) 0 var(--s-3);font-family:var(--font-num);font-weight:800;font-size:26px;line-height:1;text-transform:uppercase;display:flex;align-items:baseline;gap:var(--s-3)}
.sec h3 span{font-family:var(--font-ui);font-weight:500;font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3)}
.field{display:flex;flex-direction:column;gap:4px}
.field .t{display:grid;grid-template-columns:28px 120px minmax(0,1fr) 70px;gap:var(--s-2);align-items:center;font-size:var(--t-sm);min-height:26px}
.field .t .n{font-family:var(--font-num);font-weight:700;font-size:16px;color:var(--ink-3)}
.field .t .barw{height:16px;background:var(--surface-2);border-radius:3px;overflow:hidden}
.field .t .barw i{display:block;height:100%;background:var(--ink-3)}
.field .t.you{font-weight:600}
.field .t.you .barw i{background:var(--accent)}
.field .t .pts{font-family:var(--font-num);font-weight:700;font-size:18px;text-align:right;font-variant-numeric:tabular-nums}
.picks{display:flex;flex-direction:column}
.pk{display:grid;grid-template-columns:52px 36px minmax(0,1fr) 112px 150px 150px;gap:var(--s-3);align-items:center;min-height:var(--row-h);padding:4px 0;border-bottom:1px solid var(--line);font-size:var(--t-sm)}
.pk.head{min-height:0;padding-bottom:var(--s-2);border-bottom:1px solid var(--line-strong)}
.pk .no{font-family:var(--font-num);font-weight:700;font-size:20px;color:var(--ink-2)}
.pk .who{min-width:0}.pk .who b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk .who span{color:var(--ink-3);font-size:var(--t-xs)}
.pk .vor{font-family:var(--font-num);font-weight:700;font-size:20px;text-align:right;font-variant-numeric:tabular-nums}
.tagc{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:var(--r-sm);font-size:var(--t-xs);font-weight:600;white-space:nowrap}
.tagc.ok{background:var(--gain-bg);color:var(--gain-ink)}
.tagc.wait{background:var(--loss-bg);color:var(--loss-ink)}
.tagc.even{background:var(--surface-2);color:var(--ink-2)}
.hist{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;align-items:end;height:120px;margin-top:var(--s-2)}
.hist i{display:block;background:var(--ink-3);border-radius:2px 2px 0 0;min-height:2px}
.hist i.med{background:var(--accent)}
.hist-x{display:flex;justify-content:space-between;font-size:var(--t-xs);color:var(--ink-3);margin-top:4px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-3);margin-top:var(--s-3)}
.stat{padding:var(--s-3);border:1px solid var(--line);border-radius:var(--r-md)}
.stat b{display:block;font-family:var(--font-num);font-weight:800;font-size:34px;line-height:0.9;font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:6px;font-size:var(--t-xs);color:var(--ink-3)}
.expo{display:flex;flex-direction:column;gap:6px}
.expo .e{display:grid;grid-template-columns:32px minmax(0,1fr) 110px 48px;gap:var(--s-2);align-items:center;font-size:var(--t-sm)}
.expo .e b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.expo .e .barw{height:8px;background:var(--surface-2);border-radius:3px;overflow:hidden}
.expo .e .barw i{display:block;height:100%;background:var(--ink-2)}
.expo .e .pct{font-family:var(--font-num);font-weight:700;font-size:18px;text-align:right}
.basis{font-size:var(--t-xs);color:var(--ink-3);margin-top:var(--s-3);max-width:70ch}
.ranks{display:flex;gap:4px;margin-top:var(--s-3)}
.ranks span{flex:1;text-align:center;font-size:var(--t-xs);color:var(--ink-3)}
.ranks span b{display:block;font-family:var(--font-num);font-weight:700;font-size:18px;color:var(--ink)}
.ranks span.you b{color:var(--accent-text)}
@media (max-width: 1180px){.report{grid-template-columns:minmax(0,1fr) 300px}.pk{grid-template-columns:48px 36px minmax(0,1fr) 90px 130px}.pk .gapc{display:none}}
@media (max-width: 760px){
  .report{grid-template-columns:minmax(0,1fr);padding:var(--s-3) var(--s-4) var(--s-6)}
  .hero{grid-template-columns:minmax(0,1fr);gap:var(--s-3)}
  .hero .big b{font-size:64px}.hero h2{font-size:28px}
  .pk{grid-template-columns:44px 32px minmax(0,1fr) 70px}.pk .hind,.pk .gapc{display:none}
  .stats{grid-template-columns:1fr 1fr}
}
"""


def gap_tag(p, n):
    if p["adp"] is None:
        return '<span class="tagc even">no ADP</span>'
    d = round(p["adp"] - n)
    if abs(d) < 3:
        return '<span class="tagc even">at ADP</span>'
    return f'<span class="tagc {"wait" if d > 0 else "ok"}">{abs(d)} {"before" if d > 0 else "after"} drafters</span>'


def hind_tag(odds):
    if odds is None:
        return '<span class="tagc even">last pick</span>'
    if odds >= WAIT_LINE:
        return f'<span class="tagc wait">could wait, {odds_short(odds)} there next turn</span>'
    return f'<span class="tagc ok">right on time, {odds_short(odds)} there next turn</span>'


def pick_rows(players, picks):
    rows = []
    for pk in picks:
        if pk["seat"] != MY_SEAT:
            continue
        n = pk["no"]
        p = pk["player"]
        taken_before = {id(q["player"]) for q in picks[: n - 1]}
        pool = [q for q in players if id(q) not in taken_before]
        nxt = next_turn(n, MY_SEAT)
        odds = survival_probabilities(pool, n, nxt, adp_or_sentinel)[p["id"]] if nxt <= len(picks) else None
        rows.append(f"""<div class="pk"><span class="no">{pick_label(n)}</span>{face(p, 36)}
  <span class="who"><b>{escape(p['name'])}</b><span>{p['pos']} {p['pos_rank']} · {p['team']}</span></span>
  <span class="vor">{signed(p['vor'])}</span><span class="gapc">{gap_tag(p, n)}</span><span class="hind">{hind_tag(odds)}</span></div>""")
    return "".join(rows)


def field_rows(table, rosters):
    top = table[0][0]
    out = []
    for i, (pts, seat) in enumerate(table, start=1):
        name = "You" if seat == MY_SEAT else f"Bot {seat if seat < MY_SEAT else seat - 1}"
        out.append(f'<div class="t{" you" if seat == MY_SEAT else ""}"><span class="n">{i}</span><span>{name}</span><span class="barw"><i style="width:{pts / top * 100:.1f}%"></i></span><span class="pts">{pts:,.0f}</span></div>')
    return "".join(out)


def histogram(points, med):
    lo, hi = min(points), max(points)
    width = (hi - lo) / 12 or 1
    bins = [0] * 12
    for x in points:
        bins[min(11, int((x - lo) / width))] += 1
    peak = max(bins)
    med_bin = min(11, int((med - lo) / width))
    bars = "".join(f'<i class="{"med" if i == med_bin else ""}" style="height:{b / peak * 100:.0f}%" title="{b} runs"></i>' for i, b in enumerate(bins))
    return f'<div class="hist">{bars}</div><div class="hist-x"><span>{lo:,.0f}</span><span>median {med:,.0f}</span><span>{hi:,.0f}</span></div>'


def exposure_rows(players, exposure, n):
    by_id = {p["id"]: p for p in players}
    out = []
    for pid, count in exposure.most_common(EXPOSURE_ROWS):
        p = by_id[pid]
        pct = count / n * 100
        out.append(f'<div class="e">{face(p, 32)}<b>{escape(p["name"])} <span class="label">{p["pos"]} {p["pos_rank"]}</span></b><span class="barw"><i style="width:{pct:.0f}%"></i></span><span class="pct">{pct:.0f}%</span></div>')
    return "".join(out)


def build(players):
    picks, rosters, _ = run_draft(players, MY_SEAT, SEED)
    table = standings(rosters)
    my_pts = lineup_points(rosters[MY_SEAT])
    my_rank = next(i for i, (_, s) in enumerate(table, start=1) if s == MY_SEAT)
    best_other = max(pts for pts, s in table if s != MY_SEAT)
    runs = many_runs(players, MY_SEAT, range(1, RUNS + 1))
    rank_cells = "".join(f'<span{" class=you" if r == my_rank else ""}><b>{runs["rank_counts"].get(r, 0)}</b>{r}{"st" if r == 1 else "nd" if r == 2 else "rd" if r == 3 else "th"}</span>' for r in range(1, 7))
    mine_slots = lineup(rosters[MY_SEAT])
    starters = ", ".join(f"{slot} {last_name(p['name'])}" for slot, p in mine_slots if p)
    body = f"""<main class="report">
<div class="content">
  <div class="hero">
    <div class="big"><b>{my_pts:,.0f}</b><span>projected points from your starters, {my_rank}{"st" if my_rank == 1 else "nd" if my_rank == 2 else "rd" if my_rank == 3 else "th"} of 12, the next team at {best_other:,.0f}</span></div>
    <div><h2>Your draft from slot {MY_SEAT}</h2>
      <p>12 teams, PPR, 14 rounds, bots drafting from where drafters take players. Starters: {starters}. Points are our projections, the same numbers the board ranks by, so a team drafted off the board should lead this table. The useful read is how far ahead, and where it came from.</p>
      <div class="acts"><a class="verb" href="mock.html">Run it again from slot {MY_SEAT}</a><a class="quiet" href="setup.html">Try another slot</a><button class="quiet" type="button">Save this draft as a sheet</button><button class="quiet" type="button">Copy a share link</button></div>
    </div>
  </div>
  <section class="sec"><h3>The field <span>projected starting points, 12 teams</span></h3><div class="field">{field_rows(table, rosters)}</div></section>
  <section class="sec"><h3>Pick by pick <span>what you took, what drafters do, and whether he would have lasted</span></h3>
    <div class="picks"><div class="pk head"><span class="label">Pick</span><span></span><span class="label">Player</span><span class="label r">Over repl</span><span class="label gapc">Against ADP</span><span class="label hind">Hindsight</span></div>{pick_rows(players, picks)}</div>
    <p class="basis">Hindsight odds are the chance he was still there at your next turn, from where drafters take everyone who was still in the pool at that pick. "Could wait" starts at {WAIT_LINE:.0%}.</p>
  </section>
  <section class="sec"><h3>The same draft, {RUNS} more times <span>your picks on autopick from the board, the bots reshuffled each run</span></h3>
    {histogram(runs['points'], runs['median'])}
    <div class="stats"><div class="stat"><b>{runs['median']:,.0f}</b><span>median starting points</span></div><div class="stat"><b>{runs['p10']:,.0f} to {runs['p90']:,.0f}</b><span>the middle 80% of runs</span></div><div class="stat"><b>{runs['top3']:.0%}</b><span>of runs finish top 3 of 12</span></div></div>
    <div class="ranks">{rank_cells}</div>
    <p class="basis">Bots pick from ADP with the same spread the survival odds use, so these {RUNS} runs and the odds you saw in the room describe one world. A bot that reaches or hunts a position would widen the band. Seeds 1 to {RUNS}.</p>
  </section>
</div>
<aside class="dock">
  <div class="team panel"><h3>Who you end up with <span>share of {RUNS} runs</span></h3><div class="expo">{exposure_rows(players, runs['exposure'], runs['n'])}</div>
    <div class="need">Every player you land in more than half the runs from slot {MY_SEAT} is a player to know cold.</div></div>
</aside>
</main>"""
    return page("Commish Mock Report", "mock", "Mock draft", '<a class="quiet" href="setup.html">New mock</a>', body, ROOM_CSS + REPORT_CSS)
