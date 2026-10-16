// V30 HOSTILE UNDERWATER ENEMIES for the open world (separate from the Boss Manager - they are ordinary wildlife-level enemies).
//   "Reef Hunters": armed divers' drones that cruise the deep water (>= 3.5 m), notice a swimmer within ~34 m, chase him through the water and strike when close.
//   Ripjaws (and Vilgax / Albedo's water forms through the same hittable list) can bite / claw them; every other alien can hit the ones near the surface. They are 'diver' hittables:
//   water drag, short stagger, small knock-back.  Defeat -> sinks and fades, the sea respawns one 2-4 min later (?seares=min,max) never right beside the player.
//   Population: SEA.max active bodies in a pool, spawned only in deep water 22-60 m from the player, returned to the pool beyond SEA.sleepR.
import * as THREE from 'three';
import { Diver } from '../diver.js';
import { attackImpact } from '../impact.js';
import { clamp, rand, damp, angleDelta } from '../util.js';

export const SEA = { max: 5, hp: 110, speed: 4.1, cruise: 1.5, sight: 34, lose: 70, strike: 2.5, dmg: 11, cd: 1.5, wind: 0.4, respawnMin: 120, respawnMax: 240, spawnMin: 22, spawnMax: 60, sleepR: 130, minDepth: 3.5 };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class ReefHunter extends Diver {
  constructor(game) {
    super(game, new THREE.Vector3(0, -500, 0), 'REEF HUNTER');
    this.isSeaBot = true; this.kind = 'diver'; this.maxHp = this.hp = SEA.hp; this.parked = true; this.dead = true; this.deadT = 5; this.root.visible = false; this.bar.visible = false;
    this.mats[0].color.set(0x2a2f3d); this.mats[1].color.set(0xd13a2e); this.mats[3].color.set(0xd13a2e);
    this.atkT = 0; this.cd = 0; this.state = 'cruise'; this.chase = null; this.sinkT = 0;
  }
  get present() { return !this.parked && !this.dead; }
  spawnAt(p) { this.parked = false; this.dead = false; this.deadT = 0; this.hp = this.maxHp; this.pos.copy(p); this.spawn.copy(p); this.goal.copy(p); this.goalT = 0; this.vel.set(0, 0, 0); this.stun = 0; this.atkT = 0; this.cd = 1; this.held = false; this.sinkT = 0; this.state = 'cruise'; for (const m of this.mats) { m.transparent = false; m.opacity = 1; } this.root.visible = true; this.bar.visible = true; this.drawBar(); this.apply(); }
  park() { this.parked = true; this.dead = true; this.deadT = 5; this.root.visible = false; this.bar.visible = false; this.pos.set(0, -500, 0); this.apply(); }
  respawn() { /* the sea (SeaBots.update) respawns bodies; the Diver timer never fires */ }
  update(dt) {
    if (this.parked) return;
    this.t += dt; const g = this.g, L = this.L, P = g.player, wy = L.waterY; this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.dead) {
      this.deadT += dt; this.vel.y -= 1.4 * dt; this.vel.multiplyScalar(Math.exp(-1.6 * dt)); this.pos.addScaledVector(this.vel, dt); L.collideSphere(this.pos, 0.5, this.vel);
      const a = clamp(1 - this.deadT / 3.2, 0, 1); for (const m of this.mats) { m.transparent = true; m.opacity = 0.2 + 0.8 * a; }
      this.tiltX = damp(this.tiltX, 1.5, 3, dt); this.bar.visible = false; this.apply(); return;
    }
    if (this.held) { this.apply(); return; }
    this.stun = Math.max(0, this.stun - dt); this.goalT -= dt; this.cd -= dt;
    const hostile = g.enemies && g.enemies.enabled && !P.ignoreHits, dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, ty = P.pos.y + 0.9, dy = ty - this.pos.y, d = Math.hypot(dx, dz, dy);
    const inWater = L.depthAt(P.pos.x, P.pos.z) > 0.8 && P.pos.y < wy + 0.8;                         // swimmers / divers; XLR8 racing over the surface, fliers and land walkers are ignored
    const sees = hostile && inWater && d < (this.state === 'chase' ? SEA.lose : SEA.sight);
    let sp = 0; const want = _w.set(0, 0, 0);
    if (this.stun <= 0) {
      if (this.atkT > 0) { this.atkT -= dt; sp = 0.4; _v.set(dx, dy, dz).normalize(); want.copy(_v);
        if (this.atkT <= 0) { this.cd = SEA.cd; if (d < SEA.strike + 0.7 && !P.ignoreHits) { g.impact.hitPlayer(attackImpact({ damage: SEA.dmg, knockbackForce: 5, staggerDuration: 0.25, ordinary: true, point: _v.set(P.pos.x, P.pos.y + 1, P.pos.z).clone(), dir: new THREE.Vector3(dx, 0, dz).normalize(), quiet: true, src: this })); g.sfx.hit(false); L.bubbleBurst(_v.set(P.pos.x, P.pos.y + 1, P.pos.z), 8, 0.3, 0.9, 0.06); } this.vel.addScaledVector(_v.set(dx, dy, dz).normalize(), -1.2); } }
      else if (sees) { this.state = 'chase'; if (d > SEA.strike - 0.4) { want.set(dx, dy, dz).multiplyScalar(1 / d); sp = SEA.speed; } if (d < SEA.strike && this.cd <= 0) this.atkT = SEA.wind; }
      else { this.state = 'cruise'; if (this.goalT <= 0 || this.goal.distanceTo(this.pos) < 1) this.pickGoal2(); _v.copy(this.goal).sub(this.pos); const gd = _v.length(); if (gd > 0.3) { want.copy(_v).multiplyScalar(1 / gd); sp = SEA.cruise * Math.min(1, gd / 2); } }
    }
    sp *= (this.slimeMul ?? 1);
    const k = 1 - Math.exp(-(this.stun > 0 ? 2.4 : 2.2) * dt); this.vel.x += (want.x * sp - this.vel.x) * k; this.vel.y += (want.y * sp - this.vel.y) * k; this.vel.z += (want.z * sp - this.vel.z) * k;
    this.pos.addScaledVector(this.vel, dt); L.collideSphere(this.pos, 0.55, this.vel);
    const fl = L.floorAt(this.pos.x, this.pos.z); if (this.pos.y < fl + 0.7) { this.pos.y = fl + 0.7; if (this.vel.y < 0) this.vel.y = 0; }
    this.pos.y = Math.min(this.pos.y, wy - 0.75); if (this.vel.y > 0 && this.pos.y >= wy - 0.75) this.vel.y = 0;
    if (L.depthAt(this.pos.x, this.pos.z) < 1.6) { this.vel.x *= 0.5; this.vel.z *= 0.5; }              // never beach
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.atkT > 0 && sees) this.yaw += angleDelta(this.yaw, Math.atan2(dx, dz)) * Math.min(1, 8 * dt); else if (hs > 0.25 && this.stun <= 0) this.yaw += angleDelta(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 3.6 * dt);
    const sw = clamp(this.vel.length() / 3, 0, 1), pitchV = Math.atan2(this.vel.y, Math.max(hs, 0.3));
    this.tiltX = damp(this.tiltX, 0.3 + 1.0 * sw - pitchV * 0.8, 3.5, dt);
    const pump = Math.sin(this.t * (5 + sw * 4)) * 0.5 * (0.25 + sw); this.legL.rotation.x = pump; this.legR.rotation.x = -pump;
    const lunge = this.atkT > 0 ? -1.6 + (1 - this.atkT / SEA.wind) * 2.2 : -0.2; this.armL.rotation.set(lunge, 0, -0.3); this.armR.rotation.set(lunge, 0, 0.3);
    this.breath -= dt; if (this.breath <= 0) { this.breath = rand(1.2, 2.6); L.bubble(this.pos.x, this.pos.y + 0.6, this.pos.z, 0.05, 0, 0.9, 0, 3); }
    this.bar.visible = true; this.apply(); const e = this.hitFlash * 4; this.mats[0].emissive.setRGB(e * 0.4, e, e * 0.8);
  }
  pickGoal2() { const L = this.L, s = this.spawn; for (let i = 0; i < 8; i++) { const x = s.x + rand(-25, 25), z = s.z + rand(-25, 25), dep = L.depthAt(x, z); if (dep >= SEA.minDepth) { this.goal.set(x, L.waterY - rand(1.5, Math.max(1.6, dep - 1)), z); this.goalT = rand(5, 9); return; } } this.goal.copy(this.pos); this.goalT = 3; }
}

