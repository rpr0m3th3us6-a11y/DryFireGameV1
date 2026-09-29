// Scoring: accuracy, hit factor, tier evaluation. Pure functions.

export const TIERS = ['bronze', 'silver', 'gold'];
export const TIER_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };

export function tierAtLeast(t, min) {
  return (TIER_RANK[t || 'none'] || 0) >= (TIER_RANK[min] || 0);
}
export function betterTier(a, b) {
  return (TIER_RANK[a || 'none'] || 0) >= (TIER_RANK[b || 'none'] || 0) ? (a || 'none') : b;
}
export function minTier(list) {
  let best = 'gold';
  for (const t of list) if ((TIER_RANK[t || 'none'] || 0) < TIER_RANK[best]) best = t || 'none';
  return list.length ? best : 'none';
}

// strings: [{ time, hits, misses, noShoot }]
export function summarize(drill, strings) {
  let hits = 0, misses = 0, noShoot = 0, total = 0, timed = 0, best = Infinity;
  for (const s of strings) {
    hits += s.hits || 0;
    misses += s.misses || 0;
    noShoot += s.noShoot || 0;
    if (typeof s.time === 'number' && s.time > 0) {
      total += s.time; timed++;
      if (s.time < best) best = s.time;
    }
  }
  const shots = hits + misses + noShoot;
  // Decision strings where the right answer was to hold have 0 shots and count
  // as correct; they are tracked via s.correctHold.
  const holds = strings.filter(s => s.correctHold).length;
  const denom = shots + holds;
  const accuracy = denom ? Math.round(((hits + holds) / denom) * 1000) / 10 : 0;
  const avgTime = timed ? round2(total / timed) : null;
  const points = Math.max(0, 5 * hits - 10 * misses - 10 * noShoot);
  const hitFactor = total > 0 ? round2(points / total) : null;
  const tier = evaluateTier(drill, accuracy, avgTime);
  const passAcc = drill.pass?.accuracy ?? 80;
  const passed = tier !== 'none' && accuracy >= passAcc;
  return {
    accuracy, avgTime, bestTime: best === Infinity ? null : round2(best),
    hitFactor, hits, misses, noShoot, strings: strings.length, tier, passed,
  };
}

export function evaluateTier(drill, accuracy, avgTime) {
  const passAcc = drill.pass?.accuracy ?? 80;
  if (drill.scoring === 'accuracy' || !drill.par) {
    const t = drill.accuracyTiers || { bronze: passAcc, silver: Math.min(100, passAcc + 10), gold: Math.min(100, passAcc + 18) };
    if (accuracy >= t.gold) return 'gold';
    if (accuracy >= t.silver) return 'silver';
    if (accuracy >= t.bronze && accuracy >= passAcc) return 'bronze';
    return 'none';
  }
  if (accuracy < passAcc || avgTime == null) return 'none';
  const goldAcc = Math.max(passAcc, 90);
  if (avgTime <= drill.par.gold && accuracy >= goldAcc) return 'gold';
  if (avgTime <= drill.par.silver) return 'silver';
  if (avgTime <= drill.par.bronze) return 'bronze';
  return 'none';
}

// Par used for the optional par beep: the next tier the user hasn't earned yet.
export function targetPar(drill, bestTier) {
  if (!drill.par) return null;
  if (bestTier === 'gold' || bestTier === 'silver') return drill.par.gold;
  if (bestTier === 'bronze') return drill.par.silver;
  return drill.par.bronze;
}

export function round2(n) { return Math.round(n * 100) / 100; }

export function fmtTime(t) { return t == null ? '—' : t.toFixed(2) + 's'; }
