"""Lane 66n mock: the board row as a box score, on the board (All and WR), ADP, a club page and Compare.

Usage: python3 gen_board_row.py <run dir> <web/src/lib/ui/tokens.css> <out dir>

Every figure comes from the run (2026-10-17T21, Lane 66m's rebuilt stand-in run): the PPR board,
index.json's season so far, clubs.json's byes, designations.json's statuses, schedule.json's slates,
the player files' 2025 lines. Byes are the club's bye week. The member's sheet (who is on it, in
what place, with what tag) is a stand-in and carries class "si", printed with a dotted underline.
Season-long statuses move as the site moves them (run/board-status.ts withStatuses).
"""
from __future__ import annotations

import html
import json
import os
import sys
from datetime import datetime, timezone, timedelta

RUN, TOKENS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FMT = 'ppr-12'
FORMAT_LABEL = 'PPR'
MINUS = '−'
CENTRAL = timezone(timedelta(hours=-5))


def load(name: str):
    with open(os.path.join(RUN, name)) as fh:
        return json.load(fh)


board = load(f'boards/{FMT}.json')['rows']
index = {e['id']: e for e in load('index.json')}
byes = {c['abbr']: c['bye'] for c in load('clubs.json')}
club_names = {c['abbr']: (c['city'], c['nickname']) for c in load('clubs.json')}
desig = load('designations.json')
statuses = desig['players']
schedule = load('schedule.json')
manifest = load('manifest.json')
adp_sources = load('adp.json')['sources']


def player_file(pid: str):
    return load(f'players/{pid}.json')


def day(iso: str) -> str:
    d = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(CENTRAL)
    return f"{d.strftime('%b')} {d.day}"


ADP_READ = day(next(s for s in adp_sources if FMT in s['formats'])['window']['from'])
STATUS_READ = day(desig['readAt'])
WINS_READ = day(next(s for s in manifest['sources'] if s['artifact'] == 'schedule')['window']['from'])
THROUGH = player_file('4426515')['season']['through']
SEASON = manifest['season']
RUN_DAY = day(manifest['runAt']).upper()


def esc(s) -> str:
    return html.escape(str(s))


def fixed(v: float, d: int = 1) -> str:
    return f'{v:.{d}f}'


def signed(v: float, d: int = 1) -> str:
    t = f'{abs(v):.{d}f}'
    return f'+{t}' if v > 0 else (f'{MINUS}{t}' if v < 0 else t)


def status_of(pid: str):
    return statuses.get(pid)


def held(row) -> bool:
    s = status_of(row['id'])
    return bool(s and s['seasonLong'])


def with_statuses(rows):
    """run/board-status.ts: each season-long row after the last available player at his position."""
    last = {}
    waiting: dict[str, list] = {}
    for i, r in enumerate(rows):
        if held(r):
            waiting.setdefault(r['position'], []).append(r)
        else:
            last[r['position']] = i
    out = []
    for i, r in enumerate(rows):
        lp = last.get(r['position'])
        if not held(r) or lp is None:
            out.append(r)
        if i == lp:
            out.extend(waiting.get(r['position'], []))
    return out


ranked = [r for r in board if r['orderBasis'] == 'projection']
market = [r for r in board if r['orderBasis'] == 'market']
ordered = with_statuses(ranked)
LO = min(r['floor'] for r in ranked if r['floor'] is not None) // 50 * 50
HI = max(r['ceiling'] for r in ranked if r['ceiling'] is not None)

# The member's sheet: a stand-in. Place and tag per player id.
SHEET = {
    '4362628': (1, 'Target'),   # Ja'Marr Chase
    '4241389': (2, None),       # CeeDee Lamb
    '4426354': (3, 'Breakout'), # George Pickens
}


def heat(r) -> str:
    if r['vor'] < 0:
        return 'heat-neg'
    return f"heat-{r['vorRound']}" if 1 <= r['vorRound'] <= 4 else ''


