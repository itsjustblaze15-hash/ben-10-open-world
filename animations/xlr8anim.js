// Procedural animation for XLR8 (the GLB has no clips). Poses are blended per bone from the live movement state:
// idle / walk / run / super-sprint gait cycles, lean, turning bank, tail dynamics, jump (crouch, rise, fall, land),
// skid (quick stop) and an "action layer" for attacks (absolute per-bone rotations blended on top by weight).
// Axis notes (bones are axis-aligned in the rest pose, model faces +Z, +X is the model's left):
//   rot.x > 0 : forward-pointing parts dip, backward-pointing parts (tail, shin) rise      -> lean forward = +x on hips
//   thigh/shin: thigh.x < 0 swings the leg forward; shin.x > 0 folds the foot up behind the knee
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../src/util.js';
import { XLR8_SCALE, XLR8_SOLE_Y } from './xlr8rig.js';

const TAU = Math.PI * 2;
const E = new THREE.Euler();
const sstep = smoothstep;

export class XlrAnimator {
  constructor(rig) {
    this.rig = rig; this.t = 0; this.phase = 0;
    this.idleW = 1; this.walkW = 0; this.runW = 0; this.sprintW = 0;
    this.air = 0; this.tuck = 0; this.landDepth = 0; this.crouch = 0; this.skidA = 0; this.bank = 0; this.lean = 0; this.tailYaw = 0; this.headYaw = 0;
    this.baseY = 0; this.pose = {}; this.layerW = 0; this.footClamp = true;
    for (const n of Object.keys(rig.bones)) this.pose[n] = [0, 0, 0];
  }
  set(n, x, y, z) { const q = this.pose[n]; if (q) { q[0] += x; q[1] += y; q[2] += z; } }

