"""Lane 66f mock: the Waivers screen as a pickup table with a decision strip and a drop panel.

Writes waivers-dark.html and waivers-light.html. The shell CSS (tokens, type, rail, top bar, chips, search)
is lifted from the design authority's league.html, as Lanes 66d and 66e did. The table extends Lane 66e's
lineup.css (read from its mock directory) with waivers.css beside this file.

Data: the founder's week 6 roster and its figures are Lane 66e's mock, unchanged, so the two screens agree.
The pool's names, clubs, headshot ids, Rest of season and Last come from the in-season fixture's waiver
answer (web/scripts/inseason-fixture/data/waivers.json, a recorded 12-team league read in week 6) where it
holds the player. Gainwell, Marks, Allen, Mevis, Little and the Chiefs D/ST come from dev nfl_players (read
only) and the fixture's projection snapshot. Every Proj is that snapshot (the week 1 published figure), a
stand-in. Opp rank, Avg, Delta Proj, the gains a game and the pool itself (who is free in this league) are
stand-ins. Game facts are the fixture's games.json. Stand-ins carry class "si" and print with a dotted
underline.
"""
from __future__ import annotations

import html
import os
import sys
from dataclasses import dataclass

AUTH = sys.argv[1]  # docs/design/mocks/2026-10-12-commish/league.html
LINEUP_CSS = sys.argv[2]  # Lane 66e's lineup.css
OUT = sys.argv[3]

src = open(AUTH).read()
shell_css = src[src.index('<style>') + len('<style>'):src.index('.lrow{')]
fonts = src[src.index('<link rel="preconnect"'):src.index('<style>')]

HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/{}.png'
CLUB_MARK = 'https://a.espncdn.com/i/teamlogos/nfl/500/{}.png'
PLATFORM = 'ESPN'
TEAM = 'My Ball Zach Ertz'
WEEK = 6


def svg(path: str, size: int = 14, stroke: float = 2) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')


GLYPH = {
    'wind': svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>'),
    'indoors': svg('<path d="M3 19h18M5 19v-5a7 7 0 0 1 14 0v5"/>'),
    'roof': svg('<path d="M3 19h18M5 19v-6l7-5 7 5v6"/><path d="M12 8V4"/>'),
    'abroad': svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
}
PLUS = svg('<path d="M12 5v14M5 12h14"/>', 14, 2.4)
CHEV_UP = svg('<path d="M6 15l6-6 6 6"/>', 14, 2.2)
OPEN = svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 18)
SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 16)
SORT_DOWN = svg('<path d="M6 9l6 6 6-6"/>', 12, 2.6)

# Week 6 game facts per club from games.json, Central kickoffs: (where, opp, kickoff, club points,
# game points, weather glyph, weather words).
GAMES = {
    'CHI': ('at', 'ATL', 'Sun 12:00 pm', 26.5, 49.5, 'roof', 'Roof TBD'),
    'HOU': ('at', 'JAX', 'Sun 8:30 am', 20, 42.5, 'abroad', 'Abroad, no forecast'),
    'TB': ('vs', 'PIT', 'Sun 12:00 pm', 19, 40.5, 'wind', '74°, 15 mph'),
    'LAC': ('at', 'KC', 'Sun 3:25 pm', 17, 42.5, 'wind', '66°, 10 mph'),
    'KC': ('vs', 'LAC', 'Sun 3:25 pm', 25.5, 42.5, 'wind', '66°, 10 mph'),
    'BUF': ('at', 'LV', 'Sun 3:25 pm', 29.5, 52.5, 'indoors', 'Indoors'),
    'ATL': ('vs', 'CHI', 'Sun 12:00 pm', 23.5, 49.5, 'roof', 'Roof TBD'),
    'NO': ('at', 'NYG', 'Sun 12:00 pm', 22, 45.5, 'wind', '54°, 7 mph'),
    'IND': ('vs', 'TEN', 'Sun 12:00 pm', 26, 44.5, 'roof', 'Roof TBD'),
    'TEN': ('at', 'IND', 'Sun 12:00 pm', 19, 44.5, 'roof', 'Roof TBD'),
    'PHI': ('vs', 'CAR', 'Sun 12:00 pm', 21.5, 41.5, 'wind', '52°, 7 mph'),
    'CAR': ('at', 'PHI', 'Sun 12:00 pm', 20, 41.5, 'wind', '52°, 7 mph'),
    'NE': ('vs', 'NYJ', 'Sun 12:00 pm', 25.5, 43.5, 'wind', '48°, 5 mph'),
    'NYJ': ('at', 'NE', 'Sun 12:00 pm', 18.5, 43.5, 'wind', '48°, 5 mph'),
    'LAR': ('vs', 'ARI', 'Sun 3:05 pm', 32.5, 52.5, 'indoors', 'Indoors'),
    'JAX': ('vs', 'HOU', 'Sun 8:30 am', 23, 42.5, 'abroad', 'Abroad, no forecast'),
}
BYES = {'DET', 'MIA'}
SLOT_WORDS = {'QB': 'QB', 'RB': 'RB', 'WR': 'WR', 'TE': 'TE', 'K': 'K', 'D/ST': 'D/ST'}


