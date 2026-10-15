// Wildmutt controller: quadrupedal locomotion (idle / walk / trot / gallop-sprint), crouch-launch high jump with landing absorption, ledge climbing and the procedural
// four-limb animation on the supplied GLB's real skeleton. Powers (bite / claw / pounce / object tearing / Tracking Sense) live in wm_powers.js, climbing in wm_climb.js.
// Runs on PLAYER time (real seconds); everything it hits reacts on WORLD time inside the target's own update.
import * as THREE from 'three';
import { QuadPoser, WM_SCALE, LIMBS } from '../animations/quadrig.js';
import { clamp, damp, lerp, angleDelta, rand, smoothstep } from './util.js';
import { wmPowers } from './wm_powers.js';
import { wmClimb } from './wm_climb.js';

export const WCFG = { walk: 4.2, run: 15, accelG: 24, brake: 36, latG: 30, accelA: 4, jumpV: 15.4, grav: 27, crouchT: 0.15, radius: 0.55, height: 1.9, step: 0.55, hp: 380 };
export const PIV = 0.9;                                      // height of the tilt pivot (body centre) above the feet
const CIRC = [[0, 0.62], [0.9, 0.5], [-0.85, 0.5]];            // collision circles along the body: [offset along facing, radius] (quadruped: body + head + rump)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), TAU = Math.PI * 2, X_AX = new THREE.Vector3(1, 0, 0);
const $ = id => document.getElementById(id);
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const D = (x = 0, y = 0, z = 0) => [x, y, z];
const DEG = Math.PI / 180;
/** paw forward axis / dorsal axis for a given pitch (negative = toes down) */
export const pawF = (deg) => { const a = deg * DEG; return V(0, Math.sin(a), Math.cos(a)); };
export const pawN = (deg) => { const a = deg * DEG; return V(0, Math.cos(a), -Math.sin(a)); };
export const mkPose = () => ({ d: {}, off: [0, 0, 0], ik: {}, curl: { FL: 0.3, FR: 0.3, HL: 0.25, HR: 0.25 }, w: 1, tilt: null });
export const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const ZERO = [0, 0, 0];
/** blend layer L over pose P (L.w = weight; each limb in L.ik has its own weight) */
export function layerQ(P, L) {
  const w = L.w ?? 1; if (w <= 0.001) return P;
  for (const key in L.d) { const a = P.d[key] || ZERO, b = L.d[key]; P.d[key] = [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]; }
  if (L.off) for (let i = 0; i < 3; i++) P.off[i] = lerp(P.off[i], L.off[i], w);
  for (const k in L.ik) {
    const e = L.ik[k], wt = clamp((e.w ?? 1) * w, 0, 1), b = P.ik[k]; if (wt <= 0.001) continue;
    if (!b) { P.ik[k] = { ...e }; continue; }
    const lp = (x, y) => (x && y ? x.clone().lerp(y, wt) : (y || x));
    P.ik[k] = { p: b.p.clone().lerp(e.p, wt), pole: lp(b.pole, e.pole), f: lp(b.f, e.f), n: lp(b.n, e.n), ground: wt > 0.5 ? e.ground : b.ground, lift: lerp(b.lift || 0, e.lift || 0, wt) };
  }
  if (L.curl) for (const k in L.curl) P.curl[k] = lerp(P.curl[k] ?? 0.3, L.curl[k], w);
  if (L.tilt) { const t = P.tilt || (P.tilt = [0, 0]); t[0] = lerp(t[0], L.tilt[0], w); t[1] = lerp(t[1], L.tilt[1], w); }
  return P;
}

/** one foot's path through the stride: z offset (along the body), lift above the ground, pitch offset (deg). u = 0..1, stance first. */
function footCurve(u, duty, S, lift) {
  if (u < duty) { const s = u / duty; return { z: S * (0.5 - s), lift: 0, pitch: lerp(10, -16, s * s) }; }
  const s = (u - duty) / (1 - duty), e = sm(s);
  return { z: -S / 2 + S * e, lift: lift * Math.pow(Math.sin(Math.PI * s), 0.85), pitch: lerp(-16, 10, e) + 14 * Math.sin(Math.PI * s) };
}
const OFFS = { walk: { FL: 0.25, FR: 0.75, HL: 0, HR: 0.5 }, trot: { FL: 0.5, FR: 0, HL: 0, HR: 0.5 }, gal: { FR: 0.5, FL: 0.62, HR: 0, HL: 0.12 } };

