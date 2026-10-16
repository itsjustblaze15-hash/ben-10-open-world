// V32 MISSILE STRIKES from the mothership. Pooled (max 6 flying), launched at controlled gameplay-time intervals (never world-time), visible flight with a smoke / flame trail, a red ground warning ring ~1.5 s before impact,
// then a cartoon explosion (fire.explode: fireball, smoke, dust, sparks, shockwave, impact light) that damages the targeted building through the existing destruction system, burns a few temporary fires,
// hurts the player / enemies in the blast (never the invasion army or bosses) and makes civilians run. The city is hit repeatedly but NOT wiped out: ~60% of strikes pick a standing building, the rest hit streets
// and open ground near the action, and once about a fifth of the city lies in ruins strikes switch mostly to the ground.
import * as THREE from 'three';
import { clamp, rand } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
export const MIS = { max: 6, speed: 105, intMin: 4.5, intMax: 8, warn: 1.5, maxFires: 10, ruinCap: 0.22, hitR: 24, hitDmg: 40, bldFrac: 0.55, playerMin: 45, bldPer: 4 };
const OWNER = { root: { position: new THREE.Vector3() }, isMissile: true };

export class MissileSystem {
  constructor(game) {
    this.g = game; this.list = []; this.t = 0; this.next = 3; this.enabled = false; this.stats = { fired: 0, impacts: 0, bldHits: 0, ground: 0 }; this.recent = []; this.fireN = 0;
    const g = new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8); g.rotateX(Math.PI / 2); const nose = new THREE.ConeGeometry(0.18, 0.7, 8); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 1.45);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.4, metalness: 0.7, emissive: 0x551008, emissiveIntensity: 1.2 }); this.noseM = new THREE.MeshStandardMaterial({ color: 0x8a1519, roughness: 0.4, metalness: 0.5, emissive: 0xff2a10, emissiveIntensity: 1.4 });
    for (let i = 0; i < MIS.max; i++) { const m = new THREE.Group(); m.add(new THREE.Mesh(g, this.mat)); m.add(new THREE.Mesh(nose, this.noseM)); m.visible = false; m.scale.setScalar(2.2); game.scene.add(m); this.list.push({ mesh: m, on: false, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, bld: null, warned: false, ringT: 0 }); }
  }
  /** is a recent blast close enough that a building should not regenerate yet? */
  nearRecent(b) { for (const r of this.recent) if (this.t - r.t < 40 && Math.hypot(r.x - b.x, r.z - b.z) < 90) return true; return false; }
  active() { return this.list.filter(m => m.on).length; }
  ruinedFrac() { const d = this.g.destruct; if (!d) return 0; let n = 0, c = 0; for (const b of d.list) { if (!this.inCity(b.x, b.z)) continue; c++; const s = b.dm && b.dm.state; if (s === 'ruin' || s === 'dying' || s === 'drop') n++; } return c ? n / c : 0; }
  inCity(x, z) { return x > -480 && x < -76 && z > -224 && z < 200; }
  /** choose a target: a standing building (60%) or street / open ground near the player / combat */
  pickTarget(out) {
    const g = this.g, P = g.player, d = g.destruct, ground = !d || Math.random() > MIS.bldFrac || this.ruinedFrac() > MIS.ruinCap && Math.random() < 0.85;
    if (!ground) {
      const cand = d.list.filter(b => b.dm && (b.dm.state === 'ok' || b.dm.state === 'hurt') && this.inCity(b.x, b.z) && Math.hypot(b.x - P.pos.x, b.z - P.pos.z) > MIS.playerMin && !this.targeted(b)).sort((a, b) => Math.hypot(a.x - P.pos.x, a.z - P.pos.z) - Math.hypot(b.x - P.pos.x, b.z - P.pos.z));
      if (cand.length) { const b = cand[Math.floor(Math.random() * Math.min(cand.length, 48))]; out.set(b.x, b.y0 + b.h * rand(0.35, 0.7), b.z); return b; }
    }
    // ground: a point 60-180 m from the player (street or open ground), never right on the player
    for (let k = 0; k < 6; k++) {
      const a = rand(0, 6.283), r = rand(60, 180), x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r; if (!this.inCity(x, z) && k < 5) continue;
      const w = g.world; if (w.staticsIn && w.staticsIn(x - 2, z - 2, x + 2, z + 2).some(s => s.max.y > w.terrain.height(x, z) + 1)) continue; const y = w.groundAt(x, z, 200, 300, 0.3); out.set(x, y, z); return null;
    }
    const y = g.world.groundAt(P.pos.x + 80, P.pos.z, 200, 300, 0.3); out.set(P.pos.x + 80, y, P.pos.z); return null;
  }
  targeted(b) { return this.list.some(m => m.on && m.bld === b); }
  launch() {
    const g = this.g, sh = g.invasion && g.invasion.ship; if (!sh || !sh.loaded) return false; const m = this.list.find(q => !q.on); if (!m) return false;
    m.bld = this.pickTarget(m.tgt); const sp = sh.pos; m.pos.set(sp.x + rand(-60, 60), sp.y - 30, sp.z + rand(-170, 170)); m.vel.copy(m.tgt).sub(m.pos).normalize().multiplyScalar(MIS.speed * 0.35); m.vel.y -= 4;
    m.on = true; m.t = 0; m.warned = false; m.weave = rand(0, 6.28); m.mesh.visible = true; this.stats.fired++;
    g.fx.glow.emit({ pos: m.pos.clone(), size: 12, life: 0.3, drag: 0, color: [1, 0.35, 0.12] }); g.sfx.zap && g.sfx.zap(0.15);
    return true;
  }
  clear() { for (const m of this.list) { m.on = false; m.mesh.visible = false; } this.recent.length = 0; this.fireN = 0; }
  update(dt, mode) {
    this.t += dt; const g = this.g, P = g.player;
    if (mode.enabled) { this.next -= dt; if (this.next <= 0) { this.next = rand(MIS.intMin, MIS.intMax); if (mode.near && this.active() < MIS.max - 1) { this.launch(); if (Math.random() < 0.25 && this.active() < MIS.max - 1) this.launch(); } } }
    for (const m of this.list) {
      if (!m.on) continue; m.t += dt; const p = m.pos, tg = m.tgt;
      const to = _a.copy(tg).sub(p), dist = to.length(); to.multiplyScalar(1 / Math.max(dist, 1e-3));
      m.weave += dt * 3; const sp = Math.min(MIS.speed, m.vel.length() + 120 * dt); _b.set(Math.cos(m.weave), Math.sin(m.weave * 1.3), -Math.cos(m.weave)).multiplyScalar(dist > 60 ? 0.07 : 0);
      m.vel.lerp(_d.copy(to).add(_b).normalize().multiplyScalar(sp), 1 - Math.exp(-4 * dt)); m.vel.setLength(sp);
      const step = m.vel.length() * dt; _d.copy(m.vel).normalize(); let hit = dist < step + 1.5;
      if (!hit && g.world.raySolid(p, _d, step + 0.6)) hit = true;
      p.addScaledVector(m.vel, dt); m.mesh.position.copy(p); m.mesh.lookAt(_a.copy(p).add(m.vel));
      if (!m.warned && dist < MIS.speed * MIS.warn) { m.warned = true; const gy = g.world.groundAt(tg.x, tg.z, tg.y + 5, 300, 0.3); g.fx.surface.ring(_a.set(tg.x, gy + 0.2, tg.z), new THREE.Vector3(0, 1, 0), MIS.hitR * 1.1, MIS.warn, 0xff2a1a); g.world.danger && g.world.danger(tg.x, tg.z, 50, 1); }
      if (Math.random() < dt * 90) { g.fire.smoke(p.clone(), _b.set(rand(-.3, .3), rand(-.3, .3), rand(-.3, .3)).clone(), 1.6, 2.2); } g.fire.flame(p.clone(), _b.set(0, 0, 0).clone(), 0.9, 0.3, 1);
      if (hit || m.t > 14 || p.y < -50) this.impact(m);
    }
  }
  impact(m) {
    const g = this.g, c = m.pos.clone(), b = m.bld; m.on = false; m.mesh.visible = false; this.stats.impacts++;
    const gy = g.world.groundAt(c.x, c.z, c.y + 4, 8, 0.2); if (c.y < gy + 0.5) c.y = gy + 1;
    OWNER.root.position.copy(c); const skip = h => h.isInv || h.isBoss || h.isGuard || h.isTrainBot === true && false || (g.bossList && g.bossList.includes(h));
    const P = g.player, near = Math.hypot(P.pos.x - c.x, P.pos.z - c.z) < 650;
    g.fire.explode(c, MIS.hitR, MIS.hitDmg, 22, { owner: OWNER, big: true, fuel: false, wall: 0.7, skip, scorch: 3.2 });
    // V33: a massive blast - second fireball + sparks, thick smoke column, shockwave rings, debris, scorch, cracked road and flung props
    g.fire.burst(c.clone(), near ? 46 : 20, 20, 2.8, 0.7, 0.9); const ph = this.bigFx = (this.bigFx || 0) + 1;
    for (let i = 0; i < (near ? 9 : 4); i++) g.fire.smoke(_a.set(c.x + rand(-9, 9), c.y + rand(2, 14), c.z + rand(-9, 9)).clone(), _b.set(rand(-2.5, 2.5), rand(7, 15), rand(-2.5, 2.5)).clone(), rand(9, 20), rand(4.5, 8));
    for (let i = 0; i < 3; i++) g.fx.surface.ring(_a.set(c.x, gy + 0.25, c.z).clone(), new THREE.Vector3(0, 1, 0), MIS.hitR * (1.6 + i * 1.3), 0.6 + i * 0.25, i ? 0xffc890 : 0xfff0d0);
    const PR = g.props; if (PR) { try { PR.debris.burst(c.clone(), near ? 46 : 18, 17, 0.45, 0x8a8a84, 1.4); PR.shockwave && PR.shockwave(c, MIS.hitR * 1.2, 20, 0, 0); if (PR.cracks && gy < c.y + 14) { PR.cracks.add(c.x, gy, c.z, 12, 20); PR.cracks.add(c.x + rand(-8, 8), gy, c.z + rand(-8, 8), 8, 16); PR.cracks.add(c.x + rand(-12, 12), gy, c.z + rand(-12, 12), 6, 12); } } catch { /* optional */ } }
    g.fx.glow.emit({ pos: c.clone().setY(c.y + 3), size: 60, life: 0.35, drag: 0, color: [1, 0.75, 0.4], alpha: 0.9 });
    if (b && g.destruct && b.dm && (b.dm.state === 'ok' || b.dm.state === 'hurt')) {
      const roll = Math.random(), hpM = b.dm.hpMax, tall = b.h > 40;                                  // some towers collapse, most are badly damaged, some burn
      const frac = roll < (tall ? 0.28 : 0.15) ? 1.25 : roll < 0.75 ? rand(0.5, 0.8) : rand(0.35, 0.55);
      g.destruct.damage(b.dm.wall, hpM * frac, c.clone(), _a.set(rand(-1, 1), 0, rand(-1, 1)).normalize().clone()); this.stats.bldHits++;
      if (roll >= 0.75 && this.fireN < MIS.maxFires) { for (let k = 0; k < 2; k++) { g.fire.groundFire(b.x + rand(-6, 6), b.z + rand(-6, 6), rand(2.6, 4), rand(30, 55), gy); this.fireN++; } }       // a burning building
      if (g.destruct.list) for (const o of g.destruct.list) { if (o === b || !o.dm || !(o.dm.state === 'ok' || o.dm.state === 'hurt')) continue; if (Math.hypot(o.x - c.x, o.z - c.z) < 46) g.destruct.damage(o.dm.wall, o.dm.hpMax * rand(0.12, 0.3), c.clone(), _a.set(rand(-1, 1), 0, rand(-1, 1)).normalize().clone()); }
    } else this.stats.ground++;
    for (let i = 0; i < 2 && this.fireN < MIS.maxFires; i++) { g.fire.groundFire(c.x + rand(-7, 7), c.z + rand(-7, 7), rand(2, 3.4), rand(16, 34), gy); this.fireN++; }
    void ph;
    this.recent.push({ x: c.x, z: c.z, t: this.t }); if (this.recent.length > 12) this.recent.shift(); this.fireN = Math.max(0, Math.min(this.fireN, g.fire.fires.length));
    g.fx.dust.emit({ pos: c.clone(), size: 14, grow: 6, life: 1.6, drag: 1.2, color: [0.55, 0.52, 0.48], alpha: 0.6 });
    if (g.world.danger) g.world.danger(c.x, c.z, 140, 2); g.camera.addTrauma(clamp(0.9 - Math.hypot(P.pos.x - c.x, P.pos.z - c.z) / 420, 0, 0.9));
  }
}
