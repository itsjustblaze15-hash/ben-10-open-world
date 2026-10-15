// SUBURB: houses along the curvy lanes (each faces its street, varied size / colour / roof, driveway, mailbox, yard tree, some fences and parked cars),
// round cul-de-sac ends, a neighbourhood park with a playground, a gas station and a small row of local shops.
import * as THREE from 'three';
import { makeNoise, POI } from './layout.js';
import { REGION_IDS } from './terrain_gen.js';

const WALL = [0xf3e3c3, 0xcfe3f0, 0xf2c9b6, 0xd7ead0, 0xf6f0e0, 0xe7d4ee, 0xf7dca0, 0xc8d8e8, 0xf0d0d8];
const ROOF = [0xb8473a, 0x5a6470, 0x7a4a32, 0x3f6a8a, 0x8a5a3a, 0x4a7a4a];

export function buildSuburb(world, B, D, T) {
  const N = makeNoise(3131), rnd = N.rnd, TR = world.terrain, spawns = [], placed = [];
  const at = (x, z) => { const i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); return j * T.nx + i; };
  const reg = (x, z) => REGION_IDS[T.RG[at(x, z)]];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const free = (x0, x1, z0, z1) => { for (const r of placed) if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return false; return true; };
  const roads = T.roads.filter(r => r.id.startsWith('s') || r.id === 'west' || r.id === 'bridgeW' || r.id === 'bridgeE');
  for (const R of roads) {
    const P = R.pts, half = R.w / 2 + 2.2;
    for (let i = 3; i < P.length - 3; i += 5) {
      const p = P[i];
      for (const s of [-1, 1]) {
        if (rnd() < 0.12) continue;
        const nx = -p.dz * s, nz = p.dx * s;                                      // outward normal (toward the lot)
        const W = 10 + rnd() * 4, Dp = 9 + rnd() * 3, two = rnd() < 0.55, h = two ? 6.4 : 3.6, set = half + 7 + Dp / 2;
        const cx = p.x + nx * set, cz = p.z + nz * set;
        // face the street: snap the outward normal to an axis
        const ax = Math.abs(nx) > Math.abs(nz), yaw = ax ? (nx > 0 ? -Math.PI / 2 : Math.PI / 2) : (nz > 0 ? Math.PI : 0);
        const wx = ax ? Dp : W, wz = ax ? W : Dp;
        const x0 = cx - wx / 2 - 2, x1 = cx + wx / 2 + 2, z0 = cz - wz / 2 - 2, z1 = cz + wz / 2 + 2;
        if (reg(cx, cz) !== 'suburb' || !free(x0, x1, z0, z1)) continue;
        let bad = false, lo = 1e9, hi = -1e9; for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]]) { const k = at(qx, qz); if (T.DL[k] < 6 || T.RM[k] > 0.9) bad = true; const y = TR.height(qx, qz); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        if (bad || hi - lo > 2.4) continue;
        placed.push({ x0, x1, z0, z1 });
        const wall = pick(WALL), roofC = pick(ROOF), y0 = lo - 0.3;
        B.add(cx, y0, cz, wx, h + (hi - lo) + 0.3, wz, { style: 4, color: wall, fh: 3.1, ws: 3.2, yaw, kind: 'house' });
        D.add('roof', cx, y0 + h + (hi - lo) + 0.3, cz, ax ? Math.PI / 2 : 0, { sx: ax ? wz : wx, sy: 2.6 + rnd() * 1.2, sz: ax ? wx : wz, tint: roofC, dist: 1100 });
        // garage on one side + driveway + mailbox + car / tree / fence
        const tx = ax ? 0 : 1, tz = ax ? 1 : 0, side = rnd() < 0.5 ? -1 : 1, gx = cx + tx * side * (W / 2 + 3), gz = cz + tz * side * (W / 2 + 3);
        if (rnd() < 0.6 && free(gx - 3.5, gx + 3.5, gz - 3.5, gz + 3.5)) { B.add(gx, y0, gz, ax ? Dp * 0.8 : 6, 3.2 + (hi - lo), ax ? 6 : Dp * 0.8, { style: 6, color: wall, kind: 'house' }); placed.push({ x0: gx - 3.5, x1: gx + 3.5, z0: gz - 3.5, z1: gz + 3.5 }); }
        const dx = cx + tx * side * (W / 2 + 3) + nx * 0, dz = cz + tz * side * (W / 2 + 3);
        const drX = (dx + (p.x + nx * (half + 0.5) + tx * side * (W / 2 + 3))) / 2, drZ = (dz + (p.z + nz * (half + 0.5) + tz * side * (W / 2 + 3))) / 2, drL = set - Dp / 2 - half + 2;
        D.add('slab', p.x + nx * (half + drL / 2) + tx * side * (W / 2 + 3), TR.height(drX, drZ) - 0.04, p.z + nz * (half + drL / 2) + tz * side * (W / 2 + 3), 0, { sx: ax ? drL : 3.4, sy: 0.12, sz: ax ? 3.4 : drL, tint: 0xb9b6b0, dist: 500, shadow: false });
        D.add('mailbox', p.x + nx * (half + 0.6) - tx * side * 2, TR.height(p.x + nx * (half + 0.6), p.z + nz * (half + 0.6)), p.z + nz * (half + 0.6) - tz * side * 2, yaw, { dist: 260, shadow: false });
        if (rnd() < 0.45) spawns.push({ kind: 'car', x: p.x + nx * (half + 3.5) + tx * side * (W / 2 + 3), z: p.z + nz * (half + 3.5) + tz * side * (W / 2 + 3), yaw: ax ? Math.PI / 2 : 0, color: pick([0xc0392b, 0x2f6fb0, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x95a5a6]), parked: true });
        if (rnd() < 0.7) { const qx = cx - tx * side * (W / 2 + 4) + nx * 2, qz = cz - tz * side * (W / 2 + 4) + nz * 2; D.add(rnd() < 0.6 ? 'broadleaf2' : 'broadleaf', qx, TR.height(qx, qz) - 0.1, qz, rnd() * 6, { scale: 0.8 + rnd() * 0.4, collider: [0.8, 6, 0.8], kind: 'tree', dist: 1000 }); }
        if (rnd() < 0.35) { const fx = cx - nx * (Dp / 2 + 3), fz = cz - nz * (Dp / 2 + 3); for (let k = -1; k <= 1; k++) spawns.push({ kind: 'fence', x: fx + tx * k * 3, z: fz + tz * k * 3, yaw: ax ? Math.PI / 2 : 0 }); }
        if (rnd() < 0.25) spawns.push({ kind: 'trash', x: p.x + nx * (half + 1.2) + tx * side * 3.5, z: p.z + nz * (half + 1.2) + tz * side * 3.5 });
        if (i % 15 === 0) spawns.push({ kind: 'light', x: p.x + nx * (half - 0.8), z: p.z + nz * (half - 0.8), yaw: Math.atan2(-nx, -nz) });
      }
    }
    if (R.cul) { const e = P[P.length - 1]; D.add('disc', e.x, TR.height(e.x, e.z) + 0.02, e.z, 0, { sx: 11, sy: 0.08, sz: 11, tint: 0x5a5c62, dist: 600, shadow: false }); D.add('bush', e.x, TR.height(e.x, e.z), e.z, 0, { scale: 1.4, dist: 400 }); }
  }
  // ---- neighbourhood park + playground
  { const p = POI.find(q => q.id === 'suburbPark'), y = TR.height(p.x, p.z);
    D.add('swing', p.x - 6, y, p.z, 0, { collider: [3.6, 2.6, 2], kind: 'playground' }); D.add('slide', p.x + 6, y, p.z + 2, 0.4, { collider: [1.6, 2.4, 4.4], kind: 'playground' });
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, r = 16 + rnd() * 8, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (T.RM[at(x, z)] > 0.5) continue; D.add('broadleaf', x, TR.height(x, z) - 0.1, z, a, { scale: 1 + rnd() * 0.4, collider: [0.8, 6, 0.8], kind: 'tree' }); }
    spawns.push({ kind: 'bench', x: p.x, z: p.z - 8, yaw: 0 }, { kind: 'bench', x: p.x + 9, z: p.z - 6, yaw: -0.6 }, { kind: 'trash', x: p.x - 3, z: p.z - 8 }); }
  // ---- gas station + a row of local shops near the west bridge
  { const x = -470, z = 336, y = TR.height(x, z); D.add('pumps', x, y, z, 0, { collider: [14, 5.6, 8], small: false, kind: 'gas station' }); B.add(x, y, z - 14, 16, 4.2, 9, { style: 2, color: 0xf2f2f2, fh: 4.2, kind: 'shop', name: 'GAS STATION' });
    spawns.push({ kind: 'car', x: x - 3, z: z + 1, yaw: 0, color: 0x2f6fb0 }, { kind: 'barrel', x: x + 9, z: z - 12 }); }
  { const z = 352, y = TR.height(-600, z); for (let k = 0; k < 4; k++) B.add(-640 + k * 13, y - 0.2, z - 16, 12, 5 + (k % 2) * 1.5, 11, { style: 2, color: pick(WALL), fh: 4.0, kind: 'shop' }); }
  return { spawns, placed };
}
