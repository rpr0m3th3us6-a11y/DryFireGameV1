// Boot, router and top-level views.
import { kv, attempts, requestPersistence, wipeAll } from './db.js';
import { C, loadContent, levelDrills, bossComponents, unitsForTrack, trackEnabled, drillAvailable, TARGET_LABEL, START_LABEL, validatePack } from './content.js';
import {
  S, loadState, saveProfile, saveSettings, saveProgress, rankFor, unitUnlocked, unitComplete, levelUnlocked, levelComplete,
  bossUnlocked, drillUnlocked, unitProgress, nextUp, manCardUnlocked, recordDrill, recordBoss, skipLevel, liveStreak,
  weeklyProgress, badgeInfo, award, locateDrill, defaultProgress, BADGES,
} from './progress.js';
import { summarize, minTier, targetPar, fmtTime, TIER_RANK } from './scoring.js';
import { currentSession, startSession, touchSession, endSession } from './session.js';
import { runSeries } from './runner.js';
import { renderManCard } from './mancard.js';
import { renderStats } from './stats.js';
import { setupDiagram, distLabel, miniGrid } from './diagram.js';
import { mount, on, esc, icon, toast, confirmBox, modal, fmtDate, pickFile, $ } from './ui.js';
import * as A from './audio.js';

const SAFETY_ITEMS = [
  ['unloaded', 'Every firearm in this session is verified unloaded: magazine out, chamber checked visually AND physically.'],
  ['ammo', 'All live ammunition is out of the room, including magazines and spare rounds. Nothing live within reach.'],
  ['backstop', 'I am pointing at a backstop that would stop a round if one were somehow fired (not a thin wall, window or occupied room).'],
  ['laser', 'I am using a laser device, laser cartridge or dedicated training pistol. Only inert dummy rounds for reload/malfunction drills.'],
  ['eyes', 'Eyes: never look into the laser emitter; eye protection is recommended. Ears: no hearing protection needed for dry fire; keep beep volume comfortable.'],
  ['people', 'No one is downrange or in adjoining rooms along the line of fire, and distractions (kids, pets, phone calls) are handled.'],
  ['end', 'When I end the session I will say "dry fire is over" and will not take "one more rep" after reloading.'],
];

const DISCLAIMER = `This app is a <b>training aid only</b>. It does not replace qualified in-person instruction.
Dry fire must be done with <b>unloaded firearms and no live ammunition present</b>. Nothing here is legal advice:
laws on carry, use of force and firearm handling vary by jurisdiction, so follow your local laws and the manufacturer's
guidance for your firearm, holster and training device. You are responsible for your own safety.`;

// ---- Router ------------------------------------------------------------------
function nav(hash, reload = false) {
  if (reload) { location.hash = hash; location.reload(); return; }
  if (location.hash === hash) route(); else location.hash = hash;
}

async function route() {
  A.stopSpeech();
  const [path, query] = (location.hash.slice(1) || '/home').split('?');
  const [, name, arg] = path.split('/');
  const params = new URLSearchParams(query || '');
  const safety = await kv.get('safety');
  if (!safety?.firstRun && name !== 'welcome') return nav('#/welcome');
  if (safety?.firstRun && !S.profile?.setupComplete && name !== 'setup' && name !== 'welcome') return nav('#/setup');
  setNav(name);
  const views = {
    welcome: () => welcomeView(),
    setup: () => setupView(+arg || 0),
    calibrate: () => gated(() => calibrationView()),
    home: () => homeView(),
    tree: () => treeView(arg || params.get('t')),
    unit: () => unitView(arg),
    drill: () => drillView(arg),
    run: () => gated(() => runDrill(arg)),
    boss: () => gated(() => runBoss(arg)),
    mancard: () => renderManCard(nav),
    stats: () => renderStats(nav, arg || 'overview'),
    badges: () => badgesView(),
    settings: () => settingsView(),
    safety: () => safetyView(params.get('next')),
  };
  (views[name] || views.home)();
}

async function gated(fn) {
  if (!await currentSession()) return nav('#/safety?next=' + encodeURIComponent(location.hash));
  fn();
}

function setNav(name) {
  const map = { home: 'home', tree: 'tree', unit: 'tree', drill: 'tree', mancard: 'tree', stats: 'stats', badges: 'badges', settings: 'settings' };
  const hide = ['welcome', 'setup', 'safety', 'calibrate'].includes(name);
  document.body.classList.toggle('no-nav', hide);
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === map[name]));
}

// ---- Welcome / disclaimer / first-run safety ----------------------------------
function welcomeView() {
  mount(`<section class="page onboarding">
    <div class="brand">${icon.target}<h1>Dry-Fire Trainer</h1></div>
    <p class="lead">A structured, gamified dry-fire program for laser targets. Offline, private, no account.</p>
    <div class="card disclaimer"><h2>${icon.shield} Before you start</h2><p>${DISCLAIMER}</p></div>
    ${checklistHtml()}
    <label class="ack"><input type="checkbox" id="ack-disc"> I have read the disclaimer and accept responsibility for safe dry-fire practice.</label>
    <button class="btn primary big" data-act="go">Accept and continue</button>
  </section>`, (root) => on(root, {
    go: async () => {
      if (!allChecked(root) || !$('#ack-disc').checked) return toast('Check every item to continue.');
      await kv.set('safety', { firstRun: new Date().toISOString(), disclaimer: new Date().toISOString() });
      await startSession(SAFETY_ITEMS.map(i => i[0]));
      nav('#/setup');
    },
  }));
}

function checklistHtml() {
  return `<fieldset class="checklist"><legend>Dry-fire safety checklist</legend>
    ${SAFETY_ITEMS.map(([k, t]) => `<label><input type="checkbox" data-k="${k}"> <span>${esc(t)}</span></label>`).join('')}
  </fieldset>`;
}
const allChecked = (root) => [...root.querySelectorAll('.checklist input')].every(i => i.checked);

