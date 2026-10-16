// Way Big controller - an 80 m tall giant (the supplied GLB, ONE uniform scale 80 m / 54.6 file units = 1.464) in a world where 1 unit = 1 m.
// NOTHING is faked with the camera: his collision cylinder (r 7.5 m, 80 m tall), step height (10 m), jump (27 m/s up, 30 m/s^2 gravity), reach (arms ~38 m), foot contact areas (7 x 11.5 m), speed, camera distance / near / far,
// fog, shadow range and interaction ranges are all in his own scale. Procedural animation drives the GLB's own 84-bone skeleton (animations/waybigrig.js + the same FK / IK pose driver as Cannonbolt / Grey Matter):
// idle (breathing, weight shift, look), walk, run, turn (lean + stepped re-plant), jump prepare / jump / fall / heavy landing, punch, heavy punch, chest charge + fire, grab, lift, carry, throw, stomp, defensive stance,
// hit reaction. Feet are planted in the world while he walks (no sliding): a stance foot moves back at exactly the body speed, a swing foot lifts and steps, and a foot that is too far from its slot re-steps.
// Combat / grab / stomp / footstep logic lives in wb_powers.js (installed onto this class), the district in wb_world.js.
import * as THREE from 'three';
import { WbPoser, SIDES } from '../animations/waybigrig.js';
import { V, D, mkPose } from '../animations/stinkflyrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { installWbPowers } from './wb_powers.js';

export const WBCFG = { rad: 7.5, h: 80, step: 10, walk: 11, run: 25, accelG: 13, accelRun: 8, brake: 24, accelA: 3.5, grav: 30, jump: 27, hp: 3000, mass: 2.5e6, prepT: 0.38, limit: 288, footHW: 3.5, footHL: 5.8, reach: 37, footR: 8.5 };
const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
const sin = Math.sin, cos = Math.cos, ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const $ = id => document.getElementById(id);
const GOFF = { L: 0, R: 0.5 };