@dataclass(frozen=True)
class Fig:
    """A figure and whether it is a stand-in in this mock."""
    value: float | None
    stand_in: bool = True


def real(v: float | None) -> Fig:
    return Fig(v, False)


def si(v: float | None) -> Fig:
    return Fig(v, True)


@dataclass(frozen=True)
class P:
    name: str
    short: str
    club: str
    pos: str
    pid: int | None  # None draws the club mark
    status: str | None
    proj: Fig
    opp_rank: Fig
    avg: Fig
    last: Fig
    delta: Fig
    ros: Fig
    starts: bool = False  # on the member's roster: starts in the advised lineup
    tag: str | None = None


# The member's roster as Lane 66e's mock advises it (the Lineup page's starters), Proj and evidence alike.
WILLIAMS = P('Caleb Williams', 'Williams', 'CHI', 'QB', 4431611, 'Questionable', real(18.5), si(24), si(17.9), si(22.4), si(0.4), si(17.6), True)
STROUD = P('C.J. Stroud', 'Stroud', 'HOU', 'QB', 4432577, None, real(16.8), si(9), si(19.4), real(21.94), si(-0.3), si(18.1))
IRVING = P('Bucky Irving', 'Irving', 'TB', 'RB', 4596448, None, si(12.78), si(14), si(13.6), real(31.5), si(0.1), si(14.2), True)
VIDAL = P('Kimani Vidal', 'Vidal', 'LAC', 'RB', 4430968, None, si(2.8), si(6), si(6.1), si(4.2), si(0.0), si(6.4), True, 'Breakout')
GIBBS = P('Jahmyr Gibbs', 'Gibbs', 'DET', 'RB', 4429795, None, real(None), real(None), si(19.6), si(24.8), real(None), si(19.9))
COLLINS = P('Nico Collins', 'Collins', 'HOU', 'WR', 4258173, None, si(16.24), si(27), si(15.8), si(18.7), si(-0.2), si(15.1), True)
MOORE = P('DJ Moore', 'Moore', 'BUF', 'WR', 3915416, 'Questionable', si(11.94), si(30), si(10.4), si(6.3), si(-0.6), si(10.8), True)
DOWNS = P('Josh Downs', 'Downs', 'IND', 'WR', 4688813, None, si(11.28), si(31), si(8.1), real(7.7), si(0.3), si(9.0))
LEMON = P('Makai Lemon', 'Lemon', 'PHI', 'WR', 4870795, None, si(6.89), si(17), si(6.9), real(9.3), si(-0.1), si(6.2))
PITTS = P('Kyle Pitts Sr.', 'Pitts', 'ATL', 'TE', 4360248, None, si(11.4), si(19), si(9.7), si(12.1), si(0.2), si(10.3), True, 'Target')
KINCAID = P('Dalton Kincaid', 'Kincaid', 'BUF', 'TE', 4385690, None, si(9.43), si(22), si(7.9), si(5.4), si(0.0), si(8.2))
SAINTS = P('Saints D/ST', 'Saints', 'NO', 'D/ST', None, None, si(6.9), real(None), si(5.8), si(3.0), si(0.0), si(6.1), True)
FAIRBAIRN = P("Ka'imi Fairbairn", 'Fairbairn', 'HOU', 'K', 2971573, None, si(6.5), si(11), si(8.4), si(9.0), si(0.1), si(8.3), True)
ROSTER = [WILLIAMS, STROUD, IRVING, VIDAL, GIBBS, COLLINS, MOORE, DOWNS, LEMON, PITTS, KINCAID, SAINTS, FAIRBAIRN]

