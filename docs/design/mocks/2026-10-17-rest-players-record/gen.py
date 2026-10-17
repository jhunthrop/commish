"""Lane 66j mock: Rest of season, Players and Our record as box scores.

python3 gen.py <design authority league.html> <in-season fixture data dir> <out dir>

Writes rest-{dark,light}.html, players-{dark,light}.html and record-{dark,light}.html. The shell CSS
(tokens, type, rail, top bar, chips, search) is lifted from the design authority's league.html, and the
table CSS is Lane 66e's lineup.css with Lane 66f's waivers.css (copied beside this file), as the
box-score lanes did. This lane's own rules are in boxes.css beside it.

Data, real where named:
- The league is the in-season fixture's Sleeper league (S.U.C.K., a real 12-team league read in week 6),
  the member's team McConkey Kong Country (roster 1). Who holds whom is the fixture's held_by.
- Every PlayerLine the fixture carries (lineup, waivers, trades, matchup answers) gives his position rank
  in our rest-of-season order, his rest-of-season points a game, his status, Avg, Last and Opp rank: real.
  Every Proj is the fixture's one projection snapshot (the week 1 published figure): a stand-in.
- The week 6 Game cell is the fixture's games.json (kickoff, expected points, roof and weather): real.
- Players the fixture does not carry are named from our frozen week 2 board in dev (board.csv, read
  only from research.register_freeze_rows), and every figure on them is a stand-in: points a game is
  the board's season points over 17, the rest is made up.
- Rest of season's total is points a game times the club's games left (weeks 6 to 17, byes out), so it
  is as real as the points a game. Δ rank is a stand-in (dev holds one rest-of-season board).
- Our record's weeks 1 and 2 are graded from dev's research.register_grade_rows (board v9, PPR), on the
  players both our board and ADP ranked (same.json from same.py): real. Weeks 3 to 5 and every
  published-projection figure are stand-ins (dev holds no grades past week 2, and no published
  projection rows).
Stand-ins carry class "si" and print with a dotted underline.
"""
from __future__ import annotations

import csv
import html
import json
import os
import sys
import zlib
from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

AUTH, FIX, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
CENTRAL = ZoneInfo('America/Chicago')

src = open(AUTH).read()
SHELL_CSS = src[src.index('<style>') + len('<style>'):src.index('.lrow{')]
FONTS = src[src.index('<link rel="preconnect"'):src.index('<style>')]
CSS = ''.join(open(os.path.join(HERE, f)).read() for f in ('lineup.css', 'waivers.css', 'boxes.css'))

HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/{}.png'
CLUB_MARK = 'https://a.espncdn.com/i/teamlogos/nfl/500/{}.png'
PLATFORM = 'Sleeper'
LEAGUE = 'S.U.C.K.'
WEEK = 6
LAST_WEEK = 17
CLUB_CODE = {'LA': 'LAR', 'WAS': 'WSH'}


def load(name: str):
    return json.load(open(os.path.join(FIX, name)))


SYNC = load('sync.json')
GAMES = {g['team']: g for g in load('games.json')['games']}
TEAMS = {t['roster_id']: t['name'] for t in SYNC['teams']}
TEAM = TEAMS[SYNC['me']]
HELD = SYNC['held_by']
BYES = SYNC['byes']


def esc(s: str) -> str:
    return html.escape(s)


def svg(path: str, size: int = 14, stroke: float = 2) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')


GLYPH = {
    'wind': svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>'),
    'dome': svg('<path d="M3 19h18M5 19v-5a7 7 0 0 1 14 0v5"/>'),
    'retractable': svg('<path d="M3 19h18M5 19v-6l7-5 7 5v6"/><path d="M12 8V4"/>'),
    'abroad': svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
}
PLUS = svg('<path d="M12 5v14M5 12h14"/>', 14, 2.4)
OPEN = svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 14)
SWAP = svg('<path d="M4 8h14l-3-3M20 16H6l3 3"/>', 14)
SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 16)
SORT_DOWN = svg('<path d="M6 9l6 6 6-6"/>', 12, 2.6)
SORT_UP = svg('<path d="M6 15l6-6 6 6"/>', 12, 2.6)
FLAG = svg('<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>', 16)
CHEV = svg('<path d="M6 9l6 6 6-6"/>', 14)
UP = svg('<path d="M6 15l6-6 6 6"/>', 10, 3)
DOWN = svg('<path d="M6 9l6 6 6-6"/>', 10, 3)


@dataclass(frozen=True)
class Fig:
    """A figure and whether it is a stand-in in this mock."""
    value: float | None
    stand_in: bool = False


NONE = Fig(None)


def si(v: float | None) -> Fig:
    return Fig(v, True)


