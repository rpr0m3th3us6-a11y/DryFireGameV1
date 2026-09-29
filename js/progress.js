// Progression rules: unlocks, XP, streaks, badges, adaptive offers.
import { kv, attempts as attemptsDb } from './db.js';
import { C, levelDrills, bossComponents, unitsForTrack, trackEnabled } from './content.js';
import { TIER_RANK, tierAtLeast, betterTier } from './scoring.js';
import { dayKey, daysBetween, weekStart } from './ui.js';

export const S = { progress: null, profile: null, settings: null };

export const DEFAULT_SETTINGS = {
  volume: 0.9, beepStyle: 'timer', haptics: true, voice: true, units: 'yd',
  largeText: false, unlockAll: false, delayMin: 1, delayMax: 4, parBeep: true,
  visualOnly: false, flash: true, mic: false, micSensitivity: 5, weeklyGoal: 4,
  autoAdvance: false,
};

export function defaultProgress() {
  return {
    xp: 0, drills: {}, levels: {}, bosses: {}, badges: {}, testedOut: {},
    streak: { current: 0, best: 0, lastDay: null, freezes: 0, freezeUsed: [] },
    manCard: { runs: 0, earned: {} },
    calibration: null,
  };
}

export async function loadState() {
  S.progress = { ...defaultProgress(), ...(await kv.get('progress') || {}) };
  S.profile = await kv.get('profile') || null;
  S.settings = { ...DEFAULT_SETTINGS, ...(await kv.get('settings') || {}) };
  return S;
}
export const saveProgress = () => kv.set('progress', S.progress);
export const saveProfile = () => kv.set('profile', S.profile);
export const saveSettings = () => kv.set('settings', S.settings);

// ---- Ranks ----------------------------------------------------------------
export const RANKS = [
  [0, 'Recruit'], [250, 'Novice'], [700, 'Apprentice'], [1500, 'Marksman'],
  [3000, 'Sharpshooter'], [5500, 'Expert'], [9000, 'Master'], [14000, 'Distinguished'],
];
export function rankFor(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
  const [floor, name] = RANKS[i];
  const next = RANKS[i + 1]?.[0] ?? null;
  return { name, index: i + 1, floor, next, pct: next ? (xp - floor) / (next - floor) : 1 };
}

// ---- Unlock logic -----------------------------------------------------------
const unlockAll = () => !!S.settings?.unlockAll;

export function unitComplete(unit) {
  if (!unit) return false;
  if (S.progress.testedOut[unit.id]) return true;
  if (!unit.boss) return unit.levels.every(l => levelComplete(l));
  if (unit.boss.type === 'mancard') return !!S.progress.manCard.earned['mancard-short'];
  return tierAtLeast(S.progress.bosses[unit.boss.id]?.tier, 'bronze');
}

export function unitRequires(unit) {
  if (unit.requires) return unit.requires;
  const list = unitsForTrack(unit.track);
  const i = list.indexOf(unit);
  return i > 0 ? [list[i - 1].id] : [];
}

export function unitUnlocked(unit) {
  if (unlockAll() || S.progress.testedOut[unit.id]) return true;
  return unitRequires(unit).every(id => {
    const u = C.unitById.get(id);
    // A requirement on a disabled track (e.g. CCW requires pistol presentation) still applies.
    return !u || unitComplete(u);
  });
}

export function levelComplete(level) {
  const rec = S.progress.levels[level.id];
  if (rec?.complete) return true;
  const ds = levelDrills(level, S.profile);
  return ds.length > 0 && ds.every(d => S.progress.drills[d.id]?.passed);
}

export function levelUnlocked(unit, index) {
  if (!unitUnlocked(unit)) return false;
  if (unlockAll() || index === 0 || S.progress.testedOut[unit.id]) return true;
  return levelComplete(unit.levels[index - 1]);
}

export function bossUnlocked(unit) {
  if (!unitUnlocked(unit)) return false;
  if (unlockAll() || S.progress.testedOut[unit.id]) return true;
  return unit.levels.every(l => levelComplete(l));
}

