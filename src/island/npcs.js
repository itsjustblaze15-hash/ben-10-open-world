// CIVILIANS: lightweight pedestrians that live only around the player (V29: a pool of 140 with per-region density: city high > beach > suburb > industrial > labs > forest > mountains / desert very low; spawned on walk paths 35-120 m away, removed past 150 m).
// They walk the city sidewalks (crossing at crosswalks), suburb sidewalks, the beach promenade and park paths, pause, and look around. Every attack / explosion / smash /
// boss nearby posts a DANGER event (world.danger); civilians inside its radius notice it, (some freeze for a beat,) then run away from it with their arms up, avoid the area,
// and walk back to the nearest path when things have been calm for a few seconds. They are never damaged (cartoon world) - aliens push them aside.
// Rendering: 7 instanced body parts (legs, torso, arms, head, hair) = 7 draw calls for the whole crowd, matrices updated per frame.
import * as THREE from 'three';
import { RAMP } from './terrain.js';
import { REGION_IDS } from './terrain_gen.js';

const SKIN = [0xf1c8a0, 0xd9a47a, 0xa8714a, 0x7a4e30, 0xf6d6b8], HAIR = [0x2a1d14, 0x5a3a20, 0xd8b25a, 0x8a3a1a, 0x1a1a1a, 0xb0b0b0];
const SHIRT = [0xe8483a, 0x3aa0e0, 0xf0c020, 0x50c060, 0xffffff, 0x8a4ad0, 0xff8fb1, 0x2f6f5a, 0xf28c28, 0x5a6aa8], PANTS = [0x2f3f6a, 0x3a3a3a, 0x7a6a4a, 0x5a7aa8, 0x2a2a2a, 0xc8b890];
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _s = new THREE.Matrix4(), _c = new THREE.Color(), _v = new THREE.Vector3();
const PARTS = [
  { name: 'legL', geo: () => box(0.17, 0.82, 0.19, -0.41), piv: [0.11, 0.84, 0], col: 'pants', swing: 1 },
  { name: 'legR', geo: () => box(0.17, 0.82, 0.19, -0.41), piv: [-0.11, 0.84, 0], col: 'pants', swing: -1 },
  { name: 'torso', geo: () => box(0.44, 0.62, 0.26, 0.31), piv: [0, 0.82, 0], col: 'shirt' },
  { name: 'armL', geo: () => box(0.12, 0.6, 0.13, -0.28), piv: [0.29, 1.4, 0], col: 'shirt', swing: -1, arm: 1 },
  { name: 'armR', geo: () => box(0.12, 0.6, 0.13, -0.28), piv: [-0.29, 1.4, 0], col: 'shirt', swing: 1, arm: -1 },
  { name: 'head', geo: () => { const g = new THREE.SphereGeometry(0.19, 12, 9); g.translate(0, 0.2, 0); return g; }, piv: [0, 1.46, 0], col: 'skin' },
  { name: 'hair', geo: () => { const g = new THREE.SphereGeometry(0.205, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55); g.translate(0, 0.24, -0.015); return g; }, piv: [0, 1.46, 0], col: 'hair' },
];
function box(w, h, d, cy) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, cy, 0); return g; }