# The pool: free in this league (a stand-in list). Fixture figures are real where the fixture holds them.
GAINWELL = P('Kenny Gainwell', 'Gainwell', 'TB', 'RB', 4371733, None, si(9.48), si(20), si(7.9), si(11.6), si(1.4), si(8.4))
CHIEFS = P('Chiefs D/ST', 'Chiefs', 'KC', 'D/ST', None, None, si(9.6), real(None), si(7.4), si(11.0), si(0.6), si(7.0))
POOL = [
    GAINWELL,
    P('Woody Marks', 'Marks', 'HOU', 'RB', 4429059, None, si(7.64), si(9), si(8.8), si(6.3), si(-0.4), si(7.9)),
    CHIEFS,
    P('Daniel Jones', 'Jones', 'IND', 'QB', 3917792, None, si(17.86), si(28), si(16.0), real(11.08), si(0.2), real(11.8)),
    P('Harrison Mevis', 'Mevis', 'LAR', 'K', 4574716, None, si(6.7), si(25), si(7.1), si(8.0), si(0.3), si(7.6)),
    P('Cam Ward', 'Ward', 'TEN', 'QB', 4688380, None, si(15.29), si(14), si(12.9), real(6.0), si(-0.5), real(11.7)),
    P('Geno Smith', 'Smith', 'NYJ', 'QB', 15864, 'Questionable', si(14.94), si(12), si(13.3), real(10.98), si(-1.2), real(11.2)),
    P('Cam Little', 'Little', 'JAX', 'K', 4686361, None, si(6.4), si(11), si(7.7), si(5.0), si(0.0), si(7.3)),
    P('Jahan Dotson', 'Dotson', 'ATL', 'WR', 4361409, None, si(5.59), si(18), si(5.2), real(7.4), si(0.1), real(5.4)),
    P('DeMario Douglas', 'Douglas', 'NE', 'WR', 4427095, None, si(5.34), si(22), si(6.6), real(22.5), si(0.9), real(2.7)),
    P('Tyquan Thornton', 'Thornton', 'KC', 'WR', 4362921, None, si(4.95), si(5), si(8.9), real(28.1), si(0.4), real(5.6)),
    P('Xavier Hutchinson', 'Hutchinson', 'HOU', 'WR', 4686422, None, si(4.28), si(16), si(7.0), real(10.5), si(-0.2), real(6.4)),
    P('Tyler Higbee', 'Higbee', 'LAR', 'TE', 2573401, None, si(2.92), si(30), si(9.4), real(13.3), si(-0.8), real(3.8)),
    P('Tommy Tremble', 'Tremble', 'CAR', 'TE', 4372780, None, si(2.36), si(8), si(4.1), real(5.2), si(0.0), real(5.3)),
    P('Kaytron Allen', 'Allen', 'MIA', 'RB', 4685246, None, real(None), si(13), si(9.8), si(12.4), real(None), si(9.6)),
]

# The gain a game over the rest of the season to the member's lineup, for a pickup with a given drop (a
# stand-in: the API's §5.2 search replaces it). The advice's drop is the one whose gain is highest.
ROS_GAIN = {
    ('Gainwell', 'Lemon'): 1.2, ('Gainwell', 'Vidal'): 0.6, ('Gainwell', 'Kincaid'): 0.4, ('Gainwell', 'Downs'): -0.5,
    ('Gainwell', 'Stroud'): -2.9, ('Gainwell', 'Gibbs'): -6.8,
    ('Chiefs', 'Saints'): 0.3,
    ('Mevis', 'Fairbairn'): -0.3,
}
STRIP_PICKS = [(GAINWELL, LEMON), (CHIEFS, SAINTS)]
OPEN_PICK = GAINWELL
DROP_CHOICES = [LEMON, VIDAL, KINCAID, DOWNS, STROUD, GIBBS]


