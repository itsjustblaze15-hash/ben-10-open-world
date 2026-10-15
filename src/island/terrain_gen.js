// ISLAND TERRAIN GENERATOR (pure JS, runs in the browser at load and in Node for the debug map).
// One heightfield on a 4 m grid (bilinear between samples) = the ground for walking, rays, water depth, scenery placement and the minimap.
// Order: land/water distance -> regional elevation (soft region blend) -> underwater profile -> road profiles (smoothed, grade-limited) -> road flattening -> bridge embankments.
import { SEA, GRID, COAST, BAY, ISLETS, FLATS, LAKES, RIVERS, TARN, STREAM, REGIONS, REGION_ORDER, ROADS, SUBURB_ROADS, ROAD_W, polySD, polylineDist, resample, makeNoise, segDist } from './layout.js';

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
export const DECK = 2.6;                                         // bridge deck surface height (m above y = 0)
export const WATER = { NONE: 0, SEA: 1, BAY: 2, RIVER: 3, LAKE: 4 };
export const REGION_IDS = REGION_ORDER.slice();                 // index -> key (labs, city, industrial, beach, suburb, desert, mountains, foothills, forest)

// mountain peaks (x, z, height, radius) + desert mesas (x, z, rx, rz, height, rot)
const PEAKS = [[-300, -668, 190, 200], [-90, -690, 150, 160], [-480, -610, 140, 150], [60, -660, 96, 120], [-640, -650, 112, 130], [-200, -760, 120, 130]];
const MESAS = [[300, -20, 46, 34, 34, 0.3], [330, 132, 52, 30, 28, -0.2], [470, -10, 40, 52, 40, 0.1], [440, 150, 34, 40, 26, 0.5], [600, -60, 60, 40, 46, -0.3],
  [640, 250, 46, 50, 30, 0.2], [210, 220, 30, 24, 20, 0.7], [560, 330, 30, 26, 22, 0], [260, -160, 42, 30, 30, 0.4], [420, -170, 36, 28, 24, -0.4]];

