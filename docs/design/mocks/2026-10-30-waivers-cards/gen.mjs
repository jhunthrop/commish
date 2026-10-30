// Lane 305 mock: the Waivers screen centred on the position cards. The cards are the screen's
// navigation (All, then each position the league starts), the screen opens on the weakest Need, and
// a selected position shows the member's players there against the best free agents there in the
// table's own columns, one comparison. The pickups strip stays the screen's one verb, compact, above.
//
//   node gen.mjs            writes waivers-cards-light.html and waivers-cards-dark.html
//
// Data: data/waivers.json is the in-season fixture API's full answer at the fixture week clock
// (2026-10-17T17:00Z, the recorded Sleeper league, week 6), data/waivers-<P>.json its narrowed
// answers, saved from web/scripts/inseason-fixture/serve.ts. The panel's figures are that fixture's
// stand-in (web/scripts/inseason-fixture/positions.ts): hold the shapes and the rules, not the numbers.
// Tokens are the site's own (web/src/lib/ui/tokens*.css), read at generation.
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const web = new URL('../../../../web/src/lib/ui/', import.meta.url);
const json = (name) => {
	const v = JSON.parse(readFileSync(new URL(`data/${name}`, here), 'utf8'));
	return v.data ?? v;
};
const tokens = [
	readFileSync(new URL('tokens.generated.css', web), 'utf8'),
	readFileSync(new URL('tokens.css', web), 'utf8').replace(/@import[^;]+;/g, '')
].join('\n');

const advice = json('waivers.json');
const NARROWED = Object.fromEntries(
	['QB', 'RB', 'WR', 'TE', 'DEF'].map((p) => [p, json(`waivers-${p}.json`)])
);
const WORD = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'D/ST' };
const esc = (s) =>
	String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tenth = (v) => (v === null || v === undefined ? '--' : Number(v).toFixed(1));
const signed = (v) => (v > 0 ? `+${tenth(v)}` : v < 0 ? `−${tenth(-v)}` : '0.0');
const ordinal = (n) => {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const lastName = (name) => {
	const n = name.replace(/\s+D\/ST$/, '');
	if (/^[A-Z][a-z]+ [A-Z][a-z]+ (Chiefs|Texans|Vikings)$/.test(n)) return n.split(' ').pop();
	const parts = n.split(' ').filter((p) => !/^(Jr\.|Sr\.|II|III)$/.test(p));
	return parts.length > 1 ? parts.slice(1).join(' ') : n;
};
const CENTRAL = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	hour: 'numeric',
	minute: '2-digit',
	timeZone: 'America/Chicago'
});
const kickoff = (iso) => CENTRAL.format(new Date(iso)).replace(/ (AM|PM)$/, (m) => m.toLowerCase());

// ---- the cards -------------------------------------------------------------------------------
const pickupAt = new Set(advice.pickups.map((p) => p.add.player.position));
const PICKED = new Set(advice.pickups.map((p) => p.add.player.name));
const gaining = (row) => PICKED.has(row.add.player.name) || (row.gain > 0 && row.beats !== null);
const countAll = advice.rows.length;
const countGain = advice.rows.filter(gaining).length;

function standing(card, mode) {
	const own = mode === 'season' ? card.rest_of_season : card.week;
	// K and D/ST carry no rest-of-season order: their card reads this week's, and says so (ruling 5).
	if (own === null && mode === 'season' && card.week !== null) return { ...card.week, swapped: true };
	return own === null ? null : { ...own, swapped: false };
}

/** The weakest Need, else All (ruling 2). */
function opening() {
	const needs = advice.positions.filter((c) => c.need && c.rest_of_season !== null);
	if (needs.length === 0) return 'ALL';
	return needs.sort((a, b) => b.rest_of_season.rank - a.rest_of_season.rank)[0].position;
}

function cardHtml(card, mode) {
	const s = standing(card, mode);
	const need = card.need && mode === 'season';
	const pick = pickupAt.has(card.position) ? '<span class="pk" title="A pickup is here">Pickup</span>' : '';
	const place = s
		? `<span class="rk">rank <b>${s.rank}</b> of ${card.teams}</span>`
		: '<span class="rk">--</span>';
	const fig = s
		? `<span class="fig"><b>${tenth(s.points)}</b>${s.swapped ? '<span class="tag">Proj this week</span>' : ''}${need ? '<span class="need">Need</span>' : ''}</span>`
		: '<span class="fig wait">Ranks once this week’s Proj is read</span>';
	const med = s ? `<span class="med">${tenth(s.median)} median</span>` : '';
	const bar = s && s.median > 0 ? meter(s.points, s.median) : '<span class="meter"></span>';
	return `<button type="button" class="pcard" data-pos="${card.position}" aria-pressed="false">
		<span class="top"><b class="pw">${WORD[card.position]}</b>${pick}</span>
		${place}${fig}${bar}${med}</button>`;
}

