from html import escape

from data import drafters_gap, heat_class, tier_cliffs
from shell import face, gap_chip, page, signed, tier_class

# Chris Olave, because his capsule agrees with the board: WR6, 274 points, nine in tier 3 before a
# 16.8-point drop, drafters at pick 18 "a round later than he should", and our rank 9 puts them 9 picks later.
# Press Box used Chase Brown, whose capsule calls him 32nd overall (the projected-points sort, not our
# board's 14th) and carries an unedited writer aside in its second paragraph.
PLAYER = "Chris Olave"

# Pull figures: numbers the capsule itself states, lifted out of the prose and set beside it. Each must appear
# verbatim in body_full or the build fails, so a pull figure can never say what the writing does not.
PULL_FIGURES = [
    ("29%", "target share last season"),
    ("49.7%", "of the team's air yards"),
    ("16.8", "PPR points from the end of his tier to the next"),
]

CSS = """
.player{padding:var(--s-5);display:flex;flex-direction:column;gap:var(--s-5);max-width:1320px}
.crumb{font-size:var(--t-sm);color:var(--ink-3)}
.crumb a{text-decoration:none}.crumb a:hover{text-decoration:underline}
.hero{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--s-6);align-items:center;
  padding:var(--s-6);border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line)}
.hero .face{box-shadow:inset 0 0 0 1px var(--line)}
.ident{display:flex;flex-direction:column;gap:var(--s-3);min-width:0}
.ident h2{margin:0;font-size:clamp(2rem,4vw,3.25rem);font-weight:700;line-height:1;letter-spacing:-0.01em;text-wrap:balance}
.ident .meta{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center;font-size:var(--t-md);color:var(--ink-2)}
.ident .pos,.ident .tier-chip{height:24px;font-size:var(--t-sm)}
.big{display:flex;flex-direction:column;align-items:flex-end;gap:6px;text-align:right}
.big b{font-family:var(--font-num);font-weight:800;font-size:var(--t-3xl);line-height:0.82;font-variant-numeric:tabular-nums}
.big span{font-size:var(--t-sm);color:var(--ink-2);max-width:24ch}
.big .verb{margin-top:var(--s-3)}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-4)}
.fact{padding:var(--s-4);display:flex;flex-direction:column;gap:var(--s-2);min-width:0}
.fact .v{display:flex;align-items:baseline;gap:var(--s-2);flex-wrap:wrap}
.fact .v b{font-family:var(--font-num);font-weight:700;font-size:var(--t-xl);line-height:1;font-variant-numeric:tabular-nums}
.fact p{margin:0;font-size:var(--t-sm);color:var(--ink-2)}
.fact.vor-fact{color:var(--heat-ink)}
.fact.vor-fact .label,.fact.vor-fact p{color:inherit}
.rng{position:relative;height:10px;margin:14px 0 22px;border-radius:5px;background:var(--surface-2)}
.rng .span{position:absolute;inset:0 auto 0 0;border-radius:5px;background:var(--line-strong)}
.rng .med{position:absolute;top:-5px;width:4px;height:20px;margin-left:-2px;border-radius:2px;background:var(--accent)}
.rng .tick{position:absolute;top:16px;transform:translateX(-50%);font-family:var(--font-num);font-weight:700;font-size:var(--t-lg);font-variant-numeric:tabular-nums}
.rng .tick.l{transform:none}.rng .tick.r{transform:translateX(-100%)}
.split{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:var(--s-6);align-items:start}
/* Borrowed from Scout, player page only: the capsule is writing, so it is set in a reading serif.
   The serif covers the prose block and its pull figures and nothing else on the page. */
.read{max-width:68ch;min-width:0}
.prose{font-family:var(--font-read);font-optical-sizing:auto}
.pulls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-4);margin:var(--s-2) 0 var(--s-5);
  padding-block:var(--s-4);border-block:1px solid var(--line)}
.pulls div{display:flex;flex-direction:column;gap:4px;min-width:0}
.pulls b{font-family:var(--font-read);font-weight:500;font-size:var(--t-pull);line-height:1;letter-spacing:-0.01em;font-variant-numeric:lining-nums tabular-nums}
.pulls span{font-family:var(--font-read);font-style:italic;font-size:var(--t-md);line-height:1.35;color:var(--ink-2)}
.read h3,.tier h3{margin:0 0 var(--s-3);font-size:var(--t-xs);text-transform:uppercase;letter-spacing:var(--track-label);color:var(--ink-3);font-weight:600}
.prose p{margin:0 0 1em;font-size:var(--t-read);line-height:1.62;color:var(--ink)}
.prose p:first-of-type{font-size:1.375rem;line-height:1.5}
.tier{padding:0;overflow:hidden}
.tier .band{display:grid;grid-template-columns:44px 1fr;align-items:center;min-height:52px;
  background:color-mix(in srgb,var(--tier) var(--tier-wash),var(--bg));border-bottom:2px solid var(--tier)}
.tier .band .strip{align-self:stretch;display:grid;place-items:center;background:var(--tier);color:var(--tier-ink);font-family:var(--font-num);font-weight:800;font-size:30px}
.tier .band div{padding:0 var(--s-3);display:flex;flex-direction:column}
.tier .band b{font-size:var(--t-md)}
.tier .band span{font-size:var(--t-sm);color:var(--ink-2)}
.tier ol{list-style:none;margin:0;padding:var(--s-2)}
.tier li{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:var(--s-2);align-items:center;padding:6px var(--s-2);border-radius:var(--r-sm);font-size:var(--t-sm)}
.tier li.me{background:var(--accent-wash);font-weight:700}
.tier li b{font-family:var(--font-num);font-weight:700;font-size:20px;font-variant-numeric:tabular-nums}
.tier .foot{padding:var(--s-3) var(--s-4);border-top:1px solid var(--line);font-size:var(--t-sm);color:var(--ink-2)}
@media (max-width: 1080px){.split{grid-template-columns:minmax(0,1fr)}.facts{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){
  .player{padding:var(--s-4);gap:var(--s-4)}
  .hero{grid-template-columns:auto minmax(0,1fr);gap:var(--s-4);padding:var(--s-4)}
  .hero > .face{width:96px!important;height:96px!important}
  .big{grid-column:1 / -1;align-items:flex-start;text-align:left}
  .big b{font-size:72px}
  .big .verb{width:100%}
  .prose p,.prose p:first-of-type{font-size:1.0625rem}
  .pulls{grid-template-columns:minmax(0,1fr);gap:var(--s-3)}
  .pulls div{flex-direction:row;align-items:baseline;gap:var(--s-3)}
  .pulls b{font-size:34px;min-width:3.2ch}
}
"""


