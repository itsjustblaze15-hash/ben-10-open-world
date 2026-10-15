// BEN TENNYSON - the default playable human (his own GLB, textures / materials untouched).
// Plain human: walk / run / sprint / jump, weak punches with a short combo, a low HP pool of his own, knock-back reactions through the shared impact system. NO powers, NO flight.
// Animation is procedural on the procedural bone tree from animations/benrig.js (the GLB is one static mesh). Everything is posed in MODEL space (+Y up, +Z forward, +X = Ben's left).
// Runs on PLAYER time. Interface = the same controller interface every alien uses: updatePhysics / updatePowers / updateAnim / keyDown / keyUp / mouseDown / mouseUp / activate / deactivate.
import * as THREE from 'three';
import { BEN_SCALE } from '../animations/benrig.js';
import { meleeAim } from './aimassist.js';
import { hitFX } from './impact.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';

export const BCFG = { walk: 2.7, run: 5.6, sprint: 8.2, sprintAfter: 1.1, accelGround: 30, decelGround: 26, accelAir: 9, jumpV: 8.6, gravity: 25, crouchTime: 0.09, radius: 0.36, height: 1.5, step: 0.35, hp: 100, regenAfter: 7, regen: 2.2 };
const COMBO = [   // weak punches: damage, knock-back, reach, half-arc, duration, hit moment (fraction), lunge m/s
  { side: 'R', name: 'JAB',   dmg: 5,  knock: 2.4, range: 1.55, half: 0.95, dur: 0.34, hitAt: 0.45, lunge: 1.6, win: 0.55 },
  { side: 'L', name: 'CROSS', dmg: 6,  knock: 3.0, range: 1.60, half: 0.95, dur: 0.36, hitAt: 0.45, lunge: 1.9, win: 0.55 },
  { side: 'R', name: 'HOOK',  dmg: 9,  knock: 5.2, range: 1.70, half: 1.10, dur: 0.50, hitAt: 0.52, lunge: 2.6, win: 0.30 },
];
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1), AY = new THREE.Vector3(0, 1, 0);
const QDOWN_L = new THREE.Quaternion().setFromAxisAngle(AZ, -Math.PI / 2), QDOWN_R = new THREE.Quaternion().setFromAxisAngle(AZ, Math.PI / 2);   // rest (T-pose) arm direction +-X  ->  hanging straight down
const L1 = 0.41, L2 = 0.35;                                                                                                                      // thigh / shin length in model units (hip 0.96, knee 0.55, ankle 0.20)

