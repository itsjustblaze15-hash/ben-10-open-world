// BEACH + COAST (south): a promenade with beach shops, sand with umbrellas / loungers / lifeguard towers, a wooden pier out over the water with a Ferris wheel at its end,
// and the striped lighthouse on its rocky cape. OMNITRIX LABS: the main research building (with dome + dish) and a glass research tower beside the old test yard.
import * as THREE from 'three';
import { makeNoise, POI, SEA } from './layout.js';
import { REGION_IDS } from './terrain_gen.js';
import { toon } from './style.js';

export function buildBeach(world, B, D, T) {
  const N = makeNoise(7171), rnd = N.rnd, TR = world.terrain, spawns = [];
  const at = (x, z) => { const i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); return j * T.nx + i; };
  const reg = (x, z) => REGION_IDS[T.RG[at(x, z)]];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  // ---- shoreline per column (first water going south)
  const shore = (x) => { for (let z = 380; z < 760; z += 2) if (T.DL[at(x, z)] < 0) return z; return null; };
  // ---- shops along the promenade (north side)
  const prom = T.roads.find(r => r.id === 'promenade');
  if (prom) for (let i = 8; i < prom.pts.length - 6; i += 7) { const p = prom.pts[i]; const nx = p.dz, nz = -p.dx; const cx = p.x + nx * (prom.w / 2 + 11), cz = p.z + nz * (prom.w / 2 + 11);
    if (reg(cx, cz) !== 'beach' || T.RM[at(cx, cz)] > 0.9 || T.DL[at(cx, cz)] < 6) continue; const y = TR.height(cx, cz) - 0.2;
    B.add(cx, y, cz, 13, 5 + rnd() * 3, 10, { style: 2, color: pick([0xf7d6a0, 0x9fe0d0, 0xf2b8b0, 0xf6eac8, 0xb8d8f0]), fh: 4.0, yaw: Math.PI, kind: 'shop' });
    spawns.push({ kind: 'light', x: p.x - nx * (prom.w / 2 - 0.8), z: p.z - nz * (prom.w / 2 - 0.8), yaw: 0 }); if (rnd() < 0.5) spawns.push({ kind: 'bench', x: p.x - nx * (prom.w / 2 + 1.5), z: p.z - nz * (prom.w / 2 + 1.5), yaw: Math.PI }); }
  // ---- sand: umbrellas + loungers, lifeguard towers, a few balls of trash bins
  let towerK = 0;
  for (let x = -20; x < 440; x += 9) { const sz = shore(x); if (sz === null) continue; for (let z = sz - 60; z < sz - 6; z += 9) { if (reg(x, z) !== 'beach' || T.RM[at(x, z)] > 0.02 || T.DL[at(x, z)] < 5) continue; const y = TR.height(x, z), u = rnd();
      if (u < 0.12) { D.add('umbrella', x, y, z, rnd() * 6, { tint: pick([0xffffff, 0xffe066, 0x66ccff, 0xff8fb1]), dist: 700, collider: [0.3, 2.4, 0.3], kind: 'umbrella' }); D.add('chair', x + 1.2, y, z + 0.6, 0.3, { tint: pick([0x3aa0e0, 0xe8483a, 0x50c060]), dist: 400, shadow: false }); D.add('chair', x - 1.1, y, z + 0.7, -0.2, { dist: 400, shadow: false }); } } }
  for (let x = 20; x < 420; x += 110) { const sz = shore(x); if (sz === null) continue; const z = sz - 22, y = TR.height(x, z); D.add('lifeguard', x, y, z, Math.PI, { collider: [3, 6, 3], small: false, kind: 'lifeguard tower', dist: 1200 }); towerK++; spawns.push({ kind: 'trash', x: x + 5, z: z - 4 }); }
  // ---- pier with a Ferris wheel at the end
  const pier = POI.find(p => p.id === 'pier'); { const x = pier.x, sz = shore(x) ?? 620, z0 = sz - 14, z1 = sz + 96, deck = 1.6, w = 9;
    pier.z = (z0 + z1) / 2; world.addStatic(new THREE.Vector3(x - w / 2, deck - 0.6, z0), new THREE.Vector3(x + w / 2, deck, z1), { kind: 'pier', name: 'PIER' });
    const wood = toon(0xb08454), dark = toon(0x6e5034); const deckM = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, z1 - z0), wood); deckM.position.set(x, deck - 0.3, (z0 + z1) / 2); deckM.receiveShadow = deckM.castShadow = true; world.scene.add(deckM);
    const pg = new THREE.CylinderGeometry(0.35, 0.35, 1, 8); for (let z = z0 + 4; z < z1; z += 8) for (const s of [-1, 1]) { const bed = TR.height(x + s * (w / 2 - 0.6), z), h = deck - bed; if (h < 0.3) continue; const c = new THREE.Mesh(pg, dark); c.scale.y = h; c.position.set(x + s * (w / 2 - 0.6), bed + h / 2, z); world.scene.add(c); }
    for (const s of [-1, 1]) { world.addStatic(new THREE.Vector3(x + s * w / 2 - 0.25, deck, z0), new THREE.Vector3(x + s * w / 2 + 0.25, deck + 1.0, z1), { kind: 'rail', small: true }); const r = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, z1 - z0), dark); r.position.set(x + s * w / 2, deck + 1.0, (z0 + z1) / 2); world.scene.add(r); }
    const fx = x, fz = z1 - 16; D.add('ferris', fx, deck, fz, Math.PI / 2, { dist: 2400 }); world.addStatic(new THREE.Vector3(fx - 3, deck, fz - 6), new THREE.Vector3(fx + 3, deck + 17, fz + 6), { kind: 'ferris wheel' });
    spawns.push({ kind: 'bench', x: x - 3, z: z0 + 30, yaw: Math.PI / 2, y: deck }, { kind: 'bench', x: x + 3, z: z0 + 50, yaw: -Math.PI / 2, y: deck }, { kind: 'trash', x: x + 3.4, z: z0 + 20, y: deck });
    pier.deck = { x0: x - w / 2, x1: x + w / 2, z0, z1, y: deck }; }
  // ---- lighthouse on the cape
  { const L = POI.find(p => p.id === 'lighthousePoi'); let bx = L.x, bz = L.z, best = -1; for (let k = 0; k < 40; k++) { const x = L.x + (rnd() - 0.5) * 60, z = L.z + (rnd() - 0.5) * 60, dl = T.DL[at(x, z)]; if (dl > 6 && dl < 30 && TR.height(x, z) > best) { best = TR.height(x, z); bx = x; bz = z; } }
    const y = TR.height(bx, bz) - 0.3; L.x = bx; L.z = bz; D.add('lighthouse', bx, y, bz, 0, { dist: 3000 }); world.addStatic(new THREE.Vector3(bx - 3, y, bz - 3), new THREE.Vector3(bx + 3, y + 25, bz + 3), { kind: 'lighthouse', name: 'LIGHTHOUSE' });
    for (let k = 0; k < 7; k++) D.add('rock', bx + (rnd() - 0.5) * 22, y - 0.5, bz + (rnd() - 0.5) * 22, rnd() * 6, { scale: 1.5 + rnd() * 2, collider: true, kind: 'rock', small: true }); }
  return { spawns };
}