def printed(v: float | None) -> float | None:
    return None if v is None else round(v + 1e-9, 1)


def beats(p: P) -> tuple[P, float] | None:
    """The roster player at his position with the lowest Proj he tops, starters first, and by how much."""
    if p.proj.value is None:
        return None
    mine = [r for r in ROSTER if r.pos == p.pos and r.proj.value is not None]
    for group in ([r for r in mine if r.starts], [r for r in mine if not r.starts]):
        topped = [r for r in group if printed(p.proj.value) > printed(r.proj.value)]
        if topped:
            low = min(topped, key=lambda r: r.proj.value)
            return low, round(printed(p.proj.value) - printed(low.proj.value), 1)
    return None


ADVISED = 87.0  # Lane 66e's advised lineup, the Lineup page's Totals
WITH_BOTH = round(ADVISED + sum(beats(a)[1] for a, _ in STRIP_PICKS), 1)


def ordinal(n: int) -> str:
    suffix = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suffix}'


def text(v: float, signed: bool = False) -> str:
    s = f'{v:+.1f}' if signed else f'{v:.1f}'
    if signed and round(v, 1) == 0:
        s = '0.0'
    return s.replace('-', '&minus;')


def num(f: Fig, signed: bool = False) -> str:
    if f.value is None:
        return '<span class="dash">--</span>'
    return f'<span class="{"si" if f.stand_in else ""}">{text(f.value, signed)}</span>'


def ease(f: Fig) -> str:
    if f.value is None:
        return '<span class="dash">--</span>'
    n = int(f.value)
    tone = 'easy' if n >= 23 else 'hard' if n <= 10 else 'mid'
    return f'<span class="rk {tone}"><span class="{"si" if f.stand_in else ""}">{ordinal(n)}</span></span>'


def face(p: P, size: int = 32) -> str:
    if p.pid is None:
        return (f'<span class="face mark-face" style="width:{size}px;height:{size}px"><img src="{CLUB_MARK.format(p.club.lower())}" '
                f'alt="{html.escape(p.short)} defense" width="{size}" height="{size}"></span>')
    return (f'<span class="face" style="width:{size}px;height:{size}px"><img src="{HEADSHOT.format(p.pid)}" alt="" '
            f'width="{size}" height="{size}"></span>')


def pill(p: P) -> str:
    out = '' if p.pos == 'D/ST' else f'<span class="pos">{p.pos}</span>'
    if p.status:
        out += f'<span class="tchip even">{p.status}</span>'
    return out


def tag(p: P) -> str:
    return f'<span class="tag">{p.tag}</span>' if p.tag else ''