def gap(adp, rank, flip=False):
    if adp is None or rank is None:
        return ''
    g = round(adp - rank)
    if flip:
        g = -g
    # Board: plus when drafters take him later (a gain). ADP: plus when we rank him later than drafters
    # take him, which is the same player seen from the other side, so the tone follows the board's.
    good = (g > 0) != flip
    cls = 'even' if g == 0 else ('plus' if good else 'minus')
    text = '0' if g == 0 else (f'+{g}' if g > 0 else f'{MINUS}{-g}')
    return f'<span class="n gap {cls}">{text}</span>'


def face(r, size=None) -> str:
    src = r.get('headshot')
    if r['position'] == 'DST' or not src:
        return f'<span class="face mark"><img src="https://a.espncdn.com/i/teamlogos/nfl/500/{r["team"].lower()}.png" alt=""></span>'
    return f'<span class="face"><img src="{esc(src)}" alt="" loading="eager"></span>'


def status_chip(r) -> str:
    s = status_of(r['id'])
    if not s:
        return ''
    if s['seasonLong']:
        return f'<span class="chip ir">IR since {day(s["since"])}</span>'
    word = {'questionable': 'Questionable', 'doubtful': 'Doubtful', 'out': 'Out'}[s['status']]
    return f'<span class="chip q">{word}</span>'


def tag_chip(r) -> str:
    entry = SHEET.get(r['id'])
    if not entry or not entry[1]:
        return ''
    return f'<span class="chip tag si">{esc(entry[1])}</span>'


def who(r, pos_rank=True) -> str:
    rank = 'IR' if held(r) else r['positionRank']
    pos = f"{r['position']} {rank}" if pos_rank else r['position']
    return (f'<div class="pl">{face(r)}<span class="nm"><a href="#">{esc(r["name"])}</a>'
            f'<span class="sub">{r["team"]} · {pos} {status_chip(r)}{tag_chip(r)}</span></span></div>')


def sheet_cell(r) -> str:
    entry = SHEET.get(r['id'])
    if entry:
        return f'<span class="on-sheet si"><span class="disc">{CHECK}</span>{ordinal(entry[0])}</span>'
    return f'<span class="disc">{PLUS}</span>'


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rng(r) -> str:
    if r['floor'] is None:
        return ''
    span = HI - LO
    left = (r['floor'] - LO) / span * 100
    width = (r['ceiling'] - r['floor']) / span * 100
    med = (r['median'] - LO) / span * 100
    return (f'<span class="rng"><span class="e lo">{r["floor"]:.0f}</span><span class="track">'
            f'<span class="span" style="left:{left:.1f}%;width:{width:.1f}%"></span>'
            f'<span class="med" style="left:{med:.1f}%"></span></span>'
            f'<span class="e">{r["ceiling"]:.0f}</span></span>')


def season_cells(r) -> str:
    s = index[r['id']].get('season') or {}
    games = s.get('games')
    ppg = s.get('pointsPerGame')
    gp = f'<span class="n quiet-n">{games}</span>' if games is not None else ''
    a = f'<span class="n">{fixed(ppg)}</span>' if ppg is not None else '<span class="n none">None</span>'
    return f'<td class="wide">{gp}</td><td class="wide">{a}</td>'


def svg(path: str, size: int = 20, stroke: float = 1.8) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')


PLUS = svg('<path d="M12 5v14M5 12h14"/>', 14, 2.2)
CHECK = svg('<path d="M5 12l5 5 9-10"/>', 14, 2.6)
ICONS = {
    'Lineup': svg('<path d="M8 3l4 2 4-2 4 4-3 3v11H7V10L4 7z"/>'),
    'Matchup': svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-3 2-5 5-5s5 2 5 5M11 20c0-3 2-5 5-5s5 2 5 5"/>'),
    'Waivers': svg('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M19 6v6M16 9h6"/>'),
    'Trades': svg('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
    'Players': svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'),
    'Rest of season': svg('<path d="M4 6h16M4 12h12M4 18h8"/>'),
    'Our record': svg('<path d="M4 20h16M7 16V9M12 16V5M17 16v-4"/>'),
    'Account': svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6 18c2-3 10-3 12 0"/>'),
}
SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18)
FLAG = svg('<path d="M5 21V4h11l-2 4 2 4H5"/>', 16)
CHEV = svg('<path d="M6 9l6 6 6-6"/>', 14)


