from html import escape

from data import TEAMS_PER_ROUND, adp_or_sentinel, heat_class, simulate_draft, snake_seat
from survival import survival_probabilities
from shell import face, page, signed

MY_SEAT = 8
ON_CLOCK = 56
ROUNDS_SHOWN = 5
POOL_ROWS = 14
CLOCK = "0:41"

BORROWED_CSS = """
/* Borrowed from Broadcast, draft room only, only while a draft is live: the score bug and the
   lower third. Restyled onto Press Box: the scoreboard tokens, Big Shoulders numbers, small radii. */
.bug{display:flex;align-items:stretch;min-height:68px;margin-bottom:var(--s-4);border-radius:var(--r-md);overflow:hidden;
  background:var(--scoreboard);color:var(--scoreboard-ink);border:1px solid var(--line)}
.bug > div{display:flex;flex-direction:column;justify-content:center;gap:3px;padding:0 var(--s-5);border-right:1px solid var(--scoreboard-line);white-space:nowrap}
.bug > div:last-child{border-right:0}
.bug small{font-size:var(--t-xs);font-weight:600;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--scoreboard-ink-2)}
.bug b{font-family:var(--font-num);font-weight:800;font-size:var(--t-xl);line-height:1;text-transform:uppercase;font-variant-numeric:tabular-nums}
.bug .brand{flex-direction:row;align-items:center;gap:var(--s-3);background:var(--scoreboard-2)}
.bug .brand .c-mark{font-family:var(--font-num);font-weight:800;font-size:30px;line-height:1;border-bottom:3px solid var(--scoreboard-num);padding-bottom:1px}
.bug .grow{flex:1}
.bug .you b{color:var(--scoreboard-num)}
.bug .clock{align-items:center;min-width:132px}
.bug .clock b{font-size:var(--t-2xl);color:var(--scoreboard-num);line-height:0.85}
.lower{position:sticky;bottom:0;z-index:4;margin-top:var(--s-5);padding-top:34px}
.lt{position:relative;display:grid;grid-template-columns:168px minmax(0,1fr) auto;align-items:end;
  color:var(--scoreboard-ink);border-radius:var(--r-md) var(--r-md) 0 0}
.lt::before{content:"";position:absolute;inset:34px 0 0 0;background:var(--scoreboard);border-radius:var(--r-md) var(--r-md) 0 0}
.lt .cut{position:relative;width:168px;height:150px;overflow:hidden;align-self:end;border-radius:var(--r-md) 0 0 0}
.lt .cut::before{content:"";position:absolute;inset:34px 0 0 0;background:var(--scoreboard-2)}
.lt .cut img{position:absolute;left:50%;bottom:0;width:190px;max-width:none;transform:translateX(-50%)}
.lt .copy{position:relative;display:flex;flex-direction:column;gap:6px;padding:var(--s-5) var(--s-5) var(--s-4);min-width:0}
.lt .tag{align-self:flex-start;border:1px solid var(--scoreboard-num);color:var(--scoreboard-num);border-radius:var(--r-sm);
  padding:3px 8px;font-size:var(--t-xs);font-weight:700;letter-spacing:var(--track-label);text-transform:uppercase}
.lt h3{margin:0;font-family:var(--font-num);font-weight:800;font-size:var(--t-2xl);line-height:0.9;text-transform:uppercase;text-wrap:balance}
.lt .meta{display:flex;gap:6px;align-items:center;font-size:var(--t-sm);color:var(--scoreboard-ink-2)}
.lt .meta .pos{background:var(--scoreboard-2);color:var(--scoreboard-ink)}
.lt p{margin:0;font-size:var(--t-md);color:var(--scoreboard-ink-2);max-width:56ch}
.lt p b{color:var(--scoreboard-ink);font-weight:600}
.lt .odds-big{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:var(--s-2);
  padding:var(--s-5) var(--s-5) var(--s-4);border-left:1px solid var(--scoreboard-line);align-self:stretch;justify-content:flex-end;margin-top:34px}
.lt .odds-big b{font-family:var(--font-num);font-weight:800;font-size:var(--t-3xl);line-height:0.8;color:var(--scoreboard-num);font-variant-numeric:tabular-nums}
.lt .odds-big span{font-size:var(--t-sm);color:var(--scoreboard-ink-2);max-width:26ch}
.lt .verb{background:var(--scoreboard-num);color:var(--scoreboard-num-ink);width:100%;height:48px;margin-top:var(--s-2)}
.lt-basis{padding:8px var(--s-5) 10px;font-size:var(--t-xs);color:var(--scoreboard-ink-2);background:var(--scoreboard);
  border-top:1px solid var(--scoreboard-line);border-radius:0 0 var(--r-md) var(--r-md)}
@media (max-width: 760px){
  .bug{min-height:56px;margin-bottom:var(--s-3)}
  .bug > div{padding:0 var(--s-3)}
  .bug .brand,.bug .opt{display:none}
  .bug b{font-size:var(--t-lg)}
  .bug .clock{min-width:84px}
  .bug .clock b{font-size:34px}
  .lower{padding-top:0}
  .lt::before,.lt .cut::before{inset:0}
  .lt{grid-template-columns:104px minmax(0,1fr);align-items:stretch}
  .lt .cut{width:104px;height:112px}
  .lt .cut img{width:124px}
  .lt .copy{padding:var(--s-4) var(--s-3) var(--s-3)}
  .lt h3{font-size:30px}
  .lt .odds-big{grid-column:1 / -1;margin-top:0;border-left:0;border-top:1px solid var(--scoreboard-line);
    flex-direction:row;flex-wrap:wrap;align-items:flex-end;padding:var(--s-3) var(--s-4) var(--s-4)}
  .lt .odds-big b{font-size:64px}
  .lt .odds-big span{flex:1;min-width:0}
  .lt-basis{padding:6px var(--s-4) 8px}
}
"""

