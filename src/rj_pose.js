// Ripjaws procedural animation. The supplied GLB is static (no skeleton, no clips), so every pose is computed here and applied to the runtime rig (animations/ripjawsrig.js):
//   - land: a real foot-path gait (stance phase moves the planted foot back at exactly the body speed, so there is no foot sliding), pelvis bob / sway / counter-rotation,
//           arm swing, idle breathing / look-around / weight shift / jaw cycle, crouch-jump, airborne tuck, landing absorb
//   - water: idle tread (sculling arms, bicycle legs), crawl stroke (cyclic arm path + flutter kick + roll), fast torpedo (arms back, dolphin kick), dive reach, surfacing
//   - gestures: water entry, breach, water exit shake
//   - attack layers: bite (jaw opens, neck draws back, thrust, snap, recover) and claw swipe (alternating arms), both usable in the upright and the swimming posture
// Pose = { d:{bone:[rx,ry,rz]}, off:[x,y,z] metres, ik:{UL,UR:{p,pole,twist,frame:'c'}}, curl:{UL,UR}, legs:{L,R:{p,pole,pitch,yaw,roll,toe}} } (see RjPoser).
// Conventions (verified in the rig viewer): +rx leans a bone's tip forward (thigh forward = -rx, knee flexion = +rx), foot pitch + = toes down, jaw rest = OPEN, jaw -0.25 = closed.
import * as THREE from 'three';
import { clamp, lerp, damp, rand, smoothstep } from './util.js';
import { smooth as sm, layer as faLayer, V, D } from './fa_pose.js';

export { V, D, sm };
const sin = Math.sin, cos = Math.cos, PI = Math.PI, TAU = PI * 2, X_AX = new THREE.Vector3(1, 0, 0);
export const mkPose = () => ({ d: {}, off: [0, 0, 0], ik: {}, curl: { UL: 0.22, UR: 0.22 }, legs: {}, w: 1 });
const Z3 = [0, 0, 0];
const lp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// ----------------------------------------------------------------------------------- rig constants (metres; measured from the rig, see ripjawsrig.js)
const REST = { y: 0.134, z: -0.128, x: 0.272 };       // ankle bone at rest
const HIP = { x: 0.192, y: 1.056, z: -0.032 };         // thigh joint
const SHO = { x: 0.336, y: 0.288, z: -0.04 };          // shoulder, relative to the chest bone
const BALL = { y: -0.096, z: 0.24 }, HEEL = { y: -0.118, z: -0.048 };   // ball of the foot / heel, relative to the ankle bone
const LEG_REACH = 0.905;                                // usable leg length (0.934 m straight)

