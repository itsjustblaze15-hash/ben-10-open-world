// Stinkfly's sticky slime: the part that stays behind after a blob lands.
//  - STATUS on living targets (dummies, guards, turrets, divers): every hit adds slime. Little = SLOWED, more = RESTRICTED (barely moves, attacks delayed), a lot = TRAPPED (stuck, attacks interrupted).
//    The amount wears off with time (1 level per ~5 s), a trapped target is released after 3.4 s, and the gooey coat shrinks away as it dries. Nothing is frozen for good.
//    The enemies' own update code reads `slimeMul` (movement / cooldown rate) and `slimeStuck` - see Dummy.update, Guard.ai / step, Turret.update, Diver.update.
//  - COAT: green blobs on the target's own hit spheres (child of its body, so it tilts / falls with it), a struggle wobble while restricted, droplets falling off.
//  - DECALS: a pooled ring of splats that stick to whatever the blob hit (floor, walls, roofs, crates, cars). Splats on a prop ride with the prop; on walls they run down a little.
//    At most DECAL_MAX exist at once (the oldest is recycled), each lasts 16 s and shrinks away - no unlimited accumulation.
//  - PROPS: a slimed prop (crate, car, bench...) resists being shoved / slid for a while.
import * as THREE from 'three';
import { clamp, rand, damp } from './util.js';

