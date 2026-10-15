// Kevin 11 - projectiles (crystal shard, fire blast, goo), crystal ground spikes and the boss / player HUD.
// Every shot starts at the matching body part (crystal arm / Heatblast arm / mouth) and is tested against the player's capsule, the world (walls, ground) and destructible walls.
import * as THREE from 'three';
import { makeCrystalGeometry } from './effects.js';
import { attackImpact, hitFX } from './impact.js';
import { clamp, rand } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

/** squared distance between two segments (closest points left in _c1 / _c2) */
export function segSeg2(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.lengthSq(), e = _d2.lengthSq(), f = _d2.dot(_r); let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) { _c1.copy(p1); _c2.copy(p2); return _c1.distanceToSquared(_c2); }
  if (a <= 1e-9) { t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s); _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceToSquared(_c2);
}

/** does the segment a->b (radius r) touch the player's capsule?  -> { point, t (0..1 along the segment) } | null.  A submerged player (Ripjaws) is out of reach. */
export function playerSegHit(g, a, b, r, swimOK = false) {
  const P = g.player; if (P.ignoreHits && !(swimOK && P.mode === 'swim')) return null; const submerged = P.pos.y < -0.8 || (P.pos.y < -0.2 && P.mode === 'swim'); if (submerged && !swimOK) return null;
  const cap = playerSegHit._cap || (playerSegHit._cap = {}); const rr0 = Math.max(P.rad ?? 0.5, 0.12), h = Math.max(P.colH ?? 2.2, rr0 * 2);
  const A = (cap.a = cap.a || new THREE.Vector3()).set(P.pos.x, P.pos.y + rr0, P.pos.z), B = (cap.b = cap.b || new THREE.Vector3()).set(P.pos.x, P.pos.y + h - rr0, P.pos.z), rr = r + rr0;
  if (segSeg2(a, b, A, B) >= rr * rr) return null;
  const L = _d1.subVectors(b, a).length() || 1; const t = clamp(_c1.distanceTo(a) / L, 0, 1); return { point: _c2.clone(), t };
}

export class KevinShots {
  constructor(game, kevin) {
    this.g = game; this.k = kevin; this.shots = []; this.spikes = []; this.pool = { crystal: [], goo: [], spike: [] }; this.stats = { crystal: 0, fire: 0, goo: 0, spikes: 0, hits: 0, wall: 0 };
    this.matC = new THREE.MeshStandardMaterial({ color: 0xbff8ff, emissive: 0x19c8ff, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.2, flatShading: true });
    this.matG = new THREE.MeshStandardMaterial({ color: 0x7ee03a, emissive: 0x3aa010, emissiveIntensity: 0.8, roughness: 0.25, transparent: true, opacity: 0.92 });
    this.geoC = [1, 2, 3].map(s => makeCrystalGeometry({ length: 1.3, radius: 0.2, sides: 5, tip: 0.5, jitter: 0.15, seed: s * 11 }));
    this.geoS = [4, 5, 6].map(s => makeCrystalGeometry({ length: 1.0, radius: 0.34, sides: 5, tip: 0.45, jitter: 0.18, seed: s * 17 }));
    this.geoG = new THREE.IcosahedronGeometry(0.24, 1);
    this.root = new THREE.Group(); this.root.name = 'KevinShots'; game.scene.add(this.root);
  }
  mesh(kind, i = 0) {
    const pool = this.pool[kind]; let m = pool.find(o => !o.visible && !o.userData.used);
    if (!m) {
      const dh = this.g.p2; m = new THREE.Mesh(kind === 'crystal' ? this.geoC[i % 3] : kind === 'spike' ? ((dh && dh.spikeGeo) ? dh.spikeGeo[i % 6] : this.geoS[i % 3]) : this.geoG, kind === 'goo' ? this.matG : kind === 'spike' && dh && dh.spikeMat ? dh.spikeMat : this.matC);
      m.castShadow = false; pool.push(m); this.root.add(m);
    }
    m.userData.used = true; m.visible = true; return m;
  }
  free(m) { if (!m) return; m.visible = false; m.userData.used = false; }
  clear() {
    const g = this.g, me = this.k;                 // shots Kevin fired through the shared systems (crystal / fire / goo)
    for (let i = g.power.projectiles.length - 1; i >= 0; i--) { const p = g.power.projectiles[i]; if (p.owner === me) { g.scene.remove(p.mesh); g.power.projectiles.splice(i, 1); } }
    for (let i = g.hb.shots.length - 1; i >= 0; i--) if (g.hb.shots[i].owner === me) g.hb.shots.splice(i, 1);
    for (let i = g.sf.shots.length - 1; i >= 0; i--) if (g.sf.shots[i].owner === me) { g.sf.shots[i].mesh.visible = false; g.sf.shots.splice(i, 1); }
    g.slime.clear(g.gooProxy);
    for (const s of this.shots) this.free(s.mesh); this.shots.length = 0; for (const s of this.spikes) this.free(s.mesh); this.spikes.length = 0; }

