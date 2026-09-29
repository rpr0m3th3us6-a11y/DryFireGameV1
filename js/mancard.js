// Man Card capstone: cold start, one attempt per iteration, no redo,
// any miss or over-par fails the card. Short, Long and Carry variants.
import { C, trackEnabled, START_LABEL } from './content.js';
import { S, manCardUnlocked, award, saveProgress, badgeInfo } from './progress.js';
import { attempts } from './db.js';
import { coldStartStatus, currentSession, touchSession, endSession } from './session.js';
import { runSeries } from './runner.js';
import { mount, on, esc, icon, fmtDate, confirmBox } from './ui.js';
import { failTone, doubleBeep } from './audio.js';

export function cardKey(cardId, { carry, pistolOnly }) {
  return cardId + (carry ? '-carry' : '') + (pistolOnly ? '-pistol' : '');
}

function earned(cardId) {
  return Object.entries(S.progress.manCard.earned).filter(([k]) => k.startsWith(cardId));
}

export function buildIterations(card, { carry, includeOptional }) {
  const mc = C.manCard;
  const rifle = trackEnabled('rifle', S.profile);
  return card.iterations
    .filter(it => rifle || it.weapon !== 'rifle')
    .filter(it => includeOptional || !it.optional)
    .map(it => {
      const concealed = carry && it.carryEligible;
      const par = Math.round((it.par + (concealed ? mc.carryVariant.parAdd : 0)) * 100) / 100;
      return {
        label: it.title + (concealed ? ' (concealed)' : ''),
        instructions: concealed ? `${mc.carryVariant.startText} On the beep, draw, one hit.` : it.instructions,
        startLabel: concealed ? mc.carryVariant.startText : START_LABEL[it.start] || it.start,
        reps: 1,
        par,
        drill: {
          id: `${card.id}:${it.id}`, title: it.title, mode: 'standard', target: 'any', start: concealed ? 'concealed' : it.start,
          shots: it.shots || 1, reps: 1, par: { bronze: par, silver: par, gold: par }, pass: { accuracy: 100 },
          objective: it.instructions || '', cue: 'One shot. Make it count.',
        },
      };
    });
}

export function renderManCard(nav) {
  const mc = C.manCard;
  const lock = manCardUnlocked();
  const shortDone = earned(mc.short.id).length > 0;
  const rifle = trackEnabled('rifle', S.profile);
  const opts = { carry: false, includeOptional: rifle };

  const cardBlock = (card, locked, lockMsg) => {
    const its = card.iterations.filter(it => rifle || it.weapon !== 'rifle');
    const got = earned(card.id);
    return `<article class="card mc-card ${locked ? 'locked' : ''}">
      <header class="row between"><h2>${esc(card.title)}</h2>${locked ? icon.lock : got.length ? `<span class="tier gold">EARNED</span>` : ''}</header>
      <p class="muted">${esc(card.summary)}</p>
      <ol class="iters">${its.map(it => `<li><span>${esc(it.title)}${it.optional ? ' <em>(optional)</em>' : ''}${it.carryEligible ? ' <em class="carry-tag">carry +' + mc.carryVariant.parAdd + 's</em>' : ''}</span><b>${it.par.toFixed(1)}s</b></li>`).join('')}</ol>
      ${got.length ? `<ul class="earned">${got.map(([k, d]) => `<li>${icon.medal}<span>${esc(badgeInfo(k).name)}</span><small>${fmtDate(d)}</small></li>`).join('')}</ul>` : ''}
      ${locked ? `<p class="lock-msg">${lockMsg}</p>` : `<button class="btn primary big" data-act="start" data-arg="${card.id}">Start ${esc(card.title)}</button>`}
    </article>`;
  };

  const missing = lock.missing.map(m => `<li>${esc(m.unit.boss.title)} <span class="tier ${m.tier}">${m.tier === 'none' ? 'not passed' : m.tier}</span></li>`).join('');

  mount(`<section class="page">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>${icon.card} Man Card</h1></header>
    <p class="lead">${esc(mc.attribution)}</p>
    <div class="note">${icon.target}<p>${esc(mc.laserNote)}</p></div>
    <h3>Rules the app enforces</h3>
    <ul class="rules">${mc.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    ${!rifle ? `<p class="note warn-note">Rifle track is off, so rifle iterations are skipped and the card is recorded as <b>pistol-only</b>. Enable the rifle track in Settings to shoot the full card.</p>` : ''}
    <div class="card toggles">
      <label class="switch"><input type="checkbox" id="mc-carry"><span>${esc(mc.carryVariant.label)}</span></label>
      <p class="muted small">${esc(mc.carryVariant.summary)}</p>
      ${rifle ? `<label class="switch"><input type="checkbox" id="mc-opt" checked><span>Include optional rifle-to-pistol transition</span></label>` : ''}
    </div>
    ${!lock.ok ? `<div class="card locked"><h3>${icon.lock} Locked</h3><p>Every prior unit benchmark must be <b>${lock.need}</b> or better:</p><ul class="rules">${missing}</ul></div>` : ''}
    ${cardBlock(mc.short, !lock.ok, 'Earn Silver on every prior benchmark first.')}
    ${cardBlock(mc.long, !lock.ok || !shortDone, 'Pass the Short Card to unlock.')}
  </section>`, (root) => on(root, {
    back: () => nav('#/tree'),
    start: (id) => {
      opts.carry = root.querySelector('#mc-carry').checked;
      opts.includeOptional = rifle && (root.querySelector('#mc-opt')?.checked ?? true);
      coldStartScreen(nav, id === mc.long.id ? mc.long : mc.short, opts);
    },
  }));
}

