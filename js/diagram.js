// SVG setup diagrams (top-down room view) and the 3x3 grid component.
import { esc } from './ui.js';

export function distLabel(yd, units = 'yd') {
  if (yd == null) return '';
  const ft = Math.round(yd * 3);
  if (units === 'm') return `${(yd * 0.9144).toFixed(1)} m`;
  return `${yd} yd (${ft} ft)`;
}

// Top-down: target on the top wall, shooter below at distance and angle.
export function setupDiagram(drill, units = 'yd') {
  const s = drill.setup || {};
  const yd = s.distanceYd || 3;
  const angle = s.angle || 'square';
  const W = 300, H = 210;
  const tx = W / 2, ty = 26;
  const px = 70 + Math.min(yd, 8) / 8 * 110; // scaled distance in px
  const offsets = { square: 0, 'left-45': -1, 'right-45': 1, 'left-90': -1.6, 'right-90': 1.6, 'barricade-left': -0.5, 'barricade-right': 0.5 };
  const off = offsets[angle] ?? 0;
  const sx = tx + off * 55;
  const sy = Math.min(H - 28, ty + px);
  const isGrid = drill.target === 'grid';
  const isBoth = drill.target === 'both';
  let targetSvg = isGrid
    ? `<rect x="${tx - 18}" y="${ty - 14}" width="36" height="10" class="d-target"/>`
    : `<rect x="${tx - 10}" y="${ty - 14}" width="20" height="10" class="d-target"/>`;
  if (isBoth) targetSvg = `<rect x="${tx - 40}" y="${ty - 14}" width="20" height="10" class="d-target"/><rect x="${tx + 6}" y="${ty - 14}" width="34" height="10" class="d-target"/>`;
  const barricade = angle.startsWith('barricade')
    ? `<rect x="${sx + (angle.endsWith('left') ? 8 : -28)}" y="${sy - 34}" width="20" height="8" class="d-barricade"/><text x="${sx + (angle.endsWith('left') ? 18 : -18)}" y="${sy - 40}" class="d-small" text-anchor="middle">door frame</text>`
    : '';
  // Shooter facing: square to the wall, or rotated for 90° starts (turn to target).
  const facing = angle === 'left-90' ? 90 : angle === 'right-90' ? -90 : 0;
  return `<svg viewBox="0 0 ${W} ${H}" class="diagram" role="img" aria-label="Setup: ${esc(distLabel(yd, units))}, ${esc(angle)}">
    <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="8" class="d-room"/>
    <line x1="10" y1="${ty - 4}" x2="${W - 10}" y2="${ty - 4}" class="d-wall"/>
    ${targetSvg}
    <text x="${tx}" y="${ty + 12}" class="d-small" text-anchor="middle">${isGrid ? '3×3 grid' : isBoth ? 'circle + grid' : 'target'}</text>
    <line x1="${tx}" y1="${ty}" x2="${sx}" y2="${sy - 12}" class="d-line"/>
    <text x="${(tx + sx) / 2 + 8}" y="${(ty + sy) / 2}" class="d-label">${esc(distLabel(yd, units))}</text>
    ${barricade}
    <g transform="translate(${sx} ${sy}) rotate(${facing})">
      <ellipse cx="0" cy="0" rx="16" ry="9" class="d-shooter"/>
      <circle cx="0" cy="0" r="6" class="d-head"/>
      <path d="M-4 -8 L0 -20 L4 -8" class="d-arrow"/>
    </g>
    <text x="${sx}" y="${Math.min(H - 8, sy + 22)}" class="d-small" text-anchor="middle">you</text>
  </svg>`;
}

// 3x3 grid. opts: { called: [n...] ordered, missed: Set, interactive, highlight }
export function gridSvg({ called = [], missed = new Set(), highlight = null, size = 'lg' } = {}) {
  const order = {};
  called.forEach((n, i) => { (order[n] ||= []).push(i + 1); });
  let cells = '';
  for (let n = 1; n <= 9; n++) {
    const isCalled = order[n];
    const isMissed = missed.has(n);
    const cls = ['g-cell', isCalled ? 'called' : '', isMissed ? 'missed' : '', highlight === n ? 'hl' : ''].join(' ');
    const label = isCalled ? `Square ${n}, shot ${order[n].join(' and ')}${isMissed ? ', missed' : ''}` : `Square ${n}`;
    cells += `<button type="button" class="${cls}" data-sq="${n}" aria-label="${label}" aria-pressed="${isMissed}">
      <span class="g-num">${n}</span>${isCalled ? `<span class="g-ord">${order[n].map(o => '#' + o).join(' ')}</span>` : ''}
      ${isMissed ? '<span class="g-x" aria-hidden="true">✕</span>' : ''}</button>`;
  }
  return `<div class="grid9 ${size}">${cells}</div>`;
}

export function miniGrid(seq = []) {
  return `<span class="mini-grid" aria-label="Squares ${seq.join(', ')}">${[1,2,3,4,5,6,7,8,9].map(n => `<i class="${seq.includes(n) ? 'on' : ''}"></i>`).join('')}</span>`;
}

// Heatmap of miss rate per square.
export function heatGrid(stats) {
  let cells = '';
  for (let n = 1; n <= 9; n++) {
    const s = stats[n] || { called: 0, missed: 0 };
    const rate = s.called ? s.missed / s.called : 0;
    const a = s.called ? 0.12 + rate * 0.85 : 0.04;
    cells += `<div class="h-cell" style="background: rgba(255,90,70,${a.toFixed(2)})">
      <b>${n}</b><small>${s.called ? Math.round(rate * 100) + '% miss' : '—'}</small><small>${s.called} shots</small></div>`;
  }
  return `<div class="heat">${cells}</div>`;
}
