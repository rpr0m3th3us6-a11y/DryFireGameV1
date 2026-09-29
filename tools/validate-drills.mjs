#!/usr/bin/env node
// Validates data/drills.json (or a custom pack) against the content rules.
// Usage: node tools/validate-drills.mjs [path/to/drills.json]
import { readFileSync } from 'node:fs';

const path = process.argv[2] || new URL('../data/drills.json', import.meta.url);
const data = JSON.parse(readFileSync(path, 'utf8'));
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

const MODES = ['standard', 'sequence', 'callout', 'decision', 'untimed'];
const TARGETS = ['any', 'circle', 'grid', 'both'];
const ANGLES = ['square', 'left-45', 'right-45', 'left-90', 'right-90', 'barricade-left', 'barricade-right'];
const REQUIRED = ['id', 'title', 'track', 'unit', 'target', 'mode', 'start', 'setup', 'objective', 'steps', 'reps', 'cue'];

const isPack = !data.units?.length && !data.manCard;
const drills = new Map();
for (const d of data.drills || []) {
  if (drills.has(d.id)) err(`duplicate drill id ${d.id}`);
  drills.set(d.id, d);
}
const unitIds = new Set((data.units || []).map(u => u.id));

for (const d of drills.values()) {
  const at = `drill ${d.id}`;
  for (const f of REQUIRED) if (d[f] == null) err(`${at}: missing ${f}`);
  if (!MODES.includes(d.mode)) err(`${at}: mode "${d.mode}" invalid`);
  if (!TARGETS.includes(d.target)) err(`${at}: target "${d.target}" invalid`);
  if (d.setup && !ANGLES.includes(d.setup.angle)) warn(`${at}: unknown angle "${d.setup.angle}"`);
  if (d.setup && typeof d.setup.distanceYd !== 'number') err(`${at}: setup.distanceYd must be a number`);
  if (!isPack && !unitIds.has(d.unit)) err(`${at}: unit ${d.unit} not found`);
  if (d.par) {
    const { bronze, silver, gold } = d.par;
    if (!(bronze > silver && silver > gold && gold > 0)) err(`${at}: par must be bronze > silver > gold > 0`);
  } else if (d.mode !== 'untimed' && d.scoring !== 'accuracy') err(`${at}: timed drill without par`);
  if (d.scoring === 'accuracy' && !d.accuracyTiers) warn(`${at}: accuracy scoring without accuracyTiers (defaults used)`);
  if (d.mode === 'sequence') {
    if (!Array.isArray(d.sequence) || !d.sequence.every(n => n >= 1 && n <= 9)) err(`${at}: sequence must be grid squares 1-9`);
    if (d.target !== 'grid' && d.target !== 'both') warn(`${at}: sequence drills normally target the grid`);
  }
  if (d.mode === 'callout' && !(d.callout?.count >= 1)) err(`${at}: callout.count required`);
  if (d.mode === 'decision') {
    const dc = d.decision;
    if (!dc?.shoot?.length || !dc?.noShoot?.length) err(`${at}: decision needs shoot[] and noShoot[]`);
  }
  if ((d.shots || 1) > 1 && !d.equipment?.includes('reset-trigger')) warn(`${at}: multi-shot string without reset-trigger equipment`);
  if (d.remedial && !drills.has(d.remedial)) err(`${at}: remedial ${d.remedial} not found`);
}

const coverage = (list, t) => list.some(d => d && (d.target === 'any' || d.target === t));
for (const u of data.units || []) {
  const at = `unit ${u.id}`;
  for (const r of u.requires || []) if (!unitIds.has(r)) err(`${at}: requires unknown unit ${r}`);
  for (const l of u.levels || []) {
    const ds = l.drills.map(id => drills.get(id));
    l.drills.forEach((id, i) => { if (!ds[i]) err(`${at}/${l.id}: drill ${id} not found`); });
    if (!coverage(ds, 'circle')) warn(`${at}/${l.id}: nothing playable on a circle-only target`);
    if (!coverage(ds, 'grid')) warn(`${at}/${l.id}: nothing playable on a grid-only target`);
  }
  if (u.boss && u.boss.type !== 'mancard') {
    for (const c of u.boss.components || []) if (!drills.has(c.drill)) err(`${at}: boss component ${c.drill} not found`);
    const cs = (u.boss.components || []).map(c => drills.get(c.drill));
    if (cs.filter(d => d && (d.target === 'any' || d.target === 'circle')).length < 3) warn(`${at}: boss has < 3 circle-playable components`);
    if (cs.filter(d => d && (d.target === 'any' || d.target === 'grid')).length < 3) warn(`${at}: boss has < 3 grid-playable components`);
  }
}

const mc = data.manCard;
if (mc) {
  for (const k of ['short', 'long']) {
    const card = mc[k];
    if (!card?.iterations?.length) { err(`manCard.${k}: no iterations`); continue; }
    const ids = new Set();
    for (const it of card.iterations) {
      if (ids.has(it.id)) err(`manCard.${k}: duplicate iteration ${it.id}`);
      ids.add(it.id);
      if (!(it.par > 0)) err(`manCard.${k}.${it.id}: par must be > 0`);
      if (!['pistol', 'rifle'].includes(it.weapon)) err(`manCard.${k}.${it.id}: weapon must be pistol or rifle`);
    }
  }
  for (const u of mc.unlock?.units || []) if (!unitIds.has(u)) err(`manCard.unlock: unknown unit ${u}`);
}

for (const w of warnings) console.log('warn  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(`\n${drills.size} drills, ${(data.units || []).length} units: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