/** the reference arm pose: hanging beside the body, slight elbow bend, forearm turned a touch inward (hands near the hips), no abduction */
export const ARM_REST = { f: 0.05, e: 0.30, o: 0.025, yin: 0.12 };
export class BenPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'ben'; this.rad = BCFG.radius; this.colH = BCFG.height; this.cfg = BCFG;
    this.root = new THREE.Group(); this.root.name = 'Ben'; rig.modelGroup.scale.setScalar(rig.scale); this.root.add(rig.modelGroup); game.scene.add(this.root);
    this.pos = this.root.position; this.pos.set(0, 0, 14); this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground';
    this.crouchT = 0; this.jumpBuffer = 0; this.speed = 0; this.landImpact = 0; this.hasInput = false; this.state = 'IDLE'; this.runT = 0;
    this.hp = BCFG.hp; this.hpT = 0; this.hitSphere = { y: 0.8, r: 0.55 }; this.act = null; this.comboIdx = 0; this.comboWin = 0; this.queued = false; this.lmbDown = false; this.lunge = null;
    this.flinch = 0; this.flinchDir = 0; this.stats = { punches: 0, hits: 0, jumps: 0, landings: 0, hurt: 0 };
    this.an = { ph: 0, mv: 0, run: 0, spr: 0, air: 0, land: 0, landV: 0, crouch: 0, turn: 0, lean: 0, t: 0, lastStep: 0, prevSpeed: 0, accel: 0, vy: 0, omni: 0, press: 0, flinch: 0, punch: null, pw: 0, look: 0 };
    this.omni = { raise: 0, press: 0 };            // driven by src/omnitrix.js while the transformation is being activated (0..1 each)
    this.nodes = {}; for (const k in rig.bones) this.nodes[k] = rig.bones[k];
    this.root.rotation.y = this.yaw; this.root.visible = true; this.root.updateMatrixWorld(true);
    this.pose(0.016);
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  /** called when Ben takes over (the Omnitrix timer ended, or at the start): same position / facing / velocity, put on a valid spot */
  activate(from) {
    const g = this.g, w = g.world;
    this.pos.copy(from.pos); this.vel.copy(from.vel); this.vel.multiplyScalar(0.8); this.yaw = from.yaw; this.root.rotation.y = this.yaw;
    this.cancelAll(); this.flinch = 0; this.crouchT = 0; this.landImpact = 0; this.mode = 'air'; this.grounded = false;
    this.safePlace();
    this.root.visible = true; this.root.updateMatrixWorld(true); this.an.land = this.an.landV = 0; this.pose(0.016);
  }
  deactivate() { this.cancelAll(); this.root.visible = false; }
  /** never inside a wall, never in deep water, never under the ground (airborne reverts keep their height and simply fall) */
  safePlace() {
    const g = this.g, w = g.world, p = this.pos;
    if (w.lagoon && w.lagoon.keepOut) w.lagoon.keepOut(p, this.rad * 1.2);
    w.resolveXZ(p, this.rad, p.y, this.colH, BCFG.step);
    if (w.lagoon && w.lagoon.keepOut) w.lagoon.keepOut(p, this.rad * 1.2);
    // pushed out of any solid box he might still overlap (revert from inside a building footprint / on a roof edge)
    for (let k = 0; k < 6; k++) {
      let moved = false;
      for (const b of w.boxes) {
        if (b.noCollide || p.y >= b.max.y - 0.05 || p.y + this.colH <= b.min.y + 0.05) continue;
        if (p.x > b.min.x - this.rad * 0.5 && p.x < b.max.x + this.rad * 0.5 && p.z > b.min.z - this.rad * 0.5 && p.z < b.max.z + this.rad * 0.5 && p.y < b.max.y - 0.35) {
          const dl = p.x - b.min.x, dr = b.max.x - p.x, dn = p.z - b.min.z, df = b.max.z - p.z, m = Math.min(dl, dr, dn, df);
          if (m === dl) p.x = b.min.x - this.rad - 0.05; else if (m === dr) p.x = b.max.x + this.rad + 0.05; else if (m === dn) p.z = b.min.z - this.rad - 0.05; else p.z = b.max.z + this.rad + 0.05; moved = true;
        }
      }
      if (!moved) break;
    }
    const gy = w.groundAt(p.x, p.z, p.y, 0.4, this.rad * 0.6);
    if (p.y <= gy + 0.05) { p.y = gy; this.grounded = true; this.mode = 'ground'; this.vel.y = 0; } else { this.grounded = false; this.mode = 'air'; this.vel.y = Math.min(this.vel.y, 2); }
  }
  get busy() { return !!this.act; }
  cancelAll() { this.act = null; this.lunge = null; this.queued = false; this.lmbDown = false; this.comboWin = 0; this.an.punch = null; this.an.pw = 0; }
  keyDown() { } keyUp() { } mouseUp() { this.lmbDown = false; }
  mouseDown() { this.lmbDown = true; if (this.act) { if (this.act.t > this.act.C.dur * 0.35) this.queued = true; return; } this.startPunch(); }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const g = this.g, w = g.world, R = BCFG;
    const fwd = _v.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _v2.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = this._want || (this._want = new THREE.Vector3()); want.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX);
    const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize(); this.hasInput = hasInput;
    this.camYaw = camYaw; this.landImpact = 0;
    // walk / run / sprint (sprint = holding Shift for a while; it ends the moment he stops or lets go)
    if (input.run && hasInput && this.grounded) this.runT += dt; else if (!input.run || !hasInput) this.runT = Math.max(0, this.runT - dt * 3);
    const act = this.act;
    let top = !input.run ? R.walk : this.runT > R.sprintAfter ? R.sprint : R.run; if (act) top *= 0.5;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.14;
    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !act) { this.mode = 'crouch'; this.crouchT = 0; this.jumpBuffer = 0; }
    if (this.mode === 'crouch') { this.crouchT += dt; top *= 0.6; if (this.crouchT >= R.crouchTime) { this.vel.y = R.jumpV; this.grounded = false; this.mode = 'air'; this.stats.jumps++; this.takeoffFX(); } }
    {
      const tx = want.x * top * (hasInput ? 1 : 0), tz = want.z * top * (hasInput ? 1 : 0), dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const rate = this.grounded ? (hasInput ? R.accelGround : R.decelGround) : R.accelAir, m = Math.min(dl, rate * dt); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    // vertical
    const prevY = this.pos.y;
    if (!this.grounded) { const grav = R.gravity; if (!input.jumpHeld && this.vel.y > 3.5 && this.mode === 'air') this.vel.y -= grav * 1.4 * dt; this.vel.y = Math.max(-45, this.vel.y - grav * dt); }
    // integrate + collide (sub-stepped so a sprint cannot tunnel through a thin wall)
    const sp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(8, Math.ceil(sp / 0.3))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h;
      if (this.lunge && this.lunge.t > 0) { this.pos.x += this.lunge.dir.x * this.lunge.speed * h; this.pos.z += this.lunge.dir.z * this.lunge.speed * h; }
      w.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, this.grounded ? R.step : 0.05);
    }
    if (this.lunge) this.lunge.t -= dt;
    if (this.mode !== 'crouch') this.pos.y += this.vel.y * dt;
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? R.step : 0.05, this.rad * 0.6);
    if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -3.5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    for (const b of w.boxes) { if (b.min.y > this.pos.y + this.colH - 0.4 && b.min.y < this.pos.y + this.colH + 0.1 && this.vel.y > 0 && this.pos.x > b.min.x - 0.3 && this.pos.x < b.max.x + 0.3 && this.pos.z > b.min.z - 0.3 && this.pos.z < b.max.z + 0.3) this.vel.y = 0; }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // facing
    let target = this.yaw, k = 13;
    if (act && act.face !== undefined) { target = act.face; k = 22; }
    else if (this.speed > 0.5 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 12 : 8; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 14, dt);
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------------------ combat: weak punches
  startPunch() {
    if (this.g.impact && this.g.impact.blocksAttack) return;
    if (this.comboWin <= 0) this.comboIdx = 0;
    const C = COMBO[this.comboIdx % COMBO.length];
    const a = meleeAim(this.g, this.pos, 4.5), face = a.target || a.dist > 0 ? a.yaw : this.yaw;
    const tp = a.target && a.target.root ? a.target.root.position : null, pitch = tp ? clamp(Math.atan2(tp.y + (a.target.hitSphere ? 0 : 0.9) - (this.pos.y + 1.0), Math.max(0.6, a.dist || Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z))), -0.45, 0.6) : 0;
    this.act = { C, t: 0, hit: false, idx: this.comboIdx % COMBO.length, face, pitch }; this.queued = false; this.comboIdx++; this.stats.punches++;
    this.an.punch = this.act; this.g.sfx.whoosh && this.g.sfx.whoosh();
  }
  updatePowers(dt) {
    this.comboWin = Math.max(0, this.comboWin - dt);
    // hp regen (slow: Ben is fragile)
    this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0 && this.hp < BCFG.hp) this.hp = Math.min(BCFG.hp, this.hp + BCFG.regen * dt);
    this.flinch = Math.max(0, this.flinch - dt);
    const a = this.act; if (!a) return;
    a.t += dt; const C = a.C;
    if (a.t >= C.dur * 0.12 && !a.lungeDone) { a.lungeDone = true; this.lungeStart(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), C.lunge, C.dur * 0.35); }
    if (!a.hit && a.t >= C.dur * C.hitAt) { a.hit = true; this.strike(C, a); }
    if (a.t >= C.dur) {
      this.act = null; this.an.punch = null; this.comboWin = C.win;
      if (this.queued || this.lmbDown) this.startPunch(); else this.queued = false;
      if (this.comboIdx >= COMBO.length) { /* the finisher ends the chain */ if (!this.act) this.comboIdx = 0; }
    }
  }
  lungeStart(dir, speed, dur) { this.lunge = { dir: dir.clone().setY(0).normalize(), speed, t: dur }; }
  strike(C, a) {
    const g = this.g, f = _v.set(Math.sin(a.face), 0, Math.cos(a.face)), O = this.pos; let n = 0;
    for (const h of g.world.hittables) {
      if (h.dead || h.held || !h.root) continue; const hp = h.root.position, dx = hp.x - O.x, dz = hp.z - O.z, d = Math.hypot(dx, dz), reach = C.range + (h.meleeRadius || 0.8) * 0.8; if (d > reach) continue;
      if (Math.abs(hp.y - O.y) > 3.2 && !(h.meleeRadius > 3)) continue;
      const ang = Math.acos(clamp((dx * f.x + dz * f.z) / (d || 1), -1, 1)); if (d > 0.9 && ang > C.half + (h.meleeRadius > 2 ? 0.5 : 0)) continue;
      const dir = d > 0.05 ? new THREE.Vector3(dx / d, 0, dz / d) : f.clone(), pt = new THREE.Vector3(hp.x, O.y + 0.95, hp.z).addScaledVector(dir, -Math.min(0.5, d * 0.5));
      h.applyHit(pt, dir, C.dmg); if (h.knock) h.knock(dir, C.knock); if (g.hud) g.hud.hit(pt, C.dmg, h);
      hitFX(g, pt, dir.clone().negate().setY(0.2).normalize(), 0.55 + 0.25 * a.idx, { color: [1, 0.9, 0.7], trauma: 0.04 });
      this.stats.hits++; n++;
    }
    if (n) g.camera.kick(0.012 + 0.01 * a.idx); a.landed = n;
  }

  // ------------------------------------------------------------------------------------------------ damage taken
  /** every enemy / boss attack arrives through ImpactSystem.damagePlayer -> here (Ben is fragile: he is not hurt less than anyone else, he simply has less HP) */
  onHit(dmg, pt, dir) {
    const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg); this.hpT = BCFG.regenAfter; this.stats.hurt++;
    this.flinch = 0.42; this.flinchDir = dir ? Math.atan2(dir.x, dir.z) : this.yaw + Math.PI;
    if (this.act && dmg > 3) this.cancelAll();
    if (this.hp <= 0) { this.hp = BCFG.hp * 0.6; g.hud.toast('SECOND WIND'); }
  }

  // ------------------------------------------------------------------------------------------------ FX
  takeoffFX() {
    const fx = this.g.fx, p = this.pos.clone(); p.y += 0.06; fx.surface.ring(p, UP, 1.0, 0.3);
    for (let i = 0; i < 4; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.2, 0.6), rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 1.8)), size: rand(0.3, 0.5), grow: 1.1, life: 0.5, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.4 });
  }
  landFX(v) {
    const fx = this.g.fx, k = clamp((v - 3.5) / 14, 0.1, 1), p = this.pos.clone(); p.y = Math.max(p.y, 0) + 0.06; this.stats.landings++; this.an.landV += 3 + 7 * k;
    fx.surface.ring(p, UP, 1.0 + 1.6 * k, 0.4);
    for (let i = 0; i < 4 + 8 * k; i++) fx.dust.emit({ pos: p.clone(), vel: new THREE.Vector3(rand(-1, 1), rand(0.1, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(1, 3.5) * (0.5 + k)), size: rand(0.35, 0.8), grow: 1.4, life: rand(0.4, 0.8), drag: 2.2, color: [0.62, 0.6, 0.57], alpha: 0.5 });
    this.g.camera.addTrauma(0.03 + 0.1 * k); this.g.sfx.thud(0.15 + 0.3 * k);
    if (this.protectLand) this.protectLand = false;
    else if (v > 17) { const dmg = (v - 17) * 2.4; this.hp = Math.max(1, this.hp - dmg); this.hpT = BCFG.regenAfter; this.flinch = 0.3; }      // a long fall hurts a ten-year-old
  }
  footstep(side) {
    const fx = this.g.fx, run = this.an.run; this.rig.markers[side === 'L' ? 'toeL' : 'toeR'].getWorldPosition(_v); _v.y = this.pos.y + 0.05;
    if (run > 0.3) for (let i = 0; i < 2; i++) fx.dust.emit({ pos: _v, vel: _v2.set(rand(-1, 1), rand(0.2, 0.6), rand(-1, 1)), size: rand(0.25, 0.45), grow: 1.1, life: 0.4, drag: 2.5, color: [0.62, 0.6, 0.57], alpha: 0.35 });
    if (run > 0.5) this.g.sfx.thud(0.04 + 0.05 * this.an.spr);
  }
  /** world position of the Omnitrix on his wrist (for the activation light) */
  watchPos(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.rig.markers.watch.getWorldPosition(out); }
  get fxScale() { return 0.6; }

  // ------------------------------------------------------------------------------------------------ animation
  updateAnim(dt) {
    const A = this.an; A.t += dt;
    const grounded = this.grounded || this.mode === 'crouch', sp = this.speed;
    A.mv = damp(A.mv, grounded ? smoothstep(0.3, 1.2, sp) : 0, 12, dt);
    A.run = damp(A.run, grounded ? smoothstep(3.0, 5.2, sp) : 0, 8, dt);
    A.spr = damp(A.spr, grounded ? smoothstep(6.2, 7.8, sp) : 0, 6, dt);
    A.air = damp(A.air, grounded ? 0 : 1, 14, dt);
    A.crouch = damp(A.crouch, this.mode === 'crouch' ? clamp(this.crouchT / BCFG.crouchTime, 0, 1) : 0, 24, dt);
    A.flinch = damp(A.flinch, this.flinch > 0 ? clamp(this.flinch / 0.3, 0, 1) : 0, 18, dt);
    A.omni = damp(A.omni, this.omni.raise, 14, dt); A.press = damp(A.press, this.omni.press, 20, dt);
    A.pw = damp(A.pw, this.act ? 1 : 0, 26, dt);
    const stride = (1.5 + 0.2 * sp) * (this.strideMul || 1);   // metres per full stride cycle  (a cycle = both legs)
    if (grounded && A.mv > 0.02) A.ph = (A.ph + (sp / stride) * Math.PI * 2 * dt) % (Math.PI * 2);
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 30, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    if (dt > 0) { A.landV += (-170 * A.land - 14 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.3, 1.2); }
    A.vy = damp(A.vy, this.vel.y, 10, dt);
    // footfalls
    const s = Math.floor(A.ph / Math.PI); if (grounded && A.mv > 0.3 && s !== A.lastStep) { A.lastStep = s; this.footstep(s % 2 ? 'R' : 'L'); } else if (!grounded) A.lastStep = Math.floor(A.ph / Math.PI);
    this.pose(dt);
    this.state = this.act ? 'PUNCH' : this.flinch > 0 ? 'HIT' : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : A.spr > 0.5 ? 'SPRINT' : A.run > 0.5 ? 'RUN' : A.mv > 0.4 ? 'WALK' : 'IDLE';
  }

  /** compose the pose from the animation numbers. All rotations are MODEL-space quaternions turned into bone-local ones. */
  pose(dt) {
    const A = this.an, B = this.nodes, rig = this.rig, t = A.t, ph = A.ph;
    const mv = A.mv, run = A.run, spr = A.spr, air = A.air, ground = 1 - air, land = clamp(A.land, 0, 1.2), cr = A.crouch;
    const idle = 1 - mv, fl = A.flinch, om = A.omni, pr = A.press;
    // ---- locomotion cycle
    const swing = (0.42 + 0.30 * run + 0.22 * spr) * mv * ground;                 // thigh swing (rad)
    const kneeBase = (0.16 + 0.35 * run + 0.35 * spr) * mv * ground;
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    let thL = swing * sL, thR = swing * sR;
    let kL = kneeBase * (0.5 + 0.5 * Math.cos(ph + 0.35)) + 0.25 * swing * Math.max(0, -Math.cos(ph)) * 0, kR = kneeBase * (0.5 + 0.5 * Math.cos(ph + Math.PI + 0.35));
    const swingKnee = (s, c) => (0.1 + 0.9 * Math.max(0, c)) * (0.25 + 0.75 * (run + spr * 0.3)) * mv * ground;     // the swing leg folds under him on its way forward
    kL = Math.max(0.04 * mv, swingKnee(sL, Math.cos(ph)) * 1.5 * (0.55 + 0.45 * run)); kR = Math.max(0.04 * mv, swingKnee(sR, Math.cos(ph + Math.PI)) * 1.5 * (0.55 + 0.45 * run));
    let armA = (0.30 + 0.45 * run + 0.45 * spr) * mv * ground;                     // arm swing, opposite to the legs
    // REFERENCE ARM POSE (arms hang beside the body, relaxed): every arm animation is this + an offset; nothing accumulates between frames
    const RP = ARM_REST, brArm = Math.sin(t * 1.9) * 0.012 * idle;
    let aUL = RP.f - armA * sL + brArm, aUR = RP.f - armA * sR + brArm, elL = RP.e + (0.18 + 0.12 * (1 - Math.cos(ph))) * mv * ground + 1.05 * run + 0.5 * spr + brArm * 2, elR = RP.e + (0.18 + 0.12 * (1 - Math.cos(ph + Math.PI))) * mv * ground + 1.05 * run + 0.5 * spr + brArm * 2;     // upper-arm forward angle / forearm extra flex
    let outL = RP.o + 0.02 * mv + 0.01 * brArm, outR = outL;
    let lean = (0.04 * mv + 0.10 * run + 0.12 * spr + 0.10 * A.accel) * ground, twist = Math.sin(ph) * (0.10 + 0.14 * run) * mv * ground;
    let bob = Math.abs(Math.cos(ph)) * (0.012 + 0.02 * run) * mv * ground, sway = Math.cos(ph) * 0.012 * mv * ground;
    const breathe = Math.sin(t * 1.9) * 0.012 * idle;
    let headLook = 0, headPitch = 0, shiftRoll = 0;
    if (idle > 0.5 && ground > 0.5 && !this.act) {      // quiet idle life: a slow weight shift, a small head drift (all tiny, all smooth, never robotic)
      const sh = Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1.3); shiftRoll = sh * 0.035 * idle;
      headLook = (Math.sin(t * 0.41 + 0.6) * 0.05 + Math.sin(t * 0.97) * 0.012) * idle; headPitch += Math.sin(t * 0.29 + 2.0) * 0.02 * idle;
    }
    // ---- airborne
    if (air > 0.01) {
      const rise = clamp(A.vy / 8, -1, 1);
      const lt = 0.55 * (rise > 0 ? 1 : 0.35), rt = 0.1;
      thL = lerp(thL, lt, air); kL = lerp(kL, 0.95 * (rise > 0 ? 1 : 0.45), air); thR = lerp(thR, rt, air); kR = lerp(kR, 0.35, air);
      aUL = lerp(aUL, 0.35 - rise * 0.9, air); aUR = lerp(aUR, 0.35 - rise * 0.9, air); elL = lerp(elL, 0.5, air); elR = lerp(elR, 0.5, air); outL = lerp(outL, 0.55 + 0.35 * (rise < 0 ? 1 : 0), air); outR = outL;
      lean = lerp(lean, 0.06 - rise * 0.05, air);
    }
    // ---- crouch / landing absorption
    const sink = cr * 0.7 + land * 0.8;      // knee bend
    if (sink > 0.01) { const g1 = ground; thL += sink * 0.55 * g1; thR += sink * 0.55 * g1; kL += sink * 1.0 * g1; kR += sink * 1.0 * g1; lean += sink * 0.18 * g1; aUL += sink * 0.3; aUR += sink * 0.3; }
    // ---- punches (the striking arm overrides the swing; the torso twists into it)
    let punchHipYaw = 0, punchTwist = 0, punchLean = 0, punchStep = 0, aimPitch = 0;
    const P = this.act ? { a: this.act, u: clamp(this.act.t / this.act.C.dur, 0, 1) } : null;
    let armOverride = { L: null, R: null };
    if (P) {
      const C = P.a.C, u = P.u, hit = C.hitAt, pw = A.pw;
      // wind-up (0..hit): fist back at the chin, shoulder back;  strike (hit..hit+0.2): arm extends;  recover
      const w = smoothstep(0, hit, u), s = smoothstep(hit - 0.12, hit + 0.06, u), rec = smoothstep(hit + 0.12, 1, u), ext = s * (1 - rec);
      const side = C.side === 'R' ? -1 : 1;        // R punch: torso twists toward the left (positive yaw twist swings his right shoulder forward)
      const hook = P.a.idx === 2;
      const up = lerp(0.45, 1.5, ext) * (1 - w * 0.0), el = lerp(2.3, 0.15, ext);
      const f = lerp(0.2 + 0.9 * w, up, s) * (1 - rec * 0.85), e = lerp(lerp(0.3, 2.35, w), el, s) * (1 - rec) + 0.4 * rec;
      aimPitch = (P.a.pitch || 0) * ext; armOverride[C.side] = { f: f + (hook ? 0.2 * ext : 0) + aimPitch, e: hook ? lerp(e, 1.2, ext) : e, out: hook ? lerp(0.25, 1.0, ext) : lerp(0.25, 0.0, ext), blend: pw };
      const other = C.side === 'R' ? 'L' : 'R'; armOverride[other] = { f: 0.30 + 0.15 * w, e: 1.5, out: 0.10, blend: pw * 0.8 };            // the other arm stays close to the body (loose guard in front of the ribs)
      punchTwist = (C.side === 'R' ? 1 : -1) * (-0.35 * w * (1 - s) + 0.55 * ext) * pw; punchLean = (0.08 + 0.12 * ext) * pw; punchHipYaw = punchTwist * 0.6; punchStep = ext * pw;
    }
    // ---- Omnitrix activation (raise the left forearm, flip the dial with the right hand)
    if (om > 0.001) {
      armOverride.L = { f: 0.62, e: 1.05, out: 0.02, yin: 1.0, blend: om, wrist: 1 };                              // left forearm held forward across the chest, watch face toward him
      armOverride.R = { f: 0.55 + 0.1 * pr, e: 1.1 - 0.12 * pr, out: 0.05, yin: 0.85 + 0.15 * pr, blend: om };       // right hand comes over and flips the dial
      lean += 0.07 * om; headPitch += 0.24 * om; twist += 0.18 * om;
    }
    // ---- flinch (hit reaction pose: torso rocks back, arms fly up, head snaps)
    if (fl > 0.01) {
      const back = -(0.42 * fl); punchLean += back; aUL += 0.55 * fl; aUR += 0.55 * fl; elL += 0.5 * fl; elR += 0.5 * fl; outL += 0.35 * fl; outR += 0.35 * fl; headPitch -= 0.28 * fl; thL += 0.12 * fl; thR -= 0.18 * fl;
    }
    // ---- apply
    const dyLeg = (th, k) => -(L1 * Math.cos(th) + L2 * Math.cos(th - k));
    const soleL = dyLeg(thL, kL), soleR = dyLeg(thR, kR);        // negative numbers: how far each ankle hangs below the hip
    const rest = -(L1 + L2);
    const hipDrop = ground * clamp(rest - Math.min(soleL, soleR), -0.5, 0) + bob - breathe * 0.2;      // the lowest foot stays on the ground; bob on top
    const R_ = rig.rest;
    const set = (name, q) => { const b = B[name]; const pq = this.parentModelQ(b, _q2); b.quaternion.copy(pq.invert()).multiply(q); };
    const mq = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a);
    // body
    B.hips.position.set(R_.hips.pos.x, R_.hips.pos.y + hipDrop, R_.hips.pos.z);
    const hipsQ = mq(AY, twist * -0.5 + punchHipYaw * 0.0).multiply(mq(AX, lean * 0.45 + punchLean * 0.4)).multiply(mq(AZ, sway - shiftRoll * 0.5));
    B.hips.quaternion.copy(hipsQ);
    set('spine', mq(AY, twist * 0.5 + punchTwist * 0.4).multiply(mq(AX, lean * 0.7 + punchLean * 0.4 + breathe * 0.5)).multiply(mq(AZ, shiftRoll * 0.6)));
    set('chest', mq(AY, twist * 0.5 + punchTwist * 0.6).multiply(mq(AX, lean * 0.6 + punchLean * 0.4 + breathe)));
    set('neck', mq(AX, -lean * 0.8 - punchLean * 0.6 + headPitch * 0.4).multiply(mq(AY, -twist * 0.8 - punchTwist * 0.8)));
    set('head', mq(AX, headPitch * 0.6 - lean * 0.3).multiply(mq(AY, headLook)).multiply(mq(AZ, -shiftRoll * 0.5)));
    // legs: thigh swings about X (forward +), shin = thigh - knee bend, foot stays level-ish
    for (const [sd, th, k, sg] of [['L', thL, kL, 1], ['R', thR, kR, -1]]) {
      const spread = 0.05 + 0.1 * air * (sd === 'L' ? 0.6 : 1);
      set('thigh' + sd, mq(AX, -th).multiply(mq(AZ, sg * spread)));
      set('shin' + sd, mq(AX, -(th - k)).multiply(mq(AZ, sg * spread * 0.6)));
      const toe = (sd === 'L' ? sL : sR); const push = clamp(-Math.sin(sd === 'L' ? ph + 0.9 : ph + Math.PI + 0.9), 0, 1) * 0.5 * (run * 0.7 + 0.3) * mv * ground;
      set('foot' + sd, mq(AX, -(th - k) * 0.35 + push * 0.0 + (air > 0.01 ? -0.3 * air + 0.0 : 0)).multiply(mq(AX, 0)));
      void toe;
    }
    // arms
    for (const [sd, aU, el, out] of [['L', aUL, elL, outL], ['R', aUR, elR, outR]]) {
      let f = aU, e = el, o = out, wr = 0, yin = RP.yin * (1 - clamp(A.pw + A.omni + A.air, 0, 1)); const ov = armOverride[sd];
      if (ov) { const bl = clamp(ov.blend, 0, 1); f = lerp(f, ov.f, bl); e = lerp(e, ov.e, bl); o = lerp(o, ov.out, bl); wr = (ov.wrist || 0) * bl; yin = lerp(yin, ov.yin || 0, bl); }
      const sg = sd === 'L' ? 1 : -1, base = sd === 'L' ? QDOWN_L : QDOWN_R;
      // upper arm: hanging down, swung forward by f, abducted by o ;  forearm: continues, flexed forward by e ;  hand: follows the forearm
      const qU = mq(AX, -f).multiply(mq(AZ, sg * o)).multiply(base);
      const qF = mq(AY, -sg * yin).multiply(mq(AX, -(f + e))).multiply(mq(AZ, sg * o * 0.4)).multiply(base);
      set('uarm' + sd, qU); set('farm' + sd, qF);
      const qH = mq(AY, -sg * yin).multiply(mq(AX, -(f + e + 0.1 + 0.25 * wr))).multiply(mq(AZ, sg * o * 0.3)).multiply(base);
      set('hand' + sd, qH);
    }
    this.root.updateMatrixWorld(true);
  }
  /** quaternion of a bone's PARENT expressed in model space (identity above the hips) */
  parentModelQ(bone, out) {
    out.identity(); const chain = []; for (let p = bone.parent; p && p.isBone; p = p.parent) chain.push(p);
    for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
    return out;
  }
  hudUpdate() {
    const $ = id => document.getElementById(id); const el = $('ben-hp'); if (el) el.style.width = (this.hp / BCFG.hp * 100) + '%';
    const s = $('ben-state'); if (s) s.textContent = this.state;
  }
  debugText() {
    const p = this.pos; return `FPS ${this.g.fps ? this.g.fps.toFixed(0) : '-'}   BEN TENNYSON   state ${this.state}\nspeed ${this.speed.toFixed(1)} m/s   grounded ${this.grounded ? 'y' : 'n'}   hp ${this.hp.toFixed(0)}/${BCFG.hp}\npos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\npunches ${this.stats.punches}  hits ${this.stats.hits}  jumps ${this.stats.jumps}  landings ${this.stats.landings}  hurt ${this.stats.hurt}\nGLB: ${this.rig.report.meshes} meshes · ${this.rig.report.verts} verts · no skeleton in the file → procedural ${this.rig.report.bones}-bone rig + procedural animation`;
  }
}