export const SLIME = { slowAt: 0.4, restrictAt: 1.0, trapAt: 1.6, max: 3.4, trapT: 3.4, decay: 0.2, decalMax: 44, decalLife: 16 };
const DOWN = new THREE.Vector3(0, -1, 0), Z = new THREE.Vector3(0, 0, 1), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function splatTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 128);
  const blob = (cx, cy, r, n, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, rr = r * (0.72 + 0.28 * Math.sin(a * 3 + cx) * Math.cos(a * 5 + cy) + 0.12 * Math.sin(a * 9 + 2)); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); g.fill(); };
  blob(0, 0, 92, 40, '#3f9a0c'); blob(-4, -2, 80, 40, '#5cc512'); blob(-8, -8, 56, 32, '#7be31e');
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.4, d = 98 + (i % 3) * 8; g.fillStyle = '#4faa0e'; g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, 10 - (i % 3) * 2, 7, a, 0, 7); g.fill(); g.strokeStyle = '#4faa0e'; g.lineWidth = 7; g.beginPath(); g.moveTo(Math.cos(a) * 80, Math.sin(a) * 80); g.lineTo(Math.cos(a) * d, Math.sin(a) * d); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-26, -30, 17, 9, -0.6, 0, 7); g.fill(); g.beginPath(); g.ellipse(22, 14, 7, 4, -0.4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.ellipse(-36, 8, 6, 3, 0.2, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class SlimeSystem {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.map = new Map(); this.props = new Map(); this.t = 0;
    this.stats = { hits: 0, slowed: 0, restricted: 0, trapped: 0, decals: 0, recycled: 0, propsSlimed: 0, expired: 0 };
    // shared look: wet, viscous, green, a little self-lit so it reads in shade (no additive glow)
    this.coatMat = new THREE.MeshStandardMaterial({ color: 0x74dc1c, emissive: 0x1f6a06, emissiveIntensity: 0.55, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.86, envMapIntensity: 1.6 });
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.12 * Math.sin(v.x * 6 + v.y * 4) * Math.cos(v.z * 5 + v.y * 3) + 0.05 * Math.sin(v.y * 13); p.setXYZ(i, v.x * k, v.y * k * 0.98, v.z * k); } g.computeVertexNormals(); this.blobGeo = g;
    // decal pool
    this.decalMat = new THREE.MeshStandardMaterial({ map: splatTexture(), transparent: true, roughness: 0.18, metalness: 0, emissive: 0x1d5f06, emissiveIntensity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide, envMapIntensity: 1.4 });
    this.decalGeo = new THREE.PlaneGeometry(1, 1); this.decals = []; this.dn = 0;
    for (let i = 0; i < SLIME.decalMax; i++) { const m = new THREE.Mesh(this.decalGeo, this.decalMat); m.visible = false; m.receiveShadow = false; m.renderOrder = 2; m.userData = { on: false }; this.scene.add(m); this.decals.push(m); }
    this.dropT = 0;
  }

  // ------------------------------------------------------------------------------------------------ status on living targets
  /** a blob landed on `t` (amount of slime); returns the state it is in now */
  hit(t, amount = 0.6) {
    if (!t || t.dead) return null;
    let s = this.map.get(t);
    if (!s) { s = { t, amount: 0, trapT: 0, coat: null, label: '', wob: Math.random() * 6, drip: 0, fresh: 0 }; this.map.set(t, s); }
    const before = this.stateOf(s); s.amount = Math.min(SLIME.max, s.amount + amount); s.fresh = 0.25; this.stats.hits++;
    if (s.amount >= SLIME.trapAt && s.trapT <= 0) { s.trapT = SLIME.trapT; this.stats.trapped++; }
    const now = this.stateOf(s);
    if (now !== before) { if (now === 'SLOWED') this.stats.slowed++; else if (now === 'RESTRICTED') this.stats.restricted++; }
    // it interrupts what the target is doing: a guard in a wind-up loses it, a turret jams for a moment
    if (s.amount >= SLIME.restrictAt) { if (t.atk) t.atk = null; if (typeof t.cool === 'number') t.cool = Math.max(t.cool, 1.4); if (typeof t.fireCool === 'number') t.fireCool = Math.max(t.fireCool, 1.2); if (t.batCool !== undefined) t.batCool = Math.max(t.batCool, 0.8); }
    this.applyTo(s); this.ensureCoat(s); return now;
  }
  stateOf(s) { return s.trapT > 0 || s.amount >= SLIME.trapAt ? 'TRAPPED' : s.amount >= SLIME.restrictAt ? 'RESTRICTED' : s.amount >= SLIME.slowAt ? 'SLOWED' : 'COATED'; }
  state(t) { const s = this.map.get(t); return s ? this.stateOf(s) : null; }
  amountOf(t) { const s = this.map.get(t); return s ? s.amount : 0; }
  applyTo(s) {
    const t = s.t, st = this.stateOf(s);
    t.slimeMul = st === 'TRAPPED' ? 0 : st === 'RESTRICTED' ? 0.2 : st === 'SLOWED' ? 0.55 : 0.85; t.slimeStuck = st === 'TRAPPED'; t.slimeLevel = s.amount; t.slimeState = st;
  }
  clear(t) {
    const s = this.map.get(t); if (!s) { t.slimeMul = undefined; t.slimeStuck = false; t.slimeLevel = 0; t.slimeState = null; return; }
    if (s.coat) { s.coat.parent && s.coat.parent.remove(s.coat); s.coat = null; } this.map.delete(t); t.slimeMul = undefined; t.slimeStuck = false; t.slimeLevel = 0; t.slimeState = null;
  }
  ensureCoat(s) {
    if (s.coat || !s.t.spheres || !s.t.root) return;
    const grp = new THREE.Group(); grp.name = 'SlimeCoat'; const par = s.t.body || s.t.root;
    s.meshes = []; for (const sp of s.t.spheres) { const m = new THREE.Mesh(this.blobGeo, this.coatMat); m.position.copy(sp.local); m.userData.base = sp.r * 1.1; m.castShadow = false; m.renderOrder = 3; grp.add(m); s.meshes.push(m); }
    par.add(grp); s.coat = grp;
  }

  // ------------------------------------------------------------------------------------------------ decals
  /** a splat stuck to a surface. parent = the prop whose root it rides on (optional). size in metres. */
  decal(point, normal, size = 0.9, parent = null) {
    const m = this.decals[this.dn]; this.dn = (this.dn + 1) % this.decals.length;
    if (m.userData.on) this.stats.recycled++;
    if (m.parent !== this.scene) { m.parent && m.parent.remove(m); this.scene.add(m); }
    const n = _a.copy(normal).normalize(); _q.setFromUnitVectors(Z, n); _q2.setFromAxisAngle(Z, rand(0, 6.28)); _q.multiply(_q2); m.quaternion.copy(_q);
    m.position.copy(point).addScaledVector(n, 0.025); const s = size * rand(0.85, 1.2); m.scale.set(s, s, 1);
    const wall = Math.abs(n.y) < 0.6; const d = m.userData; d.on = true; d.t = 0; d.life = SLIME.decalLife * rand(0.9, 1.1); d.size = s; d.wall = wall; d.n = n.clone(); d.base = m.position.clone();
    d.down = wall ? _b.copy(DOWN).addScaledVector(n, -DOWN.dot(n)).normalize().clone() : null; d.dripMax = wall ? rand(0.5, 1.2) : 0; d.roll = _q.clone();
    m.visible = true; m.updateMatrixWorld(true);
    if (parent && parent.root) { parent.root.attach(m); d.prop = parent; } else d.prop = null;
    this.stats.decals++; return m;
  }
  /** stick slime to a prop: it resists sliding for a while */
  stickProp(p, amount = 1) { if (!p || p.dead) return; const was = this.props.get(p) || 0; if (!was) this.stats.propsSlimed++; this.props.set(p, Math.min(9, was + 4.5 * amount)); }

  // ------------------------------------------------------------------------------------------------ per frame (world time)
  update(dt) {
    this.t += dt; const g = this.g;
    for (const [t, s] of this.map) {
      if (t.dead) { this.clear(t); continue; }
      s.fresh = Math.max(0, s.fresh - dt);
      if (s.trapT > 0) { s.trapT -= dt; s.amount = Math.max(s.amount, SLIME.trapAt); if (s.trapT <= 0) s.amount = Math.min(s.amount, SLIME.restrictAt + 0.35); }   // released: still restricted for a moment, then it wears off
      else s.amount -= dt * SLIME.decay;
      if (s.amount <= 0.03) { this.stats.expired++; this.clear(t); continue; }
      this.applyTo(s);
      const k = clamp(s.amount / 2.6, 0, 1), dry = clamp(s.amount / 0.6, 0, 1);
      if (s.coat) {
        for (const m of s.meshes) { const b = m.userData.base * (0.8 + 0.3 * k + (s.fresh > 0 ? 0.06 * Math.sin(s.fresh * 60) : 0)) * (0.35 + 0.65 * dry); m.scale.setScalar(b); }
      }
      // struggle: a restricted / trapped target wobbles, a trapped one strains against it
      const st = this.stateOf(s), amp = st === 'TRAPPED' ? 1 : st === 'RESTRICTED' ? 0.45 : 0;
      if (amp > 0 && !t.noWobble) { const o = t.body || t.root; if (o) { const ph = this.t * (st === 'TRAPPED' ? 17 : 9) + s.wob; o.rotation.x += Math.sin(ph) * 0.05 * amp; o.rotation.z += Math.cos(ph * 1.3) * 0.055 * amp; } }
      s.drip -= dt; if (s.drip <= 0 && t.spheres && t.spheres.length) { s.drip = rand(0.12, 0.3) / (0.4 + k); const sp = t.spheres[(Math.random() * t.spheres.length) | 0]; _a.copy(sp.local); t.root.localToWorld(_a); _a.x += rand(-1, 1) * sp.r * 0.6; _a.z += rand(-1, 1) * sp.r * 0.6; _a.y -= sp.r * 0.5; g.fx.dust.emit({ pos: _a, vel: _b.set(rand(-0.15, 0.15), -0.2, rand(-0.15, 0.15)), size: rand(0.07, 0.13), life: rand(0.5, 0.8), drag: 0.5, grav: 6, color: [0.38, 0.85, 0.1], alpha: 0.95 }); }
    }
    for (const m of this.decals) {
      const d = m.userData; if (!d.on) continue; d.t += dt; const u = d.t / d.life;
      if (u >= 1) { d.on = false; m.visible = false; if (m.parent !== this.scene) { m.parent && m.parent.remove(m); this.scene.add(m); } continue; }
      if (d.prop && (d.prop.dead || !d.prop.root.parent)) { d.on = false; m.visible = false; this.scene.add(m); continue; }
      const dry = 1 - Math.pow(clamp((u - 0.72) / 0.28, 0, 1), 1.5), dripK = d.wall ? clamp(d.t / 3.2, 0, 1) : 0, s = d.size * dry;
      m.scale.set(s, s * (1 + d.dripMax * dripK * 0.7), 1);
      if (d.wall && !d.prop) { m.position.copy(d.base).addScaledVector(d.down, d.size * d.dripMax * dripK * 0.35 * dry); }
    }
    // props: slimed things resist sliding (the existing prop physics keeps running; the slime just bleeds the speed off)
    for (const [p, t] of this.props) {
      if (p.dead || !p.root.parent) { this.props.delete(p); continue; }
      const nt = t - dt; if (nt <= 0) { this.props.delete(p); continue; } this.props.set(p, nt);
      if (p.vel && !p.held) { const k = Math.exp(-3.2 * dt); p.vel.x *= k; p.vel.z *= k; if (p.spin) p.spin.multiplyScalar(k); }
    }
  }
  /** everything off (dummy reset / switching to another alien clears only the projectiles; this is for the full reset) */
  reset() {
    for (const t of [...this.map.keys()]) this.clear(t);
    for (const m of this.decals) { m.userData.on = false; m.visible = false; if (m.parent !== this.scene) { m.parent && m.parent.remove(m); this.scene.add(m); } }
    this.props.clear();
  }
  get liveDecals() { let n = 0; for (const m of this.decals) if (m.userData.on) n++; return n; }
}
