"""A mock with real people: the same room, plus the one thing a human room has that a solo room does not,
a clock. The score bug is the Broadcast borrowing, and this is the only screen it is allowed on."""
from html import escape

from data import TEAMS_PER_ROUND, adp_or_sentinel, snake_seat
from mock import next_turn, prev_turn
from mocksim import run_draft
from roomparts import KEYS, ROOM_CSS, gap_words, last_name, odds_short, odds_words, pick_label, pool_row, team_panel, wall
from shell import face, page, signed
from survival import survival_probabilities

MY_SEAT = 8
NOW = 54            # a human two seats before you is on the clock
SEED = 2027
ROUNDS_SHOWN = 5
POOL_ROWS = 12
CLOCK = "0:19"
SEATS = {1: "Bot", 2: "dmartinez", 3: "Bot", 4: "ty_the_commish", 5: "Bot", 6: "jpk88", 7: "Bot", 8: "You",
         9: "Bot", 10: "ravens_flock", 11: "Bot", 12: "Bot"}
LEFT = {4}          # ty_the_commish closed the tab, so a bot drafts from his queue
LANDING = 12        # the last round of picks, newest first, so the room reads without the wall

LOBBY_CSS = """
.bug{display:flex;align-items:stretch;min-height:64px;border-radius:var(--r-md);overflow:hidden;
  background:var(--scoreboard);color:var(--scoreboard-ink);border:1px solid var(--line)}
.bug > div{display:flex;flex-direction:column;justify-content:center;gap:3px;padding:0 var(--s-4);border-right:1px solid var(--scoreboard-line);white-space:nowrap}
.bug > div:last-child{border-right:0}
.bug small{font-size:var(--t-xs);font-weight:600;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--scoreboard-ink-2)}
.bug b{font-family:var(--font-num);font-weight:800;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.bug .grow{flex:1}
.bug .clock{align-items:center;min-width:120px}
.bug .clock b{font-size:var(--t-2xl);color:var(--scoreboard-num);line-height:0.85}
.bug .you b{color:var(--scoreboard-num)}
.seats{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.seat{flex:none;display:flex;flex-direction:column;gap:2px;min-width:92px;padding:6px 8px;border:1px solid var(--line);border-radius:var(--r-sm);font-size:var(--t-xs);color:var(--ink-3)}
.seat b{font-size:var(--t-sm);color:var(--ink);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seat.bot b{color:var(--ink-3);font-weight:500}
.seat.you{border-color:var(--accent);background:var(--accent-wash)}
.seat.you b{color:var(--accent-text)}
.seat.on{outline:2px solid var(--ink);outline-offset:-2px}
.seat.left span{color:var(--loss-ink)}
.wait{padding:var(--s-3) var(--s-4);font-size:var(--t-sm);color:var(--ink-2)}
.wait b{color:var(--ink)}
.landing .went{width:66px}
.landing .went .by{color:var(--ink-2);font-weight:500;max-width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.landing .went.human .by{color:var(--ink)}
.landing .went.newest .face{box-shadow:0 0 0 2px var(--ink)}
.call.soft{border-left-color:var(--line-strong)}
.call.soft .tag{color:var(--ink-3)}
@media (max-width: 760px){.bug{min-height:56px}.bug > div{padding:0 var(--s-3)}.bug b{font-size:var(--t-lg)}.bug .clock{min-width:80px}.bug .clock b{font-size:34px}}
"""


def seats_strip(now_seat):
    out = []
    for s in range(1, TEAMS_PER_ROUND + 1):
        name = SEATS[s]
        cls = "seat" + (" you" if s == MY_SEAT else "") + (" bot" if name == "Bot" else "") + (" on" if s == now_seat else "") + (" left" if s in LEFT else "")
        sub = "on the clock" if s == now_seat else ("left, queue drafts" if s in LEFT else ("bot" if name == "Bot" else "drafter"))
        out.append(f'<span class="{cls}"><b>{escape(name)}</b><span>{sub}</span></span>')
    return f'<div class="seats">{"".join(out)}</div>'


def landing_strip(picks):
    latest = list(reversed(picks[-LANDING:]))
    cards = []
    for i, pk in enumerate(latest):
        by = SEATS[pk["seat"]]
        cls = "went" + (" human" if by != "Bot" else "") + (" newest" if i == 0 else "")
        who = "you" if pk["seat"] == MY_SEAT else by.lower()
        cards.append(f'<span class="{cls}">{face(pk["player"], 36)}<b>{escape(last_name(pk["player"]["name"]))}</b>'
                     f'<span class="by">{escape(who)}</span><span>{pick_label(pk["no"])}</span></span>')
    humans_in = sum(1 for pk in latest if SEATS[pk["seat"]] != "Bot")
    return (f'<div class="since landing panel"><div class="lead"><b>{pick_label(latest[0]["no"])}</b><span>just taken, newest first</span>'
            f'<span>{humans_in} of the last {LANDING} by people</span></div><div class="run">{"".join(cards)}</div></div>')