  /** type: 'crystal' | 'fire' | 'goo'.  imp = attackImpact()-compatible property bag */
  shoot(type, from, dir, speed, imp, o = {}) {
    const s = { type, pos: from.clone(), prev: from.clone(), vel: dir.clone().normalize().multiplyScalar(speed), life: o.life ?? 2.4, imp, r: o.r ?? (type === 'fire' ? 0.5 : type === 'goo' ? 0.42 : 0.38), grav: o.grav ?? 0, mesh: null, t: 0 };
    if (type === 'crystal') { s.mesh = this.mesh('crystal', this.stats.crystal); s.mesh.scale.setScalar(1); this.stats.crystal++; }
    else if (type === 'goo') { s.mesh = this.mesh('goo'); s.mesh.scale.setScalar(1); this.stats.goo++; } else this.stats.fire++;
    if (s.mesh) { s.mesh.position.copy(s.pos); s.mesh.lookAt(_a.copy(s.pos).add(s.vel)); }
    this.shots.push(s); return s;
  }
  /** a telegraphed line of ground spikes: [{x,z}] positions; they erupt one after another */
  spikeLine(points, delay, imp) {
    const g = this.g; this.stats.spikes++;
    points.forEach((p, i) => {
      const s = { x: p.x, z: p.z, y: p.y || 0, t: -(delay + i * 0.1), life: 1.15, mesh: this.mesh('spike', i), imp, hit: false, up: false, tilt: [rand(-0.2, 0.2), rand(-0.2, 0.2)], set: imp.set };
      s.mesh.visible = false; this.spikes.push(s);
      g.fx.surface.ring(_a.set(p.x, (p.y || 0) + 0.05, p.z), UP, 1.9, delay + i * 0.1 + 0.15, 0x39e8ff);
    });
  }