ROOM_CSS = """
.room{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:var(--s-5);padding:var(--s-5)}
.strip-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s-3);margin-bottom:var(--s-3)}
.strip-head h2{margin:0;font-family:var(--font-num);font-weight:800;font-size:34px;line-height:1;text-transform:uppercase}
.strip-head span{color:var(--ink-2);font-size:var(--t-sm)}
.wall-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface)}
.wall{display:grid;grid-template-columns:24px repeat(12,minmax(0,1fr));min-width:860px}
.wall .h{padding:8px 6px;font-size:var(--t-xs);font-weight:600;color:var(--ink-3);border-bottom:1px solid var(--line);
  text-transform:uppercase;letter-spacing:var(--track-label);white-space:nowrap}
.wall .h.you{color:var(--accent-text)}
.wall .rd{display:grid;place-items:center;font-family:var(--font-num);font-weight:700;font-size:18px;color:var(--ink-3);border-bottom:1px solid var(--line)}
.cell{display:grid;grid-template-columns:22px minmax(0,1fr);grid-template-rows:auto auto;column-gap:5px;row-gap:3px;align-items:center;
  padding:6px;min-height:54px;min-width:0;border-bottom:1px solid var(--line);border-left:1px solid var(--line);font-size:12.5px}
.cell b{grid-column:1 / -1}
.cell b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell span.s{font-size:10px;color:var(--ink-3);white-space:nowrap}
.cell.mine{background:var(--accent-wash);box-shadow:inset 3px 0 0 var(--accent)}
.cell.clock{display:flex;flex-direction:column;justify-content:center;gap:2px;outline:2px dashed var(--accent);outline-offset:-4px;
  background:var(--accent-wash);color:var(--accent-text);font-weight:700}
.cell.clock span{font-size:10px;font-weight:500}
.cell.empty{color:var(--ink-3)}
.pool{margin-top:var(--s-5)}
.pool .chips{margin-bottom:var(--s-3)}
.prow{display:grid;grid-template-columns:40px minmax(0,1fr) 128px 132px 92px;align-items:center;column-gap:var(--s-3);
  min-height:var(--row-h);padding:4px var(--s-3);border-bottom:1px solid var(--line)}
.prow.head{min-height:0;padding-bottom:var(--s-2)}
.prow.call{background:var(--accent-wash)}
.prow .who{min-width:0;display:flex;flex-direction:column;gap:2px}
.prow .who b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .meta{display:flex;gap:6px;align-items:center;font-size:var(--t-sm);color:var(--ink-3)}
.c{display:flex;flex-direction:column;justify-content:center;align-items:flex-end;height:calc(var(--row-h) - 8px);padding:0 var(--s-3);border-radius:var(--r-sm)}
.c b{font-family:var(--font-num);font-weight:700;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.c .label{font-size:10px;margin-top:3px;white-space:nowrap}
.vor{color:var(--heat-ink)}.vor .label{color:inherit}
.odds{align-items:stretch}
.odds .ot{display:flex;justify-content:space-between;align-items:baseline}
.odds .meter{height:5px;border-radius:3px;background:var(--surface-2);margin-top:5px;overflow:hidden}
.odds .meter i{display:block;height:100%;background:var(--ink-2)}
.r{text-align:right}
.dock{display:flex;flex-direction:column;gap:var(--s-4);align-self:start;position:sticky;top:84px}
.content{min-width:0;display:flex;flex-direction:column}
.mine-list{padding:var(--s-4)}
.mine-list h3{margin:0 0 var(--s-3);font-size:var(--t-md)}
.mine-list ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s-2)}
.mine-list li{display:grid;grid-template-columns:32px 1fr auto;gap:var(--s-2);align-items:center;font-size:var(--t-sm)}
.mine-list li .num{font-weight:700;font-size:18px;color:var(--ink-2)}
@media (max-width: 1180px){.room{grid-template-columns:minmax(0,1fr) 300px}.bug .opt{display:none}}
@media (max-width: 760px){
  .room{grid-template-columns:minmax(0,1fr);padding:var(--s-4);gap:var(--s-4)}
  .dock{position:static}
  .content > .bug{order:-2}
  .content > .lower{order:-1;position:static;margin:0 0 var(--s-4)}
  .prow{grid-template-columns:36px minmax(0,1fr) 84px 84px;padding:4px 0;column-gap:var(--s-2)}
  .prow .q{display:none}
  .c{padding:0 var(--s-2)}
  .c b{font-size:20px}
  .mine-list{display:none}
}
"""