def _pull_figures(text):
    missing = [fig for fig, _ in PULL_FIGURES if fig not in text]
    if missing:
        raise ValueError(f"Pull figures {missing} do not appear in {PLAYER}'s capsule.")
    items = "".join(f"<div><b>{fig}</b><span>{escape(cap)}</span></div>" for fig, cap in PULL_FIGURES)
    return f'<figure class="pulls">{items}</figure>'


def _prose(text):
    paras = [f"<p>{escape(par.strip())}</p>" for par in text.split("\n\n") if par.strip()]
    return paras[0] + _pull_figures(text) + "".join(paras[1:])


def build(players, capsules):
    p = next(x for x in players if x["name"] == PLAYER)
    cap = capsules[p["id"]]
    cliffs, counts = tier_cliffs(players, p["pos"])
    mates = sorted(
        (x for x in players if x["pos"] == p["pos"] and x["tier"] == p["tier"]), key=lambda x: x["pos_rank"]
    )
    cliff = cliffs[p["tier"]]
    lo, hi = p["floor"], p["ceiling"]

    def pct(x):
        return (x - lo) / (hi - lo) * 100

    gap = drafters_gap(p)
    paragraphs = _prose(cap["body_full"])
    tier_rows = "".join(
        f'<li class="{"me" if x is p else ""}">{face(x, 32)}<span>{escape(x["name"])}<br>'
        f'<span class="label">{x["pos"]} {x["pos_rank"]} · {x["team"]}</span></span><b>{x["proj"]:.1f}</b></li>'
        for x in mates
    )
    body = f"""<main class="player">
  <div class="crumb"><a href="board.html">Board</a> / <a href="board.html">{p['pos']}</a> / {escape(p['name'])}</div>
  <section class="hero">
    {face(p, 168)}
    <div class="ident">
      <h2>{escape(p['name'])}</h2>
      <div class="meta"><span class="pos">{p['pos']} {p['pos_rank']}</span>
        <span class="tier-chip {tier_class(p['tier'])}">Tier {p['tier']}</span><span>{p['team']}</span></div>
    </div>
    <div class="big">
      <b>{p['proj']:.1f}</b>
      <span>projected PPR points in 2026, over {p['games']:.1f} expected games</span>
      <button class="verb" type="button">Add to my sheet</button>
    </div>
  </section>
  <section class="facts">
    <div class="fact panel">
      <span class="label">Where drafters take him</span>
      <div class="v"><b>Pick {round(p['adp'])}</b>{gap_chip(gap)}</div>
      <p>We have him at pick {p['our_rank']}, so drafters take him {abs(gap)} picks {'later' if gap > 0 else 'earlier'}. ADP {p['adp']:.1f}.</p>
    </div>
    <div class="fact panel vor-fact {heat_class(p)}">
      <span class="label">Over replacement</span>
      <div class="v"><b>{signed(p['vor'])}</b><span>PPR pts</span></div>
      <p>Round {p['vor_round']} value among the 400 on our board</p>
    </div>
    <div class="fact panel">
      <span class="label">Floor, median, ceiling</span>
      <div class="rng"><span class="span" style="width:100%"></span><span class="med" style="left:{pct(p['median']):.1f}%"></span>
        <span class="tick l" style="left:0">{p['floor']:.0f}</span><span class="tick" style="left:{pct(p['median']):.1f}%">{p['median']:.0f}</span><span class="tick r" style="left:100%">{p['ceiling']:.0f}</span></div>
      <p>2026 PPR points, from his low case to his high case</p>
    </div>
  </section>
  <div class="split">
    <article class="read"><h3>Our read</h3><div class="prose">{paragraphs}</div></article>
    <aside class="tier panel {tier_class(p['tier'])}">
      <div class="band"><span class="strip">{p['tier']}</span><div><b>Tier {p['tier']} {p['pos']}s</b><span>{counts[p['tier']]} players, then {cliff['drop']:.1f} PPR pts down to tier {cliff['next']}</span></div></div>
      <ol>{tier_rows}</ol>
      <div class="foot">Projected PPR points, 2026</div>
    </aside>
  </div>
</main>"""
    return page(
        f"Commish {PLAYER}",
        "players",
        "Players",
        '<a class="quiet" href="draft.html">Queue in a mock</a>',
        body,
        CSS,
        with_read=True,
    )