export function buildLabs(world, B, D, T) {
  // main research building north of the yard, dome + dish on the roof; a glass research tower on the east side
  B.add(0, 0, -53, 84, 14, 20, { style: 5, color: 0xeef5f4, fh: 4.6, kind: 'lab', name: 'OMNITRIX LABS', yaw: Math.PI });
  D.add('dome', -18, 14, -53, 0, { scale: 0.62, dist: 2400 }); D.add('dish', 30, 14, -55, 0.6, { dist: 2400 });
  B.add(56, 0, -30, 16, 30, 16, { style: 5, color: 0xdde9ea, fh: 4.2, kind: 'lab', name: 'RESEARCH TOWER' });
  B.add(56, 30, -30, 10, 5, 10, { style: 6, color: 0x2fbf62, kind: 'lab' });
  for (const [x, z] of [[-50, 46], [50, 46], [-50, -40], [62, 10]]) D.add('broadleaf2', x, 0, z, 0, { scale: 1.1, collider: [0.8, 6, 0.8], kind: 'tree' });
  D.add('sign', -40, 0, 8, Math.PI / 2, { dist: 300 });
  return { spawns: [{ kind: 'light', x: -42, z: -2 }, { kind: 'light', x: 2, z: 42 }, { kind: 'light', x: 42, z: 6 }] };
}