async function coldStartScreen(nav, card, opts) {
  const mc = C.manCard;
  const cold = await coldStartStatus(mc.coldStartMinutes);
  const session = await currentSession();
  const its = buildIterations(card, opts);
  mount(`<section class="page cold">
    <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon.back}</button><h1>Cold start</h1></header>
    <p class="eyebrow">${esc(card.title)}${opts.carry ? ' · Carry variant' : ''}</p>
    ${cold.ok ? `
      <p class="lead">This is your one attempt. Confirm each item.</p>
      <form id="cold" class="checklist">
        <label><input type="checkbox" required> I have not dry-fired, warmed up or run any drill today before this.</label>
        <label><input type="checkbox" required> I understand there are no redos. One attempt per iteration.</label>
        <label><input type="checkbox" required> Any miss or any over-par time fails the whole card.</label>
        <label><input type="checkbox" required> Equipment is staged: ${opts.carry ? 'cover garment on, ' : ''}holster${its.some(i => i.label.startsWith('Rifle')) ? ', rifle and sling' : ''}${card === mc.long ? ', training mags / dummy rounds' : ''}.</label>
        <label><input type="checkbox" required> Firearms verified unloaded. No live ammunition in the room.</label>
      </form>
      <ol class="iters">${its.map(i => `<li><span>${esc(i.label)}</span><b>${i.par.toFixed(2)}s</b></li>`).join('')}</ol>
      <button class="btn primary big" data-act="go" ${!session ? 'disabled' : ''}>Begin: one attempt</button>
      ${!session ? '<p class="warn">Complete the session safety checklist first.</p>' : ''}
    ` : `
      <div class="card locked"><h3>${icon.lock} Not cold</h3><p>${esc(cold.reason)}</p>
      ${cold.waitMin ? `<p class="muted">Come back in about ${cold.waitMin} min${cold.canEndSession ? ', after ending this session' : ''}.</p>` : ''}</div>
      ${cold.canEndSession ? '<button class="btn ghost" data-act="end">End this session</button>' : ''}
    `}
  </section>`, (root) => on(root, {
    back: () => renderManCard(nav),
    end: async () => { await endSession(); nav('#/home'); },
    go: async () => {
      const form = root.querySelector('#cold');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!session) return nav('#/safety?next=' + encodeURIComponent('#/mancard'));
      runCard(nav, card, opts, its);
    },
  }));
}

function runCard(nav, card, opts, its) {
  const pistolOnly = !trackEnabled('rifle', S.profile);
  const key = cardKey(card.id, { carry: opts.carry, pistolOnly });
  const finish = async (results, aborted) => {
    const passed = !aborted && results.length === its.length && results.every(r => !r.failed);
    S.progress.manCard.runs++;
    const date = new Date().toISOString();
    let newBadge = false;
    if (passed) {
      if (!S.progress.manCard.earned[key]) { S.progress.manCard.earned[key] = date; newBadge = true; }
      award(key, date);
      S.progress.xp += C.manCard.xp || 500;
    }
    const session = await currentSession();
    await attempts.add({
      drillId: card.id, kind: 'mancard', variant: key, date, sessionId: session?.id,
      results: results.map(r => ({ id: r.drill.id, title: r.item.label, par: r.item.par, strings: r.strings, failed: !!r.failed })),
      summary: { passed, tier: passed ? 'gold' : 'none' }, xp: passed ? C.manCard.xp : 0,
    });
    await touchSession(true);
    await saveProgress();
    passed ? doubleBeep() : failTone();
    resultScreen(nav, card, its, results, passed, key, newBadge, aborted);
  };
  runSeries({
    title: card.title, strict: true, showItemIntro: true,
    items: its, parFor: (d) => its.find(i => i.drill.id === d.id)?.par,
    onDone: (results) => finish(results, false),
    onAbort: (results) => finish(results, true),
  });
}

function resultScreen(nav, card, its, results, passed, key, newBadge, aborted) {
  const rows = its.map((it, i) => {
    const r = results[i];
    if (!r) return `<tr class="skip"><td>${esc(it.label)}</td><td>${it.par.toFixed(2)}</td><td>—</td><td>not shot</td></tr>`;
    const s = r.strings[0] || {};
    const ok = !r.failed;
    return `<tr class="${ok ? 'ok' : 'bad'}"><td>${esc(it.label)}</td><td>${it.par.toFixed(2)}</td>
      <td>${s.time != null ? s.time.toFixed(2) : '—'}</td><td>${ok ? 'PASS' : s.misses ? 'MISS' : 'OVER PAR'}</td></tr>`;
  }).join('');
  mount(`<section class="page result ${passed ? 'pass' : 'fail'}">
    <h1 class="verdict">${passed ? 'CARD EARNED' : 'NO CARD'}</h1>
    <p class="lead">${passed ? `${esc(badgeInfo(key).name)}: ${newBadge ? 'badge awarded and dated permanently.' : 'passed again.'}`
      : aborted ? 'Attempt ended early: recorded as a fail.' : 'One miss or one slow iteration is all it takes. Train the weak iteration and come back cold.'}</p>
    <table class="tbl"><thead><tr><th>Iteration</th><th>Par</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row gap wrap">
      <button class="btn primary" data-act="card">Man Card</button>
      <button class="btn ghost" data-act="home">Home</button>
    </div>
  </section>`, (root) => on(root, { card: () => renderManCard(nav), home: () => nav('#/home') }));
}
