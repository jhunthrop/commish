"""The Commish shell (Press Box as built): fonts, tokens, rail, top bar, shared row parts. Every page inlines it."""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent
TOKENS_PATH = OUT / "tokens.css"
TOKENS = TOKENS_PATH.read_text()
FONT_FAMILIES = "family=Big+Shoulders+Display:wght@500;700;800&family=Outfit:wght@400;500;600;700"
# The reading serif loads only on pages that set capsule prose. Its presence anywhere else is a defect.
READ_FAMILY = "&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400"


def fonts(with_read=False):
    families = FONT_FAMILIES + (READ_FAMILY if with_read else "")
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{families}&display=swap">'
    )

ICONS = {
    "board": '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
    "players": '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    "mock": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>',
    "sheet": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
    "league": '<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>',
    "advisor": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "record": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "account": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
}
CURRENT = ' aria-current="page"'
# The phone's bottom bar holds five items.
PHONE_ITEMS = 5
RAIL = [
    ("board", "Board", "board.html"),
    ("players", "Players", "player.html"),
    ("mock", "Mock draft", "setup.html"),
    ("sheet", "Cheat sheet", "board.html"),
    # A signed-in account's League: its league, or the attach page before it has one. On the phone it
    # takes the fifth place, so Advisor and Our record stay on the desk's rail.
    ("league", "League", "league.html"),
    ("advisor", "Advisor", "mock.html"),
    ("record", "Our record", "direction.html"),
]


def icon(name, size=22):
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>'
    )


SHELL_CSS = """
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--font-ui);font-size:var(--t-md);line-height:1.4;
  -webkit-font-smoothing:antialiased}
a{color:inherit}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.num{font-family:var(--font-num);font-variant-numeric:tabular-nums;letter-spacing:0.01em}
.label{font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3);font-weight:500}
.app{display:grid;grid-template-columns:var(--rail-w) minmax(0,1fr);min-height:100vh}
.rail{position:sticky;top:0;height:100vh;background:var(--shell);border-right:1px solid var(--shell-line);
  display:flex;flex-direction:column;align-items:stretch;gap:var(--s-1);padding-block:var(--s-4)}
.mark{display:grid;place-items:center;height:56px;margin-bottom:var(--s-3);text-decoration:none}
.mark b{font-family:var(--font-num);font-weight:800;font-size:30px;line-height:1;color:var(--ink);
  border-bottom:4px solid var(--accent);padding-bottom:2px}
.rail a.item{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;text-decoration:none;
  color:var(--ink-3);font-size:var(--t-xs);font-weight:500;text-align:center;border-left:3px solid transparent}
.rail a.item:hover{color:var(--ink)}
.rail a.item[aria-current="page"]{color:var(--accent-text);border-left-color:var(--accent)}
.rail .spacer{flex:1}
.main{min-width:0;display:flex;flex-direction:column}
.top{position:sticky;top:0;z-index:5;background:var(--shell);border-bottom:1px solid var(--shell-line);
  display:flex;align-items:center;gap:var(--s-4);padding:var(--s-3) var(--s-5);min-height:68px}
.top h1{margin:0;font-size:var(--t-lg);font-weight:700;white-space:nowrap}
.search{flex:1;max-width:620px;display:flex;align-items:center;gap:var(--s-2);height:42px;padding:0 var(--s-3);
  border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface);color:var(--ink-3)}
.search input{flex:1;min-width:0;border:0;background:transparent;font:inherit;color:var(--ink);outline:none}
.search input::placeholder{color:var(--ink-3)}
.search kbd{font-family:var(--font-ui);font-size:var(--t-xs);border:1px solid var(--line-strong);border-radius:var(--r-sm);padding:1px 6px}
.top .tail{margin-left:auto;display:flex;align-items:center;gap:var(--s-3)}
.quiet{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 var(--s-3);border-radius:var(--r-md);
  border:1px solid var(--line-strong);background:transparent;cursor:pointer;font-size:var(--t-sm);font-weight:500;color:var(--ink-2);text-decoration:none}
.quiet:hover{color:var(--ink);border-color:var(--ink-3)}
.theme{display:flex;gap:2px;padding:3px;border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface)}
.theme button{height:30px;padding:0 10px;border:0;border-radius:var(--r-sm);background:transparent;cursor:pointer;
  font-size:var(--t-sm);font-weight:500;color:var(--ink-2)}
.theme button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.verb{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 var(--s-5);
  border:0;border-radius:var(--r-md);background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:var(--t-md);
  cursor:pointer;text-decoration:none;white-space:nowrap}
.verb:hover{filter:brightness(1.06)}
.chips{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center}
.chip{height:32px;padding:0 var(--s-3);border-radius:var(--r-pill);border:1px solid var(--line-strong);background:transparent;
  font-size:var(--t-sm);font-weight:500;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip-group{display:flex;gap:4px;padding:3px;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--surface)}
.chip-group .chip{border-color:transparent;height:28px}
.face{flex:none;border-radius:50%;background:var(--surface-2);overflow:hidden;display:grid;place-items:end center}
.face img{width:140%;max-width:none;height:auto;display:block;transform:translateY(6%)}
.pos{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:var(--r-sm);
  background:var(--surface-2);color:var(--ink);font-size:var(--t-xs);font-weight:700;letter-spacing:0.04em;white-space:nowrap}
.tier-chip{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:var(--r-sm);
  color:var(--tier-ink);font-size:var(--t-xs);font-weight:700;letter-spacing:0.04em}
.t1{--tier:var(--tier-1)}.t2{--tier:var(--tier-2)}.t3{--tier:var(--tier-3)}.t4{--tier:var(--tier-4)}
.t5{--tier:var(--tier-5)}.t6{--tier:var(--tier-6)}.t7{--tier:var(--tier-7)}
.tier-chip{background:var(--tier)}
.heat-1{background:var(--heat-1)}.heat-2{background:var(--heat-2)}.heat-3{background:var(--heat-3)}
.heat-4{background:var(--heat-4)}.heat-neg{background:var(--heat-neg)}.heat-0{background:transparent}
.gap{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:var(--r-sm);font-size:var(--t-sm);font-weight:600;white-space:nowrap}
.gap.later{background:var(--gain-bg);color:var(--gain-ink)}
.gap.earlier{background:var(--loss-bg);color:var(--loss-ink)}
.gap.even{background:var(--surface-2);color:var(--ink-2)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)}
@media (max-width: 760px){
  :root{--row-h:48px}
  .app{grid-template-columns:minmax(0,1fr);padding-bottom:64px}
  .rail{position:fixed;inset:auto 0 0 0;top:auto;height:auto;z-index:20;flex-direction:row;justify-content:space-around;
    padding:4px 4px calc(4px + env(safe-area-inset-bottom,0px));border-right:0;border-top:1px solid var(--shell-line)}
  .rail .mark,.rail .spacer,.rail a.item.wide-only{display:none}
  .rail a.item{border-left:0;border-top:3px solid transparent;padding:6px 2px;flex:1}
  .rail a.item[aria-current="page"]{border-top-color:var(--accent)}
  .top{padding:var(--s-2) var(--s-4);gap:var(--s-2);flex-wrap:wrap;min-height:0}
  .top h1{display:none}
  .top .search{order:3;flex-basis:100%;max-width:none;height:38px}
  .top .tail{margin-left:auto}
  .search kbd{display:none}
  .theme button{height:26px;padding:0 7px;font-size:var(--t-xs)}
}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
"""

