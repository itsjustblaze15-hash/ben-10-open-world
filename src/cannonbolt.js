// Cannonbolt controller. TWO forms, one body:
//  - NORMAL FORM (the standing GLB): a heavy walker. Idle (breathing / weight shift / arm sway / chest turn), walk (planted feet, hip sway), run, jump (prepare -> take-off -> fall -> landing with absorption),
//    turning (feet step when turning in place, lean when moving), punches. No flying, no floating. Procedural pose on the real skeleton (animations/cannonboltrig.js).
//  - BALL FORM (the ball GLB): src/cb_ball.js - rigid-sphere physics. Q curls the standing model into a tuck (hips / spine / chest fold, arms wrap, legs tuck, body drops), the ball model takes over
//    at the point the tuck hides the swap, and unrolling reverses it (the ball slows down first; if there is no room to stand it waits until there is).
// pos = the point on the ground under the feet / under the ball (root.y = pos.y). The ball centre is c = pos + (0, R, 0) while rolling.
import * as THREE from 'three';
import { CbPoser, CB_SCALE, BALL_R, SIDES } from '../animations/cannonboltrig.js';
import { V, D, mkPose } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { cbBall, BALL } from './cb_ball.js';
import { cbPowers } from './cb_powers.js';

export const CBCFG = { r: 0.7, h: 2.3, walk: 2.5, run: 6.0, accelG: 20, brake: 36, accelA: 5, grav: 26, hp: 420, jump: 9.0, prepT: 0.13, curlT: 0.56, curlSwap: 0.3, openT: 0.5 };
const PIV = 1.05, TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const sin = Math.sin, cos = Math.cos;
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const GOFF = { L: 0, R: 0.5 };

