// Procedural skeletal animation for Diamondhead (the GLB ships with no clips).
// Everything is driven from a few gameplay parameters; poses are blended with smoothed weights so
// every transition (idle<->walk<->run, crouch, jump, land, dash, aim) eases in and out.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, easeOutCubic, easeOutBack } from '../src/util.js';
import { BONE_NAMES, MODEL_SCALE, SOLE_Y, HAND_TIP, SHOULDER, UNIT } from './rig.js';

const N = BONE_NAMES.length, IDX = {};
BONE_NAMES.forEach((n, i) => IDX[n] = i);
const SIDES = [['L', 1], ['R', -1]];

class Pose {
  constructor() { this.r = new Float32Array(N * 3); this.p = new Float32Array(3); }
  reset() { this.r.fill(0); this.p.fill(0); return this; }
  add(n, x, y = 0, z = 0) { const i = IDX[n] * 3; this.r[i] += x; this.r[i + 1] += y; this.r[i + 2] += z; return this; }
  mix(a, b, t) { for (let i = 0; i < this.r.length; i++) this.r[i] = a.r[i] + (b.r[i] - a.r[i]) * t; for (let i = 0; i < 3; i++) this.p[i] = a.p[i] + (b.p[i] - a.p[i]) * t; return this; }
  copy(a) { this.r.set(a.r); this.p.set(a.p); return this; }
  blend3(a, wa, b, wb, c, wc) { for (let i = 0; i < this.r.length; i++) this.r[i] = a.r[i] * wa + b.r[i] * wb + c.r[i] * wc; for (let i = 0; i < 3; i++) this.p[i] = a.p[i] * wa + b.p[i] * wb + c.p[i] * wc; return this; }
}

// ---------------------------------------------------------------- pose generators
// Conventions (character faces +Z, +X is his left):
//   rotation.x < 0 swings a hanging limb FORWARD; torso/spine rotation.x > 0 leans FORWARD.
//   uarm.z * side > 0 lifts the arm OUT to the side.  chest.y > 0 turns toward his left.
function poseIdle(P, t, id) {
  P.reset();
  const b = Math.sin(t * 1.55), sh = Math.sin(t * 0.42 + id * 0.7), sh2 = Math.sin(t * 0.9);
  P.add('hips', 0.04, 0.02 * sh, 0.025 * sh); P.p[0] = 0.05 * sh; P.p[2] = 0.0;
  P.add('spine', 0.05 + 0.012 * b, -0.02 * sh); P.add('chest', 0.03 + 0.02 * b, 0.03 * sh, -0.012 * sh);
  P.add('neck', -0.03, 0.04 * Math.sin(t * 0.33)); P.add('head', -0.02 + 0.015 * b, 0.07 * Math.sin(t * 0.27 + 1), 0.015 * sh);
  for (const [s, sg] of SIDES) {
    const load = sg * sh; // +1 when this leg takes the weight
    P.add('thigh' + s, -0.20 + 0.05 * load, 0, sg * 0.1);
    P.add('shin' + s, 0.36 - 0.08 * load);
    P.add('foot' + s, -0.12 + 0.03 * load, 0, -sg * 0.02);
    P.add('uarm' + s, -0.10 + 0.025 * Math.sin(t * 1.55 + sg), 0, sg * (0.20 + 0.025 * b));
    P.add('farm' + s, -0.62 + 0.05 * Math.sin(t * 1.3 + sg * 1.4), sg * -0.12);
    P.add('hand' + s, -0.14 + 0.1 * Math.sin(t * 1.9 + sg * 2), 0, sg * 0.05 * sh2);
  }
}

