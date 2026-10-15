// INDUSTRIAL PORT (north-east): warehouses + a factory with chimneys, a container yard (movable containers = Four Arms' heavy ammo, static stacks behind),
// a concrete quay with gantry cranes and a docked cargo ship (deep water alongside for Ripjaws), storage tanks, pipe racks, trucks, forklifts, crates, barrels and fences.
import * as THREE from 'three';
import { makeNoise, SEA } from './layout.js';
import { REGION_IDS } from './terrain_gen.js';

const WARE = [0x9fb2c2, 0xc28a6a, 0x8fc0b4, 0xd6c8a8, 0xb0b6be, 0x7f9fc0, 0xd0a060];
const CONT = [0xd8452a, 0x2f8ad0, 0x2faf5a, 0xe0b11c, 0x8a4ad0, 0xe07a2a, 0x3a5a8a];

export function buildIndustrial(world, B, D, T) {
  const N = makeNoise(5151), rnd = N.rnd, TR = world.terrain, spawns = [], placed = [];
  const at = (x, z) => { const i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); return j * T.nx + i; };
  const reg = (x, z) => REGION_IDS[T.RG[at(x, z)]];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const clear = (x0, x1, z0, z1, shore = 8) => { for (const r of placed) if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return false; for (let x = x0; x <= x1; x += 6) for (let z = z0; z <= z1; z += 6) { const k = at(x, z); if (T.DL[k] < shore || T.RM[k] > 0.04 || reg(x, z) !== 'industrial') return false; } return true; };
  // ---- quay along the north shore (x 250..470): find the shoreline per column, build a solid concrete pier edge out over deep water
  let quayZ = -1e9; for (let x = 250; x <= 470; x += 10) { for (let z = -600; z > -800; z -= 2) { if (T.DL[at(x, z)] < 0) { quayZ = Math.max(quayZ, z); break; } } }
  const qz1 = quayZ + 4, qz0 = quayZ - 16; B.add(360, -7, (qz0 + qz1) / 2, 230, 7.4, qz1 - qz0, { style: 6, color: 0xc4c0b8, kind: 'quay', name: 'QUAY' });
  placed.push({ x0: 240, x1: 480, z0: qz0, z1: qz1 + 12 });
  for (const x of [300, 380, 450]) { D.add('crane', x, 0.4, qz0 + 9, 0, { dist: 2400 }); for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) world.addStatic(new THREE.Vector3(x + dx - 0.6, 0, qz0 + 9 + dz - 0.6), new THREE.Vector3(x + dx + 0.6, 30, qz0 + 9 + dz + 0.6), { kind: 'crane', small: true }); }
  { const sx = 370, sz = qz0 - 13; D.add('ship', sx, SEA - 2.5, sz, Math.PI / 2, { dist: 2400 }); world.addStatic(new THREE.Vector3(sx - 47, SEA - 3, sz - 9), new THREE.Vector3(sx + 47, SEA + 5.6, sz + 9), { kind: 'ship', name: 'CARGO SHIP' }); world.addStatic(new THREE.Vector3(sx - 42, SEA + 5.6, sz - 7), new THREE.Vector3(sx - 30, SEA + 15, sz + 7), { kind: 'ship' }); }
  // ---- container yard behind the quay: static stacks (2-4 high) + loose movable containers in front
  for (let row = 0; row < 3; row++) for (let k = 0; k < 9; k++) {
    const x = 266 + k * 21, z = qz1 + 18 + row * 11; if (!clear(x - 4, x + 4, z - 3.5, z + 3.5, 4)) continue; const hN = 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < hN; s++) D.add('slab', x, s * 2.6, z, 0, { sx: 6.1, sy: 2.6, sz: 2.5, tint: pick(CONT), dist: 1500 });
    world.addStatic(new THREE.Vector3(x - 3.05, 0, z - 1.25), new THREE.Vector3(x + 3.05, hN * 2.6, z + 1.25), { kind: 'container stack' });
  }
  for (let k = 0; k < 10; k++) spawns.push({ kind: 'container', x: 280 + k * 18, z: qz1 + 54 + (k % 2) * 6, yaw: Math.PI / 2 * (k % 3 === 0 ? 1 : 0), color: pick(CONT) });
  placed.push({ x0: 255, x1: 470, z0: qz1, z1: qz1 + 64 });
  // ---- warehouses on a loose lattice (off the roads)
  for (let z = -660; z < -270; z += 48) for (let x = 150; x < 660; x += 58) {
    const w = 30 + rnd() * 18, d = 22 + rnd() * 10, cx = x + rnd() * 6, cz = z + rnd() * 6; if (!clear(cx - w / 2 - 3, cx + w / 2 + 3, cz - d / 2 - 3, cz + d / 2 + 3)) continue;
    placed.push({ x0: cx - w / 2 - 3, x1: cx + w / 2 + 3, z0: cz - d / 2 - 3, z1: cz + d / 2 + 3 });
    B.add(cx, 0, cz, w, 9 + rnd() * 6, d, { style: 3, color: pick(WARE), ws: 4, yaw: rnd() < 0.5 ? 0 : Math.PI, kind: 'warehouse' });
    const side = rnd() < 0.5 ? -1 : 1; if (rnd() < 0.6) spawns.push({ kind: 'truck', x: cx + side * (w / 2 - 6), z: cz + d / 2 + 6, yaw: 0, color: pick([0xd9d6cf, 0xc0392b, 0x2f6fb0]) });
    if (rnd() < 0.5) spawns.push({ kind: 'forklift', x: cx - side * 6, z: cz + d / 2 + 5, yaw: Math.PI });
    for (let k = 0; k < 3; k++) if (rnd() < 0.6) spawns.push({ kind: rnd() < 0.5 ? 'crate' : 'barrel', x: cx + (rnd() - 0.5) * w * 0.8, z: cz + d / 2 + 3 + rnd() * 2 });
  }
  // ---- factory + chimneys, storage tanks, pipe racks
  { const x = 230, z = -470; if (clear(x - 26, x + 26, z - 18, z + 18, 4) || true) { B.add(x, 0, z, 44, 16, 28, { style: 3, color: 0xb0b6be, kind: 'factory', name: 'FACTORY' }); for (const dx of [-12, 0, 12]) { B.add(x + dx, 16, z - 6, 3.2, 22, 3.2, { style: 6, color: 0xb8473a, kind: 'chimney' }); } placed.push({ x0: x - 26, x1: x + 26, z0: z - 18, z1: z + 18 }); } }
  for (const [x, z] of [[580, -520], [604, -490], [575, -462]]) { if (reg(x, z) !== 'industrial' || T.DL[at(x, z)] < 10) continue; D.add('tank', x, 0, z, 0, { collider: [14, 14, 14], small: false, kind: 'tank', dist: 1800 }); }
  for (const [x, z, yaw] of [[540, -560, 0], [520, -430, Math.PI / 2], [200, -560, 0]]) D.add('pipeRack', x, 0, z, yaw, { collider: [yaw ? 1.4 : 19, 5.8, yaw ? 19 : 1.4], kind: 'pipes', dist: 1000 });
  // ---- perimeter fencing along the port road + street lights
  const port = T.roads.find(r => r.id === 'port'); if (port) for (let i = 10; i < port.pts.length; i += 9) { const p = port.pts[i]; spawns.push({ kind: 'light', x: p.x - p.dz * 11, z: p.z + p.dx * 11, yaw: Math.atan2(p.dz, -p.dx) }); }
  for (let k = 0; k < 12; k++) spawns.push({ kind: 'fence', x: 470 + k * 3.1, z: -300, yaw: 0 });
  return { spawns, quayZ };
}
