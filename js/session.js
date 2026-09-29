// Training sessions. A session starts when the per-session safety checklist is
// acknowledged and stays open until 2 hours pass without activity.
import { kv, sessions, attempts } from './db.js';

const IDLE_MS = 2 * 60 * 60 * 1000;

export async function currentSession() {
  const s = await kv.get('session');
  if (!s) return null;
  if (Date.now() - new Date(s.lastActive).getTime() > IDLE_MS) return null;
  return s;
}

export async function startSession(checklist) {
  const now = new Date().toISOString();
  const rec = { start: now, lastActive: now, safetyAck: now, checklist, drills: 0 };
  rec.id = await sessions.add({ ...rec });
  await kv.set('session', rec);
  return rec;
}

export async function touchSession(countDrill = true) {
  const s = await currentSession();
  if (!s) return null;
  s.lastActive = new Date().toISOString();
  if (countDrill) s.drills = (s.drills || 0) + 1;
  await kv.set('session', s);
  await sessions.put({ ...s, end: s.lastActive });
  return s;
}

export async function endSession() { await kv.del('session'); }

// Cold start: no drill logged in this session and none within `minutes`.
export async function coldStartStatus(minutes = 30) {
  const s = await currentSession();
  const all = await attempts.all();
  const last = all.reduce((m, a) => (a.date > m ? a.date : m), '');
  const sinceMin = last ? (Date.now() - new Date(last).getTime()) / 60000 : Infinity;
  if (s && s.drills > 0) return { ok: false, reason: `You have already run ${s.drills} drill${s.drills > 1 ? 's' : ''} this session. The Man Card must be shot cold: end this session and come back later.`, canEndSession: true, waitMin: Math.max(0, Math.ceil(minutes - sinceMin)) };
  if (sinceMin < minutes) return { ok: false, reason: `Last drill was ${Math.floor(sinceMin)} min ago. Cold start requires ${minutes} min with no warmup.`, waitMin: Math.ceil(minutes - sinceMin) };
  return { ok: true };
}