function poseCycle(P, ph, o) { // shared walk / run generator; o = amplitudes
  P.reset();
  const hipLean = o.lean;
  P.add('hips', hipLean, -o.hipTwist * Math.sin(ph), o.roll * Math.cos(ph)); P.p[0] = -o.sway * Math.cos(ph);
  P.add('spine', o.lean * 0.55, o.twist * 0.5 * Math.sin(ph), -o.roll * 0.5 * Math.cos(ph));
  P.add('chest', o.lean * 0.5, o.twist * Math.sin(ph), -o.roll * 0.6 * Math.cos(ph));
  P.add('neck', -o.lean * 0.5, -o.twist * 0.4 * Math.sin(ph)); P.add('head', -o.lean * 0.45, -o.twist * 0.6 * Math.sin(ph));
  for (const [s, sg] of SIDES) {
    const f = ph + (sg > 0 ? 0 : Math.PI);          // leg phase (L leads, R is half a cycle behind)
    const sinf = Math.sin(f), swing = Math.max(0, Math.cos(f));
    const thigh = -o.legAmp * sinf - hipLean + o.legBias;
    const shin = o.knee * Math.pow(swing, 1.15) + o.kneeBase + 0.22 * Math.max(0, -Math.cos(f)) * o.kneeBase;
    P.add('thigh' + s, thigh, 0, sg * o.stance);
    P.add('shin' + s, shin);
    const stepDown = Math.max(0, -Math.cos(f + 0.4)) * o.toePush;
    P.add('foot' + s, -(hipLean + thigh + shin) * 0.9 - 0.28 * Math.pow(swing, 2) + stepDown);
    // arms swing against the same-side leg
    const arm = sg * 0 + o.armAmp * sinf; // positive = back
    P.add('uarm' + s, arm - o.armBias, 0, sg * o.armOut);
    P.add('farm' + s, -(o.elbow + o.elbowSwing * (0.5 - 0.5 * Math.sin(f))), sg * -0.1);
    P.add('hand' + s, -0.2 - 0.1 * (o.elbow > 1 ? 1 : 0));
  }
}
const WALK = { legAmp: 0.52, knee: 1.05, kneeBase: 0.22, legBias: 0, stance: 0.07, lean: 0.06, hipTwist: 0.13, twist: 0.24, roll: 0.045, sway: 0.07, toePush: 0.35, armAmp: 0.55, armBias: 0.0, armOut: 0.17, elbow: 0.5, elbowSwing: 0.28 };
const RUN  = { legAmp: 0.98, knee: 2.0, kneeBase: 0.42, legBias: 0.02, stance: 0.04, lean: 0.20, hipTwist: 0.2, twist: 0.38, roll: 0.06, sway: 0.05, toePush: 0.55, armAmp: 0.95, armBias: 0.1, armOut: 0.12, elbow: 1.35, elbowSwing: 0.45 };

function poseCrouch(P) { // anticipation / landing absorb (c scaled by blend weight)
  P.reset();
  P.add('hips', 0.18); P.add('spine', 0.42); P.add('chest', 0.22); P.add('head', -0.35);
  for (const [s, sg] of SIDES) {
    P.add('thigh' + s, -1.0, 0, sg * 0.18); P.add('shin' + s, 1.75); P.add('foot' + s, -0.5);
    P.add('uarm' + s, 0.75, 0, sg * 0.25); P.add('farm' + s, -0.45); P.add('hand' + s, -0.2);
  }
}
function poseRise(P, k) { // k = +1/-1 which leg tucks higher (varies per jump)
  P.reset();
  P.add('hips', 0.0); P.add('spine', -0.08); P.add('chest', -0.1); P.add('head', 0.12);
  for (const [s, sg] of SIDES) {
    const hi = sg * k > 0;
    P.add('thigh' + s, hi ? -1.15 : -0.45, 0, sg * 0.12); P.add('shin' + s, hi ? 1.5 : 0.65); P.add('foot' + s, hi ? 0.1 : 0.3);
    P.add('uarm' + s, -0.9, 0, sg * 0.95); P.add('farm' + s, -0.5, sg * -0.1); P.add('hand' + s, -0.2);
  }
}
function poseFall(P) {
  P.reset();
  P.add('hips', 0.05); P.add('spine', 0.1); P.add('chest', 0.04); P.add('head', -0.05);
  for (const [s, sg] of SIDES) {
    P.add('thigh' + s, -0.28, 0, sg * 0.2); P.add('shin' + s, 0.35); P.add('foot' + s, 0.35);
    P.add('uarm' + s, -0.25, 0, sg * 1.2); P.add('farm' + s, -0.35); P.add('hand' + s, -0.15);
  }
}
function poseDash(P) {
  P.reset();
  P.add('hips', 0.55, 0, 0); P.add('spine', 0.35); P.add('chest', 0.2); P.add('neck', -0.4); P.add('head', -0.45);
  P.add('thighL', 0.55, 0, 0.1); P.add('shinL', 0.25); P.add('footL', 0.9);        // trailing leg
  P.add('thighR', -1.45, 0, -0.1); P.add('shinR', 1.35); P.add('footR', 0.2);      // leading knee
  for (const [s, sg] of SIDES) { P.add('uarm' + s, 1.25, 0, sg * 0.28); P.add('farm' + s, -0.25); P.add('hand' + s, -0.1); }
}

