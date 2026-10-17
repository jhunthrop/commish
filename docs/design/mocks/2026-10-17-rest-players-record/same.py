"""Ours, ADP and the published consensus on the same players each week (the record's population rule)."""
import contextlib
import importlib.util
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('g', os.path.join(HERE, 'grade.py'))
g = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(g)

res = {}
for wk in ('1', '2'):
    rows = [r for r in g.rows if r['board_source'] == 'commish_board_v9_ppr_12' and r['week'] == wk]
    both = [r for r in rows if r['adp_rank']]
    res[wk] = {'all_ours': g.score(rows, 'board_rank'), 'same_ours': g.score(both, 'board_rank'),
               'same_adp': g.score(both, 'adp_rank'), 'frozen': rows[0]['frozen_at'], 'graded': rows[0]['graded_at']}
    for pos in ('QB', 'RB', 'WR', 'TE'):
        bp = [r for r in both if r['position'] == pos]
        pts = [-float(r['actual_points']) for r in bp]
        res[wk][pos] = (len(bp), round(g.spearman([int(r['board_rank']) for r in bp], pts), 3),
                        round(g.spearman([int(r['adp_rank']) for r in bp], pts), 3))
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(HERE, 'same.json'), 'w'))
