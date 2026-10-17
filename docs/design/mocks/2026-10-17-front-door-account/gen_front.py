"""Lane 66k mock: the front door in season, signed in with a league, and the Account room.

Writes front-{dark,light}.html and account-{dark,light}.html.

The shell CSS (tokens, type, rail, top bar) is lifted from the design authority's league.html, the score bug
and avatars are Lane 66i's (league.css), the swap chips are Lane 66e's decision strip (lineup.css).

Real, from the record: S.U.C.K. on Sleeper read in week 6 (the member's team, record, place, the pairing with
thatmattkelley and both records), the in-season fixture (web/scripts/inseason-fixture/data: the lineup as set
and as advised, the three swaps and their Proj, Odunze's Questionable of Fri 4:00 pm, LaPorta's bye with no TE
of his playing, the top pickup Hutchinson at +1.8 a week, the next kickoff HOU at JAX abroad). Every Proj is the
fixture's one snapshot, so each carries the stand-in mark. The board rows are the stand-in run's. Every row of
the Account room is a stand-in in the API's shapes (GET /me, /hosts, /leagues/attached). Stand-ins carry class
"si" and print with a dotted underline.
"""
from __future__ import annotations

import html
import os
import sys

AUTH, OUT = sys.argv[1:3]
HERE = os.path.dirname(os.path.abspath(__file__))

src = open(AUTH).read()
SHELL_CSS = src[src.index('<style>') + len('<style>'):src.index('.lrow{')]
FONTS = src[src.index('<link rel="preconnect"'):src.index('<style>')]
CSS = ''.join(open(os.path.join(HERE, f)).read() for f in ('lineup.css', 'league.css', 'frontdoor.css'))

HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/{}.png'
CLUB_MARK = 'https://a.espncdn.com/i/teamlogos/nfl/500/{}.png'


def svg(path: str, size: int = 14, stroke: float = 2) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')


CHEV_R = svg('<path d="M9 6l6 6-6 6"/>', 16)
CHEV_D = svg('<path d="M6 9l6 6 6-6"/>', 14)
FLAG = svg('<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>', 16)
ARROW_IN = svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 13, 2.6)
ARROW_OUT = svg('<path d="M12 5v14M5 12l7 7 7-7"/>', 13, 2.6)
SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 16)
ABROAD = svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 13)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def si(text: str, stand_in: bool = True) -> str:
    return f'<span class="si">{text}</span>' if stand_in else text


def face(board_id: str | None, club: str = '', size: int = 30) -> str:
    if not board_id:
        return (f'<span class="face mark-face" style="width:{size}px;height:{size}px"><img src="{CLUB_MARK.format(club.lower())}" '
                f'alt="" width="{size}" height="{size}"></span>')
    return (f'<span class="face" style="width:{size}px;height:{size}px"><img src="{HEADSHOT.format(board_id)}" alt="" '
            f'width="{size}" height="{size}"></span>')


def avatar(initials: str, me: bool = False, size: int = 28, board: bool = False) -> str:
    cls = 'av' + (' me' if me else '') + (' board' if board else '')
    return f'<span class="{cls}" style="width:{size}px;height:{size}px" aria-hidden="true">{initials}</span>'


def platform_mark(letters: str) -> str:
    return f'<span class="pm" aria-hidden="true">{letters}</span>'