// ----------------------------------------------------------------------------------- blending
export function blendPose(A, B, k) {
  if (k <= 0.001) return A; if (k >= 0.999) return B;
  const P = mkPose();
  for (const key of new Set([...Object.keys(A.d), ...Object.keys(B.d)])) P.d[key] = lp3(A.d[key] || Z3, B.d[key] || Z3, k);
  for (let i = 0; i < 3; i++) P.off[i] = lerp(A.off[i], B.off[i], k);
  for (const key of new Set([...Object.keys(A.ik), ...Object.keys(B.ik)])) {
    const a = A.ik[key], b = B.ik[key];
    if (!a) P.ik[key] = b; else if (!b) P.ik[key] = a;
    else P.ik[key] = { p: a.p.clone().lerp(b.p, k), pole: a.pole && b.pole ? a.pole.clone().lerp(b.pole, k) : (b.pole || a.pole), twist: lerp(a.twist || 0, b.twist || 0, k), frame: 'c', w: 1 };
  }
  for (const key of new Set([...Object.keys(A.curl), ...Object.keys(B.curl)])) P.curl[key] = lerp(A.curl[key] ?? 0.22, B.curl[key] ?? 0.22, k);
  for (const s of ['L', 'R']) {
    const a = A.legs[s], b = B.legs[s]; if (!a) { P.legs[s] = b; continue; } if (!b) { P.legs[s] = a; continue; }
    P.legs[s] = { p: a.p.clone().lerp(b.p, k), pole: a.pole.clone().lerp(b.pole, k), pitch: lerp(a.pitch, b.pitch, k), yaw: lerp(a.yaw || 0, b.yaw || 0, k), roll: lerp(a.roll || 0, b.roll || 0, k), toe: lerp(a.toe, b.toe, k) };
  }
  return P;
}
/** layer A over P (arms + FK + offsets through the shared helper, legs here) */
export function layerR(P, A, poser) {
  const w = A.w ?? 1; if (w <= 0.001) return P;
  faLayer(P, A, poser);
  if (A.legs) for (const s in A.legs) {
    const e = A.legs[s], b = P.legs[s], wt = clamp((e.w ?? 1) * w, 0, 1); if (wt <= 0.001) continue; if (!b) { P.legs[s] = e; continue; }
    P.legs[s] = { p: b.p.clone().lerp(e.p, wt), pole: e.pole ? b.pole.clone().lerp(e.pole, wt) : b.pole, pitch: lerp(b.pitch, e.pitch, wt), yaw: lerp(b.yaw || 0, e.yaw || 0, wt), roll: lerp(b.roll || 0, e.roll || 0, wt), toe: lerp(b.toe, e.toe, wt) };
  }
  return P;
}
const add = (P, key, x = 0, y = 0, z = 0) => { const a = P.d[key] || Z3; P.d[key] = [a[0] + x, a[1] + y, a[2] + z]; };
/** target given in world-aligned chest space (x out, y up, z forward) -> body frame of a tilted swimmer */
const toBody = (v, tilt) => v.applyAxisAngle(X_AX, -tilt);
/** uniform Catmull-Rom through cyclic points, u in [0,1) */
function crom(pts, u) {
  const n = pts.length, x = (((u % 1) + 1) % 1) * n, i = Math.floor(x), f = x - i, p0 = pts[(i - 1 + n) % n], p1 = pts[i % n], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
  return p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f * f + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * f * f * f));
}
/** crawl stroke: hand path relative to the chest (out, along-body, belly-side) for the LEFT arm; mirrored for the right */
const STROKE = [[0.36, 1.00, 0.08], [0.42, 0.88, 0.26], [0.44, 0.50, 0.38], [0.36, 0.00, 0.34], [0.30, -0.42, 0.12], [0.48, -0.40, -0.12], [0.62, 0.00, -0.30], [0.52, 0.62, -0.26]];

/** foot placement along the stride: stance moves the foot back at body speed (no sliding); swing is a Hermite arc that leaves / arrives with that same velocity */
function footPath(ph, duty, S, lift, run) {
  const toff = 0.5 - 0.12 * run;
  if (ph < duty) {
    const u = ph / duty, pitch = u < 0.14 ? lerp(-0.24, 0, sm(u / 0.14)) : u < 0.5 ? 0 : lerp(0, toff, sm((u - 0.5) / 0.5));
    return { z: S * (0.5 - u), y: 0, pitch };
  }
  const v = (ph - duty) / (1 - duty), m = -0.55 * S * (1 - duty) / duty, v2 = v * v, v3 = v2 * v;
  const z = (2 * v3 - 3 * v2 + 1) * (-S / 2) + (v3 - 2 * v2 + v) * m + (-2 * v3 + 3 * v2) * (S / 2) + (v3 - v2) * m;
  return { z, y: lift * Math.pow(sin(PI * Math.pow(v, 0.88)), 0.9), pitch: lerp(toff, -0.24, sm(v * 1.5)) + 0.12 * sin(PI * v) };
}
/** rotate the foot about its ball (toes down) or heel (toes up) while that point stays where the flat foot had it: returns the ankle target correction */
function pivotFix(pitch, out) {
  const P = pitch >= 0 ? BALL : HEEL, c = cos(pitch), s = sin(pitch), ry = -P.y, rz = -P.z;
  out.y += P.y + (ry * c - rz * s); out.z += P.z + (ry * s + rz * c);
}
const needDrop = (A, sd, px) => { const dx = A.x - (sd * HIP.x + px), dz = A.z - HIP.z, q = LEG_REACH * LEG_REACH - dx * dx - dz * dz; return HIP.y - (A.y + Math.sqrt(Math.max(q, 0.0))); };
const legIK = (p, sd, pitch, toe, pole = null) => ({ p, pole: pole || V(sd * 0.12, 0.04, 1), pitch, yaw: 0, roll: 0, toe });

export class RjAnim {
  constructor() {
    this.s = {
      t: 0, ph: 0, mv: 0, run: 0, air: 0, crouch: 0, land: 0, sw: 0, sph: rand(0, 1), kph: 0, cru: 0, fast: 0, dive: 0, surf: 0, shift: 0, shiftTo: 0, shiftT: rand(3, 6), bank: 0, turn: 0, vyS: 0, acc: 0, prevMv: 0,
      look: { t: 1.5, yaw: 0, pitch: 0, ty: 0, tp: 0 }, jawT: rand(3, 6), jawU: -1, bk: { jaw: 0, nk: 0, hd: 0, sp: 0, oz: 0, hy: 0, arm: 0, dp: 0 }, ck: { w: 0 },
    };
    this.gest = null; this.state = 'IDLE';
  }
  play(kind, dur = 0.8) { this.gest = { kind, t: 0, dur }; }

