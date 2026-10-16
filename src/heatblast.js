// Heatblast controller: ground locomotion (idle / walk / sprint / jump / double jump / landing), a full flight system (take-off, hover, 6-way flight, boost, soft landing),
// procedural animation on the supplied GLB's real skeleton, flame effects that follow the body and a dynamic fire light. Powers live in hb_powers.js.
// Runs on PLAYER time (real seconds); everything it hits reacts on WORLD time inside the target's own update.
import { HbRock } from './hb_rock.js';
import * as THREE from 'three';
import { FaPoser } from '../animations/fourarmsrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { ARMS, SIDE, V, hand, mkPose, arm, smooth, K, D, layer } from './fa_pose.js';
import { hbPowers } from './hb_powers.js';

export const HB_SCALE = 0.0165, HB_LEG = 0.9;
export const HCFG = { walk: 4.3, run: 9.8, accelG: 34, brake: 46, accelA: 11, latG: 36, jumpV: 12.8, jump2V: 11, grav: 30, radius: 0.55, height: 2.15, crouchT: 0.09, hp: 300,
  fly: { cruise: 22, boost: 57, up: 14, upBoost: 25, accel: 33, brake: 22, maxAlt: 180, takeoffV: 15, takeoffT: 0.2 } };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), TAU = Math.PI * 2;
const $ = id => document.getElementById(id);

/** knee bend that keeps the feet planted: returns nothing, writes into the pose (hips drop in metres) */
export function squat2(P, th, LEG, spread = 0.1) {
  P.d.thighL = D(-th, 0, spread); P.d.thighR = D(-th, 0, -spread); P.d.kneeL = D(2 * th); P.d.kneeR = D(2 * th); P.d.ankleL = D(-th); P.d.ankleR = D(-th);
  P.off[1] += -LEG * (1 - Math.cos(th));
}