/** population share by region of the PLAYER (x max): MAIN CITY high, beach medium-high, suburbs medium, industrial medium, labs low, forest low, mountains / desert very low */
const DENS = { city: 0.85, beach: 0.55, suburb: 0.4, industrial: 0.36, labs: 0.2, forest: 0.14, foothills: 0.07, mountains: 0.04, desert: 0.04 };
DENS.city = 1;
export class Civilians {
  constructor(game, island, max = 140) {
    this.T = island.T; this.frame = 0; this.g = game; this.world = game.world; this.max = max; this.list = []; this.t = 0; this.spawnT = 0; this.stats = { spawned: 0, fled: 0, despawned: 0, maxActive: 0 };
    this.world.dangers = []; this.world.danger = (x, z, r = 26, lvl = 1) => { const D = this.world.dangers; if (D.length > 40) D.shift(); D.push({ x, z, r, lvl, t: 0.6 }); };
    this.buildGraph(island); this.buildMeshes();
  }
  // ------------------------------------------------------------------------------------------------ walk graph
  buildGraph(island) {
    const nodes = this.nodes = [], add = (x, z, reg) => { nodes.push({ x, z, reg, nb: [] }); return nodes.length - 1; }, link = (a, b) => { if (a === b) return; nodes[a].nb.push(b); nodes[b].nb.push(a); };
    const C = island.city, xs = C.xs, zs = C.zs, xw = C.xw, zw = C.zw;
    // city: a loop of 4 corners around every block (sidewalk centre); crosswalk links between facing corners
    const corner = {};
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i] + xw[i] / 2 + 2.2, x1 = xs[i + 1] - xw[i + 1] / 2 - 2.2, z0 = zs[j] + zw[j] / 2 + 2.2, z1 = zs[j + 1] - zw[j + 1] / 2 - 2.2;
      const a = add(x0, z0, 'city'), b = add(x1, z0, 'city'), c = add(x1, z1, 'city'), d = add(x0, z1, 'city'); link(a, b); link(b, c); link(c, d); link(d, a);
      // mid-side nodes so walkers turn / pause along long blocks
      corner[i + ',' + j] = { a, b, c, d };
    }
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) { const K = corner[i + ',' + j], E = corner[(i + 1) + ',' + j], S = corner[i + ',' + (j + 1)]; if (E) { link(K.b, E.a); link(K.c, E.d); } if (S) { link(K.d, S.a); link(K.c, S.b); } }
    // roads outside the city: both sidewalks of suburb lanes, the promenade and the labs links
    for (const R of island.T.roads) {
      if (R.city || R.bridge || R.type === 'highway') continue;
      const P = R.pts, half = R.type === 'dirt' ? 0 : R.w / 2 + 1.5;      // dirt tracks: one centre line (hikers)
      for (const s of R.type === 'dirt' ? [1] : [-1, 1]) { let prev = -1; for (let i = 0; i < P.length; i += 3) { const p = P[i], x = p.x - p.dz * half * s, z = p.z + p.dx * half * s; const n = add(x, z, R.id.startsWith('s') ? 'suburb' : R.id === 'promenade' ? 'beach' : 'road'); if (prev >= 0) link(prev, n); prev = n; } }
    }
    this.addPlazas(island, add, link);
    for (const n of nodes) n.reg = this.regionAt(n.x, n.z);
    // spatial index
    this.ngrid = new Map(); nodes.forEach((n, i) => { const k = Math.floor(n.x / 50) * 4096 + Math.floor(n.z / 50); let a = this.ngrid.get(k); if (!a) this.ngrid.set(k, a = []); a.push(i); });
  }
  /** region id at a point (labs is carved out of the city polygon); 'sea' over water */
  regionAt(x, z) { const T = this.T, i = Math.round((x - T.x0) / T.cell), j = Math.round((z - T.z0) / T.cell); if (i < 0 || j < 0 || i >= T.nx || j >= T.nz) return 'sea'; const k = j * T.nx + i; if (T.DL[k] < 0) return 'sea'; if (Math.abs(x) < 52 && z > -68 && z < 54) return 'labs'; return REGION_IDS[T.RG[k]]; }
  /** plazas / promenades / yards / trailheads: small rings of walk nodes around points of interest, tied into the nearest road node; people linger there */
  addPlazas(island, add, link) {
    const nodes = this.nodes, W = this.world, T = W.terrain;
    const spots = [[160, 520, 16, 'beach'], [452, 582, 12, 'beach'], [160, 372, 14, 'beach'], [300, 382, 12, 'beach'], [-520, 440, 22, 'suburb'], [-470, 380, 10, 'suburb'], [-560, 400, 10, 'suburb'], [0, 62, 18, 'labs'], [-30, 20, 12, 'labs'], [470, -600, 26, 'industrial'], [300, -380, 20, 'industrial'], [180, -330, 18, 'industrial'], [400, -440, 16, 'industrial'], [-380, -690, 14, 'mountains'], [-640, -182, 14, 'forest'], [-600, 30, 12, 'forest'], [-540, 200, 12, 'forest'], [-712, -190, 14, 'forest']];
    for (const [cx, cz, r, kind] of spots) {
      const ring = []; for (let a = 0; a < 8; a++) { const x = cx + Math.cos(a / 8 * 6.283) * r, z = cz + Math.sin(a / 8 * 6.283) * r; const h = T.height(x, z); if (T.dl(x, z) < 3 || W.staticsIn(x - 0.6, z - 0.6, x + 0.6, z + 0.6).some(b => b.max.y > h + 0.5 && b.min.y < h + 1.8)) { ring.push(-1); continue; } const n = add(x, z, kind); nodes[n].poi = true; ring.push(n); }
      for (let a = 0; a < 8; a++) { const p = ring[a], q = ring[(a + 1) % 8]; if (p >= 0 && q >= 0) link(p, q); }
      let best = -1, bd = 70; for (const p of ring) { if (p < 0) continue; for (let i = 0; i < nodes.length - 8; i++) { const n = nodes[i]; if (n.poi) continue; const d = Math.hypot(n.x - nodes[p].x, n.z - nodes[p].z); if (d < bd) { bd = d; best = i; link(p, i); } } }
    }
  }
  nodesNear(x, z, r) { const out = [], i0 = Math.floor((x - r) / 50), i1 = Math.floor((x + r) / 50), j0 = Math.floor((z - r) / 50), j1 = Math.floor((z + r) / 50); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.ngrid.get(i * 4096 + j); if (a) out.push(...a); } return out; }
  nearestNode(x, z) { let best = -1, bd = 1e9; for (const i of this.nodesNear(x, z, 60)) { const n = this.nodes[i], d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = i; } } return best; }
  // ------------------------------------------------------------------------------------------------ meshes
  buildMeshes() {
    const mat = new THREE.MeshToonMaterial({ gradientMap: RAMP, color: 0xffffff }); this.meshes = PARTS.map(P => { const m = new THREE.InstancedMesh(P.geo(), mat, this.max); m.count = 0; m.castShadow = true; m.frustumCulled = false; this.g.scene.add(m); return m; });
  }
  // ------------------------------------------------------------------------------------------------ spawning
  spawnOne(px, pz, camDir) {
    const cand = this.nodesNear(px, pz, 120).filter(i => { const n = this.nodes[i], d = Math.hypot(n.x - px, n.z - pz); if (d < 35 || d > 120 || !n.nb.length) return false; const fx = (n.x - px) / d, fz = (n.z - pz) / d; return d > 70 || fx * camDir.x + fz * camDir.z < 0.2; });
    if (!cand.length) return null; let ni = -1, n = null;
    for (let k = 0; k < 6 && ni < 0; k++) { const q = cand[Math.floor(Math.random() * cand.length)], nn = this.nodes[q]; if (Math.random() < (DENS[nn.reg] || 0) / (DENS.city) + 0.02) { ni = q; n = nn; } }
    if (ni < 0 || this.nearDanger(n.x, n.z)) return null;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const c = { x: n.x + (Math.random() - 0.5), z: n.z + (Math.random() - 0.5), y: 0, yaw: Math.random() * 6.28, from: ni, to: pick(n.nb), state: 'walk', st: 0, speed: 0.95 + Math.random() * 0.75, phase: Math.random() * 6, wait: 0, reg: n.reg,
      cols: this.outfit(n.reg), scale: 0.9 + Math.random() * 0.2, flee: null, calm: 0, arms: 0, freeze: 0, id: this.stats.spawned };
    c.y = this.world.groundAt(c.x, c.z, 50, 60, 0.25); this.list.push(c); this.stats.spawned++;
    if (Math.random() < (n.reg === 'city' || n.reg === 'beach' ? 0.3 : n.reg === 'forest' || n.reg === 'suburb' ? 0.22 : 0.08)) {          // a small group (2-3) strolls together
      const m = 1 + (Math.random() < 0.4 ? 1 : 0); for (let k = 0; k < m && this.list.length < this.max; k++) { const f = Object.assign({}, c, { x: c.x + (Math.random() - 0.5) * 3, z: c.z + (Math.random() - 0.5) * 3, cols: this.outfit(n.reg), id: this.stats.spawned, leader: c, off: [(k ? 1 : -1) * (1 + Math.random() * 0.6), -(0.8 + Math.random() * 1.2)], speed: c.speed, scale: 0.88 + Math.random() * 0.22, phase: Math.random() * 6 }); f.y = c.y; this.list.push(f); this.stats.spawned++; }
    }
    return c;
  }
  /** clothing by place: hi-vis + hard hats in the port, white coats at the labs, beachwear, greens and browns for hikers, anything in town */
  outfit(reg) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)]; const o = { skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRT), pants: pick(PANTS) };
    if (reg === 'industrial') { o.shirt = pick([0xff8a1a, 0xf2d024, 0xff8a1a, 0x3a5a8a]); o.pants = pick([0x2a2f3a, 0x3a3a3a, 0x4a4030]); if (Math.random() < 0.7) o.hair = 0xf2d024; }
    else if (reg === 'labs') { o.shirt = pick([0xf4f4f4, 0xf4f4f4, 0xdfeaf2, 0x6ab0a0]); o.pants = pick([0x3a3a46, 0x2a2a2a, 0x8a8a96]); }
    else if (reg === 'beach') { o.shirt = pick([0xff6a8a, 0x2ec4d8, 0xffd23a, 0xffffff, 0xff8a3a, 0x7ad04a, 0xd04ac0]); o.pants = pick([0x2fa8d0, 0xe0c890, 0xff7a5a, 0xf4f4f4, 0x3ac08a]); }
    else if (reg === 'forest' || reg === 'mountains' || reg === 'foothills') { o.shirt = pick([0x2f6f3a, 0x8a5a2a, 0xc8602a, 0x3a5a8a, 0x6a7a3a]); o.pants = pick([0x4a4030, 0x5a5a3a, 0x3a3a3a]); }
    return o;
  }
  nearDanger(x, z) { for (const D of this.world.dangers) if (Math.hypot(D.x - x, D.z - z) < D.r) return D; return null; }
  // ------------------------------------------------------------------------------------------------ per frame
  update(dt) {
    this.t += dt; const P = this.g.player, W = this.world, px = P.pos.x, pz = P.pos.z;
    for (let i = W.dangers.length - 1; i >= 0; i--) { W.dangers[i].t -= dt; if (W.dangers[i].t <= 0) W.dangers.splice(i, 1); }
    // spawn / despawn
    this.spawnT -= dt; const cam = this.g.cam3, camDir = cam.getWorldDirection(_v);
    this.frame++; this.reg = this.regionAt(px, pz);
    if (this.spawnT <= 0) { this.spawnT = 0.3; const want = Math.min(this.max, this.densityAt(px, pz)); for (let k = 0; k < 4 && this.list.length < want; k++) this.spawnOne(px, pz, camDir); }
    for (let i = this.list.length - 1; i >= 0; i--) { const c = this.list[i]; if (Math.hypot(c.x - px, c.z - pz) > 150) { c.dead = true; this.list.splice(i, 1); this.stats.despawned++; } }
    this.stats.maxActive = Math.max(this.stats.maxActive, this.list.length);
    // bosses on the map frighten everybody around them (Kevin / Vilgax / Albedo), not only when they fight
    this.bossT = (this.bossT || 0) - dt; if (this.bossT <= 0) { this.bossT = 0.3; for (const b of this.g.bossList || []) if (b.present && !b.dead) { const bp = b.home || b.pos; if (bp) W.danger(bp.x, bp.z, 26, 2); } }
    // crowd separation grid (people do not walk through each other)
    const G = this.grid || (this.grid = new Map()); G.clear(); for (const c of this.list) { c.sx = 0; c.sz = 0; const k = Math.floor(c.x / 1.5) * 8192 + Math.floor(c.z / 1.5); let a = G.get(k); if (!a) G.set(k, a = []); a.push(c); }
    for (const c of this.list) { const i0 = Math.floor(c.x / 1.5), j0 = Math.floor(c.z / 1.5); for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const a = G.get(i * 8192 + j); if (!a) continue; for (const o of a) { if (o === c) continue; const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz); if (d < 0.75 && d > 1e-3) { const k = (0.75 - d) * 2.2; c.sx += dx / d * k; c.sz += dz / d * k; } else if (d <= 1e-3) { c.sx += Math.random() - 0.5; c.sz += Math.random() - 0.5; } } } }
    for (const c of this.list) { const far = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz) > 4900; if (far) { c.acc = (c.acc || 0) + dt; if ((this.frame + c.id) % 3) continue; this.step(c, c.acc, P); c.acc = 0; } else this.step(c, dt, P); }       // distant people are simulated every 3rd frame
    this.render();
  }
  densityAt(x, z) { const f = (DENS[this.reg] || 0); if (!f) return 0; let n = 0; for (const i of this.nodesNear(x, z, 110)) n++; return Math.min(this.max, Math.round(this.max * f), Math.round(n * 2)); }
  step(c, dt, P) {
    const W = this.world; c.st += dt;
    // danger check (4x / s)
    c.dc = (c.dc || 0) - dt; if (c.dc <= 0) { c.dc = 0.25; const D = this.nearDanger(c.x, c.z);
      if (D) { if (c.state !== 'flee') { c.state = 'flee'; c.freeze = Math.random() < 0.35 ? 0.25 + Math.random() * 0.5 : 0; this.stats.fled++; } c.flee = { x: D.x, z: D.z }; c.calm = 4 + Math.random() * 3; c.fleeT = 0; } }
    let vx = 0, vz = 0, sp = 0;
    if (c.state === 'flee') {
      c.calm -= dt; c.fleeT += dt; if (c.freeze > 0) { c.freeze -= dt; c.arms = Math.min(1, c.arms + dt * 6); }
      else { let dx = c.x - c.flee.x, dz = c.z - c.flee.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const wob = Math.sin(this.t * 1.3 + c.id) * 0.35; const cx = dx * Math.cos(wob) - dz * Math.sin(wob), cz = dx * Math.sin(wob) + dz * Math.cos(wob); sp = 4.6 + (c.id % 3) * 0.5; vx = cx * sp; vz = cz * sp; c.arms = Math.min(1, c.arms + dt * 4); }
      if (c.calm <= 0) { c.state = 'return'; c.to = this.nearestNode(c.x, c.z); c.from = c.to; }
    } else {
      c.arms = Math.max(0, c.arms - dt * 2);
      if (c.wait > 0) { c.wait -= dt; c.wi = (c.wi || 0) - dt; if (c.wi <= 0) { c.wi = 0.8 + Math.random() * 1.6; c.yaw += (Math.random() - 0.5) * 1.6; } }
      else if (c.leader && !c.leader.dead && c.leader.state === 'walk' && c.state === 'walk') { const L0 = c.leader, ty = Math.cos(L0.yaw), tx = Math.sin(L0.yaw); const gx = L0.x + (ty * c.off[0] + tx * c.off[1]), gz = L0.z + (-tx * c.off[0] + ty * c.off[1]); let dx = gx - c.x, dz = gz - c.z; const L = Math.hypot(dx, dz); sp = L < 0.25 ? 0 : Math.min(L0.speed * 1.5, L0.speed * (L0.wait > 0 ? 0 : 1) + L * 0.9); if (sp > 0) { vx = dx / L * sp; vz = dz / L * sp; } }
      else { if (c.leader) { c.leader = null; c.to = c.from = this.nearestNode(c.x, c.z); } const n = this.nodes[c.to]; if (!n) { c.wait = 1; } else { let dx = n.x - c.x, dz = n.z - c.z; const L = Math.hypot(dx, dz);
          if (L < 0.6) { const prev = c.from; c.from = c.to; const nb = n.nb.filter(k => k !== prev); c.to = (nb.length ? nb : n.nb)[Math.floor(Math.random() * (nb.length || n.nb.length))]; if (c.state === 'return') c.state = 'walk'; const edge = Math.hypot(n.x - this.nodes[prev].x, n.z - this.nodes[prev].z); if (n.poi) c.wait = 2 + Math.random() * 7; else if (edge > 7 && edge < 24 && n.reg === 'city') c.wait = 0.8 + Math.random() * 2.2; else if (Math.random() < 0.13) c.wait = 1 + Math.random() * 3; c.wi = Math.random() * 6; }
          else { sp = c.speed * (c.state === 'return' ? 1.3 : 1); vx = dx / L * sp; vz = dz / L * sp; } } }
    }
    // the player (any alien) walks through a crowd: people step aside
    const dpx = c.x - P.pos.x, dpz = c.z - P.pos.z, dpl = Math.hypot(dpx, dpz), pr = (P.rad || 0.5) + 0.45; if (dpl < pr + 0.5 && dpl > 1e-3) { const k = (pr + 0.5 - dpl) * 6; vx += dpx / dpl * k; vz += dpz / dpl * k; }
    if (P.colH > 8 && dpl < (P.rad || 1) * 3) { this.world.danger(P.pos.x, P.pos.z, 30, 1); }
    vx += c.sx || 0; vz += c.sz || 0;
    c.x += vx * dt; c.z += vz * dt;
    const o = { x: c.x, z: c.z }; W.resolveXZ(o, 0.3, c.y, 1.8, 0.45); if (Math.abs(o.x - c.x) + Math.abs(o.z - c.z) > 0.001 && c.state === 'flee') { c.flee.x += (Math.random() - 0.5) * 10; c.flee.z += (Math.random() - 0.5) * 10; } c.x = o.x; c.z = o.z;
    const L = this.g.lagoon; if (L && L.depthAt(c.x, c.z) > 0.4) L.pushShore(c, 0.4);
    c.y = W.groundAt(c.x, c.z, c.y + 0.5, 0.6, 0.2);
    const sp2 = Math.hypot(vx, vz); if (sp2 > 0.2) { const ty = Math.atan2(vx, vz); let d = ty - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); c.yaw += d * Math.min(1, dt * 8); }
    c.phase += sp2 * dt * 2.9; c.sp = sp2;
  }
  render() {
    const n = this.list.length;
    for (let pi = 0; pi < PARTS.length; pi++) {
      const Pt = PARTS[pi], m = this.meshes[pi]; m.count = n;
      for (let i = 0; i < n; i++) {
        const c = this.list[i], run = Math.min(1, c.sp / 4), amp = Math.min(1, c.sp / 1.2) * (0.5 + 0.4 * run), sw = Math.sin(c.phase) * amp * (Pt.swing || 0), bob = Math.abs(Math.sin(c.phase)) * 0.05 * amp;
        _m.makeRotationY(c.yaw).setPosition(c.x, c.y + bob, c.z); _s.makeScale(c.scale, c.scale, c.scale); _m.multiply(_s);
        _t.makeTranslation(Pt.piv[0], Pt.piv[1], Pt.piv[2]); _m.multiply(_t);
        if (Pt.arm) { const up = c.arms; _r.makeRotationX(sw * (1 - up) - up * 2.6 + (up ? Math.sin(this.t * 14 + c.id) * 0.3 : 0)); _m.multiply(_r); _r.makeRotationZ(Pt.arm * (0.08 + up * 0.25)); _m.multiply(_r); }
        else if (Pt.swing) { _r.makeRotationX(sw); _m.multiply(_r); }
        else if (Pt.name === 'torso') { _r.makeRotationX(run * 0.18); _m.multiply(_r); }
        m.setMatrixAt(i, _m); m.setColorAt(i, _c.set(c.cols[Pt.col]));
      }
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  clear() { this.list.length = 0; this.render(); }
}