function safetyView(next) {
  mount(`<section class="page onboarding">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>${icon.shield} Session check</h1></header>
    <p class="lead">Required before every session. Take the ten seconds: this is the habit that keeps dry fire dry.</p>
    ${checklistHtml()}
    <button class="btn primary big" data-act="go">Start session</button>
    <p class="muted small">${DISCLAIMER}</p>
  </section>`, (root) => on(root, {
    back: () => nav('#/home'),
    go: async () => {
      if (!allChecked(root)) return toast('Confirm every item to start.');
      await A.unlock();
      await startSession(SAFETY_ITEMS.map(i => i[0]));
      toast('Session started. Train safe.');
      nav(next || '#/home');
    },
  }));
}

// ---- Setup wizard ------------------------------------------------------------
const SETUP_STEPS = [
  { key: 'target', title: 'Which laser target do you have?', type: 'one', options: [
    ['circle', 'Single circle', 'One aim point. Difficulty comes from time, draw, position and shot count.'],
    ['grid', '9-square grid (3×3)', 'Numbered squares, called sequences and transitions.'],
    ['both', 'Both / mixed', 'Everything, plus combined drills.']] },
  { key: 'tracks', title: 'What are you training?', type: 'many', options: [
    ['pistol', 'Pistol', 'Primary program: 8 units from fundamentals to the Man Card.'],
    ['ccw', 'Concealed carry', 'Sub-tree inside pistol: concealment, seated, bag, decisions.'],
    ['rifle', 'Rifle', 'Readies, positions, reloads, transitions to pistol.']] },
  { key: 'holster', title: 'Holster / carry method', type: 'one', options: [
    ['owb', 'Open carry / OWB belt holster', ''], ['aiwb', 'Appendix IWB (AIWB)', ''],
    ['iwb', 'Strong-side IWB', ''], ['pocket', 'Pocket holster', ''], ['none', 'No holster yet', 'Draw drills will be listed but you should get a quality holster first.']] },
  { key: 'hand', title: 'Handedness', type: 'one', options: [['right', 'Right-handed', ''], ['left', 'Left-handed', 'Left/right in setups are written for right-handers: mirror them.']] },
  { key: 'experience', title: 'Experience level', type: 'one', options: [
    ['new', 'New', 'Under a year, or no formal training.'], ['intermediate', 'Intermediate', 'Regular practice, some classes.'],
    ['advanced', 'Advanced', 'Competition, instructor, or years of structured training.']] },
  { key: 'roomFt', title: 'Longest distance available', type: 'one', options: [
    ['10', 'About 10 ft (3 yd)', ''], ['15', 'About 15 ft (5 yd)', ''], ['21', 'About 21 ft (7 yd)', ''], ['30', '30 ft or more', '']] },
];

function setupView(step) {
  const p = S.profile || { tracks: ['pistol'] };
  S.profile = p;
  const st = SETUP_STEPS[step];
  if (!st) return finishSetup();
  const val = p[st.key];
  const sel = (k) => st.type === 'many' ? (val || []).includes(k) : String(val) === k;
  mount(`<section class="page onboarding">
    <p class="eyebrow">Setup ${step + 1} of ${SETUP_STEPS.length}</p>
    <h1>${esc(st.title)}</h1>
    <div class="choices" role="${st.type === 'many' ? 'group' : 'radiogroup'}">
      ${st.options.map(([k, l, d]) => `<button class="choice ${sel(k) ? 'on' : ''}" data-act="pick" data-arg="${k}" aria-pressed="${sel(k)}">
        <b>${esc(l)}</b>${d ? `<small>${esc(d)}</small>` : ''}</button>`).join('')}
    </div>
    <div class="row gap">
      ${step > 0 ? '<button class="btn ghost" data-act="prev">Back</button>' : ''}
      <button class="btn primary big" data-act="next">${step === SETUP_STEPS.length - 1 ? 'Finish' : 'Next'}</button>
    </div>
  </section>`, (root) => on(root, {
    pick: (k) => {
      if (st.type === 'many') {
        const set = new Set(p.tracks || []);
        set.has(k) ? set.delete(k) : set.add(k);
        if (k === 'ccw' && set.has('ccw')) set.add('pistol');
        if (k === 'pistol' && !set.has('pistol')) set.delete('ccw');
        p.tracks = [...set];
      } else p[st.key] = st.key === 'roomFt' ? +k : k;
      setupView(step);
    },
    prev: () => setupView(step - 1),
    next: () => {
      const v = p[st.key];
      if (v == null || (Array.isArray(v) && !v.length)) return toast('Pick an option.');
      setupView(step + 1);
    },
  }));
}

async function finishSetup() {
  const first = !S.profile.setupComplete;
  S.profile.setupComplete = true;
  S.profile.createdAt ||= new Date().toISOString();
  await saveProfile();
  if (first) {
    const go = await modal(`<h2>Calibration baseline</h2>
      <p>A short baseline (6–9 strings) sets your starting difficulty. Experienced shooters can test out of early units.</p>
      <div class="row gap"><button class="btn ghost" data-val="skip">Skip, start at Unit 1</button><button class="btn primary" data-val="go">Run baseline</button></div>`, { dismissable: false });
    return nav(go === 'go' ? '#/calibrate' : '#/home');
  }
  toast('Profile saved.');
  nav('#/home');
}