def _last(name):
    parts = name.split(" ")
    tail = parts[-1]
    return parts[-2] if tail in ("Jr.", "II", "III", "IV") and len(parts) > 2 else tail


def _wall(picks):
    by_slot = {(snake_seat(pk["no"])[0], pk["seat"]): pk for pk in picks}
    heads = '<span class="h"></span>' + "".join(
        f'<span class="h{" you" if s == MY_SEAT else ""}">{"You" if s == MY_SEAT else f"Bot {s if s < MY_SEAT else s - 1}"}</span>'
        for s in range(1, TEAMS_PER_ROUND + 1)
    )
    clock_rnd, clock_seat = snake_seat(ON_CLOCK)
    cells = []
    for rnd in range(1, ROUNDS_SHOWN + 1):
        cells.append(f'<span class="rd">{rnd}</span>')
        for seat in range(1, TEAMS_PER_ROUND + 1):
            pk = by_slot.get((rnd, seat))
            if pk:
                p = pk["player"]
                cls = "cell mine" if seat == MY_SEAT else "cell"
                cells.append(
                    f'<span class="{cls}">{face(p, 22)}<span class="s">{p["pos"]} · {p["team"]}</span>'
                    f'<b>{escape(_last(p["name"]))}</b></span>'
                )
            elif (rnd, seat) == (clock_rnd, clock_seat):
                cells.append(f'<span class="cell clock">On the clock<span>{rnd}.{(ON_CLOCK - 1) % 12 + 1:02d}</span></span>')
            else:
                cells.append('<span class="cell empty"></span>')
    return f'<div class="wall-wrap"><div class="wall">{heads}{"".join(cells)}</div></div>'


def odds_short(odds):
    """The model is closed form, so it can print 0 or 1. Say it the way the advisor would."""
    if odds < 0.005:
        return "<1%"
    if odds > 0.995:
        return ">99%"
    return f"{odds * 100:.0f}%"


def odds_words(odds):
    return odds_short(odds).replace("<", "under ").replace(">", "over ")


def _pool_row(p, odds, next_pick, is_call):
    pct = round(odds * 100)
    return f"""<div class="prow{' call' if is_call else ''}">
  {face(p, 40)}
  <span class="who"><b>{escape(p['name'])}</b><span class="meta"><span class="pos">{p['pos']} {p['pos_rank']}</span>{p['team']}</span></span>
  <span class="c vor {heat_class(p)}"><b>{signed(p['vor'])}</b><i class="label">over repl</i></span>
  <span class="c odds"><span class="ot"><b>{odds_short(odds)}</b></span><span class="meter"><i style="width:{pct}%"></i></span><i class="label">at pick {next_pick}</i></span>
  <span class="q"><button class="quiet" type="button">Queue</button></span>
</div>"""


def score_bug(rnd, next_pick):
    return f"""<div class="bug" role="status" aria-live="polite">
    <div class="brand"><span class="c-mark">C</span><div><small>Mock</small><b>12 PPR</b></div></div>
    <div><small>Round {rnd}</small><b>Pick {ON_CLOCK}</b></div>
    <div class="you grow"><small>On the clock</small><b>You</b></div>
    <div class="clock"><small>Clock</small><b>{CLOCK}</b></div>
    <div class="opt"><small>Your next pick</small><b>{next_pick}</b></div>
  </div>"""


