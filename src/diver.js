// Underwater training dummies for Ripjaws: they hang and drift inside the lagoon, can be chased, bitten and clawed, and react with water physics
// (heavy drag, short stagger, small knock-back - no explosions). They never attack. Extends the shared Hittable so every alien's projectiles can also hit them.
import * as THREE from 'three';
import { Hittable } from './dummies.js';
import { clamp, damp, rand, angleDelta } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const M = (c, r = 0.7, m = 0.1, e = null) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...(e ? { emissive: e, emissiveIntensity: 1.0 } : {}) });

export class Diver extends Hittable {
  constructor(game, pos, label = 'DIVER') {
    super(game.world); this.g = game; this.L = game.world.lagoon; this.kind = 'diver'; this.label = label; this.isDiver = true;
    this.spawn = pos.clone(); this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.yaw = rand(0, 6.28); this.tiltX = 0.25; this.stun = 0; this.deadT = 0; this.respawnT = 0; this.t = rand(0, 10); this.goal = pos.clone(); this.goalT = 0; this.chase = null; this.held = false; this.breath = rand(0.5, 2);
    const r = this.root = new THREE.Group(); r.position.copy(pos); game.scene.add(r);
    const suit = M(0x2b3d4f, 0.65), stripe = M(0xe2742c, 0.6), skin = M(0xc9a97a, 0.8), mask = M(0x0f1a22, 0.25, 0.3, 0x0a5a64), tank = M(0xb4c0c8, 0.35, 0.7), fin = M(0xe2742c, 0.6);
    this.mats = [suit, stripe, skin, fin];
    const add = (geo, mat, x, y, z, par = r) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; par.add(m); return m; };
    add(new THREE.CapsuleGeometry(0.34, 0.62, 6, 14), suit, 0, 0.12, 0); add(new THREE.CylinderGeometry(0.355, 0.355, 0.16, 16), stripe, 0, 0.18, 0); add(new THREE.SphereGeometry(0.26, 16, 12), skin, 0, 0.88, 0.02);
    add(new THREE.BoxGeometry(0.4, 0.2, 0.12), mask, 0, 0.9, 0.24); add(new THREE.CylinderGeometry(0.15, 0.15, 0.85, 12), tank, 0, 0.2, -0.45); add(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), M(0x555b60, 0.5, 0.6), 0, 0.72, -0.45);
    this.armL = new THREE.Group(); this.armL.position.set(0.44, 0.5, 0); this.armR = new THREE.Group(); this.armR.position.set(-0.44, 0.5, 0); r.add(this.armL, this.armR);
    for (const a of [this.armL, this.armR]) add(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), suit, 0, -0.32, 0, a);
    this.legL = new THREE.Group(); this.legL.position.set(0.17, -0.45, 0); this.legR = new THREE.Group(); this.legR.position.set(-0.17, -0.45, 0); r.add(this.legL, this.legR);
    for (const l of [this.legL, this.legR]) { add(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), suit, 0, -0.3, 0, l); add(new THREE.BoxGeometry(0.26, 0.04, 0.55), fin, 0, -0.78, 0.12, l); }
    this.spheres = [{ local: new THREE.Vector3(0, 0.1, 0), r: 0.52 }, { local: new THREE.Vector3(0, 0.88, 0.02), r: 0.32 }, { local: new THREE.Vector3(0, -0.6, 0), r: 0.4 }];
    this.rad = 0.62; this.maxHp = this.hp = 100;
    const c = this.barCanvas = document.createElement('canvas'); c.width = 128; c.height = 16; this.barTex = new THREE.CanvasTexture(c);
    this.bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barTex, transparent: true, depthWrite: false })); this.bar.scale.set(1.3, 0.16, 1); game.scene.add(this.bar); this.drawBar();
    this.L.tintObject(r); this.world.hittables.push(this); this.apply();
  }
  drawBar() { const g = this.barCanvas.getContext('2d'); g.clearRect(0, 0, 128, 16); g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 128, 16); g.fillStyle = this.hp / this.maxHp > 0.35 ? '#46d8e8' : '#ff5a4a'; g.fillRect(3, 3, 122 * clamp(this.hp / this.maxHp, 0, 1), 10); this.barTex.needsUpdate = true; }
  /** a hit from anyone: small push (water resistance), short stagger, damage */
  applyHit(point, dir, dmg) {
    if (this.dead) return; this.hp = Math.max(0, this.hp - dmg); this.hitFlash = 0.16; this.drawBar(); this.stun = Math.max(this.stun, 0.55);
    _v.copy(dir); if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1); _v.normalize(); this.vel.addScaledVector(_v, clamp(0.8 + dmg * 0.045, 0.8, 3.2)); this.spin = (Math.random() - 0.5) * 5;
    this.L.bubbleBurst(point, 5, 0.25, 0.8, 0.05);
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; this.respawnT = 4.5; this.stun = 99; this.L.bubbleBurst(this.pos, 14, 0.5, 1.0, 0.08); }
  }
  shove(dir, speed) { this.vel.x += dir.x * Math.min(speed * 0.3, 3); this.vel.z += dir.z * Math.min(speed * 0.3, 3); this.vel.y += (dir.y || 0) * Math.min(speed * 0.3, 3); this.stun = Math.max(this.stun, 0.3); }
  launch(vy) { this.vel.y += clamp(vy * 0.25, 0, 2); }
  knock(dir, f) { this.shove(dir, f); }
  release() { this.held = false; }
  respawn() { this.dead = false; this.hp = this.maxHp; this.pos.copy(this.spawn); this.vel.set(0, 0, 0); this.stun = 0; this.deadT = 0; this.drawBar(); this.goalT = 0; for (const m of this.mats) { m.transparent = false; m.opacity = 1; } this.apply(); }
  pickGoal() {
    const L = this.L; this.goal.set(rand(L.x0 + 1.6, L.x1 - 1.6), rand(-3.6, -1.0), rand(L.z0 + 6, L.z1 - 1.8)); this.goalT = rand(4, 8);
  }
  update(dt) {
    this.t += dt; const L = this.L; this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);
    if (this.dead) {
      this.deadT += dt; this.respawnT -= dt; this.vel.y -= 1.6 * dt; this.vel.multiplyScalar(Math.exp(-1.6 * dt)); this.pos.addScaledVector(this.vel, dt); L.collideSphere(this.pos, 0.5, this.vel);
      const a = clamp(1 - this.deadT / 3.5, 0, 1); for (const m of this.mats) { m.transparent = true; m.opacity = 0.25 + 0.75 * a; }
      this.tiltX = damp(this.tiltX, 1.5, 3, dt); this.yaw += (this.spin || 0) * dt * 0.2; this.bar.visible = false; if (this.respawnT <= 0) this.respawn(); else this.apply(); return;
    }
    this.stun = Math.max(0, this.stun - dt); this.goalT -= dt;
    let sp = 0, want = _w.set(0, 0, 0);
    const P = this.g.player, hostile = this.chase && P && P.pos && L.inRect(P.pos.x, P.pos.z, 1) && (P.mode === 'swim' || L.depthAt(P.pos.x, P.pos.z) > 0.4);
    if (this.stun <= 0) {
      if (hostile) { _v.set(P.pos.x, P.pos.y + (P.mode === 'swim' ? 1.1 : 0.9), P.pos.z).sub(this.pos); const d = _v.length(); if (d > 1.9) { want.copy(_v).multiplyScalar(1 / d); sp = 2.9; } }
      else { if (this.goalT <= 0 || this.goal.distanceTo(this.pos) < 0.8) this.pickGoal(); _v.copy(this.goal).sub(this.pos); const d = _v.length(); if (d > 0.3) { want.copy(_v).multiplyScalar(1 / d); sp = 1.15 * Math.min(1, d / 2); } }
    }
    sp *= (this.slimeMul ?? 1);
    // water: velocity relaxes to the swim target, resistance bleeds off any hit impulse
    const k = 1 - Math.exp(-(this.stun > 0 ? 2.4 : 2.0) * dt); this.vel.x += (want.x * sp - this.vel.x) * k; this.vel.y += (want.y * sp - this.vel.y) * k; this.vel.z += (want.z * sp - this.vel.z) * k;
    this.vel.y += Math.sin(this.t * 0.9 + this.spawn.x) * 0.12 * dt;
    this.pos.addScaledVector(this.vel, dt); L.collideSphere(this.pos, 0.55, this.vel);
    this.pos.y = Math.min(this.pos.y, L.waterY - 0.75); if (this.vel.y > 0 && this.pos.y >= L.waterY - 0.75) this.vel.y = 0;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.25 && this.stun <= 0) this.yaw += angleDelta(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 3.2 * dt);
    else if (this.stun > 0 && this.spin) this.yaw += this.spin * dt * Math.min(1, this.stun * 2);
    const sw = clamp(this.vel.length() / 2.6, 0, 1), pitchV = Math.atan2(this.vel.y, Math.max(hs, 0.3));
    this.tiltX = damp(this.tiltX, 0.28 + 1.0 * sw - pitchV * 0.8, 3.5, dt);
    this.breath -= dt; if (this.breath <= 0) { this.breath = rand(1.4, 3); L.bubble(this.pos.x + rand(-0.1, 0.1), this.pos.y + 0.6, this.pos.z, 0.05, 0, 0.9, 0, 3); }
    this.legL.rotation.x = Math.sin(this.t * 5.2) * 0.45 * (0.25 + sw); this.legR.rotation.x = -Math.sin(this.t * 5.2) * 0.45 * (0.25 + sw); this.armL.rotation.set(-0.2 + Math.sin(this.t * 2.1) * 0.12, 0, -0.35); this.armR.rotation.set(-0.2 - Math.sin(this.t * 2.1) * 0.12, 0, 0.35);
    this.bar.visible = true; this.apply();
    const e = this.hitFlash * 4; this.mats[0].emissive.setRGB(e * 0.4, e, e * 0.8);
  }
  apply() { this.root.position.copy(this.pos); this.root.rotation.set(this.tiltX, this.yaw, 0, 'YXZ'); this.root.updateMatrixWorld(true); this.bar.position.set(this.pos.x, this.pos.y + 1.45, this.pos.z); }
}