def shell(title: str, theme: str, bar: str, active: str, tail: str, body: str, players: int) -> str:
    # tokens.css imports the generated colours and scale (Lane 171); inline, the import never resolves.
    tokens = open(os.path.join(os.path.dirname(TOKENS), 'tokens.generated.css')).read() + open(TOKENS).read()
    css = open(os.path.join(OUT, 'board-row.css')).read()
    rail = ''.join(
        f'<a href="#" class="{"on" if name == active else ""}">{ICONS[name]}<span>{name}</span></a>'
        for name in ['Lineup', 'Matchup', 'Waivers', 'Trades', 'Players', 'Rest of season', 'Our record'])
    tabs = ''.join(
        f'<a href="#" class="{"on" if name == active else ""}">{ICONS[name]}<span>{name}</span></a>'
        for name in ['Lineup', 'Matchup', 'Waivers', 'Trades', 'Players'])
    return f'''<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)} (Lane 66n mock, {theme})</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Big+Shoulders+Display:wght@500;600;700;800&family=Outfit:wght@400;500;600;700&display=swap">
<style>
{tokens}
{css}
</style>
</head>
<body>
<div class="app">
<nav class="rail"><div class="brand"><b>C</b></div>{rail}<a href="#" class="acct">{ICONS['Account']}<span>Account</span></a></nav>
<div>
<header class="bar"><h1>{bar}</h1><span class="stamp">Run of {RUN_DAY.title()}</span>
<span class="find">{SEARCH}<span>Search {players} players</span><kbd>/</kbd></span>
<span class="tail">{tail}</span>
<span class="switch">{FLAG}{FORMAT_LABEL}{CHEV}</span><span class="acct-i ph-only">{ICONS['Account']}</span></header>
{body}
</div>
</div>
<nav class="tabbar">{tabs}</nav>
</body>
</html>
'''


# ---------- the board ----------

def board_head(order: str, tier_col: bool, bye: bool = True) -> str:
    lead = ('<th class="c-rk sorted">Rk</th>' if order == 'board' else '<th class="c-lead sorted">ADP</th>')
    rank_col = '' if order == 'board' else '<th class="c-our wide">Rk</th>'
    adp_col = '<th class="c-adp">ADP</th>' if order == 'board' else ''
    return ('<thead><tr>'
            f'{lead}<th class="l c-pl">Player</th>'
            f'{"<th class=\"c c-tier wide\">Tier</th>" if tier_col else ""}'
            f'{"<th class=\"c-bye\">Bye</th>" if bye else ""}<th class="c-proj wide">Projected</th><th class="c-vor">Over repl</th>'
            '<th class="c-rng wide">Floor to ceiling</th>'
            f'{adp_col}{rank_col}<th class="c-gap">Gap</th><th class="c-gp wide">GP</th><th class="c-ag wide">A game</th>'
            '<th class="c-sh wide"></th></tr></thead>')


def board_row(r, order: str, tier_col: bool, bye: bool = True) -> str:
    is_held = held(r)
    rk = 'IR' if is_held else r['ourRank']
    adp = r['adp']
    lead = (f'<td class="rk">{rk}</td>' if order == 'board'
            else f'<td><span class="n">{fixed(adp)}</span></td>')
    tier = (f'<td class="wide" style="text-align:center"><span class="tier" style="--tier:var(--tier-{min(r["tier"], 7)})">{r["tier"]}</span></td>'
            if tier_col else '')
    tier = tier if not (tier_col and is_held) else '<td class="wide"></td>'
    adp_cell = (f'<td>{"<span class=\"n\">" + fixed(adp) + "</span>" if adp is not None else "<span class=\"n none\">None</span>"}</td>'
                if order == 'board' else '')
    our = f'<td class="wide"><span class="n quiet-n">{rk}</span></td>' if order == 'adp' else ''
    gap_cell = '' if is_held else gap(adp, r['ourRank'], flip=order == 'adp')
    return ('<tr>'
            f'{lead}<td class="who">{who(r)}</td>{tier}'
            f'{"<td><span class=\"n quiet-n\">" + str(byes[r["team"]]) + "</span></td>" if bye else ""}'
            f'<td class="wide"><span class="n">{fixed(r["projected"])}</span></td>'
            f'<td><span class="vor n {heat(r)}">{signed(r["vor"])}</span></td>'
            f'<td class="wide">{rng(r)}</td>'
            f'{adp_cell}{our}<td>{gap_cell}</td>'
            f'{season_cells(r)}<td class="sheet wide">{sheet_cell(r)}</td></tr>')


