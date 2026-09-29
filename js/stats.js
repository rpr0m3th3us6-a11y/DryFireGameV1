// History, per-drill charts, weak-spot analysis, grid heatmap, export/import.
import { attempts as attemptsDb, sessions as sessionsDb, kv } from './db.js';
import { C } from './content.js';
import { S, badgeInfo, loadState } from './progress.js';
import { mount, on, esc, icon, fmtDateTime, fmtDate, download, pickFile, toast, confirmBox, dayKey } from './ui.js';
import { heatGrid } from './diagram.js';
import { fmtTime } from './scoring.js';

// ---- Analysis ---------------------------------------------------------------
// Normalized time = avgTime / silver par, so drills with different pars compare.
export function weakSpots(all) {
  const byTag = {};
  for (const a of all) {
    if (a.kind !== 'drill' && a.kind !== 'calibration') continue;
    const d = C.drills.get(a.drillId);
    if (!d?.par || a.summary?.avgTime == null) continue;
    const norm = a.summary.avgTime / d.par.silver;
    for (const t of d.tags || []) {
      const r = byTag[t] ||= { n: 0, norm: 0, acc: 0 };
      r.n++; r.norm += norm; r.acc += a.summary.accuracy;
    }
  }
  for (const r of Object.values(byTag)) { r.norm /= r.n; r.acc /= r.n; }
  const insights = [];
  for (const p of C.analysis.pairs || []) {
    const A = byTag[p.a], B = byTag[p.b];
    if (!A || !B || A.n < 2 || B.n < 2) continue;
    const pct = Math.round((A.norm / B.norm - 1) * 100);
    const accDiff = Math.round(A.acc - B.acc);
    if (Math.abs(pct) >= 10 || Math.abs(accDiff) >= 8) {
      insights.push({
        score: Math.max(pct, -accDiff),
        text: `Your ${p.label} is ${Math.abs(pct)}% ${pct >= 0 ? 'slower' : 'faster'} than your ${p.compare}`
          + (Math.abs(accDiff) >= 5 ? `, with ${Math.abs(accDiff)} pts ${accDiff < 0 ? 'lower' : 'higher'} accuracy.` : '.'),
        bad: pct > 0 || accDiff < 0,
      });
    }
  }
  insights.sort((a, b) => b.score - a.score);
  const weakest = Object.entries(byTag).filter(([, r]) => r.n >= 3)
    .sort((a, b) => (b[1].norm - b[1].acc / 100) - (a[1].norm - a[1].acc / 100)).slice(0, 3);
  return { insights, weakest, byTag };
}

export function gridStats(all) {
  const s = {};
  for (const a of all) for (const st of a.strings || []) {
    for (const n of st.called || []) { (s[n] ||= { called: 0, missed: 0 }).called++; }
    for (const n of st.missed || []) { (s[n] ||= { called: 0, missed: 0 }).missed++; }
  }
  return s;
}

