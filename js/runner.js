// Drill runner: arms, randomized start beep, shot timer, par beep, callouts,
// optional mic detection, and per-string manual result entry.
//
// runSeries({ title, items: [{ drill, reps?, label? }], strict, parFor(drill), onDone(results), onAbort() })
// results: [{ drill, strings: [...] }]

import { mount, on, esc, $, keepAwake, confirmBox, toast } from './ui.js';
import * as A from './audio.js';
import { gridSvg } from './diagram.js';
import { S } from './progress.js';
import { fmtTime } from './scoring.js';

const COLORS = { green: '#1fd67a', red: '#ff3b3b', yellow: '#ffd23b', blue: '#3b8bff', white: '#ffffff', orange: '#ff8a1f' };

export function runSeries(opts) {
  const R = {
    opts, itemIndex: 0, rep: 0, strings: [], results: [],
    state: 'idle', timers: [], detector: null, shots: [], beepAt: 0, raf: 0,
  };
  document.body.classList.add('running');
  keepAwake(true);
  A.configure({ ...S.settings, volume: S.settings.visualOnly ? 0 : S.settings.volume });
  startItem(R);
  return R;
}

function item(R) { return R.opts.items[R.itemIndex]; }
function repsFor(R) { const it = item(R); return it.reps || it.drill.reps || 1; }

function cleanup(R) {
  R.timers.forEach(clearTimeout); R.timers = [];
  cancelAnimationFrame(R.raf);
  R.detector?.stop(); R.detector = null;
  A.stopSpeech();
}

function exit(R) {
  cleanup(R);
  document.body.classList.remove('running', 'lowlight');
  keepAwake(false);
}

async function abort(R) {
  const strict = R.opts.strict;
  const ok = await confirmBox('End this run?', strict
    ? 'Ending a Man Card attempt counts as a <b>fail</b>. There are no redos.'
    : 'Strings you have not saved will be discarded.', 'End run', 'Keep going', true);
  if (!ok) return;
  exit(R);
  R.opts.onAbort?.(R.results, R);
}

function startItem(R) {
  const it = item(R);
  R.rep = 0; R.strings = [];
  document.body.classList.toggle('lowlight', !!it.drill.lowLight);
  if (R.opts.items.length > 1 || R.opts.showItemIntro) itemIntro(R); else arm(R);
}

function header(R, extra = '') {
  const it = item(R);
  const total = repsFor(R);
  const series = R.opts.items.length > 1 ? `<span class="pill">${R.itemIndex + 1}/${R.opts.items.length}</span>` : '';
  return `<header class="run-head">
    <button class="icon-btn" data-act="abort" aria-label="End run">✕</button>
    <div class="run-title">${series}<b>${esc(it.label || it.drill.title)}</b>
      <small>String ${Math.min(R.rep + 1, total)} of ${total}${extra}</small></div>
  </header>`;
}

function itemIntro(R) {
  const it = item(R);
  const d = it.drill;
  const par = R.opts.parFor?.(d);
  mount(`<section class="runner">
    ${header(R)}
    <div class="run-body center">
      <p class="eyebrow">${R.opts.title ? esc(R.opts.title) : 'Next drill'}</p>
      <h1 class="big-title">${esc(it.label || d.title)}</h1>
      ${it.instructions ? `<p class="lead">${esc(it.instructions)}</p>` : `<p class="lead">${esc(d.objective || '')}</p>`}
      <div class="stat-row">
        <div><small>Start</small><b>${esc(it.startLabel || d.start || '—')}</b></div>
        <div><small>Shots</small><b>${d.shots}</b></div>
        ${par ? `<div><small>Par</small><b>${par.toFixed(2)}s</b></div>` : ''}
        <div><small>Strings</small><b>${repsFor(R)}</b></div>
      </div>
      ${d.cue ? `<p class="cue">“${esc(d.cue)}”</p>` : ''}
    </div>
    <button class="mega-btn" data-act="go">Ready</button>
  </section>`, (root) => on(root, { abort: () => abort(R), go: () => arm(R) }));
}