  /** c = { speed (horizontal), speed3, vf, vl, vy, grounded, crouch, land, swim (0/1), tilt, diving, surf, turn, ascend, headroom } -> pose */
  pose(dt, c) {
    const s = this.s; s.t += dt;
    s.sw = damp(s.sw, c.swim, c.swim > s.sw ? 7 : 6, dt);
    const L = s.sw < 0.995 ? this.landPose(dt, c) : null, W = s.sw > 0.005 ? this.swimPose(dt, c) : null;
    const P = L && W ? blendPose(L, W, sm(s.sw)) : (W || L);
    this.gestApply(P, dt, c);
    return P;
  }

  // =================================================================================== land
  landPose(dt, c) {
    const s = this.s, P = mkPose(), t = s.t, sp = c.speed;
    s.mv = damp(s.mv, sp, 9, dt); s.run = damp(s.run, smoothstep(4.2, 5.8, sp), 5, dt);
    s.air = damp(s.air, c.grounded ? 0 : 1, c.grounded ? 14 : 20, dt); s.crouch = damp(s.crouch, c.crouch, 18, dt); s.land = c.land;
    const run = s.run, mvK = smoothstep(0.15, 1.2, s.mv), air = s.air, gr = 1 - air;
    // ---- gait clock
    const duty = lerp(0.62, 0.40, run), strideScale = 0.15 + 0.85 * smoothstep(0, 1.8, s.mv), S = lerp(0.85, 1.2, run) * strideScale, Leff = S / duty;
    const dirS = c.vf < -0.5 && sp > 0.8 ? -1 : 1;
    if (c.grounded) { s.ph = (s.ph + dirS * (s.mv / Math.max(Leff, 0.08)) * dt) % 1; if (s.ph < 0) s.ph += 1; }
    const ph = s.ph, br = sin(t * 1.9), lift = lerp(0.13, 0.30, run) * (0.35 + 0.65 * mvK);
    // ---- idle life: look-around, weight shift, jaw close / open
    const LK = s.look; LK.t -= dt; if (LK.t <= 0) { LK.t = rand(2.2, 5); LK.ty = rand(-0.8, 0.8); LK.tp = rand(-0.12, 0.14); } LK.yaw = damp(LK.yaw, LK.ty, 2.2, dt); LK.pitch = damp(LK.pitch, LK.tp, 2.6, dt);
    const idle = (1 - mvK) * gr * (1 - s.crouch);
    s.shiftT -= dt; if (s.shiftT <= 0) { s.shiftT = rand(4, 8); s.shiftTo = s.shiftTo === 0 ? (Math.random() < 0.5 ? 1 : -1) : 0; } s.shift = damp(s.shift, s.shiftTo, 1.6, dt);
    s.jawT -= dt; if (s.jawT <= 0 && s.jawU < 0) { s.jawU = 0; } if (s.jawU >= 0) { s.jawU += dt / 1.5; if (s.jawU >= 1) { s.jawU = -1; s.jawT = rand(5, 9); } }
    const jawIdle = s.jawU >= 0 ? -0.22 * Math.pow(sin(PI * s.jawU), 1.3) : 0;
    // ---- feet
    const feet = {}; let px = 0.03 * s.shift * idle + 0.028 * mvK * cos(TAU * (ph - duty / 2)) * (1 - run * 0.4) * gr;
    for (const [k, sd, off] of [['L', 1, 0], ['R', -1, 0.5]]) {
      const f = footPath((ph + off) % 1, duty, S, lift, run), x = sd * lerp(REST.x, 0.215, mvK * (1 - run * 0.3));
      const p = V(x, REST.y + f.y, REST.z + 0.02 + f.z); let pitch = f.pitch; pivotFix(pitch, p);
      // idle: the unloaded foot eases slightly forward
      const unl = clamp(-sd * s.shift, 0, 1) * idle; p.z += 0.05 * unl; p.y += 0.012 * unl;
      // airborne tuck: rising = knees up, falling = legs reach down for the landing
      if (air > 0.01) {
        const rise = clamp(c.vy / 6, -1, 1), fwdFoot = sd > 0;
        const q = V(sd * 0.25, REST.y + (fwdFoot ? 0.30 : 0.18) * (0.5 + 0.5 * rise) - (rise < 0 ? 0.04 : 0), REST.z + (fwdFoot ? 0.24 : -0.14) * (0.5 + 0.5 * rise) + (rise < 0 ? 0.04 : 0));
        p.lerp(q, air); pitch = lerp(pitch, 0.35 + 0.2 * rise, air);
      }
      feet[k] = { p, pitch, sd };
    }
    // pelvis: bob (up at mid-stance when walking, down at mid-stance when running), crouch / landing absorb, and whatever the legs need to reach their feet
    const bobSign = lerp(1, -1, run), bob = lerp(0.022, 0.05, run) * bobSign * cos(4 * PI * (ph - duty / 2)) * mvK * gr;
    const base = (0.03 + (0.05 + 0.08 * run) * mvK) * gr + 0.04 * air + 0.34 * s.crouch + 0.30 * s.land;
    let drop = base + bob; drop = Math.max(drop, needDrop(feet.L.p, 1, px) * gr + 0.0, needDrop(feet.R.p, -1, px) * gr + 0.0); drop = Math.max(drop, 0);
    P.off = [px, -drop, 0];
    for (const k of ['L', 'R']) { const f = feet[k]; P.legs[k] = legIK(f.p, f.sd, f.pitch, -Math.max(f.pitch, 0) * 0.9 + (f.pitch < 0 ? 0.15 * -f.pitch : 0)); }
    // ---- torso
    const yawH = -0.13 * (0.4 + 0.6 * run) * mvK * gr * cos(TAU * ph), rollH = 0.035 * mvK * gr * cos(TAU * (ph - duty / 2)) + 0.03 * s.shift * idle;
    const lean = (0.03 + 0.15 * run) * mvK + 0.28 * s.crouch + 0.20 * s.land - 0.1 * air * clamp(c.vy / 6, 0, 1);
    const acc = clamp((s.mv - s.prevMv) / Math.max(dt, 1e-3) / 20, -1, 1); s.acc = damp(s.acc, acc, 6, dt); s.prevMv = s.mv;
    P.d.hips = D(0.02 * br + lean * 0.25 - 0.1 * s.crouch, yawH, rollH);
    P.d.spine = D(0.012 * br + lean * 0.35 + 0.12 * s.land, -0.8 * yawH, -rollH * 0.6);
    P.d.chest = D(0.026 * br + lean * 0.40 + 0.1 * s.land + 0.06 * s.acc, -0.8 * yawH + LK.yaw * 0.2 * idle, -rollH * 0.4);
    P.d.neck = D(-lean * 0.55 + LK.pitch * 0.5 * idle, 0.35 * yawH + LK.yaw * 0.5 * idle, 0.02 * sin(t * 0.7));
    P.d.head = D(-lean * 0.45 + LK.pitch * 0.5 * idle + 0.015 * br, 0.25 * yawH + LK.yaw * 0.45 * idle, 0.03 * sin(t * 0.55 + 1));
    P.d.jaw = D(jawIdle + 0.03 * sin(t * 1.3) + 0.05 * run * mvK + 0.1 * s.land, 0, 0);
    // loin-cloth chain trails when moving, swings in the stride and settles when still
    const tr = 0.10 + 0.22 * mvK * (1 - run) + 0.55 * run * mvK, sw = sin(t * 1.7) * 0.05, lag = (i) => sin(TAU * ph * 2 - 0.9 * i) * 0.1 * mvK;
    P.d.skA = D(tr * 0.5 + sw + lag(0), 0, 0.05 * sin(t * 1.2)); P.d.skB = D(tr * 0.8 + sw * 1.2 + lag(1), 0, 0.08 * sin(t * 1.2 - 0.6)); P.d.skC = D(tr + sw * 1.4 + lag(2), 0, 0.11 * sin(t * 1.2 - 1.2));
    const fl = -(0.03 + 0.1 * mvK + 0.18 * run * mvK);
    P.d.fin0 = D(fl * 0.5 + 0.02 * sin(t * 2.1), 0, 0); P.d.fin1 = D(fl * 0.8 + 0.025 * sin(t * 2.1 - 0.6), 0, 0); P.d.fin2 = D(fl + 0.03 * sin(t * 2.1 - 1.2), 0, 0);
    P.d.ant0 = D(0.05 * sin(t * 3.1) - 0.5 * s.acc * 0.2 + 0.08 * mvK * cos(4 * PI * ph), 0, 0.04 * sin(t * 1.9)); P.d.ant1 = D(0.09 * sin(t * 3.1 - 0.7) - 0.25 * s.acc * 0.3 + 0.10 * mvK * cos(4 * PI * ph - 0.8), 0, 0.06 * sin(t * 1.9 - 0.5));
    // ---- arms
    for (const [k, sd, off] of [['UL', 1, 0.5], ['UR', -1, 0]]) {
      const swing = cos(TAU * (ph + off)), amp = lerp(0.20, 0.34, run) * mvK * gr, hang = lerp(0.79, 0.50, run * mvK) - 0.0, out = lerp(0.20, 0.26, run);
      let p = V(sd * (SHO.x + out + 0.02 * sin(t * 0.8 + sd)), SHO.y - hang + 0.01 * br + 0.10 * run * Math.max(swing, 0) * mvK, SHO.z + 0.12 + amp * swing + 0.20 * run * mvK - 0.04 * s.acc);
      let pole = V(sd * 0.6, -0.3, -0.85);
      const jumpArm = V(sd * (SHO.x + 0.30), SHO.y + 0.55 * clamp(c.vy / 5 + 0.3, 0, 1) + 0.05, 0.12), fallArm = V(sd * (SHO.x + 0.55), SHO.y - 0.38, 0.2);
      if (air > 0.01) { p.lerp(c.vy > 0 ? jumpArm : fallArm, air * (c.vy > 0 ? 1 : 0.8)); pole.lerp(V(sd * 0.7, 0, -0.7), air); }
      if (s.crouch > 0.01 || s.land > 0.01) { const cr = clamp(s.crouch + s.land, 0, 1); p.lerp(V(sd * (SHO.x + 0.34), SHO.y - 0.62, SHO.z - 0.02), cr * 0.8); }
      P.ik[k] = { p, pole, twist: 0, frame: 'c', w: 1 }; P.curl[k] = lerp(0.22, 0.5, run * mvK);
    }
    return P;
  }