export class WmPlayer {
  constructor(game, rig) {
    this.g = game; this.rig = rig; this.kind = 'wildmutt'; this.rad = WCFG.radius; this.colH = WCFG.height;
    this.root = new THREE.Group(); this.root.name = 'Wildmutt';
    this.tiltG = new THREE.Group(); this.tiltG.position.set(0, PIV, 0); this.tiltG.name = 'WildmuttTilt';
    rig.modelGroup.scale.setScalar(WM_SCALE); rig.modelGroup.position.set(0, -PIV, 0); this.tiltG.add(rig.modelGroup); this.root.add(this.tiltG); game.scene.add(this.root);
    this.poser = new QuadPoser(rig);
    this.pos = this.root.position; this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.grounded = true; this.mode = 'ground';
    this.speed = 0; this.crouchT = 0; this.crouchDur = WCFG.crouchT; this.jumpBuffer = 0; this.landImpact = 0; this.hasInput = false; this.state = 'IDLE'; this.camYaw = 0;
    this.hp = WCFG.hp; this.hpT = 0; this.wantDir = new THREE.Vector3(); this.input = null; this.pitchV = 0;
    this.hitSphere = { y: 1.0, r: 1.25 };
    this.stats = { bites: 0, hits: 0, claws: 0, pounces: 0, pounceHits: 0, climbs: 0, jumps: 0, landings: 0, torn: 0, senses: 0 };
    this.an = { t: 0, ph: 0, vs: 0, mv: 0, air: 0, land: 0, landV: 0, crouch: 0, turn: 0, lean: 0, accel: 0, prevSpeed: 0, tx: 0, tz: 0, prevU: {}, sniff: 0, sniffT: rand(2, 4), look: { t: 1.5, yaw: 0, pitch: 0, ty: 0, tp: 0 }, sense: 0, senseHead: 0, senseKick: 0, senseAmp: 1, fs: 0 };
    this.gnd = { FL: 0, FR: 0, HL: 0, HR: 0 };
    this.initPowers(game); this.initClimb();
    this.root.rotation.y = this.yaw; this.root.visible = false;
    this.poser.apply(this.finalize(this.locoPose(0.016)));
  }

  // ------------------------------------------------------------------------------------------------ plumbing
  activate(from) {
    this.pos.copy(from.pos); this.vel.copy(from.vel); this.yaw = from.yaw; this.grounded = from.grounded; this.mode = this.grounded ? 'ground' : 'air';
    this.root.rotation.y = this.yaw; this.root.visible = true; this.cancelAll(); this.an.land = this.an.landV = 0; this.an.tx = this.an.tz = 0;
    this.g.world.resolveXZ(this.pos, this.rad, this.pos.y, this.colH, WCFG.step); this.root.updateMatrixWorld(true); this.poser.apply(this.finalize(this.locoPose(0.016)));
  }
  deactivate() { this.cancelAll(); this.root.visible = false; }
  get busy() { return !!this.act || !!this.climb; }

