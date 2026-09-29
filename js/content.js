// Content loader: data/drills.json + optional user-imported custom pack.
import { kv } from './db.js';

export const C = {
  raw: null,
  tracks: [],
  units: [],
  drills: new Map(),
  unitById: new Map(),
  levelById: new Map(),   // levelId -> { level, unit, index }
  bossById: new Map(),    // bossId -> { boss, unit }
  manCard: null,
  analysis: { pairs: [] },
};

export async function loadContent() {
  const res = await fetch('./data/drills.json', { cache: 'no-cache' }).catch(() => null)
    || await caches.match('./data/drills.json');
  const base = await res.json();
  const custom = await kv.get('customPack');
  build(base, custom);
  return C;
}

export function build(base, custom) {
  const data = structuredClone(base);
  if (custom) mergePack(data, custom);
  C.raw = data;
  C.tracks = data.tracks;
  C.units = [...data.units].sort((a, b) => (a.track === b.track ? a.order - b.order : 0));
  C.drills = new Map(data.drills.map(d => [d.id, normalizeDrill(d)]));
  C.unitById = new Map(C.units.map(u => [u.id, u]));
  C.levelById.clear(); C.bossById.clear();
  for (const u of C.units) {
    u.levels.forEach((l, i) => C.levelById.set(l.id, { level: l, unit: u, index: i }));
    if (u.boss) C.bossById.set(u.boss.id, { boss: u.boss, unit: u });
  }
  C.manCard = data.manCard;
  C.analysis = data.analysis || { pairs: [] };
}

// Custom pack format: { drills: [...], units: [...], levels: [{ unit, level }] }
// Drills with an existing id replace the built-in one; new units are appended.
export function mergePack(data, pack) {
  for (const d of pack.drills || []) {
    const i = data.drills.findIndex(x => x.id === d.id);
    if (i >= 0) data.drills[i] = { ...data.drills[i], ...d }; else data.drills.push({ custom: true, ...d });
  }
  for (const u of pack.units || []) {
    const i = data.units.findIndex(x => x.id === u.id);
    if (i >= 0) data.units[i] = { ...data.units[i], ...u }; else data.units.push({ custom: true, ...u });
  }
  for (const { unit, level } of pack.levels || []) {
    const u = data.units.find(x => x.id === unit);
    if (u && level) u.levels.push(level);
  }
}

export function validatePack(pack) {
  const errs = [];
  if (!pack || typeof pack !== 'object') return ['Not a JSON object'];
  for (const d of pack.drills || []) {
    if (!d.id || !d.title) errs.push(`Drill missing id/title: ${JSON.stringify(d).slice(0, 60)}`);
    if (d.par && !(d.par.bronze >= d.par.silver && d.par.silver >= d.par.gold)) errs.push(`${d.id}: par must be bronze ≥ silver ≥ gold`);
  }
  return errs;
}

function normalizeDrill(d) {
  return {
    mode: 'standard', shots: 1, reps: 5, target: 'any', equipment: [], tags: [], steps: [], errors: [],
    scoring: d.par ? 'time' : 'accuracy', pass: { accuracy: 80 },
    ...d,
    shots: d.mode === 'sequence' ? (d.sequence?.length || d.shots || 1)
      : d.mode === 'callout' ? (d.callout?.count || d.shots || 1) : (d.shots || 1),
  };
}

// ---- Profile filtering -----------------------------------------------------
export function drillAvailable(d, profile) {
  if (!d) return false;
  const t = profile?.target || 'circle';
  if (d.target === 'any') return true;
  if (t === 'both') return true;
  if (d.target === 'both') return false;
  return d.target === t;
}

export function trackEnabled(track, profile) {
  const tracks = profile?.tracks || ['pistol'];
  if (track === 'ccw') return tracks.includes('ccw');
  return tracks.includes(track);
}

export function levelDrills(level, profile) {
  return level.drills.map(id => C.drills.get(id)).filter(d => drillAvailable(d, profile));
}

export function bossComponents(boss, profile) {
  return (boss.components || [])
    .map(c => ({ ...c, drill: C.drills.get(c.drill) }))
    .filter(c => drillAvailable(c.drill, profile));
}

export function unitsForTrack(track) {
  return C.units.filter(u => u.track === track).sort((a, b) => a.order - b.order);
}

export const TARGET_LABEL = { any: 'Circle or grid', circle: 'Single circle', grid: '9-square grid', both: 'Circle + grid' };
export const START_LABEL = {
  holster: 'Holster', concealed: 'Concealed holster', 'low-ready': 'Low ready', 'compressed-ready': 'Compressed ready',
  'high-ready': 'High ready', extended: 'Extended / on target', table: 'Gun on table', pocket: 'Pocket holster',
  bag: 'Off-body bag', seated: 'Seated', sling: 'Slung rifle', retention: 'Retention',
};
