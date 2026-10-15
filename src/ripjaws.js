// Ripjaws controller: a real land / shallows / deep-water character.
//   land      : walk / run with foot-path IK, crouch-jump (single jump), landing absorb, wading through the shallows (slower, splashes)
//   water     : the lagoon (src/water.js) gives the floor, the depth and the swim volume. Deep water (>= 1.35 m under the feet, or the body falling below the surface) switches to
//               real 3D swim physics: WASD along the camera's 3D heading, Space up / Ctrl down, Shift = fast swim, momentum + water resistance, sphere collision against the seabed,
//               rocks, crates and walls, a ceiling at the surface, a breach (leap) with normal gravity and a splash on re-entry.
//   attacks   : bite (LMB) and claw swipe (E) in src/rj_powers.js - contact is tested at the mouth / claw markers of the animated model.
// Runs on PLAYER time. pos = the feet while upright; the body tilts about a pivot at hip height (PIV), so while swimming the swim centre is pos.y + PIV.
import * as THREE from 'three';
import { RjPoser, RJ_SCALE } from '../animations/ripjawsrig.js';
import { RjAnim } from './rj_pose.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { ARENA } from './world.js';
import { rjPowers } from './rj_powers.js';

const $ = id => document.getElementById(id);
export const RCFG = { r: 0.5, h: 2.35, walk: 3.0, run: 6.8, accel: 22, brake: 30, latG: 30, accelA: 5, grav: 26, jumpV: 10.2, crouchT: 0.15, step: 0.45, swimR: 0.62, cruise: 10.9, fast: 20.4, vert: 8.5, vertFast: 14.5, breachV: 6.5, hp: 320, deep: 1.35, exitDepth: 1.0, airDeep: 1.15 };
export const PIV = 1.15;
const A_IN = ARENA - 0.6, TAU = Math.PI * 2, sin = Math.sin, cos = Math.cos;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export class RjPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.L = game.world.lagoon; this.kind = 'ripjaws'; this.rad = RCFG.r; this.colH = RCFG.h;
    this.root = new THREE.Group(); this.root.name = 'Ripjaws';
    this.tiltG = new THREE.Group(); this.tiltG.position.set(0, PIV, 0); this.tiltG.name = 'RipjawsTilt'; this.root.add(this.tiltG);
    rig.modelGroup.scale.setScalar(RJ_SCALE); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.poser = new RjPoser(rig); this.anim = new RjAnim();
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground'; this.speed = 0; this.state = 'IDLE';
    this.crouchT = 0; this.crouchDur = RCFG.crouchT; this.jumpBuffer = 0; this.landK = 0; this.landV = 0; this.landImpact = 0; this.hasInput = false; this.wantDir = new THREE.Vector3(); this.input = null; this.camYaw = 0;
    this.hp = RCFG.hp; this.hpT = 0; this.tilt = 0; this.bank = 0; this.turnRate = 0; this.wetT = 0; this.wadeK = 0; this.dW = 0; this.exitLift = 0; this.breachT = 0; this.t = 0; this.wasWet = false; this.stepIdx = 0;
    this.env = 'LAND'; this.depth = 0; this.c = new THREE.Vector3(); this.pCam = { min: -0.28, max: 1.25 }; this.fx = { bub: 1, wake: 0, silt: 0, trail: 0, stroke: 0, drip: 0, wade: 0 };
    this.stats = { bites: 0, hits: 0, claws: 0, clawHits: 0, chomped: 0, entries: 0, exits: 0, breaches: 0, jumps: 0, landings: 0, dives: 0, maxDepth: 0, swimTime: 0, timeSwim: 0 };
    this.initPowers(game);
    this.root.rotation.y = this.yaw; this.root.visible = false;
    this.root.updateMatrixWorld(true); this.poser.apply(this.anim.pose(0.016, this.animState(0.016))); this.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  /** deep underwater the surface world cannot reach him (turret bolts, baton swings) */
  get ignoreHits() { return this.mode === 'swim' && (this.L.waterY - (this.pos.y + PIV)) > 0.9; }
  get hitSphere() { return this.mode === 'swim' ? { y: PIV, r: 0.95 } : { y: 1.3, r: 1.0 }; }
  get busy() { return !!this.act; }
  get swimming() { return this.mode === 'swim'; }
  get centre() { return this.c.set(this.pos.x, this.pos.y + (this.mode === 'swim' ? PIV : 1.2), this.pos.z); }
  /** switched TO Ripjaws: keep position / facing / momentum; over deep water he is swimming at once */
  activate(from) {
    const L = this.L, p = this.pos, v = this.vel; this.cancelAll(); p.copy(from.pos); this.yaw = from.yaw; v.set(from.vel.x, clamp(from.vel.y, -8, 8), from.vel.z); this.input = null;
    const hs = Math.hypot(v.x, v.z); if (hs > 9) { v.x *= 9 / hs; v.z *= 9 / hs; }
    this.mode = 'ground'; this.grounded = true; this.tilt = 0; this.bank = 0; this.landK = this.landV = 0; this.exitLift = 0; this.crouchT = 0; this.anim.gest = null;
    const inR = L.inRect(p.x, p.z, 0.2), dep = inR ? L.depthAt(p.x, p.z) : 0;
    if (inR && dep >= RCFG.deep && from.pos.y > L.waterY - PIV * 1.2) {                       // standing over / in the lagoon: straight into swim mode at the surface
      this.mode = 'swim'; this.grounded = false; p.y = L.waterY + 0.04 - PIV; v.y = Math.min(v.y, 0) * 0.5; this.tilt = 0.4; this.wetT = 3; this.wasWet = true; L.splash(p.x, p.z, 0.35, v);
    } else {
      this.g.world.resolveXZ(p, this.rad, p.y, this.colH, RCFG.step);
      const gy = L.groundFor(p.x, p.z, p.y, 0.6, this.rad * 0.6);
      if (p.y <= gy + 0.02) { p.y = gy; v.y = Math.max(v.y, 0); } else { this.grounded = false; this.mode = 'air'; }
      if (inR && L.waterY - p.y > 0.05) this.wetT = 3;
    }
    this.speed = Math.hypot(v.x, v.z); this.turnRate = 0; this.stepIdx = 0;
    this.camSetup(true); this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true); this.postMove(0.016); this.updateAnim(0.016);
  }
  /** C pressed while Ripjaws: no attack / effect survives into the next alien, and the next alien never starts under water (only Ripjaws can dive) */
  leave() {
    this.cancelAll(); const p = this.pos, v = this.vel, L = this.L, was = this.mode === 'swim' || (L.inRect(p.x, p.z, 0.2) && L.waterY - p.y > 0.3);
    if (this.g.world.island) {                                   // V28 island: walk the spot up the sea bed to wading depth, then stand on the ground there
      let k = 0; while (L.depthAt(p.x, p.z) > 0.95 && k++ < 400) L.pushShore(p, 0.95);
      if (this.mode === 'swim' || p.y < L.floorAt(p.x, p.z)) p.y = Math.max(L.floorAt(p.x, p.z), this.g.world.groundAt(p.x, p.z, p.y + 1, 0.5, 0.3)); v.y = Math.max(0, Math.min(v.y, 3));
    } else if (this.mode === 'swim' || p.y < 0) { p.y = Math.max(0, L.inRect(p.x, p.z, 0.2) ? 0 : this.g.world.groundAt(p.x, p.z, p.y + 1, 0.5, 0.3)); v.y = Math.max(0, Math.min(v.y, 3)); }
    let k = 0; while (!this.g.world.island && L.inRect(p.x, p.z, 0.3) && L.depthAt(p.x, p.z) > 0.95 && p.y <= 0.01 && k++ < 90) p.z -= 0.25;           // the next alien can wade but not dive: it appears at the nearest wading depth (toward the beach)
    this.g.world.resolveXZ(p, 0.9, p.y, 2.8, 0.5); v.multiplyScalar(0.7); this.mode = 'ground'; this.grounded = true; this.tilt = 0;
    this.camSetup(false); this.L.clearFX();
    if (was) this.g.hud.toast('ONLY RIPJAWS CAN DIVE');
    this.root.updateMatrixWorld(true);
  }
  deactivate() { this.cancelAll(); this.root.visible = false; this.camSetup(false); }
  camSetup(on) {
    const cam = this.g.camera, L = this.L; L.camMode = on; cam.floorFn = on ? (x, z) => L.camFloor(x, z) : null;
    if (!on) { cam.pitchMin = -0.28; cam.pitchMax = 1.25; } else { this.pCam.min = cam.pitchMin; this.pCam.max = cam.pitchMax; }
  }
  onHit(dmg, pt, dir) {
    if (this.ignoreHits && !(this.g.impact.aquaT > 0)) return; const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg); this.hpT = 4;
    if (this.hp <= 0) { this.hp = RCFG.hp * 0.6; g.hud.toast('SECOND WIND'); }
  }
  knock(dir, v) { const k = this.mode === 'swim' ? 0.45 : 1; this.vel.x += dir.x * v * k; this.vel.z += dir.z * v * k; }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-sin(y), -cos(y)); }
  /** the 3D direction the crosshair looks along (used for swim heading and for choosing bite targets underwater) */
  aimDir3(out) { const cam = this.g.camera, pe = clamp(cam.pitch - 0.22, -1.3, 1.3), cp = cos(pe), y = this.camYaw ?? cam.yaw; return out.set(-sin(y) * cp, -sin(pe), -cos(y) * cp); }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    this.camYaw = camYaw; this.input = input; this.t += dt; this.landImpact = 0;
    this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0 && this.hp < RCFG.hp) this.hp = Math.min(RCFG.hp, this.hp + 10 * dt);
    this.landV += (-150 * this.landK - 13 * this.landV) * dt; this.landK = clamp(this.landK + this.landV * dt, -0.2, 1.1);
    if (this.exitLift > 0) this.exitLift = Math.max(0, this.exitLift - dt);
    if (this.mode === 'swim') this.swimPhysics(dt, input, camYaw); else this.landPhysics(dt, input, camYaw);
    this.postMove(dt);
  }

  // ---------------------------------------------------------------------------- land
  landPhysics(dt, input, camYaw) {
    const R = RCFG, a = this.act, H = this.colH;
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const has = want.lengthSq() > 1e-4; if (has) want.normalize();
    this.hasInput = has; this.wantDir.copy(want); this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.16;
    const spd0 = Math.hypot(this.vel.x, this.vel.z), wade = this.wadeK;
    let top = (input.run ? R.run : R.walk) * (a ? (a.speedMul ?? 0.75) : 1) * (1 - 0.26 * wade); if (a && a.lockMove) top = 0;
    // single jump: crouch -> launch (no double jump, no flight)
    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !(a && a.noJump)) { this.mode = 'crouch'; this.crouchT = 0; this.crouchDur = lerp(R.crouchT, 0.08, smoothstep(2, 7, spd0)); this.jumpBuffer = 0; if (a) this.cancelAct(); }
    if (this.mode === 'crouch') { this.crouchT += dt; if (this.crouchT >= this.crouchDur) { this.vel.y = R.jumpV * (1 - 0.12 * wade); this.grounded = false; this.mode = 'air'; if (has) { this.vel.x += want.x * 1.4; this.vel.z += want.z * 1.4; } this.jumpFX(); } }
    const mvv = a ? a.moveVel : null;
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; }
    else if (this.mode === 'crouch') { const k = Math.exp(-1.4 * dt); this.vel.x *= k; this.vel.z *= k; }
    else {
      const airTop = Math.max(Math.hypot(this.vel.x, this.vel.z), R.walk), tgt = this.grounded ? top : airTop;
      const tx = has ? want.x * tgt : 0, tz = has ? want.z * tgt : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const turning = has && spd0 > 1 ? (this.vel.x * want.x + this.vel.z * want.z) / spd0 : 1;
      const rate = this.grounded ? (has ? (turning < 0.2 ? R.latG : R.accel) : R.brake) : (has ? R.accelA : 0.4), m = Math.min(dl, rate * dt);
      if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    const prevY = this.pos.y;
    if (!this.grounded) this.vel.y = Math.max(-60, this.vel.y - R.grav * dt);
    this.integrate(dt, prevY, H);
    this.faceUpdate(dt, camYaw, want, has);
  }
  integrate(dt, prevY, H) {
    const w = this.g.world, L = this.L, p = this.pos, v = this.vel, hsp = Math.hypot(v.x, v.z) * dt, n = Math.max(1, Math.min(10, Math.ceil(hsp / 0.28))), h = dt / n, step = this.grounded ? RCFG.step : 0.05;
    for (let i = 0; i < n; i++) {
      p.x += v.x * h; p.z += v.z * h; const ox = p.x, oz = p.z; w.resolveXZ(p, this.rad, p.y, H, step); L.keepOutDeep && 0;
      const moved = Math.hypot(p.x - ox, p.z - oz);
      if (moved > 1e-4) { const nx = (p.x - ox) / moved, nz = (p.z - oz) / moved, vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; } }
    }
    const y0 = p.y; p.y += v.y * dt;
    if (v.y > 0) for (const b of w.boxes) {                       // ceilings: never rise through the underside of a platform / roof
      if (b.min.y >= y0 + H - 0.05 && b.min.y < p.y + H && p.x > b.min.x - this.rad * 0.7 && p.x < b.max.x + this.rad * 0.7 && p.z > b.min.z - this.rad * 0.7 && p.z < b.max.z + this.rad * 0.7) { p.y = b.min.y - H; v.y = 0; }
    }
    const gy = L.groundFor(p.x, p.z, prevY, this.grounded ? step : 0.05, this.rad * 0.6), snapDown = 0.08 + hsp * 0.75;
    if (this.mode === 'crouch') { /* planted */ if (p.y < gy) p.y = gy; }
    else if (p.y <= gy + 1e-4 && v.y <= 0) {
      if (!this.grounded && v.y < -4) { this.landImpact = -v.y; this.landFX(this.landImpact); }
      if (this.grounded && this.exitLift > 0 && p.y < gy - 0.001) p.y = Math.min(gy, p.y + 5 * dt); else p.y = gy;
      v.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && p.y > gy + snapDown) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    else if (this.grounded && p.y > gy && v.y <= 0) p.y = gy;                                  // walking down a slope: stay on it
    if (this.grounded && this.mode !== 'crouch' && p.y < gy) p.y = this.exitLift > 0 ? Math.min(gy, p.y + 5 * dt) : gy;
    this.speed = Math.hypot(v.x, v.z);
  }
  faceUpdate(dt, camYaw, want, has) {
    const a = this.act; let target = this.yaw, k = 10;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 18; }
    else if (this.mode === 'air') { if (this.speed > 2) { target = Math.atan2(this.vel.x, this.vel.z); k = 3.5; } }
    else if (this.speed > 0.7 && has) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? lerp(13, 7, smoothstep(3, 7, this.speed)) : 4; }
    else if (has) { target = Math.atan2(want.x, want.z); k = 9; }
    const step = angleDelta(this.yaw, target) * (1 - Math.exp(-k * dt)); this.yaw += step; this.turnRate = damp(this.turnRate, step / Math.max(dt, 1e-4), 9, dt);
  }

  // ---------------------------------------------------------------------------- swimming
  swimPhysics(dt, input, camYaw) {
    const R = RCFG, L = this.L, p = this.pos, v = this.vel, a = this.act, c = this.c;
    const fwd = this.aimDir3(_a), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const has = want.lengthSq() > 1e-4; if (has) want.normalize();
    this.hasInput = has; this.wantDir.copy(want); this.grounded = false;
    const vIn = (input.jumpHeld ? 1 : 0) - (input.down ? 1 : 0), fast = input.run && (has || vIn !== 0), sm = a ? (a.speedMul ?? 0.8) : 1;
    let top = (fast ? R.fast : R.cruise) * sm, vtop = (fast ? R.vertFast : R.vert) * sm; if (a && a.lockMove) { top = 0; vtop = 0; }
    const tx = has ? want.x * top : 0, tz = has ? want.z * top : 0, ty = (has ? want.y * top : 0) + vIn * vtop;
    const kh = has ? 6.6 : 3.6, kv = has || vIn ? 7.0 : 3.6;
    if (a && a.moveVel3) v.copy(a.moveVel3);
    else {
      v.x += (tx - v.x) * (1 - Math.exp(-kh * dt)); v.z += (tz - v.z) * (1 - Math.exp(-kh * dt)); v.y += (ty - v.y) * (1 - Math.exp(-kv * dt));
      if (!has && !vIn) v.y += sin(this.t * 1.1) * 0.35 * dt;                         // neutral buoyancy: a slow drift
    }
    const sp3 = v.length(), cap = Math.max(R.fast, R.vertFast) * 1.2; if (sp3 > cap) v.multiplyScalar(cap / sp3);
    // integrate + collide the swim sphere (seabed, rocks, crates, walls, arena bounds)
    c.set(p.x, p.y + PIV, p.z); const n = Math.max(1, Math.min(8, Math.ceil(sp3 * dt / 0.3))), h = dt / n;
    for (let i = 0; i < n; i++) { c.addScaledVector(v, h); L.collideSphere(c, R.swimR, v); }
    // surface: a ceiling he can only leave by breaching (Space tap near the top, or fast upward momentum)
    const ceil = L.waterY + 0.10;
    if (c.y > ceil - 0.4 && ((input.jump && c.y > ceil - 0.4) || (v.y >= R.breachV && c.y >= ceil - 0.02))) { p.set(c.x, c.y - PIV, c.z); this.breach(input.jump); return; }
    if (c.y > ceil) { c.y = ceil; if (v.y > 0) v.y *= 0.2; }
    p.set(c.x, c.y - PIV, c.z);
    this.speed = Math.hypot(v.x, v.z); this.stats.swimTime += dt;
    // face the heading (or the camera when starting from rest)
    const hs = Math.hypot(v.x, v.z); let target = this.yaw, k = 6;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 16; } else if (hs > 0.9) target = Math.atan2(v.x, v.z); else if (has) { target = Math.atan2(want.x, want.z); k = 4; }
    const step = angleDelta(this.yaw, target) * (1 - Math.exp(-k * dt)); this.yaw += step; this.turnRate = damp(this.turnRate, step / Math.max(dt, 1e-4), 9, dt);
    // shallow enough to stand: back to land movement (gravity, walking, normal facing)
    const fl = L.inRect(c.x, c.z) ? L.floorAt(c.x, c.z) : 0, dW = L.waterY - fl;
    if (!L.inRect(c.x, c.z, 0.05) || (dW <= R.exitDepth && c.y - fl < 1.6 && !(a && a.moveVel3))) this.exitSwim();
  }
  breach(tap) {
    const v = this.vel, L = this.L, p = this.pos; this.mode = 'air'; this.grounded = false; this.crouchT = 0; this.stats.breaches++; this.breachT = 0;
    v.y = clamp(Math.max(v.y, 0) + (tap ? 7.6 : 2.4), 7.4, 10.8); const hs = Math.hypot(v.x, v.z); if (hs > 9) { v.x *= 9 / hs; v.z *= 9 / hs; }
    // ledge assist: a wall / shore edge just ahead that the leap would barely miss gets a little forward push
    if (hs > 0.8) { const dx = v.x / hs, dz = v.z / hs, top = L.groundFor(p.x + dx * 1.3, p.z + dz * 1.3, p.y + 1.9, 0, 0.35); if (top > p.y + 0.35 && top < p.y + 1.7 && hs < 4) { v.x = dx * 4; v.z = dz * 4; } }
    L.splash(p.x, p.z, clamp(0.55 + Math.abs(v.y) * 0.05 + hs * 0.03, 0.5, 1.5), v); this.g.camera.kick(0.02); this.anim.play('breach', 1.0); this.g.sfx.whoosh();
    this.postMove(0.016);
  }
  exitSwim() {
    const p = this.pos, v = this.vel; this.mode = 'ground'; this.grounded = true; v.y = 0; v.x *= 0.7; v.z *= 0.7; this.exitLift = 0.6; this.stats.exits++;
  }
  enterSwim(fromAir) {
    const v = this.vel, p = this.pos, L = this.L; const sp = Math.abs(v.y); this.mode = 'swim'; this.grounded = false; this.crouchT = 0; this.stats.entries++;
    if (fromAir) { v.y *= 0.5; v.x *= 0.78; v.z *= 0.78; }
    L.splash(p.x, p.z, clamp(0.35 + sp / 9, 0.35, 1.8), v); L.bubbleBurst(_a.set(p.x, L.waterY - 0.6, p.z), 14, 0.5, 1, 0.07);
    if (sp > 3) this.anim.play('entry', 0.9); this.g.camera.kick(0.015);
    if (this.act) this.cancelAct();
  }

  /** bounds, depenetration and the water bookkeeping (environment label, wading, transitions) */
  postMove(dt) {
    const p = this.pos, L = this.L, R = RCFG; if (this.g.world.island) this.g.world.clampXZ(p, 1); else { p.x = clamp(p.x, -A_IN, A_IN); p.z = clamp(p.z, -A_IN, A_IN); }
    { const T = this.g.world.island && this.g.world.terrain, fl = T ? T.height(p.x, p.z) : 0; if (p.y < (T ? fl - 2 : -9)) { p.y = T ? fl + 0.2 : 0; this.vel.set(0, 0, 0); this.mode = 'air'; } }   // never lost below the map                                                   // never lost below the map
    const inR = L.inRect(p.x, p.z), dep = inR ? L.depthAt(p.x, p.z) : 0, fd = inR ? L.waterY - p.y : 0;
    this.dW = dep;
    if (this.mode === 'ground' || this.mode === 'crouch') {
      this.wadeK = inR && fd > 0.05 ? smoothstep(0.05, 0.9, fd) : 0;
      if (this.mode === 'ground' && inR && fd >= R.deep && dep >= R.deep) this.enterSwim(false);
    } else if (this.mode === 'air') {
      this.wadeK = 0; const cy = p.y + PIV;
      if (inR && cy < L.waterY - 0.05 && dep >= R.airDeep) this.enterSwim(true);
      else if (inR && p.y < L.waterY && this.vel.y < -1 && !this.splashedAir) { this.splashedAir = true; L.splash(p.x, p.z, clamp(-this.vel.y / 12, 0.25, 1.0) * 0.8, this.vel); }
      if (p.y > L.waterY + 0.4) this.splashedAir = false;
    } else this.wadeK = 0;
    const m = this.mode, inWater = m === 'swim' || (inR && fd > 0.05);
    this.env = m === 'swim' ? 'UNDERWATER' : inWater ? 'SHALLOW WATER' : 'LAND';
    this.depth = m === 'swim' ? Math.max(0, L.waterY - (p.y + PIV)) : inWater ? Math.max(0, fd) : 0; this.stats.maxDepth = Math.max(this.stats.maxDepth, this.depth);
    if (inWater) this.wetT = 3; else this.wetT = Math.max(0, this.wetT - dt);
    if (this.wasWet && !inWater && (m === 'ground' || m === 'air') && this.wetT > 2.2) { this.dripBurst(); this.shakePending = true; }          // left the water: drip now, shake off as soon as he stands on land
    if (inWater) this.shakePending = false;
    else if (this.shakePending && m === 'ground' && this.grounded && !this.act) { this.shakePending = false; this.anim.play('exit', 0.8); }
    this.wasWet = inWater; this.splashedAir = this.splashedAir && !inWater;
    this.updateTilt(dt);
  }
  updateTilt(dt) {
    const v = this.vel, sw = this.mode === 'swim', a = this.act; let tgt = 0, k = 7;
    if (sw) {
      const sp3 = v.length(), hv = Math.hypot(v.x, v.z), elev = Math.atan2(v.y, Math.max(hv, 0.35)); k = 5;
      tgt = lerp(0.32, clamp(Math.PI / 2 - elev, 0.30, 2.75), smoothstep(0.6, 3.6, sp3));
      if (a && a.tiltTo !== undefined) { tgt = a.tiltTo; k = 14; }
    }
    this.tilt = damp(this.tilt, tgt, k, dt);
    const bt = sw ? clamp(-this.turnRate * 0.10, -0.55, 0.55) * smoothstep(1, 4, v.length()) : 0; this.bank = damp(this.bank, bt, 5, dt);
  }

  // ------------------------------------------------------------------------------------------------ FX
  jumpFX() {
    const g = this.g, p = this.pos; this.stats.jumps++; this.landV -= 2.2; g.sfx.thud(0.4); g.camera.kick(0.01);
    if (this.wadeK > 0.1) { this.L.splash(p.x, p.z, 0.25 + 0.3 * this.wadeK, null); return; }
    const c = _a.set(p.x, p.y + 0.08, p.z); g.fx.surface.ring(c.clone(), _b.set(0, 1, 0), 3.4, 0.35, 0xc9bfa5);
    for (let i = 0; i < 8; i++) g.fx.dust.emit({ pos: c.clone().add(_b.set(rand(-0.8, 0.8), 0, rand(-0.8, 0.8))), vel: _c.set(rand(-1, 1), rand(0.3, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 3.5)).clone(), size: rand(0.5, 0.9), grow: 1.5, life: rand(0.5, 0.9), drag: 2.2, color: [0.66, 0.63, 0.58], alpha: 0.4 });
  }
  landFX(v) {
    const g = this.g, p = this.pos, k = clamp((v - 4) / 16, 0, 1); this.stats.landings++; this.landV += 3 + 7 * k; g.camera.addTrauma(0.04 + 0.12 * k); g.sfx.thud(0.28 + 0.4 * k);
    if (this.L.inRect(p.x, p.z) && this.L.waterY - p.y > 0.05) { this.L.splash(p.x, p.z, 0.3 + 0.7 * k, this.vel); return; }
    const c = _a.set(p.x, p.y + 0.06, p.z).clone(); g.fx.surface.ring(c, _b.set(0, 1, 0), 3 + 4 * k, 0.4, 0xcfc6ad);
    for (let i = 0; i < 7 + 10 * k; i++) g.fx.dust.emit({ pos: c.clone().add(_b.set(rand(-1, 1), 0, rand(-1, 1))), vel: _c.set(rand(-1, 1), rand(0.2, 0.9), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5) * (0.6 + k)).clone(), size: rand(0.5, 1.1), grow: 1.7, life: rand(0.5, 0.9), drag: 2.4, color: [0.66, 0.63, 0.58], alpha: 0.45 });
    if (v > 7) { const f = 1 - 0.2 * k; this.vel.x *= f; this.vel.z *= f; }
  }
  dripBurst() { const g = this.g, p = this.pos; for (let i = 0; i < 12; i++) g.fx.dust.emit({ pos: _a.set(p.x + rand(-0.5, 0.5), p.y + rand(0.4, 2.0), p.z + rand(-0.5, 0.5)), vel: _b.set(rand(-1.5, 1.5), rand(0.2, 2), rand(-1.5, 1.5)), size: rand(0.06, 0.14), life: rand(0.5, 0.9), drag: 0.5, grav: 14, color: [0.85, 0.95, 1], alpha: 0.8 }); this.L.wade(p.x, p.z, p.y, 1.2); }
  mouthPos(out) { const m = this.rig.markers.mouth; return m.getWorldPosition(out); }
  /** continuous water effects: breath bubbles, stroke wake, silt over the seabed, fast-swim bubble trail, drips, footsteps and wading splashes */
  fxUpdate(dt) {
    const g = this.g, L = this.L, p = this.pos, F = this.fx, sw = this.mode === 'swim', v = this.vel, sp3 = v.length();
    if (sw) {
      const c = this.c.set(p.x, p.y + PIV, p.z), nearTop = Math.abs(c.y - L.waterY) < 0.6, fl = L.floorAt(c.x, c.z);
      F.bub -= dt * (0.7 + sp3 * 0.12); if (F.bub <= 0) { F.bub = rand(1.6, 3.2); this.mouthPos(_a); L.bubbleBurst(_a, 3 + (Math.random() * 3 | 0), 0.1, 0.5, 0.045); }
      if (sp3 > 8) { F.trail -= dt; if (F.trail <= 0) { F.trail = 0.045; _a.set(c.x - v.x * 0.12, c.y - v.y * 0.12, c.z - v.z * 0.12); L.bubble(_a.x + rand(-0.25, 0.25), _a.y + rand(-0.25, 0.25), _a.z + rand(-0.25, 0.25), -v.x * 0.04, 0.5, -v.z * 0.04, rand(0.035, 0.07), 2.4); } }
      if (c.y - fl < 1.1 && sp3 > 2.2) { F.silt -= dt; if (F.silt <= 0) { F.silt = 0.16; L.silt(_a.set(c.x, fl + 0.1, c.z), 1, 0.8); } }
      if (nearTop && sp3 > 1.0) { F.wake -= dt; if (F.wake <= 0) { F.wake = 0.16; L.ripple(c.x, c.z, 0.45 + 0.04 * sp3); if (sp3 > 3) for (let i = 0; i < 2; i++) g.fx.dust.emit({ pos: _a.set(c.x + rand(-0.4, 0.4), L.waterY + 0.04, c.z + rand(-0.4, 0.4)), vel: _b.set(-v.x * 0.15 + rand(-0.4, 0.4), rand(0.4, 1.2), -v.z * 0.15 + rand(-0.4, 0.4)), size: rand(0.1, 0.22), life: rand(0.4, 0.7), drag: 0.8, grav: 8, color: [0.9, 0.97, 1], alpha: 0.6 }); } }
      F.stroke -= dt; if (F.stroke <= 0 && sp3 > 2) { F.stroke = clamp(0.9 - sp3 * 0.05, 0.35, 0.9); g.sfx.swish(0.04 + 0.02 * smoothstep(3, 12, sp3)); }
    } else {
      const A = this.anim.s, idx = Math.floor(A.ph * 2);
      if (this.grounded && this.speed > 1.2 && idx !== this.stepIdx) {
        this.stepIdx = idx; const run = smoothstep(4, 6.6, this.speed), foot = _a.set(p.x, p.y, p.z);
        if (this.wadeK > 0.05) L.wade(foot.x, foot.z, foot.y, 0.5 + this.wadeK);
        else { g.sfx.thud(0.04 + 0.1 * run); g.camera.addTrauma(0.004 + 0.012 * run); if (run > 0.3) for (let i = 0; i < 2; i++) g.fx.dust.emit({ pos: _b.set(foot.x + rand(-0.3, 0.3), foot.y + 0.06, foot.z + rand(-0.3, 0.3)).clone(), vel: _c.set(rand(-1, 1) - v.x * 0.05, rand(0.2, 0.7), rand(-1, 1) - v.z * 0.05).clone(), size: rand(0.3, 0.6), grow: 1.3, life: rand(0.35, 0.6), drag: 2.6, color: [0.66, 0.63, 0.58], alpha: 0.3 }); }
      }
      if (this.wetT > 0.2 && this.wadeK < 0.05 && this.mode !== 'swim') { F.drip -= dt; if (F.drip <= 0) { F.drip = rand(0.12, 0.3) / clamp(this.wetT / 3, 0.25, 1); g.fx.dust.emit({ pos: _a.set(p.x + rand(-0.35, 0.35), p.y + rand(0.3, 1.8), p.z + rand(-0.35, 0.35)), vel: _b.set(rand(-0.2, 0.2), rand(-0.2, 0.4), rand(-0.2, 0.2)), size: rand(0.04, 0.09), life: rand(0.5, 0.8), drag: 0.3, grav: 16, color: [0.82, 0.93, 1], alpha: 0.75 }); } }
    }
  }

  // ------------------------------------------------------------------------------------------------ animation
  animState() {
    const v = this.vel, sw = this.mode === 'swim', hs = Math.hypot(v.x, v.z), sy = sin(this.yaw), cy = cos(this.yaw), sp3 = v.length();
    const depthC = this.L.waterY - (this.pos.y + PIV);
    return { speed: hs, speed3: sp3, vf: v.x * sy + v.z * cy, vl: v.x * cy - v.z * sy, vy: v.y, grounded: sw ? false : (this.grounded || this.mode === 'crouch'), crouch: this.mode === 'crouch' ? clamp(this.crouchT / Math.max(0.05, this.crouchDur), 0, 1) : 0,
      land: clamp(this.landK, 0, 1), swim: sw ? 1 : 0, tilt: this.tilt, diving: sw && v.y < -2.2, surf: sw && depthC < 0.8 && sp3 < 2.6 ? 1 : 0, turn: this.turnRate };
  }
  finalize() {
    this.root.rotation.y = this.yaw; this.tiltG.rotation.set(this.tilt, this.bank * sin(clamp(this.tilt, 0, Math.PI)), 0, 'XYZ'); this.root.updateMatrixWorld(true);
  }
  updateAnim(dt) {
    if (!this.root.visible) { this.updateState(); return; }
    this.finalize(); const c = this.animState(), P = this.anim.pose(dt, c), a = this.act;
    this.anim.biteApply(P, a && a.kind === 'bite' ? a : null, c, dt); this.anim.clawApply(P, a && a.kind === 'claw' ? a : null, c, dt);
    this.poser.apply(P); this.root.updateMatrixWorld(true); this.updateState(); this.fxUpdate(dt);
  }
  updateState() {
    const a = this.act, A = this.anim.s, m = this.mode, v = this.vel, sp3 = v.length();
    if (a) { this.state = a.kind.toUpperCase() + (m === 'swim' ? '(WATER)' : '') + ':' + a.stage.toUpperCase(); return; }
    if (m === 'swim') this.state = this.anim.gest && this.anim.gest.kind === 'entry' ? 'WATER-ENTRY' : v.y < -2.2 ? 'DIVE' : v.y > 2.2 ? 'ASCEND' : A.fast > 0.5 ? 'FAST-SWIM' : sp3 > 1.5 ? 'SWIM' : (this.L.waterY - this.pos.y - PIV) < 0.8 ? 'SURFACE' : 'SWIM-IDLE';
    else if (this.anim.gest && this.anim.gest.kind === 'breach') this.state = 'BREACH';
    else if (this.anim.gest && this.anim.gest.kind === 'exit') this.state = 'WATER-EXIT';
    else if (m === 'crouch') this.state = 'JUMP-CROUCH'; else if (m === 'air') this.state = v.y > 0 ? 'JUMP-RISE' : 'FALL';
    else if (this.landK > 0.25) this.state = 'LAND'; else if (this.wadeK > 0.3 && this.speed > 0.5) this.state = 'WADE'; else this.state = A.run > 0.55 ? 'RUN' : A.mv > 1.2 ? 'WALK' : 'IDLE';
  }
  /** compile the skinned shader and the swim effects once so the first dive never stalls a frame */
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 6); this.root.updateMatrixWorld(true); renderer.render(scene, camera);
    this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
  /** per-frame HUD: environment indicator (LAND / SHALLOW WATER / UNDERWATER + depth), health, ability highlights */
  hudUpdate() {
    const a = this.act ? this.act.kind : '', I = this.input || {}, set = (k, on, cd = 0, mx = 1) => { const e = $('rjslot-' + k); if (e) e.classList.toggle('active', !!on); const c = $('rjcd-' + k); if (c) c.style.width = (cd > 0 ? cd / mx * 100 : 0) + '%'; };
    set('lmb', a === 'bite', this.cd.lmb, this.cdMax.lmb); set('e', a === 'claw', this.cd.e, 0.3); set('sh', I.run && this.mode === 'swim', 0, 1); set('sp', I.jumpHeld, 0, 1); set('ct', I.down && this.mode === 'swim', 0, 1);
    const hp = $('rj-hp'); if (hp) hp.style.width = (this.hp / RCFG.hp * 100) + '%';
    const env = $('rj-env'); if (env) { const t = this.env + (this.env === 'LAND' ? '' : '  ·  ' + this.depth.toFixed(1) + ' m'); if (env.textContent !== t) env.textContent = t; env.dataset.env = this.env === 'LAND' ? 'land' : this.env === 'SHALLOW WATER' ? 'shallow' : 'under'; }
  }
}
Object.assign(RjPlayer.prototype, rjPowers);