RAIL_ITEMS = [
    ('Lineup', '<path d="M8 3l-5 4 2 3 2-1v12h10V9l2 1 2-3-5-4c0 2-1.5 3-4 3S8 5 8 3z"/>'),
    ('Matchup', '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.8-3 3-5 6-5s5.2 2 6 5M14 15c3 0 5.2 2 6 5"/>'),
    ('Waivers', '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-3.6 3.8-6 7-6 1.5 0 2.9.5 4 1.4M18 12v6M15 15h6"/>'),
    ('Trades', '<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
    ('Players', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    ('Rest of season', '<path d="M4 6h16M4 11h12M4 16h8"/>'),
    ('Our record', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
]


def rail(current: str | None) -> str:
    items = ''.join(
        f'<a class="item{" wide-only" if label in ("Rest of season", "Our record") else ""}" href="#"'
        f'{" aria-current=page" if label == current else ""}>{svg(path, 22, 1.8)}<span>{label}</span></a>'
        for label, path in RAIL_ITEMS)
    account = svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>', 22, 1.8)
    cur = ' aria-current=page' if current == 'Account' else ''
    return (f'<nav class="rail" aria-label="Sections"><a class="mark" href="#" aria-label="Commish"><b>C</b></a>{items}'
            f'<span class="spacer"></span><a class="item wide-only" href="#"{cur}>{account}<span>Account</span></a></nav>')


LEAGUE = 'S.U.C.K. - Severely Underrated Carolina Keepers'


def switch() -> str:
    return (f'<div class="switch"><button type="button" class="quiet" aria-expanded="false"><span class="flag">{FLAG}</span>'
            f'<span class="words">{esc(LEAGUE)}</span><span class="plat">Sleeper</span><span class="chev">{CHEV_D}</span></button></div>')


def shell(theme: str, title: str, top: str, current: str | None, note: str, short: str, body: str) -> str:
    return f'''<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title} (Lane 66k mock, {theme})</title>
{FONTS}<style>{SHELL_CSS}{CSS}</style>
</head>
<body>
<div class="app">
{rail(current)}
<div class="main">
<header class="top">{top}</header>
<main class="mx">
  <p class="mocknote"><span class="long">{note}</span><span class="short">{short}</span></p>
  {body}
</main>
</div>
</div>
</body>
</html>
'''


# ---------------------------------------------------------------- the front door


def bug_row(initials: str, name: str, rec: str, proj: str, me: bool) -> str:
    return (f'<div class="bt{" me" if me else ""}">{avatar(initials, me, 34, True)}'
            f'<span class="bn">{esc(name)}</span><span class="br">{rec}</span>'
            f'<span class="bp">{si(proj)}</span><span class="bs"><span class="dash">--</span></span></div>')


def score_bug() -> str:
    return (
        '<a class="bug mine hero" href="#" aria-label="Your Week 6 matchup, opens the Matchup">'
        '<div class="bh"><span class="st">Week 6</span><span class="sw">Next kickoff Sun 8:30 am</span>'
        '<span class="bhn">Proj</span><span class="bhn">Pts</span></div>'
        f'{bug_row("MK", "McConkey Kong Country", "1-4", "74.7", True)}'
        f'{bug_row("TH", "thatmattkelley", "1-4", "98.4", False)}'
        f'<div class="bug-foot">{face("3916433", size=24)}<span><b>Jakobi Meyers</b> plays first, HOU at JAX</span>'
        f'<span class="tsub">{ABROAD} Abroad</span><span class="open">Matchup {CHEV_R}</span></div>'
        '</a>')


SWAPS = [
    ('QB', 'Dart', 'Rodgers', '20.6 against 15.8'),
    ('FLEX', 'Etienne', 'Chase', 'Chase on bye'),
    ('D/ST', 'Texans', 'Vikings', 'Vikings on bye'),
]


def nudge() -> str:
    swaps = ''.join(
        f'<li class="swap"><span class="sw-slot">{slot}</span><span class="sw-in">{ARROW_IN}{inn}</span>'
        f'<span class="sw-out">{ARROW_OUT}{out}</span><span class="swhy">{why}</span></li>'
        for slot, inn, out, why in SWAPS)
    return (
        '<section class="nudge" aria-label="Your lineup">'
        '<div class="n-top"><div class="d-head"><span class="d-wk">Your lineup, week 6</span><h3>Three changes</h3></div>'
        f'<div class="d-sum"><b class="si">+26.9</b><span>{si("101.6")} Proj with them, {si("74.7")} as set</span></div></div>'
        f'<ul class="swaps">{swaps}</ul>'
        f'<div class="n-act"><span class="d-rec">As set on Sleeper, read 4 minutes ago</span>'
        f'<a class="verb" href="#">Set your lineup {CHEV_R}</a></div>'
        '</section>')


def facts() -> str:
    rows = [
        ('4431299', '', 'Rome Odunze', 'q', 'Questionable', 'WR, CHI, a starter. Listed Fri 4:00 pm', 'Lineup'),
        ('4430027', '', 'Sam LaPorta', 'bye', 'Bye', 'TE, DET. No TE of yours plays this week', 'Waivers'),
        ('4686422', '', 'Xavier Hutchinson', 'add', 'Top pickup', f'WR, HOU. +{si("1.8", False)} a week over replacement', 'Waivers'),
    ]
    items = ''.join(
        f'<li><a class="fact" href="#">{face(bid, club, 38)}<span class="f-txt"><b>{name}</b><span>{line}</span></span>'
        f'<span class="f-kind {k}">{kind}</span><span class="f-go">{go}{CHEV_R}</span></a></li>'
        for bid, club, name, k, kind, line, go in rows)
    return (f'<section aria-label="This week for your roster"><div class="sec-h"><h3>Your roster</h3>'
            f'<span>Three facts this week. Each opens the screen that acts on it.</span></div><ul class="facts">{items}</ul></section>')


BOARD = [
    ('4426515', 'Puka Nacua', 'WR 1', 'LAR', '344.1', '+164.1', ('gain', '2 picks later')),
    ('4362628', "Ja'Marr Chase", 'WR 2', 'CIN', '333.2', '+153.2', ('gain', '2 picks later')),
    ('4430878', 'Jaxon Smith-Njigba', 'WR 3', 'SEA', '309.8', '+129.8', ('gain', '3 picks later')),
    ('4374302', 'Amon-Ra St. Brown', 'WR 4', 'DET', '295.3', '+115.2', ('gain', '3 picks later')),
    ('4429795', 'Jahmyr Gibbs', 'RB 1', 'DET', '262.1', '+113.9', ('loss', '4 picks earlier')),
    ('4430807', 'Bijan Robinson', 'RB 2', 'ATL', '261.4', '+113.2', ('loss', '4 picks earlier')),
    ('4241389', 'CeeDee Lamb', 'WR 5', 'DAL', '291.1', '+111.1', ('gain', '3 picks later')),
    ('4429160', "De'Von Achane", 'RB 3', 'MIA', '245.4', '+97.3', ('gain', '2 picks later')),
]


def board() -> str:
    rows = ''.join(
        f'<tr><td class="rnk">{i}</td><td><span class="pl">{face(bid, size=34)}<span class="pnm"><b>{esc(name)}</b>'
        f'<span>{pos}, {club}</span></span></span></td><td class="n knum hide-ph">{si(proj)}</td>'
        f'<td class="n"><span class="heat{" h2" if i > 4 else ""}">{si(over)}</span></td>'
        f'<td class="hide-ph"><span class="adp {tone}">{si(words)}</span></td></tr>'
        for i, (bid, name, pos, club, proj, over, (tone, words)) in enumerate(BOARD, start=1))
    return (
        '<section aria-label="The top of our board"><div class="sec-h"><h3>Our PPR board</h3><span>8 of 400</span></div>'
        '<table class="tbl brd">'
        '<thead><tr><th class="rnk w-rk">#</th><th>Player</th><th class="n hide-ph w-pj">Projected</th><th class="n w-ov">Over repl</th>'
        '<th class="hide-ph w-ad">Drafters vs us</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
        '<div class="more"><a class="quiet" href="#">All 400 on the board</a><a class="quiet" href="#">ADP</a></div></section>')


MY_LEAGUES = [
    ('SL', LEAGUE, False, 'McConkey Kong Country, 12th of 12', 'Sleeper', '1-4', True),
    ('ES', 'Office League (ESPN stand-in)', True, 'My Ball Zach Ertz, 3rd of 10', 'ESPN', '4-1', False),
    ('MF', 'Lakeside Dynasty', True, 'Rebuild Szn, 7th of 12', 'MyFantasyLeague', '2-3', False),
]


def leagues_side() -> str:
    rows = ''.join(
        f'<a class="lgr{" on" if on else ""}" href="#">{platform_mark(pm)}<span class="f-txt"><b>{si(esc(name), st)}</b>'
        f'<span>{si(esc(team), st)}, on {plat}</span></span><span class="rec">{si(rec, st)}</span>{CHEV_R}</a>'
        for pm, name, st, team, plat, rec, on in MY_LEAGUES)
    return (f'<section aria-label="Your leagues"><div class="sec-h"><h3>Your leagues</h3><span>3, the switch above opens any of them</span></div>'
            f'<div class="lgs">{rows}</div></section>')


def record_side() -> str:
    return ('<section aria-label="Our record"><div class="sec-h"><h3>Our record</h3><span>2026</span></div>'
            f'<div class="krec"><b class="kbig">{si("0")}</b><span>of {si("2")} frozen weeks graded</span>'
            '<a class="quiet signout" href="#">How the board has done</a></div></section>')


FRONT_BASIS = [
    'Record, place and Pts are Sleeper&#39;s, read 4 minutes ago. Proj is this week&#39;s PPR projection, read Fri 9:00 pm, '
    'and a team&#39;s Proj adds its starters as set on Sleeper. +26.9 is what the three changes add.',
    'A pickup&#39;s gain is points over replacement a week on our rest-of-season order. The board ranks points over replacement '
    'for the full 2026 season. Times are Central.',
]


def front(theme: str) -> str:
    top = (f'<div class="top-word"><h1>In season</h1><small>Week 6</small></div>'
           f'<label class="search">{SEARCH}<span>Search 400 players</span><kbd>/</kbd></label><div class="tail">{switch()}</div>')
    body = (
        '<div class="title"><h2>' + esc(LEAGUE) + '</h2><p class="lede">McConkey Kong Country, 1-4, 12th of 12. '
        'Read from Sleeper 4 minutes ago.</p></div>'
        f'<div class="week">{score_bug()}{nudge()}</div>'
        f'{facts()}'
        f'<div class="below">{board()}<div class="side">{leagues_side()}{record_side()}</div></div>'
        f'<div class="basis">{"".join(f"<p>{b}</p>" for b in FRONT_BASIS)}</div>')
    note = ('Mock for Lane 66k, the front door signed in with a league in season. Figures with a dotted underline are stand-ins. '
            'The team, records, place, the pairing, the three swaps, Odunze&#39;s status, LaPorta&#39;s bye and the top pickup are the '
            'recorded Sleeper league and the in-season fixture. Every Proj is the fixture&#39;s one snapshot. The board rows are the stand-in run&#39;s. '
            'The other two leagues are stand-ins.')
    short = 'Lane 66k mock. Dotted figures are stand-ins.'
    return shell(theme, 'Commish, in season', top, None, note, short, body)


# ---------------------------------------------------------------- the Account room


PLATFORMS = [
    # name, mark, status class, state, state line, writes (on/off, words), last read, verb (kind, words), row class
    ('Sleeper', 'SL', 'ok', 'No sign-in needed', 'Sleeper leagues read in public', ('off', 'Sleeper takes no lineups from here'),
     '4 minutes ago', ('quiet', 'Attach a league'), ''),
    ('ESPN', 'ES', 'ok', 'Connected Oct 3', 'Consent version 3, moves named', ('off', 'Not open to your account yet'),
     '6 minutes ago', ('quiet', 'Disconnect'), ''),
    ('Yahoo', 'YA', 'off', 'Not connected', 'Yahoo&#39;s own sign-in, read only', ('off', 'Yahoo takes no lineups from here'),
     '--', ('quiet', 'Connect'), ''),
    ('MyFantasyLeague', 'MF', 'ok', 'Connected Oct 15', 'Consent version 1, lineups named', ('on', 'Set there when you confirm a move'),
     '2 hours ago', ('quiet', 'Disconnect'), ''),
    ('FFPC', 'FP', 'bad', 'Signed out by FFPC', 'Connected Sep 28, consent version 3', ('off', 'FFPC takes no moves from here'),
     'Oct 12', ('verb', 'Sign in again'), 'bad'),
]


def platforms() -> str:
    rows = []
    for name, mark, dot, state, line, (w, wwords), read, (vk, verb), cls in PLATFORMS:
        wtag = 'On' if w == 'on' else 'Off'
        rows.append(
            f'<tr class="{cls}"><td><span class="pl">{platform_mark(mark)}<span class="pnm"><b>{name}</b></span></span></td>'
            f'<td class="wide"><span class="kst"><b><span class="dot {dot}"></span>{si(state)}</b><span>{si(line)}</span></span></td>'
            f'<td class="wide"><span class="wcell"><span class="wr {w}">Lineups {wtag}</span><span>{wwords}</span></span></td>'
            f'<td class="ph-hide"><span class="kst"><b>{si(read)}</b></span></td>'
            f'<td class="act"><a class="{vk}" href="#">{verb}</a></td></tr>')
    return (
        '<section aria-label="Platforms"><div class="sec-h"><h3>Platforms</h3><span>Where your leagues run, and what we keep to read them</span></div>'
        '<table class="tbl set"><colgroup><col class="c-plat"><col><col class="c-wr"><col class="c-read"><col class="c-act"></colgroup>'
        '<thead><tr><th>Platform</th><th>Connection</th><th>Lineups from here</th><th>Last read</th><th class="act"></th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></section>')


ATTACHED = [
    (LEAGUE, False, 'McConkey Kong Country', 'Sleeper', '1-4', '12th of 12', 'Week 6, playoffs from 15', '4 minutes ago'),
    ('Office League (ESPN stand-in)', True, 'My Ball Zach Ertz', 'ESPN', '4-1', '3rd of 10', 'Week 6, playoffs from 15', '6 minutes ago'),
    ('Lakeside Dynasty', True, 'Rebuild Szn', 'MyFantasyLeague', '2-3', '7th of 12', 'Week 6, playoffs from 14', '2 hours ago'),
    ('Main Event 1187', True, 'Kong Country Two', 'FFPC', '3-2', '4th of 12', 'Week 6, playoffs from 14', 'Oct 12'),
]


def attached() -> str:
    rows = ''.join(
        f'<tr><td><span class="kst"><b>{si(esc(name), st)}</b><span>{si(esc(team), st)}, on {plat}</span></span></td>'
        f'<td class="wide"><span class="kst"><b class="knum">{si(rec, st)}</b><span>{si(place, st)}</span></span></td>'
        f'<td class="ph-hide"><span class="kst"><b>{si(phase)}</b></span></td><td class="ph-hide">{si(read)}</td>'
        f'<td class="act"><a class="quiet" href="#">Open</a></td></tr>'
        for name, st, team, plat, rec, place, phase, read in ATTACHED)
    return (
        '<section aria-label="Leagues attached"><div class="sec-h"><h3>Leagues attached</h3><span>4, newest first</span></div>'
        '<table class="tbl set"><colgroup><col><col class="c-rec"><col class="c-ph"><col class="c-read"><col style="width:96px"></colgroup>'
        '<thead><tr><th>League</th><th>Record</th><th>Season</th><th>Last read</th><th class="act"></th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
        '<div class="tfoot"><span>Main Event 1187 keeps its Oct 12 read until FFPC lets us sign in again.</span>'
        '<a class="quiet" href="#">Attach a league</a></div></section>')


def prep() -> str:
    rows = [
        ('Cheat sheets', f'{si("2")}, PPR and Superflex, last changed {si("Oct 12")}', 'Open your sheet'),
        ('Mock drafts', f'{si("3")} finished, the last {si("Oct 9")}', 'Start a mock draft'),
    ]
    body = ''.join(f'<div class="kvr"><span class="kst"><b>{a}</b><span>{b}</span></span><a class="quiet" href="#">{v}</a></div>'
                   for a, b, v in rows)
    return (f'<section aria-label="Next draft"><div class="sec-h"><h3>Next draft</h3><span>Kept for your next draft</span></div>'
            f'<div class="kv">{body}</div></section>')


def plan() -> str:
    return (
        '<section aria-label="Plan"><div class="sec-h"><h3>Plan</h3></div><div class="kv">'
        f'<div class="kvr"><span class="kst"><span class="plan-h">Membership</span><span>{si("Yearly, renews Sep 2, 2027")}. '
        'We email you seven days before. It includes the Draft Pass and every league you attach.</span></span></div>'
        '<div class="kvr"><span class="kst"><b>Billing and receipts</b><span>Your card and every receipt</span></span><a class="quiet" href="#">Open</a></div>'
        '<div class="kvr"><span class="kst"><b>Cancel</b><span>It runs to the date above and does not renew</span></span>'
        '<a class="quiet" href="#">Cancel my membership</a></div></div></section>')


def display() -> str:
    segs = ''.join(f'<a href="#" class="seg"{" aria-current=page" if t == "Dark" else ""}>{t}</a>' for t in ('Auto', 'Light', 'Dark'))
    return (
        '<section aria-label="Display"><div class="sec-h"><h3>Display</h3></div><div class="kv">'
        f'<div class="kvr"><span class="kst"><b>Theme</b><span>On this device</span></span><nav class="segs th" aria-label="Theme">{segs}</nav></div>'
        '<div class="kvr"><span class="kst"><b>Time zone</b><span>Central Time, from this device. Every time on the site follows it.</span></span></div>'
        '</div></section>')


def devices() -> str:
    return (
        '<section aria-label="Devices"><div class="sec-h"><h3>Devices</h3></div><div class="kv">'
        f'<div class="kvr"><span class="kst"><b>{si("2")} paired</b><span>The draft companion on a phone and a tablet</span></span>'
        '<a class="quiet" href="#">Pair a device</a></div></div></section>')


def account(theme: str) -> str:
    top = f'<h1>Account</h1><div class="tail">{switch()}</div>'
    body = (
        f'<div class="who-head"><div class="title"><h2>{si("Justin H")}</h2><p class="lede">{si("justin@example.com")}, with us since {si("Sep 1")}</p></div>'
        '<a class="quiet" href="#">Sign out</a></div>'
        f'<div class="acct"><div class="col">{platforms()}{attached()}</div>'
        f'<div class="col">{plan()}{display()}{prep()}{devices()}</div></div>')
    note = ('Mock for Lane 66k, the Account room. Every row is a stand-in in the API&#39;s shapes: the account read for the name, plan and '
            'leagues, the platforms read for each connection, the attached leagues read for each league. Consent version and Lineups on or off '
            'are not in the platforms read yet, see the note.')
    short = 'Lane 66k mock. Every row is a stand-in.'
    return shell(theme, 'Commish, Account', top, 'Account', note, short, body)


for theme in ('dark', 'light'):
    open(os.path.join(OUT, f'front-{theme}.html'), 'w').write(front(theme))
    open(os.path.join(OUT, f'account-{theme}.html'), 'w').write(account(theme))
print('wrote', OUT)