export function drillUnlocked(drillId) {
  if (unlockAll()) return true;
  for (const u of C.units) {
    const i = u.levels.findIndex(l => l.drills.includes(drillId));
    if (i >= 0 && levelUnlocked(u, i)) return true;
  }
  return false;
}

export function unitProgress(unit) {
  let done = 0, total = 0;
  for (const l of unit.levels) for (const d of levelDrills(l, S.profile)) {
    total++; if (S.progress.drills[d.id]?.passed) done++;
  }
  return { done, total, pct: total ? done / total : 0 };
}

// Next thing to train: first unlocked, unpassed drill across enabled tracks.
export function nextUp() {
  for (const t of ['pistol', 'ccw', 'rifle']) {
    if (!trackEnabled(t, S.profile)) continue;
    for (const u of unitsForTrack(t)) {
      if (!unitUnlocked(u)) continue;
      for (let i = 0; i < u.levels.length; i++) {
        if (!levelUnlocked(u, i)) break;
        for (const d of levelDrills(u.levels[i], S.profile)) {
          if (!S.progress.drills[d.id]?.passed) return { type: 'drill', drill: d, unit: u, level: u.levels[i] };
        }
      }
      if (u.boss && u.boss.type !== 'mancard' && bossUnlocked(u) && !unitComplete(u)) return { type: 'boss', unit: u };
      if (u.boss?.type === 'mancard' && manCardUnlocked().ok && !unitComplete(u)) return { type: 'mancard', unit: u };
    }
  }
  return null;
}

export function manCardUnlocked() {
  const mc = C.manCard;
  if (!mc) return { ok: false, missing: [] };
  const units = [...(mc.unlock?.units || [])];
  for (const [track, list] of Object.entries(mc.unlock?.ifTrack || {})) {
    if (trackEnabled(track, S.profile)) units.push(...list);
  }
  const need = mc.unlock?.bossTier || 'silver';
  const missing = [];
  for (const id of units) {
    const u = C.unitById.get(id);
    if (!u?.boss) continue;
    const t = S.progress.bosses[u.boss.id]?.tier;
    if (!tierAtLeast(t, need)) missing.push({ unit: u, tier: t || 'none' });
  }
  return { ok: unlockAll() || missing.length === 0, missing, need };
}

// ---- Recording results -----------------------------------------------------
const TIER_XP = { none: 0, bronze: 10, silver: 20, gold: 35 };

export async function recordDrill({ drill, summary, strings, sessionId, kind = 'drill' }) {
  const p = S.progress;
  const rec = p.drills[drill.id] ||= { attempts: 0, passed: false, bestTier: 'none', failStreak: 0, pb: {} };
  const firstAttempt = rec.attempts === 0;
  rec.attempts++;
  const firstPass = summary.passed && !rec.passed;
  let newPB = false;
  if (summary.passed) {
    rec.passed = true;
    rec.failStreak = 0;
    if (summary.avgTime != null && (rec.pb.avgTime == null || summary.avgTime < rec.pb.avgTime)) { newPB = rec.pb.avgTime != null; rec.pb.avgTime = summary.avgTime; }
    if (summary.hitFactor != null && (rec.pb.hitFactor == null || summary.hitFactor > rec.pb.hitFactor)) { newPB ||= rec.pb.hitFactor != null; rec.pb.hitFactor = summary.hitFactor; }
  } else {
    rec.failStreak++;
  }
  if (rec.pb.accuracy == null || summary.accuracy > rec.pb.accuracy) rec.pb.accuracy = summary.accuracy;
  const prevTier = rec.bestTier;
  rec.bestTier = betterTier(rec.bestTier, summary.tier);
  rec.lastDate = new Date().toISOString();

  let xp = 5 + (summary.passed ? 5 + TIER_XP[summary.tier] : 0);
  if (firstPass) xp += 25;
  if (newPB) xp += 10;
  p.xp += xp;

  const before = snapshotLocks();
  await attemptsDb.add({ drillId: drill.id, kind, date: new Date().toISOString(), sessionId, strings, summary, xp });
  const streakEvt = touchStreak();
  const newBadges = checkBadges({ drill, summary });
  await saveProgress();

  // Adaptive offers
  const offers = {};
  const loc = locateDrill(drill.id);
  if (firstAttempt && summary.tier === 'gold' && loc && !levelComplete(loc.level)) {
    offers.skipLevel = loc.level;
  }
  if (!summary.passed && rec.failStreak >= 3) {
    offers.remedial = C.drills.get(drill.remedial) || previousDrill(drill.id);
  }
  return { xp, firstPass, newPB, tierUp: TIER_RANK[rec.bestTier] > TIER_RANK[prevTier], newBadges, streakEvt, offers, unlocked: diffLocks(before) };
}