  playerCapsule(P, out) {
    const r = Math.max(P.rad ?? 0.5, 0.12), h = Math.max(P.colH ?? 2.2, r * 2);
    out.a = (out.a || new THREE.Vector3()).set(P.pos.x, P.pos.y + r, P.pos.z); out.b = (out.b || new THREE.Vector3()).set(P.pos.x, P.pos.y + h - r, P.pos.z); out.r = r; return out;
  }
  update(dt) {
    const g = this.g, P = g.player, cap = this._cap || (this._cap = {}); this.playerCapsule(P, cap);
    const submerged = P.pos.y < -0.8 || (P.pos.y < -0.2 && P.mode === 'swim');
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.t += dt; s.life -= dt; s.prev.copy(s.pos); s.vel.y -= s.grav * dt; s.pos.addScaledVector(s.vel, dt);
      let dead = s.life <= 0, hitPt = null, hitN = null, hitP = false;
      // player
      const rr = s.r + cap.r;
      if (!dead && segSeg2(s.prev, s.pos, cap.a, cap.b) < rr * rr && !(submerged && s.type !== 'goo')) {
        const dir = _a.copy(s.vel).setY(0); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); dir.normalize();
        const pt = _c2.clone(); const imp = Object.assign({}, s.imp, { dir: dir.clone(), point: pt, src: this.k });
        const res = g.impact.hitPlayer(imp);
        if (!(res && res.passed)) { hitPt = pt; hitP = true; dead = true; this.stats.hits++; this.k.onPlayerHit && this.k.onPlayerHit(s.imp.name || s.type, res); if (s.type === 'goo' && !(res && (res.dodged))) { g.impact.slow(0.38, 2.7); g.hud.tag(P.pos.clone().setY(P.pos.y + 1.4), 'SLOWED'); } }
      }
      // world: walls / ground
      if (!dead) {
        const d = _b.subVectors(s.pos, s.prev), L = d.length();
        if (L > 1e-5) { d.multiplyScalar(1 / L); const h = g.world.raySolid(s.prev, d, L); if (h) { dead = true; hitPt = h.point.clone(); hitN = h.normal; this.stats.wall++; this.hitWall(s, hitPt, d); } }
        { const gy = g.world.terrain ? g.world.terrain.height(s.pos.x, s.pos.z) : 0; if (!dead && s.pos.y < gy + 0.05 && (g.world.terrain || !g.world.lagoon || !g.world.lagoon.inRect || !g.world.lagoon.inRect(s.pos.x, s.pos.z))) { dead = true; hitPt = s.pos.clone().setY(gy + 0.05); hitN = UP; } }
      }
      if (!dead) {                                                                       // visuals in flight
        if (s.mesh) { s.mesh.position.copy(s.pos); s.mesh.lookAt(_a.copy(s.pos).add(s.vel)); g.fx.glow.emit({ pos: s.pos, size: 0.45, life: 0.2, drag: 0, color: [0.45, 0.95, 1], alpha: 0.7 }); }
        if (s.type === 'goo') g.fx.glow.emit({ pos: s.pos, size: 0.4, life: 0.25, drag: 0, color: [0.5, 1, 0.25], alpha: 0.6 });
        if (s.type === 'fire') {
          const n = Math.max(1, Math.round(dt * 90));
          for (let k = 0; k < n; k++) g.fx.fire.emit({ pos: _a.copy(s.pos).addScaledVector(s.vel, -rand(0, dt)), vel: _b.set(rand(-1, 1), rand(-0.5, 1.2), rand(-1, 1)).clone(), size: rand(0.55, 0.95), grow: 0.8, life: rand(0.28, 0.5), drag: 2, color: [1, rand(0.35, 0.7), 0.1], alpha: 0.9 });
          g.fx.glow.emit({ pos: s.pos, size: 1.6, life: 0.1, drag: 0, color: [1, 0.6, 0.2], alpha: 0.9 });
        }
        continue;
      }
      this.burst(s, hitPt || s.pos, hitN || UP, hitP);
      this.free(s.mesh); this.shots.splice(i, 1);
    }
    // ---- spikes
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i]; s.t += dt;
      if (s.t < 0) continue;
      if (!s.up) {                                                                       // erupt
        s.up = true; s.mesh.visible = true; g.sfx.crash(0.12); g.camera.addTrauma(0.03);
        for (let k = 0; k < 5; k++) g.fx.shards.emit({ pos: _a.set(s.x + rand(-0.4, 0.4), s.y + 0.2, s.z + rand(-0.4, 0.4)), vel: _b.set(rand(-2, 2), rand(3, 6), rand(-2, 2)), size: rand(0.1, 0.2), life: 0.7, grav: 1 });
        for (let k = 0; k < 4; k++) g.fx.dust.emit({ pos: _a.set(s.x, s.y + 0.1, s.z).clone(), vel: _b.set(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).clone(), size: 0.7, grow: 1.4, life: 0.6, drag: 2, color: [0.7, 0.7, 0.66], alpha: 0.4 });
      }
      const u = clamp(s.t / 0.14, 0, 1), out = 1 - clamp((s.t - (s.life - 0.3)) / 0.3, 0, 1), k = (1 - Math.pow(1 - u, 3)) * out;
      s.mesh.position.set(s.x, s.y - 0.05, s.z); s.mesh.rotation.set(-Math.PI / 2 + s.tilt[0], 0, s.tilt[1]); s.mesh.scale.set(0.7, 0.7, Math.max(0.01, 2.0 * k));
      // damage (once per cast): the player's feet / body inside the column while it is rising
      if (!s.hit && !(s.set && s.set.hit) && u < 1 && !submerged) {
        const dx = P.pos.x - s.x, dz = P.pos.z - s.z, rad = 0.95 + Math.min(P.rad ?? 0.5, 1.5);
        if (dx * dx + dz * dz < rad * rad && P.pos.y < s.y + 1.6 && P.pos.y + Math.max(P.colH ?? 2.2, 0.2) > s.y) {
          s.hit = true; if (s.set) s.set.hit = true;
          const dir = _a.set(dx, 0, dz); if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1)); dir.normalize();
          const res = g.impact.hitPlayer(Object.assign({}, s.imp, { dir: dir.clone(), point: new THREE.Vector3(s.x, s.y + 0.7, s.z), src: this.k, color: [0.5, 0.95, 1] })); this.stats.hits++;
          if (!(res && res.passed)) { this.k.onPlayerHit && this.k.onPlayerHit('spikes', res); }
        }
      }
      if (s.t >= s.life) { this.free(s.mesh); this.spikes.splice(i, 1); }
    }
  }
  hitWall(s, pt, d) {
    const P = this.g.props; if (!P || !P.walls) return;
    const dmg = s.type === 'crystal' ? 55 : s.type === 'fire' ? 45 : 0; if (!dmg) return;
    for (const w of P.walls) {
      if (!w.alive) continue; const b = w.entry, dx = clamp(pt.x, b.min.x, b.max.x) - pt.x, dz = clamp(pt.z, b.min.z, b.max.z) - pt.z, dy = clamp(pt.y, b.min.y, b.max.y) - pt.y;
      if (dx * dx + dz * dz + dy * dy < 0.5) { P.damageWall(w, dmg, pt.clone(), d.clone()); break; }
    }
  }
  burst(s, pt, n, hitP) {
    const g = this.g;
    if (s.type === 'crystal') {
      for (let k = 0; k < 8; k++) g.fx.shards.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0.2, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8)).addScaledVector(n, 3).clone(), size: rand(0.08, 0.22), life: 0.9, grav: 1 });
      g.fx.glow.emit({ pos: pt, size: 1.8, life: 0.14, drag: 0, color: [0.4, 0.95, 1], alpha: 1 }); if (!hitP) { g.sfx.crash(0.18); g.camera.addTrauma(0.04); }
    } else if (s.type === 'fire') {
      g.fx.glow.emit({ pos: pt, size: 3.2, life: 0.16, drag: 0, color: [1, 0.65, 0.25], alpha: 1 });
      for (let k = 0; k < 16; k++) g.fx.fire.emit({ pos: _a.copy(pt).addScaledVector(n, 0.2).clone(), vel: _b.set(rand(-1, 1), rand(0.3, 1.6), rand(-1, 1)).multiplyScalar(rand(2, 5)).addScaledVector(n, 2).clone(), size: rand(0.7, 1.3), grow: 1.0, life: rand(0.35, 0.7), drag: 2.2, color: [1, rand(0.35, 0.75), 0.1], alpha: 0.9 });
      g.fx.surface.ring(_a.copy(pt).addScaledVector(n, 0.05), n, 3.2, 0.35, 0xff8a2a); g.sfx.flame(0.35); g.camera.addTrauma(0.05);
    } else {
      for (let k = 0; k < 10; k++) g.fx.glow.emit({ pos: pt, vel: _a.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).multiplyScalar(rand(1.5, 4)).clone(), size: rand(0.18, 0.4), life: 0.5, drag: 2, grav: 3, color: [0.45, 1, 0.2], alpha: 0.9 });
      g.fx.surface.ring(_a.copy(pt).addScaledVector(n, 0.05), n, 2.2, 0.5, 0x6fdc2a); g.sfx.squelch(0.25);
    }
  }
}