// ---- Arm: wait for tap, then standby, then beep -----------------------------
function arm(R) {
  cleanup(R);
  const d = item(R).drill;
  if (d.preRep && R.state !== 'prerep-done') {
    R.state = 'prerep';
    mount(`<section class="runner">${header(R)}
      <div class="run-body center">
        <p class="eyebrow">Before this string</p>
        <p class="lead big">${esc(d.preRep)}</p>
        <p class="warn">Put the firearm down, muzzle to the backstop, before any PT. Pick it up only when you're done.</p>
      </div>
      <button class="mega-btn" data-act="ready">Ready</button></section>`,
      (root) => on(root, { abort: () => abort(R), ready: () => { R.state = 'prerep-done'; arm(R); } }));
    return;
  }
  R.state = 'armed';
  const untimed = d.mode === 'untimed';
  mount(`<section class="runner">${header(R)}
    <div class="run-body center">
      <p class="eyebrow">${untimed ? 'Untimed rep' : 'Assume start position'}</p>
      <p class="lead">${esc(item(R).startLabel || startText(d))}</p>
      ${d.mode === 'sequence' ? `<p class="seq">Sequence: <b>${d.sequence.join(' → ')}</b></p>` : ''}
      ${S.settings.mic && !untimed ? `<p class="muted small" id="mic-state">Mic detection on</p>` : ''}
    </div>
    <button class="mega-btn go" data-act="start">${untimed ? 'Start rep' : 'Tap to arm'}</button>
  </section>`, (root) => on(root, { abort: () => abort(R), start: () => (untimed ? untimedRep(R) : standby(R)) }));
}

function startText(d) {
  const map = {
    holster: 'Hands natural, gun holstered.', concealed: 'Gun concealed, garment down, hands natural.',
    'low-ready': 'Gun at low ready, finger off the trigger.', 'compressed-ready': 'Compressed ready: gun close to the chest, muzzle on target line.',
    'high-ready': 'High ready: stock in the shoulder, muzzle just under the target.', table: 'Gun on the table, hands at your sides.',
    pocket: 'Hand off the gun, pocket holster in place.', bag: 'Bag on your support side, zipped as you would carry it.',
    seated: 'Seated, seatbelt/chair as the drill describes, hands on the wheel/table.', sling: 'Rifle slung, hands natural.',
    retention: 'Close-quarters: gun in the holster, support hand up in a fence.', extended: 'Gun extended on target, finger off the trigger.',
  };
  return map[d.start] || 'Take your start position.';
}

async function standby(R) {
  await A.unlock();
  R.state = 'standby';
  R.shots = [];
  const d = item(R).drill;
  const lo = Math.max(0.5, +S.settings.delayMin || 1), hi = Math.max(lo, +S.settings.delayMax || 4);
  const delay = (lo + Math.random() * (hi - lo)) * 1000;
  mount(`<section class="runner standby" data-act="false-start">${header(R)}
    <div class="run-body center"><p class="standby-text">STANDBY</p>
    <p class="muted">Tapping now cancels the string.</p></div></section>`,
    (root) => on(root, { abort: () => abort(R), 'false-start': () => { toast('Cancelled. Re-arm when ready.'); arm(R); } }));

  if (S.settings.mic) {
    try {
      R.detector = new A.ShotDetector({ sensitivity: +S.settings.micSensitivity, onShot: (t) => onMicShot(R, t) });
      R.detector.ignoreUntil = Infinity;
      await R.detector.start();
    } catch (e) {
      toast('Mic unavailable: using tap-to-stop.');
      R.detector = null;
    }
  }
  R.timers.push(setTimeout(() => go(R), delay));
}

function onMicShot(R, t) {
  if (R.state !== 'live') return;
  R.shots.push((t - R.beepAt) / 1000);
  const el = $('#shot-count');
  if (el) el.textContent = `${R.shots.length} shot${R.shots.length === 1 ? '' : 's'} heard`;
  const d = item(R).drill;
  const expect = d.mode === 'decision' ? 1 : d.shots;
  if (R.shots.length >= expect) stop(R, R.shots[R.shots.length - 1]);
}