  // =================================================================================== swimming
  swimPose(dt, c) {
    const s = this.s, P = mkPose(), t = s.t, sp = c.speed3, tilt = c.tilt;
    s.cru = damp(s.cru, smoothstep(0.5, 3.4, sp), 4, dt); s.fast = damp(s.fast, smoothstep(8.2, 11.2, sp), 5, dt);
    s.dive = damp(s.dive, c.diving ? 1 : 0, 5, dt); s.surf = damp(s.surf, c.surf || 0, 6, dt); s.bank = damp(s.bank, clamp(c.turn * 0.09, -0.45, 0.45), 5, dt);
    const cru = s.cru, fast = s.fast, dive = s.dive, surf = s.surf;
    s.sph = (s.sph + lerp(0.5, 1.15, smoothstep(0.8, 7.5, sp)) * (1 - fast) * (0.35 + 0.65 * cru) * dt) % 1;
    s.kph = (s.kph + lerp(1.1, 2.5, smoothstep(0.5, 12, sp)) * dt) % 1;
    const phi = TAU * s.kph, roll = sin(TAU * s.sph) * 0.3 * (1 - fast) * cru * (1 - dive), br = sin(t * 1.6);
    const b = clamp(tilt * 0.85, 0, 1.15) + 0.22 * surf;            // back-bend that keeps the face looking ahead while the torso is horizontal
    const aw = (0.07 + 0.04 * cru + 0.13 * fast + 0.04 * dive) * (0.55 + 0.45 * cru);
    // ---- spine: back-bend + undulation + roll + banking
    P.d.hips = D(aw * 0.9 * sin(phi) * cru, 0.5 * roll, -s.bank * 0.4);
    P.d.spine = D(-0.10 * b + aw * 0.7 * sin(phi - 0.6) * cru, 0.8 * roll, -s.bank * 0.5);
    P.d.chest = D(-0.17 * b + aw * 0.4 * sin(phi - 1.2) * cru + 0.02 * br, roll, -s.bank * 0.4);
    const LK = s.look; LK.t -= dt; if (LK.t <= 0) { LK.t = rand(2.2, 5); LK.ty = rand(-0.5, 0.5); LK.tp = rand(-0.1, 0.1); } LK.yaw = damp(LK.yaw, LK.ty, 2.2, dt); LK.pitch = damp(LK.pitch, LK.tp, 2.6, dt);
    const idle = 1 - cru;
    P.d.neck = D(-0.40 * b + LK.pitch * 0.4 * idle, -0.5 * roll + LK.yaw * 0.5 * idle + s.bank * 0.5, s.bank * 0.2);
    P.d.head = D(-0.33 * b + LK.pitch * 0.4 * idle + 0.02 * br, -0.4 * roll + LK.yaw * 0.4 * idle + s.bank * 0.3, 0.02 * sin(t * 0.55 + 1));
    P.d.jaw = D(0.07 + 0.04 * sin(t * 2.1) * idle - 0.16 * fast + 0.28 * surf, 0, 0);
    // loin-cloth chain: in the swimming posture it already lies along the body, so it only ripples (a trailing bias would lift it off the body)
    P.d.skA = D(0.03 + 0.12 * sin(phi - 0.9) * (0.4 + cru), 0, 0.05 * sin(t * 1.4)); P.d.skB = D(0.04 + 0.17 * sin(phi - 1.5) * (0.4 + cru), 0, 0.08 * sin(t * 1.4 - 0.6)); P.d.skC = D(0.05 + 0.22 * sin(phi - 2.1) * (0.4 + cru), 0, 0.11 * sin(t * 1.4 - 1.2));
    P.d.fin0 = D(-0.06 + 0.10 * sin(phi - 0.6), 0, 0); P.d.fin1 = D(-0.1 + 0.14 * sin(phi - 1.0), 0, 0); P.d.fin2 = D(-0.12 + 0.16 * sin(phi - 1.4), 0, 0);
    P.d.ant0 = D(-0.1 * cru + 0.06 * sin(t * 2.6), 0, 0.05 * sin(t * 1.7)); P.d.ant1 = D(-0.2 * cru + 0.1 * sin(t * 2.6 - 0.8), 0, 0.08 * sin(t * 1.7 - 0.6));
    // ---- legs: bicycle tread -> flutter kick -> legs-together dolphin kick
    for (const [k, sd] of [['L', 1], ['R', -1]]) {
      const o = sd > 0 ? 0 : PI, treadPh = TAU * 0.9 * t + o, flutPh = phi + o;
      const tread = V(sd * 0.22, 0.24 + 0.05 * cos(treadPh), REST.z + 0.09 * sin(treadPh));
      const flut = V(sd * 0.20, 0.17 + 0.05 * (1 - cos(flutPh)) * 0.5, REST.z + 0.15 * sin(flutPh));
      const dolph = V(sd * 0.125, 0.14, REST.z + 0.24 * sin(phi - 1.0));
      const p = tread.lerp(flut, cru).lerp(dolph, fast), pitch = lerp(0.45, 0.95, cru) + 0.2 * fast + 0.12 * sin(phi + o);
      P.legs[k] = legIK(p, sd, pitch, 0.3 + 0.2 * fast, V(sd * 0.1, 0.1, 1));
    }
    P.off = [0, -0.02 - 0.03 * (1 - cru), 0];
    // ---- arms: tread sculling -> crawl -> torpedo, dive reach when plunging, wide sweep at the surface
    for (const [k, sd, o] of [['UL', 1, 0], ['UR', -1, 0.5]]) {
      const tr = TAU * 1.15 * t + (sd > 0 ? 0 : PI);
      const tread = V(sd * (SHO.x + 0.28 + 0.12 * cos(tr)), SHO.y - 0.36, SHO.z + 0.2 + 0.12 * sin(tr));
      const sc = crom(STROKE, s.sph + o), crawl = V(sd * sc[0], SHO.y + sc[1] - 0.28, sc[2] - 0.04);
      const torp = V(sd * 0.30, -0.55, 0.0), diveR = V(sd * 0.12, 0.98, 0.10);
      const sur = V(sd * (SHO.x + 0.45 + 0.12 * sin(t * 2.2 + sd)), SHO.y - 0.10 + 0.08 * sin(t * 2.2), 0.28 + 0.1 * cos(t * 2.2 + sd));
      const p = tread.lerp(crawl, cru).lerp(torp, fast).lerp(diveR, dive).lerp(sur, surf * (1 - dive));
      const pole = V(sd * 0.55, -0.25, -0.85);
      P.ik[k] = { p, pole, twist: 0, frame: 'c', w: 1 }; P.curl[k] = lerp(0.3, 0.12, cru) + 0.15 * fast;
    }
    return P;
  }