def build(players):
    picks, _, _ = run_draft(players, MY_SEAT, SEED)
    picks = picks[: NOW - 1]
    taken = {id(pk["player"]) for pk in picks}
    pool = [p for p in players if id(p) not in taken]
    my_next = next_turn(NOW - 1, MY_SEAT)
    after = next_turn(my_next, MY_SEAT)
    prev = prev_turn(NOW, MY_SEAT)
    now_seat = snake_seat(NOW)[1]
    odds = survival_probabilities(pool, NOW, my_next, adp_or_sentinel)
    ranked = sorted(pool, key=lambda p: -p["vor"])[:POOL_ROWS]
    call = max(ranked[:8], key=lambda p: p["vor"] * (1 - odds[p["id"]]))
    runner = ranked[0] if ranked[0] is not call else ranked[1]
    rows = "".join(pool_row(p, odds[p["id"]], pick_label(my_next), p is call, NOW) for p in ranked)
    mine = [pk for pk in picks if pk["seat"] == MY_SEAT]
    humans = sum(1 for n in SEATS.values() if n not in ("Bot",))
    body = f"""<main class="room">
<div class="content">
  <div class="bug" role="status" aria-live="polite">
    <div><small>Round {snake_seat(NOW)[0]}</small><b>Pick {pick_label(NOW)}</b></div>
    <div class="grow"><small>On the clock</small><b>{escape(SEATS[now_seat])}</b></div>
    <div class="clock"><small>Clock</small><b>{CLOCK}</b></div>
    <div class="you"><small>Your pick</small><b>{pick_label(my_next)}, in {my_next - NOW}</b></div>
  </div>
  {seats_strip(now_seat)}
  {landing_strip(picks)}
  <section class="call panel soft" aria-label="Our call if the board holds">
    {face(call, 72)}
    <div><span class="tag">If the board holds to {pick_label(my_next)}</span>
      <h2>Take {escape(call['name'])}</h2>
      <div class="meta"><span class="pos">{call['pos']} {call['pos_rank']}</span>{call['team']} · {signed(call['vor'])} over replacement · {gap_words(call, my_next)}</div>
      <p><b>{escape(runner['name'])}</b> has more over replacement at {signed(runner['vor'])} and is still there at {pick_label(after)} {odds_words(survival_probabilities(pool, my_next, after, adp_or_sentinel)[runner['id']])} of the time, so he can wait a round. {escape(last_name(call['name']))} cannot.</p>
    </div>
    <div class="odds-big"><b>{odds_short(odds[call['id']])}</b><span>chance he reaches your pick at {pick_label(my_next)}</span>
      <button class="quiet" type="button">Queue {escape(last_name(call['name']))} first</button></div>
  </section>
  <section class="pool">
    <div class="pool-head"><h2>Pool</h2><span class="label">{len(pool)} left, ranked by points over replacement</span>
      <div class="chips" role="group" aria-label="Position">
        <button class="chip" type="button" aria-pressed="true">All</button><button class="chip" type="button" aria-pressed="false">QB</button>
        <button class="chip" type="button" aria-pressed="false">RB</button><button class="chip" type="button" aria-pressed="false">WR</button>
        <button class="chip" type="button" aria-pressed="false">TE</button><button class="chip" type="button" aria-pressed="false">Queue</button>
      </div></div>
    <div class="prow head"><span></span><span class="label">Player</span><span class="label r">Over replacement</span><span class="label r">Still there</span><span class="label r gapc">ADP</span><span></span></div>
    {rows}
  </section>
  <section>
    <div class="pool-head"><h2>The wall</h2><span class="label">rounds 1 to {ROUNDS_SHOWN} of 14</span></div>
    {wall(picks, MY_SEAT, NOW, ROUNDS_SHOWN, SEATS)}
  </section>
</div>
<aside class="dock">
  <div class="wait panel"><b>12 PPR lobby</b>, {humans} drafters and {12 - humans} bots. 30 seconds a pick, your queue drafts if you step away, a bot takes any seat that closes the tab.</div>
  {team_panel(mine)}
  {KEYS}
</aside>
</main>"""
    return page("Commish Mock Lobby", "mock", "Mock draft", '<a class="quiet" href="setup.html">Leave</a>', body, ROOM_CSS + LOBBY_CSS)