def market_row(r, order: str, tier_col: bool) -> str:
    """A kicker or a defense in ADP order, as Lane 66m leaves it: no figures of ours, his place on the pill."""
    lead = f'<td><span class="n">{fixed(r["adp"])}</span></td>'
    pl = (f'<div class="pl">{face(r)}<span class="nm"><a href="#">{esc(r["name"])}</a>'
          f'<span class="sub">{r["team"]} · {r["position"]} {r["positionRank"]}</span></span></div>')
    blanks = '<td class="wide"></td>' if tier_col else ''
    return (f'<tr>{lead}<td class="who">{pl}</td>{blanks}<td><span class="n quiet-n">{byes[r["team"]]}</span></td>'
            '<td class="wide"></td><td></td><td class="wide"></td><td class="wide"></td><td></td>'
            f'<td class="wide"></td><td class="wide"></td><td class="sheet wide">{sheet_cell(r)}</td></tr>')


WIDTHS = '''<style>
.c-rk{width:40px}.c-lead{width:52px}.c-tier{width:40px}.c-bye{width:42px}.c-proj{width:74px}.c-vor{width:84px}
.c-rng{width:142px}.c-adp{width:50px}.c-our{width:42px}.c-gap{width:46px}.c-gp{width:36px}.c-ag{width:58px}.c-sh{width:68px}
.box .track{width:70px}
@media (max-width:760px){.c-lead{width:42px}.c-bye{width:36px}.c-vor{width:64px}.c-adp{width:42px}.c-gap{width:40px}.c-rk{display:none}
 .box tbody td.rk{display:none}}
</style>'''


def basis_board(position: str | None) -> str:
    fmt = next(f for f in manifest['formats'] if f['id'] == FMT)
    tiers = f' Tiers are drawn within {position}.' if position else ''
    return (f'<p class="basis">Our {FORMAT_LABEL} projection for the full {SEASON} season, ranked by points over '
            f'replacement in a {fmt["teams"]}-team league.{tiers} ADP from {FORMAT_LABEL} drafts, {ADP_READ}. '
            f'Gap is ADP minus our rank, plus when drafters wait. '
            f'<span class="wide">GP and A game are {SEASON} through week {THROUGH}. </span>'
            f'Status read {STATUS_READ}.</p>')


def chips(active: str) -> str:
    names = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST']
    return '<span class="chips">' + ''.join(
        f'<a href="#" class="{"on" if n == active else ""}">{n}</a>' for n in names) + '</span>'


def toggles(range_on: bool = True) -> str:
    return ('<span class="toggles">'
            '<span class="tog on"><i></i>Below replacement</span>'
            f'<span class="tog wide {"on" if range_on else ""}"><i></i>Floor to ceiling</span>'
            '<span class="tog"><i></i>Only my sheet</span></span>')


def sheet_panel() -> str:
    by_id = {r['id']: r for r in ranked}
    rows = sorted(SHEET.items(), key=lambda kv: kv[1][0])
    items = ''.join(
        f'<div class="srow si"><span class="p">{place}</span>{face(by_id[pid])}<b>{esc(by_id[pid]["name"])}</b></div>'
        for pid, (place, _) in rows)
    return f'<section class="panel"><h3>Your sheet <small class="si">3 players</small></h3>{items}</section>'