  // =================================================================================== gestures (water entry / breach / water exit)
  gestApply(P, dt, c) {
    const G = this.gest; if (!G) return; G.t += dt; const u = G.t / G.dur; if (u >= 1) { this.gest = null; return; }
    const env = Math.pow(sin(PI * clamp(u, 0, 1)), 0.7), tilt = c.tilt || 0, w = env;
    const arms = (fn, wt = 1) => { for (const [k, sd] of [['UL', 1], ['UR', -1]]) { const e = P.ik[k], tgt = toBody(fn(sd), tilt); if (e) { e.p = e.p.clone().lerp(tgt, wt * w); e.pole = V(sd * 0.7, -0.1, -0.7); } } };
    const legs = (x, y, z, pitch, wt = 1) => { for (const [k, sd] of [['L', 1], ['R', -1]]) { const l = P.legs[k]; if (!l) continue; l.p = l.p.clone().lerp(V(sd * x, y, z), wt * w); l.pitch = lerp(l.pitch, pitch, wt * w); } };
    switch (G.kind) {
      case 'entry':     // plunge: hands together overhead, back arched, legs joined and pointed
        arms(sd => V(sd * 0.14, 1.0, 0.12)); legs(0.12, 0.13, REST.z, 1.0); add(P, 'chest', -0.10 * w); add(P, 'neck', 0.16 * w); add(P, 'head', 0.14 * w); add(P, 'jaw', 0.12 * w); break;
      case 'breach':    // leaping out: arms thrown wide and up, head back, jaws wide, legs trailing
        arms(sd => V(sd * 0.95, 0.70, 0.04)); legs(0.12, 0.14, REST.z - 0.02, 0.9); add(P, 'chest', -0.20 * w); add(P, 'neck', -0.14 * w); add(P, 'head', -0.12 * w); add(P, 'jaw', 0.55 * w); add(P, 'spine', -0.10 * w); break;
      case 'exit':      // shaking off the water: shoulders and head shudder, arms hang wide
        { const dec = Math.pow(1 - u, 1.2), sh = sin(G.t * 38) * dec; add(P, 'chest', 0, 0.22 * sh, 0.04 * sh); add(P, 'spine', 0, 0.12 * sh, 0); add(P, 'head', 0.04 * sh, 0.30 * sh, 0); add(P, 'jaw', 0.18 * w * 0.4 * (0.5 + 0.5 * sin(G.t * 19))); add(P, 'hips', 0, -0.10 * sh, 0);
          arms(sd => V(sd * 0.82, -0.40 + 0.06 * sh, 0.10), 0.7); } break;
    }
  }