export function generateTerrain(seed = 7) {
  const N = makeNoise(seed), N2 = makeNoise(seed + 101);
  const { nx, nz, cell, x0, z0 } = GRID, n = nx * nz;
  const H = new Float32Array(n), DL = new Float32Array(n), WK = new Uint8Array(n), RG = new Uint8Array(n), RM = new Float32Array(n);
  const regs = REGION_IDS.map(k => REGIONS[k]);
  const rivers = RIVERS.map(r => ({ ...r, s: resample(r.pts, 6) }));
  const streamPts = resample(STREAM.pts, 6);
  const W = new Float32Array(regs.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = j * nx + i;
    // ---- land / water
    let sdC = polySD(COAST, x, z) + 9 * N.n2(x * 0.011, z * 0.011); const sdB = polySD(BAY, x, z) - 5 * N.n2(x * 0.02 + 3, z * 0.02);
    for (const [ix, iz, ir] of ISLETS) sdC = Math.max(sdC, ir * (1 + 0.15 * N.n2(x * 0.04, z * 0.04)) - Math.hypot(x - ix, z - iz));
    let dl = Math.min(sdC, -sdB), wk = sdC < 0 ? WATER.SEA : sdB > 0 ? WATER.BAY : WATER.NONE;
    for (const L of LAKES) { const d = Math.hypot(x - L.x, z - L.z) - L.r * (1 + 0.08 * N.n2(x * 0.02, z * 0.02)); if (d < dl) { dl = d; if (d < 0) wk = WATER.LAKE; } }
    for (const R of rivers) { const d = polylineDist(R.s, x, z) - R.w / 2; if (d < dl) { dl = d; if (d < 0) wk = WATER.RIVER; } }
    // ---- region weights (soft polygons)
    let wsum = 0, best = 0, bw = -1;
        for (let r = 0; r < regs.length; r++) { const sd = polySD(regs[r].poly, x, z) + (REGION_IDS[r] === 'city' || REGION_IDS[r] === 'labs' ? 0 : 38 * N2.fbm(x * 0.006 + r * 17.3, z * 0.006 - r * 9.1, 3)); const w = sst(-70, 50, sd) + (sd > 0 ? 1e-3 : 0); W[r] = w; wsum += w; if (w > bw) { bw = w; best = r; } }
    if (wsum < 1e-4) { for (let r = 0; r < regs.length; r++) W[r] = 0; W[REGION_IDS.indexOf('forest')] = 1; wsum = 1; best = REGION_IDS.indexOf('forest'); }
    // ---- regional elevation
    let e = 0;
    for (let r = 0; r < regs.length; r++) { const w = W[r] / wsum; if (w < 1e-3) continue; e += w * regionHeight(REGION_IDS[r], x, z, N, N2); }
    let islet = 0; for (const [ix, iz, ir, ih] of ISLETS) { const d = Math.hypot(x - ix, z - iz) / ir; if (d < 1.2) islet = Math.max(islet, ih * Math.exp(-d * d * 2.2)); }
    if (islet > 0 && polySD(COAST, x, z) < 0) e = islet;
    // ---- shore falloff + underwater
    let h;
    if (dl >= 0) {
      const coastK = sst(0, wk === WATER.NONE && W[REGION_IDS.indexOf('mountains')] / wsum > 0.5 ? 26 : 70, dl);
      h = lerp(SEA + 0.05, Math.max(e, 0), coastK); if (dl < 10) h = Math.min(h, SEA + 0.12 + dl * 0.06 + Math.max(0, e) * sst(2, 10, dl));
    } else {
      const d = -dl, kind = wk || WATER.SEA;
      const prof = kind === WATER.SEA ? Math.min(34, 0.35 + d * 0.16 + 6 * sst(60, 200, d)) : kind === WATER.BAY ? Math.min(18, 0.4 + d * 0.24) : kind === WATER.RIVER ? Math.min(5.5, 0.5 + d * 0.55) : Math.min(10, 0.5 + d * 0.32);
      h = SEA - prof + (kind === WATER.SEA || kind === WATER.BAY ? 1.2 * N.n2(x * 0.03, z * 0.03) * sst(4, 20, d) : 0);
      h = Math.min(h, SEA - 0.25);
    }
    // ---- mountain tarn (elevated basin) + stream bed
    { const d = Math.hypot(x - TARN.x, z - TARN.z); if (d < TARN.r + 30) { const rim = TARN.level + 1.2, bed = TARN.level - 3.4; const t = sst(TARN.r + 30, TARN.r - 4, d); h = lerp(Math.max(h, rim), bed + (d / TARN.r) * 2.2, t); } }
    { const d = polylineDist(streamPts, x, z); if (d < STREAM.w) h -= 1.1 * sst(STREAM.w, 0, d); }
    if (dl > 0) for (const F of FLATS) { const ox = Math.max(F.x0 - x, 0, x - F.x1), oz = Math.max(F.z0 - z, 0, z - F.z1), o = Math.hypot(ox, oz); if (o < F.blend) h = lerp(F.h, h, sst(0, F.blend, o) * sst(0, 6, dl) + (1 - sst(0, 6, dl)) * 0); }
    H[k] = h; DL[k] = dl; WK[k] = dl < 0 ? (wk || WATER.SEA) : 0; RG[k] = best;
  }
  const T = { H, DL, WK, RG, RM, nx, nz, cell, x0, z0, roads: [] };
  // ---- roads: profile + flatten
  const all = [...ROADS, ...SUBURB_ROADS];
  for (const R of all) T.roads.push(buildRoad(T, R));
  for (const R of T.roads) flattenRoad(T, R);
  return T;
}

