"""Lane 66i mock: the League page as a standings and roster board.

Writes league-sleeper-{dark,light}.html, league-espn-{dark,light}.html and settings-sleeper-{dark,light}.html.

The shell CSS (tokens, type, rail, top bar) is lifted from the design authority's league.html, and the
lineup table's CSS is Lane 66e's, as the box-score lanes did.

S.U.C.K. on Sleeper is real wherever the record holds it: the recorded league read in week 6
(api/internal/leaguesync/replay/sleeper: names, managers, records, points for and against, streaks,
FAAB used, the six pairings, every starter, the moves of week 5 with their bids, the settings and the
43 scoring keys) and the in-season fixture (web/scripts/inseason-fixture/data: the member's lineup as
set and as advised, the clubs' week 6 games, kickoffs, expected points and weather, the moves in the
API's shape). Every Proj is the dev store's one snapshot (week 1, PPR), the fixture's stand-in, and the
ten other teams' Proj totals and the Thursday starters' points are made up.

My Ball Zach Ertz on ESPN: the member's roster, its Proj and the opponent's starters are Lane 66d and
66e's mocks. The league's name, the other ten teams, every record, every point and the moves are
stand-ins. Stand-ins carry class "si" and print with a dotted underline.
"""
from __future__ import annotations

import html
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

AUTH, REPLAY, FIXTURE, OUT = sys.argv[1:5]
HERE = os.path.dirname(os.path.abspath(__file__))
CENTRAL = ZoneInfo('America/Chicago')

src = open(AUTH).read()
SHELL_CSS = src[src.index('<style>') + len('<style>'):src.index('.lrow{')]
FONTS = src[src.index('<link rel="preconnect"'):src.index('<style>')]
CSS = open(os.path.join(HERE, 'lineup.css')).read() + open(os.path.join(HERE, 'league.css')).read()

HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/{}.png'
CLUB_MARK = 'https://a.espncdn.com/i/teamlogos/nfl/500/{}.png'


def load(base: str, name: str):
    return json.load(open(os.path.join(base, name)))


# ---------------------------------------------------------------- small helpers


def svg(path: str, size: int = 14, stroke: float = 2) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')


GLYPH = {
    'wind': svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>', 13),
    'indoors': svg('<path d="M3 19h18M5 19v-5a7 7 0 0 1 14 0v5"/>', 13),
    'roof': svg('<path d="M3 19h18M5 19v-6l7-5 7 5v6"/><path d="M12 8V4"/>', 13),
    'abroad': svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 13),
}
ARROW_IN = svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 13, 2.6)
ARROW_OUT = svg('<path d="M12 5v14M5 12l7 7 7-7"/>', 13, 2.6)
CHEV_R = svg('<path d="M9 6l6 6-6 6"/>', 16)
SORT = svg('<path d="M7 10l5 5 5-5"/>', 12, 2.4)
OUTLINK = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 15)
CHECK = svg('<path d="M5 12l5 5 9-10"/>', 16, 2.6)


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def si(text: str, stand_in: bool) -> str:
    return f'<span class="si">{text}</span>' if stand_in else text


def printed(v: float) -> float:
    return round(v + 1e-9, 1)


def fig(v: float | None, stand_in: bool = True) -> str:
    if v is None:
        return '<span class="dash">--</span>'
    return si(f'{printed(v):.1f}'.replace('-', '&minus;'), stand_in)


def ordinal(n: int) -> str:
    suffix = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suffix}'