export class CbPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'cannonbolt'; this.cfg = CBCFG; this.rad = CBCFG.r; this.colH = CBCFG.h;
    this.root = new THREE.Group(); this.root.name = 'Cannonbolt';
    this.yawG = new THREE.Group(); this.root.add(this.yawG);
    this.tiltG = new THREE.Group(); this.tiltG.name = 'CannonboltLean'; this.tiltG.position.set(0, PIV, 0); this.yawG.add(this.tiltG);
    rig.modelGroup.scale.setScalar(CB_SCALE); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.squashG = new THREE.Group(); this.spinG = new THREE.Group(); this.root.add(this.squashG); this.squashG.add(this.spinG); this.spinG.add(rig.ball.inner); this.squashG.position.set(0, BALL_R, 0); this.squashG.visible = false;
    this.poser = new CbPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground'; this.speed = 0; this.camYaw = 0; this.state = 'IDLE';
    this.form = 'stand'; this.tr = null; this.hp = CBCFG.hp; this.hpT = 0; this.hitSphere = { y: 1.2, r: 0.95 }; this.input = null; this.wantDir = new THREE.Vector3(); this.hasInput = false;
    this.prepT = 0; this.landT = 0; this.flashT = 0; this.landImpact = 0; this.noRoom = false; this.ballPop = 1; this.standS = 1;
    this.stats = { hits: 0, punches: 0, heavies: 0, curls: 0, unrolls: 0, steps: 0, captures: 0, releases: 0, slams: 0, jumps: 0, flinches: 0, propHits: 0 };
    this.an = { t: 0, mv: 0, rn: 0, air: 0, crouch: 0, land: 0, landV: 0, lean: 0, roll: 0, turn: 0, gp: 0, curl: 0, flinch: 0, flinchDir: new THREE.Vector3(), look: 0, accel: 0, prevSpeed: 0, dropX: 0, sx: 0 };
    this.initBall(); this.initPowers(game);
    // ---- calibration from the bind pose (root at origin, yaw 0): where the feet / hips rest, so every IK target below is relative to the real skeleton
    this.yawG.rotation.y = 0; this.root.updateMatrixWorld(true); this.poser.apply(mkPose());
    this.footRest = {}; this.plant = {}; this.footNow = {}; this.hipRest = {};
    for (const k of SIDES) { this.footRest[k] = this.poser.ankleW[k].clone(); this.plant[k] = new THREE.Vector3(); this.footNow[k] = new THREE.Vector3(); this.hipRest[k] = rig.legs[k].hip.getWorldPosition(new THREE.Vector3()); }
    this.restY = (this.footRest.L.y + this.footRest.R.y) / 2;
    this.legLen = rig.legs.L.hip.getWorldPosition(new THREE.Vector3()).distanceTo(this.poser.kneeW.L) + this.poser.kneeW.L.distanceTo(this.poser.ankleW.L);
    this.hipH = this.hipRest.L.y - this.restY; this.step = null; this.armBase = { L: V(0, 0, 0), R: V(0, 0, 0) };
    this.yawG.rotation.y = this.yaw; this.root.visible = false; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  get flying() { return false; }
  get busy() { return !!this.act || !!this.tr; }
  get dmgMul() { return this.form === 'ball' ? 1.8 : 1; }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-sin(y), -cos(y)); }
  /** switched TO Cannonbolt: always arrives in normal form, same position / facing / momentum / camera */
  activate(from) {
    const w = this.g.world; this.cancelAll(); this.form = 'stand'; this.tr = null; this.noRoom = false; this.pos.copy(from.pos); this.yaw = from.yaw; this.vel.set(from.vel.x, clamp(from.vel.y, -14, 14), from.vel.z);
    const hs = Math.hypot(this.vel.x, this.vel.z), cap = CBCFG.run * 1.5; if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
    const gy = w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.4, 0.25); this.grounded = from.grounded && this.pos.y <= gy + 0.3; this.mode = this.grounded ? 'ground' : 'air'; this.prepT = this.landT = 0;
    w.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, 0.4); if (this.grounded) this.pos.y = gy; else this.pos.y = Math.max(this.pos.y, gy);
    const A = this.an; A.land = A.landV = 0; A.crouch = 0; A.lean = A.roll = 0; A.turn = 0; A.curl = 0; A.air = this.grounded ? 0 : 1; A.flinch = 0; this.ballPop = 1; this.standS = 1;
    this.speed = Math.hypot(this.vel.x, this.vel.z); this.yawG.rotation.y = this.yaw; this.yawG.visible = true; this.squashG.visible = false; this.tiltG.scale.setScalar(1); this.root.visible = true;
    this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016)); this.root.updateMatrixWorld(true); this.hint(false);
  }
  /** C pressed while Cannonbolt: passengers are released, rolling is switched off (he is put on his feet at a valid spot, speed capped), attacks cancelled - BEFORE the next alien appears */
  leave() {
    const wasBall = this.form === 'ball' || (this.tr && this.tr.kind === 'unroll');
    this.releaseAll('SWITCH');
    if (wasBall) this.forceStand(); this.tr = null; this.cancelAll(); this.input = null; this.hint(false); this.restoreMats();
    const e = document.getElementById('speedfx'); if (e && this.g.player === this) e.style.opacity = '0';
    const hs = Math.hypot(this.vel.x, this.vel.z), cap = 7; if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
    this.squashG.visible = false; this.yawG.visible = true; this.tiltG.scale.setScalar(1); this.an.curl = 0;
  }
  deactivate() { this.leave(); this.root.visible = false; }
  hint(on) { if (this.hintEl) this.hintEl.hidden = !on; }
  restoreMats() { for (const m of this.rig.bodyMats) if (m.emissive && m.userData.e0) m.emissive.copy(m.userData.e0); this.flashT = 0; }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    this.camYaw = camYaw; this.input = input; this.landImpact = 0;
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want);
    if (this.hp < CBCFG.hp) { this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0) this.hp = Math.min(CBCFG.hp, this.hp + dt * 10); }
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.restoreMats();
    if (this.tr) this.tickTransition(dt);
    if (this.form === 'ball') this.ballFrame(dt, input, want, hasInput); else this.standFrame(dt, input, want, hasInput);
  }
  standFrame(dt, input, want, hasInput) {
    const R = CBCFG, a = this.act, tr = this.tr, locked = (a && a.lockMove) || (tr && tr.kind === 'unroll');
    if (input.jump && this.mode === 'ground' && this.grounded && !locked && !tr && !(a && a.kind !== 'punch')) { this.mode = 'prep'; this.prepT = 0; }
    if (this.mode === 'prep') {
      this.prepT += dt; this.vel.x *= Math.exp(-7 * dt); this.vel.z *= Math.exp(-7 * dt); this.integrate(dt, this.pos.y, CBCFG.h); this.faceUpdate(dt, want, hasInput);
      if (this.prepT >= R.prepT) { this.mode = 'air'; this.grounded = false; this.vel.y = R.jump; this.pos.y += 0.04; this.stats.jumps++; this.g.sfx.thud(0.2); this.dustRing(0.6); }
      return;
    }
    let top = (input.run ? R.run : R.walk) * (a ? (a.speedMul ?? 0.6) : 1) * (tr ? 0.35 : 1); if (locked) top = 0; if (this.mode === 'landing') top *= 0.5;
    const mvv = a ? a.moveVel : null;
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; if (!this.grounded) this.vel.y = mvv.y; }
    else {
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const rate = (this.grounded ? (hasInput ? R.accelG : R.brake) : R.accelA) * dt, m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    const prevY = this.pos.y; if (!this.grounded) this.vel.y = Math.max(-45, this.vel.y - R.grav * dt);
    this.integrate(dt, prevY, CBCFG.h);
    if (this.mode === 'landing') { this.landT += dt; if (this.landT >= 0.26) this.mode = 'ground'; }
    this.faceUpdate(dt, want, hasInput);
  }
  integrate(dt, prevY, H) {
    const w = this.g.world, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(8, Math.ceil(hsp / 0.3))), h = dt / n, rad = this.rad;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, rad, this.pos.y, H, this.grounded ? 0.4 : 0.05);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
    }
    const y0 = this.pos.y; this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) for (const b of w.boxes) {
      if (b.min.y >= y0 + H - 0.05 && b.min.y < this.pos.y + H && this.pos.x > b.min.x - rad * 0.7 && this.pos.x < b.max.x + rad * 0.7 && this.pos.z > b.min.z - rad * 0.7 && this.pos.z < b.max.z + rad * 0.7) { this.pos.y = b.min.y - H; this.vel.y = 0; }
    }
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, rad * 0.6);
    if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
      if (this.mode === 'air') { this.mode = this.landImpact > 5 ? 'landing' : 'ground'; this.landT = 0; }
    } else if (this.grounded && this.pos.y > gy + 0.08) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded) this.pos.y = gy;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  faceUpdate(dt, want, hasInput) {
    const a = this.act; let target = this.yaw, k = 9;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 18; }
    else if (this.speed > 0.6 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 8 : 4; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 7; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 9, dt);
    this.yawG.rotation.y = this.yaw;
  }
  dustRing(k) { const g = this.g, c = _a.set(this.pos.x, this.pos.y + 0.1, this.pos.z); g.fx.surface.ring(c.clone(), UP, 2.6 * k + 1.5, 0.3, 0xd8d2b8); for (let i = 0; i < 12 * k + 4; i++) { const a = rand(0, TAU), s = rand(1, 3 + 2 * k); g.fx.dust.emit({ pos: c, vel: _b.set(cos(a) * s, rand(0.2, 1), sin(a) * s), size: rand(0.2, 0.5), life: rand(0.4, 0.8), drag: 2.2, grav: 0.5, color: [0.7, 0.66, 0.57], alpha: 0.5 }); } }
  landFX(v) { const k = clamp((v - 4) / 18, 0, 1); this.an.landV += 3 + 7 * k; this.g.camera.addTrauma(0.05 + 0.2 * k); this.g.sfx.thud(0.2 + 0.5 * k); this.dustRing(k); }

  // ------------------------------------------------------------------------------------------------ forms: curl / unroll
  canTransform() { return !this.tr && !this.cap && !this.rel && !(this.act && this.act.lockMove) && this.mode !== 'prep'; }
  /** Q on foot: tuck. The standing body folds for CURL_SWAP seconds, then the ball takes over (physics from then on) while the tuck finishes shrinking away */
  startCurl() {
    if (this.form !== 'stand' || !this.canTransform()) return; this.cancelAll(); this.tr = { kind: 'curl', t: 0 }; this.stats.curls++; this.g.sfx.servo && this.g.sfx.servo(0.25); this.g.sfx.whoosh && this.g.sfx.whoosh();
  }
  /** Q / E while rolling: slow down (braking) -> when the speed is low and there is room to stand, the ball opens: ball scales away while the standing model unfolds */
  startUnroll(attack = false) {
    if (this.form !== 'ball' || this.tr || this.cap || this.rel) return; this.tr = { kind: 'unroll', t: 0, phase: 'slow', attack, wait: 0 }; this.noRoom = false;
  }
  tickTransition(dt) {
    const tr = this.tr, R = CBCFG;
    if (tr.kind === 'curl') {
      tr.t += dt; if (tr.t >= R.curlSwap && this.form === 'stand') this.swapToBall();
      if (tr.t >= R.curlT) { this.tr = null; this.yawG.visible = false; this.an.curl = 1; }
    } else if (tr.phase === 'slow') {
      tr.wait += dt; const spot = this.standSpot(); this.noRoom = !spot;
      if (spot && Math.hypot(this.v.x, this.v.z) <= 4.5 && this.v.y > -6) { this.swapToStand(spot); }
      else if (!spot && this.hasInput === false && Math.hypot(this.v.x, this.v.z) < 1) { this.hintMsg('NO ROOM TO UNROLL', 1.0); }
      if (this.noRoom) this.hintMsg('NO ROOM TO UNROLL — ROLL TO OPEN GROUND', 0.4);
    } else { tr.t += dt; if (tr.t >= R.openT) { const att = tr.attack; this.tr = null; this.ballVisible(false); if (att) this.startHeavy(true); } }
  }
  /** curl finished its first half: the ball is now the body */
  swapToBall() {
    const R = BALL_R; this.form = 'ball'; this.c.set(this.pos.x, this.pos.y + R, this.pos.z); this.v.copy(this.vel); this.groundT = this.grounded ? 0 : 9; this.gN.set(0, 1, 0); this.climbT = 0; this.airPeak = 0;
    this.mode = 'roll'; this.rollQ.setFromAxisAngle(UP, this.yaw); this.omega.set(0, 0, 0); this.sq.k = 0.12; this.sq.axis.set(0, 1, 0); this.act = null; this.ballVisible(true);
    const sp = Math.hypot(this.v.x, this.v.z); if (sp > 0.5) { _a.set(this.v.x, 0, this.v.z).normalize(); _b.copy(UP).cross(_a).multiplyScalar(sp / R); this.omega.copy(_b); }
    this.root.updateMatrixWorld(true); this.g.camera.addTrauma(0.12); this.g.sfx.thud(0.35);
  }
  ballVisible(on) { this.squashG.visible = on; }
  /** where a standing Cannonbolt fits near the ball: { x, z, y } (feet) or null. Checks walls / ceilings with the real collision, tries small nudges (never teleports far). */
  standSpot() {
    const w = this.g.world, c = this.c, R = BALL_R, base = c.y - R, rad = this.rad, H = CBCFG.h, out = _a;
    const ring = [[0, 0]]; for (const d of [0.45, 0.9, 1.35]) for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ring.push([cos(a) * d, sin(a) * d]); }
    for (const [dx, dz] of ring) {
      const p = out.set(c.x + dx, 0, c.z + dz), px = p.x, pz = p.z, gy = w.groundAt(px, pz, base + 0.4, 0.4, 0.2);
      const fy = base - gy > 0.3 ? base : gy;
      p.set(px, fy, pz); w.resolveXZ(p, rad, fy, H, 0.4); if (Math.hypot(p.x - px, p.z - pz) > 0.03) continue;
      const lg = w.lagoon; if (lg && lg.inRect(px, pz, rad)) continue;
      if (Math.hypot(dx, dz) > 0.01 && w.raySolid(_b.set(c.x, c.y, c.z), _c.set(dx, 0, dz).normalize(), Math.hypot(dx, dz))) continue;
      if (w.raySolid(_b.set(px, fy + 0.3, pz), _c.set(0, 1, 0), H - 0.3, true)) continue;
      return { x: px, z: pz, y: fy, free: base - gy > 0.3 };
    }
    return null;
  }
  /** the ball opens: the standing model takes over at the valid spot, the speed is carried (capped), passengers are released around him */
  swapToStand(spot) {
    const R = BALL_R; this.releaseAll('UNROLL', spot);
    this.pos.set(spot.x, spot.y, spot.z); const sp = Math.hypot(this.v.x, this.v.z), cap = CBCFG.run; const k = sp > cap ? cap / sp : 1; this.vel.set(this.v.x * k, spot.free ? Math.min(this.v.y, 0) : 0, this.v.z * k);
    if (sp > 0.8) this.yaw = Math.atan2(this.v.x, this.v.z); this.grounded = !spot.free; this.mode = this.grounded ? 'ground' : 'air'; this.form = 'stand'; this.tr.phase = 'open'; this.tr.t = 0; this.act = null;
    this.yawG.visible = true; this.yawG.rotation.y = this.yaw; this.an.curl = 1; this.an.turn = 0; this.snapFeet(); this.stats.unrolls++; this.g.sfx.servo && this.g.sfx.servo(0.2); this.g.sfx.thud(0.25);
    this.dustRing(0.4); this.noRoom = false; void R;
  }
  /** emergency exit from ball form (alien switch): immediately standing at the nearest valid spot */
  forceStand() {
    if (this.form !== 'ball') { this.form = 'stand'; this.ballVisible(false); this.yawG.visible = true; return; }
    const spot = this.standSpot() || { x: this.c.x, z: this.c.z, y: this.c.y - BALL_R, free: false };
    const w = this.g.world; _a.set(spot.x, spot.y, spot.z); w.resolveXZ(_a, this.rad, spot.y, CBCFG.h, 0.4); this.pos.set(_a.x, Math.max(spot.y, w.groundAt(_a.x, _a.z, spot.y + 0.4, 0.4, 0.2)), _a.z);
    this.vel.set(this.v.x, Math.min(this.v.y, 0), this.v.z); this.grounded = true; this.mode = 'ground'; this.form = 'stand'; this.ballVisible(false); this.yawG.visible = true; this.an.curl = 0; this.tiltG.scale.setScalar(1);
    this.yawG.rotation.y = this.yaw;
  }
  ballFrame(dt, input, want, hasInput) {
    const tr = this.tr, slow = tr && tr.kind === 'unroll' && tr.phase === 'slow' && !this.noRoom;
    const inp = slow ? { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, down: true } : input;
    this.ballStep(dt, inp, slow ? _b.set(0, 0, 0) : want, slow ? false : hasInput);
    this.pos.set(this.c.x, this.c.y - BALL_R, this.c.z); this.vel.copy(this.v); this.speed = Math.hypot(this.v.x, this.v.z); this.mode = 'roll';
    if (this.speed > 1.2) { const ty = Math.atan2(this.v.x, this.v.z); this.yaw += angleDelta(this.yaw, ty) * (1 - Math.exp(-10 * dt)); }
    this.an.turn = damp(this.an.turn, 0, 8, dt);
    this.ballCombat(dt); this.tickBallPowers(dt);
  }

  // ------------------------------------------------------------------------------------------------ animation
  snapFeet() {
    const c = cos(this.yaw), s = sin(this.yaw);
    for (const k of SIDES) { const r = this.footRest[k]; this.plant[k].set(this.pos.x + r.x * c + r.z * s, 0, this.pos.z - r.x * s + r.z * c); this.footNow[k].copy(this.plant[k]); }
    this.step = null;
  }
  /** feet: planted in the world. Standing: a foot steps (one at a time) only when the body has moved / turned too far from it. Walking / running: the stance phase moves each foot back at exactly the
   *  body's speed (nothing slides), swing phase lifts it. Heavy: short, slow strides at a wide stance. */
  footTargets(dt) {
    const A = this.an, w = this.g.world, c = cos(this.yaw), s = sin(this.yaw), grounded = this.grounded;
    const vf = this.vel.x * s + this.vel.z * c, vl = this.vel.x * c - this.vel.z * s, sp = Math.hypot(vf, vl), mv = A.mv, rn = A.rn;
    const dx = sp > 0.2 ? vl / sp : 0, dz = sp > 0.2 ? vf / sp : 1, amp = lerp(0.24, 0.34, rn), beta = lerp(0.66, 0.5, rn);
    if (grounded) A.gp = (A.gp + dt * sp * beta / (2 * amp)) % 1;
    const lift = lerp(0.1, 0.2, rn);
    if (mv > 0.12) this.step = null; else if (!this.step && grounded) {
      let worst = null, wd = 0.4;
      for (const k of SIDES) { const r = this.footRest[k], wx = this.pos.x + r.x * c + r.z * s, wz = this.pos.z - r.x * s + r.z * c, d = Math.hypot(this.plant[k].x - wx, this.plant[k].z - wz); if (d > wd) { wd = d; worst = k; } }
      if (worst) { this.step = { k: worst, t: 0, from: this.plant[worst].clone() }; this.stats.steps++; }
    }
    if (this.step) {
      const S = this.step; S.t += dt / 0.26; const u = ease(S.t), r = this.footRest[S.k], tx = this.pos.x + r.x * c + r.z * s, tz = this.pos.z - r.x * s + r.z * c;
      this.footNow[S.k].set(lerp(S.from.x, tx, u), 0, lerp(S.from.z, tz, u)); S._lift = sin(Math.PI * clamp(S.t, 0, 1)); if (S.t >= 1) { this.plant[S.k].set(tx, 0, tz); this.step = null; }
    }
    const out = {};
    for (const k of SIDES) {
      const r = this.footRest[k], ph = (A.gp + GOFF[k]) % 1; let z, ly = 0;
      if (ph < beta) z = amp - 2 * amp * (ph / beta); else { const u = (ph - beta) / (1 - beta), e = ease(u); z = -amp + 2 * amp * e; ly = lift * sin(Math.PI * u); }
      const lx = r.x + dx * z, lz = r.z + dz * z, gx = this.pos.x + lx * c + lz * s, gz = this.pos.z - lx * s + lz * c;
      let tx, tz, tl = 0; const stepping = this.step && this.step.k === k;
      if (stepping) { tx = this.footNow[k].x; tz = this.footNow[k].z; tl = 0.14 * this.step._lift; } else { tx = this.plant[k].x; tz = this.plant[k].z; }
      if (mv > 0.12) this.plant[k].set(gx, 0, gz);
      const X = lerp(tx, gx, mv), Z = lerp(tz, gz, mv), Y = ly * mv + tl * (1 - mv); this.footNow[k].set(X, 0, Z);
      const gy = w.groundAt(X, Z, this.pos.y + 0.6, 0.6, 0.05);
      out[k] = V(X, gy + this.restY + Y + A.air * 0.07, Z);
    }
    return out;
  }
  /** continuous pose: idle <-> walk <-> run, jump (prepare / air / landing), turning, curl */
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(); A.t += dt; const t = A.t, standing = this.form === 'stand' || this.tr;
    const grounded = this.grounded && this.mode !== 'prep' && this.form === 'stand', prep = this.mode === 'prep';
    A.mv = damp(A.mv, grounded ? smoothstep(0.3, 2.0, sp) : 0, 10, dt); A.rn = damp(A.rn, grounded ? smoothstep(3.6, 5.6, sp) : 0, 8, dt); A.air = damp(A.air, this.form === 'stand' && !this.grounded && !prep ? 1 : 0, 12, dt);
    A.crouch = damp(A.crouch, prep ? clamp(this.prepT / CBCFG.prepT, 0, 1) : this.mode === 'landing' ? 0.6 * (1 - this.landT / 0.26) : 0, 22, dt);
    if (dt > 0) { A.landV += (-140 * A.land - 12 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.25, 1.1); }
    A.flinch = Math.max(0, A.flinch - dt * 3.2);
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 22, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    const tr = this.tr; let cu = this.form === 'ball' && !tr ? 1 : 0;
    if (tr && tr.kind === 'curl') cu = ease(tr.t / CBCFG.curlT); else if (tr && tr.kind === 'unroll') cu = tr.phase === 'open' ? 1 - ease(tr.t / CBCFG.openT) : 1;
    A.curl = cu;
    const mv = A.mv, rn = A.rn, idle = (1 - mv) * (1 - cu), b = sin(t * 1.7), land = clamp(A.land, 0, 1.1), cr = A.crouch, gpA = A.gp * TAU, air = A.air, ground = 1 - air;
    const leanT = 0.04 + 0.11 * rn + 0.05 * A.accel * ground + 0.1 * cr + 0.14 * land + 0.08 * air * clamp(this.vel.y / 8, -1, 1) * -1;
    const rollT = clamp(-A.turn * 0.014, -0.12, 0.12) * mv;
    A.lean = damp(A.lean, leanT, 6, dt); A.roll = damp(A.roll, rollT, 5, dt);
    // ------- body
    const rock = sin(gpA), lookYaw = !this.act && cu < 0.2 ? clamp(angleDelta(this.yaw, this.aimYaw()), -0.6, 0.6) : 0, look = idle * (0.5 * lookYaw + 0.14 * sin(t * 0.37) + 0.06 * sin(t * 0.91 + 1));
    A.look = damp(A.look, look, 4, dt);
    P.d.hips = D(0.03 * b * idle + 0.06 * sin(gpA * 2) * mv + 0.5 * cu + 0.12 * cr, 0.16 * rock * mv, -0.07 * rock * mv + 0.045 * sin(t * 0.55) * idle);
    P.d.spine = D(0.012 * b + 0.04 * rn + 0.62 * cu + 0.1 * cr, -0.14 * rock * mv * (1 + rn) - 0.5 * A.look, 0.06 * rock * mv - 0.02 * sin(t * 0.55) * idle);
    P.d.chest = D(0.025 * b * idle + 0.05 * sin(gpA * 2 + 1) * mv + 0.78 * cu, 0.12 * rock * mv + A.look, 0.03 * sin(t * 0.7 + 0.6) * idle - 0.02 * rock * mv);
    const sh = 0.05 * (0.5 + 0.5 * sin(t * 1.7)) * idle; P.d.shL = D(0, 0, sh); P.d.shR = D(0, 0, -sh);
    // ------- legs (IK on the ground, FK tuck for the curl)
    const wl = ground * (1 - smoothstep(0.08, 0.45, cu)) + air * (1 - smoothstep(0.08, 0.45, cu));
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1;
      P.d['lg' + k + '_0'] = D(-1.9 * cu - 0.35 * air, 0, s * 0.12 * cu); P.d['lg' + k + '_1'] = D(2.6 * cu + 0.5 * air, 0, 0); P.d['lg' + k + '_2'] = D(-0.3 * cu, 0, 0);
    }
    if (wl > 0.01) {
      const T = this.footTargets(dt), c = cos(this.yaw), sn = sin(this.yaw);
      for (const k of SIDES) { const s = k === 'L' ? 1 : -1; P.legs[k] = { p: T[k], pole: V(s * 0.25 * c + sn, 0.6, -s * 0.25 * sn + c), w: wl, poleW: 1 }; }
      P.foot = { q: _q.setFromAxisAngle(UP, this.yaw).clone(), w: 1 };
    }
    // ------- arms: IK targets as offsets from the arm joint (frame = body lean + yaw)
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1, ph2 = k === 'L' ? 0 : Math.PI, bp = sin(t * 1.7 + (k === 'L' ? 0 : 1.2)), o = this.armBase[k];
      o.set(s * (0.1 + 0.03 * bp), -1.38 + 0.025 * bp, 0.1 + 0.03 * sin(t * 0.9 + (k === 'L' ? 0 : 2)));
      const swing = sin(gpA + ph2 + Math.PI), sw = (0.34 + 0.4 * rn) * mv; o.z += swing * sw * 0.9; o.y += 0.1 * Math.max(0, swing) * mv + (0.28 + 0.1 * rn) * rn; o.x += s * 0.05 * mv + s * (-0.04 * rn);
      o.z += 0.28 * rn;
      o.lerp(V(s * 0.5, -0.5, 0.35), air * 0.8); o.lerp(V(s * 0.3, -1.4, -0.05), clamp(land, 0, 1) * 0.5); o.lerp(V(s * 0.12, -1.0, 0.45), cr * 0.6);
      o.lerp(V(s * 0.22, -0.78 - 0.1 * cu, 0.96), cu);
      o.x += s * 0.2 * A.flinch; o.y += 0.2 * A.flinch;
      P.curl[k] = 0.35 + 0.25 * rn + 0.15 * sin(t * 0.8 + s) * idle + 0.5 * cu;
    }
    // flinch: recoil along the hit direction
    if (A.flinch > 0.01) {
      const fl = A.flinch, fx = sin(this.yaw), fz = cos(this.yaw), hf = A.flinchDir.x * fx + A.flinchDir.z * fz, hl = A.flinchDir.x * fz - A.flinchDir.z * fx;
      P.d.hips[0] += 0.2 * fl * hf; P.d.spine[0] += 0.25 * fl * hf; P.d.chest[0] += 0.3 * fl * hf; P.d.spine[2] += -0.2 * fl * hl; P.d.chest[2] += -0.2 * fl * hl;
    }
    void standing; return P;
  }
  finalize() {
    const A = this.an; this.yawG.rotation.y = this.yaw;
    // body drop: the legs are short, so the body sinks onto them while walking / running (keeps the ankles in reach of the planted feet) and sinks a lot into the tuck
    const need = A.dropX, drop = -(0.05 + 0.1 * A.mv + 0.07 * A.rn) - 0.2 * A.crouch - 0.16 * clamp(A.land, 0, 1.1) - 0.12 * A.curl - need - 0.05 * Math.abs(sin(A.gp * Math.PI * 2)) * A.mv + 0.04 * A.air;
    this.tiltG.position.y = PIV + drop; this.tiltG.rotation.set(A.lean + 0.9 * A.curl * (this.tr ? 1 : 0) * 0, 0, A.roll, 'XYZ'); this.root.updateMatrixWorld(true);
  }
  updateAnim(dt) {
    if (!this.root.visible) { this.updateState(); return; }
    const tr = this.tr, R = CBCFG, A = this.an;
    // ---- which of the two bodies is drawn, and how big (the curl hides the swap: standing body shrinks into the tuck while the ball grows; unroll reverses it)
    let standVis = this.form === 'stand', ballVis = this.form === 'ball', ss = 1, bs = 1;
    if (tr && tr.kind === 'curl') { standVis = tr.t < R.curlT; ballVis = this.form === 'ball'; const u = ease((tr.t - R.curlSwap + 0.04) / (R.curlT - R.curlSwap + 0.04)); ss = lerp(1, 0.7, u); bs = this.form === 'ball' ? lerp(0.6, 1, ease((tr.t - R.curlSwap) / 0.2)) : 0.6; }
    else if (tr && tr.kind === 'unroll' && tr.phase === 'open') { standVis = true; const u = ease(tr.t / R.openT); ss = lerp(0.72, 1, u); ballVis = tr.t < 0.26; bs = lerp(1, 0.6, ease(tr.t / 0.26)); }
    this.yawG.visible = standVis; this.tiltG.scale.setScalar(ss); this.squashG.visible = ballVis;
    if (standVis) {
      this.finalize();
      const P = this.locoPose(dt), L = this.actLayer(dt), tq = this.tiltG.getWorldQuaternion(_q);
      if (L) this.layerC(P, L);
      this.finalize(); P.frameQ = this.tiltG.getWorldQuaternion(_q2).clone(); void tq;
      for (const k of SIDES) { const off = this.armBase[k].clone(); if (L && L.armOff && L.armOff[k]) off.lerp(L.armOff[k], L.armW ?? L.w ?? 1); P.arms[k] = { off, pole: V(k === 'L' ? 0.8 : -0.8, -0.1, -0.7), w: 1, poleW: 1 }; }
      this.poser.apply(P); this.root.updateMatrixWorld(true);
      // ankle error -> lower the body next frame if a planted foot is out of reach (short legs)
      let err = 0; if (P.legs.L) for (const k of SIDES) { const t = P.legs[k]; if (t && t.w > 0.5) err = Math.max(err, this.poser.ankleW[k].distanceTo(t.p)); }
      A.dropX = damp(A.dropX, clamp(A.dropX + (err > 0.02 ? err * 0.8 : -0.02), 0, 0.3), 14, dt);
    }
    if (ballVis) { this.updateBallVisual(dt, this.input || {}); this.ballPop = bs; this.squashG.position.set(0, BALL_R, 0); this.squashG.scale.multiplyScalar(bs); }
    this.updateState();
  }
  /** blend an attack layer over the locomotion pose (euler deltas lerp; IK offsets are handled by the caller) */
  layerC(P, L) {
    const w = L.w ?? 1; if (w <= 0.001) return;
    for (const key in L.d) { const a = P.d[key] || [0, 0, 0], b = L.d[key]; P.d[key] = [a[0] + (b[0]) * w, a[1] + (b[1]) * w, a[2] + (b[2]) * w]; }
    if (L.curl) for (const k in L.curl) P.curl[k] = lerp(P.curl[k] ?? 0.3, L.curl[k], w);
  }
  updateState() {
    const A = this.an, a = this.act, tr = this.tr;
    this.state = tr ? (tr.kind === 'curl' ? 'CURLING' : tr.phase === 'slow' ? 'UNROLL:SLOW' : 'UNROLLING') : this.cap ? 'CAPTURING' : this.rel ? 'RELEASING' : this.form === 'ball' ? this.ballState() : a ? a.kind.toUpperCase() + ':' + a.stage.toUpperCase()
      : this.mode === 'prep' ? 'JUMP:PREPARE' : this.mode === 'landing' ? 'LANDING' : this.mode === 'air' ? (this.vel.y > 0.5 ? 'JUMP:RISE' : 'FALL') : A.flinch > 0.3 ? 'HIT' : A.rn > 0.5 ? 'RUN' : A.mv > 0.4 ? 'WALK' : Math.abs(A.turn) > 1.2 ? 'TURN' : 'IDLE';
  }
  ballState() {
    const sp = this.speed, pas = this.passengers.length ? ':CARRYING' : '';
    if (this.slam && this.slam.t > 0) return 'ROLL:IMPACT' + pas;
    if (!this.grounded) return (this.v.y > 2 ? 'ROLL:JUMP' : 'ROLL:AIR') + pas;
    if (this.imp.t < 0.2 && this.imp.speed > 5) return (this.ricochetDir ? 'ROLL:RICOCHET' : 'ROLL:BOUNCE') + pas;
    if (this.input && this.input.down && sp > 2) return 'ROLL:BRAKE' + pas;
    return (sp > 16 ? 'ROLL:FAST' : sp > 0.6 ? (Math.abs(angleDelta(this.yaw, Math.atan2(this.wantDir.x, this.wantDir.z))) > 0.6 && this.hasInput ? 'ROLL:TURN' : 'ROLL') : 'BALL:IDLE') + pas;
  }
  /** compile the first-use materials once (ball + standing model) so the first transformation never stalls a frame */
  debugText() {
    const ball = this.form === 'ball', v = this.v;
    return `FPS ${this.g.fps ? this.g.fps.toFixed(0) : '-'}   CANNONBOLT   form ${this.form}${this.tr ? ' (' + this.tr.kind + ')' : ''}   state ${this.state}\nspeed ${(ball ? v.length() : this.speed).toFixed(1)} m/s   vy ${(ball ? v.y : this.vel.y).toFixed(1)}   mode ${this.mode}   grounded ${this.grounded ? 'y' : 'n'}   hp ${this.hp.toFixed(0)}\npos ${this.pos.x.toFixed(1)}, ${this.pos.y.toFixed(1)}, ${this.pos.z.toFixed(1)}   passengers ${this.passengers.length}/${this.maxPassengers()}   bounces ${this.stats.bounces || 0}  climbs ${this.stats.climbs || 0}  smashes ${this.stats.smashes || 0}\nLMB punch / roll impact   E heavy / unroll attack   Q ball   F capture / release   Ctrl brake`;
  }
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, sv = this.squashG.visible, yv = this.yawG.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.yawG.visible = true; this.squashG.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 8); this.root.position.y = Math.max(0, this.root.position.y - 3); this.root.updateMatrixWorld(true);
    renderer.render(scene, camera); this.squashG.visible = sv; this.yawG.visible = yv; this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
}
for (const m of [cbBall, cbPowers]) Object.defineProperties(CbPlayer.prototype, Object.getOwnPropertyDescriptors(m));
export { BALL };
