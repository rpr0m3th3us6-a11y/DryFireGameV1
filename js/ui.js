// DOM helpers, icons, toasts, modals, wake lock.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function mount(htmlStr, onMount) {
  const root = $('#app');
  root._handlers = null;
  root.innerHTML = htmlStr;
  root.scrollTop = 0;
  window.scrollTo(0, 0);
  onMount?.(root);
  const h = $('h1', root);
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

// Delegated click handling: <button data-act="name" data-arg="x">
// One listener per root; each mount replaces the active handler table so
// handlers from previous views never fire.
export function on(root, handlers) {
  root._handlers = handlers;
  if (root._delegated) return;
  root._delegated = true;
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    const fn = root._handlers?.[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset.arg, el, e); }
  });
}

const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path d="${d}"/></svg>`;
export const icon = {
  target: `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/></svg>`,
  tree: P('M12 2a3 3 0 0 1 1 5.83V11h4a2 2 0 0 1 2 2v3.17a3 3 0 1 1-2 0V13h-4v3.17a3 3 0 1 1-2 0V13H7v3.17a3 3 0 1 1-2 0V13a2 2 0 0 1 2-2h4V7.83A3 3 0 0 1 12 2z'),
  chart: P('M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z'),
  medal: P('M8 2h8l-2 6h-4L8 2zm4 7a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 3-1.2 2.4-2.6.4 1.9 1.8-.5 2.6L12 18l2.4 1.2-.5-2.6 1.9-1.8-2.6-.4L12 12z'),
  gear: P('M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.4 4.9.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L15.2 2h-4l-.4 2.6a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6L6 12l.1 1.4-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6z'),
  lock: P('M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z'),
  check: P('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'),
  flame: P('M13.5 1s.7 3-1.3 5.6C10.4 9 8 10.4 8 14a4 4 0 0 0 8 0c0-1.4-.6-2.6-1.3-3.4.2 1.3-.4 2.4-1.4 2.4-1.8 0-1.3-2.6-.8-4C13.6 6.9 16 8 17.2 10.2 18.3 12.3 18 15 18 15a6 6 0 0 1-12 0c0-5 4-7 5.5-9.5C12.8 3.4 13.5 1 13.5 1z'),
  snow: P('M11 2h2v4.1l2.8-2.8 1.4 1.4L13 8.9V11h2.1l4.2-4.2 1.4 1.4L17.9 11H22v2h-4.1l2.8 2.8-1.4 1.4-4.2-4.2H13v2.1l4.2 4.2-1.4 1.4-2.8-2.8V22h-2v-4.1l-2.8 2.8-1.4-1.4 4.2-4.2V13H8.9l-4.2 4.2-1.4-1.4L6.1 13H2v-2h4.1L3.3 8.2l1.4-1.4L8.9 11H11V8.9L6.8 4.7l1.4-1.4L11 6.1z'),
  play: P('M8 5v14l11-7z'),
  back: P('M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z'),
  shield: P('M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm-1.2 14.2L7 12.4l1.4-1.4 2.4 2.4 4.8-4.8L17 10l-6.2 6.2z'),
  skull: P('M12 2a9 9 0 0 0-9 9c0 3 1.5 5.6 4 7.2V21h3v-2h1v2h2v-2h1v2h3v-2.8c2.5-1.6 4-4.2 4-7.2a9 9 0 0 0-9-9zm-3.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'),
  card: P('M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 3v2h16V8H4zm0 6v2h7v-2H4z'),
};

export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

export function modal(htmlStr, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${htmlStr}</div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (b) return close(b.dataset.val);
      if (e.target === wrap && dismissable) close(null);
    });
    wrap.querySelector('button')?.focus();
  });
}

export function confirmBox(title, body, yes = 'OK', no = 'Cancel', danger = false) {
  return modal(`<h2>${esc(title)}</h2><p>${body}</p>
    <div class="row gap"><button class="btn ghost" data-val="no">${esc(no)}</button>
    <button class="btn ${danger ? 'danger' : 'primary'}" data-val="yes">${esc(yes)}</button></div>`)
    .then(v => v === 'yes');
}

// ---- Screen wake lock -------------------------------------------------------
let lock = null;
let wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantLock) keepAwake(true);
});

// ---- Dates ----------------------------------------------------------------
export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  const pa = new Date(a + 'T00:00:00'), pb = new Date(b + 'T00:00:00');
  return Math.round((pb - pa) / 86400000);
}
export function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday start
  x.setDate(x.getDate() - dow);
  return dayKey(x);
}
export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = async () => resolve(i.files[0] ? await i.files[0].text() : null);
    i.click();
  });
}