export class SeaBots {
  constructor(game) {
    this.g = game; this.L = game.world.lagoon; this.list = []; this.t = 0; this.scanT = 0; this.due = 0; this.stats = { defeated: 0, spawned: 0 };
    for (let i = 0; i < SEA.max; i++) this.list.push(new ReefHunter(game));
    const q = new URLSearchParams(location.search); if (q.get('seares')) { const [a, b] = q.get('seares').split(',').map(Number); if (a > 0) { SEA.respawnMin = a; SEA.respawnMax = b > a ? b : a; } }
    this.pending = 0;
  }
  setRespawn(a, b) { SEA.respawnMin = Math.max(3, a); SEA.respawnMax = Math.max(SEA.respawnMin, b ?? a); }
  update(dt) {
    this.t += dt; const P = this.g.player, L = this.L; this.scanT -= dt;
    for (const b of this.list) { b.update(dt); if (!b.parked && b.dead && b.deadT > 4) { b.park(); this.stats.defeated++; this.pending++; this.due = Math.max(this.due, this.t) + 0; this.dueAt = (this.dueAt || []); this.dueAt.push(this.t + rand(SEA.respawnMin, SEA.respawnMax)); } }
    if (this.scanT > 0) return; this.scanT = 1.2;
    for (const b of this.list) if (!b.parked && !b.dead && Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z) > SEA.sleepR) b.park();
    const active = this.list.filter(b => !b.parked).length, free = this.list.find(b => b.parked); if (!free || active >= SEA.max) return;
    // bodies that were defeated come back only after their own timer; the first SEA.max are free to appear
    const wait = (this.dueAt || []).filter(t => t > this.t).length; if (this.list.filter(b => !b.parked).length + wait >= SEA.max) return;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, 6.283), r = rand(SEA.spawnMin, SEA.spawnMax), x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r, dep = L.depthAt(x, z);
      if (dep < SEA.minDepth + 1 || !L.inRect(x, z, 0)) continue;
      free.spawnAt(_v.set(x, L.waterY - rand(1.5, Math.min(dep - 0.8, 6)), z)); this.stats.spawned++; break;
    }
  }
}