def board_page(theme: str, position: str | None) -> str:
    if position is None:
        rows = [r for r in ordered if not held(r)][:22]
        body_rows = ''.join(board_row(r, 'board', True) for r in rows)
        side_extra = ''
    else:
        pos_rows = [r for r in ordered if r['position'] == position]
        avail = [r for r in pos_rows if not held(r)]
        groups: list[list] = []
        for r in avail:
            if groups and groups[-1][0]['tier'] == r['tier']:
                groups[-1].append(r)
            else:
                groups.append([r])
        shown = groups[:4]
        body_rows = ''
        jump = ''
        for gi, g in enumerate(shown):
            nxt = groups[gi + 1] if gi + 1 < len(groups) else None
            drop = g[-1]['projected'] - nxt[0]['projected'] if nxt else None
            t = min(g[0]['tier'], 7)
            drop_html = (f'<span class="drop"><span class="n">{fixed(drop)}</span><span>pts to tier {nxt[0]["tier"]}</span></span>'
                         if drop is not None else '')
            body_rows += (f'<tr class="band" style="--tier:var(--tier-{t})"><td colspan="11"><div class="bandin">'
                          f'<span class="num">{g[0]["tier"]}</span><b>Tier {g[0]["tier"]}</b><span>{len(g)} {position}s</span>'
                          f'{drop_html}</div></td></tr>')
            body_rows += ''.join(board_row(r, 'board', False) for r in g)
            jump += (f'<a href="#"><span class="tier" style="--tier:var(--tier-{t})">{g[0]["tier"]}</span>'
                     f'{len(g)} {position}s<span class="n">{fixed(drop) if drop is not None else ""}</span></a>')
        held_rows = [r for r in pos_rows if held(r)]
        if held_rows:
            body_rows += '<tr class="held"><td colspan="11">On a season-long list, his figures assume he plays</td></tr>'
            # The mock trims the list to its first five; the page lists every one.
            body_rows += ''.join(board_row(r, 'board', False) for r in held_rows[:5])
        side_extra = f'<section class="panel jump"><h3>Tiers <small>Drop to next</small></h3>{jump}</section>'
    tier_col = position is None
    head = board_head('board', tier_col)
    title_tab = position or 'All'
    body = f'''<main class="page">
<div class="content">
<div class="head"><h2 class="title">{SEASON} Board</h2><span class="quiets"><a class="quiet" href="#">ADP</a><a class="quiet" href="#">Schedule strength</a></span></div>
{basis_board(position)}
<div class="filters">{chips(title_tab)}{toggles()}</div>
{WIDTHS}
<table class="box">{head}<tbody>{body_rows}</tbody></table>
</div>
<aside class="side">{side_extra}{sheet_panel()}</aside>
</main>'''
    return shell(f'{title_tab} board', theme, 'Board', 'Rest of season',
                 '<a class="verb" href="#">Follow your league</a>', body, manifest['players'])


# ---------- ADP ----------

def adp_page(theme: str) -> str:
    rows = sorted([r for r in board if r['adp'] is not None], key=lambda r: r['adp'])[:22]
    body_rows = ''.join(market_row(r, 'adp', True) if r['orderBasis'] == 'market' else board_row(r, 'adp', True)
                        for r in rows)
    no_adp = sum(1 for r in ranked if r['adp'] is None)
    basis = (f'<p class="basis">ADP from {FORMAT_LABEL} drafts, {ADP_READ}, earliest pick first. '
             f'Rk is our {FORMAT_LABEL} board: our projection for the full {SEASON} season, ranked by points over replacement. '
             f'Gap is our rank minus ADP, plus when we rank him later. '
             f'<span class="wide">GP and A game are {SEASON} through week {THROUGH}. </span>'
             f'Status read {STATUS_READ}. {no_adp} players on our board have no ADP yet.</p>')
    body = f'''<main class="page full">
<div class="content">
<div class="head"><h2 class="title">{SEASON} ADP</h2><span class="quiets"><a class="quiet" href="#">Board</a></span></div>
{basis}
<div class="filters">{chips('All')}{toggles()}</div>
{WIDTHS}
<table class="box">{board_head('adp', True)}<tbody>{body_rows}</tbody></table>
</div>
</main>'''
    return shell('ADP', theme, 'ADP', 'Rest of season', '<a class="verb" href="#">Start a mock draft</a>',
                 body, manifest['players'])


# ---------- a club ----------