// ---- Calibration -----------------------------------------------------------------
function calibrationView() {
  const cal = C.raw.calibration;
  const comps = cal.components
    .filter(c => !(c.requires === 'holster' && S.profile.holster === 'none'))
    .map(c => ({ drill: C.drills.get(c.drill), reps: c.reps }))
    .filter(c => c.drill);
  mount(`<section class="page">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>${esc(cal.title)}</h1></header>
    <p class="lead">${esc(cal.summary)}</p>
    <ol class="iters">${comps.map(c => `<li><span>${esc(c.drill.title)}</span><b>${c.reps} strings</b></li>`).join('')}</ol>
    <button class="btn primary big" data-act="go">${icon.play} Start baseline</button>
  </section>`, (root) => on(root, {
    back: () => nav('#/home'),
    go: () => runSeries({
      title: 'Baseline', items: comps, showItemIntro: true,
      parFor: (d) => d.par?.silver,
      onAbort: () => nav('#/home'),
      onDone: async (results) => {
        const s = await currentSession();
        const tiers = [];
        for (const r of results) {
          const sum = summarize(r.drill, r.strings);
          tiers.push(sum.tier);
          await attempts.add({ drillId: r.drill.id, kind: 'calibration', date: new Date().toISOString(), sessionId: s?.id, strings: r.strings, summary: sum, xp: 0 });
        }
        const overall = minTier(tiers);
        const place = cal.placements.find(pl => TIER_RANK[overall] >= TIER_RANK[pl.minTier] && pl.experience.includes(S.profile.experience));
        const p = S.progress;
        for (const u of place?.testOut || []) p.testedOut[u] = true;
        p.calibration = { date: new Date().toISOString(), tier: overall, testedOut: place?.testOut || [] };
        award('calibrated');
        p.xp += 50;
        await saveProgress();
        await touchSession(true);
        const start = C.unitById.get(unitsForTrack('pistol').find(u => !p.testedOut[u.id])?.id);
        mount(`<section class="page result">
          <h1>Baseline set</h1>
          <p class="lead">Overall: <span class="tier ${overall}">${overall === 'none' ? 'building' : overall}</span></p>
          <p>${place ? `You tested out of ${place.testOut.length} unit${place.testOut.length > 1 ? 's' : ''}. ` : ''}Starting point: <b>${esc(start?.title || 'Unit 1')}</b>.</p>
          <p class="muted small">Tested-out units are open for review. Their benchmarks still need a Silver for the Man Card.</p>
          <button class="btn primary big" data-act="home">Go to training</button>
        </section>`, (root2) => on(root2, { home: () => nav('#/tree') }));
      },
    }),
  }));
}

// ---- Home ---------------------------------------------------------------------------
async function homeView() {
  const p = S.progress;
  const rank = rankFor(p.xp);
  const streak = liveStreak();
  const wk = await weeklyProgress();
  const session = await currentSession();
  const next = nextUp();
  const mc = manCardUnlocked();
  const ring = (pct) => {
    const r = 26, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 64 64" class="ring" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="ring-bg"/><circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${(c * Math.min(1, pct)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>`;
  };
  let nextHtml = '<p class="muted">Everything available is complete. Chase Gold tiers or run the Man Card.</p>';
  if (next?.type === 'drill') nextHtml = `<p class="eyebrow">${esc(next.unit.title)} · ${esc(next.level.title)}</p><h2>${esc(next.drill.title)}</h2><p class="muted">${esc(next.drill.objective)}</p>
    <button class="btn primary big" data-act="open" data-arg="#/drill/${next.drill.id}">${icon.play} Continue</button>`;
  if (next?.type === 'boss') nextHtml = `<p class="eyebrow">${esc(next.unit.title)}</p><h2>${icon.skull} ${esc(next.unit.boss.title)}</h2><p class="muted">${esc(next.unit.boss.summary || '')}</p>
    <button class="btn primary big" data-act="open" data-arg="#/unit/${next.unit.id}">Take the benchmark</button>`;
  if (next?.type === 'mancard') nextHtml = `<h2>${icon.card} Man Card unlocked</h2><p class="muted">Shoot it cold.</p><button class="btn primary big" data-act="open" data-arg="#/mancard">Open the Man Card</button>`;

  mount(`<section class="page home">
    <header class="home-head">
      <div><p class="eyebrow">Rank ${rank.index}</p><h1>${esc(rank.name)}</h1></div>
      <div class="streak ${streak ? 'on' : ''}" title="Daily streak">${icon.flame}<b>${streak}</b><small>day${streak === 1 ? '' : 's'}</small>
        ${p.streak.freezes ? `<span class="freeze" title="Streak freezes">${icon.snow}${p.streak.freezes}</span>` : ''}</div>
    </header>
    <div class="xpbar" role="progressbar" aria-valuenow="${p.xp}" aria-label="XP"><i style="width:${Math.round(rank.pct * 100)}%"></i></div>
    <p class="muted small">${p.xp} XP${rank.next ? ` · ${rank.next - p.xp} to ${esc(rankFor(rank.next).name)}` : ' · top rank'}</p>

    <article class="card next">${nextHtml}</article>

    <div class="tiles">
      <div class="tile goal">${ring(wk.days / wk.goal)}<div><small>This week</small><b>${wk.days}/${wk.goal}</b><small>days</small></div></div>
      <div class="tile"><small>Session</small><b>${session ? 'Active' : 'Not started'}</b>
        ${session ? `<small>${session.drills || 0} drills</small>` : ''}</div>
    </div>
    <div class="row gap wrap">
      ${session ? '<button class="btn ghost" data-act="end">End session</button>' : '<button class="btn" data-act="open" data-arg="#/safety">Start session (safety check)</button>'}
      <button class="btn ghost" data-act="open" data-arg="#/mancard">${icon.card} Man Card ${mc.ok ? '' : icon.lock}</button>
    </div>
    ${!p.calibration && !Object.keys(p.drills).length ? `<button class="btn ghost" data-act="open" data-arg="#/calibrate">Run calibration baseline</button>` : ''}
  </section>`, (root) => on(root, {
    open: (h) => nav(h),
    end: async () => {
      await modal(`<h2>Dry fire is over</h2><p>Say it out loud. If you are reloading a carry gun, do it now, deliberately, and <b>do not</b> take one more rep.</p>
        <div class="row"><button class="btn primary" data-val="ok">Session ended</button></div>`);
      await endSession();
      homeView();
    },
  }));
}