export async function recordBoss({ unit, results, tier, passed, sessionId }) {
  const p = S.progress;
  const prev = p.bosses[unit.boss.id];
  const firstPass = passed && !tierAtLeast(prev?.tier, 'bronze');
  const before = snapshotLocks();
  if (!prev || TIER_RANK[tier] > TIER_RANK[prev.tier || 'none']) p.bosses[unit.boss.id] = { tier, date: new Date().toISOString() };
  let xp = 2 * (5 + (passed ? 5 + TIER_XP[tier] : 0)) + (firstPass ? 50 : 0);
  p.xp += xp;
  await attemptsDb.add({ drillId: unit.boss.id, kind: 'boss', date: new Date().toISOString(), sessionId, results, summary: { tier, passed }, xp });
  touchStreak();
  const newBadges = [];
  if (passed) newBadges.push(...award(`unit:${unit.id}`));
  if (tier === 'gold') newBadges.push(...award(`boss-gold:${unit.id}`));
  newBadges.push(...checkBadges({}));
  await saveProgress();
  return { xp, firstPass, newBadges, unlocked: diffLocks(before) };
}

export function locateDrill(id) {
  for (const u of C.units) for (let i = 0; i < u.levels.length; i++) {
    if (u.levels[i].drills.includes(id)) return { unit: u, level: u.levels[i], index: i };
  }
  return null;
}
function previousDrill(id) {
  const loc = locateDrill(id);
  if (!loc) return null;
  const flat = loc.unit.levels.flatMap(l => levelDrills(l, S.profile));
  const i = flat.findIndex(d => d.id === id);
  return i > 0 ? flat[i - 1] : null;
}

export async function skipLevel(level) {
  S.progress.levels[level.id] = { complete: true, skipped: true, date: new Date().toISOString() };
  await saveProgress();
}

function snapshotLocks() {
  const s = new Set();
  for (const u of C.units) {
    if (unitUnlocked(u)) s.add('u:' + u.id);
    u.levels.forEach((l, i) => { if (levelUnlocked(u, i)) s.add('l:' + l.id); });
    if (u.boss && bossUnlocked(u)) s.add('b:' + u.id);
  }
  if (manCardUnlocked().ok) s.add('mancard');
  return s;
}
function diffLocks(before) {
  const after = snapshotLocks();
  const out = [];
  for (const k of after) if (!before.has(k)) {
    const [t, id] = k.split(':');
    if (t === 'u') out.push(`Unit unlocked: ${C.unitById.get(id).title}`);
    else if (t === 'l') out.push(`Level unlocked: ${C.levelById.get(id)?.level.title}`);
    else if (t === 'b') out.push(`Benchmark unlocked: ${C.unitById.get(id).boss.title}`);
    else if (k === 'mancard') out.push('Man Card unlocked');
  }
  return out;
}

// ---- Streaks & weekly goal ---------------------------------------------------
export function touchStreak(today = dayKey()) {
  const s = S.progress.streak;
  if (s.lastDay === today) return null;
  let evt = null;
  if (!s.lastDay) s.current = 1;
  else {
    const gap = daysBetween(s.lastDay, today);
    if (gap === 1) s.current++;
    else if (gap > 1 && gap - 1 <= s.freezes) {
      s.freezes -= gap - 1; s.current++; evt = 'freeze-used';
      s.freezeUsed.push(today);
    } else s.current = 1;
  }
  s.lastDay = today;
  s.best = Math.max(s.best, s.current);
  if (s.current > 0 && s.current % 7 === 0 && s.freezes < 2) { s.freezes++; evt = evt || 'freeze-earned'; }
  return evt;
}