def club_page(theme: str, abbr: str) -> str:
    city, nick = club_names[abbr]
    slate = next(s for s in schedule['slates'] if s['abbr'] == abbr)
    rows = [r for r in ordered if r['team'] == abbr]
    body_rows = ''.join(board_row(r, 'board', True, bye=False) for r in rows)
    mk = [r for r in market if r['team'] == abbr]
    mk_rows = ''.join(
        f'<tr><td class="who"><div class="pl">{face(r)}<span class="nm"><a href="#">{esc(r["name"])}</a>'
        f'<span class="sub">{r["team"]} · {r["position"]}</span></span></div></td>'
        f'<td><span class="n">{r["positionRank"]}</span></td><td><span class="n quiet-n">{fixed(r["adp"])}</span></td></tr>'
        for r in mk)
    played = THROUGH
    sched = ''.join(
        f'<tr class="{"played" if g["week"] <= played else ""}"><td class="wk">{g["week"]}</td>'
        f'<td class="opp"><span class="ha">{"vs" if g["home"] else "at"}</span>{" ".join(club_names[g["opponent"]])}</td>'
        f'<td><span class="n">{fixed(schedule["opponentValues"][g["opponent"]])}</span></td></tr>'
        for g in slate['games'])
    hardest = f'{ordinal(slate["rank"])}'
    basis = (f'<p class="basis">Expected wins are the season\'s, from the published season totals, read {WINS_READ}. '
             f'Players are on our {FORMAT_LABEL} board for the full {SEASON} season, ranked by points over replacement. ADP from {FORMAT_LABEL} drafts, '
             f'{ADP_READ}, and Gap is ADP minus our rank. '
             f'<span class="wide">GP and A game are {SEASON} through week {THROUGH}. </span>'
             f'Status read {STATUS_READ}.</p>')
    body = f'''<main class="page full">
<div class="content">
<div class="crumb">Clubs / {esc(city)} {esc(nick)}</div>
<section class="hero"><span class="face mark"><img src="https://a.espncdn.com/i/teamlogos/nfl/500/{abbr.lower()}.png" alt=""></span>
<div><h2>{esc(city)} {esc(nick)}</h2><div class="sub">{abbr} · Bye week {byes[abbr]}</div></div>
<div class="figs"><div class="fig"><div class="big">{fixed(slate["strength"], 2)}</div><div class="cap">Opponents' average expected wins</div><div class="read">Read {WINS_READ}</div></div>
<div class="fig"><div class="mid">{hardest}</div><div class="cap">hardest of {len(schedule["slates"])}</div><div class="read">&nbsp;</div></div></div>
</section>
{basis}
<h3 class="section-h">On our {FORMAT_LABEL} board <small>{len(rows)} players</small></h3>
{WIDTHS}
<table class="box">{board_head('board', True, bye=False)}<tbody>{body_rows}</tbody></table>
<h3 class="section-h">Kickers and defense, in draft order</h3>
<table class="box" style="max-width:640px"><thead><tr><th class="l">Player</th><th style="width:120px">Draft order</th><th style="width:90px">ADP</th></tr></thead><tbody>{mk_rows}</tbody></table>
<h3 class="section-h">{SEASON} schedule <small>Weeks 1 to {played} played</small></h3>
<table class="box" style="max-width:640px"><thead><tr><th class="l" style="width:70px">Wk</th><th class="l">Opponent</th><th style="width:140px">Expected wins</th></tr></thead><tbody>{sched}</tbody></table>
</div>
</main>'''
    return shell(f'{city} {nick}', theme, f'{esc(city)} {esc(nick)}', 'Players',
                 '<a class="verb" href="#">Compare two of them</a>', body, manifest['players'])


# ---------- Compare ----------