/** regional elevation (metres above y = 0) before shores / water / roads */
function regionHeight(key, x, z, N, N2) {
  switch (key) {
    case 'city': return 0;
    case 'labs': return 0;
    case 'industrial': return 0;
    case 'beach': return Math.max(0, 0.9 * N.fbm(x * 0.012, z * 0.012, 3));
    case 'suburb': return Math.max(0, 2.2 + 3.6 * N.fbm(x * 0.006 + 3, z * 0.006, 3));
    case 'forest': { const hills = 14 + 18 * N.fbm(x * 0.0045 + 7, z * 0.0045 - 2, 5); const toward = sst(-150, -460, z) * 22; return Math.max(1.5, hills + toward); }
    case 'foothills': { const t = sst(-260, -420, z); return Math.max(2, 10 + 16 * N.fbm(x * 0.006 - 4, z * 0.006 + 9, 4) + t * 40); }
    case 'mountains': {
      let m = 0; for (const [px, pz, ph, pr] of PEAKS) { const d = Math.hypot(x - px, z - pz) / pr; m = Math.max(m, ph * Math.exp(-d * d * 1.5)); }
      const r = N2.ridge(x * 0.006, z * 0.006, 5); return Math.max(18, 30 + m * (0.72 + 0.45 * r) + 10 * N.fbm(x * 0.02, z * 0.02, 3));
    }
    case 'desert': {
      let h = 1.0 + 1.6 * N.fbm(x * 0.01 + 1, z * 0.01 - 5, 3) + 2.4 * Math.max(0, N2.fbm(x * 0.004, z * 0.004, 3));
      for (const [mx, mz, rx, rz, mh, rot] of MESAS) {
        const c = Math.cos(rot), s = Math.sin(rot), dx = x - mx, dz = z - mz, u = (dx * c - dz * s) / rx, v = (dx * s + dz * c) / rz;
        const q = Math.pow(Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3), 1 / 3) * (1 + 0.1 * N.n2(x * 0.05, z * 0.05));
        const top = mh * sst(1.08, 0.92, q), mid = mh * 0.45 * sst(1.32, 1.12, q); h = Math.max(h, Math.max(top, mid) + (top > 0.5 ? 1.5 * N.fbm(x * 0.05, z * 0.05, 2) : 0));
      }
      return h;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------- sampling
export function hAt(T, x, z) {
  const fx = (x - T.x0) / T.cell, fz = (z - T.z0) / T.cell; let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; else if (i > T.nx - 2) i = T.nx - 2; if (j < 0) j = 0; else if (j > T.nz - 2) j = T.nz - 2;
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j)), k = j * T.nx + i, H = T.H;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + T.nx] * (1 - u) + H[k + T.nx + 1] * u) * v;
}
export function dlAt(T, x, z) {
  const i = Math.max(0, Math.min(T.nx - 1, Math.round((x - T.x0) / T.cell))), j = Math.max(0, Math.min(T.nz - 1, Math.round((z - T.z0) / T.cell))); return T.DL[j * T.nx + i];
}
export function regionAt(T, x, z) {
  const i = Math.max(0, Math.min(T.nx - 1, Math.round((x - T.x0) / T.cell))), j = Math.max(0, Math.min(T.nz - 1, Math.round((z - T.z0) / T.cell))); return REGION_IDS[T.RG[j * T.nx + i]];
}