def lower_third(call, runner, odds, next_pick):
    intervening = next_pick - ON_CLOCK - 1
    return f"""<div class="lower">
    <div class="lt">
      <span class="cut"><img src="{call['img']}" alt="{escape(call['name'])}"></span>
      <div class="copy"><span class="tag">Our call at pick {ON_CLOCK}</span>
        <h3>Take {escape(call['name'])}</h3>
        <span class="meta"><span class="pos">{call['pos']} {call['pos_rank']}</span>{call['team']} · {signed(call['vor'])} over replacement</span>
        <p><b>{escape(runner['name'])}</b> has more over replacement at {signed(runner['vor'])}, but he is still there at pick {next_pick} {odds_words(odds[runner['id']])} of the time.</p>
      </div>
      <div class="odds-big"><b>{odds_short(odds[call['id']])}</b><span>chance he is still there at pick {next_pick}</span>
        <button class="verb" type="button">Draft {escape(_last(call['name']))}</button></div>
    </div>
    <div class="lt-basis">Odds from where drafters take everyone still on the board, with {intervening} picks before your next turn.</div>
  </div>"""


def draft_state(players):
    """The room at pick ON_CLOCK: the wall, the pool, the real survival odds and our call."""
    picks, pool = simulate_draft(players, MY_SEAT, ON_CLOCK - 1)
    next_pick = next(n for n in range(ON_CLOCK + 1, ON_CLOCK + 2 * TEAMS_PER_ROUND) if snake_seat(n)[1] == MY_SEAT)
    odds = survival_probabilities(pool, ON_CLOCK, next_pick, adp_or_sentinel)
    ranked = sorted(pool, key=lambda p: -p["vor"])[:POOL_ROWS]
    # Our call: the player whose points over replacement you lose most by waiting.
    call = max(ranked[:8], key=lambda p: p["vor"] * (1 - odds[p["id"]]))
    runner = ranked[0] if ranked[0] is not call else ranked[1]
    return {"picks": picks, "ranked": ranked, "odds": odds, "next_pick": next_pick, "call": call, "runner": runner,
            "round": snake_seat(ON_CLOCK)[0]}


def build(players):
    st = draft_state(players)
    picks, ranked, odds, next_pick, call, runner = (st[k] for k in ("picks", "ranked", "odds", "next_pick", "call", "runner"))
    mine = [pk for pk in picks if pk["seat"] == MY_SEAT]
    rnd = st["round"]
    mine_rows = "".join(
        f'<li>{face(pk["player"], 32)}<span>{escape(pk["player"]["name"])}<br><span class="label">{pk["player"]["pos"]} {pk["player"]["pos_rank"]} · {pk["player"]["team"]}</span></span>'
        f'<span class="num">{snake_seat(pk["no"])[0]}.{(pk["no"] - 1) % 12 + 1:02d}</span></li>'
        for pk in mine
    )
    pool_rows = "".join(_pool_row(p, odds[p["id"]], next_pick, p is call) for p in ranked)
    body = f"""<main class="room">
<div class="content">
  {score_bug(rnd, next_pick)}
  <div class="strip-head"><h2>Mock draft</h2><span>12 teams · PPR · snake</span></div>
  {_wall(picks)}
  <section class="pool">
    <div class="strip-head"><h2>Pool</h2><span>ranked by points over replacement</span></div>
    <div class="chips" role="group" aria-label="Pool position">
      <button class="chip" type="button" aria-pressed="true">All</button><button class="chip" type="button" aria-pressed="false">QB</button>
      <button class="chip" type="button" aria-pressed="false">RB</button><button class="chip" type="button" aria-pressed="false">WR</button>
      <button class="chip" type="button" aria-pressed="false">TE</button><button class="chip" type="button" aria-pressed="false">My queue</button>
    </div>
    <div class="prow head"><span></span><span class="label">Player</span><span class="label r">Over replacement</span><span class="label r">Still there</span><span></span></div>
    {pool_rows}
  </section>
  {lower_third(call, runner, odds, next_pick)}
</div>
<aside class="dock">
  <div class="mine-list panel"><h3>Your team</h3><ol>{mine_rows}</ol></div>
</aside>
</main>"""
    return page("Commish Draft Room", "mock", "Mock draft", "", body, ROOM_CSS + BORROWED_CSS)