/** The member's figure against the median team's, a thin rule: the median tick at the middle. */
function meter(points, median) {
	const ratio = Math.max(0, Math.min(2, points / median));
	const w = Math.round((ratio / 2) * 100);
	return `<span class="meter"><span class="fill${ratio < 1 ? ' under' : ''}" style="width:${w}%"></span><span class="tick"></span></span>`;
}

function allCard() {
	return `<button type="button" class="pcard all" data-pos="ALL" aria-pressed="false">
		<span class="top"><b class="pw">All</b></span>
		<span class="rk"><b>${countAll}</b> free agents</span>
		<span class="fig"><b>${countGain}</b><span class="tag">beat yours</span></span>
		<span class="meter"></span><span class="med">Every position</span></button>`;
}

function cardsHtml(mode) {
	return `<div class="pcards" data-mode="${mode}" role="group" aria-label="Positions">${allCard()}${advice.positions.map((c) => cardHtml(c, mode)).join('')}</div>`;
}

// ---- the comparison --------------------------------------------------------------------------
function gameCells(line) {
	const f = line.facts;
	if (f.bye) return '<td class="game"><b>Bye</b></td>';
	const where = f.home ? 'vs' : 'at';
	const score =
		f.game_total && f.game_total.team_points !== null
			? `${tenth(f.game_total.team_points).replace('.0', '')} to ${String(f.game_total.points - f.game_total.team_points).replace('.0', '')}`
			: '';
	return `<td class="game"><b>${where} ${esc(f.opponent)}</b> ${esc(kickoff(f.kickoff))}<span class="sub">${score}</span></td>`;
}

function playerCell(line, extra = '') {
	const p = line.player;
	const face = p.position === 'DEF'
		? `<span class="face club">${esc(p.team)}</span>`
		: `<img class="face" src="${esc(line.headshot ?? '')}" alt="" loading="lazy">`;
	return `<td class="player">${face}<span class="nm"><b>${esc(p.name)}</b><span class="sub">${esc(p.team)} <i>${WORD[p.position]}</i>${extra}</span></span></td>`;
}

function evidence(line) {
	const opp = line.opp_rank;
	const tone = opp === null ? '' : opp <= 8 ? ' soft' : opp >= 25 ? ' hard' : '';
	return `<td class="n proj">${tenth(line.week_projection)}</td>
		<td class="n ev first"><span class="opp${tone}">${opp === null ? '--' : ordinal(opp)}</span></td>
		<td class="n ev">${tenth(line.season_avg)}</td>
		<td class="n ev">${tenth(line.last_points)}</td>
		<td class="n ev delta">${line.projection_delta === null ? '--' : signed(line.projection_delta)}</td>
		<td class="n rest">${tenth(line.rest_of_season_per_game)}</td>`;
}

function mineRows(card, mode) {
	const role = (m) => (mode === 'season' ? m.starter : m.starts_this_week);
	const fig = (m) => (mode === 'season' ? (m.rest_of_season_points ?? -1) : (m.line.week_projection ?? -1));
	const sorted = [...card.mine].sort((a, b) => Number(role(b)) - Number(role(a)) || fig(b) - fig(a));
	return sorted
		.map((m) => {
			const ir = m.line.facts.designation?.status === 'injured_reserve' ? ' <i class="ir">IR</i>' : '';
			return `<tr class="mine${role(m) ? ' starts' : ''}">${playerCell(m.line, ir)}${gameCells(m.line)}${evidence(m.line)}
			<td class="n beats"><span class="role${role(m) ? ' on' : ''}">${role(m) ? 'Starter' : 'Bench'}</span></td><td class="act"></td></tr>`;
		})
		.join('');
}

function beatsCell(row) {
	const g = gaining(row);
	if (row.beats === null && !g) return '<td class="n beats"><span class="gain quiet">0.0</span></td>';
	const who = row.beats
		? `<span class="who"><b>${esc(lastName(row.beats.name))}</b><span>${row.beats.open_spot ? 'Open spot' : row.beats.starter ? 'Starter' : 'Bench'}</span></span>`
		: '';
	const loud = g && row.gain > 0;
	const week = PICKED.has(row.add.player.name) && row.week_gain !== null ? `<span class="bweek">${signed(row.week_gain)} Proj</span>` : '';
	return `<td class="n beats${loud ? ' loud' : ''}"><span class="bt">${who}<span class="figs"><span class="gain${g ? '' : ' quiet'}">${signed(row.gain)} Gain</span>${week}</span></span></td>`;
}