@dataclass(frozen=True)
class P:
    name: str
    club: str
    pos: str
    pid: str | None  # None draws the club mark
    status: str | None
    pos_rank: Fig
    delta: Fig
    proj: Fig
    ros: Fig
    total: Fig
    avg: Fig
    last: Fig
    opp: Fig
    mark: str | None  # 'yours', 'free', or the holding team's name; None with no league

    @property
    def short(self) -> str:
        return self.name.split(' ')[-1] if self.pos != 'D/ST' else self.name


def club(code: str) -> str:
    return CLUB_CODE.get(code, code)


def games_left(c: str) -> int:
    bye = BYES.get(c)
    return LAST_WEEK - WEEK + 1 - (1 if bye is not None and WEEK <= bye <= LAST_WEEK else 0)


def stand_in_delta(name: str) -> Fig:
    return si(float(zlib.crc32(name.encode()) % 7 - 3))


def roster_mark(board_id: str | None) -> str:
    holder = HELD.get(board_id or '')
    if holder is None:
        return 'free'
    return 'yours' if holder == SYNC['me'] else TEAMS[holder]


STATUS_WORDS = {'questionable': 'Questionable', 'doubtful': 'Doubtful', 'out': 'Out', 'injured_reserve': 'IR'}


def harvest() -> dict[str, dict]:
    """Every PlayerLine in the fixture's answers, the fullest copy of each."""
    lines: dict[str, tuple[int, dict]] = {}

    def walk(x) -> None:
        if isinstance(x, dict):
            if isinstance(x.get('player'), dict) and 'rest_of_season_per_game' in x:
                bid = x['player']['board_id']
                score = sum(v is not None for v in x.values())
                if bid not in lines or score > lines[bid][0]:
                    lines[bid] = (score, x)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for f in ('lineup.json', 'waivers.json', 'trades.json', 'matchup.json'):
        walk(load(f))
    return {k: v[1] for k, v in lines.items()}


LINES = harvest()
BOARD = list(csv.DictReader(open(os.path.join(HERE, 'board.csv'))))


def from_line(line: dict, league: bool = True) -> P:
    p = line['player']
    c = club(p['team'])
    ros = line.get('rest_of_season_per_game')
    des = (line.get('facts') or {}).get('designation')
    pos = 'D/ST' if p['position'] == 'DEF' else p['position']
    return P(
        name=p['name'], club=c, pos=pos, pid=None if pos == 'D/ST' else p['board_id'],
        status=STATUS_WORDS.get(des['status']) if des else None,
        pos_rank=Fig(line.get('position_rank')) if ros is not None else NONE,
        delta=stand_in_delta(p['name']) if ros is not None else NONE,
        proj=si(line.get('week_projection')),
        ros=Fig(ros), total=Fig(None if ros is None else round(ros * games_left(c), 1)),
        avg=Fig(line.get('season_avg')), last=Fig(line.get('last_points')), opp=Fig(line.get('opp_rank')),
        mark=roster_mark(p['board_id']) if league and pos != 'D/ST' else None)


def from_board(row: dict, pos_rank: int | None, league: bool = True) -> P:
    """A player the fixture does not carry: named from our frozen board, every figure a stand-in."""
    c = club(row['latest_team'])
    per_game = round(float(row['board_points']) / 17, 1)
    h = zlib.crc32(row['name'].encode())
    return P(
        name=row['name'], club=c, pos=row['position'], pid=row['espn_id'], status=None,
        pos_rank=si(pos_rank), delta=stand_in_delta(row['name']),
        proj=si(None if c in ('CIN', 'DET', 'MIA', 'MIN') else round(per_game * (0.9 + (h % 30) / 100), 1)),
        ros=si(per_game), total=si(round(per_game * games_left(c), 1)),
        avg=si(round(per_game * (0.8 + (h % 40) / 100), 1)), last=si(round(per_game * (0.4 + (h % 120) / 100), 1)),
        opp=si(None if c in ('CIN', 'DET', 'MIA', 'MIN') else 1 + h % 32),
        mark=roster_mark(row['espn_id']) if league else None)


# ---------- cells ----------

def ordinal(n: int) -> str:
    suffix = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suffix}'


def text(v: float, signed: bool = False, digits: int = 1) -> str:
    s = f'{v:+.{digits}f}' if signed else f'{v:.{digits}f}'
    return s.replace('-', '&minus;')


def wrap(f: Fig, inner: str) -> str:
    return f'<span class="si">{inner}</span>' if f.stand_in else inner


def num(f: Fig, digits: int = 1) -> str:
    if f.value is None:
        return '<span class="dash">--</span>'
    return wrap(f, text(f.value, digits=digits))


def ease(f: Fig) -> str:
    if f.value is None:
        return '<span class="dash">--</span>'
    n = int(f.value)
    tone = 'easy' if n >= 23 else 'hard' if n <= 10 else 'mid'
    return f'<span class="rk {tone}">{wrap(f, ordinal(n))}</span>'


