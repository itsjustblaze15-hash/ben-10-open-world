// Stinkfly controller: ground locomotion (idle / walk / run with a foot-planted four-legged gait), a real wing-driven flight system (prepare -> take-off -> hover / 6-way flight / boost ->
// descend -> landing), and the procedural animation on the supplied GLB's real skeleton (animations/stinkflyrig.js). Powers (slime, claw, tail) live in sf_powers.js.
// Runs on PLAYER time (real seconds). pos = the ground under his feet (root.y = pos.y).
//  - Flight is made of the wings: the wing bones beat (hover = fast + symmetrical, forward flight = slower / longer stroke, fast flight = hard beat, landing = slowing down). There is no energy trail,
//    no jet and no Superman pose: the body leans into the direction of travel, the tail trails, legs tuck back, and turning banks him with asymmetric wing strokes.
//  - Collision uses the world's own integrate: walls stop him, roofs are ceilings from below and floors from above, the map bounds clamp him. Nothing makes him able to climb walls.
import * as THREE from 'three';
import { SfPoser, SF_SCALE, LEGS, EYES, V, D, mkPose, layerS, updateWingBlur } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { sfPowers } from './sf_powers.js';

export const SFCFG = {
  r: 0.62, h: 2.3, walk: 4.2, run: 8.6, accelG: 30, brake: 40, accelA: 9, grav: 26, hp: 280, prepT: 0.3, takeT: 0.36,
  fly: { cruise: 19.5, boost: 36, up: 11, upBoost: 16, down: 13, accel: 24, brake: 15, maxAlt: 180, takeV: 9 },
};
const PIV = 1.5, TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const sin = Math.sin, cos = Math.cos;
const PARTNER = { L1: 'R2', R2: 'L1', R1: 'L2', L2: 'R1' }, GOFF = { L1: 0, R2: 0, R1: 0.5, L2: 0.5 };
// flight leg postures (euler X per segment): hanging a little forward (hover) -> trailing (cruise) -> tucked back (fast)
const LEG_HOV = [0.18, 0.24, 0.24, 0.12], LEG_FWD = [0.7, 0.7, 0.6, 0.3], LEG_TUCK = [1.1, 0.9, 0.9, 0.45];
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class SfPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'stinkfly'; this.cfg = SFCFG; this.rad = SFCFG.r; this.colH = SFCFG.h;
    this.root = new THREE.Group(); this.root.name = 'Stinkfly';
    this.tiltG = new THREE.Group(); this.tiltG.name = 'StinkflyLean'; this.tiltG.position.set(0, PIV, 0); this.root.add(this.tiltG);
    rig.modelGroup.scale.setScalar(SF_SCALE); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.poser = new SfPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground'; this.speed = 0; this.alt = 0; this.camYaw = 0; this.state = 'IDLE';
    this.hp = SFCFG.hp; this.hpT = 0; this.hitSphere = { y: 1.4, r: 0.95 }; this.input = null; this.wantDir = new THREE.Vector3(); this.hasInput = false; this.flyBoost = 0;
    this.prepT = 0; this.toT = 0; this.landT = 0; this.flashT = 0; this.landImpact = 0; this.eyeAimW = 0; this.flightTime = 0;
    this.stats = { hits: 0, flights: 0, takeoffs: 0, landings: 0, flyTime: 0, maxAlt: 0, topSpeed: 0, steps: 0, flaps: 0 };
    this.an = { t: 0, mv: 0, rn: 0, air: 0, fly: 0, crouch: 0, land: 0, landV: 0, lean: 0, roll: 0, turn: 0, boost: 0, gp: 0, ph: 0, wf: 0, wo: 0.1, wa: 0, twitch: 0, twitchT: 2, vy: 0, flinch: 0, flinchDir: new THREE.Vector3(), sx: 0, hov: 0, legFly: 0, look: 0, accel: 0, prevSpeed: 0, lastFlap: 0, wl: 0, wr: 0 };
    this.fxT = { dust: 0, wind: 0, flap: 0 };
    this.initPowers(game);
    // ---- calibration from the bind pose: where the feet rest, where the shoulders are (model space), so every world-space IK target below is relative to the real skeleton
    this.root.rotation.y = 0; this.root.updateMatrixWorld(true); this.poser.apply(mkPose());
    this.footRest = {}; this.plant = {}; this.footNow = {};
    for (const k of LEGS) { this.footRest[k] = this.poser.footW[k].clone(); this.plant[k] = new THREE.Vector3(); this.footNow[k] = new THREE.Vector3(); }
    this.restY = LEGS.reduce((m, k) => m + this.footRest[k].y, 0) / 4;
    this.shoulderRest = {}; for (const k of ['L', 'R']) this.shoulderRest[k] = rig.modelGroup.worldToLocal(rig.arms[k].a.getWorldPosition(new THREE.Vector3()));
    this.step = null;
    this.root.rotation.y = this.yaw; this.root.visible = false; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  get flying() { return this.mode === 'fly' || this.mode === 'takeoff'; }
  get flightActive() { return this.flying; }
  get busy() { return !!this.act; }
  get dmgMul() { return 1; }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-Math.sin(y), -Math.cos(y)); }
  /** switched TO Stinkfly: same position, facing, momentum and camera; if the previous alien was flying he stays in the air (hover) instead of dropping */
  activate(from) {
    const w = this.g.world; this.cancelAll(); this.pos.copy(from.pos); this.yaw = from.yaw; this.vel.set(from.vel.x, clamp(from.vel.y, -12, 12), from.vel.z);
    const hs = Math.hypot(this.vel.x, this.vel.z), cap = from.flying ? SFCFG.fly.boost : SFCFG.fly.boost; if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
    const gy = w.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.4, 0.25); this.grounded = from.grounded && this.pos.y <= gy + 0.3;
    this.mode = this.grounded ? 'ground' : (from.flying ? 'fly' : 'air'); this.flyBoost = 0; this.landT = 0; this.prepT = 0; this.toT = 0; this.eyeAimW = 0;
    w.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, 0.4); if (this.grounded) this.pos.y = gy; else this.pos.y = Math.max(this.pos.y, gy);
    const A = this.an; A.land = A.landV = 0; A.crouch = 0; A.lean = A.roll = 0; A.turn = 0; A.air = this.grounded ? 0 : 1; A.fly = this.mode === 'fly' ? 1 : 0; A.wa = this.mode === 'fly' ? 0.5 : 0; A.wo = this.mode === 'fly' ? 1.0 : 0.1; A.flinch = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z); this.root.rotation.y = this.yaw; this.root.visible = true; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016)); this.root.updateMatrixWorld(true);
    this.hint(false);
  }
  /** C pressed while Stinkfly: attacks, held button, projectiles in the air, flight state and the wing blur are dropped BEFORE the next alien appears (splats / coats are world state and wear off alone) */
  leave() { this.cancelAll(); this.mode = this.grounded ? 'ground' : 'air'; this.flyBoost = 0; this.prepT = this.toT = this.landT = 0; this.input = null; updateWingBlur(this.rig, 0, 0, 0); const e = document.getElementById('speedfx'); if (e && this.g.player === this) e.style.opacity = '0'; this.hint(false); this.restoreMats(); }
  deactivate() { this.leave(); this.root.visible = false; }
  hint(on) { if (this.hintEl) this.hintEl.hidden = !on; }
  restoreMats() { for (const m of this.rig.bodyMats) if (m.emissive && m.userData.e0) m.emissive.copy(m.userData.e0); this.flashT = 0; }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const A = this.an, R = SFCFG, F = R.fly; this.landImpact = 0; this.camYaw = camYaw; this.input = input;
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want);
    if (this.hp < R.hp) { this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0) this.hp = Math.min(R.hp, this.hp + dt * 12); }
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.restoreMats();
    // ---- Space: take off from the ground (prepare -> lift), or open the wings mid-air
    if (input.jump) {
      if (this.mode === 'ground' && this.grounded && !(this.act && this.act.lockMove)) { this.mode = 'crouch'; this.prepT = 0; this.stats.takeoffs++; this.g.sfx.flap && this.g.sfx.flap(0.2); }
      else if (this.mode === 'air' || this.mode === 'landing') { this.engageFlight(); }
    }
    const a = this.act, locked = a && a.lockMove;
    if (this.mode === 'crouch') {                       // wings start beating, body sinks on its legs, a puff of wind
      this.prepT += dt; this.vel.x *= Math.exp(-9 * dt); this.vel.z *= Math.exp(-9 * dt); this.integrate(dt, this.pos.y, SFCFG.h, true); this.faceUpdate(dt, want, hasInput);
      if (this.prepT >= R.prepT) { this.mode = 'takeoff'; this.toT = 0; this.grounded = false; this.vel.y = F.takeV * 0.5; this.pos.y += 0.04; this.stats.flights++; this.takeFX(); this.g.hud.toast('FLIGHT ON'); }
      return;
    }
    if (this.mode === 'takeoff' || this.mode === 'fly') { this.updateFly(dt, input, want, hasInput); return; }
    let top = (input.run ? R.run : R.walk) * (a ? (a.speedMul ?? 0.6) : 1); if (locked) top = 0; if (this.mode === 'landing') top *= 0.45;
    const mvv = a ? a.moveVel : null;
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; if (!this.grounded) this.vel.y = mvv.y; }
    else {
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const rate = (this.grounded ? (hasInput ? R.accelG : R.brake) : R.accelA) * dt, m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    const prevY = this.pos.y;
    if (!this.grounded) { this.vel.y = Math.max(-45, this.vel.y - R.grav * dt); if (a && a.hover) this.vel.y = 0; }
    this.integrate(dt, prevY, SFCFG.h, false);
    if (this.mode === 'landing') { this.landT += dt; if (this.landT >= 0.3) this.mode = 'ground'; }
    this.faceUpdate(dt, want, hasInput);
  }
  engageFlight() { this.mode = 'fly'; this.grounded = false; this.stats.flights++; this.g.hud.toast('FLIGHT ON'); this.g.sfx.whoosh && this.g.sfx.whoosh(); if (this.vel.y < 0) this.vel.y *= 0.2; this.an.wo = 1; this.an.wa = 0.55; }
  /** move + collide with sub-steps; walls stop him, roofs are ceilings from below, floors from above */
  integrate(dt, prevY, H, groundMode) {
    const w = this.g.world, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(12, Math.ceil(hsp / 0.3))), h = dt / n, rad = this.rad;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, rad, this.pos.y, H, this.grounded ? 0.4 : 0.05);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
    }
    const y0 = this.pos.y; this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) for (const b of w.boxes) {                 // ceilings: never rise through the underside of a roof / platform
      if (b.min.y >= y0 + H - 0.05 && b.min.y < this.pos.y + H && this.pos.x > b.min.x - rad * 0.7 && this.pos.x < b.max.x + rad * 0.7 && this.pos.z > b.min.z - rad * 0.7 && this.pos.z < b.max.z + rad * 0.7) { this.pos.y = b.min.y - H; this.vel.y = 0; }
    }
    { const T = w.island && w.terrain, cap = (T ? Math.max(T.height(this.pos.x, this.pos.z), -0.12) : 0) + SFCFG.fly.maxAlt; if (this.pos.y > cap) { this.pos.y = Math.max(cap, this.pos.y - 12 * h * n); if (this.vel.y > 0) this.vel.y = 0; } }   // V28: altitude ceiling above the ground below (mountains included)
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, rad * 0.6);
    if (this.mode === 'crouch') { this.pos.y = Math.max(this.pos.y, gy); }
    else if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -5) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
      if (this.mode === 'air') { this.mode = this.landImpact > 6 ? 'landing' : 'ground'; this.landT = 0; this.stats.landings++; }
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    this.speed = Math.hypot(this.vel.x, this.vel.z); this.stats.topSpeed = Math.max(this.stats.topSpeed, this.speed);
  }
  faceUpdate(dt, want, hasInput) {
    const a = this.act; let target = this.yaw, k = 11;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 20; }
    else if (this.flying) { if (hasInput) { target = Math.atan2(want.x, want.z); k = 6; } else { target = this.aimYaw(); k = 3.5; } }   // hovering he drifts round to look where the camera looks
    else if (this.speed > 0.7 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 12 : 5; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 9; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 9, dt);
    this.root.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------------------------------------ flight
  updateFly(dt, input, want, hasInput) {
    const w = this.g.world, F = SFCFG.fly, a = this.act, A = this.an; this.stats.flyTime += dt; this.flightTime += dt;
    if (this.mode === 'takeoff') {
      this.toT += dt; const u = clamp(this.toT / SFCFG.takeT, 0, 1);
      this.vel.x *= Math.exp(-3 * dt); this.vel.z *= Math.exp(-3 * dt); const tv = lerp(F.takeV * 0.5, F.takeV, ease(u)); this.vel.y += (tv - this.vel.y) * (1 - Math.exp(-10 * dt));
      this.grounded = false; this.integrate(dt, this.pos.y, SFCFG.h, false); this.grounded = false; this.faceUpdate(dt, want, hasInput);
      if (this.toT >= SFCFG.takeT) { this.mode = 'fly'; }
      this.alt = this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y, 60, 0.3); return;
    }
    if (a && a.moveVel) this.noLandT = 0.45; this.noLandT = Math.max(0, (this.noLandT || 0) - dt);          // a claw / tail lunge that dips to the ground does not end the flight
    const boost = input.run && !(a && a.noBoost); this.flyBoost = damp(this.flyBoost, boost ? 1 : 0, 3.5, dt);
    let top = lerp(F.cruise, F.boost, this.flyBoost) * (a ? (a.flySpeedMul ?? 0.8) : 1); if (a && a.lockMove) top = 0;
    if (a && a.moveVel) { this.vel.x = a.moveVel.x; this.vel.z = a.moveVel.z; this.vel.y = a.moveVel.y; }
    else {
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const rate = (hasInput ? F.accel * (1 + 0.6 * this.flyBoost) : F.brake) * dt, m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }     // momentum: speed builds and bleeds off over about a second
      const upS = lerp(F.up, F.upBoost, this.flyBoost); let vyT = (input.jumpHeld ? upS : 0) - (input.down ? F.down : 0); if (a && a.lockMove) vyT = 0;
      const hover = sin(A.t * 2.3) * 0.28; this.vel.y += ((vyT + (vyT === 0 ? hover : 0)) - this.vel.y) * (1 - Math.exp(-(vyT === 0 ? 3.4 : 5.5) * dt));
    }
    const prevY = this.pos.y; this.grounded = false; this.integrate(dt, prevY, SFCFG.h, false);
    this.alt = this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y, 60, 0.3); this.stats.maxAlt = Math.max(this.stats.maxAlt, this.alt);
    if (this.grounded) {                                  // touched something to stand on (street, roof, platform): land if he is descending / not climbing, otherwise skim over it
      if (this.noLandT <= 0 && !this.act && (input.down || (!input.jumpHeld && this.speed < 7))) this.touchDown();
      else { this.grounded = false; this.pos.y += 0.03; if (this.vel.y < 0) this.vel.y = 0; }
    }
    this.faceUpdate(dt, want, hasInput);
  }
  touchDown() { this.mode = 'landing'; this.landT = 0; this.stats.landings++; this.grounded = true; this.vel.y = 0; this.vel.x *= 0.4; this.vel.z *= 0.4; this.an.landV += 2.6; this.g.hud.toast('LANDED'); this.landFX(5); this.snapFeet(); }
  /** knocked / pushed: a small shove (ground and air) */
  // (knock lives in sf_powers)

  // ------------------------------------------------------------------------------------------------ FX
  takeFX() {
    const g = this.g, c = _a.set(this.pos.x, this.pos.y + 0.1, this.pos.z); g.camera.addTrauma(0.12); g.sfx.whoosh && g.sfx.whoosh(); g.fx.surface.ring(c.clone(), UP, 5, 0.4, 0xd8d2b8);
    for (let i = 0; i < 24; i++) { const a = rand(0, TAU), v = rand(2, 6); g.fx.dust.emit({ pos: c, vel: _b.set(cos(a) * v, rand(0.2, 1.4), sin(a) * v), size: rand(0.25, 0.55), life: rand(0.5, 0.9), drag: 2, grav: -0.2, color: [0.72, 0.68, 0.58], alpha: 0.6 }); }
  }
  landFX(v) {
    const g = this.g, k = clamp((v - 4) / 18, 0, 1); this.an.landV += 2 + 6 * k; g.camera.addTrauma(0.05 + 0.2 * k); g.sfx.thud(0.15 + 0.4 * k);
    const c = _a.set(this.pos.x, this.pos.y + 0.08, this.pos.z); g.fx.surface.ring(c.clone(), UP, 3 + 4 * k, 0.35, 0xd8d2b8);
    for (let i = 0; i < 10 + 10 * k; i++) { const a = rand(0, TAU), s = rand(1, 3 + 3 * k); g.fx.dust.emit({ pos: c, vel: _b.set(cos(a) * s, rand(0.2, 1), sin(a) * s), size: rand(0.2, 0.45), life: rand(0.4, 0.8), drag: 2.2, grav: 0.5, color: [0.7, 0.66, 0.57], alpha: 0.55 }); }
  }
  /** air you can see: dust blown outward under the wings when he beats close to the ground, thin streaks of air when he is fast */
  updateFX(dt) {
    const g = this.g, A = this.an, ft = this.fxT; if (!this.root.visible) return;
    const flapping = (this.flying || this.mode === 'crouch') && A.wa > 0.25;
    if (flapping && this.alt < 4.5 || this.mode === 'crouch') {
      ft.dust -= dt; if (ft.dust <= 0) { ft.dust = 0.05; const gy = this.pos.y - Math.max(0, this.alt || 0), k = 1 - clamp((this.alt || 0) / 4.5, 0, 1);
        for (let i = 0; i < 2; i++) { const a = rand(0, TAU), r = rand(0.6, 1.4); g.fx.dust.emit({ pos: _a.set(this.pos.x + cos(a) * r, gy + 0.08, this.pos.z + sin(a) * r), vel: _b.set(cos(a) * rand(2.5, 5) * (0.4 + k), rand(0.1, 0.5), sin(a) * rand(2.5, 5) * (0.4 + k)), size: rand(0.18, 0.4), life: rand(0.35, 0.65), drag: 2.4, grav: 0, color: [0.74, 0.7, 0.6], alpha: 0.38 * (0.4 + k) }); } }
    }
    const hs = Math.hypot(this.vel.x, this.vel.z), fast = this.flying ? smoothstep(14, 22, hs) : 0;
    if (fast > 0.05) {
      ft.wind -= dt; if (ft.wind <= 0) { ft.wind = 0.035 / (0.3 + fast); const cam = g.cam3; for (let i = 0; i < 2; i++) { const p = _a.set(this.pos.x + rand(-5, 5), this.pos.y + rand(-1.5, 4.5), this.pos.z + rand(-5, 5)).addScaledVector(_b.set(this.vel.x, 0, this.vel.z).normalize(), 3);
        g.fx.dust.emit({ pos: p, vel: _c.set(-this.vel.x * 0.55, -this.vel.y * 0.2, -this.vel.z * 0.55), size: rand(0.05, 0.09), life: rand(0.25, 0.4), drag: 0.2, grav: 0, color: [0.92, 0.95, 1], alpha: 0.35 * fast }); } void cam; }
    }
    // wing-beat sound, rate limited (every second stroke)
    if (this.flying || this.mode === 'crouch') { A.lastFlap -= dt; if (A.lastFlap <= 0 && A.wa > 0.25) { A.lastFlap = Math.max(0.09, 2 / Math.max(6, A.wf)); g.sfx.flap && g.sfx.flap(0.05 + 0.04 * A.wa); this.stats.flaps++; } }
  }

  // ------------------------------------------------------------------------------------------------ animation
  /** place the feet where they are planted right now (no pop when the controller starts / lands) */
  snapFeet() {
    const c = cos(this.yaw), s = sin(this.yaw);
    for (const k of LEGS) { const r = this.footRest[k]; this.plant[k].set(this.pos.x + r.x * c + r.z * s, 0, this.pos.z - r.x * s + r.z * c); this.footNow[k].copy(this.plant[k]); }
    this.step = null;
  }
  /** feet: world-space foot planting. Standing still: each foot stays where it is and steps (diagonal pairs) only when the body has moved / turned too far from it. Walking / running: a trot gait whose stance
   *  phase moves each foot backwards at exactly the body's speed, so nothing slides. The two are blended by walking speed. Returns the IK targets. */
  footTargets(dt, P) {
    const A = this.an, w = this.g.world, c = cos(this.yaw), s = sin(this.yaw), grounded = this.grounded || this.mode === 'crouch';
    const vf = this.vel.x * s + this.vel.z * c, vl = this.vel.x * c - this.vel.z * s, sp = Math.hypot(vf, vl), mv = A.mv, rn = A.rn;
    const dx = sp > 0.2 ? vl / sp : 0, dz = sp > 0.2 ? vf / sp : 1;
    const amp = lerp(0.3, 0.46, rn), beta = lerp(0.62, 0.5, rn);
    if (grounded) A.gp = (A.gp + dt * sp * beta / (2 * amp)) % 1;
    const lift = lerp(0.14, 0.26, rn);
    // ---- standing: stepping trigger
    if (mv > 0.12) { this.step = null; } else if (!this.step && grounded) {
      let worst = null, wd = 0.36 + (this.mode === 'crouch' ? 1 : 0);
      for (const k of LEGS) { const r = this.footRest[k], wx = this.pos.x + r.x * c + r.z * s, wz = this.pos.z - r.x * s + r.z * c, d = Math.hypot(this.plant[k].x - wx, this.plant[k].z - wz); if (d > wd) { wd = d; worst = k; } }
      if (worst) { this.step = { ks: [worst, PARTNER[worst]], t: 0, from: {} }; for (const k of this.step.ks) this.step.from[k] = this.plant[k].clone(); this.stats.steps++; }
    }
    if (this.step) {
      const S = this.step; S.t += dt / 0.2; const u = ease(S.t);
      for (const k of S.ks) { const r = this.footRest[k], tx = this.pos.x + r.x * c + r.z * s + this.vel.x * 0.08, tz = this.pos.z - r.x * s + r.z * c + this.vel.z * 0.08; this.footNow[k].set(lerp(S.from[k].x, tx, u), 0, lerp(S.from[k].z, tz, u)); S._lift = sin(Math.PI * clamp(S.t, 0, 1)); if (S.t >= 1) this.plant[k].set(tx, 0, tz); }
      if (S.t >= 1) this.step = null;
    }
    const out = {};
    for (const k of LEGS) {
      const r = this.footRest[k], ph = (A.gp + GOFF[k]) % 1; let z, ly = 0;
      if (ph < beta) z = amp - 2 * amp * (ph / beta); else { const u = (ph - beta) / (1 - beta), e = ease(u); z = -amp + 2 * amp * e; ly = lift * sin(Math.PI * u); }
      const lx = r.x + dx * z, lz = r.z + dz * z, gx = this.pos.x + lx * c + lz * s, gz = this.pos.z - lx * s + lz * c;
      let tx, tz, tl = 0;
      const stepping = this.step && this.step.ks.includes(k);
      if (stepping) { tx = this.footNow[k].x; tz = this.footNow[k].z; tl = 0.18 * this.step._lift; } else { tx = this.plant[k].x; tz = this.plant[k].z; }
      if (mv > 0.12) { this.plant[k].set(gx, 0, gz); }
      const X = lerp(tx, gx, mv), Z = lerp(tz, gz, mv), Y = ly * mv + tl * (1 - mv);
      this.footNow[k].set(X, 0, Z);
      const gy = w.groundAt(X, Z, this.pos.y + 0.6, 0.6, 0.05);
      out[k] = V(X, gy + this.restY + Y, Z);
    }
    return out;
  }
  /** continuous pose: idle <-> walk <-> run, prepare / take-off, hover / flight / fast flight / turn / ascend / descend, landing, falling */
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(), grounded = this.grounded || this.mode === 'crouch', F = SFCFG.fly;
    A.t += dt; const t = A.t, hs = Math.hypot(this.vel.x, this.vel.z), flyMode = this.mode === 'fly', takeoff = this.mode === 'takeoff', crouch = this.mode === 'crouch';
    A.mv = damp(A.mv, grounded && !crouch ? smoothstep(0.3, 3.0, sp) : 0, 10, dt); A.rn = damp(A.rn, grounded && !crouch ? smoothstep(5.5, 8.2, sp) : 0, 8, dt);
    A.air = damp(A.air, grounded ? 0 : 1, 12, dt);
    A.crouch = damp(A.crouch, crouch ? clamp(this.prepT / SFCFG.prepT, 0, 1) : this.mode === 'landing' ? 0.5 * (1 - this.landT / 0.3) : 0, 20, dt);
    A.fly = damp(A.fly, flyMode || takeoff ? 1 : 0, flyMode ? 6 : 8, dt);
    if (dt > 0) { A.landV += (-150 * A.land - 13 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.25, 1.1); }
    A.flinch = Math.max(0, A.flinch - dt * 3.4);
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 30, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    const mv = A.mv, rn = A.rn, ground = 1 - A.air, fly = A.fly, idle = 1 - mv, b = sin(t * 2.1), land = clamp(A.land, 0, 1.1), cr = A.crouch, gpA = A.gp * TAU;
    // ------- body frame numbers for flight
    const fx = sin(this.yaw), fz = cos(this.yaw), vf = this.vel.x * fx + this.vel.z * fz, vl = this.vel.x * fz - this.vel.z * fx;
    const spF = clamp(vf / F.cruise, -1, 1), fast = clamp((hs - F.cruise * 0.9) / (F.boost * 0.9 - F.cruise * 0.9), 0, 1), hov = 1 - clamp(hs / 5, 0, 1), up = clamp(this.vel.y / 8, -1, 1);
    // lean (pitch): hovering he is nose-up (wings hold him up), cruising nose-down, fast = strongly forward. Roll: banking into turns + strafing.
    const leanT = fly * (-0.26 * hov + 0.22 * clamp(spF, 0, 1) * (1 - hov) + 0.46 * fast + 0.12 * Math.max(0, -up) - 0.08 * Math.max(0, up) * hov + (vf < -1 ? 0.2 * clamp(vf / F.cruise, -1, 0) : 0))
      + (1 - fly) * (0.03 + 0.1 * rn + 0.07 * A.accel * ground) + 0.2 * (1 - ground) * (1 - fly) * 0.5 + 0.16 * cr + 0.2 * land;
    const rollT = fly * clamp(-A.turn * 0.11 - vl / F.cruise * 0.38, -0.75, 0.75) + (1 - fly) * clamp(-A.turn * 0.02, -0.12, 0.12) * mv;
    A.lean = damp(A.lean, leanT, 5.5, dt); A.roll = damp(A.roll, rollT, 5, dt); A.boost = damp(A.boost, this.flyBoost, 6, dt);
    // ------- wings
    let o = 0.1, a = 0, f = 0;
    A.twitchT -= dt; if (A.twitchT <= 0 && grounded && !crouch && this.mode === 'ground') { A.twitch = 0.42; A.twitchT = rand(2.2, 5); } A.twitch = Math.max(0, A.twitch - dt);
    if (crouch) { const u = clamp(this.prepT / SFCFG.prepT, 0, 1); o = lerp(0.2, 0.95, ease(u)); a = lerp(0.1, 0.55, ease(u)); f = lerp(7, 14, u); }
    else if (takeoff) { o = 1.0; a = 0.66; f = 14; }
    else if (flyMode) {
      const cruise = clamp((hs - 3) / 8, 0, 1);
      o = lerp(1.05, 0.95, cruise) - 0.05 * fast - 0.12 * Math.max(0, -up); a = lerp(0.5, 0.58, cruise) + 0.12 * fast + 0.07 * Math.max(0, up) - 0.1 * Math.max(0, -up); f = lerp(11, 9.5, cruise) + 3.2 * fast + 1.4 * Math.max(0, up) - 2 * Math.max(0, -up);
      if (this.act && this.act.kind === 'tail') { a *= 0.9; }
    }
    else if (this.mode === 'air') { o = 0.75; a = 0.4; f = 8.5; }
    else if (this.mode === 'landing') { const u = clamp(this.landT / 0.3, 0, 1); o = lerp(0.8, 0.1, u); a = lerp(0.42, 0, u); f = lerp(6, 3, u); }
    else if (A.twitch > 0) { const u = A.twitch / 0.42; o = 0.12 + 0.18 * sin(u * Math.PI); a = 0.1 * sin(u * Math.PI); f = 17; }
    if (this.flinchBoostT > 0) { this.flinchBoostT -= dt; }
    const kk = (flyMode || takeoff || crouch || this.mode === 'air' || this.mode === 'landing') ? 9 : 5;
    A.wo = damp(A.wo, o, kk, dt); A.wa = damp(A.wa, a + 0.3 * A.flinch, kk, dt); A.wf = damp(A.wf, f, 7, dt); A.ph = (A.ph + dt * TAU * A.wf) % (TAU * 200);
    const turnK = clamp(A.turn / 2.6, -1, 1) * fly, aL = A.wa * (1 - 0.34 * turnK), aR = A.wa * (1 + 0.34 * turnK), ph = A.ph;
    const ampK = clamp(A.wa * 2.2, 0, 1), sweep = 0.32 * ampK, feather = 0.36 * ampK, wl = A.wo + aL * sin(ph), wr = A.wo + aR * sin(ph);
    P.d.wingL = D(feather * cos(ph), sweep * cos(ph), -wl); P.d.wingR = D(feather * cos(ph), -sweep * cos(ph), wr); A.wl = wl; A.wr = wr;
    // ------- spine / head / tail
    const gb = ground * (1 - fly), rock = sin(gpA);
    P.d.hips = D(0.02 * b * idle + 0.03 * sin(gpA * 2) * mv - 0.4 * cr - 0.1 * land + 0.05 * fly * sin(t * 2.2), 0.1 * rock * mv, 0.03 * rock * mv);
    P.d.spine = D(0.012 * b + 0.3 * cr, -0.14 * rock * mv * (1 + rn), -0.03 * rock * mv); P.d.chest = D(0.02 * b * idle + 0.05 * sin(gpA * 2 + 1) * mv + 0.2 * cr, 0.12 * rock * mv, 0.02 * rock * mv);
    const keep = -0.62 * A.lean * (fly + gb * 0.5);                               // head stays level / looks ahead against the body lean
    const lookYaw = fly < 0.5 && !this.act ? clamp(angleDelta(this.yaw, this.aimYaw()), -0.5, 0.5) * (0.5 + 0.5 * idle) : 0;
    P.d.neck = D(keep * 0.55 - 0.08 * cr, lookYaw * 0.45 + 0.05 * Math.sin(t * 0.43) * idle, 0.02 * Math.sin(t * 0.7) * idle);
    P.d.head = D(keep * 0.55 + 0.03 * Math.sin(t * 0.9) * idle, lookYaw * 0.55 + 0.08 * Math.sin(t * 0.37 + 1) * idle, 0.03 * Math.sin(t * 0.6) * idle - A.roll * 0.15);
    P.d.jaw = D(0.05 + 0.04 * Math.sin(t * 1.7) * idle + 0.06 * fast + 0.1 * (A.flinch), 0, 0);
    // tail: never stiff - a travelling wave (breathing / walking / flying), hanging with the lean, lagging the turn
    const tw = 1.7 + 2.2 * mv + 1.4 * fly, tl = -A.turn * 0.06;
    const tUp = 0.12 + 0.32 * fly * (1 - fast * 0.5) - 0.4 * A.lean * fly + 0.1 * A.accel;
    P.d.tail0 = D(tUp + 0.1 * sin(t * tw), tl + 0.2 * sin(t * tw * 0.8 + 0.5) * (0.6 + mv + fly * 0.4), 0.05 * sin(t * tw));
    P.d.tail1 = D(0.06 + 0.1 * fly + 0.14 * sin(t * tw - 0.9), tl * 0.8 + 0.26 * sin(t * tw * 0.8 - 0.6) * (0.6 + mv + fly * 0.4), 0);
    P.d.tail2 = D(0.04 + 0.16 * sin(t * tw - 1.8), tl * 0.7 + 0.32 * sin(t * tw * 0.8 - 1.5) * (0.6 + mv + fly * 0.4), 0);
    // eyestalks: independent slow sway on the ground, streaming back a little in fast flight, quivering when the wings beat hard
    for (let i = 0; i < EYES.length; i++) {
      const K = EYES[i], ph0 = i * 1.7, side = K[0] === 'L' ? 1 : -1;
      for (let j = 0; j < 3; j++) {
        const sw = (0.09 + 0.05 * j) * (1 + 0.4 * idle), q = 0.03 * A.wa * sin(ph * 1.0 + j);
        P.d['e' + K + '_' + j] = D(sw * sin(t * 1.3 + ph0 + j * 0.6) - 0.1 * fast * (j + 1) / 3 - 0.07 * A.flinch + q, 0.12 * sw / 0.09 * 0.7 * sin(t * 0.9 + ph0 * 2 + j) * side * 0.0 + sw * 1.3 * sin(t * 0.9 + ph0 * 2 + j), 0.08 * sin(t * 1.1 + ph0 * 3 + j) * (j + 1) / 3);
      }
    }
    // ------- legs: FK posture for the air, IK on the ground
    const legFly = clamp(fly + A.air * 0.9, 0, 1);
    const tuckK = clamp(fast * 1.2 + 0.0, 0, 1), cruiseK = clamp((hs - 2) / 8, 0, 1);
    for (const K of LEGS) {
      const side = K[0] === 'L' ? 1 : -1, front = K[1] === '1' ? 1 : 0;
      for (let j = 0; j < 4; j++) {
        const hv = LEG_HOV[j], fw = LEG_FWD[j], tk = LEG_TUCK[j];
        let ang = lerp(lerp(hv, fw, cruiseK), tk, tuckK) * legFly;
        ang += (A.air * (1 - fly) * 0.25) + 0.05 * sin(t * 3 + j + side + front * 2) * legFly + 0.08 * cr * (j === 1 ? 1 : 0) - (this.mode === 'takeoff' ? 0.2 * (1 - this.toT / SFCFG.takeT) * 0 : 0);
        P.d['lg' + K + '_' + j] = D(ang, 0, side * (j === 0 ? 0.14 : 0.04) * legFly);
      }
    }
    if (ground > 0.01 || crouch) {
      const T = this.footTargets(dt, P), c = cos(this.yaw), s = sin(this.yaw);
      for (const K of LEGS) {
        const side = K[0] === 'L' ? 1 : -1, front = K[1] === '1' ? 0.35 : -0.35;
        P.legs[K] = { p: T[K], pole: V(side * 0.75 * c + front * s, 1.0, -side * 0.75 * s + front * c), w: ground, poleW: 1 };
      }
    }
    // ------- arms (claws): relative to the shoulders, body frame. Pulled in front when idle, swing a little with the trot, tuck back in fast flight, flare on a hit.
    this.armBase = this.armBase || { L: V(0, 0, 0), R: V(0, 0, 0) };
    for (const k of ['L', 'R']) {
      const s = k === 'L' ? 1 : -1, ph2 = k === 'L' ? 0 : Math.PI, bp = sin(t * 2.1 + (k === 'L' ? 0 : 1.3));
      const o0 = this.armBase[k];
      o0.set(s * 0.22 + s * 0.04 * bp, -0.52 + 0.015 * bp, 0.62 + 0.02 * bp);
      o0.z += 0.12 * sin(gpA + ph2) * mv; o0.y += 0.06 * Math.max(0, sin(gpA + ph2 + 1)) * mv;
      const fl = V(s * 0.24, -0.46 + 0.03 * Math.sin(t * 2.4), 0.5), tk = V(s * 0.16, -0.6, 0.18), hv = V(s * 0.3, -0.5, 0.58), cl = V(s * 0.3, -0.55, 0.4), lf = V(s * 0.3, -0.5, 0.45);
      o0.lerp(hv, fly * hov); o0.lerp(fl, fly * (1 - hov)); o0.lerp(tk, fly * fast); o0.lerp(cl, cr * 0.8); o0.lerp(lf, clamp(land, 0, 1) * 0.5);
      o0.x += s * 0.36 * A.flinch; o0.y += 0.2 * A.flinch;
      P.curl[k] = 0.25 + 0.35 * fly + 0.2 * rn;
    }
    // ------- flinch: recoil along the hit direction (a front hit bends him back; a side hit rolls him away)
    if (A.flinch > 0.01) {
      const fl = A.flinch, hf = A.flinchDir.x * fx + A.flinchDir.z * fz, hl = A.flinchDir.x * fz - A.flinchDir.z * fx;
      P.d.hips[0] += 0.25 * fl * hf; P.d.spine[0] += 0.3 * fl * hf; P.d.chest[0] += 0.3 * fl * hf; P.d.head[0] += 0.4 * fl * hf; P.d.neck[0] += 0.2 * fl * hf;
      P.d.spine[2] += -0.25 * fl * hl; P.d.chest[2] += -0.2 * fl * hl; P.d.head[2] += -0.3 * fl * hl;
    }
    return P;
  }
  /** the tilt group (lean / roll / body drop) and fresh world matrices, so every world-space IK target is converted against the current body */
  finalize() {
    const A = this.an; this.root.rotation.y = this.yaw;
    const drop = -0.3 * A.crouch - 0.12 * clamp(A.land, 0, 1.1) - 0.06 * A.mv - 0.05 * A.rn * Math.abs(sin(A.gp * Math.PI * 2)) + 0.04 * A.fly * sin(A.t * 2.2) - 0.05 * (this.mode === 'takeoff' ? 1 : 0) * 0;
    this.tiltG.position.y = PIV + drop; this.tiltG.rotation.set(A.lean, 0, A.roll, 'XYZ'); this.root.updateMatrixWorld(true);
  }
  /** per-frame: locomotion + action layer -> skeleton */
  updateAnim(dt) {
    if (!this.root.visible) { this.updateState(); return; }
    this.finalize();
    const P = this.locoPose(dt), L = this.actLayer(dt), tq = this.tiltG.getWorldQuaternion(_q);
    this.finalize();                                                                  // (locoPose advanced lean / roll: matrices follow before any world-space target is made)
    if (L) layerS(P, L);
    // arms -> world IK targets (shoulder + body-frame offset, blended with the attack's own offset)
    for (const k of ['L', 'R']) {
      const off = this.armBase[k].clone(); if (L && L.armOff && L.armOff[k]) off.lerp(L.armOff[k], L.w ?? 1);
      const sh = this.rig.modelGroup.localToWorld(this.shoulderRest[k].clone()); const s = k === 'L' ? 1 : -1;
      const p = sh.add(off.applyQuaternion(tq));
      P.arms[k] = { p, pole: V(s * 0.6, -0.6, -0.3).applyQuaternion(tq), w: 1, poleW: 1 };
    }
    // eyestalks aim at the crosshair target while the slime attack is active
    if (this.eyeAimW > 0.01) for (const K of EYES) P.eyes[K] = { p: this.aimPt.clone(), w: this.eyeAimW };
    this.dbgArms = P.arms; this.poser.apply(P); this.root.updateMatrixWorld(true);
    const A = this.an, ampW = clamp((A.wa - 0.22) / 0.4, 0, 1);
    updateWingBlur(this.rig, A.wo - A.wa * 0.95, A.wo + A.wa * 0.95, ampW * 0.085 * (this.root.visible ? 1 : 0));
    this.updateFX(dt); this.updateState();
  }
  updateState() {
    const A = this.an, a = this.act;
    this.state = a ? a.kind.toUpperCase() + ':' + a.stage.toUpperCase() : this.mode === 'crouch' ? 'TAKEOFF:PREPARE' : this.mode === 'takeoff' ? 'TAKEOFF:LIFT' : this.mode === 'fly' ? (this.input && this.input.down && this.vel.y < -1 ? 'DESCEND' : this.vel.y > 2.5 ? 'ASCEND' : this.flyBoost > 0.5 && this.speed > 15 ? 'FLY:FAST' : this.speed > 5 ? 'FLY' : 'HOVER')
      : this.mode === 'landing' ? 'LANDING' : this.mode === 'air' ? 'FALL' : A.flinch > 0.3 ? 'HIT' : A.rn > 0.5 ? 'RUN' : A.mv > 0.4 ? 'WALK' : 'IDLE';
  }
  /** compile the slime / blur materials once up front so the first shot or the first fast wing beat never stalls a frame */
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 8); this.root.position.y = Math.max(0, this.root.position.y - 3); this.root.updateMatrixWorld(true);
    updateWingBlur(this.rig, 0.2, 1.4, 0.2); const m = this.pool[0]; m.visible = true; m.position.copy(camera.position).addScaledVector(dir, 4); const sl = this.g.slime, d = sl.decals[0], dv = d.visible; d.visible = true; d.position.copy(camera.position).addScaledVector(dir, 5);
    renderer.render(scene, camera);
    m.visible = false; d.visible = dv; updateWingBlur(this.rig, 0, 0, 0); this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
}
Object.assign(SfPlayer.prototype, sfPowers);