function makeCall(d) {
  if (d.mode === 'callout') {
    const c = d.callout || {};
    const pool = [...(c.pool || [1, 2, 3, 4, 5, 6, 7, 8, 9])];
    const out = [];
    for (let i = 0; i < (c.count || 1); i++) {
      if (c.unique !== false && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      else out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return { squares: out };
  }
  if (d.mode === 'decision') {
    const dc = d.decision || {};
    const noShoot = Math.random() < (dc.noShootRate ?? 0.3);
    const list = noShoot ? dc.noShoot : dc.shoot;
    const pick = list[Math.floor(Math.random() * list.length)];
    return { noShoot, value: pick, kind: dc.kind || 'color' };
  }
  if (d.mode === 'sequence') return { squares: d.sequence };
  return {};
}

function go(R) {
  const it = item(R);
  const d = it.drill;
  R.call = makeCall(d);
  R.state = 'live';
  const flash = S.settings.flash || S.settings.visualOnly;
  let callHtml = '';
  if (d.mode === 'callout') callHtml = `<div class="callout">${R.call.squares.join(' · ')}</div>`;
  if (d.mode === 'sequence') callHtml = `<div class="callout small">${R.call.squares.join(' → ')}</div>`;
  if (d.mode === 'decision') {
    const c = R.call;
    callHtml = c.kind === 'color'
      ? `<div class="decision-swatch" style="background:${COLORS[c.value] || c.value}"><span>${esc(String(c.value).toUpperCase())}</span></div>`
      : `<div class="callout">${esc(c.value)}</div>`;
  }
  mount(`<section class="runner live ${flash ? 'flash' : ''}" data-act="done">
    <div class="run-body center">
      ${callHtml}
      <div class="clock" id="clock" aria-live="off">0.00</div>
      <p id="shot-count" class="muted">${R.detector ? 'Listening…' : ''}</p>
      <p class="tap-hint">${d.mode === 'decision' ? 'Tap when you have fired <b>or</b> are holding' : 'Tap anywhere when done'}</p>
    </div></section>`, (root) => on(root, { done: () => stop(R, (performance.now() - R.beepAt) / 1000) }));

  R.beepAt = A.beep();
  if (R.detector) R.detector.ignoreUntil = R.beepAt + 350;
  if (d.mode === 'callout' && d.callout?.voice !== false) {
    R.timers.push(setTimeout(() => A.speak(R.call.squares.join(', ')), 250));
  }
  if (d.mode === 'decision' && R.call.kind === 'number') {
    R.timers.push(setTimeout(() => A.speak(String(R.call.value)), 200));
  }
  const par = R.opts.parFor?.(d);
  if (par && S.settings.parBeep && !S.settings.visualOnly) {
    R.timers.push(setTimeout(() => { if (R.state === 'live') A.parBeep(); }, par * 1000));
  }
  const clock = $('#clock');
  const tick = () => {
    if (R.state !== 'live') return;
    const t = (performance.now() - R.beepAt) / 1000;
    if (clock) clock.textContent = Math.max(0, t).toFixed(2);
    if (par && t > par) clock?.classList.add('over');
    R.raf = requestAnimationFrame(tick);
  };
  tick();
}

function stop(R, time) {
  if (R.state !== 'live') return;
  R.state = 'entry';
  cleanup(R);
  A.vibrate(30);
  entry(R, Math.max(0, Math.round(time * 100) / 100));
}

function untimedRep(R) {
  R.call = {};
  entry(R, null);
}

// ---- Result entry -----------------------------------------------------------
function entry(R, time) {
  const it = item(R);
  const d = it.drill;
  const strict = R.opts.strict;
  const gridMode = (d.mode === 'sequence' || d.mode === 'callout') && R.call.squares;
  const decision = d.mode === 'decision';
  const shots = d.shots || 1;
  const st = { time, hits: shots, missed: new Set(), grip: 0, sight: 0, fired: !R.call.noShoot };
  const par = R.opts.parFor?.(d);

  const render = () => {
    const overPar = par && st.time != null && st.time > par;
    let body = '';
    if (decision) {
      body = `<p class="eyebrow">Call was ${esc(String(R.call.value).toUpperCase())}: <b class="${R.call.noShoot ? 'bad' : 'good'}">${R.call.noShoot ? 'NO-SHOOT' : 'SHOOT'}</b></p>
      <div class="seg" role="group" aria-label="Did you fire?">
        <button class="${st.fired ? 'on' : ''}" data-act="fired" data-arg="1">I fired</button>
        <button class="${!st.fired ? 'on' : ''}" data-act="fired" data-arg="0">I held</button></div>
      ${st.fired && !R.call.noShoot ? stepper(st.hits, 1, 'Hit?') : ''}`;
    } else if (gridMode) {
      body = `<p class="eyebrow">Tap any square you <b>missed</b></p>
        ${gridSvg({ called: R.call.squares, missed: st.missed })}
        <p class="muted small">${R.call.squares.length - st.missed.size} of ${R.call.squares.length} hits</p>`;
    } else {
      body = stepper(st.hits, shots, d.mode === 'untimed' ? 'Good reps (clean press, no disturbance)' : 'Hits');
    }
    const timeRow = time == null && d.mode === 'untimed' ? '' : `
      <div class="time-row ${overPar ? 'over' : ''}">
        ${strict ? '' : '<button class="nudge" data-act="nudge" data-arg="-0.05" aria-label="Minus 0.05 seconds">−</button>'}
        <div><small>Time${par ? ` · par ${par.toFixed(2)}` : ''}</small>
          <b>${st.time == null ? '—' : st.time.toFixed(2) + 's'}</b></div>
        ${strict ? '' : '<button class="nudge" data-act="nudge" data-arg="0.05" aria-label="Plus 0.05 seconds">+</button>'}
      </div>
      ${strict ? '' : '<button class="link" data-act="edit-time">Enter time manually</button>'}`;
    const decisionTimeHidden = decision && R.call.noShoot;
    mount(`<section class="runner entry">${header(R)}
      <div class="run-body">
        ${decisionTimeHidden ? '' : timeRow}
        ${body}
        <details class="ratings" ${st.grip || st.sight ? 'open' : ''}><summary>Self-rating (optional)</summary>
          ${rating('Grip', 'grip', st.grip)}${rating('Sight picture', 'sight', st.sight)}
        </details>
      </div>
      <div class="entry-actions">
        ${strict ? '' : '<button class="btn ghost" data-act="redo">Redo string</button>'}
        <button class="btn primary big" data-act="save">${R.rep + 1 >= repsFor(R) ? 'Save & finish' : 'Save & next'}</button>
      </div></section>`, (root) => {
      on(root, {
        abort: () => abort(R),
        inc: () => { st.hits = Math.min(st.hits + 1, decision ? 1 : shots); render(); },
        dec: () => { st.hits = Math.max(0, st.hits - 1); render(); },
        fired: (v) => { st.fired = v === '1'; render(); },
        nudge: (v) => { st.time = Math.max(0, Math.round(((st.time || 0) + +v) * 100) / 100); render(); },
        'edit-time': () => {
          const v = prompt('Time in seconds', st.time ?? '');
          if (v != null && !isNaN(parseFloat(v))) { st.time = Math.round(parseFloat(v) * 100) / 100; render(); }
        },
        rate: (arg) => { const [k, v] = arg.split(':'); st[k] = st[k] === +v ? 0 : +v; render(); },
        redo: () => arm(R),
        save: () => saveString(R, st, time),
      });
      root.querySelectorAll('.grid9 [data-sq]').forEach(b => b.addEventListener('click', () => {
        const n = +b.dataset.sq;
        if (!R.call.squares.includes(n)) return;
        st.missed.has(n) ? st.missed.delete(n) : st.missed.add(n);
        render();
      }));
    });
  };
  render();
}

function stepper(val, max, label) {
  return `<div class="stepper"><small>${esc(label)}</small>
    <div class="row"><button class="step" data-act="dec" aria-label="Fewer">−</button>
    <b class="step-val">${val}<span>/${max}</span></b>
    <button class="step" data-act="inc" aria-label="More">+</button></div></div>`;
}

function rating(label, key, val) {
  return `<div class="rating"><small>${label}</small><div class="row">${[1, 2, 3, 4, 5].map(n =>
    `<button class="${val === n ? 'on' : ''}" data-act="rate" data-arg="${key}:${n}" aria-label="${label} ${n}">${n}</button>`).join('')}</div></div>`;
}

function saveString(R, st) {
  const d = item(R).drill;
  const s = { time: st.time, grip: st.grip || null, sight: st.sight || null };
  if (d.mode === 'decision') {
    s.call = R.call.value; s.noShootCall = R.call.noShoot;
    if (R.call.noShoot) {
      s.time = null;
      if (st.fired) { s.hits = 0; s.misses = 0; s.noShoot = 1; } else { s.hits = 0; s.misses = 0; s.correctHold = true; }
    } else if (!st.fired) { s.hits = 0; s.misses = 1; }
    else { s.hits = st.hits ? 1 : 0; s.misses = st.hits ? 0 : 1; }
  } else if (R.call.squares) {
    s.called = R.call.squares; s.missed = [...st.missed];
    s.misses = R.call.squares.filter(n => st.missed.has(n)).length;
    s.hits = R.call.squares.length - s.misses;
  } else {
    s.hits = st.hits; s.misses = (d.shots || 1) - st.hits;
  }
  R.strings.push(s);
  R.rep++;
  R.state = 'idle';

  if (R.opts.strict) {
    const par = R.opts.parFor?.(d);
    const fail = s.misses > 0 || s.noShoot > 0 || (par && (s.time == null || s.time > par));
    if (fail) {
      R.results.push({ drill: d, item: item(R), strings: R.strings, failed: true });
      exit(R);
      A.failTone();
      return R.opts.onDone(R.results, R);
    }
  }
  if (R.rep < repsFor(R)) return arm(R);
  R.results.push({ drill: d, item: item(R), strings: R.strings });
  R.itemIndex++;
  if (R.itemIndex < R.opts.items.length) { A.doubleBeep(); return startItem(R); }
  exit(R);
  R.opts.onDone(R.results, R);
}

export { fmtTime };
