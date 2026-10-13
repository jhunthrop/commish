"""The in-season parts as shipped (UX fix 5): the player page's This season block (web/src/lib/ui/GameLog.svelte)
and a league row (web/src/lib/league/LeagueRow.svelte), drawn from data/ snapshots of the shipped run."""
import json
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from data import MOCKS, TINTED_ROUNDS, heat_class
from shell import face

EASTERN = ZoneInfo("America/New_York")

# The receiver's columns, short head, full words and the words for a total of exactly 1 (stat-columns.ts).
WR_COLUMNS = [
    ("targets", "Tgt", "targets", "target"),
    ("receptions", "Rec", "catches", "catch"),
    ("receiving_yards", "Yds", "receiving yards", "receiving yard"),
    ("receiving_touchdowns", "TD", "receiving touchdowns", "receiving touchdown"),
    ("carries", "Car", "carries", "carry"),
    ("rushing_yards", "Rush yds", "rushing yards", "rushing yard"),
    ("rushing_touchdowns", "Rush TD", "rushing touchdowns", "rushing touchdown"),
]

SEASON_CSS = """
.season{display:flex;flex-direction:column;gap:var(--s-3);min-width:0}
.season .head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s-3);margin:0;font-size:var(--t-md);font-weight:700}
.log .frame{--wk-w:52px;--opp-w:104px;--pts-w:84px;position:relative;overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-md)}
.log table{border-collapse:separate;border-spacing:0;width:100%;min-width:max-content;font-size:var(--t-sm)}
.log th,.log td{height:44px;padding:0 var(--s-3);border-bottom:1px solid var(--line);background:var(--bg);text-align:end;white-space:nowrap}
.log tbody tr:last-child > *{border-bottom:0}
.log thead th{height:auto;padding-block:var(--s-2);font-size:var(--t-xs);font-weight:500;text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3)}
.log .pin{position:sticky;z-index:1;text-align:start}
.log .wk{left:0;width:var(--wk-w);min-width:var(--wk-w);font-variant-numeric:tabular-nums}
.log .opp{left:var(--wk-w);width:var(--opp-w);min-width:var(--opp-w);line-height:1.2}
.log .lead{left:0}
.log .pts{left:calc(var(--wk-w) + var(--opp-w));width:var(--pts-w);min-width:var(--pts-w);text-align:end;border-left:1px solid var(--line);border-right:1px solid var(--line-strong)}
.log .line > *{height:auto;padding-block:var(--s-3);background:var(--surface);border-bottom:1px solid var(--line-strong);vertical-align:top}
.log .line b,.log .line span{display:block}
.log .lead b{font-size:var(--t-md)}
.log .lead span{font-weight:400;color:var(--ink-2)}
.log .line td b{font-family:var(--font-num);font-size:var(--t-xl);font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.log .line td span{max-width:11ch;margin:4px 0 0 auto;font-size:var(--t-xs);line-height:1.2;color:var(--ink-3);white-space:normal}
.log .n{font-family:var(--font-num);font-size:var(--t-lg);font-weight:700;font-variant-numeric:tabular-nums}
.log .played .opp{font-weight:600}
.log .quiet .wk,.log .quiet .opp,.log .bye .wk,.log .bye .opp{color:var(--ink-3)}
.log .note{display:block;font-size:var(--t-xs)}
.log .bye > *{background:var(--surface)}
.ahead h3{margin:var(--s-4) 0 var(--s-2);line-height:1}
.ahead ol{display:grid;grid-template-columns:repeat(auto-fill,minmax(208px,1fr));column-gap:var(--s-5);margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.ahead li{display:grid;grid-template-columns:3.5em 1fr auto;align-items:center;gap:var(--s-2);min-height:32px;padding:0 var(--s-2);
  border-bottom:1px solid var(--line);font-size:var(--t-sm);color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.ahead li.bye{color:var(--ink-3);background:var(--surface)}
.ahead .aw,.ahead .ad{color:var(--ink-3)}
.foot-note{margin:0;font-size:var(--t-sm);color:var(--ink-3);max-width:72ch}
@media (max-width: 760px){
  .log .frame{--wk-w:40px;--opp-w:84px;--pts-w:60px}
  .log th,.log td{padding-inline:var(--s-2)}
  .ahead ol{grid-template-columns:minmax(0,1fr)}
}
"""