export class WbPlayer {
  constructor(game, rig, district, fx) {
    this.g = game; this.rig = rig; this.D = district; this.fx = fx; this.kind = 'waybig'; this.cfg = WBCFG; this.rad = WBCFG.rad; this.colH = WBCFG.h; this.S = rig.scale; const S = this.S;
    this.PIV = rig.info.get(rig.bones.hips).restModelP.y * S;
    this.root = new THREE.Group(); this.root.name = 'WayBig';
    this.yawG = new THREE.Group(); this.root.add(this.yawG);
    this.tiltG = new THREE.Group(); this.tiltG.position.set(0, this.PIV, 0); this.yawG.add(this.tiltG);
    rig.modelGroup.scale.setScalar(S); rig.modelGroup.position.set(0, -this.PIV, 0); this.tiltG.add(rig.modelGroup); game.scene.add(this.root);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2; this.blob.scale.setScalar(22); this.root.add(this.blob);
    this.poser = new WbPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground'; this.speed = 0; this.camYaw = 0; this.state = 'IDLE';
    this.U = 1; this.Vf = 1; this.pwr = 1; this.maxHp = WBCFG.hp; this.massW = 2.5e6;
    this.hp = WBCFG.hp; this.hpT = 0; this.hitSphere = { y: 52, r: 17 }; this.input = null; this.stealthSize = 4; this.sightY = 52; this.batonReach = 3; this.alive = true; this.footRadius = WBCFG.footR;
    this.fxScale = 14; this.prepT = 0; this.landT = 0; this.flinchT = 0; this.noCrush = 0; this.lastHit = 0; this.guard = false;
    this.stats = { steps: 0, jumps: 0, landings: 0, punches: 0, heavies: 0, blasts: 0, grabs: 0, throws: 0, stomps: 0, hits: 0, hitsTaken: 0, flinches: 0, crushed: 0, kills: 0, footfalls: 0, cells: 0 };
    this.an = { t: 0, mv: 0, rn: 0, air: 0, crouch: 0, land: 0, landV: 0, lean: 0, roll: 0, turn: 0, gp: 0, flinch: 0, flinchDir: new THREE.Vector3(), look: 0, dropX: 0, gd: 0, rc: 0, prevPh: { L: 0, R: 0.5 }, bob: 0, tw: 0, prevSpeed: 0 };
    this.shW = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.lastFist = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.armBase = { L: V(0, 0, 0), R: V(0, 0, 0) };
    // ---- bind-pose calibration (root at origin, yaw 0): where the feet / hips rest
    this.yawG.rotation.y = 0; this.root.updateMatrixWorld(true); this.poser.apply(mkPose());
    this.footRest = {}; this.plant = {}; this.footNow = {}; this.hipRest = {}; this.kneeRest = {};
    for (const k of SIDES) { this.footRest[k] = this.poser.ankleW[k].clone(); this.plant[k] = new THREE.Vector3(); this.footNow[k] = new THREE.Vector3(); this.hipRest[k] = rig.legs[k].hip.getWorldPosition(new THREE.Vector3()); }
    this.restY = (this.footRest.L.y + this.footRest.R.y) / 2; this.legLen = this.hipRest.L.distanceTo(this.kneeRestOf('L')) + this.poser.kneeW.L.distanceTo(this.footRest.L); this.step = null;
    this.armRest = {}; for (const k of SIDES) this.armRest[k] = rig.arms[k].a.getWorldPosition(new THREE.Vector3());
    this.initPowers();
    this.yawG.rotation.y = this.yaw; this.root.visible = false; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016));
  }
  kneeRestOf(k) { return this.poser.kneeW[k]; }
  get flying() { return false; }
  get busy() { return !!this.act || this.flinchT > 0; }
  aimYaw() { const y = this.camYaw ?? 0; return Math.atan2(-sin(y), -cos(y)); }

  // ------------------------------------------------------------------------------------------------ switching
  /** V33: ULTIMATE scale. U = size factor (1 = Way Big), Vf = speed factor, pwr = damage / strength factor. Everything geometric above is expressed through U; U = 1 is exactly the old Way Big. */
  setU(U, Vf = 1, pwr = 1) {
    this.U = U; this.Vf = Vf; this.pwr = pwr; this.yawG.scale.setScalar(U); this.rad = WBCFG.rad * U; this.colH = WBCFG.h * U; this.hitSphere.y = 52 * U; this.hitSphere.r = 17 * U; this.stealthSize = 4 * U; this.sightY = 52 * U; this.batonReach = 3 * U; this.fxScale = 14 * U; this.footRadius = WBCFG.footR * U;
    const r = this.hp / this.maxHp; this.maxHp = WBCFG.hp * pwr; this.hp = this.maxHp * r; this.massW = 2.5e6 * U * U * U; if (this.envOn) this.setEnv(true);
  }
  setEnv(on) {
    const g = this.g, w = g.world, f = w.scene.fog; if (!f) return;
    const isl = w.island; if (on) { const U = this.U; f.near = (isl ? 700 : 420) * U; f.far = (isl ? 2800 : 1700) * U; w.setShadow(175 * U, 380 * U, 900 * U); } else { f.near = isl ? 260 : 70; f.far = isl ? 1500 : 230; w.setShadow(isl ? 40 : 26, isl ? 90 : 70, isl ? 220 : 140); }
    const lg = g.lagoon; if (lg && lg.fog0) { lg.fog0.near = f.near; lg.fog0.far = f.far; }       // the lagoon's underwater grade restores the fog every frame from these values
    this.D.setActive(on); this.envOn = on;
  }
  activate(from) {
    this.cancelAll(); this.setEnv(true); const L = WBCFG.limit, W = this.g.world;
    if (W.island) { this.pos.set(from.pos.x, 0, from.pos.z); W.clampXZ(this.pos, 20); this.pos.y = this.groundY(); } else
    this.pos.set(clamp(from.pos.x, -L, L), 0, clamp(from.pos.z, -L, L)); this.yaw = from.yaw; this.vel.set(from.vel.x * 0.15, 0, from.vel.z * 0.15); this.grounded = true; this.mode = 'ground'; this.guard = false; this.alive = true;
    this.D.collideCircle(this.pos, this.rad, this.pos.y + WBCFG.step, this.pos.y + this.colH);        // never spawns inside a building: pushed out through the nearest face
    const A = this.an; A.land = A.landV = 0; A.crouch = A.flinch = A.gd = A.rc = 0; A.air = 0; this.speed = 0; this.noCrush = 1.4; this.flinchT = 0;
    this.yawG.rotation.y = this.yaw; this.root.visible = true; this.snapFeet(); this.finalize(); this.poser.apply(this.locoPose(0.016)); this.root.updateMatrixWorld(true); this.hint('');
  }
  /** C pressed: drop anything held, end every action, hide the district and put him on a legal arena spot for the next (human-sized) alien. */
  leave() {
    this.cancelAll(); this.input = null; this.hint(''); this.fx.hideBeam(); this.setEnv(false); this.D.parkStrays();
    const best = this.safeSpot(); if (best) { this.pos.set(best.x, best.y, best.z); this.vel.set(0, 0, 0); this.grounded = true; this.mode = 'ground'; }
    this.guard = false; this.act = null;
  }
  deactivate() { this.root.visible = false; }
  hint(txt) { const e = $('wbhint'); if (!e) return; if (!this.envOn) txt = '';      // after C no stray update of his may re-show a hint over the next alien's HUD
    if (e._t !== txt) { e._t = txt; e.innerHTML = txt; } e.hidden = !txt; }
  /** nearest spot to where he stands (clamped into the arena) where a standard-size alien (radius 0.55, height 2.3) fits */
  safeSpot() {
    const w = this.g.world, isl = w.island, p0 = isl ? w.clampXZ(_a.set(this.pos.x, 0, this.pos.z), 3) : _a.set(clamp(this.pos.x, -30, 30), 0, clamp(this.pos.z, -30, 30)), rad = 0.55, H = 2.3, tmp = new THREE.Vector3(), x0 = p0.x, z0 = p0.z;
    const ok = (x, z) => {
      if (isl ? (w.lagoon && w.lagoon.depthAt(x, z) > 0.9) : (Math.abs(x) > 33 || Math.abs(z) > 33)) return null; const gy = w.groundAt(x, z, (isl ? w.terrain.height(x, z) : 0) + 0.5, 0.5, 0.2); tmp.set(x, gy, z); w.resolveXZ(tmp, rad, gy, H, 0.4); if (Math.hypot(tmp.x - x, tmp.z - z) > 0.02) return null;
      for (const b of w.boxes) if (b.max.y > gy + 0.4 && b.min.y < gy + H && x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad) return null;
      if (w.lagoon && w.lagoon.inRect(x, z, rad) && w.lagoon.blockOn) return null;
      for (const [ox, oz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) { const ng = w.groundAt(x + ox, z + oz, gy + 0.4, 0.4, 0.1); if (gy - ng > (isl ? 0.3 : 0.06) || ng - gy > 0.3) return null; }
      return { x, y: gy, z };
    };
    const first = ok(x0, z0); if (first) return first;
    for (let d = 0.8; d <= 40; d += 0.8) for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, r = ok(x0 + cos(a) * d, z0 + sin(a) * d); if (r) return r; }
    if (isl) { const q = _a.set(this.pos.x, 0, this.pos.z); let k = 0; while (w.lagoon.depthAt(q.x, q.z) > 0.9 && k++ < 400) w.lagoon.pushShore(q, 0.9); return { x: q.x, y: w.groundAt(q.x, q.z, w.terrain.height(q.x, q.z) + 0.5, 0.5, 0.2), z: q.z }; }
    return { x: 0, y: 0, z: 14 };
  }

  // ------------------------------------------------------------------------------------------------ physics (giant scale)
  updatePhysics(dt, input, camYaw) {
    this.camYaw = camYaw; const G = WBCFG, wasGuard = this.guard;
    const locked = !!this.frozen; const inp = locked ? { moveX: 0, moveY: 0, run: false, jump: false, jumpHeld: false, down: false } : input; this.input = inp; this.landImpact = 0;
    if (this.hp < this.maxHp && this.alive) { this.hpT = Math.max(0, this.hpT - dt); if (this.hpT <= 0) this.hp = Math.min(this.maxHp, this.hp + dt * 14 * this.pwr); }
    this.noCrush = Math.max(0, this.noCrush - dt); this.flinchT = Math.max(0, this.flinchT - dt); this.cd.lmb = Math.max(0, this.cd.lmb - dt); this.cd.e = Math.max(0, this.cd.e - dt); this.cd.r = Math.max(0, this.cd.r - dt); this.cd.q = Math.max(0, this.cd.q - dt);
    // defensive stance (Ctrl): only on the ground and when no other action is running
    this.guard = !!inp.down && this.mode === 'ground' && !this.act && this.flinchT <= 0 && !this.hold; if (this.guard && !wasGuard) this.g.sfx.servo && this.g.sfx.servo(0.12);
    const fwd = _a.set(-sin(camYaw), 0, -cos(camYaw)), right = _b.set(cos(camYaw), 0, -sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir = this.wantDir || new THREE.Vector3(); this.wantDir.copy(want);
    const actLock = this.act && this.act.lockMove, slowMul = this.act ? (this.act.moveMul ?? 1) : 1;
    if (inp.jump && this.mode === 'ground' && this.grounded && !this.act && !this.guard && this.flinchT <= 0) { this.mode = 'prep'; this.prepT = 0; }
    if (this.mode === 'prep') {
      this.prepT += dt; this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt); this.integrate(dt); this.faceUpdate(dt, want, hasInput);
      if (this.prepT >= G.prepT) { this.mode = 'air'; this.grounded = false; this.vel.y = G.jump * this.Vf; this.stats.jumps++; this.g.sfx.thud(0.5); this.footBoth(0.7, true); this.g.camera.addTrauma(0.08); }
      return;
    }
    const carry = this.hold ? this.hold.speedMul : 1;
    const Vf = this.Vf; let top = (this.guard ? G.walk * 0.4 : inp.run ? G.run : G.walk) * Vf * carry * slowMul; if (actLock) top = 0; if (!this.grounded) top = Math.max(top, G.run * Vf * 0.55 * carry);
    if (this.flinchT > 0.2 && this.mode === 'ground') top = 0;
    const tx = hasInput ? want.x * top : 0, tz = hasInput ? want.z * top : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
    const rate = (this.grounded ? (hasInput && top > 0 ? (inp.run && !this.guard ? G.accelRun : G.accelG) : G.brake) : G.accelA) * Vf * dt * (this.hold ? 0.8 : 1), m = Math.min(dl, rate); if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    if (!this.grounded) this.vel.y = Math.max(-70 * this.Vf, this.vel.y - G.grav * dt);
    this.integrate(dt);
    if (this.mode === 'landing') { this.landT += dt; if (this.landT >= 0.42) this.mode = 'ground'; }
    this.faceUpdate(dt, want, hasInput);
  }
  /** ground under his feet: the island terrain (highest point of a few samples across the footprint); 0 on the old flat map */
  groundY() { const T = this.g.world.terrain; if (!T) return 0; const p = this.pos, r = this.rad * 0.6; return Math.max(T.height(p.x, p.z), T.height(p.x + r, p.z), T.height(p.x - r, p.z), T.height(p.x, p.z + r), T.height(p.x, p.z - r)); }
  /** island buildings taller than his knees push him out (he steps over anything lower) */
  islandCollide() {
    const p = this.pos, r = this.rad; for (const b of this.g.world.boxes) { const kn = this.U > 1.5 ? 160 : 14; if (!b.isl || b.max.y - b.min.y < kn || b.max.y < p.y + kn) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz; if (d2 >= r * r) continue;
      if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; const nx = dx / d, nz = dz / d, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
      else { const ox = Math.min(p.x - b.min.x, b.max.x - p.x), oz = Math.min(p.z - b.min.z, b.max.z - p.z); if (ox < oz) p.x += (p.x - b.min.x < b.max.x - p.x ? -1 : 1) * (ox + r); else p.z += (p.z - b.min.z < b.max.z - p.z ? -1 : 1) * (oz + r); } }
  }
  integrate(dt) {
    const G = WBCFG, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(8, Math.ceil(hsp / (3 * this.U)))), h = dt / n, D = this.D;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      D.collideCircle(this.pos, this.rad, this.pos.y + G.step * this.U, this.pos.y + this.colH);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-6) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; this.bumpT = (this.bumpT || 0) + h; } }
    }
    if (this.g.world.island) { this.islandCollide(); this.g.world.clampXZ(this.pos, 20); }
    const L = G.limit; if (!this.g.world.island && (Math.abs(this.pos.x) > L || Math.abs(this.pos.z) > L)) { this.pos.x = clamp(this.pos.x, -L, L); this.pos.z = clamp(this.pos.z, -L, L); if (!this.limitT || this.limitT < this.an.t - 4) { this.limitT = this.an.t; this.g.hud.toast('CITY LIMIT'); } }
    this.pos.y += this.vel.y * dt;
    const gy = this.groundY();
    if (this.pos.y <= gy && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -6 * this.Vf) { this.landImpact = -this.vel.y / this.Vf; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
      if (this.mode === 'air') { this.mode = this.landImpact > 12 ? 'landing' : 'ground'; this.landT = 0; this.stats.landings++; }
    } else if (this.grounded && this.pos.y > gy + 0.01) { if (this.pos.y - gy < 3.5 * this.U && this.vel.y <= 0) this.pos.y = gy; else { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; } }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  faceUpdate(dt, want, hasInput) {
    let target = this.yaw, k = 3.2; const a = this.act;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 7; } else if (this.speed > 1.5 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? 3.6 : 1.5; } else if (hasInput) { target = Math.atan2(want.x, want.z); k = 2.8; }
    if (this.hold && this.hold.stage !== 'throw' && !a) { /* carrying: faces where he walks */ }
    const dy = angleDelta(this.yaw, target), st = dy * (1 - Math.exp(-k * dt)); this.yaw += st; this.an.turn = damp(this.an.turn, st / Math.max(dt, 1e-4), 6, dt); this.yawG.rotation.y = this.yaw;
  }
  landFX(v) {
    const A = this.an, k = clamp(v / 30, 0.2, 1.5); A.landV += 2 + 3 * k; this.footBoth(clamp(k, 0.5, 1.5), true); this.g.camera.addTrauma(0.1 + 0.2 * k); this.g.sfx.crash(Math.min(0.9, 0.3 + 0.4 * k));
    if (v > 16) { this.stompImpact(this.pos.x, this.pos.z, { r: 70 * k * this.U, dmg: 260 * k * this.pwr, tremor: 0.4 * k, both: true }); this.stats.stomps += 0; }
  }

  // ------------------------------------------------------------------------------------------------ animation
  snapFeet() {
    const c = cos(this.yaw), s = sin(this.yaw);
    const U = this.U; for (const k of SIDES) { const r = this.footRest[k], rx = r.x * U, rz = r.z * U; this.plant[k].set(this.pos.x + rx * c + rz * s, 0, this.pos.z - rx * s + rz * c); this.footNow[k].copy(this.plant[k]); }
    this.step = null; this.an.prevPh.L = 0; this.an.prevPh.R = 0.5;
  }
  /** feet are planted in the world while he walks (the stance foot moves back at exactly the body speed); a foot too far from its slot re-steps; contact events fire when a foot lands */
  footTargets(dt) {
    const A = this.an, c = cos(this.yaw), s = sin(this.yaw), grounded = this.grounded, U = this.U;
    const vf = this.vel.x * s + this.vel.z * c, vl = this.vel.x * c - this.vel.z * s, sp = Math.hypot(vf, vl), mv = A.mv, rn = A.rn;
    const dx = sp > 0.5 * this.Vf ? vl / sp : 0, dz = sp > 0.5 * this.Vf ? vf / sp : 1, amp = lerp(8.5, 14.5, rn) * lerp(1, 0.6, A.gd) * U, beta = lerp(0.66, 0.5, rn);
    if (grounded) A.gp = (A.gp + dt * sp * beta / (2 * amp)) % 1;
    const lift = lerp(3.6, 8.5, rn) * U;
    if (mv > 0.12) this.step = null; else if (!this.step && grounded && !this.stompFoot) {
      let worst = null, wd = 5.2 * U;
      for (const k of SIDES) { const r = this.footRest[k], rx = r.x * U, rz = r.z * U, wx = this.pos.x + rx * c + rz * s, wz = this.pos.z - rx * s + rz * c, d = Math.hypot(this.plant[k].x - wx, this.plant[k].z - wz); if (d > wd) { wd = d; worst = k; } }
      if (worst) { this.step = { k: worst, t: 0, from: this.plant[worst].clone() }; this.stats.steps++; }
    }
    if (this.step) {
      const St = this.step; St.t += dt / 0.62; const u = ease(St.t), r = this.footRest[St.k], rx = r.x * U, rz = r.z * U, tx = this.pos.x + rx * c + rz * s, tz = this.pos.z - rx * s + rz * c;
      this.footNow[St.k].set(lerp(St.from.x, tx, u), 0, lerp(St.from.z, tz, u)); St._lift = sin(Math.PI * clamp(St.t, 0, 1)); if (St.t >= 1) { this.plant[St.k].set(tx, 0, tz); this.footfall(St.k, 0.45); this.step = null; }
    }
    const out = {};
    for (const k of SIDES) {
      const r = this.footRest[k], rxU = r.x * U, rzU = r.z * U, ph = (A.gp + GOFF[k]) % 1; let z, ly = 0;
      if (ph < beta) z = amp - 2 * amp * (ph / beta); else { const u = (ph - beta) / (1 - beta), e = ease(u); z = -amp + 2 * amp * e; ly = lift * sin(Math.PI * u); }
      // contact event: the swing foot just came down (phase wrapped through 0)
      const pp = A.prevPh[k]; if (grounded && mv > 0.3 && pp > 0.85 && ph < 0.15 && Math.abs(pp - ph) > 0.5) this.footfall(k, clamp(0.35 + 0.6 * rn + 0.3 * mv, 0.4, 1.2)); A.prevPh[k] = ph;
      const lx = rxU + dx * z, lz = rzU + dz * z, gx = this.pos.x + lx * c + lz * s, gz = this.pos.z - lx * s + lz * c;
      let tx, tz, tl = 0; const stepping = this.step && this.step.k === k;
      if (stepping) { tx = this.footNow[k].x; tz = this.footNow[k].z; tl = 4.2 * U * this.step._lift; } else { tx = this.plant[k].x; tz = this.plant[k].z; }
      if (mv > 0.12) this.plant[k].set(gx, 0, gz);
      let X = lerp(tx, gx, mv), Z = lerp(tz, gz, mv); const Y = ly * mv + tl * (1 - mv);
      _a.set(X, 0, Z); if (this.D.collideCircle(_a, 3.4 * U, Y + 0.1 + WBCFG.step * 0, 6 * U)) { X = _a.x; Z = _a.z; }        // a foot is never planted inside a (tall) building
      this.footNow[k].set(X, 0, Z); out[k] = V(X, this.restY * U + Y, Z);
    }
    return out;
  }
  W(x, y, z) { const U = this.U; x *= U; y *= U; z *= U; const c = cos(this.yaw), s = sin(this.yaw); return V(this.pos.x + (x * c + z * s), this.pos.y + y, this.pos.z + (-x * s + z * c)); }
  /** direction of the body frame axes in world space */
  fwdV(out = _a) { return out.set(sin(this.yaw), 0, cos(this.yaw)); }
  locoPose(dt) {
    const A = this.an, sp = this.speed, P = mkPose(); A.t += dt; const t = A.t, G = WBCFG;
    const grd = this.grounded && (this.mode === 'ground' || this.mode === 'landing');
    const spn = sp / this.Vf; A.mv = damp(A.mv, grd ? smoothstep(0.8, 5, spn) : 0, 8, dt); A.rn = damp(A.rn, grd ? smoothstep(14, 21, spn) : 0, 5, dt);
    A.air = damp(A.air, this.mode === 'air' ? 1 : 0, 9, dt);
    A.crouch = damp(A.crouch, this.mode === 'prep' ? 0.9 * clamp(this.prepT / G.prepT, 0, 1) : this.mode === 'landing' ? 0.55 * (1 - clamp(this.landT / 0.42, 0, 1)) + 0.15 : 0, 11, dt);
    A.gd = damp(A.gd, this.guard ? 1 : 0, 8, dt);
    if (dt > 0) { A.landV += (-90 * A.land - 11 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.3, 1.1); }
    A.flinch = Math.max(0, A.flinch - dt * 1.7);
    const mv = A.mv, rn = A.rn, cr = A.crouch, air = A.air, gd = A.gd, land = clamp(A.land, 0, 1.1);
    const idle = (1 - mv) * (1 - gd) * (1 - 0.7 * cr), b = sin(t * 1.35), gpA = A.gp * TAU, rock = sin(gpA);
    const lean = 0.03 + 0.1 * rn + 0.1 * mv + 0.4 * cr + 0.3 * gd + 0.15 * land - 0.04 * air; A.lean = damp(A.lean, lean, 6, dt);
    const aimLook = clamp(angleDelta(this.yaw, this.aimYaw()), -0.9, 0.9) * idle * 0.6; A.look = damp(A.look, aimLook + 0.15 * sin(t * 0.35) * idle, 4, dt);
    A.roll = damp(A.roll, clamp(-A.turn * 0.02, -0.08, 0.08) * mv, 4, dt);
    const L = A.lean + A.rc * 0.0;
    P.d.hips = D(L * 0.35 + 0.012 * b * idle + 0.04 * sin(gpA * 2) * mv, 0.12 * rock * mv, -0.05 * rock * mv + 0.03 * sin(t * 0.5) * idle + 0.04 * A.turn * 0.02);
    P.d.spine = D(L * 0.35 + 0.01 * b, -0.12 * rock * mv * (1 + rn) - 0.25 * A.look, 0.04 * rock * mv - 0.02 * sin(t * 0.5) * idle);
    P.d.chest = D(L * 0.3 + 0.025 * b * idle, 0.1 * rock * mv + 0.35 * A.look, 0.02 * sin(t * 0.6 + 0.6) * idle);
    P.d.neck = D(-L * 0.3 + 0.015 * sin(t * 0.7) * idle, 0.25 * A.look, 0.03 * sin(t * 0.6) * idle);
    P.d.head = D(-L * 0.35 + 0.03 * sin(t * 0.5 + 2) * idle, 0.35 * A.look, 0.04 * sin(t * 0.6) * idle);
    // flinch: hips driven back, chest folds, head snaps
    if (A.flinch > 0.01) { const fl = A.flinch, hf = A.flinchDir.x * sin(this.yaw) + A.flinchDir.z * cos(this.yaw); P.d.hips[0] += 0.22 * fl * hf; P.d.spine[0] += 0.25 * fl * hf; P.d.chest[0] += 0.35 * fl * hf; P.d.head[0] += 0.3 * fl * hf; P.d.spine[2] += 0.12 * fl; P.d.head[2] += 0.18 * fl; }
    // ---- legs: IK to planted / stepping feet
    const T = this.footTargets(dt), c = cos(this.yaw), sn = sin(this.yaw);
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1, tp = T[k].clone(); const rise = air * (this.vel.y > 2 ? 7.5 : 3.5) * (k === 'L' ? 1 : 0.8) * this.U; tp.y += rise; tp.z += 0; tp.x += 0;
      if (air > 0.05) { tp.x += (-s * 0.5) * 0; }
      P.legs[k] = { p: tp, pole: V(s * 0.25 * c + sn, 0.5, -s * 0.25 * sn + c), w: 1, poleW: 1 };
    }
    P.foot = { q: _q.setFromAxisAngle(UP, this.yaw).clone(), w: 1 };
    // ---- arms: offsets from the shoulder (metres) in the body frame
    for (const k of SIDES) {
      const s = k === 'L' ? 1 : -1, ph2 = k === 'L' ? 0 : Math.PI, bp = sin(t * 1.35 + (k === 'L' ? 0 : 1.2)), o = this.armBase[k];
      o.set(s * (5.2 + 0.6 * bp), -29.5 + 0.35 * bp, 2.4 + 0.7 * sin(t * 0.7 + (k === 'L' ? 0 : 2)));
      const swing = sin(gpA + ph2 + Math.PI), sw = (6 + 9 * rn) * mv; o.z += swing * sw; o.y += 3.4 * Math.max(0, swing) * mv + 4.5 * rn * mv; o.x += s * 1.6 * mv;
      o.z += 7 * rn; o.y += 5 * rn; o.x += s * -2.4 * rn;
      o.lerp(V(s * 19, -12, 7), air * 0.8); o.lerp(V(s * 6, -29, -2.5), clamp(land, 0, 1) * 0.5); o.lerp(V(s * 8, -25, 9), cr * 0.5);
      o.x += s * 2.2 * A.flinch; o.y += 3 * A.flinch; o.multiplyScalar(this.U);
      P.curl[k] = 0.32 + 0.25 * rn + 0.1 * sin(t * 0.8 + s) * idle;
    }
    return P;
  }
  finalize() {
    const A = this.an; this.yawG.rotation.y = this.yaw; const land = clamp(A.land, 0, 1.1);
    // the figure is lowered by moving the wrapper (the legs follow with IK); dropX (IK-error feedback) sinks it further whenever a planted foot is out of the leg's reach
    const drop = -(2.4 + 2.6 * A.mv + 4.5 * A.rn + 20 * A.crouch + 8 * land + 9 * A.gd + (this.extraDrop || 0)) - A.dropX + 2.5 * A.air;
    this.tiltG.position.y = this.PIV + drop; this.tiltG.rotation.set(0, 0, A.roll, 'XYZ'); this.root.updateMatrixWorld(true);
  }
  updateAnim(dt) {
    if (!this.root.visible) return;
    this.finalize();
    for (const k of SIDES) this.rig.arms[k].a.getWorldPosition(this.shW[k]);
    const P = this.locoPose(dt); this.layerAct(P, dt);
    this.finalize(); P.frameQ = this.tiltG.getWorldQuaternion(_q2).clone();
    for (const k of SIDES) { const t = P.armT && P.armT[k]; if (t) P.arms[k] = t; else { const off = this.armBase[k].clone(); P.arms[k] = { off, pole: V(k === 'L' ? 0.8 : -0.8, -0.1, -0.7), w: 1, poleW: 1 }; } }
    this.poser.apply(P); this.root.updateMatrixWorld(true);
    let err = 0; for (const k of SIDES) { const t = P.legs[k]; if (t && t.w > 0.5) err = Math.max(err, this.poser.ankleW[k].distanceTo(t.p)); }
    this.legErr = err;
    { const eL = err / this.U; this.an.dropX = clamp(this.an.dropX + (eL > 0.8 ? eL * 0.9 : -26 * dt), 0, 7); }   // bounded: a deep squat must never be 'fixed' by sinking the hips into the feet
    this.blob.position.y = 0.05; this.blob.scale.setScalar(24 * this.U * (1 - 0.4 * clamp(this.pos.y / (20 * this.U), 0, 1)));
    this.updateState(); this.updateAttachments(dt);
  }
  updateState() {
    const A = this.an, a = this.act, sp = this.speed;
    const spv = this.speed / this.Vf; this.state = this.flinchT > 0.3 ? 'HIT' : a ? a.label : this.hold ? ('CARRY ' + this.hold.name) : this.guard ? 'GUARD' : this.mode === 'prep' ? 'JUMP:PREPARE' : this.mode === 'landing' ? 'LANDING' : this.mode === 'air' ? (this.vel.y > 2 ? 'JUMP' : 'FALL') : spv > 17 ? 'RUN' : spv > 1.2 ? 'WALK' : 'IDLE';
    void A;
  }

  // ------------------------------------------------------------------------------------------------ HUD / debug
  hudUpdate() {
    const I = this.input || {}, set = (k, on) => { const e = $('wbslot-' + k); if (e) e.classList.toggle('active', !!on); }, a = this.act ? this.act.kind : '';
    set('lmb', a === 'punch'); set('hv', a === 'heavy'); set('q', a === 'blast'); set('e', a === 'grab' || !!this.hold); set('r', a === 'stomp'); set('ct', this.guard); set('sh', I.run && this.speed > 14); set('sp', this.mode === 'air' || this.mode === 'prep'); set('c', false);
    $('wb-hp').style.width = (this.hp / this.maxHp * 100) + '%'; $('wb-en').style.width = (this.energy / this.enMax * 100) + '%'; const cdq = this.cd.q > 0 ? this.cd.q / 1.4 : 0; $('wb-cd').style.width = (cdq * 100) + '%';
    const st = $('wb-state'); if (st) st.textContent = this.state + (this.hold ? '' : ''); const hb = $('wb-hold'); if (hb) hb.textContent = this.hold ? 'HOLDING: ' + this.hold.name + '  ·  ' + this.hold.massText : this.heavyCharge > 0 ? 'HEAVY PUNCH ' + (this.heavyCharge * 100 | 0) + '%' : 'HANDS FREE';
    const sk = $('wb-shake'); if (sk) sk.textContent = 'SHAKE ' + ['OFF', 'LOW', 'FULL'][this.g.camera.shakeLevel ?? 2] + ' [N]';
  }
  debugText() {
    const p = this.pos, f = this.footNow; return `FPS ${this.g.fps ? this.g.fps.toFixed(0) : '-'}   WAY BIG   state ${this.state}   height ${this.worldHeight().toFixed(1)} m (scale ${this.S.toFixed(4)})\nspeed ${this.speed.toFixed(1)} m/s   vy ${this.vel.y.toFixed(1)}   mode ${this.mode}   grounded ${this.grounded ? 'y' : 'n'}   hp ${this.hp.toFixed(0)}   energy ${this.energy.toFixed(0)}\npos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}   feet L ${f.L.x.toFixed(1)},${f.L.z.toFixed(1)}  R ${f.R.x.toFixed(1)},${f.R.z.toFixed(1)}   cells destroyed ${this.D.stats.cellsDestroyed}   collapses ${this.D.stats.collapses}\nfootfalls ${this.stats.footfalls} (crushed ${this.stats.crushed})  punches ${this.stats.punches}  heavy ${this.stats.heavies}  blasts ${this.stats.blasts}  grabs ${this.stats.grabs}  throws ${this.stats.throws}  stomps ${this.stats.stomps}  hits taken ${this.stats.hitsTaken}\nholding ${this.hold ? this.hold.name : '-'}   foes ${this.D.foes.map(f => f.name[0] + (f.dead ? 'x' : f.hp.toFixed(0))).join(' ')}`;
  }
  worldHeight() { const b = new THREE.Box3(); b.makeEmpty(); for (const m of this.rig.skinned) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); } this.rig.scene.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(this.rig.scene); return bb.max.y - bb.min.y; }
  prewarm(renderer, scene, camera) {
    const vis = this.root.visible, p = this.root.position.clone(), dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    this.root.visible = true; this.root.position.copy(camera.position).addScaledVector(dir, 330).setY(0); this.root.updateMatrixWorld(true);
    renderer.render(scene, camera); this.root.visible = vis; this.root.position.copy(p); this.root.updateMatrixWorld(true);
  }
}
installWbPowers(WbPlayer);
