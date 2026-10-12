"""Parts every mock screen shares: the room CSS, pool rows, the wall, your team by slot, the pick label."""
from html import escape

from data import TEAMS_PER_ROUND, heat_class, snake_seat
from mocksim import STARTERS, lineup
from shell import face, signed

ROOM_CSS = """
.room{display:grid;grid-template-columns:minmax(0,1fr) 352px;gap:var(--s-5);padding:var(--s-4) var(--s-5) var(--s-6)}
.content{min-width:0;display:flex;flex-direction:column;gap:var(--s-4)}
.dock{display:flex;flex-direction:column;gap:var(--s-4);align-self:start;position:sticky;top:84px}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-3) var(--s-4);min-height:48px}
.bar .where{display:flex;align-items:baseline;gap:var(--s-2);white-space:nowrap}
.bar .where b{font-family:var(--font-num);font-weight:800;font-size:30px;line-height:1;text-transform:uppercase}
.bar .where span{font-size:var(--t-sm);color:var(--ink-2)}
.bar .you-next{display:flex;align-items:baseline;gap:6px;white-space:nowrap;color:var(--ink-2);font-size:var(--t-sm)}
.bar .you-next b{font-family:var(--font-num);font-weight:700;font-size:22px;line-height:1;color:var(--ink)}
.bar .acts{margin-left:auto;display:flex;flex-wrap:wrap;gap:var(--s-2)}
.quiet kbd{font-family:var(--font-ui);font-size:10px;border:1px solid var(--line-strong);border-radius:3px;padding:0 5px;color:var(--ink-3)}
.since{display:flex;align-items:center;gap:var(--s-3);padding:var(--s-3) var(--s-4);overflow-x:auto}
.since .lead{flex:none;display:flex;flex-direction:column;gap:2px;padding-right:var(--s-3);border-right:1px solid var(--line)}
.since .lead b{font-family:var(--font-num);font-weight:800;font-size:26px;line-height:1}
.since .lead span{font-size:var(--t-xs);color:var(--ink-3);white-space:nowrap}
.since .run{display:flex;gap:var(--s-2)}
.since .went{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;width:58px;font-size:10px;color:var(--ink-3);text-align:center}
.since .went b{font-weight:600;color:var(--ink);white-space:nowrap;max-width:58px;overflow:hidden;text-overflow:ellipsis;font-size:11px}
.since .went.queued .face{box-shadow:0 0 0 2px var(--accent)}
.since .went.queued span{color:var(--accent-text);font-weight:600}
.call{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--s-4);align-items:center;padding:var(--s-4);
  border-left:4px solid var(--accent)}
.call .tag{display:block;font-size:var(--t-xs);font-weight:700;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--accent-text);margin-bottom:4px}
.call h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:38px;line-height:0.95;text-transform:uppercase;text-wrap:balance}
.call .meta{display:flex;gap:6px;align-items:center;font-size:var(--t-sm);color:var(--ink-2);margin:6px 0 8px}
.call p{margin:0;font-size:var(--t-md);color:var(--ink-2);max-width:60ch}
.call p b{color:var(--ink);font-weight:600}
.call .odds-big{display:flex;flex-direction:column;align-items:flex-end;gap:var(--s-2);text-align:right}
.call .odds-big b{font-family:var(--font-num);font-weight:800;font-size:72px;line-height:0.8;font-variant-numeric:tabular-nums}
.call .odds-big span{font-size:var(--t-sm);color:var(--ink-2);max-width:22ch}
.call .verb{height:46px;min-width:200px}
.call .verb kbd{font-family:var(--font-ui);font-size:10px;border:1px solid rgba(255,255,255,.5);border-radius:3px;padding:0 5px;opacity:.9}
.pool-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-3)}
.pool-head h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:30px;line-height:1;text-transform:uppercase}
.pool-head .chips{margin-left:auto}
.prow{display:grid;grid-template-columns:40px minmax(0,1fr) 118px 136px 118px 150px;align-items:center;column-gap:var(--s-3);
  min-height:var(--row-h);padding:4px var(--s-3);border-bottom:1px solid var(--line)}
.prow.head{min-height:0;padding-bottom:var(--s-2);border-bottom:1px solid var(--line-strong)}
.prow.call-row{background:var(--accent-wash)}
.prow .who{min-width:0;display:flex;flex-direction:column;gap:2px}
.prow .who b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .meta{display:flex;gap:6px;align-items:center;font-size:var(--t-sm);color:var(--ink-3)}
.prow .acts{display:flex;gap:6px;justify-content:flex-end}
.prow .acts .quiet{height:34px;padding:0 10px}
.c{display:flex;flex-direction:column;justify-content:center;align-items:flex-end;height:calc(var(--row-h) - 8px);padding:0 var(--s-3);border-radius:var(--r-sm)}
.c b{font-family:var(--font-num);font-weight:700;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.c .label{font-size:10px;margin-top:3px;white-space:nowrap}
.vor{color:var(--heat-ink)}.vor .label{color:inherit}
.odds{align-items:stretch}
.odds .ot{display:flex;justify-content:space-between;align-items:baseline}
.odds .meter{height:5px;border-radius:3px;background:var(--surface-2);margin-top:5px;overflow:hidden}
.odds .meter i{display:block;height:100%;background:var(--ink-2)}
.r{text-align:right}
.wall-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface)}
.wall{display:grid;grid-template-columns:24px repeat(12,minmax(0,1fr));min-width:860px}
.wall .h{padding:8px 6px;font-size:var(--t-xs);font-weight:600;color:var(--ink-3);border-bottom:1px solid var(--line);
  text-transform:uppercase;letter-spacing:var(--track-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wall .h.you{color:var(--accent-text)}
.wall .rd{display:grid;place-items:center;font-family:var(--font-num);font-weight:700;font-size:18px;color:var(--ink-3);border-bottom:1px solid var(--line)}
.cell{display:grid;grid-template-columns:22px minmax(0,1fr);grid-template-rows:auto auto;column-gap:5px;row-gap:3px;align-items:center;
  padding:6px;min-height:54px;min-width:0;border-bottom:1px solid var(--line);border-left:1px solid var(--line);font-size:12.5px}
.cell b{grid-column:1 / -1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell span.s{font-size:10px;color:var(--ink-3);white-space:nowrap}
.cell.mine{background:var(--accent-wash);box-shadow:inset 3px 0 0 var(--accent)}
.cell.now{display:flex;flex-direction:column;justify-content:center;gap:2px;outline:2px dashed var(--accent);outline-offset:-4px;
  background:var(--accent-wash);color:var(--accent-text);font-weight:700}
.cell.now span{font-size:10px;font-weight:500}
.cell.empty{color:var(--ink-3)}
.team{padding:var(--s-4)}
.team h3{margin:0 0 var(--s-3);font-size:var(--t-md);display:flex;justify-content:space-between;align-items:baseline}
.team h3 span{font-size:var(--t-xs);color:var(--ink-3);font-weight:500}
.team ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.team li{display:grid;grid-template-columns:40px 32px 1fr auto;gap:var(--s-2);align-items:center;font-size:var(--t-sm);min-height:32px}
.team li .slot{font-size:var(--t-xs);font-weight:700;letter-spacing:0.04em;color:var(--ink-3)}
.team li.open{color:var(--ink-3)}
.team li.open .slot{color:var(--accent-text)}
.team li .hole{grid-column:2 / span 2;height:28px;border:1px dashed var(--line-strong);border-radius:var(--r-sm)}
.team li .pk{font-family:var(--font-num);font-weight:700;font-size:16px;color:var(--ink-2)}
.team .need{margin-top:var(--s-3);padding-top:var(--s-3);border-top:1px solid var(--line);font-size:var(--t-sm);color:var(--ink-2)}
.team .need b{color:var(--ink)}
.keys{padding:var(--s-3) var(--s-4);display:grid;grid-template-columns:auto 1fr;gap:4px var(--s-3);font-size:var(--t-sm);color:var(--ink-2);align-items:center}
.keys kbd{font-family:var(--font-ui);font-size:11px;border:1px solid var(--line-strong);border-radius:4px;padding:1px 7px;color:var(--ink);justify-self:start}
.seed{font-size:var(--t-xs);color:var(--ink-3);padding:0 var(--s-1)}
@media (max-width: 1180px){.room{grid-template-columns:minmax(0,1fr) 300px}.prow{grid-template-columns:40px minmax(0,1fr) 108px 126px 108px 44px}.prow .acts .q{display:none}}
@media (max-width: 760px){
  .room{grid-template-columns:minmax(0,1fr);padding:var(--s-3) var(--s-4) var(--s-5);gap:var(--s-3)}
  .dock{position:static}
  .bar .acts{margin-left:0;width:100%}
  .call{grid-template-columns:auto minmax(0,1fr);row-gap:var(--s-3);padding:var(--s-3)}
  .call h2{font-size:28px}
  .call .odds-big{grid-column:1 / -1;flex-direction:row;flex-wrap:wrap;align-items:flex-end;justify-content:flex-start;gap:var(--s-3);text-align:left}
  .call .odds-big b{font-size:56px}
  .call .odds-big span{flex:1;min-width:0}
  .call .verb{min-width:0;flex-basis:100%}
  .since{padding:var(--s-3)}
  .prow{grid-template-columns:36px minmax(0,1fr) 84px 84px;padding:4px 0;column-gap:var(--s-2)}
  .prow .gapc,.prow .acts{display:none}
  .c{padding:0 var(--s-2);height:auto;min-height:calc(var(--row-h) - 8px)}
  .c b{font-size:20px}
  .c .label{white-space:normal;text-align:right;line-height:1.1}
  .keys{display:none}
}
"""