def _load(name):
    return json.loads((MOCKS / "data" / name).read_text())


def _count(value):
    return "" if value is None else f"{value:,.0f}"


def _opponent(row):
    if row["opponent"] is None:
        return "Bye"
    return f"{'vs' if row['home'] else 'at'} {row['opponent']}"


def _weekday(iso):
    at = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(EASTERN)
    return f"{at:%a} {at:%b} {at.day}"


def season_block(player_name):
    """The This season block for the snapshot's player, as GameLog draws it."""
    snap = _load("season-chris-olave.json")
    s = snap["season"]
    if snap["player"]["name"] != player_name:
        raise ValueError(f"The season snapshot is {snap['player']['name']}'s, not {player_name}'s.")
    log = s["log"]
    first = next((i for i, r in enumerate(log) if r["status"] == "upcoming"), len(log))
    past, ahead = log[:first], log[first:]
    heads = "".join(f'<th scope="col">{short}</th>' for _, short, _, _ in WR_COLUMNS)
    totals = "".join(
        f'<td><b>{_count(s["totals"][key])}</b><span>{one if s["totals"][key] == 1 else full}</span></td>'
        for key, _, full, one in WR_COLUMNS
    )
    rows = []
    for r in past:
        tone = "played" if r["status"] == "played" else "bye" if r["status"] == "bye" else "quiet"
        note = '<span class="note">Did not play</span>' if r["status"] == "inactive" else ""
        if r["status"] == "played":
            cells = f'<td class="pin pts n">{r["points"]:.1f}</td>' + "".join(
                f'<td class="n">{_count(r[key])}</td>' for key, _, _, _ in WR_COLUMNS
            )
        else:
            cells = f'<td class="pin pts n"></td><td colspan="{len(WR_COLUMNS)}"></td>'
        rows.append(f'<tr class="{tone}"><th scope="row" class="pin wk">{r["week"]}</th>'
                    f'<td class="pin opp">{_opponent(r)}{note}</td>{cells}</tr>')
    kickoffs = snap["kickoffs"]
    ahead_rows = "".join(
        f'<li class="{"bye" if r["opponent"] is None else ""}"><span class="aw">Wk {r["week"]}</span>'
        f'<span class="ao">{_opponent(r)}</span>'
        f'<span class="ad">{"" if r["opponent"] is None else _weekday(kickoffs[str(r["week"])])}</span></li>'
        for r in ahead
    )
    games = s["games"]
    return f"""<section class="season" id="this-season" aria-label="This season">
    <h2 class="head"><span>This season</span><span class="label">{s['season']}, PPR, through week {s['through']}</span></h2>
    <p class="foot-note">Stat lines from the league's own records, scored in PPR. Points a game average the {games} games he played.</p>
    <div class="log"><div class="frame" role="region" aria-label="{escape(player_name)} week by week" tabindex="0"><table>
      <thead><tr><th scope="col" class="pin wk">Wk</th><th scope="col" class="pin opp">Opp</th><th scope="col" class="pin pts">Pts</th>{heads}</tr></thead>
      <tbody><tr class="line"><th scope="row" colspan="2" class="pin lead"><b>Season</b><span>{games} games</span></th>
        <td class="pin pts"><b>{s['pointsPerGame']:.1f}</b><span>PPR points a game</span></td>{totals}</tr>
      {''.join(rows)}</tbody></table></div></div>
    <section class="ahead" aria-label="Still to play"><h3><span class="label">Still to play</span></h3><ol>{ahead_rows}</ol></section>
  </section>"""