function freeRow(row) {
	const g = gaining(row);
	return `<tr class="free${PICKED.has(row.add.player.name) ? ' named' : ''}">${playerCell(row.add)}${gameCells(row.add)}${evidence(row.add)}${beatsCell(row)}
		<td class="act"><button type="button" class="add${g ? '' : ' quiet'}">+ <span>Add</span></button></td></tr>`;
}

function freeRows(rows, mode) {
	const order = mode === 'season' ? rows : [...rows].sort((a, b) => (b.add.week_projection ?? -99) - (a.add.week_projection ?? -99));
	const up = order.filter(gaining);
	const rest = order.filter((r) => !gaining(r));
	return `${up.map(freeRow).join('')}${rest.length > 0 ? `<tr class="divider"><th colspan="11" scope="rowgroup">No gain over your roster</th></tr>${rest.map(freeRow).join('')}` : ''}`;
}

const HEADS = [
	['Player', 'player'],
	['Game', 'game'],
	['Proj', 'n num proj'],
	['Opp rank', 'n ev first'],
	['Avg', 'n ev'],
	['Last', 'n ev'],
	['Δ Proj', 'n ev delta'],
	['A game', 'n rest'],
	['Beats', 'n beats']
];

function table(pos, mode) {
	const sortKey = mode === 'season' ? 'Beats' : 'Proj';
	const heads = HEADS.map(
		([label, cls]) => `<th class="${cls}${label === sortKey ? ' on' : ''}" scope="col">${label}${label === sortKey ? ' ▾' : ''}</th>`
	).join('');
	const basis =
		'<b>A game</b> is our rest-of-season points a game, <b>Avg</b> his season average, <b>Δ Proj</b> his Proj’s change since Thu 9:00 pm, <b>Beats</b> the player he would replace in your rest-of-season lineup.';
	let body;
	if (pos === 'ALL') {
		body = freeRows(advice.rows, mode);
	} else {
		const card = advice.positions.find((c) => c.position === pos);
		const free = NARROWED[pos].rows;
		body = `<tr class="group yours"><th colspan="11" scope="rowgroup">Your ${WORD[pos]}</th></tr>${mineRows(card, mode)}
			<tr class="group freeat"><th colspan="11" scope="rowgroup">Free at ${WORD[pos]}${free.length === 0 ? '' : `, ${free.length} we rank`}</th></tr>
			${free.length === 0 ? `<tr><td class="empty" colspan="11">No ${WORD[pos]} free on Sleeper beats a player of yours or ranks in our order.</td></tr>` : freeRows(free, mode)}`;
	}
	return `<table class="pool"><thead><tr class="cols">${heads}<th class="act"></th></tr>
		<tr class="hb"><td colspan="11">${basis}</td></tr></thead><tbody>${body}</tbody></table>`;
}

function leadLine(pos, mode) {
	if (pos === 'ALL') {
		return `<p class="lead"><b>Every free agent we rank on Sleeper</b><span>${countGain} beat a player of yours. Pick a position to set them against your players there.</span></p>`;
	}
	const card = advice.positions.find((c) => c.position === pos);
	const s = standing(card, mode);
	const w = WORD[pos];
	if (s === null) return `<p class="lead"><b>${w}</b><span>Ranks once this week’s Proj is read.</span></p>`;
	const what = s.swapped
		? `${w} has no rest-of-season order, so it ranks on this week’s Proj.`
		: mode === 'season'
			? `Rank is your starters’ rest of season at ${w} against the league’s.`
			: `Rank is your starters’ Proj this week at ${w} against the league’s.`;
	const need = card.need && mode === 'season' ? ' <em>Need</em>: under the league’s median.' : '';
	return `<p class="lead"><b>${w} rank ${s.rank} of ${card.teams}</b><span>${tenth(s.points)} against a ${tenth(s.median)} median. ${what}${need}</span></p>`;
}

function views() {
	const out = [];
	for (const mode of ['season', 'week']) {
		for (const pos of ['ALL', ...advice.positions.map((c) => c.position)]) {
			out.push(`<section class="view" data-view="${pos}:${mode}" hidden>${leadLine(pos, mode)}${table(pos, mode)}</section>`);
		}
	}
	return out.join('\n');
}