def central(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(CENTRAL)


def clock(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    return f'{dt.strftime("%a")} {h}:{dt.minute:02d} {"am" if dt.hour < 12 else "pm"}'


def halves(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f'{x:.1f}'


def initials(name: str) -> str:
    words = [w for w in ''.join(c if c.isalnum() or c == ' ' else ' ' for c in name).split() if w]
    if not words:
        return '?'
    if len(words) == 1:
        return words[0][:2].upper()
    return (words[0][0] + words[1][0]).upper()


def avatar(name: str, me: bool = False, size: int = 28, board: bool = False) -> str:
    cls = 'av' + (' me' if me else '') + (' board' if board else '')
    return f'<span class="{cls}" style="width:{size}px;height:{size}px" aria-hidden="true">{esc(initials(name))}</span>'


def face(board_id: str | None, club: str, pos: str, size: int = 30) -> str:
    if pos in ('DEF', 'D/ST') or not board_id:
        return (f'<span class="face mark-face" style="width:{size}px;height:{size}px"><img src="{CLUB_MARK.format(club.lower())}" '
                f'alt="" width="{size}" height="{size}"></span>')
    return (f'<span class="face" style="width:{size}px;height:{size}px"><img src="{HEADSHOT.format(board_id)}" alt="" '
            f'width="{size}" height="{size}"></span>')


# ---------------------------------------------------------------- the page's data model


@dataclass(frozen=True)
class Game:
    where: str  # 'vs' or 'at'
    opp: str
    kickoff: datetime
    team_pts: float | None
    game_pts: float | None
    glyph: str
    words: str


@dataclass(frozen=True)
class Team:
    rid: int
    name: str
    manager: str
    w: int
    l: int
    t: int
    pf: float
    pa: float
    streak: str  # 'W3', 'L2'
    waiver: str  # '$874' or '3rd'
    proj: float
    stand_in: bool  # record, points and waiver are stand-ins
    proj_real: bool = False


@dataclass(frozen=True)
class Side:
    rid: int
    proj: float
    pts: float | None
    pts_stand_in: bool


@dataclass(frozen=True)
class Pairing:
    a: Side
    b: Side
    state: str  # 'pre', 'live', 'final'
    head: str
    words: str


@dataclass(frozen=True)
class Spot:
    slot: str
    name: str
    club: str
    pos: str
    board_id: str | None
    game: Game | None
    proj: float | None
    pts: float | None = None
    pts_stand_in: bool = True
    status: str | None = None
    swap: tuple[str, float | None] | None = None  # the advice's player for this spot, and his Proj
    live: str | None = None  # 'final', 'live'


@dataclass(frozen=True)
class MovePlayer:
    name: str
    club: str
    pos: str
    board_id: str | None
    to: int | None = None


@dataclass(frozen=True)
class Move:
    at: datetime
    kind: str  # 'Add', 'Waiver', 'Trade', 'Lineup'
    rids: tuple[int, ...]
    adds: tuple[MovePlayer, ...]
    drops: tuple[MovePlayer, ...]
    detail: str = ''
    stand_in: bool = False


@dataclass(frozen=True)
class Settings:
    platform: str
    groups: list
    tiers_pa: list
    tiers_ya: list
    extras: list
    roster: list
    league: list


@dataclass
class League:
    key: str
    platform: str
    name: str
    name_stand_in: bool
    me: int
    week: int
    read: str
    teams: list[Team]
    pairings: list[Pairing]
    lineup: list[Spot]
    bench_count: int
    reserve_count: int
    changes: int
    advised: float
    as_set: float
    set_on_platform: bool
    moves_this: list[Move]
    moves_last: list[Move]
    playoff_teams: int
    playoff_weeks: str
    waiver_head: str
    waiver_basis: str
    basis: list[str]
    settings: Settings | None = None
    team_switch: str = ''
    note: str = ''
    short_note: str = ''
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------- S.U.C.K. on Sleeper, from the record


def games_by_club() -> dict[str, Game]:
    out = {}
    for g in load(FIXTURE, 'games.json')['games']:
        roof = g.get('roof') or {}
        wx = g.get('weather')
        if roof.get('abroad'):
            glyph, words = 'abroad', 'Abroad, no forecast'
        elif roof.get('kind') == 'dome':
            glyph, words = 'indoors', 'Indoors'
        elif roof.get('kind') == 'retractable':
            glyph, words = 'roof', 'Roof TBD'
        elif wx:
            glyph, words = 'wind', f'{round(wx["temperature_f"])}°, {round(wx["wind_mph"])} mph'
        else:
            glyph, words = 'wind', 'No forecast yet'
        gt = g.get('game_total') or {}
        out[g['team']] = Game('vs' if g['home'] else 'at', g['opponent'], central(g['kickoff']),
                              gt.get('team_points'), gt.get('points'), glyph, words)
    return out


GAMES = games_by_club()
NOW_SLEEPER = datetime(2026, 10, 17, 10, 12, tzinfo=CENTRAL)  # Saturday morning: Thursday's game is final


def streak_of(s: str | None) -> str:
    if not s:
        return ''
    return f'{s[-1]}{s[:-1]}'


def sleeper_teams() -> tuple[list[Team], dict]:
    users = {u['user_id']: u for u in load(REPLAY, 'users.json')}
    rosters = load(REPLAY, 'rosters.json')
    budget = load(REPLAY, 'league.json')['settings']['waiver_budget']
    teams = []
    for r in rosters:
        u = users.get(r['owner_id'], {})
        s = r['settings']
        manager = u.get('display_name', '')
        name = (u.get('metadata') or {}).get('team_name') or manager
        teams.append(Team(
            r['roster_id'], name, manager, s['wins'], s['losses'], s['ties'],
            s['fpts'] + s.get('fpts_decimal', 0) / 100, s['fpts_against'] + s.get('fpts_against_decimal', 0) / 100,
            streak_of((r.get('metadata') or {}).get('streak')), f'${budget - s.get("waiver_budget_used", 0):,}',
            0.0, False))
    teams.sort(key=lambda t: (-t.w, -t.pf))
    return teams, {r['roster_id']: r for r in rosters}


# Proj totals: rosters 1 and 7 sum the fixture's matchup answer (the week 1 stand-in snapshot), the
# other ten are made up for the layout.
SLEEPER_PROJ_STAND_IN = {2: 104.6, 3: 118.3, 4: 101.2, 5: 97.8, 6: 112.4, 8: 95.1, 9: 99.7, 10: 121.9, 11: 103.5, 12: 115.0}
# Thursday's game (SEA at DEN) is final: the points of the starters it holds are made up.
THURSDAY_PTS = {'DEN': 8.6, 'SEA': 13.4}


def side_proj(side: dict) -> float:
    return round(sum(printed(s['line']['week_projection']) for s in side['starters']
                     if s['line'].get('week_projection') is not None), 1)


def sleeper_pairings(rosters: dict, proj: dict[int, float]) -> list[Pairing]:
    players = load(REPLAY, 'players.json')
    by_id: dict[int, list[dict]] = {}
    for m in load(REPLAY, 'matchups.json'):
        by_id.setdefault(m['matchup_id'], []).append(m)
    out = []
    for _, pair in sorted(by_id.items()):
        pair.sort(key=lambda m: m['roster_id'] != 1)
        sides, kicks = [], []
        for m in pair:
            clubs = [(players.get(p) or {}).get('team') or p for p in m['starters']]
            played = [THURSDAY_PTS[c] for c in clubs if c in THURSDAY_PTS]
            kicks += [GAMES[c].kickoff for c in clubs if c in GAMES and GAMES[c].kickoff > NOW_SLEEPER]
            pts = round(sum(played), 1) if played else None
            sides.append(Side(m['roster_id'], proj[m['roster_id']], pts, True))
        nxt = min(kicks)
        out.append(Pairing(sides[0], sides[1], 'pre', clock(nxt), 'Next kickoff'))
    return out


def game_of(club: str, facts: dict) -> Game | None:
    if facts.get('bye') or not facts.get('opponent'):
        return None
    if club in GAMES:
        return GAMES[club]
    gt, wx, roof = facts.get('game_total') or {}, facts.get('weather'), facts.get('roof') or {}
    glyph, words = ('indoors', 'Indoors') if roof.get('kind') == 'dome' else (
        ('wind', f'{round(wx["temperature_f"])}°, {round(wx["wind_mph"])} mph') if wx else ('wind', 'No forecast yet'))
    return Game('vs' if facts['home'] else 'at', facts['opponent'], central(facts['kickoff']),
                gt.get('team_points'), gt.get('points'), glyph, words)


def sleeper_lineup() -> tuple[list[Spot], float, float, int]:
    lineup = load(FIXTURE, 'lineup.json')
    spots, advised, as_set, changes = [], 0.0, 0.0, 0
    for s in lineup['slots']:
        host, ours = s['host'], s['ours']
        p = host['player']
        proj = host.get('week_projection')
        swap = None
        if s['changed'] and ours:
            changes += 1
            swap = (ours['player']['name'].split(' ', 1)[1], ours.get('week_projection'))
        status = 'Bye' if host['facts'].get('bye') else None
        spots.append(Spot(s['slot'].replace('DEF', 'D/ST'), p['name'], p['team'], p['position'], p['board_id'],
                          game_of(p['team'], host['facts']), proj, status=status, swap=swap))
        as_set += printed(proj) if proj is not None else 0
        if ours and ours.get('week_projection') is not None:
            advised += printed(ours['week_projection'])
    return spots, round(advised, 1), round(as_set, 1), changes


def move_player(entry: dict, to: int | None = None) -> MovePlayer:
    p = entry['player']
    return MovePlayer(p['name'], p['team'], p['position'], p['board_id'], to)


def sleeper_moves() -> list[Move]:
    names = {k: f"{v.get('first_name', '')} {v.get('last_name', '')}" for k, v in load(REPLAY, 'players.json').items()}
    bids = {}
    for t in load(REPLAY, 'transactions_last.json'):
        if t['status'] == 'complete' and (t.get('settings') or {}).get('waiver_bid') is not None:
            for pid in (t.get('adds') or {}):
                bids[(names.get(pid, pid), tuple(t['roster_ids']))] = t['settings']['waiver_bid']
    by_ms = {(int(datetime.fromisoformat(m['at'].replace('Z', '+00:00')).timestamp() * 1000), tuple(m['roster_ids'])): m
             for m in load(FIXTURE, 'sync.json')['moves']}
    out = []
    for key, m in by_ms.items():
        kind = {'add': 'Add', 'waiver': 'Waiver', 'trade': 'Trade'}[m['kind']]
        bid = bids.get((m['adds'][0]['player']['name'], tuple(m['roster_ids']))) if m['adds'] else None
        detail = f'FAAB ${bid}' if bid is not None else ''
        adds = tuple(move_player(a, a['roster_id']) for a in m['adds'])
        drops = tuple(move_player(d, d['roster_id']) for d in m['drops']) if m['kind'] != 'trade' else ()
        out.append(Move(central(m['at']), kind, tuple(m['roster_ids']), adds, drops, detail))
    out.sort(key=lambda m: m.at, reverse=True)
    return out


RULE_GROUPS = [
    ('Passing', [('Each passing yard', 'pass_yd'), ('Passing touchdown', 'pass_td'), ('Interception thrown', 'pass_int')]),
    ('Rushing and receiving', [('Each rushing yard', 'rush_yd'), ('Rushing touchdown', 'rush_td'),
                               ('Each receiving yard', 'rec_yd'), ('Receiving touchdown', 'rec_td'),
                               ('Each catch', 'rec'), ('Extra for a tight end catch', 'bonus_rec_te')]),
    ('Everyone', [('Fumble lost', 'fum_lost'), ('Two-point conversion', 'pass_2pt'),
                  ('Kick or punt return touchdown', 'st_td')]),
    ('Kicking', [('Field goal made, under 40 yards', 'fgm_30_39'), ('Field goal made, 40 to 49 yards', 'fgm_40_49'),
                 ('Field goal made, 50 yards and up', 'fgm_50p'), ('Field goal missed', 'fgmiss'),
                 ('Extra point made', 'xpm'), ('Extra point missed', 'xpmiss')]),
    ('Defense', [('Sack', 'sack'), ('Interception', 'int'), ('Fumble recovery', 'fum_rec'),
                 ('Touchdown', 'def_td'), ('Safety', 'safe')]),
]
# The API's ten points-allowed tiers, each read from the Sleeper tier that holds it.
PA_TIERS = [('0', 'pts_allow_0'), ('1 to 6', 'pts_allow_1_6'), ('7 to 13', 'pts_allow_7_13'),
            ('14 to 17', 'pts_allow_14_20'), ('18 to 20', 'pts_allow_14_20'), ('21', 'pts_allow_21_27'),
            ('22 to 27', 'pts_allow_21_27'), ('28 to 34', 'pts_allow_28_34'), ('35 to 45', 'pts_allow_35p'),
            ('46 and up', 'pts_allow_35p')]
YA_TIERS = ['0 to 99', '100 to 199', '200 to 299', '300 to 349', '350 to 399', '400 to 449', '450 to 499', '500 to 549', '550 and up']
EXTRAS = [('Forced fumble', 'ff'), ('Blocked kick', 'blk_kick'), ('Fumble return touchdown', 'fum_rec_td'),
          ('Special teams forced fumble', 'st_ff'), ('Special teams fumble recovery', 'st_fum_rec')]


def sleeper_settings() -> Settings:
    lg = load(REPLAY, 'league.json')
    sc, st = lg['scoring_settings'], lg['settings']
    groups = [(g, [(label, sc.get(k, 0.0)) for label, k in rules]) for g, rules in RULE_GROUPS]
    pa = [(label, sc.get(k, 0.0)) for label, k in PA_TIERS]
    ya = [(label, 0.0) for label in YA_TIERS]
    extras = [(label, sc[k]) for label, k in EXTRAS if sc.get(k)]
    pos = lg['roster_positions']
    count = lambda p: pos.count(p)  # noqa: E731
    roster = [('QB', count('QB')), ('RB', count('RB')), ('WR', count('WR')), ('TE', count('TE')),
              ('FLEX', count('FLEX')), ('D/ST', count('DEF')), ('K', count('K')), ('Bench', count('BN')),
              ('IR', st['reserve_slots']), ('Taxi', st['taxi_slots'])]
    first = st['playoff_week_start']
    rounds = {4: 2, 6: 3, 8: 3}.get(st['playoff_teams'], 3)
    league = [
        ('Teams', f'{st["num_teams"]}'),
        ('Waivers', f'FAAB, ${st["waiver_budget"]:,} a season'),
        ('A dropped player clears', f'in {st["waiver_clear_days"]} days'),
        ('Trades close', f'after week {st["trade_deadline"]}'),
        ('Playoffs', f'{st["playoff_teams"]} teams, weeks {first} to {first + rounds - 1}'),
        ('Keepers', f'up to {st["max_keepers"]} a team'),
    ]
    return Settings('Sleeper', groups, pa, ya, extras, roster, league)


def sleeper() -> League:
    teams, rosters = sleeper_teams()
    box = load(FIXTURE, 'matchup.json')
    proj = dict(SLEEPER_PROJ_STAND_IN)
    for side in box['sides']:
        proj[side['roster_id']] = side_proj(side)
    teams = [Team(**{**t.__dict__, 'proj': proj[t.rid], 'proj_real': t.rid in (1, 7)}) for t in teams]
    spots, advised, as_set, changes = sleeper_lineup()
    lg = load(REPLAY, 'league.json')
    st = lg['settings']
    starters = len([p for p in lg['roster_positions'] if p != 'BN'])
    bench = len(rosters[1]['players']) - starters
    me = next(t for t in teams if t.rid == 1)
    place = teams.index(me) + 1
    return League(
        key='sleeper', platform='Sleeper', name=lg['name'], name_stand_in=False, me=1, week=6,
        read=f'{me.name}, {me.w}-{me.l}, {ordinal(place)} of {len(teams)}. Read from Sleeper 4 minutes ago. Times are in Central Time.',
        teams=teams, pairings=sleeper_pairings(rosters, proj), lineup=spots, bench_count=bench, reserve_count=0,
        changes=changes, advised=advised, as_set=as_set, set_on_platform=False,
        moves_this=[], moves_last=sleeper_moves(), playoff_teams=st['playoff_teams'], playoff_weeks='weeks 15 to 17',
        waiver_head='FAAB', waiver_basis=f'FAAB is each team\'s waiver budget left of ${st["waiver_budget"]:,}.',
        basis=[
            'Standings are Sleeper\'s: record, then points for. PF and PA are points for and against in this league\'s scoring, weeks 1 to 5. Streak is the current run of wins or losses.',
            'Proj is this week\'s published projection in PPR scoring, the closest match to this league\'s rules, read Fri 9:00 pm Central. A team\'s Proj adds its starters as set on Sleeper, so a starter on bye counts nothing.',
            'Pts are Sleeper\'s points so far this week. The Game cell shows each club\'s expected points, his club first, then the kickoff weather, read Fri 4:01 pm Central.',
        ],
        settings=sleeper_settings(), team_switch=me.name,
        note=('Mock for Lane 66i. Figures with a dotted underline are stand-ins. S.U.C.K. is the recorded Sleeper league: names, managers, records, PF, PA, '
              'streaks, FAAB left, the pairings, the lineup as set and every move are real. Every Proj is the week 1 published figure standing in for week 6, '
              'the ten other teams\' Proj totals and the Thursday starters\' points are made up.'),
        short_note='Mock. Dotted figures are stand-ins, named on the desk shot.')


# ---------------------------------------------------------------- My Ball Zach Ertz on ESPN, stand-ins on Lane 66d and 66e's rosters

NOW_ESPN = datetime(2026, 10, 18, 13, 52, tzinfo=CENTRAL)  # Sunday, the noon games in their fourth quarter


def espn() -> League:
    names = [  # (rid, team, manager, w, l, pf, pa, streak, waiver order, proj)
        (1, 'My Ball Zach Ertz', 'Justin H.', 2, 3, 498.6, 541.2, 'L2', 3, 87.0),
        (2, 'Stroke my double bogey', 'Corey M.', 4, 1, 602.3, 511.0, 'W3', 10, 104.2),
        (3, 'Hurts So Good', 'Dana P.', 4, 1, 588.1, 497.4, 'W1', 11, 99.6),
        (4, 'Bijan Mustard', 'Ray T.', 3, 2, 574.9, 530.8, 'W2', 7, 101.3),
        (5, 'Puka Shells', 'Mo K.', 3, 2, 561.0, 552.7, 'L1', 8, 96.4),
        (6, 'Kittle Me This', 'Sam W.', 3, 2, 549.8, 520.3, 'W1', 9, 94.8),
        (7, 'Breece Lightning', 'Lee A.', 3, 2, 533.2, 548.9, 'L1', 6, 98.1),
        (8, 'Nacho Average Team', 'Pat O.', 2, 3, 541.7, 560.0, 'W1', 5, 92.7),
        (9, 'Lamb Chops', 'Jo B.', 2, 3, 529.4, 566.2, 'L3', 4, 97.5),
        (10, 'Chubb Club', 'Kit R.', 2, 3, 517.3, 539.5, 'W1', 2, 90.2),
        (11, 'Waddle Waddle', 'Ana G.', 1, 4, 493.0, 590.6, 'L4', 1, 88.9),
        (12, 'Gronk Fiction', 'Ty S.', 1, 4, 512.8, 581.0, 'L2', 12, 95.3),
    ]
    teams = [Team(r, n, m, w, l, 0, pf, pa, s, ordinal(wo), pj, True) for r, n, m, w, l, pf, pa, s, wo, pj in names]
    teams.sort(key=lambda t: (-t.w, -t.pf))
    pairings = [
        Pairing(Side(1, 87.0, 62.1, True), Side(2, 104.2, 17.6, True), 'live', 'In play', '6 of 8 starters to play'),
        Pairing(Side(3, 99.6, 71.4, True), Side(10, 90.2, 58.0, True), 'live', 'In play', '7 of 16 played'),
        Pairing(Side(4, 101.3, 44.2, True), Side(9, 97.5, 51.8, True), 'live', 'In play', '6 of 16 played'),
        Pairing(Side(5, 96.4, 23.0, True), Side(8, 92.7, 30.4, True), 'live', 'In play', '4 of 16 played'),
        Pairing(Side(6, 94.8, 12.1, True), Side(12, 95.3, 9.8, True), 'live', 'In play', '2 of 16 played'),
        Pairing(Side(7, 98.1, None, True), Side(11, 88.9, None, True), 'pre', 'Sun 3:05 pm', 'Next kickoff'),
    ]

    def g(club: str, where: str, opp: str, day: int, h: int, mi: int, tp: float, gp: float, glyph: str, words: str) -> Game:
        return Game(where, opp, datetime(2026, 10, day, h, mi, tzinfo=CENTRAL), tp, gp, glyph, words)

    lineup = [
        Spot('QB', 'Caleb Williams', 'CHI', 'QB', '4431611', g('CHI', 'at', 'ATL', 18, 12, 0, 26.5, 49.5, 'roof', 'Roof TBD'), 18.5, 16.4, live='live'),
        Spot('RB', 'Bucky Irving', 'TB', 'RB', '4596448', g('TB', 'vs', 'PIT', 18, 12, 0, 19, 40.5, 'wind', '74°, 15 mph'), 12.8, 11.3, live='live'),
        Spot('RB', 'Kimani Vidal', 'LAC', 'RB', '4430968', g('LAC', 'at', 'KC', 18, 15, 25, 17, 42.5, 'wind', '66°, 10 mph'), 2.8, None),
        Spot('WR', 'Nico Collins', 'HOU', 'WR', '4258173', g('HOU', 'at', 'JAX', 18, 8, 30, 20, 42.5, 'abroad', 'Abroad, no forecast'), 16.2, 14.2, live='final'),
        Spot('WR', 'DJ Moore', 'BUF', 'WR', '3915416', g('BUF', 'at', 'LV', 18, 15, 25, 29.5, 52.5, 'indoors', 'Indoors'), 11.9, None, status='Questionable'),
        Spot('TE', 'Kyle Pitts Sr.', 'ATL', 'TE', '4360248', g('ATL', 'vs', 'CHI', 18, 12, 0, 23.5, 49.5, 'roof', 'Roof TBD'), 11.4, 7.2, live='live'),
        Spot('D/ST', 'Saints D/ST', 'NO', 'D/ST', None, g('NO', 'at', 'NYG', 18, 12, 0, 22, 45.5, 'wind', '54°, 7 mph'), 6.9, 4.0, live='live'),
        Spot('K', "Ka'imi Fairbairn", 'HOU', 'K', '2971573', g('HOU', 'at', 'JAX', 18, 8, 30, 20, 42.5, 'abroad', 'Abroad, no forecast'), 6.5, 9.0, live='final'),
    ]

    def mp(name: str, club: str, pos: str, bid: str | None, to: int | None = None) -> MovePlayer:
        return MovePlayer(name, club, pos, bid, to)

    def at(day: int, h: int, mi: int) -> datetime:
        return datetime(2026, 10, day, h, mi, tzinfo=CENTRAL)

    this = [
        Move(at(18, 11, 41), 'Lineup', (1,), (mp('Caleb Williams', 'CHI', 'QB', '4431611'), mp('Kimani Vidal', 'LAC', 'RB', '4430968'), mp('DJ Moore', 'BUF', 'WR', '3915416')),
             (mp('C.J. Stroud', 'HOU', 'QB', '4432577'), mp('Jahmyr Gibbs', 'DET', 'RB', '4429795'), mp('Makai Lemon', 'PHI', 'WR', '4870795')), 'Set from Commish', True),
        Move(at(17, 21, 8), 'Add', (9,), (mp('Woody Marks', 'HOU', 'RB', '4429615'),), (mp('Tyler Higbee', 'LAR', 'TE', '2573401'),), '', True),
        Move(at(15, 3, 0), 'Waiver', (11,), (mp('Kenny Gainwell', 'TB', 'RB', '4371733'),), (mp('Cam Little', 'JAX', 'K', '4686361'),), 'Waiver order 1st', True),
        Move(at(15, 3, 0), 'Waiver', (10,), (mp('Chiefs D/ST', 'KC', 'D/ST', None),), (mp('Steelers D/ST', 'PIT', 'D/ST', None),), 'Waiver order 2nd', True),
        Move(at(14, 16, 22), 'Trade', (2, 6), (mp('George Pickens', 'DAL', 'WR', '4426354', 2), mp('Sam LaPorta', 'DET', 'TE', '4430027', 6)), (), '', True),
    ]
    last = [
        Move(at(11, 10, 15), 'Lineup', (4,), (mp('Daniel Jones', 'IND', 'QB', '3917792'),), (mp('Geno Smith', 'NYJ', 'QB', '15864'),), '', True),
        Move(at(9, 18, 40), 'Add', (1,), (mp('Kimani Vidal', 'LAC', 'RB', '4430968'),), (mp('Rhamondre Stevenson', 'NE', 'RB', '4569173'),), '', True),
        Move(at(8, 3, 0), 'Waiver', (12,), (mp('Harrison Mevis', 'LAR', 'K', '4686363'),), (mp('Brandon Aubrey', 'DAL', 'K', '3953687'),), 'Waiver order 1st', True),
    ]
    return League(
        key='espn', platform='ESPN', name='Office League 2026', name_stand_in=True, me=1, week=6,
        read='My Ball Zach Ertz, 2-3, 11th of 12. Read from ESPN 1 minute ago. Times are in Central Time.',
        teams=teams, pairings=pairings, lineup=lineup, bench_count=5, reserve_count=1, changes=0,
        advised=87.0, as_set=87.0, set_on_platform=True, moves_this=this, moves_last=last,
        playoff_teams=4, playoff_weeks='weeks 15 and 16', waiver_head='Waiver',
        waiver_basis='Waiver is each team\'s place in ESPN\'s waiver order.',
        basis=[
            'Standings are ESPN\'s: record, then points for. PF and PA are points for and against in this league\'s scoring, weeks 1 to 5. Streak is the current run of wins or losses.',
            'Proj is this week\'s published projection in PPR scoring, the closest match to this league\'s rules, read Fri 9:00 pm Central. A team\'s Proj adds its starters as set on ESPN.',
            'Pts are ESPN\'s points so far this week. The Game cell shows each club\'s expected points, his club first, then the kickoff weather, read Fri 4:01 pm Central.',
        ],
        team_switch='My Ball Zach Ertz',
        note=('Mock for Lane 66i. Figures and names with a dotted underline are stand-ins. The member\'s roster, its Proj and the opponent are Lane 66d and 66e\'s mocks. '
              'The league\'s name, the other ten teams, every record, every point so far and every move are made up for the layout, at Sunday 1:52 pm with the noon games playing.'),
        short_note='Mock. Dotted figures and names are stand-ins.',
        extra={'now': NOW_ESPN})


# ---------------------------------------------------------------- rendering


def team_by(lg: League) -> dict[int, Team]:
    return {t.rid: t for t in lg.teams}


def bug_row(lg: League, side: Side, other: Side, state: str) -> str:
    t = team_by(lg)[side.rid]
    me = side.rid == lg.me
    lead = side.pts is not None and other.pts is not None and side.pts > other.pts
    pts = '<span class="dash">--</span>' if side.pts is None else si(f'{side.pts:.1f}', side.pts_stand_in)
    rec = si(f'{t.w}-{t.l}', t.stand_in)
    proj = si(f'{side.proj:.1f}', True)
    return (f'<div class="bt{" me" if me else ""}{" lead" if lead else ""}">{avatar(t.name, me, 26, True)}'
            f'<span class="bn">{si(esc(t.name), t.stand_in)}</span><span class="br">{rec}</span>'
            f'<span class="bp">{proj}</span><span class="bs">{pts}</span></div>')


def scoreboard(lg: League) -> str:
    cards = []
    for p in lg.pairings:
        mine = lg.me in (p.a.rid, p.b.rid)
        state_cls = {'pre': 'pre', 'live': 'live', 'final': 'final'}[p.state]
        dot = '<span class="pulse" aria-hidden="true"></span>' if p.state == 'live' else ''
        cards.append(
            f'<a class="bug{" mine" if mine else ""}" href="#" aria-label="Matchup">'
            f'<div class="bh"><span class="st {state_cls}">{dot}{p.head}</span><span class="sw">{p.words}</span>'
            f'<span class="bhn">Proj</span><span class="bhn">Pts</span></div>'
            f'{bug_row(lg, p.a, p.b, p.state)}{bug_row(lg, p.b, p.a, p.state)}</a>')
    return (f'<section class="board" aria-label="Week {lg.week} scoreboard"><div class="sec-h"><h3>Week {lg.week}</h3>'
            f'<span>Every matchup. Yours first, each opens its Matchup.</span></div>'
            f'<div class="bugs">{"".join(cards)}</div></section>')


def streak_chip(s: str, stand_in: bool) -> str:
    tone = 'gain' if s.startswith('W') else 'loss'
    return f'<span class="stk {tone}">{si(s, stand_in)}</span>'


def standings(lg: League) -> str:
    rows = []
    for i, t in enumerate(lg.teams, start=1):
        me = t.rid == lg.me
        mgr = '' if t.manager == t.name else f'<span class="mg">{si(esc(t.manager), t.stand_in)}</span>'
        rec = f'{t.w}-{t.l}-{t.t}'
        rows.append(
            f'<tr class="{"me" if me else ""}"><td class="pn n">{i}</td>'
            f'<td class="tm"><span class="tmw">{avatar(t.name, me, 30)}<span class="tmn"><b>{si(esc(t.name), t.stand_in)}</b>{mgr}'
            f'<span class="ph-stk">{streak_chip(t.streak, t.stand_in)}</span></span></span></td>'
            f'<td class="n wl">{si(rec, t.stand_in)}</td><td class="n pf">{si(f"{t.pf:.1f}", t.stand_in)}</td>'
            f'<td class="n pa">{si(f"{t.pa:.1f}", t.stand_in)}</td><td class="sk">{streak_chip(t.streak, t.stand_in)}</td>'
            f'<td class="n pj">{si(f"{t.proj:.1f}", True)}</td><td class="n wv">{si(t.waiver, t.stand_in)}</td></tr>')
        if i == lg.playoff_teams:
            rows.append(f'<tr class="cut"><td colspan="8"><span>Playoffs above, {lg.playoff_weeks}</span></td></tr>')
    head = ('<thead><tr><th class="pn n sorted" aria-sort="ascending"><button type="button">#' + SORT + '</button></th>'
            '<th class="tm">Team</th><th class="n wl"><button type="button">W-L-T</button></th><th class="n pf"><button type="button">PF</button></th>'
            '<th class="n pa"><button type="button">PA</button></th><th class="sk">Streak</th>'
            f'<th class="n pj"><button type="button">Proj</button></th><th class="n wv"><button type="button">{lg.waiver_head}</button></th></tr></thead>')
    cols = ('<colgroup><col class="c-pn"><col class="c-tm"><col class="c-wl"><col class="c-pf"><col class="c-pa"><col class="c-sk">'
            '<col class="c-pj"><col class="c-wv"></colgroup>')
    return (f'<section class="stand" aria-label="Standings"><div class="sec-h"><h3>Standings</h3><span>Week {lg.week}</span></div>'
            f'<table class="standings">{cols}{head}<tbody>{"".join(rows)}</tbody></table></section>')


def game_cell(gm: Game | None, status: str | None) -> str:
    if gm is None:
        return '<span class="bye">Bye</span>'
    exp = '' if gm.team_pts is None else f'<span class="exp">{halves(gm.team_pts)} to {halves(gm.game_pts - gm.team_pts)}</span>'
    return (f'<span class="opp"><b>{gm.where} {gm.opp}</b><span>{clock(gm.kickoff)}</span></span>'
            f'<span class="facts">{exp}<span class="wx">{GLYPH[gm.glyph]}{gm.words}</span></span>')


def lineup_row(lg: League, s: Spot) -> str:
    moved = s.swap is not None
    slot = (f'<span class="mv out" title="The advice sits him">{ARROW_OUT}</span>{s.slot}' if moved else s.slot)
    pill = '' if s.pos in ('DEF', 'D/ST') else f'<span class="pos">{s.pos}</span>'
    chip = ''
    if s.status == 'Questionable':
        chip = '<span class="tchip even">Questionable</span>'
    swap = ''
    if moved:
        name, proj = s.swap
        swap = f'<span class="swapin">{ARROW_IN}{esc(name)} starts, {fig(proj)}</span>'
    if s.pts is None:
        pts = '<span class="dash">--</span>'
    else:
        pts = si(f'{s.pts:.1f}', s.pts_stand_in)
    state = ''
    if s.live == 'final':
        state = '<span class="gs final">Final</span>'
    elif s.live == 'live':
        state = '<span class="gs live">In play</span>'
    gm = game_cell(s.game, s.status)
    if state:
        gm = gm.replace(f'<span>{clock(s.game.kickoff)}</span>', state, 1)
    first = gm.split('<span class="facts">')[0]
    return (f'<tr class="st{" moved out" if moved else ""}"><td class="slot">{slot}</td>'
            f'<td class="player"><span class="pl">{face(s.board_id, s.club, s.pos)}<span class="who">'
            f'<span class="nm"><a href="#">{esc(s.name)}</a></span>'
            f'<span class="sub"><span class="club">{s.club}</span>{pill}{chip}{swap}</span>'
            f'<span class="ph"><span class="ph-g">{first}</span></span></span></span></td>'
            f'<td class="game">{gm}</td><td class="n proj">{fig(s.proj)}</td><td class="n pts">{pts}</td></tr>')


def roster(lg: League) -> str:
    rows = ''.join(lineup_row(lg, s) for s in lg.lineup)
    pts_total = sum(s.pts for s in lg.lineup if s.pts is not None)
    pts_total_txt = '--' if not any(s.pts is not None for s in lg.lineup) else si(f'{pts_total:.1f}', True)
    tot = (f'<tr class="totals"><td colspan="3"><span class="tl">Totals</span><span class="tsub">as set on {lg.platform}</span></td>'
           f'<td class="n proj"><b>{si(f"{lg.as_set:.1f}", True)}</b></td><td class="n pts"><b>{pts_total_txt}</b></td></tr>')
    if lg.set_on_platform:
        verb = (f'<div class="rs-verb set"><span class="done">{CHECK}Lineup set on {lg.platform}</span>'
                f'<span class="rs-sub">Matches our advice, {si(f"{lg.advised:.1f}", True)} Proj</span>'
                f'<a class="quiet-link" href="#">Open Lineup</a></div>')
    else:
        word = {1: 'One change', 2: 'Two changes', 3: 'Three changes', 4: 'Four changes'}.get(lg.changes, f'{lg.changes} changes')
        gain = lg.advised - lg.as_set
        verb = (f'<div class="rs-verb"><span class="rs-sum"><b>{word}</b><span>{si(f"{lg.advised:.1f}", True)} Proj with them, '
                f'{si(f"{lg.as_set:.1f}", True)} as set, <em>{si(f"+{gain:.1f}", True)}</em></span></span>'
                f'<a class="verb" href="#">Set your lineup{CHEV_R}</a></div>')
    lower = f'Bench, {lg.bench_count} players'
    if lg.reserve_count:
        lower += f'. Injured reserve, {lg.reserve_count}'
    cols = '<colgroup><col class="c-slot"><col class="c-player"><col class="c-game"><col class="c-proj"><col class="c-pts"></colgroup>'
    head = ('<thead><tr class="cols"><th class="slot">Slot</th><th class="player">Player</th><th class="game">Game</th>'
            '<th class="n">Proj</th><th class="n">Pts</th></tr></thead>')
    return (f'<section class="roster" aria-label="Your lineup"><div class="sec-h"><h3>Your lineup</h3><span>As set on {lg.platform}</span></div>'
            f'{verb}<table class="lineup mini">{cols}{head}<tbody>{rows}{tot}</tbody></table>'
            f'<a class="benchlink" href="#">{lower}{CHEV_R}</a></section>')


def move_players(lg: League, m: Move) -> str:
    teams = team_by(lg)
    out = []
    if m.kind == 'Trade':
        for p in m.adds:
            out.append(f'<span class="mp in">{face(p.board_id, p.club, p.pos, 22)}<b>{esc(p.name)}</b>'
                       f'<small>{p.club} {p.pos.replace("DEF", "D/ST")}</small><span class="to">to {si(esc(teams[p.to].name), teams[p.to].stand_in)}</span></span>')
        return ''.join(out)
    for p in m.adds:
        out.append(f'<span class="mp in"><span class="ar">{ARROW_IN}</span>{face(p.board_id, p.club, p.pos, 22)}<b>{si(esc(p.name), m.stand_in and False)}</b>'
                   f'<small>{p.club} {p.pos.replace("DEF", "D/ST")}</small></span>')
    for p in m.drops:
        out.append(f'<span class="mp out"><span class="ar">{ARROW_OUT}</span>{face(p.board_id, p.club, p.pos, 22)}<b>{esc(p.name)}</b>'
                   f'<small>{p.club} {p.pos.replace("DEF", "D/ST")}</small></span>')
    return ''.join(out)


def move_row(lg: League, m: Move) -> str:
    teams = team_by(lg)
    mine = lg.me in m.rids
    who = ''.join(f'<span class="mt">{avatar(teams[r].name, r == lg.me, 24)}<b>{si(esc(teams[r].name), teams[r].stand_in)}</b></span>' for r in m.rids)
    kind = {'Add': 'Free agent', 'Waiver': 'Waiver', 'Trade': 'Trade', 'Lineup': 'Lineup'}[m.kind]
    when = si(clock(m.at), m.stand_in)
    return (f'<tr class="{"me" if mine else ""}"><td class="when">{when}</td><td class="mwho">{who}</td>'
            f'<td class="kind"><span class="kchip k-{m.kind.lower()}">{kind}</span></td>'
            f'<td class="pls"><span class="pls-w">{move_players(lg, m)}</span></td>'
            f'<td class="det">{si(m.detail, m.stand_in) if m.detail else ""}</td></tr>')


def moves(lg: League) -> str:
    def block(title: str, ms: list[Move], empty: str) -> str:
        head = f'<tr class="sect"><td colspan="5">{title}</td></tr>'
        if not ms:
            return head + f'<tr class="none"><td colspan="5">{empty}</td></tr>'
        return head + ''.join(move_row(lg, m) for m in ms)
    body = (block(f'Week {lg.week}', lg.moves_this, f'No moves yet this week on {lg.platform}.')
            + block(f'Week {lg.week - 1}', lg.moves_last, 'No moves.'))
    cols = '<colgroup><col class="c-when"><col class="c-who"><col class="c-kind"><col class="c-pls"><col class="c-det"></colgroup>'
    head = ('<thead><tr><th>When</th><th>Team</th><th>Move</th><th>Players</th><th class="det">Detail</th></tr></thead>')
    count = len(lg.moves_this) + len(lg.moves_last)
    return (f'<section class="moves" aria-label="Moves"><div class="sec-h"><h3>Moves</h3><span>This week and last, newest first. {count} moves.</span></div>'
            f'<table class="feed">{cols}{head}<tbody>{body}</tbody></table></section>')


def settings_view(lg: League) -> str:
    s = lg.settings
    rules = 0

    def pts(v: float) -> str:
        if v == 0:
            return '<span class="zero">0</span>'
        txt = f'{v:+g}'.replace('-', '&minus;')
        return f'<span class="{"vpos" if v > 0 else "vneg"}">{txt}</span>'
    groups = []
    for title, items in s.groups:
        rules += len(items)
        rows = ''.join(f'<tr><td>{label}</td><td class="n">{pts(v)}</td></tr>' for label, v in items)
        groups.append(f'<div class="rg"><h4>{title}</h4><table class="rules">{rows}</table></div>')
    rules += len(s.tiers_pa) + len(s.tiers_ya)

    def tiers(title: str, items: list, unit: str) -> str:
        cells = ''.join(f'<li><span class="tr-r">{label}</span><span class="tr-v">{pts(v)}</span></li>' for label, v in items)
        return f'<div class="rg wide"><h4>{title}</h4><span class="tr-u">{unit}</span><ul class="tiers">{cells}</ul></div>'
    pa = tiers('Defense, points allowed', s.tiers_pa, 'Points the defense scores when its opponent scores')
    ya = tiers('Defense, yards allowed', s.tiers_ya, f'{s.platform} scores no yards-allowed tiers here, so each is 0')
    extras = ''.join(f'<tr><td>{label}</td><td class="n">{pts(v)}</td></tr>' for label, v in s.extras)
    shape = ''.join(f'<li class="{"none" if n == 0 else ""}"><b>{n}</b><span>{label}</span></li>' for label, n in s.roster)
    league = ''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k, v in s.league)
    return f'''<section class="settings" aria-label="Settings">
  <div class="set-head"><div><h3>Scoring</h3><p>{rules} rules, as {s.platform} states them, in the setup page's words. Points per yard for the yardage rules, per play for the rest.</p></div>
    <a class="ext" href="#">{OUTLINK}Open settings on {s.platform}</a></div>
  <div class="set-grid">
    <div class="scoring">{''.join(groups)}{pa}{ya}
      <div class="rg wide also"><h4>{s.platform} also scores</h4><span class="tr-u">Mock drafts and our Proj leave these out</span><table class="rules">{extras}</table></div>
    </div>
    <div class="set-side">
      <div class="card"><h4>Roster</h4><ul class="shape">{shape}</ul><p class="fine">FLEX takes a RB, WR or TE.</p></div>
      <div class="card"><h4>League</h4><table class="rules kv">{league}</table></div>
    </div>
  </div>
</section>'''


RAIL_ITEMS = [
    ('Lineup', '<path d="M8 3l-5 4 2 3 2-1v12h10V9l2 1 2-3-5-4c0 2-1.5 3-4 3S8 5 8 3z"/>'),
    ('Matchup', '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.8-3 3-5 6-5s5.2 2 6 5M14 15c3 0 5.2 2 6 5"/>'),
    ('Waivers', '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-3.6 3.8-6 7-6 1.5 0 2.9.5 4 1.4M18 12v6M15 15h6"/>'),
    ('Trades', '<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
    ('Players', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    ('Rest of season', '<path d="M4 6h16M4 11h12M4 16h8"/>'),
    ('Our record', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
]


def rail() -> str:
    items = ''.join(
        f'<a class="item{" wide-only" if label in ("Rest of season", "Our record") else ""}" href="#">{svg(path, 22, 1.8)}<span>{label}</span></a>'
        for label, path in RAIL_ITEMS)
    account = svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>', 22, 1.8)
    return (f'<nav class="rail" aria-label="Sections"><a class="mark" href="#" aria-label="Commish"><b>C</b></a>{items}'
            f'<span class="spacer"></span><a class="item wide-only" href="#">{account}<span>Account</span></a></nav>')


def page(lg: League, theme: str, view: str) -> str:
    tabs = ''.join(f'<a href="#" class="chip"{" aria-pressed=true" if t == "League" else ""}>{t}</a>'
                   for t in ['League', 'Lineup', 'Matchup', 'Waivers', 'Trades'])
    sub = ''.join(f'<a href="#" class="seg"{" aria-current=page" if v == view else ""}>{label}</a>'
                  for v, label in (('week', f'Week {lg.week}'), ('settings', 'Settings')))
    if view == 'week':
        body = (f'{scoreboard(lg)}<div class="split">{standings(lg)}{roster(lg)}</div>{moves(lg)}'
                f'<div class="basis">{"".join(f"<p>{b}</p>" for b in lg.basis)}<p>{lg.waiver_basis}</p></div>')
    else:
        body = settings_view(lg)
    title = si(esc(lg.name), lg.name_stand_in)
    return f'''<!doctype html>
<html lang="en" data-theme="{theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Commish League, {esc(lg.name)} (Lane 66i mock, {theme})</title>
{FONTS}<style>{SHELL_CSS}{CSS}</style>
</head>
<body class="v-{view}">
<div class="app">
{rail()}
<div class="main">
<header class="top"><h1>League</h1><div class="tail"><button type="button" class="quiet">{svg('<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>', 16)}<span>{esc(lg.team_switch)}</span>{svg('<path d="M6 9l6 6 6-6"/>', 14)}</button></div></header>
<main class="mx">
  <p class="mocknote"><span class="long">{lg.note}</span><span class="short">{lg.short_note}</span></p>
  <div class="title"><h2>{title}</h2><p class="lede">{lg.read}</p></div>
  <div class="navrow"><nav class="chip-group tabs" aria-label="League">{tabs}</nav><nav class="segs" aria-label="League view">{sub}</nav></div>
  {body}
</main>
</div>
</div>
</body>
</html>
'''


for lg in (sleeper(), espn()):
    for theme in ('dark', 'light'):
        open(os.path.join(OUT, f'league-{lg.key}-{theme}.html'), 'w').write(page(lg, theme, 'week'))
        if lg.settings:
            open(os.path.join(OUT, f'settings-{lg.key}-{theme}.html'), 'w').write(page(lg, theme, 'settings'))
    print(lg.key, 'advised', lg.advised, 'as set', lg.as_set, 'changes', lg.changes, 'moves', len(lg.moves_this) + len(lg.moves_last))
