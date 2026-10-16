// TRAFFIC: a handful of cars (pool ~16) that live around the player on the city street grid. Right-hand lanes, turns at intersections, traffic lights
// (north-south / east-west phases, all-red gap), keeping distance to the car ahead, braking for pedestrians / aliens / bosses / props in the lane.
// A car that ends up next to an alien, a boss or a fight STOPS and becomes an ordinary physical prop (so Four Arms can lift it, Upgrade can take it over,
// blasts throw it, Vilgax can wreck it). The street-light state can be overridden from the city traffic terminal (Upgrade).
import * as THREE from 'three';
import { CITY } from './layout.js';

const COLORS = [0xc0392b, 0x2f6fb0, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e, 0xe67e22, 0x8e44ad, 0x16a085];
export class Traffic {
  constructor(game, island, max = 30) {
    this.g = game; this.max = max; this.cars = []; this.t = 0; this.spawnT = 0; this.mode = 'normal'; this.stats = { spawned: 0, converted: 0, stops: 0, maxActive: 0 };
    const C = CITY, xs = island.city.xs, zs = island.city.zs, xw = island.city.xw, zw = island.city.zw; this.xs = xs; this.zs = zs;
    this.nodes = []; const id = (i, j) => j * xs.length + i;
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) { const nb = []; if (i > 0) nb.push(id(i - 1, j)); if (i < xs.length - 1) nb.push(id(i + 1, j)); if (j > 0) nb.push(id(i, j - 1)); if (j < zs.length - 1) nb.push(id(i, j + 1));
      this.nodes.push({ x: xs[i], z: zs[j], i, j, nb, light: i > 0 && i < xs.length - 1 && j > 0 && j < zs.length - 1, off: Math.random() * 20, wx: xw[i], wz: zw[j] }); }
    this.geo = {}; this.lights = this.buildLights();
  }
  laneOff(n, alongX) { const w = alongX ? n.wz : n.wx; return w >= 16 ? 4.6 : 2.9; }
  /** light colour for a car arriving at node n travelling along X (true) or Z: 'g' | 'y' | 'r' */
  signal(n, alongX) {
    if (!n.light) return 'g'; if (this.mode === 'allred') return 'r'; if (this.mode === 'green') return 'g';
    const T = 22, u = (this.t + n.off) % T, ns = u < 9 ? 'g' : u < 11 ? 'y' : 'r', ew = u >= 11 && u < 20 ? 'g' : u >= 20 ? 'y' : 'r';
    return alongX ? ew : ns;
  }
  carGeo(color) { if (!this.geo[color]) this.geo[color] = this.g.props.templateGeo('car', color); return this.geo[color]; }
  spawn(px, pz) {
    const cand = []; this.nodes.forEach((n, k) => { const d = Math.hypot(n.x - px, n.z - pz); if (d > 50 && d < 200) cand.push(k); }); if (!cand.length) return;
    const a = cand[Math.floor(Math.random() * cand.length)], na = this.nodes[a], b = na.nb[Math.floor(Math.random() * na.nb.length)], nb = this.nodes[b];
    const L = Math.hypot(nb.x - na.x, nb.z - na.z), s = 8 + Math.random() * Math.max(1, L - 30);
    for (const c of this.cars) if (c.a === a && c.b === b && Math.abs(c.s - s) < 10) return;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)], geo = this.carGeo(color); if (!geo) return;
    const mesh = new THREE.Mesh(geo, this.g.props.carMaterial()); mesh.castShadow = true; this.g.scene.add(mesh);
    const car = { a, b, s, L, speed: 6, vmax: 10 + Math.random() * 4, color, mesh, pos: new THREE.Vector3(), yaw: 0, hold: 0, honk: 0 }; this.place(car, 1, true); this.cars.push(car); this.stats.spawned++;
  }
  target(car, out) {
    const na = this.nodes[car.a], nb = this.nodes[car.b], dx = nb.x - na.x, dz = nb.z - na.z, L = car.L, ux = dx / L, uz = dz / L, alongX = Math.abs(ux) > 0.5, off = this.laneOff(nb, alongX);
    return out.set(na.x + ux * car.s - uz * off, 0, na.z + uz * car.s + ux * off);
  }
  place(car, dt, snap = false) {
    const t = this.target(car, new THREE.Vector3()); if (snap) car.pos.copy(t); else { const k = 1 - Math.exp(-6 * dt); car.pos.x += (t.x - car.pos.x) * k; car.pos.z += (t.z - car.pos.z) * k; }
    const na = this.nodes[car.a], nb = this.nodes[car.b], want = Math.atan2(nb.x - na.x, nb.z - na.z); let d = want - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); car.yaw = snap ? want : car.yaw + d * Math.min(1, dt * 5);
    car.pos.y = this.g.world.terrain ? Math.max(0, this.g.world.terrain.height(car.pos.x, car.pos.z)) : 0;
    car.mesh.position.set(car.pos.x, car.pos.y, car.pos.z); car.mesh.rotation.y = car.yaw;
  }
  /** something in the lane ahead (player, civilians, bosses, resting props)? -> distance or Infinity */
  obstacle(car) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), look = 7 + car.speed * 0.9, g = this.g; let best = Infinity;
    const test = (x, z, r) => { const dx = x - car.pos.x, dz = z - car.pos.z, f = dx * fx + dz * fz; if (f < 1 || f > look) return; const side = Math.abs(dx * fz - dz * fx); if (side < r + 1.3) best = Math.min(best, f); };
    test(g.player.pos.x, g.player.pos.z, g.player.rad || 0.6);
    if (g.civ) for (const c of g.civ.list) test(c.x, c.z, 0.4);
    for (const b of g.bossList || []) if (b.present && !b.dead) { const p = b.home || b.pos; test(p.x, p.z, 2); }
    for (const o of this.cars) if (o !== car) test(o.pos.x, o.pos.z, 1.2);
    for (const p of g.props.props) if (!p.dead && !p.held) { const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z; if (dx * dx + dz * dz < 400) test(p.pos.x, p.pos.z, Math.max(p.half.x, p.half.z)); }
    return best;
  }
  convert(car) {
    const P = this.g.props, p = P.add('car', car.pos.x, car.pos.z, { yaw: car.yaw, color: car.color, y: car.pos.y }); p.temp = true; p.life = 240; p.vel.set(Math.sin(car.yaw) * car.speed * 0.3, 0, Math.cos(car.yaw) * car.speed * 0.3); if (car.speed > 0.5) { P.removeBox(p); p.state = 'slide'; }
    if (this.g.tech) this.g.tech.addProp(p, 'vehicle', 'CAR'); this.stats.converted++; this.remove(car); return p;
  }
  remove(car) { this.g.scene.remove(car.mesh); const i = this.cars.indexOf(car); if (i >= 0) this.cars.splice(i, 1); }
  update(dt) {
    this.t += dt; const g = this.g, P = g.player, px = P.pos.x, pz = P.pos.z;
    const inCity = px > CITY.ringX[0] - 120 && px < CITY.ringX[1] + 120 && pz > CITY.ringZ[0] - 120 && pz < CITY.ringZ[1] + 120;
    this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = 0.3; if (inCity && this.cars.length < this.max) this.spawn(px, pz); }
    for (const c of this.cars.slice()) {
      if (Math.hypot(c.pos.x - px, c.pos.z - pz) > 240) { this.remove(c); continue; }
      // trouble nearby: stop and become a physical prop
      const dP = Math.hypot(c.pos.x - px, c.pos.z - pz);
      let trouble = dP < (P.rad || 0.6) + 4.5 && (g.chars.id !== 'ben' || dP < 3.2);
      for (const D of g.world.dangers || []) if (D.lvl >= 1 && Math.hypot(D.x - c.pos.x, D.z - c.pos.z) < Math.min(14, D.r * 0.5)) trouble = true;
      for (const b of g.bossList || []) if (b.present && !b.dead) { const bp = b.home || b.pos; if (bp && Math.hypot(bp.x - c.pos.x, bp.z - c.pos.z) < 12) trouble = true; }
      if (trouble) { this.convert(c); continue; }
      // drive
      const nb = this.nodes[c.b], na = this.nodes[c.a], alongX = Math.abs(nb.x - na.x) > 1; let want = c.vmax;
      const sig = this.signal(nb, alongX), toNode = c.L - c.s, stopAt = (alongX ? nb.wx : nb.wz) / 2 + 5.5;
      if (sig !== 'g' && toNode > stopAt - 1 && toNode < stopAt + 30) { want = Math.min(want, Math.max(0, (toNode - stopAt) * 0.9)); if (toNode - stopAt < 1.5) want = 0; }
      const ob = this.obstacle(c); if (ob < Infinity) { want = Math.min(want, Math.max(0, (ob - 5) * 1.2)); if (ob < 6 && c.honk <= 0) { c.honk = 4; this.stats.stops++; } }
      c.honk -= dt; c.speed += Math.max(-9 * dt, Math.min(3.5 * dt, want - c.speed)); c.s += c.speed * dt;
      if (c.s >= c.L) { const prev = c.a; c.a = c.b; const nn = this.nodes[c.a].nb.filter(k => k !== prev); c.b = (nn.length ? nn : this.nodes[c.a].nb)[Math.floor(Math.random() * (nn.length || 1))]; c.s = 0; c.L = Math.hypot(this.nodes[c.b].x - this.nodes[c.a].x, this.nodes[c.b].z - this.nodes[c.a].z); }
      this.place(c, dt);
    }
    this.stats.maxActive = Math.max(this.stats.maxActive, this.cars.length);
    this.updateLights();
  }
  // ------------------------------------------------------------------------------------------------ visible signal heads (small emissive cubes on the traffic-light poles)
  buildLights() {
    const geo = new THREE.BoxGeometry(0.34, 0.34, 0.1), mat = new THREE.MeshBasicMaterial({ color: 0xffffff }), list = [];
    for (const n of this.nodes) if (n.light) for (const s of [-1, 1]) list.push({ n, x: n.x + s * ((n.wx / 2) + 1.8) + s * 3.3 * -1 * 0 , z: n.z + s * ((n.wz / 2) + 1.8), s });
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.frustumCulled = false; this.g.scene.add(im); const m = new THREE.Matrix4();
    list.forEach((L, i) => { m.makeRotationY(L.s < 0 ? 0 : Math.PI).setPosition(L.x + (L.s < 0 ? 3.3 : -3.3), 4.6, L.z + (L.s < 0 ? 0.32 : -0.32)); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(0x00ff40)); });
    return { im, list };
  }
  updateLights() { const { im, list } = this.lights, c = new THREE.Color(); list.forEach((L, i) => { const s = this.signal(L.n, false); im.setColorAt(i, c.set(s === 'g' ? 0x2bff5a : s === 'y' ? 0xffd21e : 0xff3a2a)); }); if (im.instanceColor) im.instanceColor.needsUpdate = true; }
}