  update(dt, p, grounded) {
    const R = this.rig; this.t += dt;
    const s = p.speed;
    // ---- gait weights
    const idleT = 1 - sstep(0.25, 1.4, s), walkT = sstep(0.3, 1.6, s) * (1 - sstep(3.2, 5.6, s)), runT = sstep(3.2, 5.6, s) * (1 - sstep(19, 28, s)), spT = sstep(19, 28, s);
    const k = 1 - Math.exp(-14 * dt);
    this.idleW += (idleT - this.idleW) * k; this.walkW += (walkT - this.walkW) * k; this.runW += (runT - this.runW) * k; this.sprintW += (spT - this.sprintW) * k;
    const ww = this.walkW, wr = this.runW, wsp = this.sprintW, wi = this.idleW, move = clamp(ww + wr + wsp, 0, 1);
    const stride = Math.min(9.5, 1.8 + 0.2 * s);
    if (grounded) this.phase += dt * TAU * s / stride;
    const ph = this.phase;
    // ---- state smoothing
    this.air = damp(this.air, p.airborne ? 1 : 0, p.airborne ? 18 : 12, dt);
    this.crouch = damp(this.crouch, p.crouch, 22, dt);
    this.landDepth = Math.max(this.landDepth * Math.exp(-dt * 7.5), p.landImpact ? clamp(p.landImpact / 20, 0.25, 1) : 0);
    this.skidA = damp(this.skidA, p.skid || 0, 14, dt);
    const bankT = clamp(-p.turnRate * clamp(s / 30, 0, 1) * 0.22, -0.55, 0.55);
    this.bank = damp(this.bank, bankT, 9, dt);
    this.tailYaw = damp(this.tailYaw, clamp(p.turnRate * 0.12, -0.7, 0.7), 5, dt);
    this.headYaw = damp(this.headYaw, clamp(p.turnRate * 0.22, -0.7, 0.7), 8, dt);
    const accel = p.accel || 0;

    // ---- lean (the rest pose is already a forward crouch: negative = more upright idle, positive = flat sprint)
    const leanT = -0.10 * wi + 0.05 * ww + 0.16 * wr + 0.34 * wsp + 0.12 * clamp(accel, 0, 1) - 0.5 * this.skidA - 0.1 * this.air;
    this.lean = damp(this.lean, leanT, 10, dt);
    const lean = this.lean;

    for (const n in this.pose) { const q = this.pose[n]; q[0] = q[1] = q[2] = 0; }

    // ---- idle: breathing, weight shift, head look, tail sway, small knee bounce
    const bt = this.t;
    if (wi > 0.001) {
      const br = Math.sin(bt * 2.1), sh = Math.sin(bt * 0.55), hl = Math.sin(bt * 0.7) * Math.sin(bt * 0.23 + 1);
      this.set('chest', 0.025 * br * wi, 0.05 * sh * wi, 0); this.set('spine', 0.01 * br * wi, 0, 0.02 * sh * wi);
      this.set('hips', 0, 0, 0.035 * sh * wi); this.set('head', -0.02 * br * wi, 0.22 * hl * wi, 0.03 * Math.sin(bt * 0.9) * wi);
      this.set('thighL', 0.03 * Math.sin(bt * 2.4) * wi, 0, 0); this.set('thighR', 0.03 * Math.sin(bt * 2.4 + 1.2) * wi, 0, 0);
      this.set('uarmL', 0.06 * Math.sin(bt * 1.6) * wi, 0, 0.05 * br * wi); this.set('uarmR', 0.06 * Math.sin(bt * 1.6 + 1) * wi, 0, -0.05 * br * wi);
      this.set('handL', 0.12 * Math.sin(bt * 3.1) * wi, 0, 0); this.set('handR', 0.12 * Math.sin(bt * 3.1 + 1.5) * wi, 0, 0);
    }

    // ---- gait
    if (move > 0.001) {
      const Aleg = 0.5 * ww + 0.8 * wr + 0.95 * wsp, Klift = 0.55 * ww + 1.0 * wr + 1.3 * wsp;
      const Aarm = 0.4 * ww + 0.7 * wr + 0.35 * wsp, Barm = 0.0 * ww + 0.55 * wr + 1.25 * wsp;
      const g = 1 - this.air;
      for (const [sfx, off, sg] of [['L', 0, 1], ['R', Math.PI, -1]]) {
        const psi = ph + off, f = Math.sin(psi), c = Math.cos(psi), sw = Math.max(0, c);
        const thigh = -Aleg * f * g, shin = (Klift * Math.pow(sw, 1.3) + 0.12 * wr + 0.15 * wsp) * g, foot = (-(thigh + shin) * 0.55 + 0.35 * sw * wsp + 0.25 * Math.max(0, -c) * 0.5) * g;
        this.set('thigh' + sfx, thigh, 0, 0); this.set('shin' + sfx, shin, 0, 0); this.set('foot' + sfx, foot, 0, 0);
        // arms swing opposite to the same-side leg, elbows fold at the back of the swing
        const af = Math.sin(psi + Math.PI);
        this.set('uarm' + sfx, (Barm - Aarm * af) * g, 0, 0.12 * sg * (wr + wsp));
        this.set('farm' + sfx, -(0.35 * wr + 0.15 * wsp + 0.3 * ww) * (0.6 + 0.4 * Math.max(0, -af)) * g, 0, 0);
        this.set('hand' + sfx, -0.2 * wr * g, 0, 0);
      }
      const bob = Math.sin(ph * 2);
      this.set('hips', 0.04 * bob * move, 0.10 * Math.sin(ph) * (wr + wsp) + 0.06 * Math.sin(ph) * ww, 0.05 * Math.sin(ph) * move);
      this.set('spine', 0, -0.14 * Math.sin(ph) * (wr + wsp) - 0.06 * Math.sin(ph) * ww, -0.03 * Math.sin(ph) * move);
      this.set('chest', 0.02 * bob * move, -0.06 * Math.sin(ph) * (wr + wsp), 0);
      this.set('head', 0, 0.0, 0);
    }

    // ---- lean: tip the pelvis, keep the legs under him, level the head
    this.set('hips', lean, 0, this.bank * 0.55);
    this.set('thighL', -lean * 0.85, 0, 0); this.set('thighR', -lean * 0.85, 0, 0);
    this.set('spine', -lean * 0.25, 0, this.bank * 0.2); this.set('chest', -lean * 0.25, 0, this.bank * 0.2);
    this.set('neck', -lean * 0.3, this.headYaw * 0.4, 0); this.set('head', -lean * 0.35 - 0.1 * wsp, this.headYaw, -this.bank * 0.3);

    // ---- tail: counter-balance, side lag in turns, travelling wave while running
    const tailLift = 0.04 * wr + 0.22 * wsp + 0.02 * this.air + 0.18 * clamp(accel, 0, 1) - 0.25 * this.skidA;
    const waveAmp = 0.10 * wi + 0.14 * ww + 0.12 * wr + 0.05 * wsp;
    const wphase = wi > 0.5 ? this.t * 1.1 : this.t * (2 + s * 0.12);
    for (let i = 1; i <= 4; i++) {
      const lag = i * 0.8;
      this.set('tail' + i, tailLift * (i === 1 ? 1.2 : 0.6) + 0.03 * Math.sin(wphase * 1.3 + lag) + (i === 1 ? -lean * 0.4 : 0),
        waveAmp * Math.sin(wphase - lag) * (0.6 + i * 0.25) - this.tailYaw * (0.35 + 0.1 * i), 0);
    }

    // ---- jump: crouch -> rise tuck -> fall reach -> landing absorb
    const cr = Math.max(this.crouch, this.landDepth);
    if (cr > 0.001) {
      this.set('hips', 0.12 * cr, 0, 0); this.set('spine', 0.1 * cr, 0, 0); this.set('chest', 0.05 * cr, 0, 0);
      for (const sfx of ['L', 'R']) { this.set('thigh' + sfx, -0.55 * cr, 0, 0); this.set('shin' + sfx, 0.85 * cr, 0, 0); this.set('foot' + sfx, -0.2 * cr, 0, 0); this.set('uarm' + sfx, (this.crouch > this.landDepth ? 0.8 : -0.35) * cr, 0, 0.2 * cr * (sfx === 'L' ? 1 : -1)); }
      this.set('tail1', 0.15 * cr, 0, 0);
    }
    if (this.air > 0.001) {
      const a = this.air, rise = clamp(p.vy / 9, -1, 1), up = Math.max(0, rise), dn = Math.max(0, -rise);
      for (const [sfx, sg] of [['L', 1], ['R', -1]]) {
        const stag = sfx === 'L' ? 0 : 0.18;     // slightly staggered legs
        this.set('thigh' + sfx, a * (-(0.65 + stag) * up - (0.45 - stag * 0.5) * dn) * (1 - 0.0), 0, 0);
        this.set('shin' + sfx, a * ((1.05 + stag) * up + 0.35 * dn), 0, 0);
        this.set('foot' + sfx, a * (-0.35 * up + 0.2 * dn), 0, 0);
        this.set('uarm' + sfx, a * (0.9 * up + (-0.1) * dn) * (1 - wsp * 0.3), 0, a * (0.12 + 0.55 * dn) * sg);
        this.set('farm' + sfx, a * (-0.3 * up - 0.5 * dn), 0, 0);
      }
      this.set('tail1', a * 0.25 * up, 0, 0); this.set('tail2', a * 0.12 * up, 0, 0); this.set('hips', a * 0.05 * dn, 0, 0);
    }

    // ---- skid / quick stop: lean back, legs thrown forward, arms flare
    if (this.skidA > 0.001) {
      const q = this.skidA;
      for (const [sfx, sg] of [['L', 1], ['R', -1]]) { this.set('thigh' + sfx, -0.55 * q, 0, 0.1 * sg * q); this.set('shin' + sfx, 0.35 * q, 0, 0); this.set('foot' + sfx, 0.15 * q, 0, 0); this.set('uarm' + sfx, -0.35 * q, 0, 0.65 * sg * q); this.set('farm' + sfx, -0.2 * q, 0, 0); }
      this.set('head', 0.15 * q, 0, 0);
    }

    // ---- action layer (attacks): absolute bone rotations blended over the base pose
    const L = p.layer; this.layerW = L ? L.w : 0;
    let spin = 0;
    if (L && L.w > 0.001) {
      for (const n in L.rot) { const q = this.pose[n], t = L.rot[n]; if (!q) continue; q[0] = lerp(q[0], t[0], L.w); q[1] = lerp(q[1], t[1], L.w); q[2] = lerp(q[2], t[2], L.w); }
      // bones the layer does not mention fade toward the neutral crouch so the attack reads clearly
      spin = L.spinY || 0;
    }

    // ---- apply
    for (const n in this.pose) { const q = this.pose[n], b = R.bones[n]; E.set(q[0], q[1], q[2], 'XYZ'); b.quaternion.setFromEuler(E); }
    R.modelGroup.rotation.y = spin;
    R.modelGroup.updateMatrixWorld(true);

    // ---- foot planting: keep the lowest foot point on the ground when grounded (no sinking / hovering)
    const S = XLR8_SCALE;
    if (grounded && this.footClamp) {
      let slack = Infinity; const v = this._v || (this._v = new THREE.Vector3()), pw = new THREE.Vector3();
      R.modelGroup.parent.getWorldPosition(pw);
      for (const nm of ['ballL', 'ballR', 'toeL', 'toeR']) {
        R.markers[nm].getWorldPosition(v); const rel = v.y - pw.y - (R.modelGroup.position.y);   // marker height above the player's feet, minus current offset
        const want = (nm.startsWith('ball') ? XLR8_SOLE_Y : 0.30) * S;
        slack = Math.min(slack, rel - want);
      }
      const target = -slack - XLR8_SOLE_Y * S;     // model offset so the lowest contact touches y = 0
      this.baseY = damp(this.baseY, target, 40, dt);
      if (Math.abs(this.baseY - target) > 0.25) this.baseY = target;
    } else this.baseY = damp(this.baseY, -XLR8_SOLE_Y * S, 14, dt);
    R.modelGroup.position.y = this.baseY - (p.sink || 0);
  }
}