// ---- Skill tree ----------------------------------------------------------------------
function treeView(track) {
  const tracks = C.tracks.filter(t => trackEnabled(t.id, S.profile));
  const cur = tracks.find(t => t.id === track) || tracks[0];
  const units = unitsForTrack(cur.id);
  mount(`<section class="page">
    <header class="page-head"><h1>${icon.tree} Train</h1></header>
    ${tracks.length > 1 ? `<nav class="tabs">${tracks.map(t => `<button class="${t.id === cur.id ? 'on' : ''}" data-act="track" data-arg="${t.id}">${esc(t.name)}</button>`).join('')}</nav>` : ''}
    <p class="muted">${esc(cur.summary || '')} Target: <b>${TARGET_LABEL[S.profile.target]}</b>.</p>
    <ol class="path">${units.map((u, i) => {
      const unlocked = unitUnlocked(u);
      const done = unitComplete(u);
      const prog = unitProgress(u);
      const bossTier = u.boss?.type === 'mancard' ? (Object.keys(S.progress.manCard.earned).length ? 'gold' : 'none') : S.progress.bosses[u.boss?.id]?.tier || 'none';
      const req = !unlocked ? unitRequiresText(u) : '';
      return `<li class="unit-node ${unlocked ? '' : 'locked'} ${done ? 'done' : ''}">
        <button class="node" data-act="unit" data-arg="${u.id}" ${unlocked || S.settings.unlockAll ? '' : 'aria-disabled="true"'}>
          <span class="node-num">${done ? icon.check : unlocked ? u.order : icon.lock}</span>
          <span class="node-body"><small>Unit ${u.order}${S.progress.testedOut[u.id] ? ' · tested out' : ''}</small><b>${esc(u.title)}</b>
            <span class="bar"><i style="width:${Math.round(prog.pct * 100)}%"></i></span>
            <small>${prog.done}/${prog.total} drills · Benchmark ${bossTier === 'none' ? 'not passed' : `<span class="tier ${bossTier}">${bossTier}</span>`}</small>
            ${req ? `<small class="req">${esc(req)}</small>` : ''}</span>
        </button></li>`;
    }).join('')}</ol>
  </section>`, (root) => on(root, {
    track: (t) => nav('#/tree/' + t),
    unit: (id) => {
      const u = C.unitById.get(id);
      if (!unitUnlocked(u)) return toast(unitRequiresText(u));
      nav('#/unit/' + id);
    },
  }));
}

function unitRequiresText(u) {
  const req = (u.requires || []).length ? u.requires : [unitsForTrack(u.track)[unitsForTrack(u.track).indexOf(u) - 1]?.id].filter(Boolean);
  const names = req.map(id => C.unitById.get(id)?.title).filter(Boolean);
  return names.length ? `Pass the ${names.join(' and ')} benchmark to unlock.` : 'Locked';
}

function unitView(id) {
  const u = C.unitById.get(id);
  if (!u) return nav('#/tree');
  const p = S.progress;
  const levels = u.levels.map((l, i) => {
    const unlocked = levelUnlocked(u, i);
    const ds = levelDrills(l, S.profile);
    const complete = levelComplete(l);
    const hidden = l.drills.length - ds.length;
    return `<section class="level ${unlocked ? '' : 'locked'}">
      <header class="row between"><h2>${esc(l.title)}</h2>${complete ? `<span class="tier gold">${p.levels[l.id]?.skipped ? 'SKIPPED' : 'DONE'}</span>` : unlocked ? '' : icon.lock}</header>
      <ul class="drill-list">${ds.map(d => {
        const r = p.drills[d.id];
        return `<li><button class="drill-row" data-act="drill" data-arg="${d.id}">
          <span class="tier-dot ${r?.bestTier || 'none'}" aria-label="${r?.bestTier || 'no'} tier"></span>
          <span><b>${esc(d.title)}</b><small>${esc(TARGET_LABEL[d.target])} · ${esc(START_LABEL[d.start] || d.start)} · ${d.reps}×${d.shots}${d.par ? ` · par ${d.par.bronze}s` : ''}</small></span>
          ${d.mode === 'sequence' ? miniGrid(d.sequence) : ''}
        </button></li>`;
      }).join('')}</ul>
      ${hidden ? `<p class="muted small">${hidden} drill${hidden > 1 ? 's' : ''} hidden for your target type.</p>` : ''}
    </section>`;
  }).join('');
  let boss = '';
  if (u.boss?.type === 'mancard') {
    const mc = manCardUnlocked();
    boss = `<section class="boss card">${icon.card}<div><h2>Final boss: Man Card</h2><p class="muted">${esc(u.boss.summary)}</p>
      <button class="btn ${mc.ok ? 'primary' : 'ghost'}" data-act="mancard">${mc.ok ? 'Open the Man Card' : `${icon.lock} Requires Silver on every prior benchmark`}</button></div></section>`;
  } else if (u.boss) {
    const ok = bossUnlocked(u);
    const comps = bossComponents(u.boss, S.profile);
    const t = p.bosses[u.boss.id]?.tier || 'none';
    boss = `<section class="boss card ${ok ? '' : 'locked'}">${icon.skull}<div>
      <h2>${esc(u.boss.title)} <span class="tier ${t}">${t === 'none' ? '' : t}</span></h2><p class="muted">${esc(u.boss.summary || '')}</p>
      <ol class="iters">${comps.map(c => `<li><span>${esc(c.drill.title)}</span><b>${c.reps}×</b></li>`).join('')}</ol>
      <p class="muted small">Tier = your lowest component tier. Pass every component to clear the unit.</p>
      <button class="btn ${ok ? 'primary' : 'ghost'}" data-act="boss" ${ok ? '' : 'disabled'}>${ok ? 'Start benchmark' : `${icon.lock} Complete all levels first`}</button></div></section>`;
  }
  mount(`<section class="page">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>${esc(u.title)}</h1></header>
    <p class="lead">${esc(u.summary || '')}</p>
    ${levels}${boss}
  </section>`, (root) => on(root, {
    back: () => nav('#/tree/' + u.track),
    drill: (d) => nav('#/drill/' + d),
    boss: () => nav('#/boss/' + u.id),
    mancard: () => nav('#/mancard'),
  }));
}

