"""Week figures from the dev register: rank correlation, places off, starters called right."""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STARTERS = {'QB': 12, 'RB': 24, 'WR': 36, 'TE': 12}
rows = list(csv.DictReader(open(os.path.join(HERE, 'grades.csv'))))


def rankdata(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rankdata(a), rankdata(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra)
    vb = sum((y - mb) ** 2 for y in rb)
    return cov / (va * vb) ** 0.5


def score(group, key):
    g = [r for r in group if r[key]]
    called = [int(r[key]) for r in g]
    pts = [-float(r['actual_points']) for r in g]
    rho = spearman(called, pts)
    rc, ra = rankdata(called), rankdata(pts)
    off = sum(abs(x - y) for x, y in zip(rc, ra)) / len(g)
    hit = tot = 0
    for pos, n in STARTERS.items():
        gp = [r for r in g if r['position'] == pos]
        top_call = {id(r) for r in sorted(gp, key=lambda r: int(r[key]))[:n]}
        top_fin = {id(r) for r in sorted(gp, key=lambda r: -float(r['actual_points']))[:n]}
        hit += len(top_call & top_fin)
        tot += n
    return {'n': len(g), 'rho': round(rho, 3), 'off': round(off, 1), 'starters': hit, 'of': tot}


out = {}
for src in sorted({r['board_source'] for r in rows}):
    for wk in sorted({r['week'] for r in rows}):
        g = [r for r in rows if r['board_source'] == src and r['week'] == wk]
        if not g:
            continue
        out[f'{src}|{wk}'] = {
            'ours': score(g, 'board_rank'), 'adp': score(g, 'adp_rank'), 'ecr': score(g, 'ecr_rank'),
            'frozen': g[0]['frozen_at'], 'graded': g[0]['graded_at'],
        }
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.join(HERE, 'grades.json'), 'w'))