def delta(f: Fig) -> str:
    if f.value is None:
        return '<span class="dash">--</span>'
    n = int(f.value)
    if n == 0:
        return f'<span class="dlt even">{wrap(f, "0")}</span>'
    return f'<span class="dlt {"up" if n > 0 else "down"}">{UP if n > 0 else DOWN}{wrap(f, str(abs(n)))}</span>'


def face(p: P, size: int = 32) -> str:
    if p.pid is None:
        return (f'<span class="face mark-face" style="width:{size}px;height:{size}px"><img src="{CLUB_MARK.format(p.club.lower())}" '
                f'alt="" width="{size}" height="{size}"></span>')
    return (f'<span class="face" style="width:{size}px;height:{size}px"><img src="{HEADSHOT.format(p.pid)}" alt="" '
            f'width="{size}" height="{size}"></span>')


def pill(p: P) -> str:
    rank = ''
    if p.pos_rank.value is not None:
        rank = wrap(p.pos_rank, str(int(p.pos_rank.value)))
    out = f'<span class="pos">{p.pos}{rank}</span>'
    if p.status:
        tone = {'Questionable': 'even', 'Doubtful': 'loss', 'Out': 'loss', 'IR': 'ir'}[p.status]
        out += f'<span class="tchip {tone}">{p.status}</span>'
    return out