// ---- Line chart (SVG, single series, tap to inspect) --------------------------
export function lineChart(points, { par, yLabel = 'seconds', invert = false } = {}) {
  if (points.length < 2) return `<p class="muted">Run this drill at least twice to see a trend.</p>`;
  const W = 340, H = 190, L = 38, R = 10, T = 12, B = 26;
  const ys = points.map(p => p.y);
  const refs = par ? [par.bronze, par.silver, par.gold] : [];
  let lo = Math.min(...ys, ...refs), hi = Math.max(...ys, ...refs);
  const pad = (hi - lo) * 0.12 || 0.5; lo = Math.max(0, lo - pad); hi += pad;
  const x = i => L + (i / (points.length - 1)) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (hi - lo) * i / ticks;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="c-tick" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  const refLines = par ? ['bronze', 'silver', 'gold'].map(t =>
    `<line x1="${L}" x2="${W - R}" y1="${y(par[t])}" y2="${y(par[t])}" class="c-par ${t}"/><text x="${W - R - 2}" y="${y(par[t]) - 3}" class="c-par-label" text-anchor="end">${t} ${par[t]}</text>`).join('') : '';
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="4" class="c-dot"/>
    <rect x="${x(i) - 12}" y="${T}" width="24" height="${H - T - B}" class="c-hit" data-i="${i}" tabindex="0" aria-label="${esc(p.label)}: ${p.y.toFixed(2)} ${yLabel}"/>`).join('');
  return `<figure class="chart" data-points='${esc(JSON.stringify(points.map(p => ({ y: p.y, l: p.label }))))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend of ${yLabel} over ${points.length} attempts">
      ${grid}${refLines}
      <path d="${path}" class="c-line"/>
      ${dots}
      <line class="c-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
    </svg>
    <figcaption class="c-tip" aria-live="polite">Tap a point for details · ${invert ? 'higher' : 'lower'} is better</figcaption>
  </figure>`;
}

export function wireCharts(root) {
  root.querySelectorAll('figure.chart').forEach(fig => {
    const pts = JSON.parse(fig.dataset.points);
    const tip = fig.querySelector('.c-tip');
    const cross = fig.querySelector('.c-cross');
    const show = (el) => {
      const i = +el.dataset.i;
      const cx = +el.getAttribute('x') + 12;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      tip.textContent = `${pts[i].l} · ${pts[i].y.toFixed(2)}`;
    };
    fig.querySelectorAll('.c-hit').forEach(h => {
      h.addEventListener('pointerenter', () => show(h));
      h.addEventListener('click', () => show(h));
      h.addEventListener('focus', () => show(h));
    });
  });
}

// ---- Page -----------------------------------------------------------------------
export async function renderStats(nav, tab = 'overview', arg = null) {
  const all = (await attemptsDb.all()).sort((a, b) => b.date.localeCompare(a.date));
  const tabs = [['overview', 'Overview'], ['log', 'Log'], ['drill', 'Drills'], ['data', 'Data']];
  let body = '';

  if (tab === 'overview') {
    const w = weakSpots(all);
    const gs = gridStats(all);
    const totalTime = all.reduce((n, a) => n + (a.strings || []).reduce((m, s) => m + (s.time || 0), 0), 0);
    const days = new Set(all.map(a => dayKey(a.date))).size;
    body = `
      <div class="tiles">
        <div class="tile"><small>Attempts</small><b>${all.length}</b></div>
        <div class="tile"><small>Training days</small><b>${days}</b></div>
        <div class="tile"><small>Best streak</small><b>${S.progress.streak.best}</b></div>
        <div class="tile"><small>Time on timer</small><b>${totalTime < 60 ? Math.round(totalTime) + 's' : Math.round(totalTime / 60) + 'm'}</b></div>
      </div>
      <h2>Weak spots</h2>
      ${w.insights.length ? `<ul class="insights">${w.insights.map(i => `<li class="${i.bad ? 'bad' : 'good'}">${esc(i.text)}</li>`).join('')}</ul>`
        : `<p class="muted">Not enough data yet. Weak-spot analysis compares paired skills (weak vs. strong hand, concealed vs. open, seated vs. standing) once you have 2+ attempts in each.</p>`}
      ${w.weakest.length ? `<h3>Slowest skill tags (vs. silver par)</h3><ul class="bars">${w.weakest.map(([t, r]) =>
        `<li><span>${esc(t)}</span><b>${Math.round(r.norm * 100)}% of par</b><small>${Math.round(r.acc)}% acc · ${r.n} runs</small></li>`).join('')}</ul>` : ''}
      <h2>Grid miss map</h2>
      ${Object.keys(gs).length ? heatGrid(gs) : '<p class="muted">Shoot some 9-grid drills to see which squares you miss.</p>'}`;
  }

  if (tab === 'log') {
    const bySession = new Map();
    for (const a of all) {
      const k = a.sessionId ?? dayKey(a.date);
      if (!bySession.has(k)) bySession.set(k, []);
      bySession.get(k).push(a);
    }
    body = all.length ? [...bySession.entries()].slice(0, 60).map(([k, list]) => `
      <article class="card log">
        <header class="row between"><b>${fmtDateTime(list.at(-1).date)}</b><small>${list.length} run${list.length > 1 ? 's' : ''} · +${list.reduce((n, a) => n + (a.xp || 0), 0)} XP</small></header>
        <ul>${list.map(a => {
          const name = a.kind === 'boss' ? C.bossById.get(a.drillId)?.boss.title : a.kind === 'mancard' ? badgeInfo(a.variant).name
            : C.drills.get(a.drillId)?.title || a.drillId;
          const s = a.summary || {};
          return `<li><span>${esc(name)}${a.kind === 'calibration' ? ' <em>(baseline)</em>' : ''}</span>
            <span class="tier ${s.tier || 'none'}">${s.tier && s.tier !== 'none' ? s.tier : s.passed === false ? 'fail' : '—'}</span>
            <small>${s.accuracy != null ? s.accuracy + '% · ' : ''}${s.avgTime != null ? fmtTime(s.avgTime) : ''}</small></li>`;
        }).join('')}</ul></article>`).join('') : '<p class="muted">No sessions logged yet.</p>';
  }

  if (tab === 'drill') {
    const ids = [...new Set(all.filter(a => a.kind === 'drill').map(a => a.drillId))];
    const sel = arg && ids.includes(arg) ? arg : ids[0];
    const d = C.drills.get(sel);
    const runs = all.filter(a => a.drillId === sel && a.kind === 'drill').reverse();
    const pts = runs.filter(r => r.summary.avgTime != null).map((r, i) => ({ y: r.summary.avgTime, label: `#${i + 1} ${fmtDate(r.date)} · ${r.summary.accuracy}%` }));
    const accPts = runs.map((r, i) => ({ y: r.summary.accuracy, label: `#${i + 1} ${fmtDate(r.date)}` }));
    const top = [...runs].filter(r => r.summary.passed).sort((a, b) => (b.summary.hitFactor ?? b.summary.accuracy) - (a.summary.hitFactor ?? a.summary.accuracy)).slice(0, 10);
    body = ids.length ? `
      <label class="field"><span>Drill</span><select id="drill-sel">${ids.map(id => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(C.drills.get(id)?.title || id)}</option>`).join('')}</select></label>
      ${d?.par ? `<h3>Average time per string</h3>${lineChart(pts, { par: d.par })}` : `<h3>Accuracy</h3>${lineChart(accPts, { yLabel: '%', invert: true })}`}
      <h3>Leaderboard vs. yourself</h3>
      ${top.length ? `<table class="tbl"><thead><tr><th>#</th><th>Date</th><th>${d?.par ? 'HF' : 'Acc'}</th><th>Time</th><th>Tier</th></tr></thead><tbody>
        ${top.map((r, i) => `<tr><td>${i + 1}</td><td>${fmtDate(r.date)}</td><td>${d?.par ? (r.summary.hitFactor ?? '—') : r.summary.accuracy + '%'}</td><td>${fmtTime(r.summary.avgTime)}</td><td><span class="tier ${r.summary.tier}">${r.summary.tier}</span></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No passing runs yet.</p>'}
      <p class="muted small">HF = hit factor: points (5 per hit, −10 per miss or no-shoot) ÷ total seconds.</p>`
      : '<p class="muted">Run a drill to start charting.</p>';
  }

  if (tab === 'data') {
    body = `
      <div class="card"><h3>Export</h3><p class="muted">Full backup (progress, settings, attempts) as JSON, or attempts as CSV for spreadsheets.</p>
        <div class="row gap wrap"><button class="btn" data-act="export-json">Export JSON backup</button><button class="btn" data-act="export-csv">Export CSV</button></div></div>
      <div class="card"><h3>Import</h3><p class="muted">Restore a JSON backup. This replaces the progress on this device.</p>
        <button class="btn" data-act="import-json">Import JSON backup</button></div>`;
  }

  mount(`<section class="page">
    <header class="page-head"><h1>${icon.chart} History</h1></header>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</nav>
    ${body}
  </section>`, (root) => {
    wireCharts(root);
    root.querySelector('#drill-sel')?.addEventListener('change', (e) => renderStats(nav, 'drill', e.target.value));
    on(root, {
      tab: (k) => renderStats(nav, k),
      'export-json': () => exportJSON(),
      'export-csv': () => exportCSV(all),
      'import-json': () => importJSON(nav),
    });
  });
}

export async function exportJSON() {
  const dump = {
    app: 'dryfire-trainer', version: 1, exported: new Date().toISOString(),
    profile: await kv.get('profile'), settings: await kv.get('settings'), progress: await kv.get('progress'),
    safety: await kv.get('safety'), customPack: await kv.get('customPack'),
    attempts: await attemptsDb.all(), sessions: await sessionsDb.all(),
  };
  download(`dryfire-backup-${dayKey()}.json`, JSON.stringify(dump, null, 2));
}

export function exportCSV(all) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'kind', 'drill_id', 'drill', 'string', 'time_s', 'hits', 'misses', 'no_shoot', 'called', 'missed', 'grip', 'sight', 'accuracy', 'avg_time', 'hit_factor', 'tier', 'passed', 'xp']];
  for (const a of [...all].reverse()) {
    const name = C.drills.get(a.drillId)?.title || C.bossById.get(a.drillId)?.boss.title || a.variant || a.drillId;
    const strings = a.strings || (a.results || []).flatMap(r => r.strings || []);
    const s = a.summary || {};
    if (!strings.length) rows.push([a.date, a.kind, a.drillId, name, '', '', '', '', '', '', '', '', '', s.accuracy, s.avgTime, s.hitFactor, s.tier, s.passed, a.xp]);
    strings.forEach((st, i) => rows.push([a.date, a.kind, a.drillId, name, i + 1, st.time, st.hits, st.misses, st.noShoot || 0,
      (st.called || []).join(' '), (st.missed || []).join(' '), st.grip, st.sight, s.accuracy, s.avgTime, s.hitFactor, s.tier, s.passed, i === 0 ? a.xp : '']));
  }
  download(`dryfire-attempts-${dayKey()}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}

async function importJSON(nav) {
  const text = await pickFile('.json,application/json');
  if (!text) return;
  let dump;
  try { dump = JSON.parse(text); } catch { return toast('That file is not valid JSON.'); }
  if (dump.app !== 'dryfire-trainer') return toast('Not a Dry-Fire Trainer backup.');
  if (!await confirmBox('Replace progress?', `Backup from ${fmtDate(dump.exported)} with ${dump.attempts?.length || 0} attempts. Current progress on this device will be replaced.`, 'Import', 'Cancel', true)) return;
  for (const k of ['profile', 'settings', 'progress', 'safety', 'customPack']) if (dump[k] != null) await kv.set(k, dump[k]);
  await attemptsDb.clear(); await sessionsDb.clear();
  for (const a of dump.attempts || []) await attemptsDb.put(a);
  for (const s of dump.sessions || []) await sessionsDb.put(s);
  await loadState();
  toast('Backup restored.');
  nav('#/home', true);
}