export class HbPlayer {
  constructor(game, rig, o = {}) {
    this.g = game; this.rig = rig; this.kind = o.kind || 'heatblast'; this.cfg = o.cfg || HCFG; this.LEG = o.leg || HB_LEG; this.rad = this.cfg.radius; this.scaleK = o.scale || HB_SCALE;
    this.root = new THREE.Group(); this.root.name = o.name || 'Heatblast'; rig.modelGroup.scale.setScalar(this.scaleK); this.root.add(rig.modelGroup); game.scene.add(this.root);
    this.poser = new FaPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground';
    this.speed = 0; this.crouchT = 0; this.jumpBuffer = 0; this.landImpact = 0; this.hasInput = false; this.state = 'IDLE'; this.colH = this.cfg.height; this.jumped2 = false; this.softLand = false; this.toT = 0;
    this.hp = this.cfg.hp; this.hpT = 0; this.wantDir = new THREE.Vector3(); this.flyBoost = 0; this.alt = 0;
    this.stats = { blasts: 0, hits: 0, fireballs: 0, punches: 0, waves: 0, prot: 0, bursts: 0, flights: 0, takeoffs: 0, landings: 0, ignitions: 0, doubleJumps: 0, flyTime: 0 };
    this.an = { t: 0, ps: 0, mv: 0, rn: 0, air: 0, land: 0, landV: 0, crouch: 0, fly: 0, lean: 0, roll: 0, boost: 0, accel: 0, prevSpeed: 0, turn: 0, hov: 0, heat: 0, tk: 0 };
    this.fxT = { run: 0, trail: 0, head: 0, body: 0, hand: 0 };
    this.initPowers(game);
    this.root.rotation.y = this.yaw; this.root.visible = false;
    this.bodyMats = [rig.mats.get('rock_heat')].filter(m => m && m.isMeshStandardMaterial);   // (an unlit MeshBasic body is already full-bright at night, nothing to add) this.bodyMats.forEach(m => { if (m.map && !m.userData.glowSet) { m.userData.glowSet = 1; m.emissive = new THREE.Color(1.0, 0.42, 0.1); m.emissiveMap = m.map; m.emissiveIntensity = 0; m.needsUpdate = true; } });   // V31: the model's own texture drives the night glow (hot cracks glow, dark rock does not)
    this.fireMats = [rig.mats.get('fire'), rig.mats.get('fire01')].filter(Boolean); this.fireMats.forEach(m => { m.userData.c0 = m.color.clone(); });
    this.poser.apply(this.locoPose(0.016));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  activate(from) {
    this.pos.copy(from.pos); this.vel.copy(from.vel); this.yaw = from.yaw; this.grounded = from.grounded; this.mode = this.grounded ? 'ground' : 'air'; this.jumped2 = false; this.softLand = false;
    this.root.rotation.y = this.yaw; this.root.visible = true; this.cancelAll(); this.an.land = this.an.landV = 0; this.an.fly = 0;
    this.g.world.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, 0.4); this.root.updateMatrixWorld(true); this.poser.apply(this.locoPose(0.016));
  }
  deactivate() { this.cancelAll(); this.root.visible = false; this.light.intensity = 0; if (this.hintEl) this.hintEl.hidden = true; const e = $('firefx'); if (e) e.style.opacity = '0'; this.setFireTint(1); }
  get busy() { return !!this.act; }
  get flying() { return this.mode === 'fly' || this.mode === 'takeoff'; }
  get dmgMul() { return 1; }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const w = this.g.world, A = this.an, R = this.cfg, H = this.colH; this.landImpact = 0; this.camYaw = camYaw;
    const fwd = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want); this.input = input; this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.16;
    if (this.mode === 'fly' || this.mode === 'takeoff') { this.updateFly(dt, input, camYaw, want, hasInput); return; }
    const a = this.act, locked = a && a.lockMove;
    let top = (input.run ? R.run : R.walk) * (a ? (a.speedMul ?? 0.6) : 1) * (this.prot.on ? 1.08 : 1); if (locked) top = 0;
    // jump (crouch -> launch) and double jump
    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !(a && a.noJump)) { this.mode = 'crouch'; this.crouchT = 0; this.jumpBuffer = 0; }
    else if (this.jumpBuffer > 0 && !this.grounded && this.mode === 'air' && !this.jumped2 && !(a && a.noJump) && !this.softLand) { this.jumpBuffer = 0; this.jumped2 = true; this.vel.y = R.jump2V; this.stats.doubleJumps++; this.jetFX(0.9); }
    if (this.mode === 'crouch') { this.crouchT += dt; top *= 0.35; if (this.crouchT >= R.crouchT) { this.vel.y = R.jumpV; this.grounded = false; this.mode = 'air'; this.jumped2 = false; this.jumpFX(); } }
    const mvv = a ? a.moveVel : null;
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; }
    else {
      const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const spd0 = Math.hypot(this.vel.x, this.vel.z), turning = hasInput && spd0 > 1 ? (this.vel.x * want.x + this.vel.z * want.z) / spd0 : 1;
      const rate = this.grounded ? (hasInput ? (turning < 0.2 ? R.latG : R.accelG) : R.brake) : R.accelA, m = Math.min(dl, rate * dt);
      if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    const prevY = this.pos.y;
    if (!this.grounded) { if (this.softLand) { const hh = this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y, 80, 0.3), vt = -clamp(hh * 1.1, 2.2, 15); this.vel.y += (vt - this.vel.y) * (1 - Math.exp(-5 * dt)); } else this.vel.y = Math.max(-60, this.vel.y - (a && a.grav ? a.grav : R.grav) * dt); }
    if (a && a.hover) this.vel.y = 0;
    this.integrate(dt, prevY, H, R, true);
    this.faceUpdate(dt, camYaw, want, hasInput);
  }
  /** move + collide with sub-steps; ground/air state, landing */
  integrate(dt, prevY, H, R, groundMode) {
    const w = this.g.world, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(12, Math.ceil(hsp / 0.3))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      w.resolveXZ(this.pos, this.rad, this.pos.y, H, this.grounded ? 0.4 : 0.05);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
    }
    const y0 = this.pos.y; this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) for (const b of w.boxes) {                 // ceilings: never rise through the underside of a platform / roof
      if (b.min.y >= y0 + H - 0.05 && b.min.y < this.pos.y + H && this.pos.x > b.min.x - this.rad * 0.7 && this.pos.x < b.max.x + this.rad * 0.7 && this.pos.z > b.min.z - this.rad * 0.7 && this.pos.z < b.max.z + this.rad * 0.7) { this.pos.y = b.min.y - H; this.vel.y = 0; }
    }
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? 0.4 : 0.05, this.rad * 0.6);
    if (this.mode === 'crouch') { /* planted */ }
    else if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -4) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; this.softLand = false; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-Math.sin(y), -Math.cos(y)); }
  faceUpdate(dt, camYaw, want, hasInput) {
    const a = this.act; let target = this.yaw, k = 11;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 20; }
    else if (this.speed > 0.7 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 12 : 5; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 9; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 10, dt);
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------------------ flight
  /** X: toggle flight. ground -> take-off; mid-air -> engage; flying -> soft landing (thrusters ease him down) */
  toggleFlight() {
    if (this.mode === 'takeoff') return;
    if (this.mode === 'fly') {
      this.mode = 'air'; this.grounded = false; this.softLand = true; this.jumped2 = true; this.g.hud.toast('FLIGHT OFF'); this.vel.x *= 0.5; this.vel.z *= 0.5; this.stats.landings++;
    } else if (this.mode === 'ground' || this.mode === 'crouch') {
      if (this.act && this.act.lockMove) return; this.mode = 'takeoff'; this.toT = 0; this.stats.takeoffs++; this.stats.flights++; this.g.hud.toast('FLIGHT ON'); this.g.sfx.boom(0.35);
    } else { this.mode = 'fly'; this.grounded = false; this.softLand = false; this.stats.flights++; this.g.hud.toast('FLIGHT ON'); this.g.sfx.whoosh(); this.jetFX(1.2); if (this.vel.y < 0) this.vel.y *= 0.2; }
  }
  updateFly(dt, input, camYaw, want, hasInput) {
    const w = this.g.world, F = this.cfg.fly, R = this.cfg, H = this.colH, a = this.act, A = this.an; this.stats.flyTime += dt;
    if (this.mode === 'takeoff') {
      this.toT += dt; this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
      if (this.toT >= F.takeoffT) { this.mode = 'fly'; this.grounded = false; this.vel.y = F.takeoffV; this.jetFX(2.2); this.g.camera.addTrauma(0.2); this.pos.y += 0.05; }
      else { this.integrate(dt, this.pos.y, H, R, false); this.faceUpdate(dt, camYaw, want, hasInput); return; }
    }
    const boost = input.run && !(a && a.noBoost); this.flyBoost = damp(this.flyBoost, boost ? 1 : 0, 4, dt);
    let top = lerp(F.cruise, F.boost, this.flyBoost) * (a ? (a.flySpeedMul ?? 0.8) : 1) * (this.prot.on ? 1.05 : 1); if (a && a.lockMove) top = 0;
    const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
    const rate = (hasInput ? F.accel * (1 + 0.8 * this.flyBoost) : F.brake) * dt, m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    const upS = lerp(F.up, F.upBoost, this.flyBoost); let vyT = (input.jumpHeld ? upS : 0) - (input.down ? upS : 0); if (a && a.lockMove) vyT = 0;
    const hover = Math.sin(A.t * 2.1) * 0.35; this.vel.y += ((vyT + (vyT === 0 ? hover : 0)) - this.vel.y) * (1 - Math.exp(-(vyT === 0 ? 3.2 : 6) * dt));
    { const w = this.g.world, T = w.island && w.terrain; if (this.pos.y > (T ? Math.max(T.height(this.pos.x, this.pos.z), -0.12) : 0) + F.maxAlt && this.vel.y > 0) this.vel.y = 0; }
    const prevY = this.pos.y; this.grounded = false;
    this.integrate(dt, prevY, H, R, false);
    if (this.grounded) {                                 // touched down while flying: keep flying if the player is holding the thrusters, otherwise land
      if (input.down || (!input.jumpHeld && this.speed < 6)) { this.mode = 'ground'; this.stats.landings++; this.g.hud.toast('LANDED'); }
      else { this.grounded = false; this.pos.y += 0.02; if (this.vel.y < 0) this.vel.y = 0; }
    }
    this.alt = this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y, 60, 0.3);
    this.faceUpdate(dt, camYaw, want, hasInput);
  }

  // ------------------------------------------------------------------------------------------------ FX
  jumpFX() {
    const g = this.g, f = g.fx.fire; this.an.landV -= 2; g.sfx.flame(0.25); g.fx.surface.ring(new THREE.Vector3(this.pos.x, this.pos.y + 0.06, this.pos.z), UP, 3.5, 0.3, 0xff9a40);
    for (let i = 0; i < 12; i++) g.fire.flame(_a.set(this.pos.x + rand(-0.4, 0.4), this.pos.y + 0.1, this.pos.z + rand(-0.4, 0.4)), _b.set(rand(-2, 2), rand(0.5, 3), rand(-2, 2)), 0.5, 0.5);
    void f;
  }
  /** thruster puff under the feet (double jump / take-off / soft landing) */
  jetFX(k = 1) {
    const g = this.g; g.sfx.flame(0.3 * k);
    for (let i = 0; i < 14 * k; i++) g.fire.flame(_a.set(this.pos.x + rand(-0.35, 0.35), this.pos.y + 0.1, this.pos.z + rand(-0.35, 0.35)), _b.set(rand(-2.5, 2.5), rand(-9, -3) * k, rand(-2.5, 2.5)), rand(0.5, 0.9), rand(0.3, 0.5), 1.1);
    for (let i = 0; i < 5 * k; i++) g.fire.smoke(_a.set(this.pos.x + rand(-0.4, 0.4), this.pos.y + 0.3, this.pos.z + rand(-0.4, 0.4)), _b.set(rand(-2, 2), rand(0.2, 1), rand(-2, 2)), rand(1, 1.6), 1.4);
    g.fx.surface.ring(new THREE.Vector3(this.pos.x, Math.max(0, this.pos.y) + 0.06, this.pos.z), UP, 3 * k, 0.35, 0xff9a40);
  }
  /** landing: knees absorb, sparks; hard landings throw a fiery shockwave */
  landFX(v) {
    const g = this.g, k = clamp((v - 4) / 20, 0, 1); this.an.landV += 3 + 8 * k; g.camera.addTrauma(0.06 + 0.35 * k); g.sfx.thud(0.2 + 0.5 * k);
    const c = _a.set(this.pos.x, this.pos.y + 0.06, this.pos.z).clone();
    for (let i = 0; i < 8 + 16 * k; i++) g.fire.spark(c.clone().setY(c.y + 0.1), _b.set(rand(-1, 1), rand(0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8) * (0.6 + k)).clone(), rand(0.4, 0.8));
    for (let i = 0; i < 6 + 12 * k; i++) g.fire.flame(c, _b.set(rand(-1, 1), rand(0.3, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 5) * (0.5 + k)), rand(0.5, 1) * (0.6 + k), rand(0.3, 0.6), 1.1);
    if (k > 0.25) { g.fx.surface.ring(c, UP, 4 + 7 * k, 0.4, 0xff8a2a); g.fire.scorchAt(c.x, c.y, c.z, 1.2 + 2 * k, 7); if (g.props) g.props.shockwave(c, 3 + 4 * k, 4 + 8 * k, 0, 0); g.fire.lights.flash(c.clone().setY(c.y + 0.8), [1, 0.6, 0.2], 20 * k + 8, 0.35, 14); }
    if (k > 0.6) { for (const h of g.world.hittables) { if (h.dead) continue; const d = Math.hypot(h.root.position.x - c.x, h.root.position.z - c.z); if (d < 4.5) { _b.set(h.root.position.x - c.x, 0, h.root.position.z - c.z).normalize(); h.applyHit(h.root.position.clone().setY(1.2), _b.clone(), 18 * k); h.shove && h.shove(_b, 9 * k); g.fire.igniteDummy(h, 2.5); } } }
  }
  /** continuous body flames (head, hands, back), speed-dependent trails, run sparks, the fire light and the pulsing glow on the model's flame-coloured materials */
  updateFX(dt) {
    const g = this.g, F = g.fire, A = this.an, ft = this.fxT, R = this.rig; if (!this.root.visible) return;
    const sp = this.speed + Math.abs(this.vel.y) * 0.5, fastFly = this.flying ? clamp((Math.hypot(this.vel.x, this.vel.z) - 10) / 24, 0, 1) : 0, boosting = this.flyBoost > 0.5;
    const prot = this.prot.on ? this.prot.k : 0, inten = 1 + 1.8 * prot + 0.6 * (this.act ? 1 : 0) + (this.act && this.act.kind === 'burst' ? 2 : 0);
    const back = _b.set(-this.vel.x, -this.vel.y * 0.3, -this.vel.z).multiplyScalar(0.28);
    // head flame (the model's own flame mesh stays; these are living embers on top of it)
    ft.head -= dt; if (ft.head <= 0) { ft.head = 0.045 / inten; const hp = this.boneWorld(R.bones.head, _a); hp.y += 0.22; for (let k = 0; k < 2; k++) F.flame(_c.set(hp.x + rand(-0.12, 0.12), hp.y + rand(0, 0.25), hp.z + rand(-0.12, 0.12)), _a.set(back.x + rand(-0.4, 0.4), 1.8 + rand(0, 1.2) * inten + Math.max(0, -this.vel.y) * 0.1, back.z + rand(-0.4, 0.4)), rand(0.28, 0.5) * (0.8 + 0.3 * inten), rand(0.35, 0.6), 1.2); }
    // hands + back + shoulders
    ft.hand -= dt; if (ft.hand <= 0) {
      ft.hand = 0.08 / inten;
      for (const k of ['UL', 'UR']) { const hp = this.handTip(k, _a); F.flame(hp, _c.set(back.x + rand(-0.5, 0.5), rand(0.6, 1.6) * inten, back.z + rand(-0.5, 0.5)), rand(0.18, 0.34) * (0.8 + 0.4 * inten), rand(0.25, 0.45), 1); }
      const ch = this.boneWorld(R.bones.chest, _a); if (this.speed > 3 || prot > 0 || this.flying) F.flame(_c.set(ch.x + rand(-0.4, 0.4), ch.y + rand(-0.5, 0.2), ch.z + rand(-0.4, 0.4)), _b.set(back.x + rand(-0.5, 0.5), rand(0.5, 1.5), back.z + rand(-0.5, 0.5)), rand(0.25, 0.5), rand(0.3, 0.55), 1);
    }
    // protection aura: flames licking all around the body
    if (prot > 0.05) { ft.body -= dt; if (ft.body <= 0) { ft.body = 0.02; for (let k = 0; k < 2; k++) { const a = rand(0, TAU), h = rand(0.1, 2.0); F.flame(_a.set(this.pos.x + Math.cos(a) * 0.55, this.pos.y + h, this.pos.z + Math.sin(a) * 0.55), _b.set(Math.cos(a) * 1.2, rand(1.5, 3.2), Math.sin(a) * 1.2), rand(0.35, 0.7) * prot, rand(0.4, 0.7), 1.3); } } }
    // run sparks behind the feet
    if (this.grounded && A.rn > 0.5) { ft.run -= dt; if (ft.run <= 0) { ft.run = 0.04; for (const s of [R.bones.ankleL, R.bones.ankleR]) { const fp = this.boneWorld(s, _a); fp.y = this.pos.y + 0.08; F.spark(fp, _c.set(-this.vel.x * 0.3 + rand(-1.5, 1.5), rand(0.8, 2.6), -this.vel.z * 0.3 + rand(-1.5, 1.5)).clone(), rand(0.3, 0.55)); } } }
    // flight thrusters + fire trails (heavier and longer with speed; smoke at high speed)
    if (this.flying || this.softLand) {
      ft.trail -= dt; if (ft.trail <= 0) {
        ft.trail = 0.03;
        const feet = [R.bones.ankleL, R.bones.ankleR], hov = 1 - fastFly;
        for (const s of feet) { const fp = this.boneWorld(s, _a); F.flame(fp, _c.set(back.x * 1.2 + rand(-0.8, 0.8), -3 * hov - 1 + rand(-1, 1) + back.y, back.z * 1.2 + rand(-0.8, 0.8)), rand(0.4, 0.75), rand(0.4, 0.7) + 0.5 * fastFly, 1.1); }
        if (fastFly > 0.15) for (const k of ['UL', 'UR']) { const hp = this.handTip(k, _a); F.flame(hp, _c.set(back.x * 1.4 + rand(-0.4, 0.4), rand(-0.3, 0.3), back.z * 1.4 + rand(-0.4, 0.4)), rand(0.25, 0.45), 0.45 + 0.5 * fastFly, 1); }
        if (fastFly > 0.15) { const bp = this.boneWorld(R.bones.hips, _a); F.flame(bp, _c.set(back.x * 1.5 + rand(-0.4, 0.4), rand(-0.4, 0.4), back.z * 1.5 + rand(-0.4, 0.4)), rand(0.5, 0.9), 0.7 + 0.6 * fastFly, 1.1); }
        if (boosting && Math.random() < 0.5) F.smoke(this.boneWorld(R.bones.hips, _a), _c.set(back.x * 0.6, 0, back.z * 0.6), rand(1.0, 1.7), 1.5);
      }
    }
    // fire light on the body (slot 0 of the pool is reserved for the player)
    const L = F.lights.items[0].l; this.light = L; const flick = 0.85 + 0.15 * Math.sin(A.t * 19) * Math.sin(A.t * 7.3) + 0.08 * Math.random();
    const act = this.act, big = act ? (act.kind === 'burst' ? 3.5 : act.kind === 'blast' || act.kind === 'fireball' || act.kind === 'punch' || act.kind === 'wave' ? 1.6 : 1) : 1;
    A.heat = damp(A.heat, (4.5 + 2.5 * (this.flying ? 1 : 0) + 2.2 * Math.min(1, sp / 10) + 22 * prot) * big, 7, dt);
    // V31 NIGHT GLOW: his flames light him and his surroundings (brighter body light, glowing rock-cracks, hands lit while attacking); by day it stays as before
    const nk = g.dayNight ? g.dayNight.night : 0; F.lights.boost = 1 + 1.3 * nk; A.nightK = damp(A.nightK || 0, nk, 3, dt); const NK = A.nightK;
    if (this.bodyMats) for (const m of this.bodyMats) { m.emissiveIntensity = NK * (0.75 + 0.25 * Math.sin(A.t * 4.1)) * (this.act ? 1.5 : 1); }
    L.position.set(this.pos.x, this.pos.y + 1.4, this.pos.z); L.intensity = A.heat * flick * (1 + 1.6 * NK) * (this.act && NK > 0.1 ? 1.25 : 1); L.color.setRGB(1, 0.5 + 0.12 * prot + 0.08 * flick, 0.18 + 0.2 * prot); L.distance = 11 + 6 * prot + 6 * NK + (act && act.kind === 'burst' ? 14 : 0);
    this.setFireTint(1 + 0.18 * NK + 0.12 * Math.sin(A.t * 3.1) + 0.12 * prot + 0.4 * (act && act.kind === 'burst' ? 1 : 0) + 0.07 * Math.sin(A.t * 11));
  }
  /** brighten / pulse the model's yellow flame materials (runtime tint on the unlit material colour; the asset itself is untouched) */
  setFireTint(k) { for (const m of this.fireMats) { m.color.copy(m.userData.c0).multiplyScalar(k); } }
  boneWorld(b, out) { return out.setFromMatrixPosition(b.matrixWorld); }
  /** the far end of a hand: wrist + 0.2 m along the forearm direction */
  handTip(k, out) {
    const A = this.rig.arms[k], e = _c.setFromMatrixPosition(A.e.matrixWorld), w = out.setFromMatrixPosition(A.w.matrixWorld); const d = _b.copy(w).sub(e); if (d.lengthSq() > 1e-8) d.normalize(); else d.set(0, 0, 1);
    return out.addScaledVector(d, 0.2);
  }

  // ------------------------------------------------------------------------------------------------ animation
  /** continuous pose: idle <-> walk <-> sprint, crouch, jump, landing, flight */
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(), grounded = this.grounded || this.mode === 'crouch', LEG = this.LEG;
    A.t += dt; const t = A.t;
    A.mv = damp(A.mv, grounded ? smoothstep(0.3, 3.4, sp) : 0, 10, dt); A.rn = damp(A.rn, grounded ? smoothstep(5.5, 9, sp) : 0, 8, dt);
    A.air = damp(A.air, grounded ? 0 : 1, 14, dt); A.crouch = damp(A.crouch, this.mode === 'crouch' ? clamp(this.crouchT / this.cfg.crouchT, 0, 1) : this.mode === 'takeoff' ? clamp(this.toT / this.cfg.fly.takeoffT, 0, 1) : 0, 22, dt);
    A.fly = damp(A.fly, this.mode === 'fly' || this.softLand ? 1 : 0, this.mode === 'fly' ? 7 : 5, dt);
    const stride = lerp(2.2, 3.7, A.rn); const prevPs = A.ps; if (grounded) A.ps += dt * (sp / stride) * TAU; A.ps %= TAU * 50;
    if (grounded && A.mv > 0.5 && dt > 0) { const a0 = Math.floor(prevPs / Math.PI), a1 = Math.floor(A.ps / Math.PI); if (a1 !== a0) this.footstep(a1 % 2 ? 1 : -1); }
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 34, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    if (dt > 0) { A.landV += (-130 * A.land - 12 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.3, 1.2); }
    const ps = A.ps, s = Math.sin(ps), c = Math.cos(ps), mv = A.mv, rn = A.rn, idle = 1 - mv, air = A.air * (1 - A.fly), ground = 1 - A.air, b = Math.sin(t * 2.0), land = clamp(A.land, 0, 1.2), cr = A.crouch;
    // ---------- torso (breathing, shoulder roll, sprint lean)
    const lean = (0.03 + 0.06 * mv + 0.3 * rn + 0.14 * A.accel) * ground + 0.1 * air + 0.34 * cr + 0.32 * land;
    P.d.hips = D(lean * 0.2, -0.14 * s * mv * ground, 0.03 * s * mv + 0.015 * Math.sin(t * 0.5) * idle);
    P.d.spine = D(lean * 0.42 + 0.014 * b, 0.12 * s * mv * (1 + rn), 0); P.d.chest = D(lean * 0.4 + 0.026 * b * idle + 0.03 * Math.sin(ps * 2) * mv, 0.28 * s * (0.5 * mv + 0.5 * rn) * ground, -0.04 * s * mv);
    P.d.neck = D(-lean * 0.38, -0.1 * s * mv, 0); P.d.head = D(-lean * 0.3 + 0.025 * Math.sin(t * 0.9) * idle, 0.08 * Math.sin(t * 0.43) * idle, 0.02 * Math.sin(t * 0.7) * idle);
    P.d.jaw = D(0.03 + 0.03 * Math.sin(t * 1.6), 0, 0);
    P.off[0] = 0.025 * s * mv * ground; P.off[1] = (-0.045 * mv - 0.1 * rn * (0.5 + 0.5 * Math.cos(2 * ps)) + 0.01 * b) * ground; P.off[2] = lean * 0.1;
    // ---------- legs
    const A_th = lerp(0.46, 0.95, rn), K_k = lerp(0.7, 1.55, rn), sw = [s, -s], th = [0, 0], kn = [0, 0];
    for (let i = 0; i < 2; i++) {
      const sv = sw[i], cv = i ? -c : c; th[i] = (-A_th * sv - 0.04) * mv * ground - 0.04 * idle * ground; kn[i] = (K_k * Math.max(0, cv) * (0.6 + 0.4 * Math.abs(sv)) + 0.08) * mv * ground + 0.05 * idle * ground;
      const rise = clamp(this.vel.y / 12, -1, 1), tuck = i ? 0.3 : 0.8; th[i] += air * (-0.3 - 0.35 * Math.max(0, rise) * (i ? 0.3 : 1)); kn[i] += air * (0.3 + tuck * Math.max(0, rise) * 0.9 + 0.2 * (i ? 0 : 1));
    }
    P.d.thighL = D(th[0], 0, 0.06 * idle + 0.03); P.d.thighR = D(th[1], 0, -0.06 * idle - 0.03); P.d.kneeL = D(kn[0]); P.d.kneeR = D(kn[1]);
    P.d.ankleL = D(-(th[0] + kn[0]) * 0.85 + 0.2 * Math.max(0, -s) * mv); P.d.ankleR = D(-(th[1] + kn[1]) * 0.85 + 0.2 * Math.max(0, s) * mv);
    const sq = Math.max(cr * 0.9, land * 0.8); if (sq > 0.01) { squat2(P, sq, LEG, 0.1); P.d.thighL[0] += th[0] * 0.3; P.d.thighR[0] += th[1] * 0.3; }
    // ---------- arms (IK targets in the chest frame)
    const swing = lerp(0.32, 0.62, rn), swU = [-s, s];
    for (let i = 0; i < 2; i++) {
      const k = i ? 'UR' : 'UL', sv = swU[i], bp = Math.sin(t * 2.0 + i * 1.3);
      let H0 = hand(k, 0.4 + 0.015 * bp, -0.66 + 0.012 * bp, 0.06); const Hr = hand(k, 0.3, -0.28, 0.5);
      H0 = H0.lerp(Hr, rn); H0.z += sv * swing * mv; H0.y += Math.max(0, sv) * 0.22 * mv * (0.5 + rn); H0.x -= SIDE[k] * 0.06 * Math.max(0, sv) * mv;
      const Ha = hand(k, 0.7, 0.2 + 0.18 * Math.sin(t * 6 + i), 0.15), Hc = hand(k, 0.4, -0.6, -0.4), Hl = hand(k, 0.6, -0.55, 0.3);
      let p = H0.clone().lerp(Ha, air).lerp(Hc, cr).lerp(Hl, clamp(land, 0, 1) * 0.8);
      arm(P, k, p, hand(k, 0.5, -0.2, -0.9)); P.curl[k] = lerp(0.3, 0.85, rn) * ground + 0.4 * air + 0.7 * cr;
    }
    if (A.fly > 0.01) this.flyOverlay(P, A.fly, dt);
    return P;
  }
  /** flight posture: leans into the direction of travel (pitch for forward/back, roll for strafing), legs trail, arms sweep back with speed */
  flyOverlay(P, W, dt) {
    const A = this.an, F = this.cfg.fly, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), vf = this.vel.x * fx + this.vel.z * fz, vl = this.vel.x * fz - this.vel.z * fx;
    const spF = clamp(vf / F.cruise, -1, 1), spB = clamp(vf / F.boost, -1, 1), boost = this.flyBoost, up = clamp(this.vel.y / 12, -1, 1);
    const tl = clamp(spF * 0.42 + (vf > F.cruise ? (vf - F.cruise) / (F.boost - F.cruise) * 0.8 : 0) + (this.mode === 'fly' ? 0 : 0.08), -0.3, 0.42), tr = clamp(-vl / F.cruise * 0.55, -0.7, 0.7);
    A.lean = damp(A.lean, tl, 5, dt); A.roll = damp(A.roll, tr, 5, dt); A.boost = damp(A.boost, boost, 6, dt);
    const Q = mkPose(), lean = A.lean, roll = A.roll, t = A.t, hov = 1 - clamp(Math.abs(lean) / 0.5, 0, 1), fast = clamp((lean - 0.4) / 0.8, 0, 1);
    Q.d.hips = D(lean + 0.03 * Math.sin(t * 2.1) * hov - 0.12 * up * (1 - fast), 0, roll); Q.d.spine = D(-0.12 * lean + 0.03 * Math.sin(t * 2.1 + 1) * hov, 0, -roll * 0.3); Q.d.chest = D(-0.12 * lean, 0, -roll * 0.2);
    Q.d.neck = D(-0.45 * lean, 0, 0); Q.d.head = D(-0.25 * lean - 0.05, 0, -roll * 0.2);
    const trail = 0.25 + 0.5 * fast + 0.1 * Math.sin(t * 7), kb = 0.25 + 0.7 * fast;
    Q.d.thighL = D(trail, 0, 0.1 + 0.06 * hov); Q.d.thighR = D(trail * 0.85, 0, -0.1 - 0.06 * hov); Q.d.kneeL = D(kb + 0.05 * Math.sin(t * 4)); Q.d.kneeR = D(kb * 0.9 + 0.05 * Math.sin(t * 4 + 1)); Q.d.ankleL = D(0.5); Q.d.ankleR = D(0.5);
    for (let i = 0; i < 2; i++) {
      const k = i ? 'UR' : 'UL', Hh = hand(k, 0.62, -0.42 + 0.03 * Math.sin(t * 2.4 + i), 0.18), Hf = hand(k, 0.2, -0.78, -0.2), Hc = hand(k, 0.45, -0.2, 0.55);
      arm(Q, k, Hh.clone().lerp(Hc, clamp(spF, 0, 1) * 0.5).lerp(Hf, fast), hand(k, 0.7, 0.2, -0.6)); Q.curl[k] = 0.15 + 0.4 * fast;
    }
    Q.off = [0, 0.02 * Math.sin(t * 2.1) * hov - 0.08 * Math.abs(roll), 0.05 * lean]; Q.w = W; layer(P, Q, this.poser);
  }
  rockUpdate(dt) { if (!this.rock) this.rock = new HbRock(this.g); this.rock.update(dt, this); }
  footstep(side) {
    const g = this.g, A = this.an; g.camera.addTrauma(0.01 + 0.02 * A.rn); g.sfx.thud(0.05 + 0.1 * A.rn);
    if (A.rn > 0.4) { const fp = this.boneWorld(side > 0 ? this.rig.bones.ankleL : this.rig.bones.ankleR, _a); for (let i = 0; i < 2; i++) g.fire.flame(_c.set(fp.x, this.pos.y + 0.1, fp.z), _b.set(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)), 0.3, 0.3, 1); }
  }
  /** per-frame: locomotion + action layer -> skeleton */
  updateAnim(dt) {
    const A = this.an, P = this.locoPose(dt); const L = this.actLayer(dt); if (L) layer(P, L, this.poser);
    this.poser.apply(P); this.root.updateMatrixWorld(true); this.updateFX(dt); this.rockUpdate(dt); this.updateState();
  }
  updateState() {
    const A = this.an;
    this.state = this.act ? this.act.kind.toUpperCase() + ':' + this.act.stage.toUpperCase() : this.mode === 'takeoff' ? 'TAKE-OFF' : this.mode === 'fly' ? (this.flyBoost > 0.5 ? 'FLY:BOOST' : (Math.hypot(this.vel.x, this.vel.z) < 2 ? 'HOVER' : 'FLY')) : this.softLand ? 'FLY:LANDING' : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : A.land > 0.3 ? 'LAND' : A.rn > 0.5 ? 'SPRINT' : A.mv > 0.4 ? 'WALK' : 'IDLE';
  }
}
Object.assign(HbPlayer.prototype, hbPowers);