  // ------------------------------------------------------------------------------------------------ physics
  updatePhysics(dt, input, camYaw) {
    const w = this.g.world, R = WCFG, H = this.colH; this.landImpact = 0; this.camYaw = camYaw;
    const fwd = _a.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = _b.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const want = _c.set(0, 0, 0).addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX); const hasInput = want.lengthSq() > 1e-4; if (hasInput) want.normalize();
    this.hasInput = hasInput; this.wantDir.copy(want); this.input = input; this.jumpBuffer = Math.max(0, this.jumpBuffer - dt); if (input.jump) this.jumpBuffer = 0.16;
    if (this.climb) { this.updateClimb(dt, input, camYaw, want, hasInput); return; }
    this.scanClimb(dt);
    const a = this.act, locked = a && a.lockMove, spd0 = Math.hypot(this.vel.x, this.vel.z);
    let top = (input.run ? R.run : R.walk) * (a ? (a.speedMul ?? 0.75) : 1); if (locked) top = 0;
    // high jump: crouch -> launch
    if (this.jumpBuffer > 0 && this.grounded && this.mode === 'ground' && !(a && a.noJump)) { this.mode = 'crouch'; this.crouchT = 0; this.crouchDur = lerp(0.17, 0.075, smoothstep(2, 12, spd0)); this.jumpBuffer = 0; if (a && a.kind === 'bite') this.endAct(); }
    if (this.mode === 'crouch') { this.crouchT += dt; if (this.crouchT >= this.crouchDur) { this.vel.y = R.jumpV; this.grounded = false; this.mode = 'air'; if (this.hasInput) { this.vel.x += want.x * 1.6; this.vel.z += want.z * 1.6; } this.jumpFX(); } }
    const mvv = a ? a.moveVel : null;
    if (mvv) { this.vel.x = mvv.x; this.vel.z = mvv.z; }
    else if (this.mode === 'crouch') { const k = Math.exp(-1.2 * dt); this.vel.x *= k; this.vel.z *= k; }
    else if (!(a && a.ballistic)) {
      const airTop = Math.max(Math.hypot(this.vel.x, this.vel.z), R.walk), tgt = this.grounded ? top : airTop;
      const tx = hasInput ? want.x * tgt : 0, tz = hasInput ? want.z * tgt : 0, dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      const turning = hasInput && spd0 > 1 ? (this.vel.x * want.x + this.vel.z * want.z) / spd0 : 1;
      const rate = this.grounded ? (hasInput ? (turning < 0.2 ? R.latG : R.accelG) : R.brake) : (hasInput ? R.accelA : 0.4), m = Math.min(dl, rate * dt);
      if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    const prevY = this.pos.y;
    if (!this.grounded) this.vel.y = Math.max(-60, this.vel.y - (a && a.grav ? a.grav : R.grav) * dt);
    this.integrate(dt, prevY, H);
    this.faceUpdate(dt, camYaw, want, hasInput);
  }
  /** move + collide with sub-steps; ground/air state, landing */
  integrate(dt, prevY, H) {
    const w = this.g.world, hsp = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.min(10, Math.ceil(hsp / 0.28))), h = dt / n, step = this.grounded ? WCFG.step : 0.05;
    for (let i = 0; i < n; i++) {
      this.pos.x += this.vel.x * h; this.pos.z += this.vel.z * h; const ox = this.pos.x, oz = this.pos.z;
      this.collide(H, step);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved > 1e-4) { const nx = (this.pos.x - ox) / moved, nz = (this.pos.z - oz) / moved, vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; } }
    }
    const y0 = this.pos.y; this.pos.y += this.vel.y * dt;
    if (this.vel.y > 0) for (const b of w.boxes) {                 // ceilings: never rise through the underside of a platform / roof
      if (b.min.y >= y0 + H - 0.05 && b.min.y < this.pos.y + H && this.pos.x > b.min.x - this.rad * 0.7 && this.pos.x < b.max.x + this.rad * 0.7 && this.pos.z > b.min.z - this.rad * 0.7 && this.pos.z < b.max.z + this.rad * 0.7) { this.pos.y = b.min.y - H; this.vel.y = 0; }
    }
    const gy = w.groundAt(this.pos.x, this.pos.z, prevY, this.grounded ? WCFG.step : 0.05, this.rad * 0.6);
    if (this.mode === 'crouch') { /* planted */ }
    else if (this.pos.y <= gy + 1e-4 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -4) { this.landImpact = -this.vel.y; this.landFX(this.landImpact); }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true; if (this.mode === 'air') this.mode = 'ground';
    } else if (this.grounded && this.pos.y > gy + 0.06) { this.grounded = false; if (this.mode === 'ground') this.mode = 'air'; }
    if (this.grounded && this.mode !== 'crouch') this.pos.y = gy;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
  /** the body is three circles along its length so the head and rump respect walls too */
  collide(H, step) {
    const w = this.g.world, sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    for (const [o, r] of CIRC) { const px = this.pos.x + sy * o, pz = this.pos.z + cy * o, q = _q.set(px, this.pos.y, pz); w.resolveXZ(q, r, this.pos.y, H, step); this.pos.x += q.x - px; this.pos.z += q.z - pz; }
  }
  aimYaw() { const y = this.camYaw ?? this.g.camera.yaw; return Math.atan2(-Math.sin(y), -Math.cos(y)); }
  faceUpdate(dt, camYaw, want, hasInput) {
    const a = this.act; let target = this.yaw, k = 10;
    if (a && a.faceYaw !== undefined) { target = a.faceYaw; k = a.faceK ?? 18; }
    else if (this.mode === 'air') { if (this.speed > 2) { target = Math.atan2(this.vel.x, this.vel.z); k = 3; } }
    else if (this.speed > 0.7 && hasInput) { target = Math.atan2(this.vel.x, this.vel.z); k = this.grounded ? lerp(13, 6.5, smoothstep(3, 15, this.speed)) : 4; }
    else if (hasInput) { target = Math.atan2(want.x, want.z); k = 9; }
    const dy = angleDelta(this.yaw, target), step = dy * (1 - Math.exp(-k * dt)); this.yaw += step; this.an.turn = damp(this.an.turn, step / Math.max(dt, 1e-4), 10, dt);
    this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------------------ damage taken
  onHit(dmg, pt, dir) {
    const g = this.g; g.hud.hurt(); g.camera.addTrauma(0.3); this.hp = Math.max(0, this.hp - dmg); this.hpT = 4;
    if (this.hp <= 0) { this.hp = WCFG.hp * 0.6; g.hud.toast('SECOND WIND'); }
  }

  // ------------------------------------------------------------------------------------------------ FX
  jumpFX() {
    const g = this.g; this.stats.jumps++; this.an.landV -= 2.5; g.sfx.thud(0.45); g.camera.kick(0.012);
    const c = _a.set(this.pos.x, this.pos.y + 0.08, this.pos.z);
    g.fx.surface.ring(c.clone(), UP, 4, 0.35, 0xc9bfa5);
    for (let i = 0; i < 10; i++) g.fx.dust.emit({ pos: c.clone().add(_b.set(rand(-0.9, 0.9), 0, rand(-0.9, 0.9))), vel: _c.set(rand(-1, 1), rand(0.3, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4)).clone(), size: rand(0.5, 1.0), grow: 1.5, life: rand(0.5, 0.9), drag: 2.2, color: [0.66, 0.63, 0.58], alpha: 0.45 });
  }
  /** landing: legs absorb (spring), dust ring, subtle camera reaction; only a really hard landing throws a small shockwave */
  landFX(v) {
    const g = this.g, k = clamp((v - 4) / 18, 0, 1); this.stats.landings++; this.an.landV += 3.2 + 8 * k; g.camera.addTrauma(0.05 + 0.18 * k); g.camera.kick(0.01 + 0.02 * k); g.sfx.thud(0.3 + 0.5 * k);
    const c = new THREE.Vector3(this.pos.x, this.pos.y + 0.06, this.pos.z);
    g.fx.surface.ring(c.clone(), UP, 3.5 + 5 * k, 0.4, 0xcfc6ad);
    for (let i = 0; i < 8 + 14 * k; i++) g.fx.dust.emit({ pos: c.clone().add(_b.set(rand(-1.1, 1.1), 0, rand(-1.1, 1.1))), vel: _c.set(rand(-1, 1), rand(0.2, 0.9), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6) * (0.6 + k)).clone(), size: rand(0.6, 1.3), grow: 1.8, life: rand(0.5, 1.0), drag: 2.4, color: [0.66, 0.63, 0.58], alpha: 0.5 });
    if (k > 0.55 && g.props) g.props.shockwave(c, 2.5 + 2.5 * k, 3 + 5 * k, 0, 0);
    if (v > 7) { const f = 1 - 0.25 * k; this.vel.x *= f; this.vel.z *= f; }
  }
  /** a paw touches down: thud + dust (stronger at speed) */
  footstep(k) {
    const g = this.g, A = this.an, big = smoothstep(7, 15, this.speed); const tip = this.pawPos(k, _a);
    if (k === 'FL' || k === 'HR' || big > 0.5) g.sfx.thud(0.05 + 0.16 * big + 0.04 * (k[0] === 'F' ? 1 : 0)); g.camera.addTrauma(0.004 + 0.02 * big * (k[0] === 'F' ? 1 : 0.5));
    const n = big > 0.15 ? 2 + (big > 0.6 ? 2 : 0) : 0;
    for (let i = 0; i < n; i++) g.fx.dust.emit({ pos: _b.set(tip.x, this.pos.y + 0.06, tip.z).clone(), vel: _c.set(rand(-1, 1) - this.vel.x * 0.05, rand(0.2, 0.8), rand(-1, 1) - this.vel.z * 0.05).clone(), size: rand(0.3, 0.7) * (0.6 + big), grow: 1.4, life: rand(0.35, 0.7), drag: 2.6, color: [0.66, 0.63, 0.58], alpha: 0.35 });
  }
  pawPos(k, out) { const L = this.rig.limbs[k]; out.set(0, 0, 0); for (const t of L.tips) out.add(_q.setFromMatrixPosition(t.matrixWorld)); if (L.tips.length) out.multiplyScalar(1 / L.tips.length); return out; }
  boneWorld(b, out) { return out.setFromMatrixPosition(b.matrixWorld); }
  muzzlePos(out) { const m = this.rig.muzzle; return m ? m.bone.localToWorld(out.copy(m.local)) : this.boneWorld(this.rig.bones.head, out); }

  // ------------------------------------------------------------------------------------------------ animation
  /** continuous pose: idle <-> walk <-> trot <-> gallop, crouch, rise / fall, landing */
  locoPose(dt) {
    const A = this.an, R = WCFG, P = mkPose(), grounded = this.grounded || this.mode === 'crouch'; A.t += dt; const t = A.t, w = this.g.world;
    const sp = this.speed;
    A.vs = damp(A.vs, grounded ? Math.max(sp, Math.abs(A.turn) * 0.7) : 0, 14, dt);
    A.mv = damp(A.mv, smoothstep(0.35, 1.5, A.vs), 9, dt);
    A.air = damp(A.air, grounded ? 0 : 1, 13, dt);
    A.crouch = damp(A.crouch, this.mode === 'crouch' ? clamp(this.crouchT / Math.max(0.05, this.crouchDur), 0, 1) : 0, 22, dt);
    const v = A.vs, T = 0.42 + 0.55 * Math.exp(-v / 5), duty = Math.min(0.66, 1.4 / Math.max(0.2, v * T)), S = v * duty * T;
    const gT = smoothstep(3.8, 6.6, v), gG = smoothstep(9.2, 12.8, v), wW = 1 - gT, wT = gT * (1 - gG), wG = gG;
    if (grounded && A.mv > 0.02) A.ph = (A.ph + dt / T) % 1;
    const accel = dt > 0 ? clamp((sp - A.prevSpeed) / dt / 30, -1, 1) : 0; A.prevSpeed = sp; A.accel = damp(A.accel, accel, 8, dt);
    if (dt > 0) { A.landV += (-150 * A.land - 13 * A.landV) * dt; A.land = clamp(A.land + A.landV * dt, -0.25, 1.2); }
    const mv = A.mv, ground = 1 - A.air, ph = A.ph * TAU, land = clamp(A.land, 0, 1.2), cr = A.crouch, idle = 1 - mv;
    const dom = wG > 0.5 ? OFFS.gal : wT > 0.5 ? OFFS.trot : OFFS.walk;
    // ---------- ground sampling per paw (uneven ground / kerbs): smoothed height of the surface under each paw, relative to the body
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    for (const k of LIMBS) { const front = k[0] === 'F', side = k[1] === 'L' ? 1 : -1, lz = front ? 0.35 : -0.85, lx = side * (front ? 0.6 : 0.4);
      let gy = 0; if (this.grounded && this.mode !== 'crouch' && !this.climb) { const wx = this.pos.x + sy * lz + cy * lx, wz = this.pos.z + cy * lz - sy * lx; gy = clamp(w.groundAt(wx, wz, this.pos.y + 0.5, 0.5, 0.1) - this.pos.y, -0.5, 0.55); }
      this.gnd[k] = damp(this.gnd[k], gy, 18, dt); }
    // ---------- body (hips / spine / neck / head)
    const flat = (0.20 * gT + 0.30 * gG) * mv * ground, lean = (0.04 * mv + 0.10 * A.accel) * ground;
    const bobW = 0.018 * wW + 0.036 * wT + 0.085 * wG, bob = bobW * Math.cos(wG > 0.5 ? ph - 0.6 : 2 * ph) * mv * ground;
    const rock = 0.11 * wG * Math.sin(ph + 0.15) * mv * ground, sway = Math.sin(ph) * (0.10 * wW + 0.06 * wT) * mv * ground;
    const b = Math.sin(t * 1.9), breathe = 0.014 * b * idle;
    const L = A.look; L.t -= dt; if (L.t <= 0) { L.t = rand(1.6, 4.2); L.ty = rand(-0.7, 0.7); L.tp = rand(-0.12, 0.16); if (Math.random() < 0.25) A.sniff = 1; }
    L.yaw = damp(L.yaw, L.ty, 2.6, dt); L.pitch = damp(L.pitch, L.tp, 3, dt);
    A.sniff = Math.max(0, A.sniff - dt * 0.9); const sn = A.sniff > 0 ? Math.sin(clamp(1 - A.sniff, 0, 1) * Math.PI) : 0, nose = sn * Math.sin(t * 22) * 0.02;
    A.sense = damp(A.sense, this.g.sense && this.g.sense.on ? 1 : 0, 6, dt);
    const idleLook = idle * ground * (1 - 0.7 * A.sense);
    P.d.hips = D(0.03 * mv - 0.03 * land + 0.05 * A.accel + rock * 0.6, 0.5 * sway, 0.035 * Math.sin(t * 0.55) * idle + 0.5 * sway * 0.3);
    const crP = 0.22 * cr + 0.14 * land;
    P.d.spine0 = D(flat * 0.40 + lean * 0.4 + crP * 0.5 + breathe - rock * 0.5, -sway * 0.9, 0);
    P.d.spine1 = D(flat * 0.36 + lean * 0.35 + crP * 0.5 + 0.8 * breathe - rock * 0.45, -sway * 0.5, 0);
    P.d.spine2 = D(flat * 0.24 + lean * 0.25 + crP * 0.3 + 0.6 * breathe - rock * 0.3, sway * 0.8, 0);
    A.senseKick = Math.max(0, A.senseKick - dt / 0.7); const kb = A.senseKick > 0 ? A.senseAmp * Math.sin(Math.PI * (1 - A.senseKick)) : 0;       // raise-head + sniff when the sense is switched
    const headUp = 0.38 * A.sense + 0.30 * sn + 0.55 * kb;
    P.d.neck = D(-flat * 0.95 - 0.5 * crP + L.pitch * 0.5 * idleLook - headUp * 0.45 + 0.05 * sn * Math.sin(t * 18), (L.yaw * 0.55 + 0.04 * Math.sin(t * 0.7) * A.sense) * idleLook - sway * 0.4, 0);
    P.d.head = D(-flat * 0.35 - 0.3 * crP + L.pitch * 0.5 * idleLook - headUp * 0.55 + nose, (L.yaw * 0.45) * idleLook, 0.025 * Math.sin(t * 0.9) * idleLook);
    P.d.jaw = D(0.03 + 0.03 * Math.sin(t * 1.7) * idle + 0.06 * wG * mv * (0.5 + 0.5 * Math.sin(ph * 2)) + 0.05 * sn + 0.14 * kb, 0, 0);
    P.off[0] = 0.02 * Math.sin(t * 0.55) * idle; P.off[1] = (0.10 - 0.16 * gG * mv + bob - 0.012 * Math.sin(t * 1.9) * idle) * ground - 0.30 * cr - 0.26 * land * (1 - cr) + 0.05 * A.sense + 0.05 * kb; P.off[2] = 0.05 * mv * ground + 0.04 * gG * mv;
    // ---------- paws: ground gait
    const G = {}, lat = 0.03 * Math.sin(t * 0.55) * idle;
    for (const k of LIMBS) {
      const front = k[0] === 'F', side = k[1] === 'L' ? 1 : -1; let z = 0, lift = 0, pitch = 0, width = 0;
      const base = front ? { zc: 0.34, x: 0.60, pitch: -28, lift: 0.30 } : { zc: -0.84, x: 0.40, pitch: -14, lift: 0.26 }, liftScale = clamp(S / 0.9, 0, 1);
      for (const [wt, off, lm, wm] of [[wW, OFFS.walk, 0.8, 1], [wT, OFFS.trot, 1.0, 0.95], [wG, OFFS.gal, 1.35, 0.82]]) {
        if (wt < 0.001) continue; const f = footCurve((A.ph + off[k]) % 1, duty, S, base.lift * lm * liftScale); z += wt * f.z; lift += wt * f.lift; pitch += wt * f.pitch; width += wt * wm;
      }
      if (this.dbgFreeze) { z = 0; lift = 0; }
      const zz = base.zc + z + (front ? 0 : 0.0) - 0.05 * mv * (front ? 0 : 1), pt = base.pitch + pitch * mv;
      G[k] = { p: V(side * (base.x * (width || 1) + (front ? 0.02 : 0) + lat * side * 0 ), front ? 0.45 : 0.22, zz), pole: front ? V(side * 0.78, 0.22, -0.62) : V(side * 0.35, 0.15, 1), f: pawF(pt), n: pawN(pt), ground: this.gnd[k] + 0.015, lift };
      // touchdown events (start of stance) for sound + dust
      const u = (A.ph + dom[k]) % 1, pu = A.prevU[k]; if (pu !== undefined && u < pu && grounded && mv > 0.5 && dt > 0 && !this.climb) this.footstep(k); A.prevU[k] = u;
    }
    // idle: slow weight shift between the paws
    const shift = 0.03 * Math.sin(t * 0.55) * idle * ground; G.FL.p.x += shift; G.FR.p.x += shift; G.HL.p.x += shift; G.HR.p.x += shift;
    // ---------- paws: crouch (jump prep) and airborne (rise / fall)
    const vy = this.vel.y, fall = sm(clamp(0.5 - vy / 12, 0, 1)), near = this.grounded ? 0 : clamp((1.6 - (this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1, 40, 0.3))) / 1.6, 0, 1) * fall;
    const Air = {};
    for (const k of LIMBS) {
      const front = k[0] === 'F', side = k[1] === 'L' ? 1 : -1;
      if (front) {
        const rise = { p: V(side * 0.56, 1.12, 1.15), f: pawF(8), n: pawN(8), curl: 0.1 }, fl = { p: V(side * 0.62, 0.62, 0.95), f: pawF(-42), n: pawN(-42), curl: 0.18 }, br = { p: V(side * 0.62, 0.30, 0.55), f: pawF(-30), n: pawN(-30), curl: 0.3 };
        const a = { p: rise.p.clone().lerp(fl.p, fall).lerp(br.p, near), f: rise.f.clone().lerp(fl.f, fall).lerp(br.f, near).normalize(), n: rise.n.clone().lerp(fl.n, fall).lerp(br.n, near).normalize(), curl: lerp(lerp(rise.curl, fl.curl, fall), br.curl, near) };
        Air[k] = { p: a.p, pole: V(side * 0.75, 0.3, -0.6), f: a.f, n: a.n, curl: a.curl };
      } else {
        const rise = { p: V(side * 0.36, 0.70, -1.75), f: V(0, -0.85, 0.2).normalize(), n: V(0, 0.2, 0.9) }, fl = { p: V(side * 0.40, 0.46, -0.85), f: pawF(-35), n: pawN(-35) }, br = { p: V(side * 0.40, 0.22, -0.75), f: pawF(-20), n: pawN(-20) };
        const a = { p: rise.p.clone().lerp(fl.p, fall).lerp(br.p, near), f: rise.f.clone().lerp(fl.f, fall).lerp(br.f, near).normalize(), n: rise.n.clone().lerp(fl.n, fall).lerp(br.n, near).normalize() };
        Air[k] = { p: a.p, pole: V(side * 0.35, 0.2, 1), f: a.f, n: a.n, curl: 0.2 };
      }
    }
    for (const k of LIMBS) {
      const g = G[k], c = Air[k]; let p = g.p, f = g.f, n = g.n, pole = g.pole, curl = k[0] === 'F' ? lerp(0.36, 0.5, wG * mv) : 0.26;
      if (cr > 0.01) { p = p.clone(); p.z += (k[0] === 'F' ? -0.18 : 0.12) * cr; p.x += (k[1] === 'L' ? 1 : -1) * 0.05 * cr; curl = lerp(curl, 0.45, cr); }
      if (A.air > 0.001) { p = p.clone().lerp(c.p, A.air); f = f.clone().lerp(c.f, A.air).normalize(); n = n.clone().lerp(c.n, A.air).normalize(); pole = pole.clone().lerp(c.pole, A.air); curl = lerp(curl, c.curl, A.air); }
      P.ik[k] = { p, pole, f, n, ground: A.air > 0.5 ? undefined : g.ground, lift: g.lift * (1 - A.air) }; P.curl[k] = curl;
    }
    // body flies along its trajectory: nose up while rising, nose down while falling (about the body centre)
    const hv = Math.hypot(this.vel.x, this.vel.z), pitchAir = -clamp(vy / 16, -1, 1) * 0.42 * clamp(0.5 + hv / 10, 0.5, 1);
    const tx = A.air > 0.2 ? pitchAir : 0; A.tx = damp(A.tx, tx, 9, dt);
    const roll = clamp(-A.turn * 0.014 * smoothstep(3, 14, sp), -0.22, 0.22) * ground; A.tz = damp(A.tz, roll, 7, dt);
    if (Math.abs(A.tx) > 1e-3 || Math.abs(A.tz) > 1e-3) P.tilt = [A.tx, A.tz];
    P.d.spine1[0] += -0.18 * A.air * (1 - fall) + 0.1 * A.air * fall - 0.10 * kb; P.d.spine2[0] -= 0.12 * kb; P.d.head[0] += 0.12 * A.air * fall; P.d.jaw[0] += 0.16 * A.air * (1 - near);
    return P;
  }
  /** apply tilt (about the body centre) + convert every target into the tilted body frame */
  finalize(P) {
    const A = this.an; let tx = 0, tz = 0; if (P.tilt) { tx = P.tilt[0]; tz = P.tilt[1]; }
    if (this.tiltOverride) { tx = this.tiltOverride[0]; tz = this.tiltOverride[1]; }
    this.tiltG.rotation.set(tx, 0, tz, 'XYZ'); this.tiltG.updateMatrixWorld(true);
    if (Math.abs(tx) > 1e-4 || Math.abs(tz) > 1e-4) {
      const qi = this.tiltG.quaternion.clone().invert(), piv = _c.set(0, PIV, 0);
      for (const k of LIMBS) { const e = P.ik[k]; if (!e) continue; e.p = e.p.clone().sub(piv).applyQuaternion(qi).add(piv); if (e.pole) e.pole = e.pole.clone().applyQuaternion(qi); if (e.f) e.f = e.f.clone().applyQuaternion(qi); if (e.n) e.n = e.n.clone().applyQuaternion(qi); e.ground = undefined; }
      const o = _a.set(P.off[0], P.off[1], P.off[2]).applyQuaternion(qi); P.off = [o.x, o.y, o.z];
    }
    return P;
  }
  /** per-frame: locomotion + action layer -> skeleton */
  updateAnim(dt) {
    const P = this.locoPose(dt); const L = this.actLayer(dt); if (L) layerQ(P, L);
    this.poser.apply(this.finalize(P)); this.root.updateMatrixWorld(true); this.updateState();
  }
  updateState() {
    const A = this.an, a = this.act;
    this.state = this.climb ? 'CLIMB:' + this.climb.stage.toUpperCase() : a ? a.kind.toUpperCase() + ':' + a.stage.toUpperCase() : this.mode === 'crouch' ? 'JUMP-CROUCH' : !this.grounded ? (this.vel.y > 0 ? 'JUMP-RISE' : 'FALL') : A.land > 0.35 ? 'LAND' : A.mv < 0.3 ? 'IDLE' : this.speed > 11 ? 'SPRINT' : this.speed > 6 ? 'RUN' : 'WALK';
  }
}
Object.assign(WmPlayer.prototype, wmPowers, wmClimb);