// ======================================================================================================================================================================
// HUD: large boss bar (3 phase notches, delayed damage trail, state line) + the player's vitals bar
// ======================================================================================================================================================================
export class KevinHud {
  constructor(o = {}) {
    this.o = Object.assign({ id: 'bossbar', name: 'KEVIN 11', vitals: true, n1: 70, n2: 35 }, o);
    const hud = document.getElementById('hud') || document.body, mk = (html, id) => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; d.hidden = true; hud.appendChild(d); return d; };
    this.boss = mk(`<div class="bb-top"><span class="bb-name">${this.o.name}</span><span class="bb-phase">PHASE I</span><span class="bb-num"></span></div><div class="bb-track"><div class="bb-trail"></div><div class="bb-fill"></div><i class="bb-n" style="left:${this.o.n1}%"></i><i class="bb-n" style="left:${this.o.n2}%"></i></div><div class="bb-state"></div>`, this.o.id);
    this.vit = this.o.vitals ? mk('<div class="vt-top"><span class="vt-name">—</span><span class="vt-num"></span></div><div class="vt-track"><div class="vt-fill"></div></div>', 'vitals') : { hidden: true };
    this.q = s => this.boss.querySelector(s); this.v = s => this.vit.querySelector(s);
    this.trail = 1; this.show = 0; this.flash = 0; this.last = 1;
  }
  update(dt, k, g) {
    const f = clamp(k.hp / k.maxHp, 0, 1), vis = !!k.present;                         // V9: a bar exists exactly while its boss is spawned (alive or defeated)
    this.show = clamp(this.show + (vis ? 1 : -1) * dt * 3, 0, 1); this.boss.hidden = this.show <= 0.01; this.boss.style.opacity = this.show.toFixed(2);
    if (f < this.last - 1e-4) this.flash = 0.18; this.last = f; this.flash = Math.max(0, this.flash - dt);
    this.trail = f >= this.trail ? f : Math.max(f, this.trail - dt * 0.18);
    this.q('.bb-fill').style.width = (f * 100).toFixed(2) + '%'; this.q('.bb-trail').style.width = (this.trail * 100).toFixed(2) + '%'; this.boss.classList.toggle('flash', this.flash > 0);
    this.q('.bb-phase').textContent = k.phaseLabel ? k.phaseLabel() : k.dead ? 'DEFEATED' : ['PHASE I', 'PHASE II', 'PHASE III'][k.phase]; this.q('.bb-num').textContent = Math.ceil(k.hp) + ' / ' + k.maxHp;
    this.boss.dataset.phase = k.phase; this.boss.classList.toggle('dead', k.dead);
    this.q('.bb-state').textContent = k.stateLabel();
    this.vitals(g);
  }
  hide() { this.show = 0; this.boss.hidden = true; this.boss.style.opacity = '0'; }
  vitals(g) {
    if (!this.o.vitals) return;
    // vitals
    const hp = g.impact.hp(), id = g.chars.id, own = g.player && typeof g.player.hp === 'number' && id !== 'diamondhead' && id !== 'xlr8';
    const showV = !own && id !== 'waybig'; this.vit.hidden = !showV; if (showV) { const r = clamp(hp.hp / hp.max, 0, 1); this.v('.vt-fill').style.width = (r * 100).toFixed(1) + '%'; this.v('.vt-name').textContent = (g.chars.def?.name || id).toString().toUpperCase() + ' · HP'; this.v('.vt-num').textContent = Math.ceil(hp.hp) + ' / ' + hp.max; this.vit.classList.toggle('low', r < 0.3); }
  }
}