  // =================================================================================== attack layers
  /** bite: a = { stage:'wind'|'lunge'|'snap'|'recover', st, windT, lungeT, snapT, recT } or null to relax. Additive on top of the locomotion pose. */
  biteApply(P, a, c, dt) {
    const B = this.s.bk; let jaw = 0, nk = 0, hd = 0, sp = 0, oz = 0, hy = 0, arm = 0, dp = 0;
    if (a) {
      const st = a.stage;
      if (st === 'wind') { const k = sm(a.st / a.windT); jaw = lerp(0, 0.62, k); nk = lerp(0, -0.30, k); hd = lerp(0, -0.20, k); sp = lerp(0, -0.14, k); oz = lerp(0, -0.10, k); arm = k * 0.8; }
      else if (st === 'lunge') { const k = sm(a.st / a.lungeT); dp = (a.dip || 0) * k; jaw = 0.66; nk = lerp(-0.30, 0.34, k); hd = lerp(-0.20, 0.28, k); sp = lerp(-0.14, 0.20, k); oz = lerp(-0.10, 0.28, k); arm = 0.8; }
      else if (st === 'snap') { const k = sm(a.st / a.snapT); dp = a.dip || 0; jaw = lerp(0.66, -0.25, k); nk = 0.34; hd = 0.28; sp = 0.20; oz = 0.28; hy = sin(a.st * 95) * 0.15 * (1 - k); arm = lerp(0.8, 0.2, k); }
      else { const k = sm(a.st / a.recT); dp = (a.dip || 0) * (1 - k); jaw = lerp(-0.25, 0, k); nk = lerp(0.34, 0, k); hd = lerp(0.28, 0, k); sp = lerp(0.20, 0, k); oz = lerp(0.28, 0, k); hy = sin(a.st * 40) * 0.07 * (1 - k); arm = lerp(0.2, 0, k); }
    }
    const r = a && a.stage === 'snap' ? 60 : 28;
    B.jaw = damp(B.jaw, jaw, r, dt); B.nk = damp(B.nk, nk, 26, dt); B.hd = damp(B.hd, hd, 26, dt); B.sp = damp(B.sp, sp, 26, dt); B.oz = damp(B.oz, oz, 22, dt); B.hy = damp(B.hy, hy, 60, dt); B.arm = damp(B.arm, arm, 20, dt); B.dp = damp(B.dp, dp, 24, dt);
    if (!a && Math.abs(B.dp) + Math.abs(B.jaw) + Math.abs(B.nk) + Math.abs(B.hd) + Math.abs(B.sp) + Math.abs(B.oz) + B.arm < 0.004) return;
    const tilt = c.tilt || 0, up = cos(tilt), fw = sin(tilt);
    if (B.dp > 0.004) { add(P, 'spine', B.dp * 0.42); add(P, 'chest', B.dp * 0.34); add(P, 'neck', B.dp * 0.16); add(P, 'head', B.dp * 0.1); P.off[1] -= 0.3 * B.dp * up; P.off[2] += 0.1 * B.dp * up; }
    add(P, 'jaw', B.jaw); add(P, 'neck', B.nk, B.hy * 0.6); add(P, 'head', B.hd, B.hy); add(P, 'spine', B.sp * 0.5); add(P, 'chest', B.sp * 0.4); add(P, 'hips', -B.sp * 0.2);
    P.off[2] += B.oz * 0.55 * up; P.off[1] += B.oz * 0.55 * fw - 0.04 * Math.abs(B.nk) * up;
    if (B.arm > 0.01) for (const [k, sd] of [['UL', 1], ['UR', -1]]) { const e = P.ik[k]; if (e) { const tgt = toBody(V(sd * (SHO.x + 0.46), SHO.y - 0.30, 0.18), tilt); e.p = e.p.clone().lerp(tgt, B.arm * 0.7); } }
  }
  /** claw swipe: a = { stage:'start'|'swipe'|'recover', st, windT, swipeT, recT, side (+1 left arm, -1 right) } */
  clawApply(P, a, c, dt) {
    const K = this.s.ck; K.w = damp(K.w, a ? 1 : 0, a ? 26 : 12, dt); if (!a && K.w < 0.01) return;
    if (a) {
      const sd = a.side, st = a.stage; let k, tw;
      if (st === 'start') { k = -sm(a.st / a.windT); tw = -1; } else if (st === 'swipe') { k = sm(a.st / a.swipeT); tw = lerp(-1, 1, k); } else { k = 1 - sm(a.st / a.recT); tw = k; }
      const wind = V(sd * 0.80, 0.26, -0.28), end = V(-sd * 0.22, 0.04, 0.84), neutral = V(sd * 0.55, -0.40, 0.14);
      let p; if (k < 0) p = neutral.clone().lerp(wind, -k); else { p = wind.clone().lerp(end, k); p.x += sd * 0.22 * sin(PI * k); p.y += 0.12 * sin(PI * k); }
      if (st === 'recover') { const r = sm(a.st / a.recT); p = end.clone().lerp(neutral, r); p.y += 0.12 * sin(PI * r); }
      this.s.ck.p = toBody(p, c.tilt || 0); this.s.ck.sd = sd; this.s.ck.tw = tw; this.s.ck.curl = st === 'swipe' ? 0.0 : 0.12; this.s.ck.wst = st === 'recover' ? clamp(1 - a.st / a.recT * 0.9, 0, 1) : 1;
    }
    const q = this.s.ck, w = K.w; if (!q.p) return; const k = q.sd > 0 ? 'UL' : 'UR', e = P.ik[k], wt = clamp(w * (q.wst ?? 1), 0, 1);
    if (e) { e.p = e.p.clone().lerp(q.p, wt); e.pole = V(q.sd * 0.85, 0.25, -0.5).lerp(e.pole || V(q.sd * 0.6, -0.3, -0.85), 1 - wt); } else P.ik[k] = { p: q.p.clone(), pole: V(q.sd * 0.85, 0.25, -0.5), twist: 0, frame: 'c', w: 1 };
    P.curl[k] = lerp(P.curl[k] ?? 0.22, q.curl, wt);
    const tws = (q.tw || 0) * 0.34 * q.sd * w; add(P, 'spine', 0.04 * w, -tws * 0.7); add(P, 'chest', 0.04 * w, -tws); add(P, 'hips', 0, tws * 0.25); add(P, 'neck', 0, tws * 0.5); add(P, 'head', 0, tws * 0.4); add(P, 'jaw', 0.2 * w);
    P.off[0] += -q.sd * 0.05 * ((q.tw || 0) * 0.5 + 0.5) * w;
  }
}
