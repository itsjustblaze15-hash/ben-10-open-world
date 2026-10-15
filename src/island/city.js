// MAIN CITY: a compact downtown on the street grid of layout.CITY. Towers rise toward the skyline centre and fall off to mid-rise apartments / offices and low shop rows at the edges;
// two parks, a plaza with a fountain, two parking lots. Static: buildings (+ roof details), street trees, traffic lights, hydrants, fountain. Interactive props (spawn list): street lights,
// benches, bins, parked cars, dumpsters in the alleys.
import { CITY, makeNoise } from './layout.js';

const PALETTE = [0xf2d9b0, 0xe9b4a0, 0x9fd3c7, 0xa9c8e8, 0xf0e2c4, 0xc9b8de, 0xb8dcb0, 0xf3c08a, 0xd6d9de, 0xe8cfa6, 0xf5e6d0, 0xb0c8d8];
const TOWER = [0x8fb4d8, 0x7fc6c0, 0xa8b2c0, 0x9cb8e6, 0xbfd0dc, 0x6fa0c8];

export function buildCity(world, B, D, T) {
  const C = CITY, N = makeNoise(4242), rnd = N.rnd, spawns = [], lots = [];
  const xs = [C.ringX[0], ...C.xs, C.ringX[1]], zs = [C.ringZ[0], ...C.zs, C.ringZ[1]];
  const wOf = (v, ring, av) => ring ? 18 : v === av ? 16 : 12;
  const xw = xs.map((x, i) => wOf(x, i === 0 || i === xs.length - 1, C.avenueX)), zw = zs.map((z, i) => wOf(z, i === 0 || i === zs.length - 1, C.avenueZ));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const isKey = (list, x, z) => list.some(k => k[0] === x && k[1] === z);
  const SW = 4.4;                                                                 // sidewalk width
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const bx0 = xs[i] + xw[i] / 2 + SW, bx1 = xs[i + 1] - xw[i + 1] / 2 - SW, bz0 = zs[j] + zw[j] / 2 + SW, bz1 = zs[j + 1] - zw[j + 1] / 2 - SW;
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, W = bx1 - bx0, Dd = bz1 - bz0, key = [xs[i], zs[j]];
    const block = { x0: bx0, x1: bx1, z0: bz0, z1: bz1, cx, cz };
    if (isKey(C.parks, ...key)) { park(block); continue; }
    if (C.plaza[0] === key[0] && C.plaza[1] === key[1]) { plaza(block); continue; }
    if (isKey(C.lots, ...key)) { parking(block); continue; }
    const dCore = Math.hypot(cx - C.core.x, cz - C.core.z), tall = Math.max(0, 1 - dCore / 230);
    if (tall > 0.55) towerBlock(block, tall); else if (tall > 0.22) midBlock(block, tall); else shopBlock(block);
  }
  // ---- street furniture along every city street (both sides), skipping the intersections
  for (let i = 0; i < xs.length; i++) streetSide(xs[i], xw[i], true);
  for (let j = 0; j < zs.length; j++) streetSide(zs[j], zw[j], false);
  // ---- traffic lights at interior intersections
  for (const x of C.xs) for (const z of C.zs) { const hx = (x === C.avenueX ? 8 : 6) + 1.8, hz = (z === C.avenueZ ? 8 : 6) + 1.8;
    D.add('trafficLight', x + hx, 0, z + hz, Math.PI, { collider: [0.5, 5.4, 0.5], kind: 'trafficLight' }); D.add('trafficLight', x - hx, 0, z - hz, 0, { collider: [0.5, 5.4, 0.5], kind: 'trafficLight' }); }
  return { spawns, lots, xs, zs, xw, zw };

  // -------------------------------------------------------------------------------------------- block types
  function bld(x, z, w, d, h, style, o = {}) {
    const b = B.add(x, o.y0 ?? 0, z, w, h, d, { style, color: o.color ?? (style === 0 ? pick(TOWER) : pick(PALETTE)), fh: style === 0 ? 3.6 : style === 2 ? 4.2 : 3.3, ws: style === 0 ? 2.4 + rnd() * 1.2 : 2.8 + rnd() * 0.8, yaw: o.yaw ?? 0, kind: 'building', name: o.name });
    const top = (o.y0 ?? 0) + h; roof(x, z, w, d, top, style, h);
    lots.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: top, style }); return b;
  }
  function roof(x, z, w, d, top, style, h) {
    const n = Math.min(4, Math.floor(w * d / 260) + 1);
    for (let k = 0; k < n; k++) D.add('acUnit', x + (rnd() - 0.5) * (w - 4), top, z + (rnd() - 0.5) * (d - 4), Math.floor(rnd() * 4) * Math.PI / 2, { dist: 700, shadow: false });
    if (style === 1 && rnd() < 0.45) D.add('waterTank', x + (rnd() - 0.5) * (w - 6), top, z + (rnd() - 0.5) * (d - 6), 0, { dist: 800 });
    if (style === 0 && h > 85 && rnd() < 0.8) D.add('antenna', x + (rnd() - 0.5) * 4, top, z + (rnd() - 0.5) * 4, 0, { scale: 1 + rnd(), dist: 2000 });
  }
  function towerBlock(b, tall) {
    const W = b.x1 - b.x0, Dd = b.z1 - b.z0, pod = 9 + rnd() * 5;
    bld(b.cx, b.cz, W, Dd, pod, 2);
    const two = rnd() < 0.4;
    if (two) { for (const s of [-1, 1]) { const h = 40 + rnd() * 55 * tall; const tw = W * 0.38, td = Dd * 0.6; tower(b.cx + s * W * 0.24, b.cz + (rnd() - 0.5) * 4, tw, td, h, pod); } }
    else { const h = 55 + rnd() * 70 * tall; tower(b.cx + (rnd() - 0.5) * 4, b.cz + (rnd() - 0.5) * 4, W * (0.55 + rnd() * 0.15), Dd * (0.55 + rnd() * 0.15), h, pod); }
  }
  function tower(x, z, w, d, h, y0) {
    const col = pick(TOWER), s1 = h * (0.55 + rnd() * 0.25);
    bld(x, z, w, d, s1, 0, { y0, color: col });
    const w2 = w * (0.68 + rnd() * 0.15), d2 = d * (0.68 + rnd() * 0.15); bld(x, z, w2, d2, h - s1, 0, { y0: y0 + s1, color: col });
    if (rnd() < 0.5) bld(x, z, w2 * 0.5, d2 * 0.5, 6 + rnd() * 8, 6, { y0: y0 + h, color: 0xd6d9de });
  }
  function midBlock(b, tall) {
    const W = b.x1 - b.x0, Dd = b.z1 - b.z0, gap = 3;
    if (rnd() < 0.5) { const w = (W - gap) / 2; for (const s of [-1, 1]) { const st = rnd() < 0.55 ? 1 : 0, h = (st ? 18 : 26) + rnd() * 34 * (0.4 + tall); bld(b.cx + s * (w + gap) / 2, b.cz, w, Dd, h, st); }
      spawns.push({ kind: 'dumpster', x: b.cx, z: b.cz + (rnd() - 0.5) * Dd * 0.6, yaw: Math.PI / 2 }); }
    else { const w = (W - gap) / 2, d = (Dd - gap) / 2; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const st = rnd() < 0.5 ? 1 : 2, h = (st === 1 ? 14 : 9) + rnd() * 26 * (0.4 + tall); bld(b.cx + sx * (w + gap) / 2, b.cz + sz * (d + gap) / 2, w, d, h, st); }
      spawns.push({ kind: 'dumpster', x: b.cx + (rnd() - 0.5) * 6, z: b.cz, yaw: 0 }); spawns.push({ kind: 'trash', x: b.cx, z: b.cz + 6 }); }
  }
  function shopBlock(b) {
    const W = b.x1 - b.x0, Dd = b.z1 - b.z0, dep = 14;
    // a ring of shop rows around a small service yard
    const segs = Math.max(2, Math.round(W / 15));
    for (let k = 0; k < segs; k++) { const w = W / segs - 0.6, x = b.x0 + (k + 0.5) * W / segs; bld(x, b.z0 + dep / 2, w, dep, 7 + rnd() * 9, rnd() < 0.75 ? 2 : 1); bld(x, b.z1 - dep / 2, w, dep, 7 + rnd() * 9, rnd() < 0.75 ? 2 : 1); }
    const inner = Dd - 2 * dep - 1; if (inner > 8) { bld(b.x0 + dep / 2, b.cz, dep, inner, 7 + rnd() * 6, 2); bld(b.x1 - dep / 2, b.cz, dep, inner, 7 + rnd() * 6, 1); }
    spawns.push({ kind: 'dumpster', x: b.cx - 3, z: b.cz, yaw: 0.1 }); spawns.push({ kind: 'trash', x: b.cx + 3, z: b.cz + 2 }); spawns.push({ kind: 'barrel', x: b.cx + 4, z: b.cz - 3 });
  }
  function park(b) {
    for (let k = 0; k < 14; k++) { const x = b.x0 + 3 + rnd() * (b.x1 - b.x0 - 6), z = b.z0 + 3 + rnd() * (b.z1 - b.z0 - 6); if (Math.abs(x - b.cx) < 3 || Math.abs(z - b.cz) < 3 || Math.abs(Math.hypot(x - b.cx, z - b.cz) - 12) < 3) continue; D.add(rnd() < 0.5 ? 'broadleaf' : 'broadleaf2', x, 0, z, rnd() * 6.28, { scale: 0.9 + rnd() * 0.5, collider: [0.8, 6, 0.8], kind: 'tree' }); }
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; D.add('bush', b.cx + Math.cos(a) * 15.5, 0, b.cz + Math.sin(a) * 15.5, a, { dist: 500 }); }
    for (const [dx, dz, yaw] of [[-12.5, 0, Math.PI / 2], [12.5, 0, -Math.PI / 2], [0, -12.5, 0], [0, 12.5, Math.PI]]) spawns.push({ kind: 'bench', x: b.cx + dx * 0.8, z: b.cz + dz * 0.8, yaw });
    spawns.push({ kind: 'trash', x: b.cx + 4, z: b.cz + 4 });
    D.add('fountain', b.cx, 0, b.cz, 0, { scale: 0.55, collider: [6.6, 2, 6.6], small: false, kind: 'fountain' });
  }
  function plaza(b) {
    D.add('fountain', b.cx, 0, b.cz, 0, { collider: [12.4, 2.6, 12.4], small: false, kind: 'fountain' });
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + 0.39; D.add('broadleaf2', b.cx + Math.cos(a) * 16, 0, b.cz + Math.sin(a) * 16, a, { scale: 0.9, collider: [0.8, 5, 0.8], kind: 'tree' }); spawns.push({ kind: 'bench', x: b.cx + Math.cos(a + 0.39) * 11, z: b.cz + Math.sin(a + 0.39) * 11, yaw: -a - 0.39 }); }
  }
  function parking(b) {
    const rows = Math.floor((b.z1 - b.z0) / 12); for (let r = 0; r < rows; r++) for (let x = b.x0 + 2; x < b.x1 - 2; x += 2.8) if (rnd() < 0.55) spawns.push({ kind: 'car', x: x + 1.4, z: b.z0 + r * 12 + 3.2, yaw: Math.PI / 2 * 0 + (r % 2 ? Math.PI : 0), color: pick([0xc0392b, 0x2f6fb0, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0xe67e22, 0x8e44ad]) });
    spawns.push({ kind: 'light', x: b.cx, z: b.cz });
  }
  function streetSide(v, w, vertical) {
    const [a0, a1] = vertical ? [C.ringZ[0], C.ringZ[1]] : [C.ringX[0], C.ringX[1]], cross = vertical ? zs : xs, crossW = vertical ? zw : xw;
    for (const s of [-1, 1]) {
      const off = v + s * (w / 2 + 2.2);                                          // sidewalk centre
      for (let t = a0 + 6; t < a1 - 6; t += 8) {
        let nearX = false; for (let k = 0; k < cross.length; k++) if (Math.abs(t - cross[k]) < crossW[k] / 2 + 7) nearX = true; if (nearX) continue;
        const x = vertical ? off : t, z = vertical ? t : off, step = Math.round((t - a0) / 8);
        if (step % 4 === 0) spawns.push({ kind: 'light', x: vertical ? v + s * (w / 2 + 0.9) : x, z: vertical ? z : v + s * (w / 2 + 0.9), yaw: vertical ? (s < 0 ? Math.PI / 2 : -Math.PI / 2) : (s < 0 ? 0 : Math.PI) });
        else if (step % 4 === 2) D.add('broadleaf2', vertical ? v + s * (w / 2 + 2.6) : x, 0, vertical ? z : v + s * (w / 2 + 2.6), rnd() * 6, { scale: 0.65 + rnd() * 0.2, collider: [0.6, 5, 0.6], kind: 'tree', dist: 800 });
        else if (step % 8 === 1 && rnd() < 0.7) spawns.push({ kind: rnd() < 0.5 ? 'bench' : 'trash', x: vertical ? v + s * (w / 2 + 3.1) : x, z: vertical ? z : v + s * (w / 2 + 3.1), yaw: vertical ? (s < 0 ? -Math.PI / 2 : Math.PI / 2) : (s < 0 ? Math.PI : 0) });
        else if (step % 8 === 5 && rnd() < 0.5) D.add('hydrant', vertical ? v + s * (w / 2 + 0.7) : x, 0, vertical ? z : v + s * (w / 2 + 0.7), 0, { dist: 300, shadow: false });
        // parked cars along the kerb of ordinary streets (not the avenues / ring highway)
        if (w <= 12 && step % 3 === 1 && rnd() < 0.45) spawns.push({ kind: 'car', x: vertical ? v + s * (w / 2 - 1.3) : x, z: vertical ? z : v + s * (w / 2 - 1.3), yaw: vertical ? (s < 0 ? Math.PI : 0) : (s < 0 ? -Math.PI / 2 : Math.PI / 2), color: pick([0xc0392b, 0x2f6fb0, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085]), parked: true });
      }
    }
  }
}