// ---------------------------------------------------------------------------------------------------- roads
function buildRoad(T, R) {
  const w = ROAD_W[R.type], s = resample(R.pts, 4, !!R.straight), n = s.length;
  const pts = s.map(([x, z]) => ({ x, z, y: hAt(T, x, z), wet: dlAt(T, x, z) < 1 }));
  if (R.bridge) {
    // deck over the water, embankments rising to it over the last 46 m of land on both sides
    const wetIdx = pts.map((p, i) => p.wet ? i : -1).filter(i => i >= 0);
    const a = wetIdx.length ? wetIdx[0] : -1, b = wetIdx.length ? wetIdx[wetIdx.length - 1] : -1;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; if (a < 0) break;
      if (i >= a && i <= b) { p.y = DECK; p.deck = true; continue; }
      const dIdx = i < a ? a - i : i - b, ramp = DECK - dIdx * 4 * 0.08;
      p.y = Math.max(p.y, ramp); if (dIdx <= 1) p.deck = true;
    }
    R.deckSpan = a >= 0 ? [Math.max(0, a - 1), Math.min(n - 1, b + 1)] : null;
  } else {
    for (const p of pts) if (p.wet) p.y = Math.max(p.y, 0.2);
    // smooth (hilly roads) and limit the grade
    const flat = R.city || pts.every(p => Math.abs(p.y) < 0.6);
    if (!flat) {
      const y0 = pts.map(p => p.y), win = R.type === 'dirt' || R.type === 'path' ? 3 : 7;
      for (let i = 0; i < n; i++) { let s2 = 0, c = 0; for (let k = -win; k <= win; k++) { const q = y0[Math.min(n - 1, Math.max(0, i + k))]; s2 += q; c++; } pts[i].y = s2 / c; }
      const g = (R.type === 'dirt' ? 0.16 : 0.11) * 4;
      for (let i = 1; i < n; i++) pts[i].y = Math.min(pts[i - 1].y + g, Math.max(pts[i - 1].y - g, pts[i].y));
      for (let i = n - 2; i >= 0; i--) pts[i].y = Math.min(pts[i + 1].y + g, Math.max(pts[i + 1].y - g, pts[i].y));
    } else for (const p of pts) p.y = Math.max(0, Math.min(p.y, 0.4)) * (R.city ? 0 : 1);
  }
  // headings
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; pts[i].dx = dx / L; pts[i].dz = dz / L; }
  return { id: R.id, type: R.type, w, pts, bridge: !!R.bridge, city: !!R.city, straight: !!R.straight, cul: !!R.cul, deckSpan: R.deckSpan || null };
}
function flattenRoad(T, R) {
  const half = R.w / 2, shoulder = R.type === 'highway' ? 14 : 10, reach = half + shoulder, { cell, x0, z0, nx, nz, H, DL, RM } = T, P = R.pts;
  for (let s = 1; s < P.length; s++) {
    const a = P[s - 1], b = P[s];
    const minX = Math.min(a.x, b.x) - reach, maxX = Math.max(a.x, b.x) + reach, minZ = Math.min(a.z, b.z) - reach, maxZ = Math.max(a.z, b.z) + reach;
    const i0 = Math.max(0, Math.floor((minX - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell)), j0 = Math.max(0, Math.floor((minZ - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((maxZ - z0) / cell));
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i, x = x0 + i * cell, z = z0 + j * cell; if (DL[k] < 0.5) continue;                       // never fill water (bridges span it)
      let t = ((x - a.x) * dx + (z - a.z) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = a.x + dx * t - x, qz = a.z + dz * t - z, d = Math.hypot(qx, qz);
      if (d > reach) continue; const y = a.y + (b.y - a.y) * t, wgt = 1 - sst(half + 1.5, reach, d);
      if (wgt > RM[k] || (wgt >= 0.999 && Math.abs(H[k] - y) > 0)) { H[k] = lerp(H[k], y, wgt); if (wgt > RM[k]) RM[k] = wgt; }
    }
  }
}
/** distance from (x, z) to the nearest road centreline + that road (coarse; used for placement) */
export function nearestRoad(T, x, z, maxD = 60) {
  let best = null, bd = maxD;
  for (const R of T.roads) { for (let i = 1; i < R.pts.length; i++) { const a = R.pts[i - 1], b = R.pts[i]; if (Math.abs(a.x - x) > bd + 40 && Math.abs(b.x - x) > bd + 40) continue; const d = segDist(x, z, a.x, a.z, b.x, b.z) - R.w / 2; if (d < bd) { bd = d; best = R; } } }
  return { road: best, d: bd };
}