def halves(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f'{x:.1f}'


def game_lines(p: P) -> tuple[str, str]:
    if p.club in BYES:
        return '<span class="bye">Bye</span>', ''
    where, opp, kick, team, game, glyph, words = GAMES[p.club]
    return (f'<span class="opp"><b>{where} {opp}</b><span>{kick}</span></span>',
            f'<span class="facts"><span class="exp">{halves(team)} to {halves(game - team)}</span>'
            f'<span class="wx">{GLYPH[glyph]}{words}</span></span>')


def phone_line(p: P) -> str:
    """The phone folds the game and the evidence under the name."""
    first, _ = game_lines(p)
    ev = [x for x in (f'Opp {ease(p.opp_rank)}' if p.opp_rank.value is not None else '',
                      f'Avg {num(p.avg)}' if p.avg.value is not None else '',
                      f'Rest {num(p.ros)}' if p.ros.value is not None else '') if x]
    return f'<span class="ph"><span class="ph-g">{first}</span><span class="ph-e">{", ".join(ev)}</span></span>'


def player_cell(p: P) -> str:
    return (f'<td class="player"><span class="pl">{face(p)}<span class="who">'
            f'<span class="nm"><a href="#">{html.escape(p.name)}</a></span>'
            f'<span class="sub"><span class="club">{p.club}</span>{pill(p)}{tag(p)}</span>'
            f'{phone_line(p)}</span></span></td>')


def evidence_cells(p: P) -> str:
    first, second = game_lines(p)
    return (f'<td class="game">{first}{second}</td>'
            f'<td class="n proj">{num(p.proj)}</td>'
            f'<td class="n ev rkc">{ease(p.opp_rank)}</td>'
            f'<td class="n ev">{num(p.avg)}</td>'
            f'<td class="n ev">{num(p.last)}</td>'
            f'<td class="n ev dl">{num(p.delta, True)}</td>'
            f'<td class="n ros">{num(p.ros)}</td>')


def beats_cell(p: P) -> str:
    b = beats(p)
    if b is None:
        word = 'Bye' if p.club in BYES else ''
        return f'<td class="beats none"><span class="dash">{word or "--"}</span></td>'
    who, gain = b
    role = 'Starter' if who.starts else 'Bench'
    tone = 'st' if who.starts else 'bn'
    return (f'<td class="beats {tone}"><span class="bt"><span class="bt-who"><b>{who.short}</b><span>{role}</span></span>'
            f'<span class="bt-g si">+{text(gain)}</span></span></td>')


def add_cell(p: P, open_: bool) -> str:
    if open_:
        return (f'<td class="act"><button type="button" class="add on" aria-expanded="true" '
                f'aria-label="Close the drops for {html.escape(p.short)}">{CHEV_UP}<span>Add</span></button></td>')
    return (f'<td class="act"><button type="button" class="add" aria-expanded="false" '
            f'aria-label="Add {html.escape(p.short)}">{PLUS}<span>Add</span></button></td>')


def pool_row(p: P) -> str:
    open_ = p is OPEN_PICK
    b = beats(p)
    cls = ['pk']
    if b is not None and b[0].starts:
        cls.append('starts')
    if open_:
        cls.append('open')
    return f'<tr class="{" ".join(cls)}">{player_cell(p)}{evidence_cells(p)}{beats_cell(p)}{add_cell(p, open_)}</tr>'


def drop_rows(add: P) -> str:
    """The roster players he could replace, the advice's drop first, in the same columns."""
    week_gain = beats(add)[1]
    rows = [f'<tr class="dsect"><td colspan="8"><span class="ds-t">Drop one for {html.escape(add.name)}</span>'
            f'<span class="ds-s"><b class="si">+{text(week_gain)}</b> Proj this week with any of them. The one you lose least by comes first.</span></td>'
            f'<td class="beats ds-h" colspan="2"><span>Gain a game, rest of season</span></td></tr>']
    for i, d in enumerate(DROP_CHOICES):
        ros = ROS_GAIN[(add.short, d.short)]
        chosen = i == 0
        # Dropping anyone frees the bench spot, so this week's gain is the same unless he could not play.
        tone = 'up' if ros > 0 else 'neg'
        rows.append(
            f'<tr class="dp{" chosen" if chosen else ""}">{player_cell(d)}{evidence_cells(d)}'
            f'<td class="beats gain"><span class="gn"><b class="si {tone}">{text(ros, True)}</b></span></td>'
            f'<td class="act"><span class="radio{" on" if chosen else ""}" role="radio" aria-checked="{"true" if chosen else "false"}"'
            f' aria-label="Drop {html.escape(d.short)}"></span></td></tr>')
    rows.append(
        f'<tr class="dgo"><td colspan="10"><div class="dgo-in"><span class="dgo-sum"><b>Add {add.short}, drop {DROP_CHOICES[0].short}</b>'
        f'<span>+{text(week_gain)} Proj this week, {text(ROS_GAIN[(add.short, DROP_CHOICES[0].short)], True)} a game rest of season</span></span>'
        f'<span class="dgo-act"><span class="dgo-why">Claims are not sent to {PLATFORM} from here yet, so add him there.</span>'
        f'<button type="button" class="verb">{OPEN}Open {PLATFORM} waivers</button></span></div></td></tr>')
    return ''.join(rows)


COLS = ('<colgroup><col class="c-player"><col class="c-game"><col class="c-proj"><col class="c-rk"><col class="c-ev">'
        '<col class="c-ev"><col class="c-dl"><col class="c-ros"><col class="c-beats"><col class="c-act"></colgroup>')


def th(label: str, cls: str, active: bool = False) -> str:
    caret = f'<span class="caret">{SORT_DOWN}</span>' if active else ''
    sort = ' aria-sort="descending"' if active else ''
    return f'<th class="{cls}{" sorted" if active else ""}"{sort}><button type="button" class="sort">{label}{caret}</button></th>'


HEAD = ('<thead><tr class="cols">'
        + th('Player', 'player') + th('Game', 'game') + th('Proj', 'n') + th('Opp rank', 'n ev rkc')
        + th('Avg', 'n ev') + th('Last', 'n ev') + th('&Delta; Proj', 'n ev dl') + th('Rest of season', 'n ros')
        + th('Beats', 'beats', True) + '<th class="act"><span class="vh">Add</span></th></tr></thead>')


def sort_key(p: P) -> tuple:
    b = beats(p)
    starter = 1 if b and b[0].starts else 0
    return (-starter, -(b[1] if b else -99), -(p.proj.value or -1))


def table() -> str:
    body = []
    for p in sorted(POOL, key=sort_key):
        body.append(pool_row(p))
        if p is OPEN_PICK:
            body.append(drop_rows(p))
    return (f'<table class="lineup pool" aria-label="Players free to add, week {WEEK}">{COLS}{HEAD}'
            f'<tbody>{"".join(body)}</tbody></table>')


def strip() -> str:
    cards = []
    for i, (add, drop) in enumerate(STRIP_PICKS):
        gain = beats(add)[1]
        ros = ROS_GAIN[(add.short, drop.short)]
        cards.append(
            f'<li class="pick{" on" if i == 0 else ""}"><span class="sw-slot">{add.pos}</span>'
            f'<span class="pk-w"><span class="pk-m"><b>Add {add.short}</b>, drop {drop.short}</span>'
            f'<span class="pk-g"><em class="si">+{text(gain)}</em> Proj this week, <span class="si">{text(ros, True)}</span> a game rest of season</span></span>'
            f'<button type="button" class="{"verb" if i == 0 else "quiet pk-v"}">{OPEN}Open {PLATFORM} waivers</button></li>')
    return f'''<section class="decide pickups" aria-label="This week's pickups">
  <div class="d-head"><span class="d-wk">Week {WEEK}</span><h3>Two pickups</h3>
    <div class="d-sum"><b class="si">{WITH_BOTH:.1f}</b><span>Proj with both, {ADVISED:.1f} without, <em class="si">+{WITH_BOTH - ADVISED:.1f}</em></span></div></div>
  <ul class="picks">{"".join(cards)}</ul>
  <p class="d-why"><span class="long">Claims are not sent to {PLATFORM} from here yet. Each button copies the player's name and opens {PLATFORM}'s waiver page.</span><span class="short">Claims are not sent to {PLATFORM} from here yet.</span></p>
  <div class="d-pin"><span class="pin-m"><b>Add Gainwell, drop Lemon</b></span><button type="button" class="verb">{OPEN}Open {PLATFORM} waivers</button></div>
</section>'''


POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST']


def filters() -> str:
    chips = ''.join(f'<button type="button" class="chip" aria-pressed="{"true" if p == "All" else "false"}">{p}</button>'
                    for p in POSITIONS)
    return (f'<div class="filters"><div class="chip-group" role="group" aria-label="Position">{chips}</div>'
            f'<label class="search">{SEARCH}<input type="search" placeholder="Find a player" aria-label="Find a player"></label>'
            f'<span class="count"><b class="si">60</b> free on {PLATFORM}, <b class="si">5</b> beat a player of yours</span></div>')


BASIS = [
    'A pickup worth making starts for you this week and does not lower your rest of season. '
    'Its drop is the player you lose least by, on our rest-of-season order.',
    'Proj is this week\'s published projection in PPR scoring, the closest match to this league\'s rules, read Fri 9:00 pm Central. '
    'Defenses are on its default defense scoring. Our own weekly model replaces it when it passes its test. '
    '&Delta; Proj is its change since the read before, Thu 9:00 pm.',
    'Beats is the player of yours at his position with the lowest Proj he tops, your starters first, and by how much. '
    'A player on bye or out beats no one.',
    'Rest of season is his points a game on our rest-of-season order, week 6 through week 17, byes out. '
    'A gain a game is your lineup\'s on the same order.',
    'Opp rank is where his opponent stands in points allowed to his position this season, 1st allows the fewest. '
    'Avg and Last are his points a game this season and in his last game, in this league\'s scoring.',
    'The Game cell shows each club\'s expected points, his club first, then the kickoff weather, read Fri 4:01 pm Central.',
]

RAIL_ITEMS = [
    ('Lineup', '<path d="M8 3l-5 4 2 3 2-1v12h10V9l2 1 2-3-5-4c0 2-1.5 3-4 3S8 5 8 3z"/>', False),
    ('Matchup', '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.8-3 3-5 6-5s5.2 2 6 5M14 15c3 0 5.2 2 6 5"/>', False),
    ('Waivers', '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-3.6 3.8-6 7-6 1.5 0 2.9.5 4 1.4M18 12v6M15 15h6"/>', True),
    ('Trades', '<path d="M4 8h14l-3-3M20 16H6l3 3"/>', False),
    ('Players', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', False),
    ('Rest of season', '<path d="M4 6h16M4 11h12M4 16h8"/>', False),
    ('Our record', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', False),
]


def rail() -> str:
    items = ''.join(
        f'<a class="item{" wide-only" if label in ("Rest of season", "Our record") else ""}" href="#"'
        f'{" aria-current=page" if cur else ""}>{svg(path, 22, 1.8)}<span>{label}</span></a>'
        for label, path, cur in RAIL_ITEMS)
    account = svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>', 22, 1.8)
    return (f'<nav class="rail" aria-label="Sections"><a class="mark" href="#" aria-label="Commish"><b>C</b></a>{items}'
            f'<span class="spacer"></span><a class="item wide-only" href="#">{account}<span>Account</span></a></nav>')


HERE = os.path.dirname(os.path.abspath(__file__))
CSS = open(LINEUP_CSS).read() + open(os.path.join(HERE, 'waivers.css')).read()

MOCK_NOTE = ('Mock for Lane 66f. Figures with a dotted underline are stand-ins. The roster and its figures are Lane 66e\'s Lineup mock. '
             'Who is free in this league is a stand-in list of real players. Every Proj is the week 1 published figure. '
             'Rest of season and Last are real where the recorded fixture league holds the player. Opp rank, Avg, &Delta; Proj, the gains and the counts are made up for the layout.')

TABS = ''.join(f'<a href="#" class="chip"{" aria-pressed=true" if t == "Waivers" else ""}>{t}</a>'
               for t in ['League', 'Lineup', 'Matchup', 'Waivers', 'Trades'])

for theme in ('dark', 'light'):
    page = f'''<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Commish Waivers, week {WEEK} (Lane 66f mock, {theme})</title>
{fonts}<style>{shell_css}{CSS}</style>
</head>
<body>
<div class="app">
{rail()}
<div class="main">
<header class="top"><h1>Waivers</h1><div class="tail"><button type="button" class="quiet">{svg('<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>', 16)}<span>{TEAM}</span>{svg('<path d="M6 9l6 6 6-6"/>', 14)}</button></div></header>
<main class="mx">
  <p class="mocknote"><span class="long">{MOCK_NOTE}</span><span class="short">Mock. Dotted figures are stand-ins, named on the desk shot.</span></p>
  <div class="title"><h2>{TEAM}</h2><p class="lede">Read from {PLATFORM} 4 minutes ago. Times are in Central Time.</p></div>
  <nav class="chip-group tabs" aria-label="League">{TABS}</nav>
  {strip()}
  {filters()}
  {table()}
  <div class="basis">{''.join(f'<p>{line}</p>' for line in BASIS)}</div>
</main>
</div>
</div>
</body>
</html>
'''
    open(os.path.join(OUT, f'waivers-{theme}.html'), 'w').write(page)
print('ok with both', WITH_BOTH, [(p.short, beats(p)) for p in POOL])
