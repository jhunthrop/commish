"""The solo mock room at your pick. No clock, no reveal: the bots have already picked up to you,
and the room shows what happened since your last pick, our call, the pool, the wall, your team."""
from html import escape

from data import TEAMS_PER_ROUND, adp_or_sentinel, snake_seat
from mocksim import run_draft
from roomparts import KEYS, ROOM_CSS, gap_words, last_name, odds_short, odds_words, pick_label, pool_row, team_panel, wall
from shell import face, page, signed
from survival import survival_probabilities

MY_SEAT = 8
NOW = 56
SEED = 2026
ROUNDS_SHOWN = 5
POOL_ROWS = 14


def next_turn(after, seat):
    return next(n for n in range(after + 1, after + 2 * TEAMS_PER_ROUND) if snake_seat(n)[1] == seat)


def prev_turn(before, seat):
    return max(n for n in range(1, before) if snake_seat(n)[1] == seat)


def state(players):
    picks, _, _ = run_draft(players, MY_SEAT, SEED)
    picks = picks[: NOW - 1]
    taken = {id(pk["player"]) for pk in picks}
    pool = [p for p in players if id(p) not in taken]
    nxt = next_turn(NOW, MY_SEAT)
    prev = prev_turn(NOW, MY_SEAT)
    odds = survival_probabilities(pool, NOW, nxt, adp_or_sentinel)
    ranked = sorted(pool, key=lambda p: -p["vor"])[:POOL_ROWS]
    call = max(ranked[:8], key=lambda p: p["vor"] * (1 - odds[p["id"]]))
    runner = ranked[0] if ranked[0] is not call else ranked[1]
    since = [pk for pk in picks if prev < pk["no"] < NOW]
    # Your queue at your last pick: the top of the board after your pick, as the room would have seeded it.
    pool_then = [p for p in players if id(p) not in {id(pk["player"]) for pk in picks[:prev]}]
    queued = {id(p) for p in sorted(pool_then, key=lambda p: -p["vor"])[:5]}
    return dict(picks=picks, pool=pool, odds=odds, ranked=ranked, call=call, runner=runner, nxt=nxt, prev=prev,
                since=since, queued=queued)


def bar(nxt):
    rnd = snake_seat(NOW)[0]
    return f"""<div class="bar">
  <div class="where"><b>Pick {pick_label(NOW)}</b><span>Round {rnd} · 12 teams · PPR · slot {MY_SEAT}</span></div>
  <div class="you-next"><span>Your next</span><b>{pick_label(nxt)}</b><span>{nxt - NOW - 1} picks away</span></div>
  <div class="acts">
    <button class="quiet" type="button">Undo <kbd>U</kbd></button>
    <button class="quiet" type="button">Pick for me to round 8</button>
    <button class="quiet" type="button">Finish the draft</button>
    <a class="quiet" href="report.html">Save and share</a>
  </div>
</div>"""


def since_strip(since, queued, prev):
    gone_queued = [pk for pk in since if id(pk["player"]) in queued]
    cards = "".join(
        f'<span class="went{" queued" if id(pk["player"]) in queued else ""}">{face(pk["player"], 36)}'
        f'<b>{escape(last_name(pk["player"]["name"]))}</b><span>{pick_label(pk["no"])}{" · queued" if id(pk["player"]) in queued else ""}</span></span>'
        for pk in since
    )
    lead_sub = f"{len(gone_queued)} from your queue" if gone_queued else "none from your queue"
    return f'<div class="since panel"><div class="lead"><b>{len(since)}</b><span>went since your pick at {pick_label(prev)}</span><span>{lead_sub}</span></div><div class="run">{cards}</div></div>'


# A contrast is drawn only when the odds back it: the runner-up at or above even, the call below.
# Otherwise both numbers are given plainly. Every sentence names both (UX review 2, M5).
EVEN = 0.5


def runner_words(call, runner, odds, nxt):
    more = f"has more over replacement at {signed(runner['vor'])}"
    at = pick_label(nxt)
    mine, theirs = odds[call["id"]], odds[runner["id"]]
    name = escape(last_name(call["name"]))
    if theirs >= EVEN and mine < EVEN:
        return f"{more}, but he is still there at {at} {odds_words(theirs)} of the time. {name} is there {odds_words(mine)} of the time."
    return f"{more}. He is there at {at} {odds_words(theirs)} of the time, {name} {odds_words(mine)}."


def call_panel(call, runner, odds, nxt):
    return f"""<section class="call panel" aria-label="Our call">
  {face(call, 72)}
  <div><span class="tag">Our call at {pick_label(NOW)}</span>
    <h2>Take {escape(call['name'])}</h2>
    <div class="meta"><span class="pos">{call['pos']} {call['pos_rank']}</span>{call['team']} · {signed(call['vor'])} over replacement · {gap_words(call, NOW)}</div>
    <p><b>{escape(runner['name'])}</b> {runner_words(call, runner, odds, nxt)}</p>
  </div>
  <div class="odds-big"><b>{odds_short(odds[call['id']])}</b><span>chance he is still there at {pick_label(nxt)}</span>
    <button class="verb" type="button">Draft {escape(last_name(call['name']))} <kbd>Enter</kbd></button></div>
</section>"""


def build(players):
    st = state(players)
    nxt = st["nxt"]
    rows = "".join(pool_row(p, st["odds"][p["id"]], pick_label(nxt), p is st["call"], NOW) for p in st["ranked"])
    mine = [pk for pk in st["picks"] if pk["seat"] == MY_SEAT]
    body = f"""<main class="room">
<div class="content">
  {bar(nxt)}
  {since_strip(st['since'], st['queued'], st['prev'])}
  {call_panel(st['call'], st['runner'], st['odds'], nxt)}
  <section class="pool">
    <div class="pool-head"><h2>Pool</h2><span class="label">{len(st['pool'])} left, ranked by points over replacement</span>
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
    {wall(st['picks'], MY_SEAT, NOW, ROUNDS_SHOWN)}
  </section>
</div>
<aside class="dock">
  {team_panel(mine)}
  {KEYS}
  <span class="seed">Mock 2026-10-12 · seed {SEED} · the same seed replays the same bots</span>
</aside>
</main>"""
    return page("Commish Mock Room", "mock", "Mock draft", '<a class="quiet" href="setup.html">New mock</a>', body, ROOM_CSS)