def compare_page(theme: str, a_id: str, b_id: str) -> str:
    by_id = {r['id']: r for r in ranked}
    a, b = by_id[a_id], by_id[b_id]
    lead, other = (a, b) if a['ourRank'] <= b['ourRank'] else (b, a)
    last = lead['name'].split()[-1]

    def prior(r):
        p = player_file(r['id'])['priorSeasons']
        return next((s for s in p if s['season'] == SEASON - 1), None)

    def season(r):
        return index[r['id']].get('season') or {}

    def cell(v, text, better):
        cls = 'win' if better else ('lose' if better is False else '')
        return f'<td class="{cls}"><span class="n">{text}</span></td>'

    def row(label, va, vb, fmt, higher: bool | None):
        if higher is None or va == vb:
            ba = bb = None
        else:
            ba = (va > vb) == higher
            bb = not ba
        return f'<tr><td class="lab">{label}</td>{cell(va, fmt(va), ba)}{cell(vb, fmt(vb), bb)}</tr>'

    pa, pb = prior(lead), prior(other)
    sa, sb = season(lead), season(other)
    ga = round(lead['adp'] - lead['ourRank'])
    gb = round(other['adp'] - other['ourRank'])
    sg = lambda g: '0' if g == 0 else (f'+{g}' if g > 0 else f'{MINUS}{-g}')
    rows = ''.join([
        row('Our rank', lead['ourRank'], other['ourRank'], str, False),
        row('Position rank', lead['positionRank'], other['positionRank'], lambda v: f'{lead["position"] if v == lead["positionRank"] else other["position"]} {v}', False),
        row('Projected', lead['projected'], other['projected'], fixed, True),
        row('Over replacement', lead['vor'], other['vor'], signed, True),
        f'<tr><td class="lab">Floor to ceiling</td><td>{rng(lead)}</td><td>{rng(other)}</td></tr>',
        row('ADP', lead['adp'], other['adp'], fixed, None),
        row('Gap', ga, gb, sg, None),
        row('Bye', byes[lead['team']], byes[other['team']], str, None),
        row(f'{SEASON} a game', sa.get('pointsPerGame'), sb.get('pointsPerGame'), fixed, True),
        row(f'{SEASON} GP', sa.get('games'), sb.get('games'), str, None),
        row(f'{SEASON - 1} a game', pa['pointsPerGame'], pb['pointsPerGame'], fixed, True),
    ])

    def ph(r, is_lead):
        return (f'<th class="pick {"lead" if is_lead else ""}"><div class="ph">{face(r)}<a href="#">{esc(r["name"])}</a>'
                f'<span class="sub">{r["team"]} · {r["position"]} {r["positionRank"]}</span></div></th>')

    places = other['ourRank'] - lead['ourRank']
    more = lead['vor'] - other['vor']
    evidence = (f'<p class="evidence">{last} is {places} {"place" if places == 1 else "places"} higher on our '
                f'{FORMAT_LABEL} board, with {fixed(more)} more points over replacement.</p>')
    basis = (f'<p class="basis foot">Our {FORMAT_LABEL} projection for the full {SEASON} season, ranked by points over '
             f'replacement in a 12-team league. ADP from {FORMAT_LABEL} drafts, {ADP_READ}, and Gap is ADP minus our rank. '
             f'{SEASON} figures run through week {THROUGH}. {SEASON - 1} a game is last season in {FORMAT_LABEL} points.</p>')
    picker = ''.join(
        f'<div class="picker">{face(r)}<b>{esc(r["name"])}</b><span class="x">Pick someone else</span></div>'
        for r in (a, b))
    body = f'''<main class="page full">
<div class="content">
<div class="head"><h2 class="title">Compare</h2></div>
<div class="pickers">{picker}</div>
<div class="callband ph-only"><div class="callw">We would take {esc(last)}</div><a class="verb" href="#">Add him to your sheet</a></div>
<table class="box cmp"><thead><tr><th class="call wide"><div class="callw">We would take {esc(last)}</div><a class="verb" href="#">Add him to your sheet</a></th>{ph(lead, True)}{ph(other, False)}</tr></thead>
<tbody>{rows}</tbody></table>
{evidence}
{basis}
</div>
</main>'''
    return shell('Compare', theme, 'Compare', 'Players', '', body, manifest['players'])


PAGES = {
    'board-all': lambda t: board_page(t, None),
    'board-wr': lambda t: board_page(t, 'WR'),
    'adp': adp_page,
    'club-dal': lambda t: club_page(t, 'DAL'),
    'compare': lambda t: compare_page(t, '4426515', '4362628'),
}

for name, build in PAGES.items():
    for theme in ('dark', 'light'):
        with open(os.path.join(OUT, f'{name}-{theme}.html'), 'w') as fh:
            fh.write(build(theme))
print('wrote', len(PAGES) * 2, 'files; through week', THROUGH, 'adp read', ADP_READ, 'status read', STATUS_READ,
      'wins read', WINS_READ)