// ---------------------------------------------------------------- animator
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Animator {
  constructor(rig) {
    this.rig = rig; this.bones = rig.bones;
    this.t = 0; this.phase = 0; this.speedS = 0; this.walkW = 0; this.runW = 0; this.idleW = 1;
    this.crouchW = 0; this.airW = 0; this.dashW = 0; this.fallBlend = 0; this.landDepth = 0; this.tuckSide = 1;
    this.pin = 0; this.pinW = 1; this.bank = 0; this.leanFwd = 0;
    this.P = {}; ['idle', 'walk', 'run', 'loco', 'crouch', 'rise', 'fall', 'air', 'dash', 'final'].forEach(k => this.P[k] = new Pose());
    this.aimW = 0; this.aimSide = 1; this.aimThrust = 0; this.aimForm = 0;
    this.restDir = { L: new THREE.Vector3(HAND_TIP[0] - SHOULDER[0], HAND_TIP[1] - SHOULDER[1], HAND_TIP[2] - SHOULDER[2]).normalize(), R: new THREE.Vector3(-(HAND_TIP[0] - SHOULDER[0]), HAND_TIP[1] - SHOULDER[1], HAND_TIP[2] - SHOULDER[2]).normalize() };
    this.state = 'idle';
  }

  /** p: {speed, signedSpeed, crouch(0..1), airborne, vy, dash, landImpact, turnRate, aim|null, hold} */
  update(dt, p, groundedPin = true) {
    this.t += dt; const P = this.P;
    const sp = this.speedS = damp(this.speedS, p.speed, 16, dt);
    const runW = clamp((sp - 3.6) / 3.2, 0, 1), moveW = smoothstep(0.15, 1.3, sp);
    this.runW = damp(this.runW, runW, 14, dt);
    this.walkW = damp(this.walkW, moveW * (1 - runW), 14, dt);
    this.idleW = clamp(1 - this.walkW - this.runW, 0, 1);
    // stride length grows with speed so feet roughly track the ground
    const stride = lerp(3.0, 4.7, this.runW), dir = p.signedSpeed < -0.2 ? -1 : 1;
    this.phase += dir * (sp / stride) * Math.PI * 2 * dt;
    this.phase %= Math.PI * 2 * 64;

    poseIdle(P.idle, this.t, 0);
    poseCycle(P.walk, this.phase, WALK);
    poseCycle(P.run, this.phase, RUN);
    // leaning into acceleration / braking
    const lean = clamp(p.accel || 0, -1, 1);
    P.loco.blend3(P.idle, this.idleW, P.walk, this.walkW, P.run, this.runW);
    P.loco.add('spine', lean * 0.06); P.loco.add('hips', lean * 0.04);

    // ---- jump / air
    const targetCrouch = Math.max(p.crouch || 0, this.landDepth);
    this.crouchW = damp(this.crouchW, targetCrouch, p.crouch > 0 ? 22 : 16, dt);
    if (p.landImpact) { this.landDepth = clamp(0.4 + p.landImpact / 16, 0.4, 1); this.crouchW = Math.max(this.crouchW, this.landDepth * 0.9); }
    this.landDepth *= Math.exp(-(p.moving ? 11 : 6.5) * dt);
    if (p.justJumped) this.tuckSide = Math.random() < 0.5 ? 1 : -1;
    this.airW = damp(this.airW, p.airborne ? 1 : 0, p.airborne ? 18 : 24, dt);
    this.fallBlend = damp(this.fallBlend, smoothstep(2.0, -5.0, p.vy), 10, dt);
    this.dashW = damp(this.dashW, p.dash ? 1 : 0, p.dash ? 28 : 9, dt);

    poseCrouch(P.crouch); poseRise(P.rise, this.tuckSide); poseFall(P.fall); poseDash(P.dash);
    P.air.mix(P.rise, P.fall, this.fallBlend);
    P.final.copy(P.loco);
    P.final.mix(P.final, P.crouch, this.crouchW * (1 - this.airW));
    P.final.mix(P.final, P.air, this.airW);
    P.final.mix(P.final, P.dash, this.dashW);
    const F = P.final;

    // ---- aim / fire upper-body layer (rotations added before the arm override below)
    const a = p.aim; this.aimW = a ? a.w : damp(this.aimW, 0, 12, dt);
    if (a) { this.aimSide = a.side; this.aimThrust = a.thrust; this.aimForm = a.form; }
    const aw = a ? a.w : 0;
    if (a && aw > 0) {
      F.add('chest', 0, -a.side * 0.32 * aw, 0); F.add('spine', 0, -a.side * 0.14 * aw, 0);
      F.add('hips', -0.04 * aw, -a.side * 0.06 * aw); F.add('head', 0, a.side * 0.2 * aw);
      F.add('chest', 0.05 * a.thrust, 0, 0);
      // counter-balance: the free arm pulls back / in
      const free = a.side > 0 ? 'R' : 'L', fs = a.side > 0 ? -1 : 1;
      F.add('uarm' + free, 0.3 * aw, 0, -fs * 0.0); F.add('farm' + free, -0.35 * aw);
      F.add('thigh' + (a.side > 0 ? 'R' : 'L'), 0.18 * aw * 0, 0, 0);
    }

    // ---- action layer (powers 2-6): per-bone absolute pose blended over locomotion by weight w
    const L = p.layer;
    if (L && L.w > 0.001) {
      for (const n in L.rot) { const i = IDX[n]; if (i === undefined) continue; const r = L.rot[n], w = L.w; F.r[i * 3] = lerp(F.r[i * 3], r[0], w); F.r[i * 3 + 1] = lerp(F.r[i * 3 + 1], r[1], w); F.r[i * 3 + 2] = lerp(F.r[i * 3 + 2], r[2], w); }
    }

    // ---- apply pose to bones
    const B = this.bones;
    for (let i = 0; i < N; i++) { _e.set(F.r[i * 3], F.r[i * 3 + 1], F.r[i * 3 + 2], 'XYZ'); B[BONE_NAMES[i]].quaternion.setFromEuler(_e); }
    B.hips.position.set(this.rig.rest.hips.pos.x + F.p[0], this.rig.rest.hips.pos.y + F.p[1], this.rig.rest.hips.pos.z + F.p[2]);
    // restore any arm translation changed last frame
    for (const [s] of SIDES) B['uarm' + s].position.copy(this.rig.rest['uarm' + s].pos);

    // body bank + dash lean (applied to the model root pivoting at the feet)
    const mg = this.rig.modelGroup;
    this.bank = damp(this.bank, clamp(-(p.turnRate || 0) * 0.045, -0.2, 0.2) * clamp(sp / 4, 0, 1), 8, dt);
    mg.rotation.z = this.bank;
    this.leanFwd = damp(this.leanFwd, this.dashW * 0.25, 14, dt);
    mg.rotation.x = this.leanFwd;
    mg.rotation.y = L && L.spinY ? L.spinY : 0;
    mg.updateMatrixWorld(true);

    // ---- aim override of the firing arm (needs fresh world matrices)
    if (a && aw > 0.001) this._applyAim(a);

    // ---- foot planting: keep the lowest sole on the ground (gives natural weight / bob)
    const wantPin = groundedPin && this.airW < 0.5 ? 1 : 0;
    this.pinW = damp(this.pinW, wantPin, 18, dt);
    const mk = this.rig.markers; let low = Infinity;
    for (const n of ['toeL', 'toeR', 'heelL', 'heelR']) { mk[n].getWorldPosition(_v); mg.worldToLocal(_v); low = Math.min(low, _v.y); }
    // low is in model-space; rest sole is SOLE_Y.  Positive = sole above ground -> push model down.
    const wantPinY = -(low - SOLE_Y) * MODEL_SCALE;
    this.pin = damp(this.pin, wantPinY * this.pinW, 30, dt);
    mg.position.y = -SOLE_Y * MODEL_SCALE + this.pin;
    mg.updateMatrixWorld(true);
    return F;
  }

  _applyAim(a) {
    const B = this.bones, sfx = a.side > 0 ? 'L' : 'R', up = B['uarm' + sfx], chest = B.chest;
    const w = easeOutCubic(a.w);
    _v.copy(a.target); chest.worldToLocal(_v);              // aim point in chest space
    _v.sub(up.position);                                    // from shoulder
    const dir = _v2.copy(_v).normalize();
    _q.setFromUnitVectors(this.restDir[sfx], dir);          // arm rest direction -> aim direction
    up.quaternion.slerp(_q, w);
    // forearm: cocked (crystals gather), snaps straight on the thrust
    const f = B['farm' + sfx]; _e.set(lerp(f.rotation.x, -0.55 * a.form * (1 - a.thrust) - 0.05, w), 0, 0, 'XYZ');
    f.quaternion.slerp(_q2.setFromEuler(_e), w);
    const h = B['hand' + sfx]; h.quaternion.slerp(_q2.setFromEuler(_e.set(-0.1, 0, 0)), w);
    // shoulder pulls back while cocked, drives forward on the thrust
    up.position.copy(this.rig.rest['uarm' + sfx].pos).addScaledVector(dir, a.push * UNIT * w);
    this.rig.modelGroup.updateMatrixWorld(true);
  }

  /** world position of a fingertip (muzzle) */
  tipWorld(side, out) { return this.rig.markers['tip' + (side > 0 ? 'L' : 'R')].getWorldPosition(out); }
}