// Streak as displayed: 0 if the chain is already broken beyond available freezes.
export function liveStreak(today = dayKey()) {
  const s = S.progress.streak;
  if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, today);
  return gap <= 1 + s.freezes ? s.current : 0;
}

export async function weeklyProgress() {
  const all = await attemptsDb.all();
  const ws = weekStart();
  const days = new Set(all.filter(a => dayKey(a.date) >= ws).map(a => dayKey(a.date)));
  return { days: days.size, goal: S.settings.weeklyGoal };
}

// ---- Badges -----------------------------------------------------------------
export const BADGES = {
  'first-drill': { name: 'First String', desc: 'Completed your first drill.' },
  'first-gold': { name: 'Gold Standard', desc: 'Earned a Gold tier.' },
  'gold-10': { name: 'Gold x10', desc: 'Gold tier on 10 different drills.' },
  'gold-25': { name: 'Gold x25', desc: 'Gold tier on 25 different drills.' },
  'streak-3': { name: '3-Day Streak', desc: 'Trained 3 days in a row.' },
  'streak-7': { name: 'Week Straight', desc: 'Trained 7 days in a row.' },
  'streak-30': { name: 'Month of Reps', desc: '30-day training streak.' },
  'streak-100': { name: 'Century', desc: '100-day training streak.' },
  'reps-100': { name: '100 Sessions', desc: 'Logged 100 drill attempts.' },
  'calibrated': { name: 'Baseline Set', desc: 'Completed the calibration baseline.' },
  'mancard-short': { name: 'Man Card', desc: 'Passed the Man Card short card.' },
  'mancard-short-carry': { name: 'Man Card (Carry)', desc: 'Passed the short card, carry variant.' },
  'mancard-long': { name: 'Man Card: Long', desc: 'Passed the Man Card long card.' },
  'mancard-long-carry': { name: 'Man Card: Long (Carry)', desc: 'Passed the long card, carry variant.' },
};
export function badgeInfo(id) {
  if (BADGES[id]) return BADGES[id];
  if (id.startsWith('mancard-')) {
    const long = id.includes('long'), carry = id.includes('carry'), pistol = id.includes('pistol');
    return { name: `Man Card${long ? ': Long' : ''}${carry ? ' (Carry)' : ''}${pistol ? ' (Pistol-only)' : ''}`, desc: `Passed the ${long ? 'long' : 'short'} card${carry ? ', carry variant' : ''}${pistol ? ', pistol iterations only' : ''}.` };
  }
  const [kind, uid] = id.split(':');
  const u = C.unitById.get(uid);
  if (kind === 'unit') return { name: u?.title || uid, desc: `Passed the ${u?.boss?.title || 'unit benchmark'}.` };
  if (kind === 'boss-gold') return { name: `${u?.title || uid}: Gold`, desc: 'Gold tier on the unit benchmark.' };
  return { name: id, desc: '' };
}

export function award(id, date = new Date().toISOString()) {
  if (S.progress.badges[id]) return [];
  S.progress.badges[id] = date;
  return [id];
}

function checkBadges({ summary }) {
  const p = S.progress, out = [];
  const total = Object.values(p.drills).reduce((n, r) => n + r.attempts, 0);
  if (total >= 1) out.push(...award('first-drill'));
  if (total >= 100) out.push(...award('reps-100'));
  const golds = Object.values(p.drills).filter(r => r.bestTier === 'gold').length;
  if (summary?.tier === 'gold' || golds) out.push(...award('first-gold'));
  if (golds >= 10) out.push(...award('gold-10'));
  if (golds >= 25) out.push(...award('gold-25'));
  for (const n of [3, 7, 30, 100]) if (p.streak.current >= n) out.push(...award('streak-' + n));
  return out;
}

export async function addXP(n) { S.progress.xp += n; await saveProgress(); }