// ---- the strip -------------------------------------------------------------------------------
function strip() {
	const cards = advice.pickups
		.map((p, i) => {
			const why = p.drop?.facts?.designation?.status === 'injured_reserve' ? ' <span class="why">(IR, on your bench)</span>' : '';
			return `<li class="pickup${i === 0 ? ' on' : ''}" data-pos="${p.add.player.position}"><span class="slot">${WORD[p.add.player.position]}</span>
			<span class="text"><span class="move">${i === 0 ? '<span class="best">Best</span>' : ''}<b>Add ${esc(lastName(p.add.player.name))}, drop ${esc(lastName(p.drop.player.name))}</b>${why}</span>
			<span class="gains">${signed(p.week_gain)} Proj this week, ${signed(p.gain)} Gain a week</span></span>
			<button type="button" class="sverb${i === 0 ? ' lead' : ''}">Open Sleeper waivers</button></li>`;
		})
		.join('');
	return `<section class="strip" aria-label="Our call">
		<div class="shead"><span class="wk">Week ${advice.week}</span><span class="title">Two pickups</span>
		<span class="sum"><b>${tenth(advice.pickups_proj)}</b> Proj with both, ${tenth(advice.lineup_proj)} without, <em>${signed(advice.pickups_proj - advice.lineup_proj)}</em></span></div>
		<ul class="pickups">${cards}</ul>
		<p class="sfoot">${esc(advice.moves.reason)}</p></section>`;
}

// ---- the page --------------------------------------------------------------------------------
const RAIL = ['League', 'Lineup', 'Matchup', 'Waivers', 'Trades', 'Players', 'Rest of season', 'Our record'];

function page(theme) {
	const start = opening();
	return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waivers cards mock</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800&family=Outfit:wght@300..800&display=swap" rel="stylesheet">
<style>${tokens}</style>
<link rel="stylesheet" href="mock.css">
</head><body data-mode="season" data-pos="${start}">
<nav class="rail">${RAIL.map((r) => `<a class="${r === 'Waivers' ? 'on' : ''}">${r}</a>`).join('')}</nav>
<header class="bar"><span class="h">Waivers</span><span class="switch">S.U.C.K. - Severely Underrated Carolina Keepers</span></header>
<main>
<h1>S.U.C.K. - Severely Underrated Carolina Keepers</h1>
<p class="sub1">McConkey Kong Country, 1-4, 12th of 12. Read from Sleeper 4 minutes ago. Times are in Central Time.</p>
${strip()}
<section class="nav" aria-label="Your positions">
  <div class="nhead"><span class="label">Your positions</span>
  <div class="toggle" role="group" aria-label="Figures"><button type="button" data-mode="season" aria-pressed="true">Rest of season</button><button type="button" data-mode="week" aria-pressed="false">This week</button></div></div>
  ${cardsHtml('season')}${cardsHtml('week')}
</section>
<div class="tools"><label class="search">Find a player</label><span class="count">${countAll} free agents we rank on Sleeper, ${countGain} beat yours</span></div>
${views()}
<p class="basis">${esc(advice.basis)} ${esc(advice.season_basis ?? '')}</p>
</main>
<div class="pin"><button type="button" class="sverb lead">Open Sleeper waivers</button><span>${esc(advice.moves.reason)}</span></div>
<nav class="tabs">${['League', 'Lineup', 'Matchup', 'Waivers', 'Trades'].map((r) => `<a class="${r === 'Waivers' ? 'on' : ''}">${r}</a>`).join('')}</nav>
<script>
const body = document.body;
function show() {
  const pos = body.dataset.pos, mode = body.dataset.mode;
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== pos + ':' + mode));
  document.querySelectorAll('.pcards').forEach((g) => (g.hidden = g.dataset.mode !== mode));
  document.querySelectorAll('.pcard').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.pos === pos)));
  document.querySelectorAll('.toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const on = document.querySelector('.pcards:not([hidden]) .pcard[aria-pressed="true"]');
  on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
document.querySelectorAll('.pcard').forEach((c) => c.addEventListener('click', () => { body.dataset.pos = c.dataset.pos; show(); }));
document.querySelectorAll('.toggle button').forEach((b) => b.addEventListener('click', () => { body.dataset.mode = b.dataset.mode; show(); }));
const asked = new URLSearchParams(location.search);
if (asked.get('pos')) body.dataset.pos = asked.get('pos');
if (asked.get('mode')) body.dataset.mode = asked.get('mode');
show();
</script>
</body></html>`;
}

for (const theme of ['light', 'dark']) {
	writeFileSync(new URL(`waivers-cards-${theme}.html`, here), page(theme));
}
process.stdout.write(`opens on ${opening()}\n`);