SLOT_ORDER = [("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("FLEX", 1)]


def last_name(name):
    parts = name.split(" ")
    tail = parts[-1]
    return parts[-2] if tail in ("Jr.", "II", "III", "IV") and len(parts) > 2 else tail


def pick_label(n):
    rnd, _ = snake_seat(n)
    return f"{rnd}.{(n - 1) % TEAMS_PER_ROUND + 1:02d}"


def odds_short(odds):
    if odds < 0.005:
        return "<1%"
    if odds > 0.995:
        return ">99%"
    return f"{odds * 100:.0f}%"


def odds_words(odds):
    return odds_short(odds).replace("<", "under ").replace(">", "over ")


def gap_words(p, pick_no):
    if p["adp"] is None:
        return "no ADP yet"
    d = round(p["adp"] - pick_no)
    if d == 0:
        return "drafters take him here"
    return f"drafters take him {abs(d)} {'later' if d > 0 else 'earlier'}"


def pool_row(p, odds, next_label, is_call, pick_no):
    pct = round(odds * 100)
    return f"""<div class="prow{' call-row' if is_call else ''}">
  {face(p, 40)}
  <span class="who"><b>{escape(p['name'])}</b><span class="meta"><span class="pos">{p['pos']} {p['pos_rank']}</span>{p['team']}</span></span>
  <span class="c vor {heat_class(p)}"><b>{signed(p['vor'])}</b><i class="label">over repl</i></span>
  <span class="c odds"><span class="ot"><b>{odds_short(odds)}</b></span><span class="meter"><i style="width:{pct}%"></i></span><i class="label">still there at {next_label}</i></span>
  <span class="gapc label r">{gap_words(p, pick_no)}</span>
  <span class="acts"><button class="quiet q" type="button">Queue</button><button class="quiet" type="button">Draft</button></span>
</div>"""


def wall(picks, my_seat, now_pick, rounds, seat_names=None):
    by_slot = {(snake_seat(pk["no"])[0], pk["seat"]): pk for pk in picks}
    names = seat_names or {s: ("You" if s == my_seat else f"Bot {s if s < my_seat else s - 1}") for s in range(1, TEAMS_PER_ROUND + 1)}
    heads = '<span class="h"></span>' + "".join(
        f'<span class="h{" you" if s == my_seat else ""}">{escape(names[s])}</span>' for s in range(1, TEAMS_PER_ROUND + 1)
    )
    now_rnd, now_seat = snake_seat(now_pick)
    cells = []
    for rnd in range(1, rounds + 1):
        cells.append(f'<span class="rd">{rnd}</span>')
        for seat in range(1, TEAMS_PER_ROUND + 1):
            pk = by_slot.get((rnd, seat))
            if pk:
                p = pk["player"]
                cls = "cell mine" if seat == my_seat else "cell"
                cells.append(f'<span class="{cls}">{face(p, 22)}<span class="s">{p["pos"]} · {p["team"]}</span><b>{escape(last_name(p["name"]))}</b></span>')
            elif (rnd, seat) == (now_rnd, now_seat):
                who = "Your pick" if seat == my_seat else "On the clock"
                cells.append(f'<span class="cell now">{who}<span>{pick_label(now_pick)}</span></span>')
            else:
                cells.append('<span class="cell empty"></span>')
    return f'<div class="wall-wrap"><div class="wall">{heads}{"".join(cells)}</div></div>'


def team_panel(my_picks, title="Your team", bench_rows=True):
    roster = [pk["player"] for pk in my_picks]
    by_player = {id(pk["player"]): pk["no"] for pk in my_picks}
    slots = lineup(roster)
    rows = []
    started = set()
    for slot, p in slots:
        if p:
            started.add(id(p))
            rows.append(f'<li><span class="slot">{slot}</span>{face(p, 32)}<span>{escape(p["name"])}<br><span class="label">{p["pos"]} {p["pos_rank"]} · {p["team"]}</span></span><span class="pk">{pick_label(by_player[id(p)])}</span></li>')
        else:
            rows.append(f'<li class="open"><span class="slot">{slot}</span><span class="hole"></span><span class="label">open</span></li>')
    bench = [p for p in roster if id(p) not in started]
    if bench_rows:
        for p in bench:
            rows.append(f'<li><span class="slot">BN</span>{face(p, 32)}<span>{escape(p["name"])}<br><span class="label">{p["pos"]} {p["pos_rank"]} · {p["team"]}</span></span><span class="pk">{pick_label(by_player[id(p)])}</span></li>')
    missing = [slot for slot, p in slots if p is None and slot != "FLEX"]
    need = f'<div class="need">Still open: <b>{", ".join(missing)}</b>. The board already weighs that in the call.</div>' if missing else '<div class="need">Every starter filled. From here the call is depth.</div>'
    return f'<div class="team panel"><h3>{title}<span>{len(roster)} of 14</span></h3><ol>{"".join(rows)}</ol>{need}</div>'


KEYS = """<div class="keys panel"><kbd>Enter</kbd><span>draft our call</span><kbd>↑ ↓</kbd><span>move through the pool</span>
<kbd>Q</kbd><span>queue the player</span><kbd>U</kbd><span>undo your last pick</span><kbd>/</kbd><span>search the pool</span></div>"""