LEAGUE_ROW_CSS = """
.lrow{position:relative;display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;column-gap:var(--s-3);
  min-height:var(--row-h);padding:4px var(--s-3);border-bottom:1px solid var(--line)}
.lrow.slotted{grid-template-columns:3.5em 32px minmax(0,1fr) auto}
.lrow .who{min-width:0;display:flex;flex-direction:column;gap:2px}
.lrow .who a{color:inherit;text-decoration:none;font-weight:600}
.lrow .who a::after{content:'';position:absolute;inset:0}
.lrow .meta{display:flex;align-items:center;flex-wrap:wrap;column-gap:var(--s-2);font-size:var(--t-sm);color:var(--ink-2);font-variant-numeric:tabular-nums}
.lrow .end{justify-self:end;text-align:right;display:flex;flex-direction:column;align-items:flex-end}
.lrow .end b{font-family:var(--font-num);font-weight:700;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.lrow .pts{font-family:var(--font-num);font-weight:600}
.lrow .vcell{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;min-height:44px;
  padding:0 var(--s-3);border-radius:var(--r-sm);color:var(--heat-ink)}
.lrow .vcell b{font-family:var(--font-num);font-weight:700;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.lrow .vcell .label{color:inherit}
.lrow .vcell.heat-0{color:var(--ink)}
"""


def _signed0(x):
    return f"+{x:.0f}" if x >= 0 else f"−{abs(x):.0f}"


def season_words(p):
    return "No games yet" if p["ppg"] is None else f"{p['games']} game{'s' if p['games'] != 1 else ''}, {p['ppg']:.1f} a game"


def _value_cell(p):
    tinted = p["vor"] >= 0 and p["vor_round"] <= TINTED_ROUNDS
    label = f"over repl · rd {p['vor_round']}" if tinted else "over repl"
    return f'<span class="vcell {heat_class(p)}"><b>{_signed0(p["vor"])}</b><span class="label">{label}</span></span>'


def league_row(p, slot=None, trailing=None, ends_on_value=False):
    """A league row: name to the game log, position rank, team, bye, the projection with its basis, and at
    its end points a game this season, or the row's own number or (the waiver pool, ranked by it) his
    value over replacement, with the season beside the projection."""
    slot_cell = f'<span class="label">{slot}</span>' if slot else ""
    if not p["placed"]:
        return (f'<div class="lrow{" slotted" if slot else ""}">{slot_cell}<span class="face" style="width:32px;height:32px"></span>'
                f'<span class="who"><b>{escape(p["name"])}</b><span class="meta"><span>{p["pos"]} {p["team"]}</span>'
                f'<span>not on our board</span></span></span><span class="end">{trailing or ""}</span></div>')
    bye = f'<span>bye {p["bye"]}</span>' if p["bye"] else ""
    in_meta = trailing is not None or ends_on_value
    season = f'<span>{season_words(p)}</span>' if in_meta else ""
    projection = f'proj {p["proj"]:.0f}' + ("" if ends_on_value else f', over repl {_signed0(p["vor"])}')
    if trailing is not None:
        end = trailing
    elif ends_on_value:
        end = _value_cell(p)
    elif p["ppg"] is None:
        end = '<span class="label">No games yet</span>'
    else:
        end = f'<b>{p["ppg"]:.1f}</b><span class="label">a game, {p["games"]} games</span>'
    return (
        f'<div class="lrow{" slotted" if slot else ""}">{slot_cell}{face(p, 32)}<span class="who">'
        f'<a href="player.html#this-season">{escape(p["name"])}</a><span class="meta"><span class="pos">{p["pos"]} {p["pos_rank"]}</span>'
        f'<span>{p["team"]}</span>{bye}{season}<span>{projection}</span></span></span>'
        f'<span class="end">{end}</span></div>'
    )


def league_data():
    return _load("league-sleeper.json")