// ---- Drill briefing -------------------------------------------------------------------
function drillView(id) {
  const d = C.drills.get(id);
  if (!d) return nav('#/tree');
  const r = S.progress.drills[id];
  const unlocked = drillUnlocked(id);
  const loc = locateDrill(id);
  const units = S.settings.units;
  const roomWarn = S.profile.roomFt && d.setup?.distanceYd * 3 > S.profile.roomFt
    ? `<p class="note warn-note">This drill is written for ${distLabel(d.setup.distanceYd, units)}; your room is about ${S.profile.roomFt} ft. Stand at your max distance and use a smaller aim point (a sticky dot or one grid square) to keep the same difficulty.</p>` : '';
  const needsHolster = ['holster', 'concealed', 'pocket'].includes(d.start) && S.profile.holster === 'none';
  mount(`<section class="page drill">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>${esc(d.title)}</h1></header>
    <div class="chips">
      <span class="chip">${esc(TARGET_LABEL[d.target])}</span><span class="chip">${esc(START_LABEL[d.start] || d.start)}</span>
      <span class="chip">${d.reps} strings × ${d.shots} shot${d.shots > 1 ? 's' : ''}</span>
      ${d.mode !== 'standard' ? `<span class="chip">${esc(d.mode)}</span>` : ''}
      ${r ? `<span class="tier ${r.bestTier}">${r.bestTier === 'none' ? 'not passed' : r.bestTier}</span>` : ''}
    </div>
    <p class="lead">${esc(d.objective)}</p>
    <div class="note safety">${icon.shield}<p><b>Dry fire only.</b> Verified unloaded, no live ammo in the room, laser/training device only.${d.safety ? ' ' + esc(d.safety) : ''}</p></div>
    ${needsHolster ? '<p class="note warn-note">Your profile has no holster. Practice this from a quality holster that fully covers the trigger guard.</p>' : ''}
    ${S.profile.hand === 'left' ? '<p class="muted small">Left-handed: mirror left/right in the setup and steps.</p>' : ''}

    <h2>Setup</h2>
    ${setupDiagram(d, units)}
    <dl class="setup">
      <dt>Distance</dt><dd>${distLabel(d.setup?.distanceYd, units)}</dd>
      <dt>Target height</dt><dd>${esc(d.setup?.height || 'Center at chest height')}</dd>
      <dt>Angle</dt><dd>${esc((d.setup?.angle || 'square').replace('-', ' '))}</dd>
      <dt>Where to stand</dt><dd>${esc(d.setup?.position || '')}</dd>
      ${d.setup?.notes ? `<dt>Notes</dt><dd>${esc(d.setup.notes)}</dd>` : ''}
      ${d.equipment?.length ? `<dt>Equipment</dt><dd>${d.equipment.map(esc).join(', ')}</dd>` : ''}
    </dl>
    ${roomWarn}
    ${d.mode === 'sequence' ? `<p class="seq">Sequence: <b>${d.sequence.join(' → ')}</b> ${miniGrid(d.sequence)}</p>` : ''}
    ${d.mode === 'callout' ? `<p class="seq">Random call: <b>${d.callout.count}</b> square${d.callout.count > 1 ? 's' : ''} per string, shown and spoken at the beep.</p>` : ''}
    ${d.mode === 'decision' ? `<p class="seq">Shoot on <b>${d.decision.shoot.join(', ')}</b>. Hold on <b>${d.decision.noShoot.join(', ')}</b>.</p>` : ''}

    <h2>Steps</h2>
    <ol class="steps">${d.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>

    <h2>Standard</h2>
    ${d.par ? `<table class="tbl par"><thead><tr><th></th><th>Bronze</th><th>Silver</th><th>Gold</th></tr></thead>
      <tbody><tr><th>Par / string</th><td>${d.par.bronze}s</td><td>${d.par.silver}s</td><td>${d.par.gold}s</td></tr></tbody></table>
      <p class="muted small">Pass: ≥ ${d.pass.accuracy}% hits and average time ≤ bronze par. Gold also needs ≥ ${Math.max(90, d.pass.accuracy)}% hits.</p>`
      : `<table class="tbl par"><thead><tr><th></th><th>Bronze</th><th>Silver</th><th>Gold</th></tr></thead>
      <tbody><tr><th>Accuracy</th><td>${d.accuracyTiers?.bronze ?? d.pass.accuracy}%</td><td>${d.accuracyTiers?.silver ?? '—'}%</td><td>${d.accuracyTiers?.gold ?? '—'}%</td></tr></tbody></table>
      <p class="muted small">Untimed: scored on clean reps.</p>`}

    <h2>Common errors</h2>
    <ul class="errors">${d.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
    <p class="cue">“${esc(d.cue)}”</p>
    ${r ? `<p class="muted small">Attempts ${r.attempts} · PB ${fmtTime(r.pb.avgTime)}${r.pb.hitFactor ? ` · HF ${r.pb.hitFactor}` : ''} · best accuracy ${r.pb.accuracy ?? '—'}%</p>` : ''}
    ${d.remedial ? `<button class="link" data-act="drill" data-arg="${d.remedial}">Easier version: ${esc(C.drills.get(d.remedial)?.title || '')}</button>` : ''}
    <div class="sticky-cta">
      <button class="btn primary big" data-act="start" ${unlocked ? '' : 'disabled'}>${unlocked ? `${icon.play} Start drill` : `${icon.lock} Locked`}</button>
    </div>
  </section>`, (root) => on(root, {
    back: () => nav(loc ? '#/unit/' + loc.unit.id : '#/tree'),
    drill: (x) => nav('#/drill/' + x),
    start: async () => { await A.unlock(); nav('#/run/' + id); },
  }));
}