THEME_SWITCH = (
    '<div class="theme" role="group" aria-label="Theme">'
    '<button type="button" data-set="auto" aria-pressed="true">Auto</button>'
    '<button type="button" data-set="light" aria-pressed="false">Light</button>'
    '<button type="button" data-set="dark" aria-pressed="false">Dark</button></div>'
)

THEME_JS = """
<script>
(function(){
  var root=document.documentElement, KEY='commish-theme';
  var buttons=[].slice.call(document.querySelectorAll('.theme button'));
  function mark(mode){buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-set')===mode));});}
  function apply(mode){if(mode==='auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme',mode); mark(mode);}
  var saved=null;
  try{saved=localStorage.getItem(KEY);}catch(e){saved=null;}
  if(saved) apply(saved); else mark(root.getAttribute('data-theme')||'auto');
  buttons.forEach(function(b){b.addEventListener('click',function(){
    var mode=b.getAttribute('data-set'); apply(mode);
    try{localStorage.setItem(KEY,mode);}catch(e){}
  });});
})();
</script>
"""


SEARCH = (
    f'<label class="search">{icon("search", 18)}<input id="q" type="search" placeholder="Search 400 players" '
    'aria-label="Search players"><kbd>/</kbd></label>'
)


def page(title, active, heading, top_tail, body, css, js="", with_read=False, search=True):
    rail = "".join(
        f'<a class="item{" wide-only" if i >= PHONE_ITEMS else ""}" href="{href}"'
        f'{CURRENT if key == active else ""}>{icon(key)}<span>{label}</span></a>'
        for i, (key, label, href) in enumerate(RAIL)
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{escape(title)}</title>
{fonts(with_read)}
<style>
{TOKENS}
{SHELL_CSS}
{css}
</style>
</head>
<body>
<div class="app">
<nav class="rail" aria-label="Sections">
  <a class="mark" href="direction.html" aria-label="Commish"><b>C</b></a>
  {rail}
  <span class="spacer"></span>
  <a class="item wide-only" href="direction.html">{icon("account")}<span>Account</span></a>
</nav>
<div class="main">
<header class="top">
  <h1>{escape(heading)}</h1>
  {SEARCH if search else ""}
  <div class="tail">
    {THEME_SWITCH}
    {top_tail}
  </div>
</header>
{body}
</div>
</div>
{THEME_JS}
{js}
</body>
</html>
"""


def face(p, size):
    return (
        f'<span class="face" style="width:{size}px;height:{size}px">'
        f'<img src="{p["img"]}" alt="" loading="lazy" width="{size}" height="{size}"></span>'
    )


def gap_chip(gap):
    if gap is None:
        return '<span class="gap even">No ADP yet</span>'
    if gap == 0:
        return '<span class="gap even">Same spot</span>'
    n = abs(gap)
    word = "later" if gap > 0 else "earlier"
    return f'<span class="gap {word}">{n} pick{"s" if n != 1 else ""} {word}</span>'


def tier_class(tier):
    return f"t{(tier - 1) % 7 + 1}"


def signed(x):
    return f"+{x:.1f}" if x >= 0 else f"−{abs(x):.1f}"