def halves(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f'{x:.1f}'


def kickoff(iso: str) -> str:
    t = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(CENTRAL)
    return t.strftime('%a %-I:%M %p').replace('AM', 'am').replace('PM', 'pm')


def game_lines(p: P) -> tuple[str, str]:
    g = GAMES.get(p.club)
    if g is None:
        return '<span class="bye">Bye</span>', ''
    where = 'vs' if g['home'] else 'at'
    first = f'<span class="opp"><b>{where} {club(g["opponent"])}</b><span>{kickoff(g["kickoff"])}</span></span>'
    facts = []
    if g.get('game_total'):
        team = g['game_total']['team_points']
        facts.append(f'<span class="exp">{halves(team)} to {halves(g["game_total"]["points"] - team)}</span>')
    roof = (g.get('roof') or {})
    if roof.get('abroad'):
        facts.append(f'<span class="wx">{GLYPH["abroad"]}Abroad</span>')
    elif roof.get('kind') == 'dome':
        facts.append(f'<span class="wx">{GLYPH["dome"]}Indoors</span>')
    elif g.get('weather'):
        w = g['weather']
        facts.append(f'<span class="wx">{GLYPH["wind"]}{w["temperature_f"]}°, {round(w["wind_mph"])} mph</span>')
    elif roof.get('kind') == 'retractable':
        facts.append(f'<span class="wx">{GLYPH["retractable"]}Roof TBD</span>')
    return first, f'<span class="facts">{"".join(facts)}</span>'


def mark_cell(p: P) -> str:
    if p.mark is None:
        return ''
    if p.mark == 'yours':
        inner = '<span class="own yours">Yours</span>'
    elif p.mark == 'free':
        inner = '<span class="own free">Free</span>'
    else:
        inner = f'<span class="own team">{esc(p.mark)}</span>'
    return f'<td class="roster">{inner}</td>'


def phone_mark(p: P) -> str:
    """The roster mark, which the phone carries on the club line in place of the Roster column."""
    if p.mark is None:
        return ''
    cls, word = {'yours': ('yours', 'Yours'), 'free': ('free', 'Free')}.get(p.mark, ('team', esc(p.mark)))
    return f'<span class="own {cls} ph-mark">{word}</span>'


def phone_line(p: P) -> str:
    """The phone folds the game and two figures under the name."""
    first, _ = game_lines(p)
    ev = [x for x in (f'Avg {num(p.avg)}' if p.avg.value is not None else '',
                      f'Last {num(p.last)}' if p.last.value is not None else '') if x]
    return f'<span class="ph"><span class="ph-g">{first}<span class="ph-e">{", ".join(ev)}</span></span></span>'


def player_cell(p: P, with_mark: bool) -> str:
    return (f'<td class="player"><span class="pl">{face(p)}<span class="who">'
            f'<span class="nm"><a href="#">{esc(p.name)}</a></span>'
            f'<span class="sub"><span class="club">{p.club}</span>{pill(p)}{phone_mark(p) if with_mark else ""}</span>'
            f'{phone_line(p)}</span></span></td>')


def rank_cell(p: P) -> str:
    return f'<td class="n rank">{num(p.pos_rank, 0)}</td>'


def figures(p: P) -> str:
    first, second = game_lines(p)
    return (f'<td class="game">{first}{second}</td>'
            f'<td class="n proj">{num(p.proj)}</td>'
            f'<td class="n ros pg">{num(p.ros)}</td>'
            f'<td class="n ev tot">{num(p.total)}</td>'
            f'<td class="n ev rkc">{num(p.avg)}</td>'
            f'<td class="n ev">{num(p.last)}</td>'
            f'<td class="n ev opp-r">{ease(p.opp)}</td>')


def th(label: str, cls: str, sort: str | None = None) -> str:
    caret = ''
    if sort:
        caret = f'<span class="caret">{SORT_UP if sort == "asc" else SORT_DOWN}</span>'
    aria = f' aria-sort="{"ascending" if sort == "asc" else "descending"}"' if sort else ''
    return f'<th class="{cls}{" sorted" if sort else ""}"{aria}><button type="button" class="sort">{label}{caret}</button></th>'


def figure_heads(ros_sort: str | None) -> str:
    return (th('Game', 'game') + th('Proj', 'n proj')
            + th('A game', 'n ros pg', ros_sort) + th('Total', 'n ev tot')
            + th('Avg', 'n ev rkc') + th('Last', 'n ev') + th('Opp rank', 'n ev opp-r'))


def group_row(lead_span: int, tail_span: int) -> str:
    """The head's first row: the rest-of-season pair named once over its two columns."""
    return (f'<tr class="grp"><th colspan="{lead_span}"></th><th class="g-ros" colspan="2"><span>Rest of season</span></th>'
            f'<th colspan="{tail_span}"></th></tr>')


# ---------- shell ----------

RAIL_ITEMS = [
    ('Lineup', '<path d="M8 3l-5 4 2 3 2-1v12h10V9l2 1 2-3-5-4c0 2-1.5 3-4 3S8 5 8 3z"/>'),
    ('Matchup', '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.8-3 3-5 6-5s5.2 2 6 5M14 15c3 0 5.2 2 6 5"/>'),
    ('Waivers', '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-3.6 3.8-6 7-6 1.5 0 2.9.5 4 1.4M18 12v6M15 15h6"/>'),
    ('Trades', '<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
    ('Players', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    ('Rest of season', '<path d="M4 6h16M4 11h12M4 16h8"/>'),
    ('Our record', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
]


def rail(current: str) -> str:
    items = ''.join(
        f'<a class="item{" wide-only" if label in ("Rest of season", "Our record") else ""}" href="#"'
        f'{" aria-current=page" if label == current else ""}>{svg(path, 22, 1.8)}<span>{label}</span></a>'
        for label, path in RAIL_ITEMS)
    account = svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>', 22, 1.8)
    return (f'<nav class="rail" aria-label="Sections"><a class="mark" href="#" aria-label="Commish"><b>C</b></a>{items}'
            f'<span class="spacer"></span><a class="item wide-only" href="#">{account}<span>Account</span></a></nav>')


LEAGUE_SWITCH = f'<button type="button" class="quiet">{FLAG}<span>{esc(TEAM)}</span>{CHEV}</button>'
SIGN_IN = '<a class="quiet" href="#">Sign in</a>'


def page(name: str, theme: str, bar: str, current: str, tail: str, note: tuple[str, str], body: str) -> None:
    doc = f'''<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Commish {bar} (Lane 66j mock, {theme})</title>
{FONTS}<style>{SHELL_CSS}{CSS}</style>
</head>
<body class="pg-{name}">
<div class="app">
{rail(current)}
<div class="main">
<header class="top"><h1>{bar}</h1><div class="tail">{tail}</div></header>
<main class="mx">
  <p class="mocknote"><span class="long">{note[0]}</span><span class="short">{note[1]}</span></p>
  {body}
</main>
</div>
</div>
</body>
</html>
'''
    open(os.path.join(OUT, f'{name}-{theme}.html'), 'w').write(doc)


def basis(lines: list[str]) -> str:
    return f'<div class="basis" data-basis>{"".join(f"<p>{x}</p>" for x in lines)}</div>'


def chips(label: str, items: list[str], on: str) -> str:
    inner = ''.join(f'<button type="button" class="chip" aria-pressed="{"true" if i == on else "false"}">{i}</button>'
                    for i in items)
    return f'<div class="chip-group" role="group" aria-label="{label}">{inner}</div>'


SHORT_NOTE = 'Mock. Dotted figures are stand-ins, named on the desk shot.'

# ---------- Rest of season ----------


def rest_rows() -> list[P]:
    """The RB tab: the fixture's backs at their real places in our order, the gaps filled from our board."""
    real = {}
    for line in LINES.values():
        if line['player']['position'] == 'RB' and line.get('rest_of_season_per_game') is not None:
            p = from_line(line)
            real[int(p.pos_rank.value)] = p
    taken = {p.name for p in real.values()}
    fill = (r for r in BOARD if r['position'] == 'RB' and r['name'] not in taken)
    rows = []
    for rank in range(1, 39):
        rows.append(real[rank] if rank in real else from_board(next(fill), rank))
    return rows


def verb(p: P) -> str:
    if p.mark == 'free':
        return (f'<td class="act"><button type="button" class="add rv" aria-label="Add {esc(p.short)} on {PLATFORM}">'
                f'{PLUS}<span>Add</span></button></td>')
    if p.mark not in (None, 'yours'):
        return (f'<td class="act"><button type="button" class="add rv quiet-v" aria-label="Trade for {esc(p.short)}">'
                f'{SWAP}<span>Trade for him</span></button></td>')
    return '<td class="act"></td>'


def rest_table() -> str:
    rows = []
    for p in rest_rows():
        cls = 'pk' + (' mine' if p.mark == 'yours' else '')
        rows.append(f'<tr class="{cls}">{rank_cell(p)}<td class="n dl">{delta(p.delta)}</td>{player_cell(p, True)}'
                    f'{mark_cell(p)}{figures(p)}{verb(p)}</tr>')
    cols = ('<colgroup><col class="c-rank"><col class="c-delta"><col class="c-player"><col class="c-roster"><col class="c-game">'
            '<col class="c-proj"><col class="c-ros"><col class="c-tot"><col class="c-ev"><col class="c-ev"><col class="c-rk">'
            '<col class="c-verb"></colgroup>')
    head = ('<thead>' + group_row(6, 4) + '<tr class="cols">' + th('#', 'n rank', 'asc') + th('&Delta;', 'n dl') + th('Player', 'player')
            + th('Roster', 'roster') + figure_heads(None) + '<th class="act"><span class="vh">Move</span></th></tr></thead>')
    return (f'<table class="lineup pool box" aria-label="Running backs in our rest-of-season order">{cols}{head}'
            f'<tbody>{"".join(rows)}</tbody></table>')


REST_NOTE = ('Mock for Lane 66j. Dotted figures are stand-ins. The league is the recorded Sleeper league in week 6, and Roster is its real holdings. '
             'Every back the fixture carries (14th to 38th but seven) is real: his place in our order, Rest of season, Avg, Last, Opp rank and status. '
             'The others are named from our frozen board with made-up figures. Every Proj is the week 1 published figure. &Delta; is made up.')


def rest(theme: str) -> None:
    mine = sum(1 for p in rest_rows() if p.mark == 'yours')
    free = sum(1 for p in rest_rows() if p.mark == 'free')
    body = f'''<div class="title"><h2>Rest of season</h2><p class="lede">Our order from week {WEEK}, PPR, with each player's roster in {LEAGUE} on {PLATFORM}. Times are in Central Time.</p></div>
  <div class="filters">{chips('Position', ['All', 'QB', 'RB', 'WR', 'TE'], 'RB')}{chips('Roster', ['Everyone', 'Free', 'Yours'], 'Everyone')}
    <label class="search">{SEARCH}<input type="search" placeholder="Find a player" aria-label="Find a player"></label>
    <span class="count"><b>{mine}</b> yours, <b>{free}</b> free in this view</span></div>
  {rest_table()}
  {basis([
      f'Our rest-of-season order, refreshed Wed Oct 14, 2:05 pm, over the games his club has left through week {LAST_WEEK}, byes out. '
      'Rest of season is his points a game and his total on it. &Delta; is his move in our order since last week.',
      'Proj is this week\'s published projection in PPR, read <span class="si">Fri Oct 16, 9:00 pm</span>. Avg and Last are his points a game this season and in his last game. '
      'Opp rank is where his opponent stands in points allowed to his position, 1st allows the fewest.',
      f'Roster is read from {PLATFORM} 4 minutes ago. {PLATFORM} takes no claims or offers from here, so Add and Trade for him copy his name and open {PLATFORM}.',
  ])}'''
    page('rest', theme, 'Rest of season', 'Rest of season', LEAGUE_SWITCH, (REST_NOTE, SHORT_NOTE), body)


# ---------- Players ----------

QUERY = 'Hou'


def players_rows() -> list[P]:
    """Everyone the search finds for "Hou": the Houston players, K and D/ST included, in our order."""
    real = {}
    for line in LINES.values():
        if club(line['player']['team']) == 'HOU':
            p = from_line(line, league=False)
            real[p.name] = p
    rows = list(real.values())
    for r in BOARD:
        if club(r['latest_team']) == 'HOU' and r['name'] not in real and r['position'] in ('QB', 'RB', 'WR', 'TE'):
            same = [x for x in BOARD if x['position'] == r['position']]
            rows.append(from_board(r, same.index(r) + 1, league=False))
    kicker = P("Ka'imi Fairbairn", 'HOU', 'K', '2971573', None, NONE, NONE, si(8.1), NONE, NONE, si(8.4), si(9.0), si(11), None)
    rows = [x for x in rows if x.ros.value is not None or x.pos == 'D/ST']
    ranked = sorted((x for x in rows if x.ros.value is not None), key=lambda x: -x.ros.value)
    return ranked[:9] + [kicker] + [x for x in rows if x.pos == 'D/ST']


def sheet_verb(p: P) -> str:
    return (f'<td class="act"><button type="button" class="add rv" aria-label="Add {esc(p.short)} to your sheet">'
            f'{PLUS}<span>Sheet</span></button></td>')


def players_table() -> str:
    rows = [f'<tr class="pk">{rank_cell(p)}{player_cell(p, False)}{figures(p)}{sheet_verb(p)}</tr>' for p in players_rows()]
    cols = ('<colgroup><col class="c-rank"><col class="c-player"><col class="c-game"><col class="c-proj"><col class="c-ros">'
            '<col class="c-tot"><col class="c-ev"><col class="c-ev"><col class="c-rk"><col class="c-sheet"></colgroup>')
    head = ('<thead>' + group_row(4, 4) + '<tr class="cols">' + th('Pos #', 'n rank') + th('Player', 'player') + figure_heads('desc')
            + '<th class="act"><span class="vh">Add to your sheet</span></th></tr></thead>')
    return (f'<table class="lineup pool box" aria-label="Players matching {QUERY}">{cols}{head}'
            f'<tbody>{"".join(rows)}</tbody></table>')


PLAYERS_NOTE = ('Mock for Lane 66j, signed out. Dotted figures are stand-ins. Stroud, Montgomery, Hutchinson, Schultz and the Texans are the fixture\'s real lines. '
                'Collins, Harrison, Noel, Boutte, Klein and Fairbairn are named from our frozen board with made-up figures. Every Proj is the week 1 published figure.')


def players(theme: str) -> None:
    n = len(players_rows())
    body = f'''<div class="title"><h2>Players</h2><p class="lede">Every player in our order, with kickers and defenses. Follow your league to see whose roster each is on.</p></div>
  <label class="search big">{SEARCH}<input type="search" value="{QUERY}" aria-label="Find a player or a club"><span class="hits">{n} players</span></label>
  <div class="filters">{chips('Position', ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'], 'All')}</div>
  {players_table()}
  {basis([
      f'Pos # is his place at his position in our rest-of-season order, refreshed Wed Oct 14, 2:05 pm. Rest of season is his points a game over the games his club has left through week {LAST_WEEK}, byes out, and his total. '
      'Kickers and defenses are not in that order.',
      'Proj is this week\'s published projection in PPR, read <span class="si">Fri Oct 16, 9:00 pm</span>. Avg and Last are in PPR. Opp rank is points allowed to his position, 1st allows the fewest.',
  ])}'''
    page('players', theme, 'Players', 'Players', SIGN_IN, (PLAYERS_NOTE, SHORT_NOTE), body)


# ---------- Our record ----------

SAME = json.load(open(os.path.join(HERE, 'same.json')))


@dataclass(frozen=True)
class Score:
    rho: Fig
    off: Fig
    right: Fig  # starters called right, of OF
    of: int = 84


def real_score(s: dict) -> Score:
    return Score(Fig(s['rho']), Fig(s['off']), Fig(s['starters']), s['of'])


def fake(rho: float, off: float, right: int) -> Score:
    return Score(si(rho), si(off), si(right))


@dataclass(frozen=True)
class Week:
    week: int
    order: str
    frozen: str
    players: Fig
    ours: Score | None
    adp: Score | None
    pub: Score | None
    status: str


PUB = [fake(0.55, 40.1, 54), fake(0.50, 42.0, 53), fake(0.57, 39.8, 55), fake(0.47, 43.5, 51), fake(0.53, 41.2, 54)]
WEEKS = [
    Week(1, 'Preseason board', 'Sep 8', Fig(SAME['1']['same_ours']['n']), real_score(SAME['1']['same_ours']),
         real_score(SAME['1']['same_adp']), PUB[0], 'Graded Oct 13'),
    Week(2, 'Preseason board', 'Sep 10', Fig(SAME['2']['same_ours']['n']), real_score(SAME['2']['same_ours']),
         real_score(SAME['2']['same_adp']), PUB[1], 'Graded Oct 13'),
    Week(3, 'Preseason board', 'Sep 17', si(191), fake(0.52, 42.1, 52), fake(0.38, 49.0, 49), PUB[2], '<span class="si">Graded Oct 13</span>'),
    Week(4, 'Preseason board', 'Sep 24', si(186), fake(0.44, 45.8, 47), fake(0.35, 50.2, 50), PUB[3], '<span class="si">Graded Oct 13</span>'),
    Week(5, 'Preseason board', 'Oct 1', si(184), fake(0.49, 43.2, 51), fake(0.41, 47.5, 48), PUB[4], '<span class="si">Graded Oct 13</span>'),
    Week(6, 'Rest of season', 'Oct 15', NONE, None, None, None, 'Graded after Monday'),
]


def pooled(scores: list[Score]) -> Score:
    n = len(scores)
    return Score(si(round(sum(s.rho.value for s in scores) / n, 2)), si(round(sum(s.off.value for s in scores) / n, 1)),
                 si(sum(s.right.value for s in scores)), sum(s.of for s in scores))


GRADED = [w for w in WEEKS if w.ours]
TO_DATE = {k: pooled([getattr(w, k) for w in GRADED]) for k in ('ours', 'adp', 'pub')}


def share(s: Score) -> float:
    return s.right.value / s.of


METRICS = (
    ('rho', 'Rank corr', lambda s: s.rho.value, True),
    ('off', 'Places off', lambda s: s.off.value, False),
    ('right', 'Starters right', share, True),
)


def metric_cell(s: Score | None, key: str, best: bool, source: str) -> str:
    if s is None:
        return f'<td class="n m m-{key} s-{source}"><span class="dash">--</span></td>'
    cls = f'n m m-{key} s-{source}{" best" if best else ""}'
    if key == 'rho':
        inner = wrap(s.rho, f'{s.rho.value:.2f}')
    elif key == 'off':
        inner = wrap(s.off, f'{s.off.value:.1f}')
    else:
        inner = (f'{wrap(s.right, f"{round(100 * share(s))}%")}'
                 f'<span class="of">{wrap(s.right, str(int(s.right.value)))} of {s.of}</span>')
    return f'<td class="{cls}">{inner}</td>'


def metric_cells(w_scores: dict[str, Score | None]) -> str:
    out = []
    for key, _, get, high in METRICS:
        vals = {k: get(v) for k, v in w_scores.items() if v is not None}
        top = (max if high else min)(vals.values()) if vals else None
        for source in ('ours', 'adp', 'pub'):
            s = w_scores[source]
            out.append(metric_cell(s, key, s is not None and get(s) == top, source))
    return ''.join(out)


def record_table() -> str:
    rows = []
    for w in WEEKS:
        cells = metric_cells({'ours': w.ours, 'adp': w.adp, 'pub': w.pub})
        live = ' live' if w.order == 'Rest of season' else ''
        rows.append(f'<tr class="wk{live}"><td class="wkn">Week {w.week}</td><td class="ord"><b>{w.order}</b><span>Frozen {w.frozen}</span></td>'
                    f'<td class="n plc">{num(w.players, 0)}</td>{cells}<td class="st">{w.status}</td></tr>')
    rows.append(f'<tr class="wk later"><td class="wkn">Weeks 7 to {LAST_WEEK}</td><td class="ord" colspan="11"><b>Rest of season</b>'
                f'<span>Next freeze before Thursday&rsquo;s kickoff, Oct 22</span></td><td class="st"></td></tr>')
    tot = metric_cells(TO_DATE)
    n_total = sum(int(w.players.value) for w in GRADED)
    rows.append(f'<tr class="totals"><td class="tl" colspan="2">Weeks 1 to 5</td><td class="n plc">{wrap(si(n_total), str(n_total))}</td>{tot}<td></td></tr>')
    group = ''.join(f'<th class="mg m-{k}" colspan="3"><span>{label}</span></th>' for k, label, _, _ in METRICS)
    sub = ''.join(f'<th class="n m m-{k} s-{s}"><span class="sort">{n}</span></th>'
                  for k, *_ in METRICS for s, n in (('ours', 'Ours'), ('adp', 'ADP'), ('pub', 'Published')))
    cols = ('<colgroup><col class="c-wk"><col class="c-ord"><col class="c-plc">' + '<col class="c-m">' * 9 + '<col class="c-st"></colgroup>')
    head = (f'<thead><tr class="grp"><th colspan="3"></th>{group}<th></th></tr>'
            f'<tr class="cols"><th><span class="sort">Week</span></th><th><span class="sort">Order</span></th>'
            f'<th class="n plc"><span class="sort">Players</span></th>{sub}<th><span class="sort">Status</span></th></tr></thead>')
    return f'<table class="lineup box record" aria-label="Our record week by week">{cols}{head}<tbody>{"".join(rows)}</tbody></table>'


def bug() -> str:
    o, a, p = TO_DATE['ours'], TO_DATE['adp'], TO_DATE['pub']
    tiles = ''.join(
        f'<div class="tile"><span class="t-l">{label}</span><span class="t-v">'
        f'<b class="o">{fmt(o)}</b><span>ADP {fmt(a)}</span><span>Published {fmt(p)}</span></span></div>'
        for label, fmt in (
            ('Rank corr', lambda s: wrap(s.rho, f'{s.rho.value:.2f}')),
            ('Places off', lambda s: wrap(s.off, f'{s.off.value:.1f}')),
            ('Starters right', lambda s: wrap(s.right, f'{round(100 * share(s))}%')),
        ))
    return f'''<section class="decide recbug" aria-label="Weeks 1 to 5">
  <div class="d-head"><span class="d-wk">Weeks 1 to 5</span><h3>Preseason board</h3></div>
  <div class="tiles">{tiles}</div>
  <p class="honest">The published projection called these weeks better than our preseason board did,
  <span class="si">0.52</span> against <span class="si">0.48</span>, and ADP had more starters right, <span class="si">251</span> of 420 against our <span class="si">250</span>.
  Our board ranks the season, not each week. A weekly number of ours is shown here only once it passes its test.</p>
</section>'''


def chart() -> str:
    """Rank corr by week for the three orders, weeks 1 to 17 on the axis, the graded ones drawn."""
    w, h, left, right, top, bottom = 860, 220, 44, 120, 16, 30
    x = lambda wk: left + (wk - 1) * (w - left - right) / (LAST_WEEK - 1)  # noqa: E731
    y = lambda v: top + (1 - v / 0.8) * (h - top - bottom)  # noqa: E731
    grid = ''.join(f'<line x1="{left}" x2="{w - right}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="gl"/>'
                   f'<text x="{left - 8}" y="{y(v) + 4:.1f}" class="ax" text-anchor="end">{v:.1f}</text>' for v in (0, 0.2, 0.4, 0.6, 0.8))
    ticks = ''.join(f'<text x="{x(k):.1f}" y="{h - 8}" class="ax{" dim" if k > 5 else ""}" text-anchor="middle">{k}</text>'
                    for k in range(1, LAST_WEEK + 1))
    series = []
    placed: list[float] = []
    ends = sorted((('ours', 'Ours', 's-ours'), ('adp', 'ADP', 's-adp'), ('pub', 'Published', 's-pub')),
                  key=lambda s: y(getattr(GRADED[-1], s[0]).rho.value))
    for key, label, cls in ends:
        pts = [(x(wk.week), y(getattr(wk, key).rho.value)) for wk in GRADED]
        path = ' '.join(f'{"M" if i == 0 else "L"}{px:.1f},{py:.1f}' for i, (px, py) in enumerate(pts))
        dots = ''.join(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="3.5"/>' for px, py in pts)
        lx, ly = pts[-1]
        label_y = max([ly + 4] + [p + 15 for p in placed])
        placed.append(label_y)
        series.append(f'<g class="{cls}"><path d="{path}"/>{dots}<text x="{lx + 10:.1f}" y="{label_y:.1f}">{label}</text></g>')
    now = f'<line x1="{x(6):.1f}" x2="{x(6):.1f}" y1="{top}" y2="{h - bottom}" class="now"/><text x="{x(6) + 6:.1f}" y="{top + 10}" class="ax">Week 6 frozen</text>'
    return f'''<figure class="chart"><figcaption>Rank corr by week</figcaption>
  <svg viewBox="0 0 {w} {h}" role="img" aria-label="Rank correlation by week for our order, ADP and the published projection">{grid}{ticks}{now}{"".join(series)}</svg></figure>'''


RECORD_NOTE = ('Mock for Lane 66j. Dotted figures are stand-ins. Weeks 1 and 2 are graded from the dev register (our board v9 against ADP, on the players both ranked): real. '
               'Weeks 3 to 5 and every published-projection figure are made up, since dev holds no grades past week 2 and no published projection rows. The pooled figures inherit them.')


def record(theme: str) -> None:
    body = f'''<div class="title"><h2>Our record</h2><p class="lede">How our order called each week, beside ADP and a published projection. Graded in PPR.</p></div>
  {bug()}
  <div class="filters">{chips('Position', ['All', 'QB', 'RB', 'WR', 'TE'], 'All')}<div class="segs m-pick" role="group" aria-label="Figure">{"".join(f'<button type="button" class="chip" aria-pressed="{"true" if k == "rho" else "false"}">{label}</button>' for k, label, _, _ in METRICS)}</div></div>
  {record_table()}
  {chart()}
  {basis([
      'Each week\'s order is frozen before that week\'s first kickoff and graded on the players every order ranked. Weeks 1 to 5 grade our preseason board, week 6 on is our rest-of-season order.',
      'Rank corr is the rank correlation with the week\'s finish, 1 is a perfect order. Places off is how far a typical player finished from his place. '
      'Starters right is how many of the week\'s top 12 QBs, 24 RBs, 36 WRs and 12 TEs the order had there.',
      'The published projection is one provider\'s weekly projection, read before each kickoff.',
  ])}'''
    page('record', theme, 'Our record', 'Our record', LEAGUE_SWITCH, (RECORD_NOTE, SHORT_NOTE), body)


for t in ('dark', 'light'):
    rest(t)
    players(t)
    record(t)
print('ok', TEAM, len(rest_rows()), [p.name for p in players_rows()], TO_DATE)