// ---- Running a drill -------------------------------------------------------------------
function runDrill(id) {
  const d = C.drills.get(id);
  if (!d) return nav('#/tree');
  if (!drillUnlocked(id)) return nav('#/drill/' + id);
  const best = S.progress.drills[id]?.bestTier;
  runSeries({
    items: [{ drill: d }],
    parFor: (dr) => targetPar(dr, best),
    onAbort: () => nav('#/drill/' + id),
    onDone: async ([res]) => {
      const summary = summarize(d, res.strings);
      const s = await touchSession(true);
      const out = await recordDrill({ drill: d, summary, strings: res.strings, sessionId: s?.id });
      summary.passed ? A.doubleBeep() : A.failTone();
      drillSummary(d, summary, out);
    },
  });
}

function drillSummary(d, sum, out) {
  const loc = locateDrill(d.id);
  const nextD = nextUp();
  const offers = [];
  if (out.offers.skipLevel) offers.push(`<div class="card offer"><b>Gold on your first attempt.</b><p>Skip the rest of “${esc(out.offers.skipLevel.title)}” and move ahead?</p>
    <button class="btn" data-act="skip">Skip ahead</button></div>`);
  if (out.offers.remedial) offers.push(`<div class="card offer"><b>Three misses in a row on this one.</b><p>Review drill: ${esc(out.offers.remedial.title)}. Build it back up, then return.</p>
    <button class="btn" data-act="drill" data-arg="${out.offers.remedial.id}">Review drill</button></div>`);
  if (!sum.passed && !out.offers.remedial && d.remedial) offers.push(`<div class="card offer"><p>Not there yet. Retry, or run the easier version: ${esc(C.drills.get(d.remedial)?.title || '')}.</p>
    <button class="btn ghost" data-act="drill" data-arg="${d.remedial}">Easier drill</button></div>`);
  const extras = [
    out.firstPass && 'First pass',
    out.newPB && 'Personal best',
    out.tierUp && sum.tier !== 'none' && `New tier: ${sum.tier}`,
    out.streakEvt === 'freeze-earned' && 'Streak freeze earned',
    out.streakEvt === 'freeze-used' && 'Streak freeze used: streak saved',
    ...out.newBadges.map(b => `Badge: ${badgeInfo(b).name}`),
    ...out.unlocked,
  ].filter(Boolean);
  mount(`<section class="page result ${sum.passed ? 'pass' : 'fail'}">
    <p class="eyebrow">${esc(d.title)}</p>
    <h1 class="verdict">${sum.passed ? `<span class="tier big ${sum.tier}">${sum.tier}</span>` : 'Not passed'}</h1>
    <div class="tiles">
      <div class="tile"><small>Accuracy</small><b>${sum.accuracy}%</b><small>need ${d.pass.accuracy}%</small></div>
      ${d.par ? `<div class="tile"><small>Avg time</small><b>${fmtTime(sum.avgTime)}</b><small>par ${d.par.bronze}/${d.par.silver}/${d.par.gold}</small></div>
      <div class="tile"><small>Best string</small><b>${fmtTime(sum.bestTime)}</b></div>
      <div class="tile"><small>Hit factor</small><b>${sum.hitFactor ?? '—'}</b></div>` : ''}
      <div class="tile"><small>XP</small><b>+${out.xp}</b></div>
    </div>
    ${extras.length ? `<ul class="gains">${extras.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${offers.join('')}
    <div class="row gap wrap sticky-cta">
      <button class="btn ghost" data-act="retry">Retry</button>
      ${nextD?.type === 'drill' && nextD.drill.id !== d.id ? `<button class="btn primary" data-act="drill" data-arg="${nextD.drill.id}">Next: ${esc(nextD.drill.title)}</button>` : ''}
      ${nextD?.type === 'boss' ? `<button class="btn primary" data-act="unit" data-arg="${nextD.unit.id}">Benchmark unlocked</button>` : ''}
      <button class="btn ghost" data-act="unit" data-arg="${loc?.unit.id || ''}">Back to unit</button>
    </div>
  </section>`, (root) => on(root, {
    retry: () => nav('#/run/' + d.id),
    drill: (x) => nav('#/drill/' + x),
    unit: (u) => nav(u ? '#/unit/' + u : '#/tree'),
    skip: async () => { await skipLevel(out.offers.skipLevel); toast('Level marked complete.'); nav('#/unit/' + loc.unit.id); },
  }));
}

// ---- Boss benchmark ------------------------------------------------------------------------
function runBoss(unitId) {
  const u = C.unitById.get(unitId);
  if (!u?.boss || !bossUnlocked(u)) return nav('#/unit/' + unitId);
  const comps = bossComponents(u.boss, S.profile);
  runSeries({
    title: u.boss.title, showItemIntro: true,
    items: comps.map(c => ({ drill: c.drill, reps: c.reps })),
    parFor: (d) => d.par?.silver,
    onAbort: () => nav('#/unit/' + unitId),
    onDone: async (results) => {
      const rows = results.map(r => ({ drill: r.drill, sum: summarize(r.drill, r.strings), strings: r.strings }));
      const tier = minTier(rows.map(r => r.sum.tier));
      const passed = rows.every(r => r.sum.passed);
      const s = await touchSession(true);
      const out = await recordBoss({ unit: u, tier: passed ? tier : 'none', passed, sessionId: s?.id,
        results: rows.map(r => ({ id: r.drill.id, summary: r.sum, strings: r.strings })) });
      passed ? A.doubleBeep() : A.failTone();
      mount(`<section class="page result ${passed ? 'pass' : 'fail'}">
        <p class="eyebrow">${esc(u.boss.title)}</p>
        <h1 class="verdict">${passed ? `<span class="tier big ${tier}">${tier}</span>` : 'Not passed'}</h1>
        <table class="tbl"><thead><tr><th>Drill</th><th>Acc</th><th>Avg</th><th>Tier</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="${r.sum.passed ? 'ok' : 'bad'}"><td>${esc(r.drill.title)}</td><td>${r.sum.accuracy}%</td><td>${fmtTime(r.sum.avgTime)}</td><td><span class="tier ${r.sum.tier}">${r.sum.tier}</span></td></tr>`).join('')}
        </tbody></table>
        <p>+${out.xp} XP</p>
        ${[...out.newBadges.map(b => 'Badge: ' + badgeInfo(b).name), ...out.unlocked].map(e => `<p class="gain">${esc(e)}</p>`).join('')}
        ${passed && tier !== 'gold' ? '<p class="muted">Benchmark tier is your weakest component. Silver on every prior benchmark unlocks the Man Card.</p>' : ''}
        <div class="row gap wrap"><button class="btn ghost" data-act="retry">Retry</button><button class="btn primary" data-act="tree">Skill tree</button></div>
      </section>`, (root) => on(root, { retry: () => nav('#/boss/' + unitId), tree: () => nav('#/tree/' + u.track) }));
    },
  });
}

// ---- Badges ----------------------------------------------------------------------------------
function badgesView() {
  const earned = S.progress.badges;
  const possible = [...Object.keys(BADGES).filter(k => !k.startsWith('mancard')),
    ...C.units.filter(u => trackEnabled(u.track, S.profile) && u.boss?.type !== 'mancard').flatMap(u => [`unit:${u.id}`, `boss-gold:${u.id}`]),
    'mancard-short', 'mancard-short-carry', 'mancard-long', 'mancard-long-carry'];
  const all = [...new Set([...Object.keys(earned), ...possible])];
  mount(`<section class="page">
    <header class="page-head"><h1>${icon.medal} Badges</h1></header>
    <p class="muted">${Object.keys(earned).length} earned. Badges are dated and permanent: resetting progress keeps Man Card badges unless you choose otherwise.</p>
    <ul class="badges">${all.map(id => {
      const b = badgeInfo(id);
      const d = earned[id];
      return `<li class="${d ? 'on' : ''}">${id.startsWith('mancard') ? icon.card : icon.medal}<b>${esc(b.name)}</b><small>${esc(b.desc)}</small>${d ? `<small class="date">${fmtDate(d)}</small>` : ''}</li>`;
    }).join('')}</ul>
  </section>`);
}

// ---- Settings ----------------------------------------------------------------------------------
function settingsView() {
  const s = S.settings;
  const pr = S.profile;
  const sw = (k, label, hint = '') => `<label class="switch"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span>${label}</span></label>${hint ? `<p class="muted small">${hint}</p>` : ''}`;
  mount(`<section class="page settings">
    <header class="page-head"><h1>${icon.gear} Settings</h1></header>

    <h2>Profile</h2>
    <div class="card">
      <p>Target <b>${TARGET_LABEL[pr.target]}</b> · Tracks <b>${pr.tracks.join(', ')}</b> · Holster <b>${esc(pr.holster)}</b> · ${esc(pr.hand)}-handed · ${esc(pr.experience)} · room ${pr.roomFt} ft</p>
      <div class="seg" role="group" aria-label="Target type">${['circle', 'grid', 'both'].map(t => `<button class="${pr.target === t ? 'on' : ''}" data-act="target" data-arg="${t}">${TARGET_LABEL[t]}</button>`).join('')}</div>
      <button class="btn ghost" data-act="setup">Edit full setup</button>
      <button class="btn ghost" data-act="calibrate">Re-run calibration</button>
    </div>

    <h2>Timer & audio</h2>
    <div class="card">
      <label class="field"><span>Volume <output id="vol-out">${Math.round(s.volume * 100)}%</output></span><input type="range" min="0" max="1" step="0.05" data-k="volume" value="${s.volume}"></label>
      <label class="field"><span>Beep style</span><select data-k="beepStyle">${[['timer', 'Shot timer (sharp)'], ['low', 'Low tone'], ['buzzer', 'Buzzer'], ['chirp', 'Chirp']].map(([k, l]) => `<option value="${k}" ${s.beepStyle === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn ghost" data-act="test-beep">Test beep</button>
      <div class="row gap">
        <label class="field"><span>Random delay min (s)</span><input type="number" min="0.5" max="10" step="0.5" data-k="delayMin" value="${s.delayMin}"></label>
        <label class="field"><span>max (s)</span><input type="number" min="0.5" max="10" step="0.5" data-k="delayMax" value="${s.delayMax}"></label>
      </div>
      ${sw('parBeep', 'Par-time beep', 'A second, lower beep at the par for the next tier you have not earned.')}
      ${sw('voice', 'Spoken callouts', 'On-device speech for called squares and numbers.')}
      ${sw('visualOnly', 'Silent / visual mode', 'No sound: the screen flashes at the start signal.')}
      ${sw('flash', 'Flash screen at the beep')}
      ${sw('haptics', 'Haptics (vibration)', 'Android only; iOS browsers do not expose vibration.')}
      ${sw('mic', 'Mic shot detection (beta)', 'Listens for the trigger click to stop the timer. Tap still works. Audio never leaves the device.')}
      <label class="field"><span>Mic sensitivity <output id="mic-out">${s.micSensitivity}</output></span><input type="range" min="1" max="10" step="1" data-k="micSensitivity" value="${s.micSensitivity}"></label>
      <button class="btn ghost" data-act="mic-test">Test mic detection</button>
    </div>

    <h2>Display & goals</h2>
    <div class="card">
      ${sw('largeText', 'Large text')}
      <label class="field"><span>Distance units</span><select data-k="units"><option value="yd" ${s.units === 'yd' ? 'selected' : ''}>Yards / feet</option><option value="m" ${s.units === 'm' ? 'selected' : ''}>Meters</option></select></label>
      <label class="field"><span>Weekly goal (training days)</span><input type="number" min="1" max="7" data-k="weeklyGoal" value="${s.weeklyGoal}"></label>
    </div>

    <h2>Progression</h2>
    <div class="card">
      ${sw('unlockAll', 'Unlock all content', 'For experienced shooters: opens every unit, level, benchmark and the Man Card. Progress still records normally.')}
    </div>

    <h2>Custom drills</h2>
    <div class="card">
      <p class="muted">Import a JSON drill pack (same format as drills.json: <code>{ "drills": [], "units": [], "levels": [] }</code>). Stored on this device only.</p>
      <div class="row gap wrap"><button class="btn" data-act="pack-import">Import pack</button>
      <button class="btn ghost" data-act="pack-remove">Remove custom pack</button></div>
    </div>

    <h2>Data</h2>
    <div class="card">
      <button class="btn ghost" data-act="stats-data">Export / import backup</button>
      <button class="btn danger" data-act="reset">Reset progress</button>
    </div>

    <h2>About</h2>
    <div class="card"><p class="small">${DISCLAIMER}</p>
      <p class="muted small">Content v${esc(C.raw.contentVersion)} · ${C.drills.size} drills · works offline · no tracking, no network calls.</p></div>
  </section>`, (root) => {
    root.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', async () => {
      const k = el.dataset.k;
      s[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
      if (k === 'delayMax' && s.delayMax < s.delayMin) s.delayMax = s.delayMin;
      await saveSettings();
      applySettings();
      if (k === 'mic' && s.mic) {
        try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); }
        catch { s.mic = false; el.checked = false; await saveSettings(); toast('Microphone permission denied.'); }
      }
      if (k === 'unlockAll') toast(s.unlockAll ? 'All content unlocked.' : 'Normal progression restored.');
    }));
    root.querySelectorAll('input[type=range]').forEach(el => el.addEventListener('input', () => {
      if (el.dataset.k === 'volume') $('#vol-out').textContent = Math.round(el.value * 100) + '%';
      if (el.dataset.k === 'micSensitivity') $('#mic-out').textContent = el.value;
    }));
    on(root, {
      target: async (t) => { pr.target = t; await saveProfile(); settingsView(); toast('Target switched: ' + TARGET_LABEL[t]); },
      setup: () => nav('#/setup/0'),
      calibrate: () => nav('#/calibrate'),
      'test-beep': async () => { await A.unlock(); applySettings(); A.beep(); },
      'mic-test': () => micTest(),
      'pack-import': () => importPack(),
      'pack-remove': async () => { await kv.del('customPack'); toast('Custom pack removed.'); nav('#/settings', true); },
      'stats-data': () => nav('#/stats/data'),
      reset: async () => {
        const v = await modal(`<h2>Reset progress</h2><p>Deletes XP, tiers, streaks, attempts and session history on this device. Export a backup first if you want one.</p>
          <label class="ack"><input type="checkbox" id="keep-mc" checked> Keep Man Card badges and their dates</label>
          <div class="row gap"><button class="btn ghost" data-val="no">Cancel</button><button class="btn danger" data-val="yes">Reset</button></div>`);
        if (v !== 'yes') return;
        const keep = document.getElementById('keep-mc')?.checked ?? true;
        const old = S.progress;
        await wipeAll();
        S.progress = defaultProgress();
        if (keep) {
          S.progress.manCard.earned = { ...old.manCard.earned };
          for (const [k, d] of Object.entries(old.badges)) if (k.startsWith('mancard')) S.progress.badges[k] = d;
        }
        await saveProgress();
        toast('Progress reset.');
        nav('#/home');
      },
    });
  });
}

async function micTest() {
  await A.unlock();
  let count = 0;
  const det = new A.ShotDetector({ sensitivity: +S.settings.micSensitivity, onShot: () => { count++; const el = $('#mic-count'); if (el) el.textContent = count; } });
  try { await det.start(); } catch { return toast('Microphone not available.'); }
  const iv = setInterval(() => { const m = $('#mic-meter'); if (m) m.style.width = Math.min(100, (det.level || 0) * 150) + '%'; }, 50);
  await modal(`<h2>Mic test</h2><p>Dry-fire a few times. Each detected click counts once. Adjust sensitivity if it misses clicks or counts noise.</p>
    <div class="meter"><i id="mic-meter"></i></div><p class="big-num"><b id="mic-count">0</b> detected</p>
    <div class="row"><button class="btn primary" data-val="ok">Done</button></div>`);
  clearInterval(iv); det.stop();
}

async function importPack() {
  const text = await pickFile('.json,application/json');
  if (!text) return;
  let pack;
  try { pack = JSON.parse(text); } catch { return toast('Invalid JSON.'); }
  const errs = validatePack(pack);
  if (errs.length) return modal(`<h2>Pack has problems</h2><ul>${errs.slice(0, 10).map(e => `<li>${esc(e)}</li>`).join('')}</ul><div class="row"><button class="btn" data-val="ok">OK</button></div>`);
  await kv.set('customPack', pack);
  toast(`Imported ${pack.drills?.length || 0} drills.`);
  nav('#/settings', true);
}

// ---- Boot ----------------------------------------------------------------------------------------
function applySettings() {
  document.body.classList.toggle('large', !!S.settings.largeText);
  A.configure({ ...S.settings, volume: S.settings.visualOnly ? 0 : S.settings.volume });
}

async function boot() {
  try {
    await Promise.all([loadContent(), loadState()]);
  } catch (e) {
    $('#app').innerHTML = `<section class="page"><h1>Could not load content</h1><p>${esc(e.message)}</p></section>`;
    return;
  }
  applySettings();
  requestPersistence();
  window.addEventListener('hashchange', route);
  document.addEventListener('pointerdown', () => A.unlock(), { once: true });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready: it applies next time you open the app.', 5000);
        });
      });
    }).catch(() => {});
  }
}

boot();
